"""Evia 'living room' masks: EXR from `--passes masks` (mask_passes.py) -> published lossless WebP masks + anchors.

Runs with Blender's bundled Python (numpy + OpenImageIO), no bpy:

  PY=/Applications/Blender.app/Contents/Resources/4.5/python/bin/python3.11
  $PY scripts/blender/mask_post.py publish <out>/home_masks.exr --out public/env/lounge --prefix home- \
      --sizes 2560,1280 --pairs-with home-2560.webp --anchors public/env/lounge/anchors.json \
      [--src-prefix /env/lounge/] [--depth 1280 | --depth-existing home-depth-1280.webp] \
      [--plate public/env/lounge/home-1280.webp --overlays <dir> --tag lounge-home]

  --pairs-with   the plate (in --out) the masks pair with; its -<w>.webp siblings must have exactly the mask size
  --anchors      merged in place: top-level `masks`, `lights`, `strips`, `plants`, plus points/ellipses `lamp_<name>`
                 (re-run after re-publishing the plate, which rewrites the anchors file)
  --src-prefix   prefix for the srcs written into the anchors (the strip's anchors live in another folder)
  --depth W      also write <prefix>depth-W.webp from the mist pass; --depth-existing lists one the plate already has
  --layer NAME=FILE  also list an existing picture layer of the plate (glow delta / dim plate), e.g.
                 --layer glow=home-glow-2560.webp --layer dim=home-dim-2560.webp (widths found among --sizes)
  --plate/--overlays/--tag   verification: overlay PNGs of every mask on the plate + an edge-alignment score

Every mask has the plate's exact pixel grid (same camera, framing incl. the safe margins, size), so normalised
anchor coordinates are shared. All masks are 8-bit RGB, LOSSLESS WebP (exact values; ids are integers / 255).
Channel layout (value v in 0..1 = byte / 255):

  mask-plants   R leaf/stem coverage (anti-aliased, depth-of-field soft like the plate)
                G sway weight: (distance from the plant's base / camera depth of the base) / swayScale, i.e. 0 at the
                  pot .. 1 at the scene's most mobile leaf tip, so ONE amplitude in px moves near/big plants more
                  than far/small ones and tips more than inner leaves (screen-space consistent); feathered outward
                  past the silhouette (to 0 at `featherPx`) so a displacement driven by it moves the leaf edge with
                  the leaf instead of tearing it
                B plant id / 255 (anchors.plants[].id), nearest plant inside the feather zone, 0 elsewhere
  mask-sky      R=G=B open sky (camera ray escapes to the sky through the glass; hero: the daylight backdrop)
  mask-glass    R=G=B window glass seen directly (whatever is behind it)
  mask-windows  R lit city windows (and street lights), weighted by their haze visibility (far = fainter)
                G per-window random id 0..1 (constant over one window: twinkle each window on its own phase)
                B city coverage (blocks, ground, street lights): the skyline silhouette
  mask-lamps    R lamp fixture coverage (globes, candle, downlights, pendant, aviation beacons)
                G lamp id / 255 (anchors.lights[].id) over the fixture AND its halo zone
                B halo weight: 1 at the lamp centre .. 0 at `haloScale` x the fixture radius (for flicker spill)
  mask-coves    R LED strip / cove / ring coverage (the emitting tubes seen by the camera)
                G distance along that strip 0..1 (anchors.strips[].lengthM gives metres), carried outward to
                  `zonePx` (nearest strip) so the plate's glow around a strip can take a travelling pulse
                B strip id / 255 (anchors.strips[].id), same zone
  mask-emitter  (consult) R emitter rim + inlaid glass rings intensity
                G angle around the pedestal axis 0..1, B radius / pedestal radius 0..1 (both over the whole glass top
                  and rim; 0 outside) -> ripples/rotations on the glass
  depth         R=G=B mist depth, linear between the scene's mist start and start+depth (lossy WebP, like the
                existing home-depth); written only with --depth
"""
import os
import sys
import json
import numpy as np
import OpenImageIO as oiio

EPS = 1e-6


