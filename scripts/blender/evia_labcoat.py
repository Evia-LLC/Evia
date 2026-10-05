"""Evia's white lab coat, made from the CC0 `toigo_female_suit_2` jacket (suits01 pack) - Blender 4.5 + MPFB.

WHY
  No lab coat exists in any installed pack. The toigo_female_suit_2 jacket already has what a lab coat needs
  at the top - notched lapels, a set-in collar, fitted sleeves, pocket flaps and a buttoned front - and it
  is an MHCLO asset, so MPFB fits it to Evia's body and weights it to her rig. This module turns it into a
  knee-length lab coat:
    1. fit the suit with MPFB (after the rig exists -> parented + weighted), then delete the parts a lab coat
       does not have: trousers, shirt front, tie, shirt cuffs, cuff buttons;
    2. extend the hem to the knee: the bottom boundary chain of the jacket is extruded down in rings, each
       ring flaring a little (A-line) with soft vertical folds that grow toward the hem, pushed outside the
       legs; UVs continue each pattern piece downward; weights blend from the hem's weights toward Hips;
    3. add a fourth button on the extension;
    4. restrict the body's delete mask to skin actually under the coat (MPFB's mask also hid the legs under
       the removed trousers);
    5. white cotton-twill material with a procedural twill normal map (tileable, painted with numpy) and an
       `EviaCoatLabel` material slot on the left chest with its own `label` UV (0..1 over the patch) - left
       BLANK for an embroidered "Evia" texture / HTML label later.

All geometry decisions are deterministic (no randomness except a seeded fold phase).
"""

import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import evia_mpfb as E

DEFAULTS = {
    "asset": "toigo_female_suit_2",
    "hem_to_knee": 0.93,      # extend the hem down to (knee height * this); knee ~ 0.285 * height
    "cut_above_hem": 0.04,    # cut the jacket this far above its rolled hem and extend from the clean cut
    "rings": 12,
    "flare": 0.09,            # radial growth per metre of extension (A-line)
    "fold_count": 7,
    "fold_amp": 0.0085,
    "leg_clearance": 0.018,
    "color": (0.80, 0.80, 0.785),   # linear; ~ sRGB 231 - a warm clinical white that holds detail
    "roughness": 0.74,
    "sheen": 0.35,
    "twill_scale": 26.0,      # UV repeats of the twill tile
    "label_center": (0.085, None),   # x (her left chest); z computed from the shoulders
    "label_size": (0.075, 0.032),
    "seed": 5,
}


# ----------------------------------------------------------------------------------------------- parts

def _components(bm):
    bm.verts.ensure_lookup_table()
    seen = set()
    comps = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        comp = []
        seen.add(v.index)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        comps.append(comp)
    return comps


def classify(comp, uv_layer, height):
    """'jacket', 'button', or 'drop' for a loose part of toigo_female_suit_2 (layout measured, see notes)."""
    n = len(comp)
    zs = [v.co.z for v in comp]
    xs = [v.co.x for v in comp]
    uvs = [l[uv_layer].uv for v in comp for l in v.link_loops]
    cu = sum(u.x for u in uvs) / max(len(uvs), 1)
    cv = sum(u.y for u in uvs) / max(len(uvs), 1)
    if n > 3000:
        return "jacket"
    if min(zs) < 0.2 * height:
        return "drop"                                  # trousers
    if n < 80 and max(abs(x) for x in xs) < 0.06:
        return "button"                                # front buttons
    return "drop"                                      # shirt front, tie, shirt cuffs, cuff buttons


# ----------------------------------------------------------------------------------------------- hem

