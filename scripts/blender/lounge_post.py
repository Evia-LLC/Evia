"""Grade + encode Evia environment renders (run with Blender's bundled Python: numpy, OpenImageIO, PyOpenColorIO).

  PY=/Applications/Blender.app/Contents/Resources/4.5/python/bin/python3.11
  # graded preview PNG (for comparisons):
  $PY scripts/blender/lounge_post.py preview <render.exr> <out.png> [--look home]
  # final WebP set (+ dim/glow-delta/fg/depth layers) into a public folder:
  $PY scripts/blender/lounge_post.py publish <render.exr> <out_dir> <basename> [--look lounge] [--sizes 2560,1920,1280]
        [--blur 640]   (adds <basename>-blur-640.webp, a heavily blurred copy for frosted panels)
        [--soft 320:2] (adds <basename>-soft-320.webp, gaussian sigma 2 px at 320 wide: a lightly softened copy)
        [--no-layers]  (plate sizes only: no dim/glow/fg/depth layers)
        [--quality 82] (WebP quality)   [--lossless] (lossless WebP: for smooth, high-key plates)   [--no-dither] (WebP files get +-1 code value seeded TPDF dither by default)
  Looks: 'lounge' (L1/L2/L3 lounge plates), 'hero' (L5 products hero), 'home' (neutral base).
  # merge per-camera anchors into one file:
  $PY scripts/blender/lounge_post.py merge-anchors <out/anchors.json> home=<a.json> home_mobile=<b.json> ...

Pipeline (scene-linear Rec.709 in, sRGB display out):
  exposure/white balance -> bloom (multi-scale, on highlights) -> OCIO view transform (Blender's
  config, AgX) -> display-space grade (lift/gamma/gain, saturation, warm-rose split tone, vignette).
The same grade is applied to the "dim" version (beauty minus 55 % of the denoised 'glow' light
group) so glow-delta = plate - dim is exact at 0 and 1 in display space.
"""
import sys
import os
import json
import numpy as np
import OpenImageIO as oiio
import PyOpenColorIO as ocio

OCIO_CFG = '/Applications/Blender.app/Contents/Resources/4.5/datafiles/colormanagement/config.ocio'

LOOKS = {
    'home': dict(
        exposure=0.0, wb=(1.0, 1.0, 1.0),
        bloom_threshold=1.2, bloom_strength=0.10, bloom_levels=(1, 2, 3, 4, 5, 6), bloom_tint=(1.0, 0.85, 0.72),
        view='AgX',
        lift=(0.0, 0.0, 0.0), gamma=(1.0, 1.0, 1.0), gain=(1.0, 1.0, 1.0),
        saturation=1.0, contrast=1.0, pivot=0.4,
        shadow_tint=(0.0, 0.0, 0.0), highlight_tint=(0.0, 0.0, 0.0),
        vignette=0.0, dim_glow=0.55,
        glow_bloom=0.0, glow_bloom_levels=(2, 3, 4, 5), glow_bloom_tint=(1.0, 0.8, 0.65),
    ),
}
# tuned looks (values found by comparing previews against the reference crops)
LOOKS['lounge'] = dict(LOOKS['home'], exposure=-2.3, glow_bloom=0.7, wb=(0.98, 0.95, 1.3), lift=(0.02, 0.01, 0.015))
LOOKS['strip'] = dict(LOOKS['lounge'], exposure=-2.2, wb=(0.95, 0.95, 1.45), bloom_strength=0.16, glow_bloom=1.4,
                      glow_bloom_levels=(2, 3, 4, 5, 6))   # L3 sidebar strip (seen through CSS glass)
LOOKS['hero'] = dict(LOOKS['home'], exposure=0.95, bloom_strength=0.06, glow_bloom=0.0, wb=(1.03, 0.96, 0.98),
                     saturation=1.12, lift=(0.04, 0.03, 0.03), tl_shade=0.13)