# ----------------------------------------------------------------------------- io
def read_exr(path):
    b = oiio.ImageBuf(path)
    s = b.spec()
    px = np.asarray(b.get_pixels(oiio.FLOAT)).reshape(s.height, s.width, s.nchannels)
    ch = {}
    for i, n in enumerate(s.channelnames):
        parts = n.split('.')
        key = parts[-2] if len(parts) >= 3 else parts[-1]
        if parts[-2:] == ['Combined', 'A'] or n.endswith('Combined.A'):
            key = 'alpha'
        elif len(parts) >= 2 and parts[-2] == 'Combined':
            continue
        elif len(parts) >= 2 and parts[-2] == 'Mist':
            key = 'mist'
        ch[key] = px[..., i].astype(np.float64)
    return ch, s.width, s.height


def read_img(path):
    b = oiio.ImageBuf(path)
    s = b.spec()
    return np.asarray(b.get_pixels(oiio.FLOAT)).reshape(s.height, s.width, s.nchannels)


def write_webp(path, rgb, lossless=True, quality=90):
    """rgb: float 0..1 (H,W,3) -> 8-bit WebP (rounded to the nearest code value)."""
    u8 = np.clip(np.round(np.asarray(rgb) * 255.0), 0, 255).astype(np.uint8)
    h, w, c = u8.shape
    spec = oiio.ImageSpec(w, h, c, oiio.UINT8)
    spec.attribute('compression', 'lossless' if lossless else f'webp:{quality}')
    o = oiio.ImageOutput.create(path)
    o.open(path, spec)
    o.write_image(np.ascontiguousarray(u8))
    o.close()
    if lossless:
        back = np.round(read_img(path) * 255).astype(np.uint8)
        assert back.shape == u8.shape and np.array_equal(back, u8), f'lossless round trip failed: {path}'
    return os.path.getsize(path)


def write_png(path, rgb):
    u8 = np.clip(np.round(np.asarray(rgb) * 255.0), 0, 255).astype(np.uint8)
    h, w, c = u8.shape
    o = oiio.ImageOutput.create(path)
    o.open(path, oiio.ImageSpec(w, h, c, oiio.UINT8))
    o.write_image(np.ascontiguousarray(u8))
    o.close()


# ----------------------------------------------------------------------------- resampling
def _area_matrix(n_src, n_dst):
    """Exact area-average (box) resampling matrix n_dst x n_src."""
    f = n_src / n_dst
    M = np.zeros((n_dst, n_src))
    for j in range(n_dst):
        a, b = j * f, (j + 1) * f
        i0, i1 = int(np.floor(a)), int(np.ceil(b))
        for i in range(i0, min(i1, n_src)):
            M[j, i] = max(0.0, min(b, i + 1) - max(a, i))
        M[j] /= M[j].sum()
    return M


def downscale(img, w, h):
    """Area-average an (H,W) or (H,W,C) array to (h,w). Premultiplied (coverage-weighted) values stay correct."""
    H, W = img.shape[:2]
    if (W, H) == (w, h):
        return img.copy()
    if W % w == 0 and H % h == 0 and W // w == H // h:
        k = W // w
        sh = (h, k, w, k) + img.shape[2:]
        return img.reshape(sh).mean(axis=(1, 3))
    My, Mx = _area_matrix(H, h), _area_matrix(W, w)
    if img.ndim == 2:
        return My @ img @ Mx.T
    return np.stack([My @ img[..., c] @ Mx.T for c in range(img.shape[2])], -1)


# ----------------------------------------------------------------------------- fields
_DIRS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def _shift(a, dy, dx, fill=0):
    out = np.full_like(a, fill)
    H, W = a.shape[:2]
    ys, yd = (slice(0, H - dy), slice(dy, H)) if dy >= 0 else (slice(-dy, H), slice(0, H + dy))
    xs, xd = (slice(0, W - dx), slice(dx, W)) if dx >= 0 else (slice(-dx, W), slice(0, W + dx))
    out[yd, xd] = a[ys, xs]
    return out


def propagate(vals, valid, R):
    """Nearest-valid fill: pixels within R steps (8-connected rings) of a valid pixel take its values.
    Returns (vals, dist) with dist 0 on valid pixels, 1..R in the zone, R+1 outside."""
    out = vals.copy()
    cur = valid.copy()
    dist = np.where(valid, 0, R + 1).astype(np.int32)
    for d in range(1, R + 1):
        got = np.zeros_like(cur)
        newv = np.zeros_like(out)
        for dy, dx in _DIRS:
            src = _shift(cur, dy, dx, False)
            cand = src & ~cur & ~got
            if cand.any():
                sv = _shift(out, dy, dx)
                newv[cand] = sv[cand]
                got |= cand
        if not got.any():
            break
        out[got] = newv[got]
        dist[got] = d
        cur |= got
    return out, dist


