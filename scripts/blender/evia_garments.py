"""Garment helpers for Evia's outfits (MPFB MHCLO clothes from the CC0 packs).

  add_garment(body, spec, height) fits an asset with MPFB (rig must exist -> weighted + parented), optionally
  keeps only some loose parts ("upper" / "lower" / "all"), recolours per part, and trims the body's delete
  mask to skin that is really inside what was kept (MPFB's mask covers the whole original asset).

spec = {"asset": "female_sportsuit01", "keep": "all",
        "colors": {"upper": ((r, g, b), roughness), "lower": ((r, g, b), roughness)},
        "sheen": 0.3, "keep_normal_map": True,
        "neckline": {"depth": 0.075, "half_width": 0.075},   # optional: cut a V-neck into a crew-neck top
        "delete_suffix": "trousers"}                          # optional: own delete group (asset used twice)
Colours are linear RGB.
"""

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import evia_mpfb as E


def components(bm):
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


def region_of(comp, height):
    zmin = min(v.co.z for v in comp)
    zmax = max(v.co.z for v in comp)
    if zmax < 0.16 * height:
        return "feet"
    if zmin < 0.25 * height:
        return "lower"
    return "upper"


def principled_of(mat):
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            return n
    return None


def fabric_from(mat, rgb, rough, sheen, keep_normal_map, name, normal_strength=None):
    new = mat.copy()
    new.name = name
    nt = new.node_tree
    bsdf = principled_of(new)
    for link in list(bsdf.inputs["Base Color"].links):
        nt.links.remove(link)
    for link in list(bsdf.inputs["Alpha"].links):
        nt.links.remove(link)
    bsdf.inputs["Alpha"].default_value = 1.0
    bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    for sock in ("Roughness", "Specular IOR Level"):
        for link in list(bsdf.inputs[sock].links):
            nt.links.remove(link)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Specular IOR Level"].default_value = 0.35
    bsdf.inputs["Sheen Weight"].default_value = sheen
    bsdf.inputs["Sheen Roughness"].default_value = 0.55
    if not keep_normal_map:
        for link in list(bsdf.inputs["Normal"].links):
            nt.links.remove(link)
    elif normal_strength is not None:
        for n in nt.nodes:
            if n.type == "NORMAL_MAP":
                n.inputs["Strength"].default_value = normal_strength
    new.use_backface_culling = False
    new.surface_render_method = "DITHERED"
    return new


def restrict_delete_group(body, garment, asset):
    """Keep in `Delete.<asset>` only body vertices within 3.5 cm of what was kept of `garment` (skin under
    removed parts is shown again; skin under kept parts stays hidden so it cannot poke through)."""
    grp = body.vertex_groups.get("Delete." + asset)
    if grp is None:
        return 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = garment.evaluated_get(depsgraph)
    m = ev.to_mesh()
    verts = [garment.matrix_world @ v.co for v in m.vertices]
    polys = [tuple(p.vertices) for p in m.polygons]
    ev.to_mesh_clear()
    if not polys:
        return 0
    bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False)
    import evia_skin
    co = evia_skin.shaped_coords(body)
    mw = body.matrix_world
    members = [v.index for v in body.data.vertices
               for g in v.groups if g.group == grp.index and g.weight > 0.5]
    drop = []
    for i in members:
        p = mw @ Vector(co[i])
        loc, n, _f, dist = bvh.find_nearest(p)
        if loc is None or dist > 0.035:          # far from what was kept: that skin is visible again
            drop.append(i)
    if drop:
        grp.remove(drop)
    return len(drop)


