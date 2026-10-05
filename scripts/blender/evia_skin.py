"""Evia's skin: a new albedo (base CC0 MakeHuman skin + natural makeup + scalp tone), a roughness map and a
pore/detail normal map, all painted in UV space with numpy, plus the Blender look-dev skin shader.

WHY
  Every MakeHuman skin on disk is one 2K diffuse map (no roughness, no normal, no SSS). Realism has to come
  from our shading and from region-aware maps. Everything here is deterministic and derived from the base
  mesh itself (vertex groups `lips`, `scalp`, `ears`, the MPFB joint helpers for eyes / mouth), so it
  follows her face targets.

MAPS (written next to the .blend, 2048^2 PNG, MakeHuman UV layout)
  evia_skin_albedo.png     sRGB. base skin, tone-balanced to fair-neutral-warm; lips (dusty rose), soft
                           blush on the cheek apples, warm-taupe lid shadow + a soft upper lash-line,
                           a hint of warmth on nose / ears; scalp darkened toward her hair colour so
                           gaps between hair cards read as hair, not skin.
  evia_skin_rough.png      linear. 0.5 = base; T-zone / nose / lips a little shinier, cheeks softer.
  evia_skin_normal.png     linear tangent-space (OpenGL, +Y up). fine pores + micro-wrinkle noise, weaker
                           on the lips and eyelids.

SHADER (Blender only; the web gets the same maps in a MeshPhysicalMaterial)
  Principled BSDF: base = albedo, SSS weight 1 (random walk in Cycles), radius (1.0, 0.37, 0.22) * 4.2 mm,
  roughness map remapped to 0.36..0.58, specular IOR level 0.40, a 5% clear coat for the oil sheen,
  normal map strength 0.35.
"""

import math
import os

import bpy
import numpy as np

import evia_mpfb as E

SIZE = 2048

MAKEUP = {
    # i015: warmer / a touch deeper (next to ref4 she read pale, cool, porcelain) - was (0.975, 0.905, 0.865)
    "tone_gain": (0.965, 0.875, 0.825),    # sRGB multipliers after the base (fair, warm)
    "tone_lift": 0.0,
    "lips": (0.63, 0.40, 0.39),            # sRGB target colour (rose-nude; i016: less saturated, softer border -
    "lips_amount": 0.55,                   # critics read a hard vermilion outline; i014 was .60/.35/.35 @ .60)
    "lips_feather": 6,                     # px blur of the lip field before painting (i016; was the shared 3)
    "blush": (0.84, 0.50, 0.48),
    "blush_amount": 0.42,
    "lid": (0.60, 0.45, 0.44),             # rose-taupe (i016: i015's .50/.37/.34 read orange-brown on the lid)
    "lid_amount": 0.40,
    # i016: the base texture is red / orange all around the eyes (probe_rims16.py: lower rim sRGB .60/.41/.38,
    # upper lid .52/.30/.24) -> first pull the whole periocular area toward her forehead tone (luminance kept)
    "periocular_amount": 0.60,
    "liner": (0.16, 0.10, 0.085),
    "liner_amount": 0.65,
    "lowerlid": (0.80, 0.64, 0.58),        # neutralise the base texture's red lower-lid rims
    "lowerlid_amount": 0.45,
    # i010: the lid MARGINS (skin rows touching the eyeball) rendered as thick orange rims on both lids in
    # every close-up (base texture + SSS on thin geometry). Upper margin -> soft dark-brown tightline (reads as
    # lash density / natural liner, ref4 has defined eyes); lower margin -> neutral warm beige.
    "tight": (0.17, 0.105, 0.085),
    "tight_amount": 0.80,
    "waterline": (0.80, 0.64, 0.61),       # i016: neutral beige-pink (the i014 rims read orange / sore)
    "waterline_amount": 0.90,
    # i016 colour zones (critics: "barely there"): cooler, slightly deeper under-eyes; warmer forehead; faint
    # mottling + a few freckles so the skin is slightly real, not airbrushed
    "undereye": (0.70, 0.58, 0.60),
    "undereye_amount": 0.14,
    "forehead": (0.90, 0.76, 0.62),
    "forehead_amount": 0.08,
    "mottle_amount": 0.035,
    "freckle": (0.62, 0.43, 0.34),
    "freckle_amount": 0.22,
    "freckle_count": 70,
    # soft brow-powder base under the brow strands (critics: "wiry strips floating over bare skin"), fuller at
    # the head of the brow
    "brow": (0.36, 0.26, 0.21),
    "brow_amount": 0.42,
    "scalp": (0.14, 0.095, 0.075),
    "scalp_amount": 0.85,
    "warm": (0.90, 0.62, 0.56),
    "warm_amount": 0.15,
}