def smooth_fall(t):
    t = np.clip(t, 0, 1)
    return 1 - t * t * (3 - 2 * t)


def unpremult(v, cov, thr=0.01):
    return np.where(cov > thr, v / np.maximum(cov, EPS), 0.0)


# ----------------------------------------------------------------------------- masks at one size
def build_masks(C, w, h, info, lights):
    """C: premultiplied channels at this size (dict of (h,w) arrays). Returns {name: (h,w,3) float} and params."""
    long_side = max(w, h)
    out, params = {}, {}
    g = lambda k: C.get(k, np.zeros((h, w)))

    cov = np.clip(g('evm_plant'), 0, 1)
    if cov.max() > 0.02:
        sway = np.clip(unpremult(g('evm_plant_sway'), cov, 0.005), 0, 1)
        pid = np.round(unpremult(g('evm_plant_id'), cov, 0.005) * 255) / 255
        valid = cov > 0.02
        R = max(2, int(round(0.004 * long_side)))
        vals, dist = propagate(np.stack([sway, pid], -1), valid, R)
        fall = np.where(dist == 0, 1.0, smooth_fall(dist / (R + 1.0)))
        fall[dist > R] = 0
        G = vals[..., 0] * fall
        B = np.where(dist <= R, vals[..., 1], 0)
        out['plants'] = np.stack([cov, G, B], -1)
        params['plants'] = dict(featherPx=R)

    sky = np.clip(1 - g('alpha') + g('evm_sky'), 0, 1)
    if sky.max() > 0.02:
        out['sky'] = np.repeat(sky[..., None], 3, -1)
    glass = np.clip(g('evm_glass'), 0, 1)
    if glass.max() > 0.02:
        out['glass'] = np.repeat(glass[..., None], 3, -1)

    on = g('evm_win_on')
    if on.max() > 0.005:
        R_ = np.clip(g('evm_win'), 0, 1)
        G = np.clip(unpremult(g('evm_win_idp'), on, 0.004), 0, 1)
        B = np.clip(g('evm_city'), 0, 1)
        out['windows'] = np.stack([R_, G, B], -1)

    lc = np.clip(g('evm_lamp'), 0, 1)
    if lc.max() > 0.004 and lights:
        lid = np.round(unpremult(g('evm_lamp_id'), lc, 0.004) * 255)
        ys, xs = np.mgrid[0:h, 0:w]
        halo = np.zeros((h, w))
        hid = np.zeros((h, w))
        scale = 4.0
        for L in lights:
            rpx = max(L.get('rx', 0) * w, L.get('ry', 0) * h, 0.75)
            Rh = max(scale * rpx, 3.0)
            d = np.hypot(xs + 0.5 - L['cx'] * w, ys + 0.5 - L['cy'] * h) / Rh
            wgt = smooth_fall(d)
            take = wgt > halo
            halo = np.where(take, wgt, halo)
            hid = np.where(take & (wgt > 0), L['id'], hid)
        G = np.where(lc > 0.004, lid, hid) / 255.0
        out['lamps'] = np.stack([lc, G, halo], -1)
        params['lamps'] = dict(haloScale=scale)

    sc = np.clip(g('evm_strip'), 0, 1)
    if sc.max() > 0.02:
        along = np.clip(unpremult(g('evm_strip_along'), sc, 0.02), 0, 1)
        sid = np.round(unpremult(g('evm_strip_id'), sc, 0.02) * 255) / 255
        R = max(3, int(round(0.012 * long_side)))
        vals, dist = propagate(np.stack([along, sid], -1), sc > 0.02, R)
        inz = dist <= R
        out['coves'] = np.stack([sc, np.where(inz, vals[..., 0], 0), np.where(inz, vals[..., 1], 0)], -1)
        params['coves'] = dict(zonePx=R)

    ec = g('evm_emit_cov')
    if ec.max() > 0.02:
        R_ = np.clip(g('evm_emit'), 0, 1)
        G = np.clip(unpremult(g('evm_emit_ang'), ec, 0.02), 0, 1)
        B = np.clip(unpremult(g('evm_emit_r'), ec, 0.02), 0, 1)
        out['emitter'] = np.stack([R_, G, B], -1)
    return out, params