def hem_chains(bm, jacket_idx, band=0.06):
    """Ordered boundary-vertex runs along the bottom hem. The jacket's hem is split by the front opening and
    by the centre-back vent, so this returns every maximal run of near-horizontal boundary edges lying within
    `band` of the lowest hem point (2 runs for toigo_female_suit_2: her right half and her left half)."""
    bm.verts.ensure_lookup_table()
    adj = {}
    for e in bm.edges:
        if not e.is_boundary:
            continue
        a, b = e.verts
        if a.index not in jacket_idx:
            continue
        adj.setdefault(a.index, []).append(b.index)
        adj.setdefault(b.index, []).append(a.index)
    # walk every boundary loop
    loops, seen = [], set()
    for s0 in adj:
        if s0 in seen:
            continue
        loop, prev, cur = [s0], None, s0
        seen.add(s0)
        while True:
            nxt = [n for n in adj[cur] if n != prev]
            if not nxt or nxt[0] == s0:
                break
            prev, cur = cur, nxt[0]
            if cur in seen:
                break
            loop.append(cur)
            seen.add(cur)
        loops.append(loop)
    main = max(loops, key=len)
    co = [bm.verts[i].co for i in main]
    zmin = min(c.z for c in co)
    n = len(main)

    def hem_edge(k):
        c0, c1 = co[k], co[(k + 1) % n]
        d = c1 - c0
        return abs(d.z) < 0.9 * math.hypot(d.x, d.y) and max(c0.z, c1.z) < zmin + band

    flags = [hem_edge(k) for k in range(n)]
    if all(flags):
        return [main]
    start = flags.index(False)            # rotate so runs do not wrap
    runs, cur = [], []
    for j in range(1, n + 1):
        k = (start + j) % n
        if flags[k]:
            if not cur:
                cur = [main[k]]
            cur.append(main[(k + 1) % n])
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 4]


