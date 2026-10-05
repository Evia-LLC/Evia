"""Helpers for the Evia lounge scenes (Blender 4.5 LTS, Cycles).

Imported by room_lounge.py and room_products_hero.py (same folder). Everything is
procedural: primitives, bmesh, shader nodes. No external textures, HDRIs or models.
All randomness goes through a seeded random.Random instance passed in by the caller.
"""
import math
import random

import bpy
import bmesh
from mathutils import Vector, Matrix


# ----------------------------------------------------------------------------- colour

def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h, alpha=1.0):
    """sRGB hex -> linear RGBA tuple (Blender colour sockets are linear)."""
    h = h.lstrip('#')
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (alpha,)


def kelvin(k, alpha=1.0):
    """Approximate black-body colour (Tanner Helland fit), returned linear, max channel 1."""
    t = k / 100.0
    if t <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(t) - 161.1195681661
        b = 0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * ((t - 60) ** -0.1332047592)
        g = 288.1221695283 * ((t - 60) ** -0.0755148492)
        b = 255.0
    rgb = [srgb_to_lin(max(0.0, min(255.0, v)) / 255.0) for v in (r, g, b)]
    m = max(rgb)
    return tuple(v / m for v in rgb) + (alpha,)


# ----------------------------------------------------------------------------- scene

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.unit_settings.system = 'METRIC'
    return scn