# ----------------------------------------------------------------------------- lamp statistics
def lamp_stats(C, W, H, lamps):
    lc = np.clip(C.get('evm_lamp', np.zeros((H, W))), 0, 1)
    lid = np.round(unpremult(C.get('evm_lamp_id', np.zeros((H, W))), lc, 0.004) * 255).astype(int)
    ys, xs = np.mgrid[0:H, 0:W]
    res = []
    for L in lamps:
        m = (lid == L['id']) & (lc > 0.004)
        area = float((lc * m).sum())
        d = dict(L)
        if area <= 0:
            d['visible'] = 0.0
            res.append(d)
            continue
        wsum = (lc * m)
        cx = float((wsum * (xs + 0.5)).sum() / area) / W
        cy = float((wsum * (ys + 0.5)).sum() / area) / H
        yy, xx = np.nonzero(m & (lc > 0.1)) if (m & (lc > 0.1)).any() else np.nonzero(m)
        box = [round(xx.min() / W, 5), round(yy.min() / H, 5), round((xx.max() + 1) / W, 5), round((yy.max() + 1) / H, 5)]
        exp = np.pi * max(L.get('rx', 0) * W, 0.5) * max(L.get('ry', 0) * H, 0.5)
        d['visible'] = round(min(1.0, area / max(exp, EPS)), 3)
        d['maskCentre'] = [round(cx, 5), round(cy, 5)]
        d['maskBox'] = box
        d['maskAreaPx'] = round(area, 1)
        res.append(d)
    return res


# ----------------------------------------------------------------------------- verification helpers
def lum(img):
    return img[..., :3] @ np.array([0.2126, 0.7152, 0.0722]) if img.ndim == 3 else img


def grad(a):
    gx = np.zeros_like(a)
    gy = np.zeros_like(a)
    gx[:, 1:-1] = a[:, 2:] - a[:, :-2]
    gy[1:-1] = a[2:] - a[:-2]
    return np.hypot(gx, gy)


def alignment(plate, mask, rng=3, region=None):
    """Best integer shift (dx, dy) of the mask's edges against the plate's edges (normalised cross-correlation of
    gradient magnitudes, restricted to a band around the mask's edges). (0, 0) = pixel-aligned."""
    gp = grad(lum(plate))
    gm = grad(mask)
    band = gm > 0.05
    if region is not None:
        band &= region
    if band.sum() < 50:
        return None
    best, scores = None, {}
    for dy in range(-rng, rng + 1):
        for dx in range(-rng, rng + 1):
            sm = _shift(gm, dy, dx)
            sb = _shift(band.astype(float), dy, dx) > 0
            a, b = gp[sb], sm[sb]
            a = a - a.mean()
            b = b - b.mean()
            sc = float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + EPS))
            scores[(dx, dy)] = sc
            if best is None or sc > scores[best]:
                best = (dx, dy)
    return dict(best=list(best), score=round(scores[best], 3), at0=round(scores[(0, 0)], 3))


def hue(t):
    t = np.asarray(t)
    r = np.clip(np.abs(t * 6 - 3) - 1, 0, 1)
    g = np.clip(2 - np.abs(t * 6 - 2), 0, 1)
    b = np.clip(2 - np.abs(t * 6 - 4), 0, 1)
    return np.stack([r, g, b], -1)