def read_exr(path):
    buf = oiio.ImageBuf(path)
    spec = buf.spec()
    names = list(spec.channelnames)
    px = np.asarray(buf.get_pixels(oiio.FLOAT)).reshape(spec.height, spec.width, spec.nchannels)
    layers = {}
    for i, n in enumerate(names):
        if '.' in n:
            lay, ch = n.rsplit('.', 1)
        else:
            lay, ch = '', n
        layers.setdefault(lay, {})[ch] = px[:, :, i]
    out = {}
    for lay, chans in layers.items():
        if all(c in chans for c in 'RGB'):
            out[lay] = np.stack([chans['R'], chans['G'], chans['B']], axis=-1)
        elif 'V' in chans:
            out[lay] = chans['V']
        elif 'Z' in chans:
            out[lay] = chans['Z']
        elif 'A' in chans and len(chans) == 1:
            out[lay] = chans['A']
        else:
            k = sorted(chans)[0]
            out[lay] = chans[k]
    return out, names


def to_buf(px):
    h, w = px.shape[:2]
    c = 1 if px.ndim == 2 else px.shape[2]
    b = oiio.ImageBuf(oiio.ImageSpec(w, h, c, oiio.FLOAT))
    b.set_pixels(oiio.ROI(0, w, 0, h, 0, 1, 0, c), np.ascontiguousarray(px, dtype=np.float32))
    return b


def from_buf(b):
    s = b.spec()
    return np.asarray(b.get_pixels(oiio.FLOAT)).reshape(s.height, s.width, s.nchannels)


def resize(px, w, h):
    c = 1 if px.ndim == 2 else px.shape[2]
    out = from_buf(oiio.ImageBufAlgo.resize(to_buf(px), roi=oiio.ROI(0, w, 0, h, 0, 1, 0, c)))
    return out[:, :, 0] if px.ndim == 2 else out


def resize_soft(px, w, h, filt):
    """Resize with a non-negative filter (the default lanczos rings below zero next to very bright LED lines,
    which turned bloom halos into black blots)."""
    c = 1 if px.ndim == 2 else px.shape[2]
    out = from_buf(oiio.ImageBufAlgo.resize(to_buf(px), filtername=filt, roi=oiio.ROI(0, w, 0, h, 0, 1, 0, c)))
    out = np.clip(out, 0, None)
    return out[:, :, 0] if px.ndim == 2 else out


