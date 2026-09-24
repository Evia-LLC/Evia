"""Evia CONSULT room - post pipeline: grade + bloom + AgX + layer extraction + WebP encoding.

Runs with Blender's bundled Python (numpy + OpenImageIO + OCIO), no bpy needed:

  PY=/Applications/Blender.app/Contents/Resources/4.5/python/bin/python3.11
  $PY scripts/blender/consult_post.py --exr <dir>/consult_desktop_final.exr [--publish public/env/consult]

Input: the multilayer EXR written by room_consult.py (layers rgb, neon, emitter, under, fgmask, mist)
and its _anchors.json. Output (next to the EXR, and in --publish when given):
  plate-{2560,1920,1280}.webp   full room plate, opaque (z 0)
  fg-{2560,1920,1280}.webp      pedestal + glass top + book stack/ledge, RGBA (z 2, above the character)
  glow-neon-{...}.webp          additive "boost" of the neon light group (cove/halo/strips), z 0.5
  glow-emitter-{...}.webp       additive boost of the pedestal emitter rim/rings, z 2.5 (above fg)
  anchors.json                  overlay anchors (plate-normalised)
The glow layers are display-space deltas: display(grade(rgb + k*group)) - display(grade(rgb)),
meant for `mix-blend-mode: plus-lighter` (fallback `screen`) with an animated opacity 0..1.
All grading happens here so the look can be iterated without re-rendering.
"""
import os
import sys
import json
import shutil
import argparse
import numpy as np
import OpenImageIO as oiio
from OpenImageIO import ImageBuf, ImageSpec, ImageBufAlgo, ROI

OCIO_CFG = '/Applications/Blender.app/Contents/Resources/4.5/datafiles/colormanagement/config.ocio'

# ---------------------------------------------------------------- look parameters (tuned vs ref4)
LOOK = dict(
    exposure=0.0,          # stops, scene-linear
    wb=(1.0, 1.0, 1.0),    # linear channel gains
    bloom_threshold=1.2,   # scene-linear luminance where bloom starts
    bloom_strength=0.16,
    bloom_radii=(4, 8, 16, 32, 64),   # in plate px at 2560 wide (scaled for other sizes)
    bloom_weights=(0.35, 0.3, 0.2, 0.1, 0.05),
    agx_look='AgX - Medium High Contrast',
    shadow_tint=(0.028, 0.028, 0.048),  # display-space navy/plum lift in the shadows (scan.md 6 split tone)
    highlight_tint=(0.0, 0.0, 0.0),
    vignette=0.0,
    haze=0.05,             # wide, low-threshold glow (scan.md 6: "light atmospheric haze")
    haze_radius=180,       # plate px at 2560 wide
    glow_boost=dict(neon=0.6, emitter=1.0, under=0.8),
    group_gain=dict(neon=1.0, emitter=1.0, under=0.65),   # re-weight light groups before grading (no re-render)
)


def read_layers(path):
    b = ImageBuf(path)
    spec = b.spec()
    names = list(spec.channelnames)
    px = b.get_pixels(oiio.FLOAT)
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
            out[lay] = chans['V'][:, :, None]
        elif 'X' in chans:
            out[lay] = chans['X'][:, :, None]
        elif 'Z' in chans:
            out[lay] = chans['Z'][:, :, None]
        else:
            k = sorted(chans)[0]
            out[lay] = chans[k][:, :, None]
        if 'A' in chans:
            out[lay + '.alpha'] = chans['A'][:, :, None]
    return out, names


def to_buf(a):
    a = np.ascontiguousarray(a.astype(np.float32))
    spec = ImageSpec(a.shape[1], a.shape[0], a.shape[2], oiio.FLOAT)
    b = ImageBuf(spec)
    b.set_pixels(ROI(0, a.shape[1], 0, a.shape[0], 0, 1, 0, a.shape[2]), a)
    return b


def resize(a, w, h):
    r = ImageBufAlgo.resize(to_buf(a), roi=ROI(0, int(w), 0, int(h), 0, 1, 0, a.shape[2]))
    return r.get_pixels(oiio.FLOAT)


def blur(a, radius):
    """Approximate gaussian blur via downsample (box-filtered resize) + bilinear upsample."""
    h, w = a.shape[:2]
    f = max(1.0, radius / 1.5)
    sw, sh = max(2, int(round(w / f))), max(2, int(round(h / f)))
    small = resize(a, sw, sh)
    # one extra light blur at the small scale
    k = ImageBufAlgo.make_kernel('gaussian', 3, 3)
    small = ImageBufAlgo.convolve(to_buf(small), k).get_pixels(oiio.FLOAT)
    return resize(small, w, h)