def overlays(plate, masks, lights, strips, out_dir, tag):
    os.makedirs(out_dir, exist_ok=True)
    base = plate[..., :3] * 0.45
    written = []
    for name, m in masks.items():
        if name == 'depth':
            continue
        R, G, B = m[..., 0], m[..., 1], m[..., 2]
        if name == 'plants':
            col = base * (1 - R[..., None] * 0.6) + R[..., None] * np.array([0.1, 1.0, 0.2]) * 0.8
            write_png(os.path.join(out_dir, f'{tag}-plants.png'), col)
            sw = base * 0.6 + hue(G * 0.66)[..., ::-1] * (G > 0)[..., None] * 0.7
            write_png(os.path.join(out_dir, f'{tag}-plants-sway.png'), sw)
            written += [f'{tag}-plants.png', f'{tag}-plants-sway.png']
        elif name in ('sky', 'glass'):
            tint = np.array([0.2, 0.5, 1.0]) if name == 'sky' else np.array([0.2, 1.0, 1.0])
            col = base + R[..., None] * tint * 0.55
            write_png(os.path.join(out_dir, f'{tag}-{name}.png'), col)
            written.append(f'{tag}-{name}.png')
        elif name == 'windows':
            col = base * (1 - 0.3 * B[..., None]) + B[..., None] * np.array([0.05, 0.05, 0.25]) + \
                (R > 0.02)[..., None] * hue(G) * np.clip(R * 3, 0, 1)[..., None]
            write_png(os.path.join(out_dir, f'{tag}-windows.png'), col)
            written.append(f'{tag}-windows.png')
        elif name == 'lamps':
            col = base + B[..., None] * np.array([0.5, 0.2, 0.0]) + R[..., None] * np.array([1.0, 0.1, 0.1])
            write_png(os.path.join(out_dir, f'{tag}-lamps.png'), col)
            written.append(f'{tag}-lamps.png')
        elif name == 'coves':
            zone = (B > 0)[..., None]
            col = base + zone * hue(G) * 0.18 + R[..., None] * hue(G) * 0.9
            write_png(os.path.join(out_dir, f'{tag}-coves.png'), col)
            written.append(f'{tag}-coves.png')
        elif name == 'emitter':
            reg = (B > 0)[..., None]
            col = base + reg * hue(G) * 0.35 + R[..., None] * np.array([1, 1, 1]) * 0.6
            write_png(os.path.join(out_dir, f'{tag}-emitter.png'), col)
            written.append(f'{tag}-emitter.png')
    return written


# ----------------------------------------------------------------------------- anchors
MASK_DOC = {
    'plants': dict(r='leaf/stem coverage', g='screen-space sway weight: (distance from the plant base / its camera '
                   'depth) / swayScale; 0 at the pot .. 1 at the most mobile leaf tip in the scene; feathered to 0 at '
                   'featherPx outside the silhouette', b='plant id / 255 (plants[].id), 0 outside the feather zone'),
    'sky': dict(r='open sky coverage (R=G=B)'),
    'glass': dict(r='window glass seen directly (R=G=B)'),
    'windows': dict(r='lit city windows / street lights, weighted by haze visibility', g='per-window random id 0..1',
                    b='city coverage (skyline silhouette)'),
    'lamps': dict(r='lamp fixture coverage', g='lamp id / 255 (lights[].id) on the fixture and its halo zone',
                  b='halo weight 1 (centre) .. 0 (haloScale x fixture radius)'),
    'coves': dict(r='LED strip / cove coverage', g='distance along the strip 0..1 (strips[].lengthM), carried to zonePx',
                  b='strip id / 255 (strips[].id), same zone'),
    'emitter': dict(r='emitter rim + inlaid ring intensity', g='angle around the pedestal axis 0..1 (0.5 = +X, '
                    'counter-clockwise from above)', b='radius / pedestal radius 0..1; 0 outside the glass top'),
    'depth': dict(r='mist depth (R=G=B), linear'),
    'glow': dict(note='a PICTURE layer, not a data map: display-space glow delta (plate - dim) of the LED/lamp light '
                      'group, reflections included; draw it over the dim plate with mix-blend-mode plus-lighter and '
                      'animate its opacity ~0.6..1 to breathe (1 = the plate as rendered)'),
    'dim': dict(note='a PICTURE layer: the plate with the LED/lamp light group at 45 %, the base for breathing'),
}