def auto_hide_under(body, garment, name, inside=0.025, outside=0.006, edge_clear=0.03):
    """Hide body skin that is covered by `garment` (for assets whose MHCLO deletes little or nothing, e.g. the
    fisherman sweater: skin poked through the knit). A body vertex is hidden when the nearest garment surface
    is within `inside` (skin under the cloth) or the skin pokes out by less than `outside`, AND it is at least
    `edge_clear` away from the garment's open edges (neck, cuffs, hem) so no hole shows at an opening.
    Adds to (or creates) the MPFB-style `Delete.<name>` group + inverted MASK modifier."""
    import bmesh as _bm
    from mathutils.kdtree import KDTree
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = garment.evaluated_get(depsgraph)
    m = ev.to_mesh()
    verts = [garment.matrix_world @ v.co for v in m.vertices]
    polys = [tuple(p.vertices) for p in m.polygons]
    b = _bm.new()
    b.from_mesh(m)
    edge_pts = [garment.matrix_world @ v.co for v in b.verts if any(e.is_boundary for e in v.link_edges)]
    b.free()
    ev.to_mesh_clear()
    bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False)
    kd = KDTree(max(len(edge_pts), 1))
    for i, p in enumerate(edge_pts):
        kd.insert(p, i)
    kd.balance()
    import evia_skin
    co = evia_skin.shaped_coords(body)
    is_body = evia_skin.group_weights(body, "body") > 0.5
    mw = body.matrix_world
    hide = []
    for i in range(len(co)):
        if not is_body[i]:
            continue
        p = mw @ Vector(co[i])
        loc, n, _f, dist = bvh.find_nearest(p)
        if loc is None or dist > inside:
            continue
        if (p - loc).dot(n) > outside:
            continue
        if edge_pts and kd.find(p)[2] < edge_clear:
            continue
        hide.append(i)
    gname = "Delete." + name
    grp = body.vertex_groups.get(gname) or body.vertex_groups.new(name=gname)
    if hide:
        grp.add(hide, 1.0, "ADD")
    if not any(md.type == "MASK" and md.vertex_group == gname for md in body.modifiers):
        md = body.modifiers.new(name=gname, type="MASK")
        md.vertex_group = gname
        md.invert_vertex_group = True
    return len(hide)