def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def bloom(lin, scale):
    L = lum(lin)[..., None]
    t = LOOK['bloom_threshold']
    knee = np.clip((L - t) / np.maximum(L, 1e-6), 0, 1)
    hi = lin * knee
    acc = np.zeros_like(lin)
    for r, wgt in zip(LOOK['bloom_radii'], LOOK['bloom_weights']):
        acc += blur(hi, r * scale) * wgt
    out = lin + acc * LOOK['bloom_strength'] / max(sum(LOOK['bloom_weights']), 1e-6) * 5.0
    if LOOK.get('haze', 0) > 0:
        out = out + blur(np.minimum(lin, 8.0), LOOK['haze_radius'] * scale) * LOOK['haze']
    return out


def display(lin):
    b = to_buf(np.clip(lin, 0, None))
    look = LOOK['agx_look']
    r = ImageBufAlgo.ociodisplay(b, 'sRGB', 'AgX', 'Linear Rec.709', looks=look if look else '',
                                 colorconfig=OCIO_CFG)
    if r.has_error:
        raise RuntimeError(r.geterror())
    return r.get_pixels(oiio.FLOAT)[..., :3]


def grade(lin, scale):
    x = lin * (2.0 ** LOOK['exposure']) * np.array(LOOK['wb'], np.float32)
    x = bloom(x, scale)
    d = display(x)
    L = lum(d)[..., None]
    d = d + np.array(LOOK['shadow_tint'], np.float32) * (1 - L) ** 2 + np.array(LOOK['highlight_tint'], np.float32) * L ** 2
    if LOOK['vignette'] > 0:
        h, w = d.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        rr = ((xx / w - 0.5) ** 2 * 1.2 + (yy / h - 0.5) ** 2 * 1.6)
        d = d * (1 - LOOK['vignette'] * np.clip(rr * 2.2, 0, 1) ** 1.5)[..., None]
    return np.clip(d, 0, 1)


def write(a, path, quality=82, alpha=None):
    if alpha is not None:
        a = np.concatenate([a, alpha], axis=-1)
    a = np.clip(a, 0, 1)
    spec = ImageSpec(a.shape[1], a.shape[0], a.shape[2], oiio.UINT8)
    if path.endswith('.webp'):
        spec.attribute('compression', f'webp:{quality}')
    b = ImageBuf(spec)
    b.set_pixels(ROI(0, a.shape[1], 0, a.shape[0], 0, 1, 0, a.shape[2]), a.astype(np.float32))
    ok = b.write(path)
    if not ok:
        raise RuntimeError(b.geterror())
    return path