def extend_hem(obj, body, rig, P, height, knee_z):
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    uv_layer = bm.loops.layers.uv.active
    deform = bm.verts.layers.deform.verify()
    jacket_idx = set(v.index for v in bm.verts)
    chains = hem_chains(bm, jacket_idx)
    allv = [bm.verts[i] for c in chains for i in c]
    hem_z = sum(v.co.z for v in allv) / len(allv)
    cut = P.get("cut_above_hem", 0.0)
    if cut > 0.0:
        # i011: the suit's bottom 2-3 cm is a rolled hem allowance whose faces point INWARD (probe_coat3 on the
        # i010 coat: every front ray at z 0.70-0.72 hits an inward normal, the shell above and the extension
        # below face out) - welding / straightening that roll never removed the dark band. Cut the jacket on a
        # clean horizontal plane above the roll, drop everything below, and hang the extension from the cut.
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=(0.0, 0.0, hem_z + cut),
                               plane_no=(0.0, 0.0, 1.0), clear_inner=True)
        bm.verts.ensure_lookup_table()
        bm.verts.index_update()
        bm.faces.ensure_lookup_table()
        jacket_idx = set(v.index for v in bm.verts)
        chains = hem_chains(bm, jacket_idx, band=0.004)
        allv = [bm.verts[i] for c in chains for i in c]
        hem_z = sum(v.co.z for v in allv) / len(allv)
    target_z = knee_z * P["hem_to_knee"]
    ext = max(hem_z - target_z, 0.05)
    K = P["rings"]
    # UV scale (uv units per metre) from the jacket's own edges
    tot_uv = tot_3d = 0.0
    for f in bm.faces:
        for l in f.loops:
            l2 = l.link_loop_next
            tot_uv += (l2[uv_layer].uv - l[uv_layer].uv).length
            tot_3d += (l2.vert.co - l.vert.co).length
    S = tot_uv / max(tot_3d, 1e-6)
    hips = rig.pose.bones.get("mixamorig:Hips") if rig else None
    hip_c = (rig.matrix_world @ hips.head) if hips else Vector((0, 0, 0.53 * height))
    center = Vector((hip_c.x, hip_c.y, 0.0))
    leg_bvh = _leg_bvh(body, hem_z)
    rng = np.random.default_rng(P["seed"])
    fold_ph = float(rng.uniform(0, 2 * math.pi))
    hips_group = obj.vertex_groups.get("mixamorig:Hips")
    new_faces = []
    seam = []
    collapsed = 0
    chain_verts = [[bm.verts[i] for i in chain] for chain in chains]   # resolve before any weld re-indexes
    for verts in chain_verts:
        # the suit's hem ends in a ~3 mm turned-in strip (outer skin -> inner edge); smooth shading across that
        # fold draws a dark band. Collapse it: move each hem vertex onto the outer row just above it.
        # i010: WELD each hem vertex into that outer-row vertex (i004-i009 only moved it there, which left the
        # strip's faces degenerate but still attached - they broke the winding test and the shading at the seam).
        # The outer row becomes the boundary the extension hangs from.
        cset = set(verts)
        targetmap = {}
        for v in (verts if cut <= 0.0 else []):
            best, bd = None, 1e9
            for e in v.link_edges:
                o = e.other_vert(v)
                if o in cset or o.co.z < v.co.z - 0.001:
                    continue
                d = (o.co - v.co).length
                if d < bd:
                    best, bd = o, d
            if best is not None and bd < 0.011 and (best.co.z - v.co.z) < 0.009:
                targetmap[v] = best
        if targetmap:
            bmesh.ops.weld_verts(bm, targetmap=targetmap)
            collapsed += len(targetmap)
            merged = []
            for v in verts:
                w = targetmap.get(v, v)
                if not merged or merged[-1] is not w:
                    merged.append(w)
            verts = [v for v in merged if v.is_valid]
            bm.verts.ensure_lookup_table()
            bm.verts.index_update()
        faces, rings = _extrude_chain(bm, verts, uv_layer, deform, ext, K, S, center, leg_bvh, fold_ph,
                                      hips_group, P)
        new_faces += faces
        seam += [v for ring in rings[:3] for v in ring[1:-1]]     # hem + 2 rings, not the front / vent edges
        straighten_columns(verts, rings, up_steps=3, down_ring=3)
    # blend the old hem into the extension (the suit's hem curls in slightly -> a dark crease otherwise)
    for _ in range(4):
        bmesh.ops.smooth_vert(bm, verts=seam, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=False)
    bm.to_mesh(me)
    bm.free()
    # the OBJ's imported custom split normals stop at the old hem (its last row curls inward): drop them so
    # jacket and extension shade as one smooth surface
    if me.has_custom_normals:
        me.normals_split_custom_set([(0.0, 0.0, 0.0)] * len(me.loops))
    for poly in me.polygons:
        poly.use_smooth = True
    me.update()
    return {"hem_z": round(hem_z, 3), "new_hem_z": round(hem_z - ext, 3), "chains": [len(c) for c in chains],
            "cut_above_hem": cut,
            "hem_strip_collapsed": collapsed,
            "faces_added": len(new_faces), "uv_per_m": round(S, 3)}


def _up_neighbour(v, exclude):
    best, bz = None, v.co.z + 0.004
    for e in v.link_edges:
        o = e.other_vert(v)
        if o in exclude:
            continue
        if o.co.z > bz:
            best, bz = o, o.co.z
    return best


def straighten_columns(chain, rings, up_steps=3, down_ring=3):
    """The suit jacket's last rows roll outward at the hem; continuing straight down from there leaves a
    downward-facing ledge (a dark band in every render). Put each column - `up_steps` jacket vertices above
    the hem, the hem, and the first rings - on the straight line from the highest of them to ring
    `down_ring`, so jacket and extension form one continuous panel."""
    chain_set = set(chain)
    ring_set = set(v for r in rings for v in r)
    for i, hv in enumerate(chain):
        col = [hv]
        cur = hv
        for _ in range(up_steps):
            nxt = _up_neighbour(cur, chain_set | ring_set | set(col))
            if nxt is None:
                break
            col.insert(0, nxt)
            cur = nxt
        if len(col) < 2 or down_ring >= len(rings):
            continue
        top = col[0].co.copy()
        bot = rings[down_ring][i].co.copy()
        span = top.z - bot.z
        if span <= 1e-4:
            continue
        for v in col[1:] + [rings[k][i] for k in range(1, down_ring)]:
            t = (top.z - v.co.z) / span
            v.co.x = top.x + (bot.x - top.x) * t
            v.co.y = top.y + (bot.y - top.y) * t