def knit_detail(size, tiles, seed=9):
    """Tileable rib-knit height field -> tangent normal xy (size x size): columns of V-shaped stitches."""
    import numpy as np
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    cw = size / tiles                  # stitch column width (px)
    ch = cw * 0.8                      # stitch row height
    fx = (x % cw) / cw - 0.5           # -0.5..0.5 across a column
    fy = (y % ch) / ch
    # each stitch = two leaning loops forming a V
    lean = np.where(fx < 0, fx + 0.25, fx - 0.25)
    loop = np.exp(-((lean + (fy - 0.5) * 0.35 * np.sign(fx)) / 0.16) ** 2) * np.sin(np.pi * fy) ** 0.8
    rib = 0.35 * np.cos(2 * np.pi * (x / cw))                 # rib valleys between columns
    rng = np.random.default_rng(seed)
    g = rng.random((64, 64)).astype(np.float32)
    idx = (np.arange(size) * 64 // size)
    h = loop + 0.25 * rib + 0.08 * g[idx][:, idx]
    dy, dx = np.gradient(h)
    k = 1.6
    return -dx * k, -dy * k


def knit_normal_map(base_img, path, tiles):
    """Combine a garment's own normal map (folds / seams) with a rib-knit detail ('whiteout' blend)."""
    import numpy as np
    if max(base_img.size) > 2048:            # 4K pack maps: work (and ship) at 2K
        base_img = base_img.copy()
        base_img.scale(2048, 2048)
    w, h = base_img.size
    a = np.zeros(w * h * 4, dtype=np.float32)
    base_img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)
    n1 = a[..., :3] * 2 - 1
    dx, dy = knit_detail(w, tiles) if w == h else knit_detail(min(w, h), tiles)
    nx = n1[..., 0] * 0.7 + dx
    ny = n1[..., 1] * 0.7 + dy
    nz = np.maximum(n1[..., 2], 0.2)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.ones((h, w, 4), dtype=np.float32)
    out[..., 0] = nx / ln * 0.5 + 0.5
    out[..., 1] = ny / ln * 0.5 + 0.5
    out[..., 2] = nz / ln * 0.5 + 0.5
    img = bpy.data.images.new("evia_knit_normal", w, h, alpha=True)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(out.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


def _boundary_loops(bm):
    """Vertex loops of the boundary edges (open edges of a garment: neck, cuffs, hem)."""
    edges = [e for e in bm.edges if e.is_boundary]
    adj = {}
    for e in edges:
        a, b = e.verts
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    seen = set()
    loops = []
    for v in adj:
        if v in seen:
            continue
        loop = []
        stack = [v]
        seen.add(v)
        while stack:
            x = stack.pop()
            loop.append(x)
            for y in adj[x]:
                if y not in seen:
                    seen.add(y)
                    stack.append(y)
        loops.append(loop)
    return loops


def cut_neckline(g, body, asset, depth=0.075, half_width=0.075, skin_margin=0.004):
    """Turn a crew-neck top into a V-neck (i016: the crew collar read as a stiff neck brace with a skin-coloured
    notch at the front; ref4 shows a light V-neck top). The V's point sits `depth` below the front of the crew
    neckline; its sides rise to |x| = half_width at the crew-neck height. Front faces are bisected along the
    two V planes (clean straight edges) and everything above the V is removed; body skin inside the V is taken
    out of the garment's delete group again (with `skin_margin` still hidden under the new edge)."""
    import numpy as np
    me = g.data
    bm = bmesh.new()
    bm.from_mesh(me)
    loops = _boundary_loops(bm)
    if not loops:
        bm.free()
        return {}
    neck = max(loops, key=lambda lp: sum(v.co.z for v in lp) / len(lp))
    cy = sum(v.co.y for v in neck) / len(neck)
    front = min(neck, key=lambda v: v.co.y + 4.0 * abs(v.co.x))
    B = Vector((0.0, front.co.y, front.co.z - depth))
    rise = depth + 0.02

    def inside(p, margin=0.0):
        return p.y < cy and (p.z - B.z + margin) * half_width > rise * abs(p.x)

    for s in (1.0, -1.0):
        n = Vector((-rise, 0.0, s * half_width)).normalized()
        geom_f = [f for f in bm.faces if f.calc_center_median().y < cy and
                  f.calc_center_median().x * s > -0.01 and f.calc_center_median().z > B.z - 0.03]
        geom = set()
        for f in geom_f:
            geom.add(f)
            geom.update(f.edges)
            geom.update(f.verts)
        bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-5, plane_co=B, plane_no=n)
    kill = [f for f in bm.faces if inside(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    # show the skin inside the V again
    grp = body.vertex_groups.get("Delete." + asset)
    shown = 0
    if grp is not None:
        import evia_skin
        co = evia_skin.shaped_coords(body)
        mw = body.matrix_world
        gmi = g.matrix_world.inverted()
        drop = []
        for v in body.data.vertices:
            if not any(x.group == grp.index and x.weight > 0.5 for x in v.groups):
                continue
            p = gmi @ (mw @ Vector(co[v.index]))
            if inside(p, -skin_margin):
                drop.append(v.index)
        if drop:
            grp.remove(drop)
        shown = len(drop)
    info = {"faces_removed": len(kill), "v_point": [round(x, 4) for x in B], "skin_shown": shown}
    print("EVIA NECKLINE", asset, info)
    return info


def uncover(body, garment, group_name, region, out_dist=0.05, in_dist=0.012):
    """Take body vertices OUT of a delete group when `garment` does not actually cover them: no hit along the
    skin normal (outward, within out_dist) and no garment surface just behind the skin (inward, within in_dist -
    that would be skin poking through). Only vertices where region(co) is True are considered.
    i016: MPFB's coat mask (restricted to 3.5 cm around the coat) still hid the chest between the open lapels,
    so the new V-neck showed the inside of the top instead of skin."""
    import numpy as np
    import evia_skin
    grp = body.vertex_groups.get(group_name)
    if grp is None:
        return 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = garment.evaluated_get(depsgraph)
    m = ev.to_mesh()
    verts = [garment.matrix_world @ v.co for v in m.vertices]
    polys = [tuple(p.vertices) for p in m.polygons]
    ev.to_mesh_clear()
    bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False)
    co = evia_skin.shaped_coords(body)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    for v in bm.verts:
        v.co = Vector(co[v.index])
    bm.normal_update()
    nrm = [v.normal.copy() for v in bm.verts]
    bm.free()
    mw = body.matrix_world
    drop = []
    for v in body.data.vertices:
        if not any(x.group == grp.index and x.weight > 0.5 for x in v.groups):
            continue
        if not region(co[v.index]):
            continue
        p = mw @ Vector(co[v.index])
        n = (mw.to_3x3() @ nrm[v.index]).normalized()
        hit_out = bvh.ray_cast(p + n * 0.0005, n, out_dist)[0]
        hit_in = bvh.ray_cast(p - n * 0.0005, -n, in_dist)[0]
        if hit_out is None and hit_in is None:
            drop.append(v.index)
    if drop:
        grp.remove(drop)
    return len(drop)


def rename_delete_group(body, asset, suffix):
    """Give a garment its own delete group (MPFB names it after the asset; a second use of the same asset -
    the lab coat is made from toigo_female_suit_2 too - would otherwise merge / re-trim the same group)."""
    old = "Delete." + asset
    grp = body.vertex_groups.get(old)
    if grp is None:
        return None
    new = old + "." + suffix
    grp.name = new
    for md in body.modifiers:
        if md.type == "MASK" and md.vertex_group == old:
            md.vertex_group = new
            md.name = new
    return new


def add_garment(body, spec, height, work_dir=None):
    g = E.add_part(body, "clothes", spec["asset"])
    base_mat = g.material_slots[0].material if g.material_slots else None
    me = g.data
    bm = bmesh.new()
    bm.from_mesh(me)
    comps = components(bm)
    regions = [region_of(c, height) for c in comps]
    keep = spec.get("keep", "all")
    if keep != "all":
        kill = [v for c, r in zip(comps, regions) if r != keep for v in c]
        bmesh.ops.delete(bm, geom=kill, context="VERTS")
        bm.to_mesh(me)
        bm.free()
        me.update()
        bm = bmesh.new()
        bm.from_mesh(me)
        comps = components(bm)
        regions = [region_of(c, height) for c in comps]
    if spec.get("drop_arms"):
        # a top worn UNDER the lab coat: its sleeves are never seen, but once the arms are lowered they poke
        # through the coat's shoulders (lavender patches in i010 back34). Drop every vertex weighted to the
        # arm / hand bones above the threshold.
        arm = {vg.index for vg in g.vertex_groups if ("Arm" in vg.name or "Hand" in vg.name)}
        dl = bm.verts.layers.deform.verify()
        kill = [v for v in bm.verts if sum(w for gi, w in v[dl].items() if gi in arm) > spec["drop_arms"]]
        bmesh.ops.delete(bm, geom=kill, context="VERTS")
        bm.to_mesh(me)
        bm.free()
        me.update()
        bm = bmesh.new()
        bm.from_mesh(me)
        comps = components(bm)
        regions = [region_of(c, height) for c in comps]
    colors = spec.get("colors", {})
    slots = []
    me.materials.clear()
    for region in ("upper", "lower", "feet"):
        if region in colors or (not colors and region == "upper"):
            rgb, rough = colors.get(region, ((0.6, 0.6, 0.6), 0.8))
            slots.append(region)
            me.materials.append(fabric_from(base_mat, rgb, rough, spec.get("sheen", 0.25),
                                            spec.get("keep_normal_map", True),
                                            "Evia.%s.%s" % (spec["asset"], region),
                                            spec.get("normal_strength")))
    bm.faces.ensure_lookup_table()
    face_region = {}
    for c, r in zip(comps, regions):
        for v in c:
            for f in v.link_faces:
                face_region[f.index] = r
    for f in bm.faces:
        r = face_region.get(f.index, "upper")
        f.material_index = slots.index(r) if r in slots else 0
    bm.to_mesh(me)
    bm.free()
    me.update()
    if spec.get("knit") and work_dir:
        import os
        for mat in me.materials:
            for n in mat.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and n.image.colorspace_settings.name == "Non-Color":
                    n.image = knit_normal_map(n.image, os.path.join(work_dir, "evia_knit_normal.png"),
                                              spec["knit"])
                    break
    removed = restrict_delete_group(body, g, spec["asset"]) if keep != "all" else 0
    hidden = auto_hide_under(body, g, spec["asset"]) if spec.get("hide_under") else 0
    if spec.get("neckline"):
        cut_neckline(g, body, spec["asset"], **spec["neckline"])
    if spec.get("delete_suffix"):
        rename_delete_group(body, spec["asset"], spec["delete_suffix"])
        g.name = "Evia.%s.%s" % (spec["asset"], spec["delete_suffix"])
    print("EVIA GARMENT", spec["asset"], "keep", keep, "slots", slots, "delete trimmed", removed,
          "auto-hidden", hidden)
    return g