def dilate_colour(rgb, mask, iters=3):
    """Replace colours at soft mask edges by colours from fully covered neighbours (reduces halos
    of the background at the fg silhouette when the fg is laid over the character)."""
    out = rgb.copy()
    m = (mask[..., 0] > 0.98).astype(np.float32)
    cur = out * m[..., None]
    wsum = m.copy()
    for _ in range(iters):
        acc = np.zeros_like(cur); ws = np.zeros_like(wsum)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += np.roll(np.roll(cur, dy, 0), dx, 1)
                ws += np.roll(np.roll(wsum, dy, 0), dx, 1)
        fill = (wsum < 0.5) & (ws > 0)
        cur[fill] = acc[fill] / ws[fill][:, None]
        wsum = np.where(fill, 1.0, wsum)
    edge = (mask[..., 0] > 0.001) & (mask[..., 0] <= 0.98) & (wsum > 0.5)
    out[edge] = cur[edge]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--exr', required=True)
    ap.add_argument('--publish', default=None)
    ap.add_argument('--sizes', default=None, help='default 2560,1920,1280 (desktop) / 1080,720 (mobile)')
    ap.add_argument('--quality', type=int, default=82)
    ap.add_argument('--preview-only', action='store_true', help='write only a 1672x941 PNG comparison plate')
    ap.add_argument('--look', default=None, help='JSON dict overriding LOOK keys')
    a = ap.parse_args()
    if a.look:
        LOOK.update(json.loads(a.look))
    L, names = read_layers(a.exr)
    rgb = L['rgb']
    for g, gain in LOOK.get('group_gain', {}).items():
        if g in L and gain != 1.0:
            rgb = rgb + (gain - 1.0) * L[g]
            L[g] = L[g] * gain
    H, W = rgb.shape[:2]
    scale = W / 2560.0
    base = os.path.splitext(a.exr)[0]
    plate = grade(rgb, scale)
    # comparison-size PNG of the reference framing (ref4 is 1672x941); with a safe margin the reference
    # frame is anchors.refFrame inside the plate
    anc_src = base + '_anchors.json'
    if H > W:   # mobile portrait: no reference framing, write a small preview at native aspect
        write(resize(plate, 540, int(round(540 * H / W))), base + '_plate_540.png')
        if a.preview_only:
            print('preview', base + '_plate_540.png'); return
    rf = (json.load(open(anc_src)).get('refFrame') if os.path.exists(anc_src) else None) or dict(x=0, y=0, w=1, h=1)
    x0, y0 = int(round(rf['x'] * W)), int(round(rf['y'] * H))
    x1, y1 = int(round((rf['x'] + rf['w']) * W)), int(round((rf['y'] + rf['h']) * H))
    write(resize(np.ascontiguousarray(plate[y0:y1, x0:x1]), 1672, 941), base + '_plate_1672.png')
    write(resize(plate, 1672, 941), base + '_plate_full_1672.png')
    if a.preview_only:
        print('preview', base + '_plate_1672.png'); return
    out_dir = os.path.dirname(a.exr)
    anc = json.load(open(anc_src)) if os.path.exists(anc_src) else {}
    mobile = H > W
    pre = 'mobile-' if mobile else ''
    sizes = [int(s) for s in (a.sizes or ('1080,720' if mobile else '2560,1920,1280')).split(',')]
    mask = np.clip(L['fgmask'], 0, 1) if 'fgmask' in L else np.zeros((H, W, 1), np.float32)
    fg_rgb = dilate_colour(plate, mask)
    layers = {'plate': (plate, None), 'fg': (fg_rgb, mask)}
    for g in ('neon', 'emitter', 'under'):
        if g in L:
            k = LOOK['glow_boost'][g]
            boosted = grade(rgb + L[g] * k, scale)
            delta = np.clip(boosted - plate, 0, 1)
            if g == 'emitter':
                # keep the emitter pulse on the fg (pedestal) + a soft margin for its bloom
                soft = blur(mask, 12 * scale)
                delta = delta * np.clip(soft * 3, 0, 1)
            layers['glow-' + g] = (delta, None)
    written = []
    # pre-blurred small plate for frosted-glass UI panels (align to the plate, scale up in CSS)
    bw = 360 if mobile else 640; bh = int(round(bw * H / W))
    pb = blur(resize(plate, bw, bh), 10 * bw / 640)
    p = os.path.join(out_dir, f'{pre}plate-blur-{bw}.webp'); write(pb, p, 70); written.append(p)
    for name, (img, alpha) in layers.items():
        for sw in sizes:
            sh = int(round(sw * H / W))
            im = img if sw == W else resize(img, sw, sh)
            al = None if alpha is None else (alpha if sw == W else resize(np.ascontiguousarray(alpha), sw, sh))
            p = os.path.join(out_dir, f'{pre}{name}-{sw}.webp')
            write(im, p, a.quality, al)
            written.append(p)
    # anchors
    fl = lambda n: [f'{pre}{n}-{s}.webp' for s in sizes]
    anc['post'] = dict(look=LOOK, script='scripts/blender/consult_post.py')
    anc['files'] = dict(
        plate=dict(files=fl('plate'), z=0, blend='normal', note='full room incl. pedestal + books, opaque'),
        glow_neon=dict(files=fl('glow-neon'), z=0.5, blend='plus-lighter (fallback screen)',
                       note='boost of ceiling halo, wall strips, coves and tier LEDs; animate opacity 0..1 '
                            '(0 = plate as rendered, 1 = LEDs x%.1f)' % (1 + LOOK['glow_boost']['neon'])),
        character=dict(z=1, note='SVG body (anchors.character)'),
        fg=dict(files=fl('fg'), z=2, blend='normal',
                note='RGBA: pedestal (copper band, glass top, rim, under-glow ring, base) + book stack, tray and ledge'),
        glow_under=dict(files=fl('glow-under'), z=2.5, blend='plus-lighter (fallback screen)',
                        note='boost of the pedestal under-glow ring and its floor spill; animate opacity 0..1'),
        character_hand=dict(z=3, note='SVG resting hand group (anchors.character.restingHand)'),
        glow_emitter=dict(files=fl('glow-emitter'), z=3.5, blend='plus-lighter (fallback screen)',
                          note='boost of the blue emitter rim + inlaid glass rings (masked to the pedestal); '
                               'animate opacity 0..1'),
        hologram=dict(z=4, note='code-built; base = anchors.ellipses.hologram_base / points.emitter_centre'),
        text=dict(z=5, note='HTML overlays on anchors.surfaces / anchors.curves'),
        plate_blur=dict(files=[f'{pre}plate-blur-{bw}.webp'], note='pre-blurred plate for frosted UI panels'))
    anc_name = 'anchors-mobile.json' if mobile else 'anchors.json'
    with open(os.path.join(out_dir, anc_name), 'w') as fh:
        json.dump(anc, fh, indent=1)
    if a.publish:
        os.makedirs(a.publish, exist_ok=True)
        for p in written + [os.path.join(out_dir, anc_name)]:
            shutil.copy2(p, os.path.join(a.publish, os.path.basename(p)))
    for p in written:
        print(p, os.path.getsize(p))


if __name__ == '__main__':
    main()