def _extrude_chain(bm, verts, uv_layer, deform, ext, K, S, center, leg_bvh, fold_ph, hips_group, P):
    # per chain vertex: hem UV from the face owning the boundary edge; edge orientation for winding
    uv_of = {}
    for i in range(len(verts) - 1):
        a, b = verts[i], verts[i + 1]
        e = bm.edges.get((a, b))
        if e is None or not e.link_faces:
            continue
        f = e.link_faces[0]
        for l in f.loops:
            if l.vert in (a, b):
                uv_of.setdefault((l.vert.index, i), l[uv_layer].uv.copy())
    rings = [verts]
    for k in range(1, K + 1):
        t = k / K
        down = ext * t
        ring = []
        for v in verts:
            p = v.co.copy()
            r = Vector((p.x - center.x, p.y - center.y, 0.0))
            rh = r.normalized() if r.length > 1e-6 else Vector((0, -1, 0))
            theta = math.atan2(rh.y, rh.x)
            fold = P["fold_amp"] * t ** 1.3 * math.sin(P["fold_count"] * theta + fold_ph)
            q = p + Vector((0, 0, -down)) + rh * (P["flare"] * down + fold)
            # keep clear of the legs
            loc, nrm, _i, dist = leg_bvh.find_nearest(q) if leg_bvh else (None, None, None, None)
            if loc is not None:
                d = q - loc
                if d.dot(nrm) < 0 or d.length < P["leg_clearance"]:
                    q = loc + nrm * P["leg_clearance"]
            nv = bm.verts.new(q)
            # weights: hem weights, blended toward Hips going down
            src = v[deform]
            dst = nv[deform]
            blend = 0.55 * t
            for gi, w in src.items():
                dst[gi] = w * (1.0 - blend)
            if hips_group is not None:
                dst[hips_group.index] = dst.get(hips_group.index, 0.0) + blend
            ring.append(nv)
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    new_faces = []
    # winding: opposite to the JACKET face on each hem edge, decided ONCE before any ring exists. (i003-i010
    # re-read e.link_faces[0] for every ring; once ring 1 existed that could be the new ring-1 face, so rings
    # 2..K got the opposite winding, the orientation fix-up then flipped everything to the majority and ring 1
    # ended up inside-out = the dark band at the old hem in every render - lookdev/i011/dbg-hem-front.png.)
    flips = []
    for i in range(len(verts) - 1):
        flip = False
        e = bm.edges.get((verts[i], verts[i + 1]))
        if e is not None and e.link_faces:
            f = e.link_faces[0]
            for l in f.loops:
                if l.vert == verts[i] and l.link_loop_next.vert == verts[i + 1]:
                    flip = True
        flips.append(flip)
    for k in range(1, K + 1):
        top, bot = rings[k - 1], rings[k]
        for i in range(len(verts) - 1):
            a, b = top[i], top[i + 1]
            flip = flips[i]
            quad = (b, a, bot[i], bot[i + 1]) if flip else (a, b, bot[i + 1], bot[i])
            try:
                nf = bm.faces.new(quad)
            except ValueError:
                continue
            nf.smooth = True
            for l in nf.loops:
                col = next(j for j in (i, i + 1) if l.vert in (top[j], bot[j]))
                base_uv = uv_of.get((verts[col].index, i)) or uv_of.get((verts[col].index, i - 1)) or \
                    uv_of.get((verts[col].index, col)) or Vector((0.5, 0.0))
                level = k if l.vert == bot[col] else k - 1
                l[uv_layer].uv = (base_uv.x, base_uv.y - ext * (level / K) * S)
            new_faces.append(nf)
    # the skirt must face OUT (away from the legs). i003-i009 compared against the jacket face on the hem edge,
    # but after the hem-strip collapse that face is degenerate, the vote came out wrong and the whole extension
    # was inside-out (probe_coat3: every ray below z 0.69 hit an inward normal) - smooth shading across the
    # flip drew the dark band at the old hem. Decide geometrically instead: radial direction from the hip axis.
    bm.normal_update()
    votes = 0.0
    for f in new_faces:
        c = f.calc_center_median()
        r = Vector((c.x - center.x, c.y - center.y, 0.0))
        if r.length > 1e-6:
            votes += f.normal.dot(r.normalized()) * f.calc_area()
    if votes < 0:
        bmesh.ops.reverse_faces(bm, faces=new_faces)
    return new_faces, rings


