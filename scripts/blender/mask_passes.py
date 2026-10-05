"""Evia 'living room' mask passes: one cheap Cycles render per camera that writes the masks the web layer needs to
animate a static plate (swaying plants, twinkling city windows, flickering lamps, breathing/travelling LED coves,
the consult emitter), pixel-aligned with the published plate because it is the SAME scene, camera, depth of field,
resolution and pixel filter as the beauty render.

Used by the room scripts through their `--passes masks` flag (room_lounge.py, room_consult.py,
room_products_hero.py): they build their scene exactly as for the beauty render, then call `render_masks()` instead
of their own render setup. Then `mask_post.py` turns the EXR into the published WebP masks + anchors.

How it works (Blender 4.5, Cycles CPU):
  * every material is swapped for a flat mask shader: a black diffuse closure (opaque, so occlusion is exact) plus
    shader AOV outputs. Window glass and transmissive acrylic become a Transparent BSDF, so what is seen through them is
    classified too. AOVs are written for every surface a camera ray meets up to and including the first opaque
    one, and averaged over the samples, so every AOV is a coverage-weighted ("premultiplied") value with the same
    anti-aliasing and depth-of-field blur as the plate.
  * film transparent: alpha 0 where a camera ray escapes to the world (through glass) = open sky.
  * no lights, no bounces, no denoising, no adaptive sampling: camera rays only, fixed seed (deterministic).
  * per-object data travels as object custom properties read by Attribute(Object) nodes (plant base/reach/id,
    lamp id, strip id) and, for LED strips, a per-vertex 'evm_along' attribute (0..1 along the strip).
  * procedural window/ring patterns are read from the scene's own materials: the builders label the relevant
    nodes ('evm_win_on', 'evm_win_hash', 'evm_haze', 'evm_emit', 'evm_emit_r', 'evm_emit_ang'). Labels do not
    change the beauty render at all (checked: the same preview renders are bit-identical before/after).
  * closed strips (rings, loops): 'along' wraps 1 -> 0 somewhere. A geometric guess (_hide_seam), then a quick
    8-sample prepass of this same render (_seam_prepass), put that wrap in a stretch the camera cannot see, or on a
    ring seen all the way round at its faintest point. The shift chosen per ring is recorded in <base>_masks.json.
  * 2D anchors (lamp centres/radii, plant base/tip, strip boxes) are projected after the render size is set
    (world_to_camera_view depends on the frame's aspect).

AOVs (all VALUE, premultiplied by coverage):
  evm_plant, evm_plant_sway, evm_plant_id        leaves/stems; sway = (|P - base| / depth of the base) / S, S = the
                                                 largest (reach / depth) of the plants in frame (screen-space sway
                                                 weight, 0 at the pot .. 1 at the scene's most mobile leaf tip);
                                                 id = plant index / 255
  evm_lamp, evm_lamp_id                          lamp fixtures (globes, candle, downlights, pendant, beacons)
  evm_strip, evm_strip_along, evm_strip_id       LED strips/coves/rings (visible to the camera)
  evm_glass                                      window glass seen directly
  evm_sky                                        emissive backdrops that stand for the outside (hero daylight)
  evm_win, evm_win_on, evm_win_idp               lit city windows: visibility-weighted (haze), binary, id * binary
  evm_city                                       any city geometry (blocks, ground, street lights)
  evm_emit, evm_emit_cov, evm_emit_ang, evm_emit_r   consult emitter: ring/rim intensity, coverage, angle, radius
plus Combined alpha and Mist.
"""
import os
import math
import json
import re

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

AOVS = ['evm_plant', 'evm_plant_sway', 'evm_plant_id',
        'evm_lamp', 'evm_lamp_id',
        'evm_strip', 'evm_strip_along', 'evm_strip_id',
        'evm_glass', 'evm_sky',
        'evm_win', 'evm_win_on', 'evm_win_idp', 'evm_city',
        'evm_emit', 'evm_emit_cov', 'evm_emit_ang', 'evm_emit_r']

ID_SCALE = 255.0


# ----------------------------------------------------------------------------- node helpers
class _NB:
    def __init__(self, nt):
        self.nt = nt

    def node(self, t, **kw):
        n = self.nt.nodes.new(t)
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def math(self, op, a=None, b=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op)
        n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = float(v)
            else:
                self.link(v, n.inputs[i])
        return n.outputs[0]

    def aov(self, name, value):
        a = self.node('ShaderNodeOutputAOV')
        a.aov_name = name
        if isinstance(value, (int, float)):
            a.inputs['Value'].default_value = float(value)
        else:
            self.link(value, a.inputs['Value'])
        return a

    def obj_attr(self, name, socket='Fac'):
        n = self.node('ShaderNodeAttribute')
        n.attribute_type = 'OBJECT'
        n.attribute_name = name
        return n.outputs[socket]