# ----------------------------------------------------------------------------------------------- geometry

def shaped_coords(body):
    """(N,3) object-space coordinates of the base mesh with all shape keys mixed (masks ignored)."""
    n = len(body.data.vertices)
    co = np.zeros(n * 3)
    keys = body.data.shape_keys
    if not keys:
        body.data.vertices.foreach_get("co", co)
        return co.reshape(n, 3)
    basis = keys.reference_key
    basis.data.foreach_get("co", co)
    co = co.reshape(n, 3)
    tmp = np.zeros(n * 3)
    out = co.copy()
    for kb in keys.key_blocks:
        if kb == basis or kb.mute or kb.value == 0.0:
            continue
        kb.data.foreach_get("co", tmp)
        out += (tmp.reshape(n, 3) - co) * kb.value
    return out


def group_weights(body, name):
    n = len(body.data.vertices)
    w = np.zeros(n)
    if name not in body.vertex_groups:
        return w
    gi = body.vertex_groups[name].index
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == gi:
                w[v.index] = g.weight
    return w


def group_center(body, co, name):
    w = group_weights(body, name)
    if w.sum() <= 0:
        return None
    return (co * w[:, None]).sum(axis=0) / w.sum()


def smooth_field(body, values, iters=3):
    """Mesh-neighbour smoothing of per-vertex values (edges)."""
    n = len(body.data.vertices)
    e = np.zeros(len(body.data.edges) * 2, dtype=np.int64)
    body.data.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    vals = values.astype(np.float64).copy()
    if vals.ndim == 1:
        vals = vals[:, None]
    for _ in range(iters):
        acc = np.zeros_like(vals)
        cnt = np.zeros(n)
        np.add.at(acc, e[:, 0], vals[e[:, 1]])
        np.add.at(acc, e[:, 1], vals[e[:, 0]])
        np.add.at(cnt, e[:, 0], 1)
        np.add.at(cnt, e[:, 1], 1)
        vals = 0.5 * vals + 0.5 * acc / np.maximum(cnt, 1)[:, None]
    return vals[:, 0] if values.ndim == 1 else vals


# ----------------------------------------------------------------------------------------------- raster

def rasterize(body, fields, size=SIZE, zmin=None, co=None):
    """Rasterize per-vertex fields (N,K) into UV space -> (size,size,K) + coverage mask (bottom-left origin).
    Only real body polygons (vertex group `body`); MPFB helper geometry shares the UV space."""
    mesh = body.data
    is_body = group_weights(body, "body") > 0.5
    uv = mesh.uv_layers.active.data
    k = fields.shape[1]
    img = np.zeros((size, size, k), dtype=np.float32)
    cov = np.zeros((size, size), dtype=bool)
    for poly in mesh.polygons:
        vids = list(poly.vertices)
        if not is_body[vids].all():
            continue
        if zmin is not None and co is not None and co[vids, 2].max() < zmin:
            continue
        lids = list(poly.loop_indices)
        uvs = np.array([uv[l].uv[:] for l in lids]) * (size - 1)
        vals = fields[vids]
        if not np.any(vals):
            # still mark coverage so blurs do not pull in zeros from outside the island
            pass
        for t in range(1, len(vids) - 1):
            a, b, c = uvs[0], uvs[t], uvs[t + 1]
            va, vb, vc = vals[0], vals[t], vals[t + 1]
            x0 = int(max(math.floor(min(a[0], b[0], c[0])) - 1, 0))
            x1 = int(min(math.ceil(max(a[0], b[0], c[0])) + 1, size - 1))
            y0 = int(max(math.floor(min(a[1], b[1], c[1])) - 1, 0))
            y1 = int(min(math.ceil(max(a[1], b[1], c[1])) + 1, size - 1))
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.0, np.arange(y0, y1 + 1) + 0.0)
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-9:
                continue
            l0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
            l1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
            l2 = 1.0 - l0 - l1
            eps = 0.02
            inside = (l0 >= -eps) & (l1 >= -eps) & (l2 >= -eps)
            if not inside.any():
                continue
            v = l0[..., None] * va + l1[..., None] * vb + l2[..., None] * vc
            sub = img[y0:y1 + 1, x0:x1 + 1]
            sub[inside] = v[inside]
            cov[y0:y1 + 1, x0:x1 + 1] |= inside
    return img, cov