def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def link(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj


# ----------------------------------------------------------------------------- node helpers

class NodeBuilder:
    """Tiny helper to write node graphs compactly."""

    def __init__(self, tree):
        self.tree = tree
        self.nodes = tree.nodes
        self.links = tree.links
        self.x = 0

    def node(self, kind, **props):
        n = self.nodes.new(kind)
        n.location = (self.x, 0)
        self.x += 200
        for k, v in props.items():
            if k.startswith('in_'):
                continue
            setattr(n, k, v)
        return n

    def set(self, node, **inputs):
        for k, v in inputs.items():
            node.inputs[k].default_value = v
        return node

    def link(self, a, b):
        self.links.new(a, b)


def new_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (1200, 0)
    return m, NodeBuilder(nt), out


def principled(name, base, rough=0.5, metallic=0.0, spec=0.5, coat=0.0, sheen=0.0,
               sss=0.0, transmission=0.0, ior=1.45, alpha=1.0, emission=None, estrength=0.0,
               bump=None, base_socket=None, rough_socket=None):
    """Principled material. `bump` = (scale, strength, detail, distortion) noise bump."""
    m, nb, out = new_material(name)
    p = nb.node('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = base if len(base) == 4 else tuple(base) + (1,)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Specular IOR Level'].default_value = spec
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Sheen Weight'].default_value = sheen
    p.inputs['Subsurface Weight'].default_value = sss
    p.inputs['Transmission Weight'].default_value = transmission
    p.inputs['IOR'].default_value = ior
    p.inputs['Alpha'].default_value = alpha
    if emission is not None:
        p.inputs['Emission Color'].default_value = emission
        p.inputs['Emission Strength'].default_value = estrength
    if bump:
        scale, strength, detail, dist = bump
        tc = nb.node('ShaderNodeTexCoord')
        nz = nb.node('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = scale
        nz.inputs['Detail'].default_value = detail
        nz.inputs['Distortion'].default_value = dist
        bp = nb.node('ShaderNodeBump')
        bp.inputs['Strength'].default_value = strength
        bp.inputs['Distance'].default_value = 0.01
        nb.link(tc.outputs['Object'], nz.inputs['Vector'])
        nb.link(nz.outputs['Fac'], bp.inputs['Height'])
        nb.link(bp.outputs['Normal'], p.inputs['Normal'])
    nb.link(p.outputs['BSDF'], out.inputs['Surface'])
    m['_bsdf'] = p.name
    return m


def emission_mat(name, color, strength, kelvin_node=None, falloff_view=False, indirect=1.0):
    """Pure emitter. Visible colour = color*strength.
    indirect < 1 keeps the emitter at full strength for camera and glossy rays (what you see, and its
    reflections) but lights diffuse surfaces with only `indirect` x strength (art-directed LED look)."""
    m, nb, out = new_material(name)
    e = nb.node('ShaderNodeEmission')
    e.inputs['Color'].default_value = color
    e.inputs['Strength'].default_value = strength
    if indirect < 1.0:
        lp = nb.node('ShaderNodeLightPath')
        mx = nb.node('ShaderNodeMath')
        mx.operation = 'MAXIMUM'
        nb.link(lp.outputs['Is Camera Ray'], mx.inputs[0])
        nb.link(lp.outputs['Is Glossy Ray'], mx.inputs[1])
        mr = nb.node('ShaderNodeMapRange')
        mr.inputs['To Min'].default_value = strength * indirect
        mr.inputs['To Max'].default_value = strength
        nb.link(mx.outputs['Value'], mr.inputs['Value'])
        nb.link(mr.outputs['Result'], e.inputs['Strength'])
    nb.link(e.outputs['Emission'], out.inputs['Surface'])
    return m


def glow_mat(name, color, strength, base=(0.9, 0.85, 0.8, 1), mix=1.0):
    """Diffuse+emission (e.g. an opal glass globe): principled with emission."""
    return principled(name, base, rough=0.35, emission=color, estrength=strength, sss=0.0)


def assign(obj, mat):
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
    return obj


# ----------------------------------------------------------------------------- meshes

def mesh_from_pydata(name, verts, faces, mat=None, col=None, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(ob)
    if mat:
        assign(ob, mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return ob


def add_modifier_bevel(ob, width, segments=4, angle=None):
    md = ob.modifiers.new('bevel', 'BEVEL')
    md.width = width
    md.segments = segments
    md.limit_method = 'ANGLE' if angle is not None else 'NONE'
    if angle is not None:
        md.angle_limit = angle
    md.harden_normals = False
    return md


def shade_smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def box(name, size, loc, rot_z=0.0, mat=None, col=None, bevel=0.0, seg=3):
    sx, sy, sz = size
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
         (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = mesh_from_pydata(name, v, f, mat, col)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    if bevel > 0:
        add_modifier_bevel(ob, bevel, seg)
        shade_smooth(ob)
    return ob


def cylinder(name, r, h, loc, mat=None, col=None, n=48, bevel=0.0, seg=3, r_top=None, cap=True):
    r_top = r if r_top is None else r_top
    v, f = [], []
    for i in range(n):
        a = 2 * math.pi * i / n
        v.append((r * math.cos(a), r * math.sin(a), 0))
    for i in range(n):
        a = 2 * math.pi * i / n
        v.append((r_top * math.cos(a), r_top * math.sin(a), h))
    for i in range(n):
        j = (i + 1) % n
        f.append((i, j, n + j, n + i))
    if cap:
        f.append(tuple(range(n - 1, -1, -1)))
        f.append(tuple(range(n, 2 * n)))
    ob = mesh_from_pydata(name, v, f, mat, col)
    ob.location = loc
    shade_smooth(ob)
    if bevel > 0:
        md = add_modifier_bevel(ob, bevel, seg, angle=math.radians(50))
    return ob


def uv_sphere(name, r, loc, mat=None, col=None, seg=32, rings=16, squash=1.0):
    v, f = [], []
    v.append((0, 0, -r * squash))
    for j in range(1, rings):
        th = math.pi * j / rings - math.pi / 2
        for i in range(seg):
            a = 2 * math.pi * i / seg
            v.append((r * math.cos(th) * math.cos(a), r * math.cos(th) * math.sin(a), r * math.sin(th) * squash))
    v.append((0, 0, r * squash))
    top = len(v) - 1
    for i in range(seg):
        f.append((0, 1 + (i + 1) % seg, 1 + i))
    for j in range(rings - 2):
        for i in range(seg):
            a = 1 + j * seg + i
            b = 1 + j * seg + (i + 1) % seg
            f.append((a, b, b + seg, a + seg))
    base = 1 + (rings - 2) * seg
    for i in range(seg):
        f.append((base + i, base + (i + 1) % seg, top))
    ob = mesh_from_pydata(name, v, f, mat, col, smooth=True)
    ob.location = loc
    return ob


def prism(name, pts2d, z0, z1, mat=None, col=None, cap_bottom=True, cap_top=True):
    """Extrude a closed 2D polygon (CCW, world XY) between z0 and z1."""
    n = len(pts2d)
    v = [(x, y, z0) for x, y in pts2d] + [(x, y, z1) for x, y in pts2d]
    f = []
    for i in range(n):
        j = (i + 1) % n
        f.append((i, j, n + j, n + i))
    if cap_bottom:
        f.append(tuple(range(n - 1, -1, -1)))
    if cap_top:
        f.append(tuple(range(n, 2 * n)))
    return mesh_from_pydata(name, v, f, mat, col)


def ribbon(name, pts3d, width_vec, mat=None, col=None, closed=False):
    """A flat strip following pts3d, offset by width_vec (constant vector) — used for LED tapes."""
    v = []
    for p in pts3d:
        v.append(tuple(p))
        v.append(tuple(Vector(p) + Vector(width_vec)))
    f = []
    n = len(pts3d)
    rng = n if closed else n - 1
    for i in range(rng):
        j = (i + 1) % n
        f.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
    return mesh_from_pydata(name, v, f, mat, col)


def tube(name, pts3d, radius, mat=None, col=None, closed=False, bevel_res=4, res=4):
    """Curve with round bevel through points (poly spline)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = bevel_res
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts3d) - 1)
    for i, p in enumerate(pts3d):
        sp.points[i].co = (p[0], p[1], p[2], 1)
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu)
    (col or bpy.context.scene.collection).objects.link(ob)
    if mat:
        cu.materials.append(mat)
    return ob


def catmull(pts, n_per=8, closed=False):
    """Catmull-Rom interpolate a list of Vector/tuples."""
    P = [Vector(p) for p in pts]
    out = []
    N = len(P)
    segs = N if closed else N - 1
    for i in range(segs):
        p0 = P[(i - 1) % N] if (closed or i > 0) else P[0] * 2 - P[1]
        p1 = P[i % N]
        p2 = P[(i + 1) % N]
        p3 = P[(i + 2) % N] if (closed or i + 2 < N) else P[-1] * 2 - P[-2]
        for k in range(n_per):
            t = k / n_per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(P[-1])
    return out


def rounded_rect(w, h, r, n=8):
    """CCW 2D points of a rounded rectangle centred on the origin (x=w, y=h)."""
    r = min(r, w / 2, h / 2)
    pts = []
    for cx, cy, a0 in ((w / 2 - r, -h / 2 + r, -90), (w / 2 - r, h / 2 - r, 0),
                       (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def panel_on_plane(name, origin, u_dir, v_dir, pts2d, thickness=0.0, mat=None, col=None):
    """Planar polygon (2D pts in (u,v)) placed at origin with axes u_dir,v_dir; optional thickness along -normal."""
    u = Vector(u_dir).normalized()
    v = Vector(v_dir).normalized()
    nrm = u.cross(v)
    o = Vector(origin)
    front = [o + u * a + v * b for a, b in pts2d]
    n = len(front)
    if thickness <= 0:
        return mesh_from_pydata(name, front, [tuple(range(n))], mat, col)
    back = [p - nrm * thickness for p in front]
    verts = front + back
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, n + i, n + j, j))
    return mesh_from_pydata(name, verts, faces, mat, col)


# ----------------------------------------------------------------------------- plants

def leaf_geometry(length, width, fold=0.25, curl=0.25, twist=0.0, segs=7, tip_sharp=1.6):
    """Leaf in local coords: base at origin, along +Y, width along X, normal ~ +Z.
    Returns (verts, faces). Two-sided shading is handled by the material (no backface issues in Cycles)."""
    verts, faces = [], []
    cols = 3  # left edge, midrib, right edge
    for i in range(segs + 1):
        t = i / segs
        y = length * t
        wprof = width * 0.5 * (math.sin(math.pi * min(1.0, t ** 0.85)) ** (1.0 / tip_sharp))
        if i == segs:
            wprof = 0.0
        z_curl = -curl * length * (t ** 2)          # arches down toward the tip
        for c in range(cols):
            s = (c - 1)  # -1,0,1
            x = s * wprof
            z = z_curl + fold * abs(s) * wprof * 0.6   # V fold along the midrib (edges up)
            # twist around the Y axis
            if twist:
                a = twist * t
                x, z = x * math.cos(a) - z * math.sin(a), x * math.sin(a) + z * math.cos(a)
            verts.append((x, y, z))
    for i in range(segs):
        for c in range(cols - 1):
            a = i * cols + c
            faces.append((a, a + 1, a + cols + 1, a + cols))
    return verts, faces


def add_leaf(bm_verts, bm_faces, mat_index_faces, M, length, width, rng, fold=0.25, curl=0.25, twist=0.0, segs=7,
             tip_sharp=1.6):
    v, f = leaf_geometry(length, width, fold, curl, twist, segs, tip_sharp)
    base = len(bm_verts)
    for p in v:
        bm_verts.append(M @ Vector(p))
    for face in f:
        bm_faces.append(tuple(base + i for i in face))


def plant_broadleaf(name, base_loc, height, rng, mat_leaf, mat_stem=None, col=None, n_leaves=60,
                    leaf_len=(0.16, 0.26), leaf_w=(0.07, 0.12), spread=0.45, stems=3, lean=(0.05, 0.25)):
    """Rubber-plant / ficus-like: a few stems with leaves along them, leaves point outward/up.
    `lean` = range of stem lean (horizontal offset of the stem top as a fraction of height): larger = bushier."""
    verts, faces = [], []
    stem_pts = []
    for s in range(stems):
        a = rng.uniform(0, 2 * math.pi)
        ln = rng.uniform(*lean)
        top = Vector((math.cos(a) * ln * height, math.sin(a) * ln * height, height * rng.uniform(0.75, 1.0)))
        stem_pts.append(top)
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n_leaves):
        s = i % stems
        top = stem_pts[s]
        t = 0.25 + 0.75 * (i / n_leaves) ** 0.7
        pos = top * t
        az = i * golden * 1.3 + rng.uniform(-0.3, 0.3)
        L = rng.uniform(*leaf_len) * (1.15 - 0.4 * t)
        W = rng.uniform(*leaf_w) * (1.1 - 0.3 * t)
        elev = math.radians(rng.uniform(10, 55) + 25 * t)
        M = (Matrix.Translation(pos) @ Matrix.Rotation(az - math.pi / 2, 4, 'Z') @
             Matrix.Rotation(elev, 4, 'X'))
        add_leaf(verts, faces, None, M, L, W, rng, fold=0.3, curl=rng.uniform(0.15, 0.35),
                 twist=rng.uniform(-0.4, 0.4))
    ob = mesh_from_pydata(name, verts, faces, mat_leaf, col, smooth=True)
    ob.location = base_loc
    if mat_stem:
        for s, top in enumerate(stem_pts):
            st = tube(f'{name}_stem{s}', [Vector(base_loc), Vector(base_loc) + top * 0.9], 0.008, mat_stem, col)
    return ob


def plant_palm(name, base_loc, height, rng, mat_leaf, col=None, n_fronds=16, frond_len=(0.45, 0.8),
               frond_w=(0.05, 0.08), trunks=2, mat_trunk=None):
    """Dracaena / areca-like: several trunks with strap leaves radiating from the tops."""
    verts, faces = [], []
    for tr in range(trunks):
        a = rng.uniform(0, 2 * math.pi)
        h = height * rng.uniform(0.55, 0.85)
        top = Vector((math.cos(a) * 0.08 * tr, math.sin(a) * 0.08 * tr, h))
        if mat_trunk:
            tube(f'{name}_trunk{tr}', [Vector(base_loc), Vector(base_loc) + top], 0.018, mat_trunk, col)
        for i in range(n_fronds):
            az = 2 * math.pi * i / n_fronds + rng.uniform(-0.25, 0.25)
            elev = math.radians(rng.uniform(15, 70))
            L = rng.uniform(*frond_len) * height / 1.4
            W = rng.uniform(*frond_w)
            M = (Matrix.Translation(top) @ Matrix.Rotation(az - math.pi / 2, 4, 'Z') @
                 Matrix.Rotation(elev, 4, 'X'))
            add_leaf(verts, faces, None, M, L, W, rng, fold=0.35, curl=rng.uniform(0.25, 0.5),
                     twist=rng.uniform(-0.5, 0.5), segs=9, tip_sharp=0.9)
    ob = mesh_from_pydata(name, verts, faces, mat_leaf, col, smooth=True)
    ob.location = base_loc
    return ob


def plant_shrub(name, base_loc, radius, height, rng, mat_leaf, col=None, n_leaves=120, leaf_len=(0.05, 0.09)):
    """Small-leaf mound (boxwood-ish) made of little leaves scattered on a dome."""
    verts, faces = [], []
    for i in range(n_leaves):
        u = rng.random()
        a = rng.uniform(0, 2 * math.pi)
        rr = radius * math.sqrt(u)
        z = height * (1 - u) ** 0.5 * rng.uniform(0.7, 1.05)
        pos = Vector((rr * math.cos(a), rr * math.sin(a), z))
        L = rng.uniform(*leaf_len)
        M = (Matrix.Translation(pos) @ Matrix.Rotation(rng.uniform(0, 6.28), 4, 'Z') @
             Matrix.Rotation(math.radians(rng.uniform(-10, 60)), 4, 'X'))
        add_leaf(verts, faces, None, M, L, L * 0.5, rng, fold=0.2, curl=0.2, segs=3)
    ob = mesh_from_pydata(name, verts, faces, mat_leaf, col, smooth=True)
    ob.location = base_loc
    return ob


def leaf_material(name, color_a, color_b, rough=0.45, trans=0.3):
    """Two-tone leaf with gentle translucency and a waxy sheen."""
    m, nb, out = new_material(name)
    tc = nb.node('ShaderNodeTexCoord')
    nz = nb.node('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 3.0
    ramp = nb.node('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = color_a
    ramp.color_ramp.elements[1].color = color_b
    nb.link(tc.outputs['Object'], nz.inputs['Vector'])
    nb.link(nz.outputs['Fac'], ramp.inputs['Fac'])
    p = nb.node('ShaderNodeBsdfPrincipled')
    p.inputs['Roughness'].default_value = rough
    p.inputs['Specular IOR Level'].default_value = 0.45
    nb.link(ramp.outputs['Color'], p.inputs['Base Color'])
    tr = nb.node('ShaderNodeBsdfTranslucent')
    nb.link(ramp.outputs['Color'], tr.inputs['Color'])
    mx = nb.node('ShaderNodeMixShader')
    mx.inputs['Fac'].default_value = trans
    nb.link(p.outputs['BSDF'], mx.inputs[1])
    nb.link(tr.outputs['BSDF'], mx.inputs[2])
    nb.link(mx.outputs['Shader'], out.inputs['Surface'])
    return m


# ----------------------------------------------------------------------------- procedural materials

def marble_material(name, base, vein, rough=0.18, vein_width=0.12):
    m, nb, out = new_material(name)
    tc = nb.node('ShaderNodeTexCoord')
    mp = nb.node('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (2.2, 2.2, 2.2)
    nb.link(tc.outputs['Object'], mp.inputs['Vector'])
    nz = nb.node('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 2.5
    nz.inputs['Detail'].default_value = 8
    nz.inputs['Distortion'].default_value = 1.2
    nb.link(mp.outputs['Vector'], nz.inputs['Vector'])
    wv = nb.node('ShaderNodeTexWave')
    wv.inputs['Scale'].default_value = 1.6
    wv.inputs['Distortion'].default_value = 9.0
    wv.inputs['Detail'].default_value = 6
    wv.inputs['Detail Scale'].default_value = 1.6
    nb.link(mp.outputs['Vector'], wv.inputs['Vector'])
    ramp = nb.node('ShaderNodeValToRGB')
    el = ramp.color_ramp.elements
    el[0].position = 0.0
    el[0].color = vein
    el[1].position = vein_width
    el[1].color = base
    nb.link(wv.outputs['Fac'], ramp.inputs['Fac'])
    p = nb.node('ShaderNodeBsdfPrincipled')
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = 0.25
    p.inputs['Coat Roughness'].default_value = 0.08
    p.inputs['Subsurface Weight'].default_value = 0.05
    nb.link(ramp.outputs['Color'], p.inputs['Base Color'])
    nb.link(p.outputs['BSDF'], out.inputs['Surface'])
    return m


def boucle_material(name, color, scale=180.0, strength=0.45, sheen=0.6):
    """Looped bouclé: fine voronoi+noise bump and sheen."""
    m, nb, out = new_material(name)
    tc = nb.node('ShaderNodeTexCoord')
    vo = nb.node('ShaderNodeTexVoronoi')
    vo.feature = 'F1'
    vo.inputs['Scale'].default_value = scale
    nb.link(tc.outputs['Object'], vo.inputs['Vector'])
    nz = nb.node('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = scale * 0.35
    nz.inputs['Detail'].default_value = 3
    nb.link(tc.outputs['Object'], nz.inputs['Vector'])
    mx = nb.node('ShaderNodeMath')
    mx.operation = 'ADD'
    nb.link(vo.outputs['Distance'], mx.inputs[0])
    nb.link(nz.outputs['Fac'], mx.inputs[1])
    bp = nb.node('ShaderNodeBump')
    bp.inputs['Strength'].default_value = strength
    bp.inputs['Distance'].default_value = 0.004
    nb.link(mx.outputs['Value'], bp.inputs['Height'])
    # slight colour variation
    cm = nb.node('ShaderNodeMix')
    cm.data_type = 'RGBA'
    cm.inputs['A'].default_value = color
    cm.inputs['B'].default_value = tuple(c * 0.8 for c in color[:3]) + (1,)
    nb.link(nz.outputs['Fac'], cm.inputs['Factor'])
    p = nb.node('ShaderNodeBsdfPrincipled')
    p.inputs['Roughness'].default_value = 0.9
    p.inputs['Sheen Weight'].default_value = sheen
    p.inputs['Sheen Roughness'].default_value = 0.4
    p.inputs['Specular IOR Level'].default_value = 0.25
    nb.link(cm.outputs['Result'], p.inputs['Base Color'])
    nb.link(bp.outputs['Normal'], p.inputs['Normal'])
    nb.link(p.outputs['BSDF'], out.inputs['Surface'])
    return m


def plaster_material(name, color, rough=0.85, var=0.08, scale=3.0):
    m, nb, out = new_material(name)
    tc = nb.node('ShaderNodeTexCoord')
    nz = nb.node('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = 6
    nb.link(tc.outputs['Object'], nz.inputs['Vector'])
    cm = nb.node('ShaderNodeMix')
    cm.data_type = 'RGBA'
    cm.inputs['A'].default_value = tuple(c * (1 - var) for c in color[:3]) + (1,)
    cm.inputs['B'].default_value = tuple(min(1, c * (1 + var)) for c in color[:3]) + (1,)
    nb.link(nz.outputs['Fac'], cm.inputs['Factor'])
    nz2 = nb.node('ShaderNodeTexNoise')
    nz2.inputs['Scale'].default_value = 60
    nz2.inputs['Detail'].default_value = 4
    nb.link(tc.outputs['Object'], nz2.inputs['Vector'])
    bp = nb.node('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.08
    nb.link(nz2.outputs['Fac'], bp.inputs['Height'])
    p = nb.node('ShaderNodeBsdfPrincipled')
    p.inputs['Roughness'].default_value = rough
    p.inputs['Specular IOR Level'].default_value = 0.3
    nb.link(cm.outputs['Result'], p.inputs['Base Color'])
    nb.link(bp.outputs['Normal'], p.inputs['Normal'])
    nb.link(p.outputs['BSDF'], out.inputs['Surface'])
    return m


def stone_floor_material(name, color, tile=0.9, rough=0.35):
    """Large-format warm stone tiles with faint grout and mottling, gently glossy."""
    m, nb, out = new_material(name)
    tc = nb.node('ShaderNodeTexCoord')
    br = nb.node('ShaderNodeTexBrick')
    br.offset = 0.5
    br.inputs['Scale'].default_value = 1.0 / tile
    br.inputs['Mortar Size'].default_value = 0.004
    br.inputs['Mortar Smooth'].default_value = 0.5
    br.inputs['Brick Width'].default_value = 1.0
    br.inputs['Row Height'].default_value = 0.5
    br.inputs['Color1'].default_value = color
    br.inputs['Color2'].default_value = tuple(c * 0.93 for c in color[:3]) + (1,)
    br.inputs['Mortar'].default_value = tuple(c * 0.7 for c in color[:3]) + (1,)
    nb.link(tc.outputs['Object'], br.inputs['Vector'])
    nz = nb.node('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 1.5
    nz.inputs['Detail'].default_value = 8
    nb.link(tc.outputs['Object'], nz.inputs['Vector'])
    cm = nb.node('ShaderNodeMix')
    cm.data_type = 'RGBA'
    cm.blend_type = 'MULTIPLY'
    cm.inputs['Factor'].default_value = 0.25
    nb.link(br.outputs['Color'], cm.inputs['A'])
    nb.link(nz.outputs['Color'], cm.inputs['B'])
    rr = nb.node('ShaderNodeMapRange')
    rr.inputs['To Min'].default_value = rough * 0.7
    rr.inputs['To Max'].default_value = rough * 1.4
    nb.link(nz.outputs['Fac'], rr.inputs['Value'])
    p = nb.node('ShaderNodeBsdfPrincipled')
    nb.link(cm.outputs['Result'], p.inputs['Base Color'])
    nb.link(rr.outputs['Result'], p.inputs['Roughness'])
    nb.link(p.outputs['BSDF'], out.inputs['Surface'])
    return m


def glass_material(name, tint=(1, 1, 1, 1), refl=0.08, rough=0.02):
    """Thin architectural glass: mostly transparent + weak gloss (no refraction offset)."""
    m, nb, out = new_material(name)
    tr = nb.node('ShaderNodeBsdfTransparent')
    tr.inputs['Color'].default_value = tint
    gl = nb.node('ShaderNodeBsdfGlossy')
    gl.inputs['Roughness'].default_value = rough
    fr = nb.node('ShaderNodeFresnel')
    fr.inputs['IOR'].default_value = 1.5
    mth = nb.node('ShaderNodeMath')
    mth.operation = 'MULTIPLY'
    mth.inputs[1].default_value = refl / 0.04
    nb.link(fr.outputs['Fac'], mth.inputs[0])
    mx = nb.node('ShaderNodeMixShader')
    nb.link(mth.outputs['Value'], mx.inputs['Fac'])
    nb.link(tr.outputs['BSDF'], mx.inputs[1])
    nb.link(gl.outputs['BSDF'], mx.inputs[2])
    nb.link(mx.outputs['Shader'], out.inputs['Surface'])
    return m


def acrylic_material(name, tint='#F5E8E2', rough=0.08):
    return principled(name, hexcol(tint), rough=rough, transmission=1.0, ior=1.49, spec=0.5)


def metal_material(name, color, rough=0.3, aniso=0.0):
    m = principled(name, color, rough=rough, metallic=1.0)
    p = m.node_tree.nodes[m['_bsdf']]
    p.inputs['Anisotropic'].default_value = aniso
    return m


# ----------------------------------------------------------------------------- city

def city_window_material(name, wall_col, lit_warm, lit_cool, density=0.35, emit=6.0, floor_h=3.6, bay=2.4,
                         haze=None, win=(0.12, 0.88, 0.22, 0.82), cool_frac=0.2):
    """Facade material: grid of windows by world position; random lit/unlit per window."""
    m, nb, out = new_material(name)
    geo = nb.node('ShaderNodeNewGeometry')
    sep = nb.node('ShaderNodeSeparateXYZ')
    nb.link(geo.outputs['Position'], sep.inputs['Vector'])
    # u = (x + y) / bay, v = z / floor_h
    add = nb.node('ShaderNodeMath')
    add.operation = 'ADD'
    nb.link(sep.outputs['X'], add.inputs[0])
    nb.link(sep.outputs['Y'], add.inputs[1])
    du = nb.node('ShaderNodeMath')
    du.operation = 'DIVIDE'
    du.inputs[1].default_value = bay
    nb.link(add.outputs['Value'], du.inputs[0])
    dv = nb.node('ShaderNodeMath')
    dv.operation = 'DIVIDE'
    dv.inputs[1].default_value = floor_h
    nb.link(sep.outputs['Z'], dv.inputs[0])
    comb = nb.node('ShaderNodeCombineXYZ')
    nb.link(du.outputs['Value'], comb.inputs['X'])
    nb.link(dv.outputs['Value'], comb.inputs['Y'])
    fl = nb.node('ShaderNodeVectorMath')
    fl.operation = 'FLOOR'
    nb.link(comb.outputs['Vector'], fl.inputs[0])
    wn = nb.node('ShaderNodeTexWhiteNoise')
    wn.noise_dimensions = '3D'
    wn.label = 'evm_win_hash'      # labels are for mask_passes.py only (no effect on the render)
    nb.link(fl.outputs['Vector'], wn.inputs['Vector'])
    # window mask from fract
    fr = nb.node('ShaderNodeVectorMath')
    fr.operation = 'FRACTION'
    nb.link(comb.outputs['Vector'], fr.inputs[0])
    sepf = nb.node('ShaderNodeSeparateXYZ')
    nb.link(fr.outputs['Vector'], sepf.inputs['Vector'])
    # mask x in (0.15,0.85), y in (0.25,0.8)
    def band(src, lo, hi):
        a = nb.node('ShaderNodeMath'); a.operation = 'GREATER_THAN'; a.inputs[1].default_value = lo
        b = nb.node('ShaderNodeMath'); b.operation = 'LESS_THAN'; b.inputs[1].default_value = hi
        nb.link(src, a.inputs[0]); nb.link(src, b.inputs[0])
        c = nb.node('ShaderNodeMath'); c.operation = 'MULTIPLY'
        nb.link(a.outputs['Value'], c.inputs[0]); nb.link(b.outputs['Value'], c.inputs[1])
        return c.outputs['Value']
    mx_ = band(sepf.outputs['X'], win[0], win[1])
    my_ = band(sepf.outputs['Y'], win[2], win[3])
    mm = nb.node('ShaderNodeMath'); mm.operation = 'MULTIPLY'
    nb.link(mx_, mm.inputs[0]); nb.link(my_, mm.inputs[1])
    lit = nb.node('ShaderNodeMath'); lit.operation = 'LESS_THAN'; lit.inputs[1].default_value = density
    nb.link(wn.outputs['Value'], lit.inputs[0])
    on = nb.node('ShaderNodeMath'); on.operation = 'MULTIPLY'
    on.label = 'evm_win_on'
    nb.link(mm.outputs['Value'], on.inputs[0]); nb.link(lit.outputs['Value'], on.inputs[1])
    # colour: warm/cool by the second noise channel
    wc = nb.node('ShaderNodeMix'); wc.data_type = 'RGBA'
    wc.inputs['A'].default_value = lit_warm
    wc.inputs['B'].default_value = lit_cool
    sepc = nb.node('ShaderNodeSeparateColor')
    nb.link(wn.outputs['Color'], sepc.inputs['Color'])
    gt = nb.node('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 1.0 - cool_frac
    nb.link(sepc.outputs['Green'], gt.inputs[0])
    nb.link(gt.outputs['Value'], wc.inputs['Factor'])
    # brightness variation
    br = nb.node('ShaderNodeMath'); br.operation = 'MULTIPLY_ADD'
    br.inputs[1].default_value = emit
    br.inputs[2].default_value = emit * 0.3
    nb.link(sepc.outputs['Blue'], br.inputs[0])
    es = nb.node('ShaderNodeMath'); es.operation = 'MULTIPLY'
    nb.link(on.outputs['Value'], es.inputs[0]); nb.link(br.outputs['Value'], es.inputs[1])
    em = nb.node('ShaderNodeEmission')
    nb.link(wc.outputs['Result'], em.inputs['Color'])
    nb.link(es.outputs['Value'], em.inputs['Strength'])
    df = nb.node('ShaderNodeBsdfDiffuse')
    df.inputs['Color'].default_value = wall_col
    ad = nb.node('ShaderNodeAddShader')
    nb.link(df.outputs['BSDF'], ad.inputs[0])
    nb.link(em.outputs['Emission'], ad.inputs[1])
    if haze is None:
        nb.link(ad.outputs['Shader'], out.inputs['Surface'])
        return m
    add_haze(nb, ad.outputs['Shader'], out, haze)
    return m


def add_haze(nb, shader_socket, out, haze):
    """Aerial perspective: mix toward an emissive haze colour with camera distance.
    haze = (color, half_distance_m, max_mix, strength)"""
    col, half, mx, stren = haze
    cam = nb.node('ShaderNodeCameraData')
    dv = nb.node('ShaderNodeMath'); dv.operation = 'DIVIDE'; dv.inputs[1].default_value = half
    nb.link(cam.outputs['View Distance'], dv.inputs[0])
    # f = mx * d/(d+1)
    a1 = nb.node('ShaderNodeMath'); a1.operation = 'ADD'; a1.inputs[1].default_value = 1.0
    nb.link(dv.outputs['Value'], a1.inputs[0])
    fr = nb.node('ShaderNodeMath'); fr.operation = 'DIVIDE'
    nb.link(dv.outputs['Value'], fr.inputs[0]); nb.link(a1.outputs['Value'], fr.inputs[1])
    fm = nb.node('ShaderNodeMath'); fm.operation = 'MULTIPLY'; fm.inputs[1].default_value = mx
    fm.label = 'evm_haze'
    nb.link(fr.outputs['Value'], fm.inputs[0])
    he = nb.node('ShaderNodeEmission')
    he.inputs['Color'].default_value = col
    he.inputs['Strength'].default_value = stren
    mix = nb.node('ShaderNodeMixShader')
    nb.link(fm.outputs['Value'], mix.inputs['Fac'])
    nb.link(shader_socket, mix.inputs[1])
    nb.link(he.outputs['Emission'], mix.inputs[2])
    nb.link(mix.outputs['Shader'], out.inputs['Surface'])


def build_city(col, rng, cam_xy, look_dir_xy, ground_z, mat_facade, mat_ground, mat_red,
               n=900, r_min=140, r_max=4200, fov_deg=100, hero=None, h_median=28.0, h_sigma=0.75, h_max=170.0):
    """Dense skyline: boxes scattered log-uniformly in distance inside a wedge in front of the camera.
    hero = list of (dist, az_deg (+ = right of look dir), w, d, h) towers placed exactly."""
    verts, faces = [], []

    def add_box(cx, cy, w, d, h, rot):
        base = len(verts)
        c, s_ = math.cos(rot), math.sin(rot)
        pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
        for z in (ground_z, ground_z + h):
            for x, y in pts:
                verts.append((cx + x * c - y * s_, cy + x * s_ + y * c, z))
        for f in [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]:
            faces.append(tuple(base + i for i in f))

    lx, ly = look_dir_xy
    base_az = math.atan2(ly, lx)
    tops = []
    items = []
    for i in range(n):
        u = rng.random()
        r = r_min * (r_max / r_min) ** u
        az = base_az + math.radians(rng.uniform(-fov_deg / 2, fov_deg / 2))
        w = rng.uniform(14, 40) * (1 + r / 3000)
        d = rng.uniform(14, 40) * (1 + r / 3000)
        hh = min(rng.lognormvariate(math.log(h_median), h_sigma), h_max)
        # keep ordinary blocks below ~1.2 deg above the horizon (only hero towers break the line)
        hh = min(hh, -ground_z + r * math.tan(math.radians(-1.6 + 2.6 * rng.random() ** 3)))
        hh = max(hh, 8.0)
        items.append((r, az, w, d, hh, rng.uniform(-0.25, 0.25), rng.random()))
    for (dist, azd, w, d, hh) in (hero or []):
        items.append((dist, base_az - math.radians(azd), w, d, hh, 0.0, 0.0))
    for (r, az, w, d, hh, jit, sb) in items:
        cx = cam_xy[0] + r * math.cos(az)
        cy = cam_xy[1] + r * math.sin(az)
        rot = jit + az
        add_box(cx, cy, w, d, hh, rot)
        if sb < 0.12 and hh > 40:  # setback crown (rare)
            add_box(cx, cy, w * 0.62, d * 0.62, hh * 1.18, rot)
        tops.append((cx, cy, ground_z + hh))
    ob = mesh_from_pydata('city_blocks', verts, faces, mat_facade, col)
    g = mesh_from_pydata('city_ground', [(cam_xy[0] - 9000, cam_xy[1] + 60, ground_z), (cam_xy[0] + 9000, cam_xy[1] + 60, ground_z),
                                        (cam_xy[0] + 9000, cam_xy[1] + 12000, ground_z), (cam_xy[0] - 9000, cam_xy[1] + 12000, ground_z)],
                         [(0, 1, 2, 3)], mat_ground, col)
    tops.sort(key=lambda t: -t[2])
    for i, (x, y, z) in enumerate(tops[:8]):
        uv_sphere(f'city_red{i}', 1.2, (x, y, z + 1.5), mat_red, col, seg=8, rings=4)
    return ob


# ----------------------------------------------------------------------------- camera

class Cam:
    """Camera helper that maps reference pixels to rays and places points by depth."""

    def __init__(self, name, loc, yaw_deg, lens, W, H, shift_x=0.0, shift_y=0.0, sensor=36.0, pitch_deg=0.0,
                 col=None):
        cd = bpy.data.cameras.new(name)
        cd.lens = lens
        cd.sensor_fit = 'HORIZONTAL' if W >= H else 'VERTICAL'
        cd.sensor_width = sensor
        cd.sensor_height = sensor
        cd.shift_x = shift_x
        cd.shift_y = shift_y
        cd.clip_start = 0.05
        cd.clip_end = 20000
        ob = bpy.data.objects.new(name, cd)
        (col or bpy.context.scene.collection).objects.link(ob)
        ob.location = loc
        ob.rotation_euler = (math.radians(90 + pitch_deg), 0, math.radians(yaw_deg))
        self.ob, self.cd = ob, cd
        self.W, self.H = W, H
        self.loc = Vector(loc)
        self.update()

    def update(self):
        bpy.context.view_layer.update()
        self.M = self.ob.matrix_world.copy()
        self.R = self.M.to_3x3()
        f = self.cd.lens
        S = self.cd.sensor_width
        big = max(self.W, self.H)
        self.k = S / f / big           # tan per pixel
        # principal point (where the optical axis lands), top-left pixel origin.
        # Blender: +shift_x shows more of the right (axis point moves left); +shift_y shows more of the top.
        self.cx = self.W / 2 - self.cd.shift_x * big
        self.cy = self.H / 2 + self.cd.shift_y * big

    def ray(self, px, py):
        """Direction (world) through plate pixel (px,py), top-left origin."""
        tx = (px - self.cx) * self.k
        ty = (self.cy - py) * self.k
        d = self.R @ Vector((tx, ty, -1.0))
        return d

    def at_depth(self, px, py, depth):
        """World point on the pixel ray whose camera-space depth is `depth`."""
        return self.loc + self.ray(px, py) * depth

    def on_plane_z(self, px, py, z):
        d = self.ray(px, py)
        t = (z - self.loc.z) / d.z
        return self.loc + d * t

    def on_plane(self, px, py, p0, n):
        d = self.ray(px, py)
        n = Vector(n)
        t = (Vector(p0) - self.loc).dot(n) / d.dot(n)
        return self.loc + d * t

    def project(self, p):
        """World point -> plate pixel (x, y, depth)."""
        q = self.M.inverted() @ Vector(p)
        depth = -q.z
        px = self.cx + (q.x / depth) / self.k
        py = self.cy - (q.y / depth) / self.k
        return px, py, depth


def set_dof(cam, focus_dist, fstop, blades=0):
    cam.cd.dof.use_dof = True
    cam.cd.dof.focus_distance = focus_dist
    cam.cd.dof.aperture_fstop = fstop
    cam.cd.dof.aperture_blades = blades


# ----------------------------------------------------------------------------- lights

def area_light(name, loc, rot, size, energy, color, col=None, shape='RECTANGLE', size_y=None, spread=180):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape = shape
    ld.size = size
    ld.size_y = size_y or size
    ld.energy = energy
    ld.color = color[:3]
    ld.spread = math.radians(spread)
    ob = bpy.data.objects.new(name, ld)
    (col or bpy.context.scene.collection).objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def point_light(name, loc, radius, energy, color, col=None):
    ld = bpy.data.lights.new(name, 'POINT')
    ld.shadow_soft_size = radius
    ld.energy = energy
    ld.color = color[:3]
    ob = bpy.data.objects.new(name, ld)
    (col or bpy.context.scene.collection).objects.link(ob)
    ob.location = loc
    return ob


def spot_light(name, loc, rot, radius, energy, color, angle_deg=60, blend=0.6, col=None):
    ld = bpy.data.lights.new(name, 'SPOT')
    ld.shadow_soft_size = radius
    ld.energy = energy
    ld.color = color[:3]
    ld.spot_size = math.radians(angle_deg)
    ld.spot_blend = blend
    ob = bpy.data.objects.new(name, ld)
    (col or bpy.context.scene.collection).objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def aim(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


# ----------------------------------------------------------------------------- render setup

TIERS = {
    # name: (width scale, spp, adaptive threshold)
    'blockout': dict(engine='BLOCKOUT', spp=1, thr=0.1),
    'preview': dict(engine='CYCLES', spp=16, thr=0.05),
    'final': dict(engine='CYCLES', spp=48, thr=0.02),
}


def setup_cycles(scn, W, H, spp, thr, seed=7, denoise=True, light_tree=True):
    scn.render.engine = 'CYCLES'
    cy = scn.cycles
    cy.device = 'CPU'
    cy.samples = spp
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = thr
    cy.adaptive_min_samples = 0
    cy.use_denoising = denoise
    cy.denoiser = 'OPENIMAGEDENOISE'
    cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    cy.denoising_prefilter = 'ACCURATE'
    try:
        cy.denoising_quality = 'HIGH'
    except Exception:
        pass
    cy.seed = seed
    cy.use_animated_seed = False
    cy.max_bounces = 8
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 3
    cy.transmission_bounces = 8
    cy.transparent_max_bounces = 8
    cy.volume_bounces = 0
    cy.sample_clamp_direct = 0.0
    cy.sample_clamp_indirect = 10.0
    cy.blur_glossy = 1.0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.use_light_tree = light_tree
    scn.render.resolution_x = W
    scn.render.resolution_y = H
    scn.render.resolution_percentage = 100
    scn.render.film_transparent = False
    scn.render.threads_mode = 'AUTO'
    scn.view_settings.view_transform = 'AgX'
    scn.view_settings.look = 'None'
    scn.view_settings.exposure = 0.0
    scn.view_settings.gamma = 1.0
    scn.display_settings.display_device = 'sRGB'
    scn.render.use_persistent_data = False


def setup_passes_and_compositor(scn, exr_dir, exr_name, fg_names=(), glow_group='glow', mist=(0.5, 40.0)):
    """Adds passes + compositor that writes one multilayer EXR (half) with:
    rgb (denoised combined), glow (denoised light group), mist, fgmask (cryptomatte of fg_names)."""
    vl = scn.view_layers[0]
    vl.cycles.denoising_store_passes = True
    vl.use_pass_mist = True
    if fg_names:
        vl.use_pass_cryptomatte_object = True
        vl.pass_cryptomatte_depth = 4
    scn.world.mist_settings.start = mist[0]
    scn.world.mist_settings.depth = mist[1]
    scn.world.mist_settings.falloff = 'LINEAR'

    scn.use_nodes = True
    nt = scn.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new('CompositorNodeRLayers')
    rl.location = (0, 0)
    comp = nt.nodes.new('CompositorNodeComposite')
    comp.location = (900, 200)
    nt.links.new(rl.outputs['Image'], comp.inputs['Image'])

    fo = nt.nodes.new('CompositorNodeOutputFile')
    fo.location = (900, -100)
    fo.base_path = exr_dir + '/' + exr_name + '_'
    fo.format.file_format = 'OPEN_EXR_MULTILAYER'
    fo.format.color_depth = '16'
    fo.format.exr_codec = 'ZIP'
    fo.file_slots.clear()
    fo.layer_slots.clear()
    fo.layer_slots.new('rgb')
    nt.links.new(rl.outputs['Image'], fo.inputs['rgb'])
    fo.layer_slots.new('mist')
    nt.links.new(rl.outputs['Mist'], fo.inputs['mist'])
    gname = f'Combined_{glow_group}'
    if glow_group and gname in rl.outputs:
        dn = nt.nodes.new('CompositorNodeDenoise')
        dn.location = (500, -200)
        dn.prefilter = 'ACCURATE'
        dn.use_hdr = True
        nt.links.new(rl.outputs[gname], dn.inputs['Image'])
        nt.links.new(rl.outputs['Denoising Normal'], dn.inputs['Normal'])
        nt.links.new(rl.outputs['Denoising Albedo'], dn.inputs['Albedo'])
        fo.layer_slots.new('glow')
        nt.links.new(dn.outputs['Image'], fo.inputs['glow'])
    if fg_names:
        cm = nt.nodes.new('CompositorNodeCryptomatteV2')
        cm.location = (500, -500)
        cm.source = 'RENDER'
        cm.scene = scn
        cm.layer_name = f'{vl.name}.CryptoObject'
        cm.matte_id = ','.join(fg_names)
        nt.links.new(rl.outputs['Image'], cm.inputs['Image'])
        fo.layer_slots.new('fgmask')
        nt.links.new(cm.outputs['Matte'], fo.inputs['fgmask'])
    return fo