def _new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.target = 'ALL'
    return m, _NB(nt), out


def _black(nb, out, transparent=False):
    if transparent:
        s = nb.node('ShaderNodeBsdfTransparent')
        s.inputs['Color'].default_value = (1, 1, 1, 1)
        nb.link(s.outputs[0], out.inputs['Surface'])
    else:
        # An almost-black diffuse closure, NOT a zero-strength emission: Cycles folds a zero emission away, and a
        # material without any surface closure is treated as surface-less (camera rays pass straight through it,
        # so AOVs pile up behind it). With no lights, a black world and no bounces it adds nothing to the image.
        d = nb.node('ShaderNodeBsdfDiffuse')
        d.inputs['Color'].default_value = (1e-4, 1e-4, 1e-4, 1)
        nb.link(d.outputs[0], out.inputs['Surface'])
    return out


def _find_label(nt, label):
    for n in nt.nodes:
        if n.label == label:
            return n
    return None


# ----------------------------------------------------------------------------- mask materials
def build_mask_materials(emitter_centre=None, emitter_radius=1.0):
    M = {}
    m, nb, out = _new_mat('evm_solid')
    _black(nb, out)
    M['solid'] = m

    m, nb, out = _new_mat('evm_pass')          # transmissive props (acrylic): see-through, no AOV
    _black(nb, out, transparent=True)
    M['pass'] = m

    m, nb, out = _new_mat('evm_glass')
    _black(nb, out, transparent=True)
    nb.aov('evm_glass', 1.0)
    M['glass'] = m

    m, nb, out = _new_mat('evm_sky')
    _black(nb, out)
    nb.aov('evm_sky', 1.0)
    M['sky'] = m

    m, nb, out = _new_mat('evm_city')
    _black(nb, out)
    nb.aov('evm_city', 1.0)
    M['city'] = m

    # plants: sway weight from the world position relative to the plant's base
    m, nb, out = _new_mat('evm_plant')
    _black(nb, out)
    geo = nb.node('ShaderNodeNewGeometry')
    base = nb.obj_attr('evm_base', 'Vector')
    d = nb.node('ShaderNodeVectorMath', operation='DISTANCE')
    nb.link(geo.outputs['Position'], d.inputs[0])
    nb.link(base, d.inputs[1])
    sway = nb.math('DIVIDE', d.outputs['Value'], nb.obj_attr('evm_reach'), clamp=True)
    nb.aov('evm_plant', 1.0)
    nb.aov('evm_plant_sway', sway)
    nb.aov('evm_plant_id', nb.math('DIVIDE', nb.obj_attr('evm_pid'), ID_SCALE))
    M['plant'] = m

    m, nb, out = _new_mat('evm_lamp')
    _black(nb, out)
    nb.aov('evm_lamp', 1.0)
    nb.aov('evm_lamp_id', nb.math('DIVIDE', nb.obj_attr('evm_lid'), ID_SCALE))
    M['lamp'] = m

    m, nb, out = _new_mat('evm_strip')
    _black(nb, out)
    at = nb.node('ShaderNodeAttribute')
    at.attribute_type = 'GEOMETRY'
    at.attribute_name = 'evm_along'
    nb.aov('evm_strip', 1.0)
    nb.aov('evm_strip_along', at.outputs['Fac'])
    nb.aov('evm_strip_id', nb.math('DIVIDE', nb.obj_attr('evm_sid'), ID_SCALE))
    M['strip'] = m

    # street lights (small emissive city boxes): lit window with a per-object id
    m, nb, out = _new_mat('evm_street')
    _black(nb, out)
    oi = nb.node('ShaderNodeObjectInfo')
    nb.aov('evm_win', 1.0)
    nb.aov('evm_win_on', 1.0)
    nb.aov('evm_win_idp', oi.outputs['Random'])
    nb.aov('evm_city', 1.0)
    M['street'] = m

    # consult emitter rim (polar coordinates around the pedestal axis)
    if emitter_centre is not None:
        m, nb, out = _new_mat('evm_emitter')
        _black(nb, out)
        _polar_aovs(nb, emitter_centre, emitter_radius)
        nb.aov('evm_emit', 1.0)
        nb.aov('evm_emit_cov', 1.0)
        M['emitter'] = m
    return M