def blur(img, radius):
    """Separable box-blur x3 (~Gaussian), channels last."""
    if radius < 1:
        return img
    out = img.astype(np.float32)
    r = int(radius)
    for _ in range(3):
        for axis in (0, 1):
            c = np.cumsum(np.pad(out, [(r + 1, r) if a == axis else (0, 0) for a in range(out.ndim)],
                                 mode="edge"), axis=axis)
            hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
            lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
            out = (hi - lo) / (2 * r + 1)
    return out


def masked_blur(img, cov, radius):
    """Blur that ignores texels outside the UV islands (no bleeding of zeros into seams)."""
    w = cov.astype(np.float32)[..., None]
    num = blur(img * w, radius)
    den = blur(w, radius)
    out = num / np.maximum(den, 1e-4)
    return np.where(den > 1e-3, out, img)


# ----------------------------------------------------------------------------------------------- fields

def makeup_fields(body):
    """Per-vertex makeup / region weights on the shaped base mesh: lips, blush, lid, liner, scalp, warm, zone."""
    co = shaped_coords(body)
    n = len(co)
    lips = smooth_field(body, group_weights(body, "lips"), 2)
    scalp = smooth_field(body, group_weights(body, "scalp"), 4)
    ears = group_weights(body, "ears")
    leye = group_center(body, co, "joint-l-eye")
    reye = group_center(body, co, "joint-r-eye")
    mouth = group_center(body, co, "joint-mouth")
    lup = group_center(body, co, "joint-l-upperlid")
    rup = group_center(body, co, "joint-r-upperlid")
    fields = {}
    fields["lips"] = np.clip(lips * 1.15, 0, 1)
    # blush: soft ellipses on the cheek apples (below / outside the eye, forward-facing skin)
    blush = np.zeros(n)
    for eye in (leye, reye):
        if eye is None:
            continue
        apex = eye + np.array([0.012 * np.sign(eye[0]), -0.004, -0.034])
        d = co - apex
        r2 = (d[:, 0] / 0.024) ** 2 + (d[:, 2] / 0.018) ** 2 + (d[:, 1] / 0.03) ** 2
        blush = np.maximum(blush, np.exp(-r2))
    front = co[:, 1] < (leye[1] + 0.06 if leye is not None else 0.0)
    fields["blush"] = blush * front
    # lid shadow: above the upper lid joint, within the orbit; liner: a thin band on the lid margin
    lid = np.zeros(n)
    liner = np.zeros(n)
    for eye, up in ((leye, lup), (reye, rup)):
        if eye is None or up is None:
            continue
        d = co - (up + np.array([0.0, 0.0, 0.004]))
        r2 = (d[:, 0] / 0.017) ** 2 + (d[:, 2] / 0.009) ** 2 + (d[:, 1] / 0.02) ** 2
        above = np.clip((co[:, 2] - (up[2] - 0.001)) / 0.003, 0, 1)
        lid = np.maximum(lid, np.exp(-r2) * above)
        d2 = co - up
        outer = np.clip(1.0 + 0.6 * (d2[:, 0] * np.sign(eye[0])) / 0.012, 0.4, 1.6)
        arc = -0.0045 * (d2[:, 0] / 0.014) ** 2          # the lid margin drops toward the corners
        r3 = (d2[:, 0] / 0.016) ** 2 + ((d2[:, 2] - arc) / 0.0022) ** 2 + (d2[:, 1] / 0.012) ** 2
        liner = np.maximum(liner, np.exp(-r3) * outer)
    fields["lid"] = lid
    fields["liner"] = np.clip(liner, 0, 1)
    low = np.zeros(n)
    for eye in (leye, reye):
        if eye is None:
            continue
        lo = group_center(body, co, "joint-%s-lowerlid" % ("l" if eye[0] > 0 else "r"))
        if lo is None:
            continue
        d = co - (lo + np.array([0.0, 0.0, -0.002]))
        low = np.maximum(low, np.exp(-((d[:, 0] / 0.015) ** 2 + (d[:, 2] / 0.0045) ** 2 + (d[:, 1] / 0.012) ** 2)))
    fields["lowerlid"] = low
    # i016: under-eye zone (below the lower lid, the tear trough), forehead band, freckle zone (nose bridge +
    # upper cheeks)
    under = np.zeros(n)
    for eye in (leye, reye):
        if eye is None:
            continue
        lo = group_center(body, co, "joint-%s-lowerlid" % ("l" if eye[0] > 0 else "r"))
        if lo is None:
            continue
        d = co - (lo + np.array([-0.002 * np.sign(eye[0]), 0.0, -0.009]))
        under = np.maximum(under, np.exp(-((d[:, 0] / 0.013) ** 2 + (d[:, 2] / 0.0065) ** 2 + (d[:, 1] / 0.014) ** 2)))
    fields["undereye"] = under
    peri = np.zeros(n)
    for eye in (leye, reye):
        if eye is None:
            continue
        lo = group_center(body, co, "joint-%s-lowerlid" % ("l" if eye[0] > 0 else "r"))
        up = group_center(body, co, "joint-%s-upperlid" % ("l" if eye[0] > 0 else "r"))
        if lo is None or up is None:
            continue
        c = 0.5 * (lo + up)
        d = co - c
        peri = np.maximum(peri, np.exp(-((d[:, 0] / 0.019) ** 2 + (d[:, 2] / 0.012) ** 2 + (d[:, 1] / 0.02) ** 2)))
    fields["periocular"] = peri
    fh = np.zeros(n)
    frk = np.zeros(n)
    if leye is not None:
        top = np.array([0.0, leye[1] + 0.0, leye[2] + 0.050])
        d = co - top
        fh = np.exp(-((d[:, 0] / 0.045) ** 2 + (d[:, 2] / 0.024) ** 2)) * (co[:, 1] < leye[1] + 0.04)
        if mouth is not None:
            nb = np.array([0.0, leye[1], leye[2] - 0.020])
            d = co - nb
            frk = np.exp(-((d[:, 0] / 0.030) ** 2 + (d[:, 2] / 0.016) ** 2)) * (co[:, 1] < leye[1] + 0.02)
    fields["forehead"] = fh
    fields["frecklezone"] = frk
    # lid margins: body vertices nearest the eyeball (within ~2.5 mm of the closest ring around each eye)
    is_body = group_weights(body, "body") > 0.5
    tight = np.zeros(n)
    water = np.zeros(n)
    for eye in (leye, reye):
        if eye is None:
            continue
        d = np.sqrt(((co - eye) ** 2).sum(axis=1))
        near = is_body & (d < 0.03) & (co[:, 1] < eye[1] + 0.004)
        if not near.any():
            continue
        dmin = float(d[near].min())
        # i011: probe_lids.py showed the visible lid rims (d = dmin .. dmin+3 mm) map to the base texture's
        # separate, RED-painted eye-socket UV island (x ~ 0.01-0.15 of the map) - the source of the orange rims.
        # Cover the whole rim: full weight within 2.5 mm of the nearest ring, fading out by 4.5 mm.
        m = np.where(near, np.clip(1.0 - (d - dmin - 0.0025) / 0.002, 0.0, 1.0), 0.0)
        upper = np.clip((co[:, 2] - (eye[2] - 0.001)) / 0.002, 0.0, 1.0)
        tight = np.maximum(tight, m * upper)
        water = np.maximum(water, m * (1.0 - upper))
    fields["tight"] = tight
    fields["waterline"] = water
    # scalp tone: i011 renders showed a brown "hood" framing the face - the smoothed scalp weight faded out far
    # onto the temples and the skin in front of the ears. Keep it INSIDE the scalp group, and off the
    # sideburn skin in front of the ears below the eye line + 2.5 cm (hair does not cover it).
    sc = np.clip((scalp - 0.30) / 0.30, 0, 1)      # i014: .55/.35 left a pale wedge at the side part
    ear_c = group_center(body, co, "ears")
    if ear_c is not None and leye is not None:
        front_of_ear = (co[:, 1] < ear_c[1] + 0.005).astype(np.float64)
        t = np.clip((co[:, 2] - leye[2]) / 0.025, 0, 1)
        sc *= 1.0 - front_of_ear * (1.0 - t * t * (3 - 2 * t))
    fields["scalp"] = sc
    # warmth on the nose tip, ears and chin (blood-flow redness, very subtle)
    warm = ears * 0.8
    if mouth is not None and leye is not None:
        nose_tip = np.array([0.0, (leye[1] + mouth[1]) * 0.5 - 0.018, (leye[2] + mouth[2]) * 0.5 - 0.004])
        d = co - nose_tip
        warm = np.maximum(warm, np.exp(-(d ** 2).sum(axis=1) / (0.012 ** 2)) * 0.7)
        chin = mouth + np.array([0.0, 0.004, -0.035])
        d = co - chin
        warm = np.maximum(warm, np.exp(-(d ** 2).sum(axis=1) / (0.016 ** 2)) * 0.5)
    fields["warm"] = warm
    # roughness zone: -1 = shinier (T-zone, nose, lips), +1 = softer (cheeks)
    zone = np.zeros(n)
    if leye is not None and mouth is not None:
        forehead = np.array([0.0, leye[1] + 0.005, leye[2] + 0.055])
        d = co - forehead
        zone -= 0.6 * np.exp(-((d[:, 0] / 0.035) ** 2 + (d[:, 2] / 0.025) ** 2 + (d[:, 1] / 0.04) ** 2))
        nose = np.array([0.0, (leye[1] + mouth[1]) * 0.5 - 0.02, (leye[2] + mouth[2]) * 0.5])
        d = co - nose
        zone -= 0.8 * np.exp(-((d[:, 0] / 0.014) ** 2 + (d[:, 2] / 0.03) ** 2 + (d[:, 1] / 0.03) ** 2))
    zone -= 0.9 * fields["lips"]
    zone += 0.5 * fields["blush"]
    fields["zone"] = zone
    # i016: glossy centre of the lower lip (a soft highlight there reads as healthy, moisturised lips)
    llc = np.zeros(n)
    if mouth is not None:
        lips_pts = co[group_weights(body, "lips") > 0.5]
        if len(lips_pts):
            zmid = float(np.median(lips_pts[:, 2]))
            yfront = float(lips_pts[:, 1].min())
            c = np.array([0.0, yfront + 0.002, zmid - 0.0055])
            d = co - c
            llc = np.exp(-((d[:, 0] / 0.010) ** 2 + (d[:, 2] / 0.0028) ** 2 + (d[:, 1] / 0.004) ** 2))
            llc *= np.clip(fields["lips"], 0, 1)
    fields["lowerlipc"] = llc
    fields["_co"] = co
    return fields