def update_anchors(path, prefix, src_prefix, files, params, info, lights, strips, plants, depth_note, plate=None):
    A = json.load(open(path))
    masks = {'_doc': 'Living-room masks for animating the plate (scripts/blender/mask_passes.py + mask_post.py). '
                     'Same pixel grid as the plate (normalised coordinates are shared). Data maps, NOT plates: '
                     'never stack them as pictures. Lossless 8-bit WebP (value = byte / 255, ids exact); depth is '
                     'lossy. See the room README.'}
    if plate:
        masks['plate'] = plate
    for name, fl in files.items():
        ws = sorted(fl)
        e = dict(src=src_prefix + fl[ws[-1]], widths=ws, lossless=(name not in ('depth', 'glow', 'dim')))
        e.update(MASK_DOC.get(name, {}))
        if name in params:
            e.update({k: v for k, v in params[name].items()})
        if name == 'depth':
            e['note'] = depth_note
        if name == 'plants' and 'swayScale' in info:
            e['swayScale'] = info['swayScale']
        masks[name] = e
    A['masks'] = masks
    A['lights'] = lights
    A['strips'] = strips
    A['plants'] = plants
    pts = A.setdefault('points', {})
    ell = A.setdefault('ellipses', {})
    for k in [k for k in pts if k.startswith('lamp_')]:
        pts.pop(k)
    for k in [k for k in ell if k.startswith('lamp_')]:
        ell.pop(k)
    for L in lights:
        if L['kind'] == 'beacon':
            continue
        pts['lamp_' + L['name']] = [L['cx'], L['cy']]
        if 'rx' in L:
            ell['lamp_' + L['name']] = dict(cx=L['cx'], cy=L['cy'], rx=L['rx'], ry=L['ry'])
    with open(path, 'w') as fh:
        json.dump(A, fh, indent=1)


# ----------------------------------------------------------------------------- main
def arg(args, k, default=None):
    return args[args.index(k) + 1] if k in args else default