def _polar_aovs(nb, centre, radius):
    geo = nb.node('ShaderNodeNewGeometry')
    sep = nb.node('ShaderNodeSeparateXYZ')
    nb.link(geo.outputs['Position'], sep.inputs[0])
    dx = nb.math('SUBTRACT', sep.outputs['X'], centre[0])
    dy = nb.math('SUBTRACT', sep.outputs['Y'], centre[1])
    r = nb.math('SQRT', nb.math('ADD', nb.math('MULTIPLY', dx, dx), nb.math('MULTIPLY', dy, dy)))
    nb.aov('evm_emit_r', nb.math('DIVIDE', r, radius, clamp=True))
    ang = nb.math('ARCTAN2', dy, dx)                  # -pi..pi from +X, counter-clockwise seen from above
    nb.aov('evm_emit_ang', nb.math('ADD', nb.math('DIVIDE', ang, 2 * math.pi), 0.5))


def facade_to_mask(mat, hash_channel='Red', haze=True):
    """Turns a city facade material (lounge_lib.city_window_material / consult 'city') into its mask version in place,
    using the labelled nodes: 'evm_win_on' (lit-window 0/1), 'evm_win_hash' (White Noise of the window cell),
    optional 'evm_haze' (aerial-perspective mix factor, 0 near .. ~0.9 far)."""
    nt = mat.node_tree
    nb = _NB(nt)
    on = _find_label(nt, 'evm_win_on')
    wn = _find_label(nt, 'evm_win_hash')
    if on is None or wn is None:
        raise RuntimeError(f'facade {mat.name}: labelled nodes missing')
    out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    for lk in list(out.inputs['Surface'].links):
        nt.links.remove(lk)
    for lk in list(out.inputs['Displacement'].links):
        nt.links.remove(lk)
    _black(nb, out)
    sc = nb.node('ShaderNodeSeparateColor')
    nb.link(wn.outputs['Color'], sc.inputs[0])
    on_v = on.outputs[0]
    vis = 1.0
    hz = _find_label(nt, 'evm_haze') if haze else None
    if hz is not None:
        vis = nb.math('SUBTRACT', 1.0, hz.outputs[0])
    nb.aov('evm_win', nb.math('MULTIPLY', on_v, vis) if not isinstance(vis, float) else on_v)
    nb.aov('evm_win_on', on_v)
    nb.aov('evm_win_idp', nb.math('MULTIPLY', on_v, sc.outputs[hash_channel]))
    nb.aov('evm_city', 1.0)
    return mat


def emitter_glass_to_mask(mat, centre, radius):
    """Consult glass top: ring intensity from the labelled 'evm_emit' node (sum of the inlaid rings + pool + ticks)."""
    nt = mat.node_tree
    nb = _NB(nt)
    acc = _find_label(nt, 'evm_emit')
    if acc is None:
        raise RuntimeError('glass top: labelled node evm_emit missing')
    out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    for lk in list(out.inputs['Surface'].links):
        nt.links.remove(lk)
    _black(nb, out)
    nb.aov('evm_emit', nb.math('MINIMUM', acc.outputs[0], 1.0))
    nb.aov('evm_emit_cov', 1.0)
    _polar_aovs(nb, centre, radius)
    return mat