def brow_field(body, co, brows):
    """Per-vertex density of the brow strands over the skin (0..1), fuller at the head (medial end)."""
    n = len(co)
    if brows is None:
        return np.zeros(n)
    from mathutils.kdtree import KDTree
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = brows.evaluated_get(depsgraph)
    m = ev.to_mesh()
    mw = brows.matrix_world
    pts = np.array([tuple(mw @ v.co) for v in m.vertices])
    ev.to_mesh_clear()
    if not len(pts):
        return np.zeros(n)
    inv = np.array(body.matrix_world.inverted())
    pts = pts @ inv[:3, :3].T + inv[:3, 3]
    kd = KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(p, i)
    kd.balance()
    zmin, zmax = pts[:, 2].min() - 0.006, pts[:, 2].max() + 0.006
    ymax = pts[:, 1].max() + 0.01
    xin, xout = np.abs(pts[:, 0]).min(), np.abs(pts[:, 0]).max()
    out = np.zeros(n)
    cand = np.where((co[:, 2] > zmin) & (co[:, 2] < zmax) & (co[:, 1] < ymax))[0]
    for i in cand:
        hits = kd.find_range(co[i], 0.0028)
        if hits:
            out[i] = len(hits)
    if out.max() <= 0:
        return out
    out = np.clip(out / np.percentile(out[out > 0], 70), 0, 1)
    t = np.clip((np.abs(co[:, 0]) - xin) / max(xout - xin, 1e-3), 0, 1)     # 0 = head, 1 = tail of the brow
    out *= 1.25 - 0.55 * t
    return np.clip(smooth_field(body, out, 2), 0, 1)