def blur_level(px, level):
    """Smooth, non-negative blur of radius ~2^level px: box-average down, a small binomial blur at low res,
    then a cubic B-spline up-sample (C2-smooth, no ringing, no blocks)."""
    h, w = px.shape[:2]
    f = 2 ** level
    sw, sh = max(1, w // f), max(1, h // f)
    small = resize_soft(px, sw, sh, 'box')
    k = np.array([1, 4, 6, 4, 1], dtype=np.float32) / 16.0
    for ax in (0, 1):
        if small.shape[ax] >= 5:
            pad = [(0, 0)] * small.ndim
            pad[ax] = (2, 2)
            sp = np.pad(small, pad, mode='edge')
            small = sum(k[i] * np.take(sp, range(i, i + small.shape[ax]), axis=ax) for i in range(5))
    return resize_soft(small.astype(np.float32), w, h, 'bspline')


def bloom(lin, thr, strength, levels, tint):
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    knee = np.clip((lum - thr) / max(thr, 1e-3), 0, None)
    w = (knee / (1 + knee))[..., None]
    hi = lin * w
    acc = np.zeros_like(lin)
    for i, lv in enumerate(levels):
        acc += blur_level(hi, lv) * (1.0 / len(levels))
    return lin + acc * strength * np.array(tint, dtype=np.float32)


_PROC = {}
DITHER = False   # set by 'publish' (on unless --no-dither)
LOSSLESS = False  # set by 'publish --lossless' (smooth high-key plates: lossy WebP bands them)


def view_transform(lin, view):
    if view not in _PROC:
        cfg = ocio.Config.CreateFromFile(OCIO_CFG)
        t = ocio.DisplayViewTransform(src='Linear Rec.709', display='sRGB', view=view)
        _PROC[view] = cfg.getProcessor(t).getDefaultCPUProcessor()
    img = np.ascontiguousarray(lin, dtype=np.float32).copy()
    _PROC[view].applyRGB(img)
    return img


def glow_halo(glow, levels):
    """Soft multi-scale halo of the emitter light group (LED lines, coves, lamps)."""
    acc = np.zeros_like(glow)
    for lv in levels:
        acc += blur_level(glow, lv) * (1.0 / len(levels))
    return acc


def grade(lin, lk, bloom_on=True, glow=None):
    x = lin * (2.0 ** lk['exposure']) * np.array(lk['wb'], dtype=np.float32)
    if bloom_on and glow is not None and lk.get('glow_bloom', 0) > 0:
        g = glow * (2.0 ** lk['exposure']) * np.array(lk['wb'], dtype=np.float32)
        x = x + glow_halo(g, lk['glow_bloom_levels']) * lk['glow_bloom'] * np.array(lk['glow_bloom_tint'], dtype=np.float32)
    if bloom_on and lk['bloom_strength'] > 0:
        x = bloom(x, lk['bloom_threshold'], lk['bloom_strength'], lk['bloom_levels'], lk['bloom_tint'])
    d = view_transform(np.clip(x, 0, None), lk['view'])
    d = np.clip(d, 0, 1)
    # lift / gamma / gain (ASC-CDL-ish)
    lift = np.array(lk['lift'], dtype=np.float32)
    gain = np.array(lk['gain'], dtype=np.float32)
    gam = np.array(lk['gamma'], dtype=np.float32)
    d = d * gain + lift * (1 - d)
    d = np.clip(d, 0, 1) ** (1.0 / gam)
    # contrast around pivot
    if lk['contrast'] != 1.0:
        d = (d - lk['pivot']) * lk['contrast'] + lk['pivot']
    # saturation
    lum = (d @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[..., None]
    d = lum + (d - lum) * lk['saturation']
    # split tone
    st = np.array(lk['shadow_tint'], dtype=np.float32)
    ht = np.array(lk['highlight_tint'], dtype=np.float32)
    d = d + st * (1 - lum) ** 2 + ht * lum ** 2
    # soft photographic grad: darkens toward the top-left corner (ref3 hero: dusty rose top-left, blush below)
    if lk.get('tl_shade', 0):
        h, w = d.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        t = np.clip(1.0 - (0.45 * xx / w + yy / h), 0, 1) ** 2
        d = d * (1 - lk['tl_shade'] * t[..., None])
    # vignette
    if lk['vignette']:
        h, w = d.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
        d = d * (1 - lk['vignette'] * r[..., None] ** 2)
    return np.clip(d, 0, 1)


def dither(px, seed=1729):
    """Seeded TPDF noise of +-1 code value: breaks up the 8-bit/WebP banding on smooth plaster gradients."""
    rng = np.random.default_rng(seed)
    n = (rng.random(px.shape[:2], dtype=np.float32) - rng.random(px.shape[:2], dtype=np.float32)) / 255.0
    return px + n[..., None]


def save(path, px, quality=82, alpha=None):
    if path.endswith('.webp') and DITHER:
        px = dither(px)
    h, w = px.shape[:2]
    c = 3 if alpha is None else 4
    if alpha is not None:
        px = np.concatenate([px, alpha[..., None]], axis=-1)
    spec = oiio.ImageSpec(w, h, c, oiio.UINT8)
    if path.endswith('.webp'):
        spec.attribute('compression', 'lossless' if LOSSLESS else f'webp:{quality}')
    o = oiio.ImageOutput.create(path)
    o.open(path, spec)
    o.write_image(np.ascontiguousarray(np.clip(px, 0, 1), dtype=np.float32))
    o.close()


def load_look(args):
    name = 'home'
    if '--look' in args:
        name = args[args.index('--look') + 1]
    lk = dict(LOOKS['home'])
    lk.update(LOOKS.get(name, {}))
    if '--look-json' in args:
        lk.update(json.load(open(args[args.index('--look-json') + 1])))
    return lk


def merge_anchors(out_path, items, extra=None):
    """Merge per-camera anchor files (name=path ...) into one anchors.json keyed by camera name."""
    out = {'coords': 'normalised plate coordinates (0..1), origin top-left, x right, y down',
           'quadOrder': 'TL,TR,BR,BL', 'cameras': {}}
    if extra:
        out.update(extra)
    for it in items:
        name, path = it.split('=', 1)
        d = json.load(open(path))
        d.pop('coords', None)
        out['cameras'][name] = d
    with open(out_path, 'w') as fh:
        json.dump(out, fh, indent=1)


def main():
    cmd = sys.argv[1]
    args = sys.argv[2:]
    if cmd == 'merge-anchors':
        merge_anchors(args[0], args[1:])
        return
    lk = load_look(args)
    layers, names = read_exr(args[0])
    rgb = layers['rgb']
    glow = layers.get('glow')
    if cmd == 'preview':
        d = grade(rgb, lk, glow=glow)
        save(args[1], d)
        if glow is not None and '--dim' in args:
            dim = grade(np.clip(rgb - lk['dim_glow'] * glow, 0, None), lk, glow=glow * (1 - lk['dim_glow']))
            save(args[1].replace('.png', '_dim.png'), dim)
        print('channels:', names)
    elif cmd == 'publish':
        out_dir, base = args[1], args[2]
        os.makedirs(out_dir, exist_ok=True)
        sizes = [2560, 1920, 1280]
        if '--sizes' in args:
            sizes = [int(v) for v in args[args.index('--sizes') + 1].split(',')]
        q = int(args[args.index('--quality') + 1]) if '--quality' in args else 82
        global DITHER, LOSSLESS
        LOSSLESS = '--lossless' in args
        DITHER = '--no-dither' not in args and not LOSSLESS
        full = grade(rgb, lk, glow=glow)
        h, w = full.shape[:2]
        report = {}
        dim = None
        base_only = '--no-layers' in args
        if base_only:
            glow = None
            layers.pop('fgmask', None)
            layers.pop('mist', None)
        if glow is not None:
            dim = grade(np.clip(rgb - lk['dim_glow'] * glow, 0, None), lk, glow=glow * (1 - lk['dim_glow']))
            delta = np.clip(full - dim, 0, 1)
        fg = layers.get('fgmask')
        for sw in sizes:
            sh = round(h * sw / w)
            p = os.path.join(out_dir, f'{base}-{sw}.webp')
            save(p, resize(full, sw, sh) if sw != w else full, q)
            report[os.path.basename(p)] = os.path.getsize(p)
            if dim is not None and sw in (sizes[0], sizes[-1]):
                for nm, im in (('dim', dim), ('glow', delta)):
                    p = os.path.join(out_dir, f'{base}-{nm}-{sw}.webp')
                    save(p, resize(im, sw, sh) if sw != w else im, q)
                    report[os.path.basename(p)] = os.path.getsize(p)
            if fg is not None and sw in (sizes[0], sizes[-1]) and fg.max() > 0.01:
                a = np.clip(fg, 0, 1)
                col = full
                p = os.path.join(out_dir, f'{base}-fg-{sw}.webp')
                ca = resize(np.concatenate([col, a[..., None]], -1), sw, sh) if sw != w else np.concatenate([col, a[..., None]], -1)
                save(p, ca[..., :3], q, alpha=ca[..., 3])
                report[os.path.basename(p)] = os.path.getsize(p)
        if '--blur' in args:
            # pre-blurred small copy for frosted-glass panels (cheaper than CSS backdrop-filter on phones)
            sw = int(args[args.index('--blur') + 1])
            sh = round(h * sw / w)
            small = resize(full, sw, sh)
            p = os.path.join(out_dir, f'{base}-blur-{sw}.webp')
            save(p, blur_level(blur_level(small, 2), 3), q)
            report[os.path.basename(p)] = os.path.getsize(p)
        if '--soft' in args:
            # lightly blurred copy (gaussian sigma in output px) for a glass panel that should still read the room
            sw, sig = args[args.index('--soft') + 1].split(':')
            sw, sig = int(sw), float(sig)
            sh = round(h * sw / w)
            k = oiio.ImageBufAlgo.make_kernel('gaussian', 6 * sig, 6 * sig)
            soft = from_buf(oiio.ImageBufAlgo.convolve(to_buf(resize(full, sw, sh)), k))
            p = os.path.join(out_dir, f'{base}-soft-{sw}.webp')
            save(p, soft, q)
            report[os.path.basename(p)] = os.path.getsize(p)
        if 'mist' in layers:
            m = layers['mist']
            m = m if m.ndim == 2 else m[..., 0]
            sw = sizes[-1]
            sh = round(h * sw / w)
            p = os.path.join(out_dir, f'{base}-depth-{sw}.webp')
            dm = resize(np.repeat(np.clip(m, 0, 1)[..., None], 3, -1), sw, sh)
            save(p, dm, 80)
            report[os.path.basename(p)] = os.path.getsize(p)
        # full-res graded PNG master next to the EXR for archival/comparison
        save(os.path.splitext(args[0])[0] + '_graded.png', full)
        print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