# ----------------------------------------------------------------------------- geometry helpers
def _world_verts(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ob.matrix_world
    pts = [mw @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return pts


def to_mesh_object(ob):
    """Replace a curve (or modified mesh) object by a plain mesh object with the same evaluated geometry, name,
    transform, ray visibility and collections, so it can carry a per-vertex attribute."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    name = ob.name
    new = bpy.data.objects.new(name + '__evm', me)
    new.matrix_world = ob.matrix_world.copy()
    for attr in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission',
                 'visible_volume_scatter', 'visible_shadow', 'hide_render'):
        setattr(new, attr, getattr(ob, attr))
    cols = list(ob.users_collection)
    for c in cols:
        c.objects.link(new)
    bpy.data.objects.remove(ob, do_unlink=True)
    new.name = name
    return new


def _along_from_path(V, path, closed):
    import numpy as np
    P = np.asarray(path, dtype=np.float64)
    if closed:
        P = np.vstack([P, P[:1]])
    seg = P[1:] - P[:-1]
    L = np.linalg.norm(seg, axis=1)
    keep = L > 1e-9
    P0, seg, L = P[:-1][keep], seg[keep], L[keep]
    cum = np.concatenate([[0.0], np.cumsum(L)])
    total = float(cum[-1])
    V = np.asarray(V, dtype=np.float64)
    out = np.empty(len(V))
    for s in range(0, len(V), 2048):
        v = V[s:s + 2048]
        d = v[:, None, :] - P0[None, :, :]
        t = np.clip((d * seg[None]).sum(-1) / (L[None] ** 2), 0, 1)
        proj = P0[None] + t[..., None] * seg[None]
        dist = ((v[:, None, :] - proj) ** 2).sum(-1)
        k = dist.argmin(1)
        out[s:s + 2048] = (cum[k] + t[np.arange(len(v)), k] * L[k]) / max(total, 1e-9)
    return out, total


def _along_from_shape(V):
    """Arc (circle fit in the best plane) or straight (principal axis) parameterisation of a strip's vertices."""
    import numpy as np
    V = np.asarray(V, dtype=np.float64)
    c = V.mean(0)
    U, S, Vt = np.linalg.svd(V - c, full_matrices=False)
    e1, e2 = Vt[0], Vt[1]
    q = np.stack([(V - c) @ e1, (V - c) @ e2], 1)
    kind = 'line'
    if S[1] > 0.08 * S[0]:
        A = np.c_[2 * q, np.ones(len(q))]
        (cx, cy, c0), *_ = np.linalg.lstsq(A, (q ** 2).sum(1), rcond=None)
        r = math.sqrt(max(c0 + cx * cx + cy * cy, 1e-12))
        res = np.abs(np.hypot(q[:, 0] - cx, q[:, 1] - cy) - r).mean()
        if res < 0.08 * r:
            kind = 'arc'
    if kind == 'arc':
        a = np.arctan2(q[:, 1] - cy, q[:, 0] - cx)
        srt = np.sort(a)
        gaps = np.diff(np.concatenate([srt, srt[:1] + 2 * math.pi]))
        gi = int(gaps.argmax())
        gap = float(gaps[gi])
        if gap < math.radians(12):           # full ring
            along = (a % (2 * math.pi)) / (2 * math.pi)
            return along, 2 * math.pi * r, 'ring', dict(r=r)
        a0 = srt[(gi + 1) % len(srt)]
        span = 2 * math.pi - gap
        along = ((a - a0) % (2 * math.pi)) / span
        return np.clip(along, 0, 1), span * r, 'arc', dict(r=r)
    t = q[:, 0]
    lo, hi = t.min(), t.max()
    return (t - lo) / max(hi - lo, 1e-9), float(hi - lo), 'line', {}


def set_along(ob, path=None, closed=False):
    import numpy as np
    me = ob.data
    mw = ob.matrix_world
    V = np.array([tuple(mw @ v.co) for v in me.vertices])
    if path is not None and len(path) >= 2:
        along, length = _along_from_path(V, path, closed)
        shape = 'ring' if closed else 'path'
        extra = {}
    else:
        along, length, shape, extra = _along_from_shape(V)
    at = me.attributes.get('evm_along') or me.attributes.new('evm_along', 'FLOAT', 'POINT')
    at.data.foreach_set('value', [float(x) for x in along])
    return dict(lengthM=round(float(length), 3), shape=shape, **{k: round(v, 4) for k, v in extra.items()})


def _hide_seam(scn, cam_ob, ob):
    """A closed strip's 'along' wraps 1 -> 0 somewhere, and anti-aliasing mixes the two ends into a few wrong pixels
    there. Put that seam where it shows least: among the vertices the camera cannot see (outside the frame, behind
    the camera, or occluded by other geometry: scene.ray_cast from the eye), the one farthest along the strip from any
    visible vertex; if every vertex is visible (or the hidden stretch is only a sliver), the one closest to a frame
    edge (the safe margin, which the mockup framing crops)."""
    import numpy as np
    me = ob.data
    at = me.attributes['evm_along']
    a = np.zeros(len(me.vertices))
    at.data.foreach_get('value', a)
    mw = ob.matrix_world
    dg = bpy.context.evaluated_depsgraph_get()
    eye = cam_ob.matrix_world.translation
    step = max(1, len(me.vertices) // 800)
    idx, seen, edge = [], [], []
    for i in range(0, len(me.vertices), step):
        p = mw @ me.vertices[i].co
        x, y, z = project(scn, cam_ob, p)
        vis = z > 0 and 0 <= x <= 1 and 0 <= y <= 1
        if vis:
            d = p - eye
            hit, loc, _n, _i, hob, _m = scn.ray_cast(dg, eye, d.normalized(), distance=d.length - 0.02)
            vis = not (hit and hob is not None and hob.name != ob.name)
        idx.append(i)
        seen.append(vis)
        edge.append(min(x, 1 - x, y, 1 - y) if z > 0 else -1.0)
    idx, seen, edge = np.array(idx), np.array(seen), np.array(edge)
    av = a[idx]
    bi = None
    if not seen.any():
        bi = int(idx[0])
    elif not seen.all():
        vis_a = av[seen]
        hid = np.nonzero(~seen)[0]
        dist = np.abs(av[hid][:, None] - vis_a[None, :])
        dist = np.minimum(dist, 1 - dist).min(1)
        if dist.max() >= 0.03:          # a real hidden stretch (a grazing sliver would show through DOF/AA)
            bi = int(idx[hid[dist.argmax()]])
    if bi is None:
        bi = int(idx[np.where(edge >= 0, edge, np.inf).argmin()])
    a = (a - a[bi]) % 1.0
    at.data.foreach_set('value', a.tolist())


def _seam_prepass(scn, out_dir, base, rings):
    """Exact seam placement for closed strips: a quick full-size, 8-sample pass of the mask render itself shows which
    'along' values the camera really sees (depth of field and anti-aliasing included); each ring's seam then moves
    into the middle of the longest stretch nobody sees or, for a ring seen all the way round, to its faintest
    stretch (least visible coverage). Returns {strip name: along shift or None}."""
    import numpy as np
    import OpenImageIO as oiio
    r, c = scn.render, scn.cycles
    keep = (r.resolution_percentage, c.samples, r.filepath)
    tmp = os.path.join(out_dir, f'{base}_seam_prepass.exr')
    r.resolution_percentage, c.samples, r.filepath = 100, 8, tmp
    bpy.ops.render.render(write_still=True)
    r.resolution_percentage, c.samples, r.filepath = keep
    b = oiio.ImageBuf(tmp)
    sp = b.spec()
    px = np.asarray(b.get_pixels(oiio.FLOAT)).reshape(sp.height, sp.width, sp.nchannels)
    ch = {n.split('.')[-2]: px[..., k] for k, n in enumerate(sp.channelnames) if n.count('.') >= 2}
    os.remove(tmp)
    cov = ch['evm_strip']
    ok = cov > 0.02                   # faint (out-of-focus) pixels count as seen too
    along = np.where(ok, ch['evm_strip_along'] / np.maximum(cov, 1e-6), 0)
    sid = np.where(ok, np.round(ch['evm_strip_id'] / np.maximum(cov, 1e-6) * 255), 0)
    out = {}
    for i, ob in rings.items():
        sel = sid == i
        if sel.sum() < 4:
            out[ob.name] = None
            continue
        # drop pixels next to a jump (the current seam and its anti-aliased mixture)
        g = np.where(sel, along, np.nan)
        jump = np.zeros_like(sel)
        for ax in (0, 1):
            d = np.abs(np.diff(g, axis=ax))
            d = np.nan_to_num(d) > 0.1
            if ax == 0:
                jump[1:] |= d
                jump[:-1] |= d
            else:
                jump[:, 1:] |= d
                jump[:, :-1] |= d
        # coverage the camera sees per along bin; pixels at the current seam (along ~ 0 = 1) count at bin 0
        nb = int(min(256, max(16, 2 * np.sqrt(sel.sum()))))    # bins a few pixels long, never finer than the image
        keep_ = sel & ~jump
        hist = np.bincount(np.minimum((along[keep_] * nb).astype(int), nb - 1), weights=cov[keep_], minlength=nb)
        hist[0] += float(cov[sel & jump].sum())
        if hist.sum() <= 0:
            out[ob.name] = None
            continue
        z = np.concatenate([hist == 0, hist == 0])          # longest circular run of unseen bins
        best_len, best_mid, run = 0, 0, 0
        for j in range(2 * nb):
            run = run + 1 if z[j] else 0
            if run > best_len and run <= nb:
                best_len, best_mid = run, j - (run - 1) / 2 + 0.5
        if best_len >= 2:
            k = best_mid % nb
        else:                                                # seen all round: the faintest stretch
            sm = sum(np.roll(hist, d) for d in range(-2, 3))
            k = int(sm.argmin()) + 0.5
        shift = float(k / nb) % 1.0
        at = ob.data.attributes['evm_along']
        a = np.zeros(len(ob.data.vertices))
        at.data.foreach_get('value', a)
        at.data.foreach_set('value', ((a - shift) % 1.0).tolist())
        ob.data.update()
        out[ob.name] = round(shift, 4)
    return out


def curve_path(ob):
    if ob.type != 'CURVE' or not ob.data.splines:
        return None, False
    sp = ob.data.splines[0]
    mw = ob.matrix_world
    pts = [tuple(mw @ Vector(p.co[:3])) for p in sp.points] if sp.type == 'POLY' else \
          [tuple(mw @ p.co) for p in sp.bezier_points]
    # a loop drawn with its first point repeated at the end (e.g. consult's ring light) is closed too
    closed = bool(sp.use_cyclic_u) or (len(pts) > 2 and (Vector(pts[0]) - Vector(pts[-1])).length < 1e-4)
    return pts, closed


def assign_all(ob, mat):
    if ob.type not in ('MESH', 'CURVE', 'SURFACE', 'META', 'FONT'):
        return
    data = ob.data
    if hasattr(data, 'materials'):
        if len(data.materials) == 0:
            data.materials.append(mat)
        else:
            for i in range(len(data.materials)):
                data.materials[i] = mat
    for slot in ob.material_slots:
        slot.link = 'DATA'


# ----------------------------------------------------------------------------- projection
def project(scn, cam_ob, p):
    co = world_to_camera_view(scn, cam_ob, Vector(p))
    return co.x, 1.0 - co.y, co.z


def proj_bbox(scn, cam_ob, pts):
    xs, ys, zs = [], [], []
    for p in pts:
        x, y, z = project(scn, cam_ob, p)
        if z > 0:
            xs.append(x); ys.append(y); zs.append(z)
    if not xs:
        return None
    return [min(xs), min(ys), max(xs), max(ys)], sum(zs) / len(zs)


# ----------------------------------------------------------------------------- main entry
def render_masks(scn, cam_ob, W, H, spp, out_dir, base, spec, mist):
    """spec keys (all optional):
      plants:  list of dicts {name, objects: [obj names] (leaf meshes + stems), base: (x,y,z) or None}
      lamps:   list of dicts {name, object, kind, motion, tempK}
      strips:  list of dicts {name, object, kind, group}
      glass_mats, pass_mats, facade_mats (dict name -> dict(hash_channel, haze)), street_mats, city_collections,
      sky_objects, emitter: {objects: [names], glass: name, centre: (x,y,z), radius}
    Writes <out_dir>/<base>_masks.exr (multilayer float) and <base>_masks.json (classification + projections)."""
    os.makedirs(out_dir, exist_ok=True)
    # the frame first: world_to_camera_view (every 2D anchor below) uses the scene's render size and aspect
    scn.camera = cam_ob
    scn.render.resolution_x, scn.render.resolution_y, scn.render.resolution_percentage = W, H, 100
    scn.render.pixel_aspect_x = scn.render.pixel_aspect_y = 1.0
    bpy.context.view_layer.update()
    em = spec.get('emitter')
    MM = build_mask_materials(em['centre'] if em else None, em['radius'] if em else 1.0)
    info = dict(base=base, plate=dict(w=W, h=H), spp=spp, plants=[], lamps=[], strips=[], mist=list(mist))

    # --- lights are not needed (every surface is flat black); record nothing from them
    for ob in list(bpy.data.objects):
        if ob.type == 'LIGHT':
            bpy.data.objects.remove(ob, do_unlink=True)

    handled = set()

    # --- facades first (materials modified in place, objects keep them)
    city_cols = set(spec.get('city_collections', ()))
    for mname, opt in spec.get('facade_mats', {}).items():
        mat = bpy.data.materials.get(mname)
        if mat is not None:
            facade_to_mask(mat, **opt)
    facade_names = set(spec.get('facade_mats', {}).keys())
    street = set(spec.get('street_mats', ()))
    glass = set(spec.get('glass_mats', ()))
    passm = set(spec.get('pass_mats', ()))

    # --- plants. Sway weight = (distance from the plant's base, m) / (camera depth of the base, m), divided by the
    # largest such value over the plants in frame: proportional to how far a leaf moves ON SCREEN for a given sway
    # angle, so one amplitude in px (for the whole scene) moves big near plants more than small far ones, and the
    # tips more than the leaves near the pot. The shader computes |P - base| / evm_reach with evm_reach = S * depth.
    groups = []
    for i, pl in enumerate(spec.get('plants', []), start=1):
        obs = [bpy.data.objects[n] for n in pl['objects'] if n in bpy.data.objects]
        if not obs:
            continue
        pts = []
        leaf_pts = []
        for ob in obs:
            vv = _world_verts(ob)
            pts += vv
            if ob.name in pl.get('leaf_objects', pl['objects'][:1]):
                leaf_pts += vv
        if pl.get('base') is not None:
            b = Vector(pl['base'])
        else:
            zmin = min(p.z for p in pts)
            low = [p for p in pts if p.z < zmin + 0.02]
            b = Vector((sum(p.x for p in low) / len(low), sum(p.y for p in low) / len(low), zmin))
        reach = max((p - b).length for p in (leaf_pts or pts))
        bx, by, bz = project(scn, cam_ob, b)
        bb = proj_bbox(scn, cam_ob, leaf_pts or pts)
        inframe = bb is not None and bb[0][2] > 0 and bb[0][0] < 1 and bb[0][3] > 0 and bb[0][1] < 1
        groups.append((i, pl, obs, b, reach, max(bz, 0.05), bb, leaf_pts or pts, inframe))
    S = max([g[4] / g[5] for g in groups if g[8]] or [1.0])
    info['swayScale'] = round(S, 5)
    for i, pl, obs, b, reach, depth, bb, lp, inframe in groups:
        for ob in obs:
            ob['evm_base'] = (b.x, b.y, b.z)
            ob['evm_reach'] = float(S * depth)
            ob['evm_pid'] = float(i)
            assign_all(ob, MM['plant'])
            handled.add(ob.name)
        far = max(lp, key=lambda p: (p - b).length)
        bx, by, bz = project(scn, cam_ob, b)
        tx, ty, _ = project(scn, cam_ob, far)
        info['plants'].append(dict(id=i, name=pl['name'], kind=pl.get('kind', 'plant'),
                                   base=[round(bx, 5), round(by, 5)], tip=[round(tx, 5), round(ty, 5)],
                                   reachM=round(reach, 3), depthM=round(bz, 3),
                                   tipWeight=round(min(1.0, reach / depth / S), 3),
                                   bbox=[round(v, 5) for v in bb[0]] if bb else None))

    # --- lamps (fixtures seen by the camera) and beacons
    for i, lp in enumerate(spec.get('lamps', []), start=1):
        ob = bpy.data.objects.get(lp['object'])
        if ob is None:
            continue
        pts = _world_verts(ob)
        c = sum(pts, Vector()) / len(pts)
        ob['evm_lid'] = float(i)
        assign_all(ob, MM['lamp'])
        handled.add(ob.name)
        cx, cy, cz = project(scn, cam_ob, c)
        bb = proj_bbox(scn, cam_ob, pts)
        rw = max((p - c).length for p in pts)
        d = dict(id=i, name=lp['name'], kind=lp.get('kind', 'lamp'), motion=lp.get('motion', 'steady'),
                 cx=round(cx, 5), cy=round(cy, 5), depthM=round(cz, 3), radiusM=round(rw, 4))
        if bb:
            (x0, y0, x1, y1), _ = bb
            d.update(rx=round((x1 - x0) / 2, 5), ry=round((y1 - y0) / 2, 5))
        if lp.get('tempK'):
            d['tempK'] = lp['tempK']
        d['inFrame'] = bool(0 <= cx <= 1 and 0 <= cy <= 1 and cz > 0)
        info['lamps'].append(d)

    # --- strips (LED lines, coves, rings, panels)
    rings = {}
    for i, st in enumerate(spec.get('strips', []), start=1):
        ob = bpy.data.objects.get(st['object'])
        if ob is None:
            continue
        path, closed = curve_path(ob)
        if ob.type != 'MESH' or ob.modifiers:
            ob = to_mesh_object(ob)
        geo = set_along(ob, path, closed)
        if geo['shape'] == 'ring':
            _hide_seam(scn, cam_ob, ob)
            rings[i] = ob
        ob['evm_sid'] = float(i)
        assign_all(ob, MM['strip'])
        handled.add(ob.name)
        pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
        bb = proj_bbox(scn, cam_ob, pts)
        d = dict(id=i, name=st['name'], kind=st.get('kind', 'strip'), group=st.get('group', st['name']),
                 visibleToCamera=bool(ob.visible_camera), **geo)
        if bb:
            d['bbox'] = [round(v, 5) for v in bb[0]]
            d['depthM'] = round(bb[1], 3)
        if geo['shape'] in ('ring', 'arc') and st.get('centre') is not None:
            d['centre3d'] = [round(v, 4) for v in st['centre']]
        info['strips'].append(d)

    # --- emitter (consult)
    if em:
        for n in em.get('objects', ()):
            ob = bpy.data.objects.get(n)
            if ob is not None:
                assign_all(ob, MM['emitter'])
                handled.add(n)
        g = bpy.data.objects.get(em.get('glass', ''))
        if g is not None:
            mat = g.material_slots[0].material
            emitter_glass_to_mask(mat, em['centre'], em['radius'])
            handled.add(g.name)
        info['emitter'] = dict(centre=list(em['centre']), radiusM=em['radius'])

    sky_objs = set(spec.get('sky_objects', ()))
    # --- everything else, by material / collection
    for ob in list(bpy.data.objects):
        if ob.name in handled or ob.type not in ('MESH', 'CURVE'):
            continue
        if ob.name in sky_objs:
            assign_all(ob, MM['sky'])
            continue
        mats = {s.material.name for s in ob.material_slots if s.material}
        if mats & facade_names:
            continue                                   # keeps its (mask-converted) facade material
        if mats & street:
            assign_all(ob, MM['street'])
        elif mats & glass:
            assign_all(ob, MM['glass'])
        elif mats and mats <= passm:
            assign_all(ob, MM['pass'])
        elif any(c.name in city_cols for c in ob.users_collection):
            assign_all(ob, MM['city'])
        else:
            assign_all(ob, MM['solid'])

    # --- render settings: camera rays only
    scn.camera = cam_ob
    r = scn.render
    r.engine = 'CYCLES'
    r.resolution_x, r.resolution_y, r.resolution_percentage = W, H, 100
    r.film_transparent = True
    r.use_motion_blur = False
    r.threads_mode = 'AUTO'
    c = scn.cycles
    c.device = 'CPU'
    c.samples = spp
    c.use_adaptive_sampling = False
    c.use_denoising = False
    c.seed = 7
    c.use_animated_seed = False
    c.max_bounces = 0
    c.diffuse_bounces = 0
    c.glossy_bounces = 0
    c.transmission_bounces = 0
    c.volume_bounces = 0
    c.transparent_max_bounces = 32
    c.use_light_tree = False
    c.caustics_reflective = False
    c.caustics_refractive = False
    try:
        c.use_auto_tile = W * H > 2.5e6
        c.tile_size = 1024
    except Exception:
        pass
    vl = scn.view_layers[0]
    vl.use_pass_combined = True
    vl.use_pass_mist = True
    vl.use_pass_z = False
    vl.cycles.denoising_store_passes = False
    vl.use_pass_cryptomatte_object = False
    try:
        for lg in list(vl.lightgroups):
            vl.lightgroups.remove(lg)
    except Exception:
        pass
    for a in list(vl.aovs):
        if a.name.startswith('evm_'):
            vl.aovs.remove(a)
    for name in AOVS:
        a = vl.aovs.add()
        a.name = name
        a.type = 'VALUE'
    # black world (no emission anywhere, so nothing is light-sampled); it carries the scene's mist range
    w = bpy.data.worlds.new('evm_black')
    w.use_nodes = False
    w.color = (0, 0, 0)
    scn.world = w
    w.mist_settings.start = mist[0]
    w.mist_settings.depth = mist[1]
    w.mist_settings.falloff = 'LINEAR'
    scn.use_nodes = False
    r.image_settings.file_format = 'OPEN_EXR_MULTILAYER'
    r.image_settings.color_depth = '32'
    r.image_settings.exr_codec = 'ZIP'
    if rings:
        info['seams'] = _seam_prepass(scn, out_dir, base, rings)
    r.filepath = os.path.join(out_dir, f'{base}_masks.exr')
    info['camera'] = cam_ob.name
    info['aovs'] = AOVS
    with open(os.path.join(out_dir, f'{base}_masks.json'), 'w') as fh:
        json.dump(info, fh, indent=1)
    return info


def run(info_path_base, out_dir):
    import time
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = round(time.time() - t0, 1)
    p = os.path.join(out_dir, f'{info_path_base}_masks.json')
    d = json.load(open(p))
    d['render_seconds'] = dt
    d['blender'] = bpy.app.version_string
    with open(p, 'w') as fh:
        json.dump(d, fh, indent=1)
    print(f'[masks] {info_path_base} rendered in {dt}s')
    return dt


def regex_names(pattern):
    rx = re.compile(pattern)
    return sorted(o.name for o in bpy.data.objects if rx.match(o.name))