# ----------------------------------------------------------------------------------------------- maps

def load_rgba(path):
    img = bpy.data.images.load(path, check_existing=True)
    w, h = img.size
    arr = np.zeros(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    return img, arr.reshape(h, w, 4)


def save_png(name, arr, path, colorspace="sRGB"):
    h, w = arr.shape[:2]
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.colorspace_settings.name = colorspace
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :arr.shape[2]] = arr[..., :4]
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


def _mix(base, color, amount):
    return base * (1.0 - amount[..., None]) + np.array(color, dtype=np.float32) * amount[..., None]


def _mult(base, color, amount):
    return base * (1.0 - amount[..., None] + amount[..., None] * np.array(color, dtype=np.float32))


def value_noise(size, cells, seed):
    """Smooth tileable-ish value noise in [0,1], (size,size)."""
    rng = np.random.default_rng(seed)
    g = rng.random((cells + 1, cells + 1)).astype(np.float32)
    g[-1, :] = g[0, :]
    g[:, -1] = g[:, 0]
    x = np.linspace(0, cells, size, endpoint=False)
    i = np.floor(x).astype(int)
    f = x - i
    f = f * f * (3 - 2 * f)
    a = g[i][:, i] * (1 - f)[None, :] + g[i][:, i + 1] * f[None, :]
    b = g[i + 1][:, i] * (1 - f)[None, :] + g[i + 1][:, i + 1] * f[None, :]
    return a * (1 - f)[:, None] + b * f[:, None]