def main():
    if len(sys.argv) < 3 or sys.argv[1] != 'publish':
        print(__doc__)
        sys.exit(1)
    exr = sys.argv[2]
    args = sys.argv[3:]
    out_dir = arg(args, '--out')
    prefix = arg(args, '--prefix', '')
    sizes = [int(v) for v in arg(args, '--sizes').split(',')]
    anchors = arg(args, '--anchors')
    src_prefix = arg(args, '--src-prefix', '')
    depth_w = int(arg(args, '--depth', '0'))
    plate_p = arg(args, '--plate')
    ov_dir = arg(args, '--overlays')
    tag = arg(args, '--tag', prefix.strip('-') or 'room')
    pairs = arg(args, '--pairs-with')      # the plate these masks pair with, e.g. home-2560.webp (in --out)
    info = json.load(open(exr.replace('_masks.exr', '_masks.json')))
    C, W, H = read_exr(exr)
    os.makedirs(out_dir, exist_ok=True)
    report = dict(exr=os.path.basename(exr), size=[W, H], files={}, alignment={})

    # lamps: projected geometry + measured visibility (full resolution)
    lamps = lamp_stats(C, W, H, info.get('lamps', []))
    lights = []
    for L in lamps:
        if not L.get('inFrame') or L.get('visible', 0) < 0.02:
            continue
        d = {k: L[k] for k in ('id', 'name', 'kind', 'motion', 'cx', 'cy', 'rx', 'ry', 'depthM', 'radiusM',
                               'visible', 'maskCentre', 'maskBox') if k in L}
        if L.get('tempK'):
            d['tempK'] = L['tempK']
        lights.append(d)
    strips = []
    sc_full = np.clip(C.get('evm_strip', np.zeros((H, W))), 0, 1)
    sid_full = np.round(unpremult(C.get('evm_strip_id', np.zeros((H, W))), sc_full, 0.02) * 255).astype(int)
    for S in info.get('strips', []):
        m = (sid_full == S['id']) & (sc_full > 0.02)
        if not m.any():
            continue
        yy, xx = np.nonzero(m)
        d = {k: S[k] for k in ('id', 'name', 'kind', 'group', 'lengthM', 'shape', 'depthM') if k in S}
        d['maskBox'] = [round(xx.min() / W, 5), round(yy.min() / H, 5), round((xx.max() + 1) / W, 5),
                        round((yy.max() + 1) / H, 5)]
        d['maskAreaPx'] = int(m.sum())
        strips.append(d)
    pl_cov = np.clip(C.get('evm_plant', np.zeros((H, W))), 0, 1)
    pl_id = np.round(unpremult(C.get('evm_plant_id', np.zeros((H, W))), pl_cov, 0.02) * 255).astype(int)
    plants = []
    for P in info.get('plants', []):
        m = (pl_id == P['id']) & (pl_cov > 0.02)
        if not m.any():
            continue
        d = {k: P[k] for k in ('id', 'name', 'kind', 'base', 'tip', 'reachM', 'depthM', 'tipWeight') if k in P}
        yy, xx = np.nonzero(m)
        d['maskBox'] = [round(xx.min() / W, 5), round(yy.min() / H, 5), round((xx.max() + 1) / W, 5),
                        round((yy.max() + 1) / H, 5)]
        plants.append(d)

    files, params_all = {}, {}
    by_size = {}
    for sw in sizes:
        sh = int(round(H * sw / W))
        if pairs:
            import re
            pp = os.path.join(out_dir, re.sub(r'-\d+\.webp$', f'-{sw}.webp', pairs))
            spec = oiio.ImageInput.open(pp).spec()
            if (spec.width, spec.height) != (sw, sh):
                raise SystemExit(f'{pp} is {spec.width}x{spec.height}, masks would be {sw}x{sh}')
            report.setdefault('pairedPlates', []).append(os.path.basename(pp))
        Cs = {k: downscale(v, sw, sh) for k, v in C.items() if k != 'mist'}
        masks, params = build_masks(Cs, sw, sh, info, lights)
        for name, img in masks.items():
            fn = f'{prefix}mask-{name}-{sw}.webp'
            report['files'][fn] = write_webp(os.path.join(out_dir, fn), img)
            files.setdefault(name, {})[sw] = fn
            if name in params:
                params_all.setdefault(name, {})
                for k, v in params[name].items():
                    params_all[name].setdefault(k + 'At', {})[str(sw)] = v
        by_size[sw] = masks
    depth_note = None
    if depth_w and 'mist' in C:
        dh = int(round(H * depth_w / W))
        d = np.clip(downscale(C['mist'], depth_w, dh), 0, 1)
        fn = f'{prefix}depth-{depth_w}.webp'
        report['files'][fn] = write_webp(os.path.join(out_dir, fn), np.repeat(d[..., None], 3, -1), lossless=False,
                                         quality=90)
        files['depth'] = {depth_w: fn}
        m0, md = info['mist']
        depth_note = f'0 = {m0} m .. 1 = {m0 + md} m from the camera (linear mist pass of the mask render)'
        report['depth'] = depth_note
    if arg(args, '--depth-existing'):
        # a depth map the plate's own publish already wrote (lounge: <prefix>depth-<w>.webp from the beauty mist)
        fn = arg(args, '--depth-existing')
        spec = oiio.ImageInput.open(os.path.join(out_dir, fn)).spec()
        import re
        files['depth'] = {spec.width: fn}
        m0, md = info['mist']
        depth_note = (f'0 = {m0} m .. 1 = {m0 + md} m from the camera (linear mist pass of the beauty render, '
                      f'published with the plate)')
    if 'lamps' in params_all:
        params_all['lamps'] = {'haloScale': 4.0}
    # picture layers the plate's own publish wrote (glow delta / dim plate for breathing), listed for discovery
    import re
    for spec_ in [args[i + 1] for i, a in enumerate(args) if a == '--layer']:
        lname, lfile = spec_.split('=', 1)
        have = {}
        for sw in sizes:
            fn = re.sub(r'-\d+\.webp$', f'-{sw}.webp', lfile)
            if os.path.exists(os.path.join(out_dir, fn)):
                have[sw] = fn
        if have:
            files[lname] = have

    if anchors:
        update_anchors(anchors, prefix, src_prefix, files, params_all, info, lights, strips, plants, depth_note,
                       (src_prefix + pairs) if pairs else None)
        report['anchors'] = anchors
    report['lights'] = [(L['id'], L['name'], L['kind'], L['visible']) for L in lights]
    report['strips'] = [(S['id'], S['name']) for S in strips]
    report['plants'] = [(P['id'], P['name']) for P in plants]

    if plate_p:
        plate = read_img(plate_p)[..., :3]
        ph, pw = plate.shape[:2]
        masks_small = by_size.get(pw)
        if masks_small is None or next(iter(masks_small.values())).shape[:2] != (ph, pw):
            raise SystemExit(f'plate {pw}x{ph} matches none of the mask sizes {sizes}')
        for name, m in masks_small.items():
            src = m[..., 0]
            report['alignment'][name] = alignment(plate, src)
        if ov_dir:
            report['overlays'] = overlays(plate, masks_small, lights, strips, ov_dir, tag)
    print(json.dumps(report, indent=1))
    rp = os.path.join(os.path.dirname(exr), os.path.basename(exr).replace('.exr', '_publish.json'))
    with open(rp, 'w') as fh:
        json.dump(report, fh, indent=1)


if __name__ == '__main__':
    main()