def _leg_bvh(body, below_z):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    mw = body.matrix_world
    verts = [mw @ v.co for v in mesh.vertices]
    polys = [tuple(p.vertices) for p in mesh.polygons if max(verts[i].z for i in p.vertices) < below_z + 0.05]
    ev.to_mesh_clear()
    if not polys:
        return None
    return BVHTree.FromPolygons(verts, polys, all_triangles=False)


# ----------------------------------------------------------------------------------------------- material

def twill_normal(path, size=512, seed=3):
    """Tileable 2/1 twill: diagonal ribs + yarn noise -> tangent-space normal PNG (Non-Color)."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    rib = np.sin((x + y) * (2 * np.pi * 24 / size))              # 24 diagonal ribs per tile
    rng = np.random.default_rng(seed)
    g = rng.random((64, 64)).astype(np.float32)
    idx = (np.arange(size) * 64 // size)
    noise = g[idx][:, idx]
    h = 0.6 * rib + 0.25 * (noise - 0.5) + 0.15 * np.sin(x * (2 * np.pi * 96 / size))
    dy, dx = np.gradient(h)
    k = 1.2
    nx, ny, nz = -dx * k, -dy * k, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[..., 0] = nx / ln * 0.5 + 0.5
    rgba[..., 1] = ny / ln * 0.5 + 0.5
    rgba[..., 2] = nz / ln * 0.5 + 0.5
    name = "evia_twill_normal"
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=True)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


def coat_material(P, normal_img, name="EviaLabCoat"):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*P["color"], 1.0)
    bsdf.inputs["Roughness"].default_value = P["roughness"]
    bsdf.inputs["Sheen Weight"].default_value = P["sheen"]
    bsdf.inputs["Sheen Roughness"].default_value = 0.6
    bsdf.inputs["Subsurface Weight"].default_value = 0.0      # i012: EEVEE SSS speckle in the hair's shadow
    bsdf.inputs["Subsurface Radius"].default_value = (1.0, 1.0, 1.0)
    bsdf.inputs["Subsurface Scale"].default_value = 0.002
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (P["twill_scale"], P["twill_scale"], 1)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = normal_img
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = 0.45
    nt.links.new(uv.outputs[0], mapping.inputs[0])
    nt.links.new(mapping.outputs[0], tex.inputs[0])
    nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    mat.use_backface_culling = False
    return mat


def label_patch(obj, P, height, shoulder_z):
    """Assign faces on her left chest to material slot 1 and give them a 0..1 `label` UV (planar x/z)."""
    me = obj.data
    cx = P["label_center"][0] * height / 1.605
    cz = shoulder_z - 0.165 * height / 1.605
    hw, hh = P["label_size"][0] / 2, P["label_size"][1] / 2
    label_uv = me.uv_layers.new(name="label")
    mw = obj.matrix_world
    picked = []
    # frontmost faces in the rectangle (the lapel is excluded by x: label sits outboard of the lapel edge)
    for p in me.polygons:
        c = mw @ p.center
        n = (mw.to_3x3() @ p.normal).normalized()
        if abs(c.x - cx) < hw + 0.004 and abs(c.z - cz) < hh + 0.004 and n.y < -0.5:
            picked.append(p)
    # keep only the outermost layer: drop a face if another picked face sits >4 mm in front of it nearby
    cs = [(p, mw @ p.center) for p in picked]
    kept = [p for p, c in cs
            if not any(((c2 - c).xz.length < 0.012 and c2.y < c.y - 0.004) for _q, c2 in cs)]
    for p in kept:
        p.material_index = 1
    for p in me.polygons:
        for li in p.loop_indices:
            if p.material_index == 1:
                co = mw @ me.vertices[me.loops[li].vertex_index].co
                label_uv.data[li].uv = ((co.x - (cx - hw)) / (2 * hw), (co.z - (cz - hh)) / (2 * hh))
            else:
                label_uv.data[li].uv = (0.0, 0.0)
    me.uv_layers.active_index = 0
    return {"label_center": (round(cx, 3), round(cz, 3)), "label_faces": len(kept)}


# ----------------------------------------------------------------------------------------------- build

def push_outside(obj, others, clearance, zmax):
    """Move coat vertices below zmax out of the body / garments under it (trousers poked through at the hips)."""
    if not others:
        return 0
    import evia_hair
    bvh = evia_hair.collision_bvh(others)
    mw = obj.matrix_world
    inv = mw.inverted()
    moved = 0
    for v in obj.data.vertices:
        p = mw @ v.co
        if p.z > zmax:
            continue
        loc, n, _i, dist = bvh.find_nearest(p)
        if loc is None:
            continue
        d = p - loc
        if d.dot(n) < 0 or d.length < clearance:
            v.co = inv @ (loc + n * clearance)
            moved += 1
    obj.data.update()
    return moved


def build(body, rig, work_dir, height, under=(), **overrides):
    P = dict(DEFAULTS)
    P.update(overrides)
    coat = E.add_part(body, "clothes", P["asset"])
    coat.name = "Evia.labcoat"
    me = coat.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv_layer = bm.loops.layers.uv.active
    comps = _components(bm)
    kinds = [classify(c, uv_layer, height) for c in comps]
    kill = [v for c, k in zip(comps, kinds) if k == "drop" for v in c]
    buttons = [c for c, k in zip(comps, kinds) if k == "button"]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    # knee height from the rig
    knee = rig.pose.bones.get("mixamorig:LeftLeg") if rig else None
    knee_z = (rig.matrix_world @ knee.head).z if knee else 0.285 * height
    shoulder = rig.pose.bones.get("mixamorig:LeftArm") if rig else None
    shoulder_z = (rig.matrix_world @ shoulder.head).z if shoulder else 0.79 * height
    info = extend_hem(coat, body, rig, P, height, knee_z)
    hips = rig.pose.bones.get("mixamorig:Hips") if rig else None
    hip_z = (rig.matrix_world @ hips.head).z if hips else 0.53 * height
    info["pushed_out"] = push_outside(coat, [body] + [u for u in under if u is not None], 0.010, hip_z + 0.06)
    # the top under the coat poked through the coat front; keep the whole body of the coat (not the collar)
    # 6 mm outside the garments under it
    info["pushed_out_torso"] = push_outside(coat, [u for u in under if u is not None], 0.006, shoulder_z - 0.07)
    info["buttons"] = len(buttons)
    tw = twill_normal(os.path.join(work_dir, "evia_twill_normal.png"))
    me.materials.clear()
    me.materials.append(coat_material(P, tw))
    label_mat = coat_material(P, tw, "EviaCoatLabel")
    me.materials.append(label_mat)
    info.update(label_patch(coat, P, height, shoulder_z))     # after the slots exist (indices are clamped)
    import evia_garments
    info["delete_removed"] = evia_garments.restrict_delete_group(body, coat, P["asset"])
    # i016: show the chest skin between the open lapels again (only where the coat does not cover it) - the
    # V-neck top otherwise showed its own inside there
    def front_chest(c):          # front of the torso (she faces -Y; the body axis is at y ~ 0)
        return c[1] < -0.02 and shoulder_z - 0.30 < c[2] < shoulder_z + 0.08 and abs(c[0]) < 0.12
    info["chest_uncovered"] = evia_garments.uncover(body, coat, "Delete." + P["asset"], front_chest)
    print("EVIA LABCOAT", info)
    coat["evia_labcoat"] = str(info)
    return coat