PAINT_VERSION = 12


def freckles(size, count, seed, zone):
    """Sparse soft dots (0..1) inside `zone` (a UV-space (size,size) weight)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((size, size), dtype=np.float32)
    ys, xs = np.nonzero(zone > 0.35)
    if not len(ys):
        return out
    pick = rng.choice(len(ys), size=min(count, len(ys)), replace=False)
    yy, xx = np.mgrid[-6:7, -6:7]
    for k in pick:
        r = rng.uniform(1.2, 3.2)
        a = rng.uniform(0.35, 1.0)
        dot = np.exp(-(xx ** 2 + yy ** 2) / (2 * r * r)) * a
        y, x = ys[k], xs[k]
        y0, y1, x0, x1 = max(y - 6, 0), min(y + 7, size), max(x - 6, 0), min(x + 7, size)
        out[y0:y1, x0:x1] = np.maximum(out[y0:y1, x0:x1], dot[(y0 - y + 6):(y1 - y + 6), (x0 - x + 6):(x1 - x + 6)])
    return out * zone


def paint_maps(body, base_png, out_dir, makeup=None, brows=None):
    """Paint albedo / roughness / normal maps. Cached in <out_dir>/skin_cache/<hash> (face shape + makeup)."""
    import hashlib
    import json
    M = dict(MAKEUP)
    M.update(makeup or {})
    F = makeup_fields(body)
    co = F["_co"]
    F["brow"] = brow_field(body, co, brows)
    M["_brows"] = brows.name if brows is not None else ""
    head = co[:, 2] > (co[:, 2].max() - 0.42)
    key = hashlib.md5(np.round(co[head], 4).tobytes() + json.dumps(M, sort_keys=True).encode() +
                      base_png.encode() + str(PAINT_VERSION).encode()).hexdigest()[:16]
    cache = os.path.join(os.environ.get("EVIA_CACHE") or out_dir, "skin_cache", key)
    names = ("evia_skin_albedo", "evia_skin_rough", "evia_skin_normal")
    if all(os.path.exists(os.path.join(cache, n + ".png")) for n in names):
        imgs = []
        for n in names:
            img = bpy.data.images.load(os.path.join(cache, n + ".png"), check_existing=False)
            img.name = n
            if n != "evia_skin_albedo":
                img.colorspace_settings.name = "Non-Color"
            imgs.append(img)
        print("EVIA SKIN cache hit", key)
        return tuple(imgs)
    os.makedirs(cache, exist_ok=True)
    out_dir = cache
    keys = ["lips", "blush", "lid", "liner", "scalp", "warm", "zone", "lowerlid", "tight", "waterline", "undereye",
            "forehead", "frecklezone", "lowerlipc", "brow", "periocular"]
    fields = np.stack([F[k] for k in keys], axis=1).astype(np.float32)
    raster, cov = rasterize(body, fields, SIZE, zmin=co[:, 2].max() - 0.42, co=co)
    raster = masked_blur(raster, cov, 3)
    R = {k: raster[..., i] for i, k in enumerate(keys)}
    if M.get("lips_feather", 0) > 3:          # softer lip border (extra blur of the lip field only)
        R["lips"] = masked_blur(R["lips"][..., None], cov, M["lips_feather"] - 3)[..., 0]
    _img, base = load_rgba(base_png)
    if base.shape[0] != SIZE:
        raise ValueError("expected a %d^2 base skin" % SIZE)
    rgb = base[..., :3].copy()
    rgb = np.clip(rgb * np.array(M["tone_gain"], dtype=np.float32) + M["tone_lift"], 0, 1)
    # periocular neutraliser: toward the forehead tone, keeping the local luminance (texture detail)
    fsel = (np.clip(R["forehead"], 0, 1) > 0.6) & cov
    if fsel.any():
        ref = rgb[fsel].mean(axis=0)
        lum = rgb.mean(axis=2, keepdims=True)
        neutral = ref[None, None, :] * (lum / max(float(ref.mean()), 1e-3))
        k = (np.clip(R["periocular"], 0, 1) * M["periocular_amount"])[..., None]
        rgb = np.clip(rgb * (1 - k) + neutral * k, 0, 1)
    rgb = _mix(rgb, M["warm"], np.clip(R["warm"], 0, 1) * M["warm_amount"])
    rgb = _mix(rgb, M["forehead"], np.clip(R["forehead"], 0, 1) * M["forehead_amount"])
    # faint mottling: low-frequency redness variation (+-), then the blush on top
    mot = (value_noise(SIZE, 40, 21) - 0.5) * 2.0 * M["mottle_amount"]
    rgb[..., 0] = rgb[..., 0] * (1.0 + mot * 0.6)
    rgb[..., 1] = rgb[..., 1] * (1.0 - mot * 0.4)
    rgb = _mix(rgb, M["blush"], np.clip(R["blush"], 0, 1) * M["blush_amount"])
    rgb = _mix(rgb, M["undereye"], np.clip(R["undereye"], 0, 1) * M["undereye_amount"])
    frk = freckles(SIZE, M["freckle_count"], 33, np.clip(R["frecklezone"], 0, 1) * cov)
    rgb = _mix(rgb, M["freckle"], frk * M["freckle_amount"])
    rgb = _mix(rgb, M["brow"], np.clip(R["brow"], 0, 1) * M["brow_amount"])
    rgb = _mix(rgb, M["lowerlid"], np.clip(R["lowerlid"], 0, 1) * M["lowerlid_amount"])
    rgb = _mix(rgb, M["lid"], np.clip(R["lid"], 0, 1) * M["lid_amount"])
    rgb = _mix(rgb, M["liner"], np.clip(R["liner"], 0, 1) * M["liner_amount"])
    rgb = _mix(rgb, M["waterline"], np.clip(R["waterline"], 0, 1) * M["waterline_amount"])
    rgb = _mix(rgb, M["tight"], np.clip(R["tight"], 0, 1) * M["tight_amount"])
    # lips: keep the base's lip texture detail (luminance), move chroma toward the target
    lum = rgb.mean(axis=2, keepdims=True)
    lip_col = np.array(M["lips"], dtype=np.float32) * (lum / max(float(np.array(M["lips"]).mean()), 1e-3)) ** 0.5
    la = np.clip(R["lips"], 0, 1)[..., None] * M["lips_amount"]
    rgb = rgb * (1 - la) + np.clip(lip_col, 0, 1) * la
    rgb = np.clip(rgb * (1.0 + 0.05 * np.clip(R["lowerlipc"], 0, 1)[..., None]), 0, 1)
    rgb = _mix(rgb, M["scalp"], np.clip(R["scalp"], 0, 1) * M["scalp_amount"])
    albedo = save_png("evia_skin_albedo", rgb, os.path.join(out_dir, "evia_skin_albedo.png"))
    # i016 maps are ABSOLUTE (no remap in the shader / export):
    #   R = roughness: base .50, T-zone / nose ~.42, cheeks ~.55, lips ~.36, lower-lip centre ~.26,
    #       wet waterline ~.14, pores a touch rougher
    #   G = subsurface weight: 1, thin lid margins .35 (SSS on thin rims rendered orange), lips .85
    #   B = specular mask (cavity): 1, pits of the pores .6
    n1 = value_noise(SIZE, 180, 3)
    # (i016 first render: 900-cell pits at .9 / strength .30 read as orange peel -> finer, shallower pits)
    pit_n = value_noise(SIZE, 1300, 5)
    pits = np.clip((pit_n - 0.66) / 0.34, 0, 1) ** 1.5
    face_detail = np.clip(1.0 - 0.7 * np.clip(R["lips"], 0, 1) - 0.6 * np.clip(R["lid"], 0, 1) -
                          0.6 * np.clip(R["waterline"] + R["tight"], 0, 1), 0.15, 1.0)
    rough = 0.50 + 0.09 * np.clip(R["zone"], -1, 1) + 0.04 * (n1 - 0.5) + 0.04 * pits * face_detail
    rough -= 0.12 * np.clip(R["lips"], 0, 1)
    rough -= 0.12 * np.clip(R["lowerlipc"], 0, 1)
    rough = rough * (1 - np.clip(R["waterline"], 0, 1)) + 0.14 * np.clip(R["waterline"], 0, 1)
    rough = np.clip(rough, 0.08, 0.9)
    sss = 1.0 - 0.65 * np.clip(R["tight"] + R["waterline"], 0, 1) - 0.15 * np.clip(R["lips"], 0, 1)
    spec = 1.0 - 0.4 * pits * face_detail
    rough_img = save_png("evia_skin_rough", np.stack([rough, np.clip(sss, 0, 1), spec], axis=2),
                         os.path.join(out_dir, "evia_skin_rough.png"), "Non-Color")
    # detail normal: pore pits + fine grain + micro-wrinkle noise, weaker on lips / lids
    fine = value_noise(SIZE, 1500, 6)
    micro = value_noise(SIZE, 300, 7)
    hgt = -0.35 * pits + 0.18 * (fine - 0.5) + 0.06 * (micro - 0.5)
    hgt *= face_detail
    dy, dx = np.gradient(hgt)
    k = 3.0
    nx, ny = -dx * k, -dy * k
    nz = np.ones_like(nx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], axis=2)
    normal_img = save_png("evia_skin_normal", nrm, os.path.join(out_dir, "evia_skin_normal.png"), "Non-Color")
    return albedo, rough_img, normal_img


# ----------------------------------------------------------------------------------------------- shader

def skin_shader(mat, albedo, rough_img, normal_img):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    uv = nt.nodes.new("ShaderNodeUVMap")
    ta = nt.nodes.new("ShaderNodeTexImage")
    ta.image = albedo
    nt.links.new(uv.outputs[0], ta.inputs[0])
    nt.links.new(ta.outputs["Color"], bsdf.inputs["Base Color"])
    tr = nt.nodes.new("ShaderNodeTexImage")
    tr.image = rough_img
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(uv.outputs[0], tr.inputs[0])
    nt.links.new(tr.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Red"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Subsurface Weight"])
    spec = nt.nodes.new("ShaderNodeMath")
    spec.operation = "MULTIPLY"
    spec.inputs[1].default_value = 0.45
    nt.links.new(sep.outputs["Blue"], spec.inputs[0])
    nt.links.new(spec.outputs[0], bsdf.inputs["Specular IOR Level"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = normal_img
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = 0.20     # i016: .12 left no visible texture; .30 read as orange peel
    nt.links.new(uv.outputs[0], tn.inputs[0])
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.subsurface_method = "RANDOM_WALK"
    bsdf.inputs["Subsurface Radius"].default_value = (0.85, 0.34, 0.22)   # less red bleed at thin lids
    bsdf.inputs["Subsurface Scale"].default_value = 0.0026
    bsdf.inputs["IOR"].default_value = 1.4
    bsdf.inputs["Coat Weight"].default_value = 0.0     # i016: the 5 % coat read as vinyl sheen
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def base_texture_path(skin_name):
    mhmat = E.find_asset("skins", skin_name, "mhmat")
    with open(mhmat) as handle:
        for line in handle:
            if line.startswith("diffuseTexture"):
                return os.path.join(os.path.dirname(mhmat), line.split(None, 1)[1].strip())
    raise FileNotFoundError("no diffuseTexture in " + mhmat)


def apply(body, cfg, work_dir=None, brows=None):
    out_dir = work_dir or bpy.app.tempdir
    os.makedirs(out_dir, exist_ok=True)
    E.set_skin(body, cfg["base"], "MAKESKIN")
    albedo, rough_img, normal_img = paint_maps(body, base_texture_path(cfg["base"]), out_dir, cfg.get("makeup"),
                                               brows=brows)
    mat = body.material_slots[0].material
    skin_shader(mat, albedo, rough_img, normal_img)
    mat.name = "EviaSkin"
    return mat
