"""Evia CONSULT room (Scan screen, ref4.png) - procedural Blender 4.5 LTS scene + render driver.

Self-contained: needs only Blender 4.5 LTS (bpy, numpy). No external textures/HDRIs/models.
Deterministic: random.Random(SEED) for all scatter, fixed Cycles seed, objects built in a fixed order.

RUN (always through the lock wrapper so renders never overlap with other agents' renders):

  LOCK=/Users/olaajibade/Documents/Codex/2026-09-16/hi/work/evia-rebuild/tools/blender-render.sh
  # layout check (Workbench, seconds)
  $LOCK scripts/blender/room_consult.py -- --tier blockout --out <dir>
  # preview tier: Cycles 960x540, 16 spp, OIDN (about 1.5-2 min on the 2-core i3); reference framing, no margin
  $LOCK scripts/blender/room_consult.py -- --tier preview --out <dir>
  # final tier C1 desktop: Cycles 2560x1440, 64 spp adaptive (0.015), OIDN + denoised light groups,
  # 10 % safe margin on every side (the ref4 framing is anchors.refFrame inside the plate); ~50-60 min
  $LOCK scripts/blender/room_consult.py -- --tier final --out <dir>
  # final tier C2 mobile portrait: 1080x2340, 64 spp (preview tier: 432x936)
  $LOCK scripts/blender/room_consult.py -- --tier final --camera mobile --out <dir>
  # options: --camera desktop|mobile  --margin F  --spp N  --res WxH  --save-blend f.blend  --no-render
  # living-room masks for the web layer (plants/sway, sky, glass, city windows, LED coves/rings, emitter, depth):
  # same scene/camera/DOF/margin as the published plate, flat AOV shaders (mask_passes.py), ~5-8 min:
  $LOCK scripts/blender/room_consult.py -- --camera desktop --passes masks --spp 128 --out <dir>
  $PY scripts/blender/mask_post.py publish <dir>/consult_desktop_masks.exr --out public/env/consult --prefix '' \
      --sizes 2560,1280 --anchors public/env/consult/anchors.json --depth 1280

Each Cycles render writes <out>/consult_<camera>_<tier>.exr (multilayer, half float) with layers
  rgb      denoised beauty (scene-linear Rec.709)
  neon     denoised light group 'neon'    (ceiling halo, wall LED strips, coves, tier lips, ring light)
  emitter  denoised light group 'emitter' (blue emitter rim + inlaid rings of the pedestal glass)
  under    denoised light group 'under'   (pedestal LED under-glow)
  fgmask   AOV coverage of the foreground props (pedestal + glass + book stack + tray + ledge)
  mist     normalised depth (0 at 0.5 m .. 1 at 40 m)
plus <out>/consult_<camera>_<tier>_anchors.json (projected overlay anchors, plate-normalised).
Grade (AgX + bloom + haze + navy shadow tint), fg/glow layers and WebP encoding are done afterwards by
scripts/blender/consult_post.py (Blender's bundled python3.11: numpy + OpenImageIO + OCIO):

  PY=/Applications/Blender.app/Contents/Resources/4.5/python/bin/python3.11
  $PY scripts/blender/consult_post.py --exr <dir>/consult_desktop_final.exr --publish public/env/consult
  $PY scripts/blender/consult_post.py --exr <dir>/consult_mobile_final.exr  --publish public/env/consult
  $PY scripts/blender/consult_post.py --exr <dir>/consult_desktop_preview.exr --preview-only   # 1672x941 ref-frame PNG

Coordinates: metres, Z up. Camera C1 stands at (0,0,CAM_H) looking along +Y (level, lens shift for
the horizon). Layout is reference-driven: features are placed on the camera ray through their
ref4 pixel (1672x941) at a chosen depth (see rp()), so the 2D composition matches the reference.
Nothing is modelled on or above the pedestal (the hologram is code-built), no person is modelled
(the character is an SVG overlay), and every text surface is rendered blank (HTML overlays).
"""
import sys
import os
import math
import json
import random
import hashlib

import bpy
import bmesh
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

SEED = 4242
REF_W, REF_H = 1672, 941
MOBILE_RES = (1080, 2340)

# ----------------------------------------------------------------------------- parameters
P = dict(
    cam_h=1.37,            # camera height above the (sunken) consult floor
    lens=50.0,             # mm on a 36 mm wide sensor (horizontal fit)
    horizon_y=438.9,       # ref4 px of the horizon (level camera + lens shift)
    ped_c=(0.05, 3.694),   # pedestal centre (x, y)
    ped_r=0.90,            # copper drum radius
    ped_top=0.90,          # top of the copper band
    ped_band=0.117,        # copper band height
    # ceiling cove: a large recessed ring over the pedestal. Thin LED line (inner edge) + thick diffuse
    # rose band (outer fascia); heights solved so the back arcs land at ref y~17 (line) and y~34..45 (band)
    # Ceiling halo: a slim hoop over the pedestal. Fitted from ref4's arc (sag = h*x^2/(2*r*f)): bright line
    # bottom at ref y~40, leaving the frame top at x~500/1190 -> r 0.46 m, LED at z 2.084; the hoop's dim
    # copper inner face is the broad rose band above the line.
    halo_r=0.46, halo_z=(2.084, 2.20),
    ceil_z=4.45,
    win_left_depth=13.0, win_right_depth=13.4, win_back_depth=15.2, win_z0=0.45, win_z1=3.85, mullions=10,
    alcove_depth=15.0,     # plane of the left rotunda wall with the arched nook opening
    nook_z=0.96,           # raised lounge-nook floor
    nook_back=0.45,        # niche depth behind the opening plane
    nook_front=1.6,        # raised lounge platform depth in front of the niche
    arch_r=(0.74, 1.18),   # radii (horizontal, vertical) of the opening's rounded top-right corner
    step_z=0.30,           # lower step in front of the nook (LED lip at ref y 600..640)
    tier_z=(0.20, 0.36),   # right-hand curved tiers (upper low enough that the pot on the lower tier stands in front of it)
    strip_z=0.45,          # foot of the right LED strip (meets the upper tier visually)
    ring_px=1694, ring_py=-4, ring_r=0.42,
    inlay_r=(2.35, 3.6, 5.2),
    streak_x=(492, 600, 880, 1436, 330),   # ref x of the vertical highlight streaks on the copper band
    win_refl=0.08, ring_emit=0.45, glass_pool=0.03, under_emit=2.4, emitter_emit=2.5, streak_emit=40.0,
    cove_emit=2.5, neon_emit=3.5, city_lit=(0.86, 0.996), city_emit=1.8, halo_emit=3.5, band_emit=0.6,
    wash_nook=35.0, wash_right=80.0, wash_rear=95.0, fill_top=270.0,
    focus=3.30,            # focus distance (front half of the pedestal / character)
    fstop=5.6,             # f/5.6: city bokeh ~6.5 px at 1672 wide (scan.md 6: 6-14 px), plants stay readable
    margin=0.0,            # safe margin added on every side (fraction of the reference frame); final uses 0.1
    # C2 mobile portrait (1080x2340, 9:19.5): same eye, a 900-ref-px-wide window on the scene centred on the
    # pedestal axis, pedestal-top ellipse centre at 70 % of the frame height (hologram space above it)
    mobile_cov_px=900.0, mobile_cx=868.0, mobile_ped_y=753.0, mobile_ped_frac=0.70,
)

COL = dict(
    wall='#77605b', wall_dark='#4a3a38', wall_right='#6a5049', ceiling='#1e1619', wash='#f4c2b4',
    floor='#9e7973', copper='#cda69a', copper_dark='#8a5a48', glass_top='#3a3e50',
    neon='#f8ad99', neon_core='#ffe0d1', led_under='#efae96', emitter='#8fb4ff',
    window_night='#0f121a', city_warm='#e09d91', city_cool='#a9b8d8', book='#171213',
    pages='#4e403b', ledge='#9a7468', pot='#5b4f55', leaf_a='#3e4a30', leaf_b='#6e6a45',
    blossom='#f3dccf', sofa='#a39599', plinth='#4a3634', mullion='#231a19', vase='#6e5a52',
)


# ----------------------------------------------------------------------------- small utils
def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h, a=1.0):
    h = h.lstrip('#')
    return (srgb_to_lin(int(h[0:2], 16) / 255), srgb_to_lin(int(h[2:4], 16) / 255),
            srgb_to_lin(int(h[4:6], 16) / 255), a)


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = dict(tier='preview', out='.', camera='desktop', spp=None, res=None, save_blend=None,
             render=True, margin=None, passes=None)
    i = 0
    while i < len(argv):
        k = argv[i]
        if k == '--no-render':
            a['render'] = False; i += 1; continue
        v = argv[i + 1]
        if k == '--tier': a['tier'] = v
        elif k == '--out': a['out'] = v
        elif k == '--camera': a['camera'] = v
        elif k == '--spp': a['spp'] = int(v)
        elif k == '--res': a['res'] = tuple(int(t) for t in v.lower().split('x'))
        elif k == '--save-blend': a['save_blend'] = v
        elif k == '--margin': a['margin'] = float(v)
        elif k == '--passes': a['passes'] = v
        i += 2
    return a


def f_px():
    return P['lens'] / 36.0 * REF_W


def flat(v):
    return Vector((v.x, v.y, 0.0))


def rp(px, py, depth):
    """World point on the C1 camera ray through ref4 pixel (px, py) at forward depth `depth` (m)."""
    f = f_px()
    return Vector(((px - REF_W / 2) / f * depth, depth, P['cam_h'] + (P['horizon_y'] - py) / f * depth))


def depth_for_z(py, z):
    """Forward depth at which the ray through ref row py reaches height z."""
    return (P['cam_h'] - z) * f_px() / (py - P['horizon_y'])


# ----------------------------------------------------------------------------- scene helpers
def reset():
    scn = bpy.context.scene
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.curves):
        for d in list(blk):
            blk.remove(d)
    for c in list(scn.collection.children):
        scn.collection.children.unlink(c)
    return scn


COLS = {}


def coll(name):
    if name not in COLS:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        COLS[name] = c
    return COLS[name]


def link(ob, cname):
    coll(cname).objects.link(ob)
    return ob


MATS = {}
INFO = {}
FG_MATS = set()   # materials whose objects are foreground props (fgmask AOV = 1)


def _nodes(m):
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    return nt, out


def principled(name, base, rough=0.5, metal=0.0, spec=0.5, coat=0.0, coat_rough=0.03,
               aniso=0.0, tangent_z=False, trans=0.0, sheen=0.0, emission=None, emit_str=0.0,
               bump=None, rough_noise=None, subsurf=0.0):
    m = bpy.data.materials.new(name)
    nt, out = _nodes(m)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = base if len(base) == 4 else (*base, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Specular IOR Level'].default_value = spec
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = coat_rough
    b.inputs['Anisotropic'].default_value = aniso
    b.inputs['Transmission Weight'].default_value = trans
    b.inputs['Sheen Weight'].default_value = sheen
    b.inputs['Subsurface Weight'].default_value = subsurf
    if tangent_z:
        # brushed around the drum axis (circumferential tangent): anisotropic highlights stretch vertically
        tg = nt.nodes.new('ShaderNodeTangent'); tg.direction_type = 'RADIAL'; tg.axis = 'Z'
        nt.links.new(tg.outputs[0], b.inputs['Tangent'])
    if emission is not None:
        b.inputs['Emission Color'].default_value = emission
        b.inputs['Emission Strength'].default_value = emit_str
    if bump:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = bump[0]
        nz.inputs['Detail'].default_value = 6
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        bp = nt.nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = bump[1]
        bp.inputs['Distance'].default_value = bump[2] if len(bump) > 2 else 0.002
        nt.links.new(nz.outputs['Fac'], bp.inputs['Height'])
        nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    if rough_noise:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = rough_noise[0]
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['To Min'].default_value = rough_noise[1]
        mr.inputs['To Max'].default_value = rough_noise[2]
        nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
        nt.links.new(mr.outputs['Result'], b.inputs['Roughness'])
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    MATS[name] = m
    return m


def emissive(name, color, strength, core=None, core_pow=2.0):
    """LED/neon: emission. If `core` is given, the colour shifts to `core` where the surface faces
    the camera (Layer Weight facing), giving a hot core with a saturated halo edge."""
    m = bpy.data.materials.new(name)
    nt, out = _nodes(m)
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Strength'].default_value = strength
    if core is None:
        e.inputs['Color'].default_value = color
    else:
        lw = nt.nodes.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.5
        pw = nt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = core_pow
        inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
        nt.links.new(lw.outputs['Facing'], inv.inputs[1])
        nt.links.new(inv.outputs[0], pw.inputs[0])
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
        mix.inputs['A'].default_value = color
        mix.inputs['B'].default_value = core
        nt.links.new(pw.outputs[0], mix.inputs['Factor'])
        nt.links.new(mix.outputs['Result'], e.inputs['Color'])
    nt.links.new(e.outputs[0], out.inputs['Surface'])
    MATS[name] = m
    return m


def gate_ray_length(m, max_len, strength):
    """Emission only for rays shorter than max_len (m): the rear LEDs then show up in the copper band
    (short hop) but not in the far window glass, and never directly to the camera."""
    nt = m.node_tree
    e = [n for n in nt.nodes if n.type == 'EMISSION'][0]
    lp = nt.nodes.new('ShaderNodeLightPath')
    lt = nt.nodes.new('ShaderNodeMath'); lt.operation = 'LESS_THAN'; lt.inputs[1].default_value = max_len
    nt.links.new(lp.outputs['Ray Length'], lt.inputs[0])
    nc = nt.nodes.new('ShaderNodeMath'); nc.operation = 'SUBTRACT'; nc.inputs[0].default_value = 1.0
    nt.links.new(lp.outputs['Is Camera Ray'], nc.inputs[1])
    g = nt.nodes.new('ShaderNodeMath'); g.operation = 'MULTIPLY'
    nt.links.new(lt.outputs[0], g.inputs[0]); nt.links.new(nc.outputs[0], g.inputs[1])
    s = nt.nodes.new('ShaderNodeMath'); s.operation = 'MULTIPLY'; s.inputs[1].default_value = strength
    nt.links.new(g.outputs[0], s.inputs[0])
    nt.links.new(s.outputs[0], e.inputs['Strength'])


def add_fg_aov(m):
    """Write AOV 'fgmask' = 1 for foreground materials (coverage pass, DOF/AA correct)."""
    nt = m.node_tree
    a = nt.nodes.new('ShaderNodeOutputAOV')
    a.aov_name = 'fgmask'
    a.inputs['Value'].default_value = 1.0
    FG_MATS.add(m.name)


def mesh_obj(name, verts, faces, mat=None, cname='room', smooth=False, mats=None, face_mats=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    ob = bpy.data.objects.new(name, me)
    if mats:
        for mm in mats:
            me.materials.append(mm)
        if face_mats:
            for p, mi in zip(me.polygons, face_mats):
                p.material_index = mi
    elif mat:
        me.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    link(ob, cname)
    return ob


def box(name, center, size, mat, cname='room', rot_z=0.0, bevel=0.0):
    cx, cy, cz = center
    sx, sy, sz = [s / 2 for s in size]
    v = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
         (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = mesh_obj(name, v, f, mat, cname)
    ob.location = (cx, cy, cz)
    ob.rotation_euler = (0, 0, rot_z)
    if bevel > 0:
        md = ob.modifiers.new('bev', 'BEVEL'); md.width = bevel; md.segments = 3
        md.limit_method = 'ANGLE'
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.data.set_sharp_from_angle(angle=math.radians(40)) if hasattr(ob.data, 'set_sharp_from_angle') else None
    return ob


def cyl_shell(name, c, r, z0, z1, mat, cname='room', n=192, outward=True, a0=0.0, a1=2 * math.pi,
              cap_top=False, cap_bot=False, smooth=True, r_top=None):
    """Vertical cylinder wall (optionally partial arc a0..a1, angles from +X counter-clockwise)."""
    full = abs((a1 - a0) - 2 * math.pi) < 1e-6
    m = n if full else n + 1
    rt = r if r_top is None else r_top
    verts, faces = [], []
    for i in range(m):
        a = a0 + (a1 - a0) * i / n
        verts.append((c[0] + r * math.cos(a), c[1] + r * math.sin(a), z0))
        verts.append((c[0] + rt * math.cos(a), c[1] + rt * math.sin(a), z1))
    for i in range(n):
        j = (i + 1) % m if full else i + 1
        q = (2 * i, 2 * j, 2 * j + 1, 2 * i + 1)
        faces.append(q if outward else q[::-1])
    if cap_top and full:
        top = verts.__len__(); verts.append((c[0], c[1], z1))
        for i in range(n):
            j = (i + 1) % m
            faces.append((2 * i + 1, 2 * j + 1, top))
    if cap_bot and full:
        bot = verts.__len__(); verts.append((c[0], c[1], z0))
        for i in range(n):
            j = (i + 1) % m
            faces.append((2 * j, 2 * i, bot))
    return mesh_obj(name, verts, faces, mat, cname, smooth=smooth)


def annulus(name, c, r0, r1, z, mat, cname='room', n=192, up=True, a0=0.0, a1=2 * math.pi):
    full = abs((a1 - a0) - 2 * math.pi) < 1e-6
    m = n if full else n + 1
    verts, faces = [], []
    for i in range(m):
        a = a0 + (a1 - a0) * i / n
        verts.append((c[0] + r0 * math.cos(a), c[1] + r0 * math.sin(a), z))
        verts.append((c[0] + r1 * math.cos(a), c[1] + r1 * math.sin(a), z))
    for i in range(n):
        j = (i + 1) % m if full else i + 1
        q = (2 * i, 2 * i + 1, 2 * j + 1, 2 * j)
        faces.append(q if up else q[::-1])
    return mesh_obj(name, verts, faces, mat, cname)


def disc(name, c, r, z, mat, cname='room', n=192, up=True):
    verts = [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), 0.0) for i in range(n)]
    face = list(range(n)) if up else list(range(n))[::-1]
    ob = mesh_obj(name, verts, [face], mat, cname)
    ob.location = (c[0], c[1], z)
    return ob


def torus(name, c, R, z, r, mat, cname='room', n=256, m=10, a0=0.0, a1=2 * math.pi):
    full = abs((a1 - a0) - 2 * math.pi) < 1e-6
    nn = n if full else n + 1
    verts, faces = [], []
    for i in range(nn):
        a = a0 + (a1 - a0) * i / n
        ca, sa = math.cos(a), math.sin(a)
        for j in range(m):
            b = 2 * math.pi * j / m
            rr = R + r * math.cos(b)
            verts.append((c[0] + rr * ca, c[1] + rr * sa, z + r * math.sin(b)))
    for i in range(n):
        i2 = (i + 1) % nn if full else i + 1
        for j in range(m):
            j2 = (j + 1) % m
            faces.append((i * m + j, i2 * m + j, i2 * m + j2, i * m + j2))
    return mesh_obj(name, verts, faces, mat, cname, smooth=True)


def tube(name, pts, r, mat, cname='room', closed=False, res=6):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 2
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (q[0], q[1], q[2], 1)
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu)
    ob.data.materials.append(mat)
    link(ob, cname)
    return ob


def arc_pts(c, R, a0, a1, z, n=64):
    return [(c[0] + R * math.cos(a0 + (a1 - a0) * i / n), c[1] + R * math.sin(a0 + (a1 - a0) * i / n), z)
            for i in range(n + 1)]


def ray_circle(px, c, R):
    """Far intersection (angle) of the horizontal camera ray through ref column px with circle (c, R)."""
    d = Vector(((px - REF_W / 2) / f_px(), 1.0)).normalized()
    C = Vector(c)
    b = d.dot(C)
    disc_ = b * b - (C.length_squared - R * R)
    t = b + math.sqrt(max(disc_, 0))
    p = d * t
    return math.atan2(p.y - c[1], p.x - c[0]), p


def panel(name, origin, u, v, outline, mat, cname='room', thick=0.0):
    """Flat panel: outline = [(s,t)] in a plane origin + s*u + t*v (u, v unit Vectors)."""
    o, u, v = Vector(origin), Vector(u).normalized(), Vector(v).normalized()
    nrm = u.cross(v)
    verts = [o + u * s + v * t for s, t in outline]
    faces = [list(range(len(verts)))]
    if thick > 0:
        k = len(verts)
        verts += [p - nrm * thick for p in verts[:k]]
        faces.append(list(range(2 * k - 1, k - 1, -1)))
        for i in range(k):
            j = (i + 1) % k
            faces.append((i, i + k, j + k, j))
    return mesh_obj(name, verts, faces, mat, cname)


def rounded_outline(w, h, r_tr, r_tl=0.0, n=16):
    """Rectangle 0..w x 0..h with rounded top-right (r_tr) and top-left (r_tl) corners (CCW)."""
    pts = [(0.0, 0.0), (w, 0.0)]
    for i in range(n + 1):
        a = 0 + (math.pi / 2) * i / n
        pts.append((w - r_tr + r_tr * math.cos(a), h - r_tr + r_tr * math.sin(a)))
    if r_tl > 0:
        for i in range(n + 1):
            a = math.pi / 2 + (math.pi / 2) * i / n
            pts.append((r_tl + r_tl * math.cos(a), h - r_tl + r_tl * math.sin(a)))
    else:
        pts.append((0.0, h))
    # drop duplicates
    out = []
    for p in pts:
        if not out or (abs(p[0] - out[-1][0]) > 1e-6 or abs(p[1] - out[-1][1]) > 1e-6):
            out.append(p)
    return out


def streak_source(x_ref):
    """Where to put a vertical LED (on the walls around/behind the camera) so that its mirror image on
    the copper band lands at ref column x_ref (front half of the drum, band mid-height)."""
    pc = P['ped_c']; R = P['ped_r']; zm = P['ped_top'] - P['ped_band'] / 2
    cam = Vector((0, 0, P['cam_h']))
    best = None
    for i in range(4001):
        a = -math.pi + math.pi * i / 4000
        p = Vector((pc[0] + R * math.cos(a), pc[1] + R * math.sin(a), zm))
        x = REF_W / 2 + f_px() * p.x / p.y
        if best is None or abs(x - x_ref) < best[0]:
            best = (abs(x - x_ref), p, a)
    _, p, a = best
    d = (p - cam); d.z = 0; d.normalize()
    n = Vector((math.cos(a), math.sin(a), 0))
    r = d - 2 * d.dot(n) * n
    ts = []
    if r.y < 0:
        ts.append((-1.2 - p.y) / r.y)
    if abs(r.x) > 1e-6:
        ts.append(((3.8 if r.x > 0 else -3.8) - p.x) / r.x)
    ts = [t for t in ts if t > 0]
    if not ts:
        return None
    q = p + r * min(ts)
    if q.y > 2.0:       # keep sources beside/behind the camera only: a grazing reflection can solve to a point
        return None     # outside the window, which then shows up via the glass + the outside floor
    return Vector((q.x, q.y, 0))


def area_at(name, loc, facing, sx, sy, energy, color, cname='lights', glossy=False, spread=180.0):
    """Rectangular area light at loc emitting towards `facing` (world vector), invisible to camera."""
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape = 'RECTANGLE'
    ld.size = sx
    ld.size_y = sy
    ld.energy = energy
    ld.color = color[:3]
    ld.spread = math.radians(spread)
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    q = Vector(facing).normalized().to_track_quat('-Z', 'Y')
    ob.rotation_euler = q.to_euler()
    ob.visible_camera = False
    ob.visible_glossy = glossy
    link(ob, cname)
    return ob


def circle3(a, b, c):
    """Circle through three 2D points -> ((cx, cy), r)."""
    ax, ay = a; bx, by = b; cx, cy = c
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    return (ux, uy), math.hypot(ax - ux, ay - uy)


def frame_with_arch(name, o, u, v, n_in, s0, s1, t_floor, t_spring, r, s_out1, H, thick, mat, mat_reveal,
                    cname='room', s_out0=0.0, n=20):
    """Wall plane (o + s*u + t*v, s in [s_out0, s_out1], t in [0, H]) with an opening
    [s0, s1] x [t_floor, t_spring + r] whose top-right corner is rounded (radius r). The reveal
    (depth `thick`) goes away from the camera (-n_in)."""
    rx, ry = (r, r) if not isinstance(r, (tuple, list)) else r
    top = t_spring + ry
    P2 = lambda s, t: o + u * s + v * t
    polys = []
    polys.append([(s_out0, 0), (s0, 0), (s0, H), (s_out0, H)])                  # left of opening
    polys.append([(s1, 0), (s_out1, 0), (s_out1, H), (s1, H)])                  # right of opening
    polys.append([(s0, 0), (s1, 0), (s1, t_floor), (s0, t_floor)])              # sill
    polys.append([(s0, top), (s1 - rx, top), (s1 - rx, H), (s0, H)])            # header
    arc = [(s1 - rx + rx * math.cos(math.pi / 2 * i / n), t_spring + ry * math.sin(math.pi / 2 * i / n)) for i in range(n + 1)]
    polys.append(arc + [(s1 - rx, H), (s1, H)])                               # rounded corner filler
    verts, faces = [], []
    for poly in polys:
        k = len(verts)
        verts += [P2(s, t) for s, t in poly]
        faces.append(list(range(k, k + len(poly))))
    # reveal strips along the opening outline (left edge, top edge, arc, right edge)
    outline = [(s0, t_floor), (s0, top)] + [(s1 - rx, top)] + arc[::-1][1:] + [(s1, t_floor)]
    for (sa, ta), (sb, tb) in zip(outline[:-1], outline[1:]):
        k = len(verts)
        verts += [P2(sa, ta), P2(sb, tb), P2(sb, tb) - n_in * thick, P2(sa, ta) - n_in * thick]
        faces.append([k, k + 1, k + 2, k + 3])
    return mesh_obj(name, verts, faces, mat, cname)


# ----------------------------------------------------------------------------- plants
def shrub(name, base, height, radius, rng, mat_leaf, mat_blossom=None, n_leaves=500, leaf_len=0.06,
          blossom_frac=0.0, crown_z0=0.25, cname='plants', mat_stem=None, squash=1.0):
    """Small-leaf shrub/tree: a few stems + a crown of leaf quads (+ blossom clusters)."""
    verts, faces, fm = [], [], []
    bx, by, bz = base
    # stems
    stems = []
    for s in range(5):
        a = rng.uniform(0, 2 * math.pi)
        lean = rng.uniform(0.05, 0.25) * radius
        top = (bx + math.cos(a) * lean, by + math.sin(a) * lean * squash, bz + height * rng.uniform(0.6, 0.95))
        stems.append(((bx, by, bz), top))
    # leaves in an ellipsoid crown, denser at the surface
    for i in range(n_leaves):
        while True:
            x, y, z = rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)
            rr = x * x + y * y + z * z
            if 0.25 < rr <= 1.0:
                break
        cz = bz + height * (crown_z0 + (1 - crown_z0) * (z * 0.5 + 0.5))
        c = Vector((bx + x * radius, by + y * radius * squash, cz))
        out = Vector((x, y, z * 0.6)).normalized()
        L = leaf_len * rng.uniform(0.7, 1.3)
        W = L * rng.uniform(0.35, 0.5)
        t = out.cross(Vector((0, 0, 1)))
        if t.length < 1e-3:
            t = Vector((1, 0, 0))
        t.normalize()
        ang = rng.uniform(-1.0, 1.0)
        dirv = (out * math.cos(ang) + t * math.sin(ang) + Vector((0, 0, rng.uniform(-0.6, 0.4)))).normalized()
        side = dirv.cross(out)
        if side.length < 1e-3:
            side = t
        side = side.normalized() * (W / 2)
        tip = c + dirv * L
        mid = c + dirv * (L * 0.5)
        k = len(verts)
        verts += [c, mid + side, tip, mid - side]
        faces.append((k, k + 1, k + 2, k + 3))
        fm.append(0)
    if mat_blossom is not None and blossom_frac > 0:
        nb = int(n_leaves * blossom_frac)
        for i in range(nb):
            while True:
                x, y, z = rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.2, 1)
                if 0.5 < x * x + y * y + z * z <= 1.0:
                    break
            c = Vector((bx + x * radius * 1.02, by + y * radius * squash * 1.02,
                        bz + height * (crown_z0 + (1 - crown_z0) * (z * 0.5 + 0.5))))
            s = leaf_len * rng.uniform(0.18, 0.3)
            k = len(verts)
            verts += [c + Vector((s, 0, 0)), c + Vector((0, s, 0)), c + Vector((-s, 0, 0)), c + Vector((0, -s, 0)),
                      c + Vector((0, 0, s)), c + Vector((0, 0, -s))]
            for tri in ((0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (1, 0, 5), (2, 1, 5), (3, 2, 5), (0, 3, 5)):
                faces.append(tuple(k + q for q in tri)); fm.append(1)
    mats = [mat_leaf] + ([mat_blossom] if mat_blossom is not None else [])
    ob = mesh_obj(name, verts, faces, cname=cname, mats=mats, face_mats=fm)
    if mat_stem is not None:
        for si, (a, b) in enumerate(stems):
            tube(f'{name}_stem{si}', [a, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), b],
                 0.012, mat_stem, cname)
    return ob


def branches(name, base, height, rng, mat, n=9, cname='room'):
    """Dry decorative branches in a vase."""
    for i in range(n):
        pts = [Vector(base)]
        d = Vector((rng.uniform(-0.25, 0.25), rng.uniform(-0.1, 0.1), 1.0)).normalized()
        seg = height / 5
        for k in range(5):
            d = (d + Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.1, 0.1), rng.uniform(0.0, 0.2)))).normalized()
            pts.append(pts[-1] + d * seg * rng.uniform(0.7, 1.1))
        tube(f'{name}_{i}', [tuple(p) for p in pts], 0.005, mat, cname)


# ----------------------------------------------------------------------------- build
def build(scn, args):
    rng = random.Random(SEED)
    pc = P['ped_c']

    # ---- materials
    m_floor = principled('floor', hexcol(COL['floor']), rough=0.1, spec=0.6, coat=0.8, coat_rough=0.03,
                         rough_noise=(3.0, 0.05, 0.16))
    m_wall = principled('wall', hexcol(COL['wall']), rough=0.8, bump=(40.0, 0.08))
    m_wall_dark = principled('wall_dark', hexcol(COL['wall_dark']), rough=0.75)
    m_wall_right = principled('wall_right', hexcol(COL['wall_right']), rough=0.75, bump=(40.0, 0.06))
    m_ceiling = principled('ceiling', hexcol(COL['ceiling']), rough=0.7)
    m_canopy = principled('canopy', hexcol('#120c0d'), rough=0.9, spec=0.2)
    m_copper = principled('copper', hexcol(COL['copper']), rough=0.2, metal=1.0, aniso=0.85, tangent_z=True,
                          rough_noise=None)
    m_copper_satin = principled('copper_satin', hexcol(COL['copper_dark']), rough=0.35, metal=1.0)
    m_neon = emissive('neon', hexcol(COL['neon']), P['neon_emit'], core=hexcol('#ffcdb8'))
    m_neon_soft = emissive('neon_soft', hexcol(COL['neon']), 2.0)
    m_streak = emissive('streak', hexcol('#ffd9cc'), P['streak_emit'])
    gate_ray_length(m_streak, 7.0, P['streak_emit'])
    m_neon_cove = emissive('neon_cove', hexcol(COL['neon']), P['cove_emit'])
    m_neon_dim = emissive('neon_dim', hexcol(COL['neon']), 1.5)
    m_halo_led = emissive('halo_led', hexcol('#f09484'), P['halo_emit'], core=hexcol('#ffc2ad'))
    m_halo_rim = emissive('halo_rim', hexcol('#d98a74'), P['band_emit'])
    m_under = emissive('led_under', hexcol('#f09c84'), P['under_emit'], core=hexcol('#ffc6ad'))
    m_emit = emissive('emitter', hexcol(COL['emitter']), P['emitter_emit'], core=hexcol('#dfe9ff'))
    m_mullion = principled('mullion', hexcol(COL['mullion']), rough=0.35, metal=0.6)
    m_ledge = principled('ledge', hexcol(COL['ledge']), rough=0.14, coat=0.8, coat_rough=0.05, bump=(8.0, 0.03))
    m_book = principled('book', hexcol(COL['book']), rough=0.85, spec=0.3, bump=(300.0, 0.15, 0.0005))
    m_pages = principled('pages', hexcol(COL['pages']), rough=0.8)
    m_pot = principled('pot', hexcol(COL['pot']), rough=0.6)
    m_leaf = principled('leaf', hexcol(COL['leaf_a']), rough=0.45, spec=0.5, sheen=0.3, subsurf=0.0)
    m_blossom = principled('blossom', hexcol(COL['blossom']), rough=0.6)
    m_stem = principled('stem', hexcol('#3a2b22'), rough=0.7)
    m_sofa = principled('sofa', hexcol(COL['sofa']), rough=0.9, sheen=0.5, bump=(120.0, 0.2))
    m_plinth = principled('plinth', hexcol(COL['plinth']), rough=0.4)
    m_vase = principled('vase', hexcol(COL['vase']), rough=0.35)
    m_ped_body = principled('ped_body', hexcol('#2a1a17'), rough=0.55, metal=0.0, spec=0.3)

    # glass-top: dark smoked glass with inlaid emissive rings (procedural, object space)
    m_gtop = bpy.data.materials.new('glass_top')
    nt, out = _nodes(m_gtop)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = hexcol(COL['glass_top'])
    b.inputs['Roughness'].default_value = 0.08
    b.inputs['Metallic'].default_value = 0.0
    b.inputs['Coat Weight'].default_value = 0.6
    b.inputs['Coat Roughness'].default_value = 0.05
    b.inputs['Specular IOR Level'].default_value = 0.5
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    # r = length(xy)/R ; angle
    vlen = nt.nodes.new('ShaderNodeVectorMath'); vlen.operation = 'LENGTH'
    cmb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(sep.outputs[0], cmb.inputs[0]); nt.links.new(sep.outputs[1], cmb.inputs[1])
    nt.links.new(cmb.outputs[0], vlen.inputs[0])
    rn = nt.nodes.new('ShaderNodeMath'); rn.operation = 'DIVIDE'; rn.inputs[1].default_value = P['ped_r']
    nt.links.new(vlen.outputs['Value'], rn.inputs[0])
    ang = nt.nodes.new('ShaderNodeMath'); ang.operation = 'ARCTAN2'
    nt.links.new(sep.outputs[1], ang.inputs[0]); nt.links.new(sep.outputs[0], ang.inputs[1])
    acc = None
    # (radius fraction, half-width in r units, strength, arc (a0, a1) or None)
    rings = [(0.55, 0.0016, 1.0, None), (0.72, 0.002, 1.3, None), (0.90, 0.0016, 1.0, None),
             (0.965, 0.0018, 1.8, None), (0.62, 0.003, 0.6, (0.3, 2.4)), (0.80, 0.004, 0.5, (-2.6, -0.9)),
             (0.84, 0.002, 0.8, (2.2, 3.1))]
    for (rf, hw, st, arc) in rings:
        d = nt.nodes.new('ShaderNodeMath'); d.operation = 'SUBTRACT'; d.inputs[1].default_value = rf
        nt.links.new(rn.outputs[0], d.inputs[0])
        ab = nt.nodes.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'
        nt.links.new(d.outputs[0], ab.inputs[0])
        sm = nt.nodes.new('ShaderNodeMapRange'); sm.interpolation_type = 'SMOOTHSTEP'
        sm.inputs['From Min'].default_value = hw * 2.5; sm.inputs['From Max'].default_value = hw * 0.5
        sm.inputs['To Min'].default_value = 0.0; sm.inputs['To Max'].default_value = st
        nt.links.new(ab.outputs[0], sm.inputs['Value'])
        term = sm.outputs['Result']
        if arc is not None:
            g1 = nt.nodes.new('ShaderNodeMath'); g1.operation = 'GREATER_THAN'; g1.inputs[1].default_value = arc[0]
            g2 = nt.nodes.new('ShaderNodeMath'); g2.operation = 'LESS_THAN'; g2.inputs[1].default_value = arc[1]
            nt.links.new(ang.outputs[0], g1.inputs[0]); nt.links.new(ang.outputs[0], g2.inputs[0])
            mm = nt.nodes.new('ShaderNodeMath'); mm.operation = 'MULTIPLY'
            nt.links.new(g1.outputs[0], mm.inputs[0]); nt.links.new(g2.outputs[0], mm.inputs[1])
            m2 = nt.nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY'
            nt.links.new(term, m2.inputs[0]); nt.links.new(mm.outputs[0], m2.inputs[1])
            term = m2.outputs[0]
        if acc is None:
            acc = term
        else:
            ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'ADD'
            nt.links.new(acc, ad.inputs[0]); nt.links.new(term, ad.inputs[1]); acc = ad.outputs[0]
    # soft cool light pool at the centre of the glass (where the hologram stands)
    pool = nt.nodes.new('ShaderNodeMapRange'); pool.interpolation_type = 'SMOOTHSTEP'
    pool.inputs['From Min'].default_value = 0.65; pool.inputs['From Max'].default_value = 0.0
    pool.inputs['To Min'].default_value = 0.0; pool.inputs['To Max'].default_value = P['glass_pool']
    nt.links.new(rn.outputs[0], pool.inputs['Value'])
    adp = nt.nodes.new('ShaderNodeMath'); adp.operation = 'ADD'
    nt.links.new(acc, adp.inputs[0]); nt.links.new(pool.outputs['Result'], adp.inputs[1]); acc = adp.outputs[0]
    # tick marks: fine radial ticks on a band 0.74..0.78
    tk = nt.nodes.new('ShaderNodeMath'); tk.operation = 'MULTIPLY'; tk.inputs[1].default_value = 180 / math.pi
    nt.links.new(ang.outputs[0], tk.inputs[0])
    fr = nt.nodes.new('ShaderNodeMath'); fr.operation = 'FRACT'
    nt.links.new(tk.outputs[0], fr.inputs[0])
    lt = nt.nodes.new('ShaderNodeMath'); lt.operation = 'LESS_THAN'; lt.inputs[1].default_value = 0.12
    nt.links.new(fr.outputs[0], lt.inputs[0])
    bd = nt.nodes.new('ShaderNodeMapRange'); bd.interpolation_type = 'LINEAR'
    bd.inputs['From Min'].default_value = 0.74; bd.inputs['From Max'].default_value = 0.78
    nt.links.new(rn.outputs[0], bd.inputs['Value'])
    inb = nt.nodes.new('ShaderNodeMath'); inb.operation = 'PINGPONG'; inb.inputs[1].default_value = 0.5
    nt.links.new(bd.outputs['Result'], inb.inputs[0])
    tkm = nt.nodes.new('ShaderNodeMath'); tkm.operation = 'MULTIPLY'
    nt.links.new(lt.outputs[0], tkm.inputs[0]); nt.links.new(inb.outputs[0], tkm.inputs[1])
    tks = nt.nodes.new('ShaderNodeMath'); tks.operation = 'MULTIPLY'; tks.inputs[1].default_value = 1.2
    nt.links.new(tkm.outputs[0], tks.inputs[0])
    ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'ADD'
    nt.links.new(acc, ad.inputs[0]); nt.links.new(tks.outputs[0], ad.inputs[1]); acc = ad.outputs[0]
    ad.label = 'evm_emit'           # labels are for mask_passes.py only (no effect on the render)
    # emission
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = hexcol('#86a8f0')
    es = nt.nodes.new('ShaderNodeMath'); es.operation = 'MULTIPLY'; es.inputs[1].default_value = P['ring_emit']
    nt.links.new(acc, es.inputs[0]); nt.links.new(es.outputs[0], em.inputs['Strength'])
    ad2 = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(b.outputs[0], ad2.inputs[0]); nt.links.new(em.outputs[0], ad2.inputs[1])
    nt.links.new(ad2.outputs[0], out.inputs['Surface'])
    MATS['glass_top'] = m_gtop

    # thin window glass: fresnel-weighted mix of transparent + glossy (no refraction offset)
    m_glass = bpy.data.materials.new('window_glass')
    nt, out = _nodes(m_glass)
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); tr.inputs[0].default_value = hexcol('#c6cfdc')
    gl = nt.nodes.new('ShaderNodeBsdfGlossy'); gl.inputs['Roughness'].default_value = 0.02
    fz = nt.nodes.new('ShaderNodeFresnel'); fz.inputs['IOR'].default_value = 1.52
    mx = nt.nodes.new('ShaderNodeMixShader')
    fk = nt.nodes.new('ShaderNodeMath'); fk.operation = 'MULTIPLY'; fk.inputs[1].default_value = P['win_refl']
    nt.links.new(fz.outputs[0], fk.inputs[0])
    nt.links.new(fk.outputs[0], mx.inputs[0]); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(gl.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs['Surface'])
    MATS['window_glass'] = m_glass

    # city facade: dark with a grid of lit windows (world-space cells, white-noise per cell)
    m_city = bpy.data.materials.new('city')
    nt, out = _nodes(m_city)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = hexcol('#11151f')
    b.inputs['Roughness'].default_value = 0.6
    tc = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Position'], sep.inputs[0])
    hx = nt.nodes.new('ShaderNodeMath'); hx.operation = 'ADD'
    nt.links.new(sep.outputs[0], hx.inputs[0]); nt.links.new(sep.outputs[1], hx.inputs[1])
    cellx = nt.nodes.new('ShaderNodeMath'); cellx.operation = 'DIVIDE'; cellx.inputs[1].default_value = 1.3
    nt.links.new(hx.outputs[0], cellx.inputs[0])
    cellz = nt.nodes.new('ShaderNodeMath'); cellz.operation = 'DIVIDE'; cellz.inputs[1].default_value = 3.4
    nt.links.new(sep.outputs[2], cellz.inputs[0])
    flx = nt.nodes.new('ShaderNodeMath'); flx.operation = 'FLOOR'; nt.links.new(cellx.outputs[0], flx.inputs[0])
    flz = nt.nodes.new('ShaderNodeMath'); flz.operation = 'FLOOR'; nt.links.new(cellz.outputs[0], flz.inputs[0])
    frx = nt.nodes.new('ShaderNodeMath'); frx.operation = 'FRACT'; nt.links.new(cellx.outputs[0], frx.inputs[0])
    frz = nt.nodes.new('ShaderNodeMath'); frz.operation = 'FRACT'; nt.links.new(cellz.outputs[0], frz.inputs[0])
    cid = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(flx.outputs[0], cid.inputs[0]); nt.links.new(flz.outputs[0], cid.inputs[1])
    ow = nt.nodes.new('ShaderNodeObjectInfo')
    nt.links.new(ow.outputs['Random'], cid.inputs[2])
    wn = nt.nodes.new('ShaderNodeTexWhiteNoise'); wn.noise_dimensions = '3D'
    wn.label = 'evm_win_hash'
    nt.links.new(cid.outputs[0], wn.inputs['Vector'])
    # more lit windows low down (below the room's eye level), sparse higher up
    thr = nt.nodes.new('ShaderNodeMapRange'); thr.clamp = True
    thr.inputs['From Min'].default_value = -70.0; thr.inputs['From Max'].default_value = 30.0
    thr.inputs['To Min'].default_value = P['city_lit'][0]; thr.inputs['To Max'].default_value = P['city_lit'][1]
    nt.links.new(sep.outputs[2], thr.inputs['Value'])
    lit = nt.nodes.new('ShaderNodeMath'); lit.operation = 'GREATER_THAN'
    nt.links.new(wn.outputs['Value'], lit.inputs[0]); nt.links.new(thr.outputs['Result'], lit.inputs[1])
    wx1 = nt.nodes.new('ShaderNodeMath'); wx1.operation = 'LESS_THAN'; wx1.inputs[1].default_value = 0.5
    nt.links.new(frx.outputs[0], wx1.inputs[0])
    wz1 = nt.nodes.new('ShaderNodeMath'); wz1.operation = 'LESS_THAN'; wz1.inputs[1].default_value = 0.45
    nt.links.new(frz.outputs[0], wz1.inputs[0])
    m1 = nt.nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'
    nt.links.new(wx1.outputs[0], m1.inputs[0]); nt.links.new(wz1.outputs[0], m1.inputs[1])
    m2 = nt.nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY'
    nt.links.new(m1.outputs[0], m2.inputs[0]); nt.links.new(lit.outputs[0], m2.inputs[1])
    m2.label = 'evm_win_on'
    # warm vs cool per cell
    col_mix = nt.nodes.new('ShaderNodeMix'); col_mix.data_type = 'RGBA'
    col_mix.inputs['A'].default_value = hexcol(COL['city_warm'])
    col_mix.inputs['B'].default_value = hexcol(COL['city_cool'])
    gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 0.97
    nt.links.new(wn.outputs['Value'], gt.inputs[0])
    nt.links.new(gt.outputs[0], col_mix.inputs['Factor'])
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(col_mix.outputs['Result'], em.inputs['Color'])
    st = nt.nodes.new('ShaderNodeMath'); st.operation = 'MULTIPLY'; st.inputs[1].default_value = P['city_emit']
    nt.links.new(m2.outputs[0], st.inputs[0])
    # per-window brightness variation (a second hash of the same cell id), 0.15..1.0, squared
    sp_ = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(wn.outputs['Color'], sp_.inputs[0])
    br = nt.nodes.new('ShaderNodeMapRange')
    br.inputs['To Min'].default_value = 0.15; br.inputs['To Max'].default_value = 1.0
    nt.links.new(sp_.outputs[0], br.inputs['Value'])
    br2 = nt.nodes.new('ShaderNodeMath'); br2.operation = 'POWER'; br2.inputs[1].default_value = 2.0
    nt.links.new(br.outputs['Result'], br2.inputs[0])
    st2 = nt.nodes.new('ShaderNodeMath'); st2.operation = 'MULTIPLY'
    nt.links.new(st.outputs[0], st2.inputs[0]); nt.links.new(br2.outputs[0], st2.inputs[1])
    nt.links.new(st2.outputs[0], em.inputs['Strength'])
    b.inputs['Emission Color'].default_value = hexcol('#3a4660')
    b.inputs['Emission Strength'].default_value = 0.06
    ad = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(b.outputs[0], ad.inputs[0]); nt.links.new(em.outputs[0], ad.inputs[1])
    nt.links.new(ad.outputs[0], out.inputs['Surface'])
    MATS['city'] = m_city
    m_city_red = emissive('city_red', hexcol('#ff3a2a'), 8.0)
    m_city_street = emissive('city_street', hexcol('#f0b48a'), P['city_emit'])

    # emitters that only matter when seen directly: no light-sampling (big speed-up)
    for m in (m_city, m_city_red, m_city_street, m_gtop):
        m.cycles.emission_sampling = 'NONE'
    for m in (m_copper, m_copper_satin, m_gtop, m_emit, m_under, m_book, m_pages, m_ledge, m_ped_body):
        add_fg_aov(m)

    # ---- world: deep navy night
    w = bpy.data.worlds.new('night')
    scn.world = w
    w.use_nodes = True
    wn_ = w.node_tree
    bg = wn_.nodes['Background']
    bg.inputs['Color'].default_value = hexcol('#141a28')
    bg.inputs['Strength'].default_value = 1.4

    # ================================================================== architecture
    # The room is a sunken circular consult "pit" (floor z=0, pedestal in the middle) inside a larger
    # rotunda: a raised lounge nook on the left (behind an arched opening), stepped curved tiers on the
    # right, and a curved floor-to-ceiling window onto the night city at the back. Pieces are placed on
    # ref4 camera rays (rp) so their 2D positions match; depths set parallax/DOF.
    CZ = P['ceil_z']
    mesh_obj('floor', [(-14, -6, 0), (14, -6, 0), (14, 24, 0), (-14, 24, 0)], [(0, 1, 2, 3)], m_floor, 'room')
    mesh_obj('ceiling', [(-14, -6, CZ), (-14, 24, CZ), (14, 24, CZ), (14, -6, CZ)], [(0, 1, 2, 3)], m_ceiling, 'room')
    # closed room behind the camera (for reflections in the floor/copper)
    mesh_obj('wall_back', [(-8, -3.5, 0), (8, -3.5, 0), (8, -3.5, CZ), (-8, -3.5, CZ)], [(0, 1, 2, 3)], m_wall, 'room')
    mesh_obj('wall_sideL', [(-7.5, -3.5, 0), (-7.5, -3.5, CZ), (-7.5, 9, CZ), (-7.5, 9, 0)], [(0, 1, 2, 3)], m_wall, 'room')
    mesh_obj('wall_sideR', [(7.5, -3.5, 0), (7.5, 9, 0), (7.5, 9, CZ), (7.5, -3.5, CZ)], [(0, 1, 2, 3)], m_wall, 'room')
    # warm wash on the rear walls (reflected by the copper band and the glossy floor)
    for i, x in enumerate((-4.0, 0.0, 4.0)):
        area_at(f'wash_rear_{i}', (x, -3.0, 4.2), (0, -0.3, -1), 3.0, 0.3, P['wash_rear'], hexcol(COL['wash']), 'neon')
    # side walls beside/behind the camera (seen in the left/right flanks of the copper band)
    for i, x in enumerate((-7.2, 7.2)):
        area_at(f'wash_side_{i}', (x, 0.0, 4.2), (0.3 if x > 0 else -0.3, 0, -1), 0.3, 5.0, P['wash_rear'] * 0.8,
                hexcol(COL['wash']), 'neon')
    # vertical LED strips behind the camera -> the vertical highlight streaks on the copper band
    for i, xr in enumerate(P['streak_x']):
        q = streak_source(xr)
        if q is not None:
            tube(f'rear_led_{i}', [(q.x, q.y, 0.0), (q.x, q.y, 3.0)], 0.03, m_streak, 'neon')

    # ---- window: arc through the left jamb, the back centre and the right jamb
    pLj = rp(300, 0, P['win_left_depth']); pRj = rp(1478, 0, P['win_right_depth'])
    pBk = Vector((0.3, P['win_back_depth'], 0))
    (wcx, wcy), wr = circle3((pLj.x, pLj.y), (pBk.x, pBk.y), (pRj.x, pRj.y))
    WC = (wcx, wcy)
    aL = math.atan2(pLj.y - wcy, pLj.x - wcx); aR = math.atan2(pRj.y - wcy, pRj.x - wcx)
    wz0, wz1 = P['win_z0'], P['win_z1']
    cyl_shell('window', WC, wr, wz0, wz1, m_glass, 'room', n=96, outward=False, a0=aR, a1=aL)
    cyl_shell('win_sill', WC, wr, 0.0, wz0, m_wall_dark, 'room', n=96, outward=False, a0=aR, a1=aL)
    annulus('win_sill_top', WC, wr - 0.35, wr, wz0, m_plinth, 'room', n=96, a0=aR, a1=aL)
    cyl_shell('win_sill_face', WC, wr - 0.35, 0.0, wz0, m_plinth, 'room', n=96, outward=False, a0=aR, a1=aL)
    cyl_shell('win_head', WC, wr, wz1, CZ, m_wall_dark, 'room', n=96, outward=False, a0=aR, a1=aL)
    for i in range(1, P['mullions']):
        a = aR + (aL - aR) * i / P['mullions']
        x, y = wcx + (wr - 0.04) * math.cos(a), wcy + (wr - 0.04) * math.sin(a)
        box(f'mullion_{i}', (x, y, (wz0 + wz1) / 2), (0.08, 0.07, wz1 - wz0), m_mullion, 'room', rot_z=a - math.pi / 2)
    INFO['window'] = dict(c=WC, r=wr, aL=aL, aR=aR)
    print('WINDOW ARC centre', WC, 'r', wr)

    # ---- city beyond the glass (the room is ~90 m up; towers across a river of lights)
    ground = -150.0
    mesh_obj('city_ground', [(-1500, 40, ground), (1500, 40, ground), (1500, 2500, ground), (-1500, 2500, ground)],
             [(0, 1, 2, 3)], principled('city_ground', hexcol('#07080c'), rough=0.9), 'city')
    for band, (y0, y1, n, hmin, hmax, wmin, wmax) in enumerate(
            [(420, 900, 30, 60, 260, 30, 70), (900, 1800, 55, 80, 380, 40, 90), (1800, 3200, 80, 90, 450, 50, 120)]):
        for i in range(n):
            y = rng.uniform(y0, y1)
            half = y * 0.5
            x = rng.uniform(-half, half) + 0.25 * y
            h = rng.uniform(hmin, hmax) * (1.0 if rng.random() > 0.15 else 1.45)
            wdt = rng.uniform(wmin, wmax); d = rng.uniform(wmin, wmax)
            box(f'bld_{band}_{i:03d}', (x, y, ground + h / 2), (wdt, d, h), m_city, 'city', rot_z=rng.uniform(-0.3, 0.3))
            if h > 300 and rng.random() < 0.6:
                box(f'bld_{band}_{i:03d}_red', (x, y, ground + h + 1.5), (2.5, 2.5, 2.5), m_city_red, 'city')
    # street-light "river" far below: small warm emitters (become bokeh)
    for i in range(220):
        y = rng.uniform(450, 3000); x = rng.uniform(-0.45, 0.45) * y + 0.25 * y
        box(f'street_{i:03d}', (x, y, ground + 3), (5, 5, 5), m_city_street, 'city')

    # ---- ceiling halo: a slim suspended ring over the pedestal (only its back arc shows at the frame top).
    # Inner face = diffuse rose glow band, hot LED line along its lower inner edge, dark outer face.
    rr_ = P['halo_r']; zb0, zb1 = P['halo_z']
    m_hoop = bpy.data.materials.new('halo_hoop')
    nt, out = _nodes(m_hoop)
    hb = nt.nodes.new('ShaderNodeBsdfPrincipled')
    hb.inputs['Base Color'].default_value = hexcol('#3a2626'); hb.inputs['Roughness'].default_value = 0.45
    hb.inputs['Metallic'].default_value = 0.6
    htc = nt.nodes.new('ShaderNodeTexCoord'); hsz = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(htc.outputs['Object'], hsz.inputs[0])
    hmr = nt.nodes.new('ShaderNodeMapRange')
    hmr.inputs['From Min'].default_value = zb0; hmr.inputs['From Max'].default_value = zb1
    nt.links.new(hsz.outputs[2], hmr.inputs['Value'])
    hcr = nt.nodes.new('ShaderNodeValToRGB')
    el = hcr.color_ramp.elements
    el[0].position = 0.18; el[0].color = (0, 0, 0, 1); el[1].position = 0.32; el[1].color = (1, 1, 1, 1)
    e3 = el.new(0.6); e3.color = (1, 1, 1, 1); e4 = el.new(0.82); e4.color = (0, 0, 0, 1)
    nt.links.new(hmr.outputs['Result'], hcr.inputs['Fac'])
    hem = nt.nodes.new('ShaderNodeEmission'); hem.inputs['Color'].default_value = hexcol('#c07866')
    hms = nt.nodes.new('ShaderNodeMath'); hms.operation = 'MULTIPLY'; hms.inputs[1].default_value = P['band_emit']
    nt.links.new(hcr.outputs['Color'], hms.inputs[0]); nt.links.new(hms.outputs[0], hem.inputs['Strength'])
    hadd = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(hb.outputs[0], hadd.inputs[0]); nt.links.new(hem.outputs[0], hadd.inputs[1])
    nt.links.new(hadd.outputs[0], out.inputs['Surface'])
    cyl_shell('halo_band', pc, rr_, zb0, zb1, m_hoop, 'neon', outward=False, n=256)
    cyl_shell('halo_back', pc, rr_ + 0.012, zb0, zb1, m_canopy, 'room', outward=True, n=256)
    annulus('halo_bottom', pc, rr_, rr_ + 0.012, zb0, m_canopy, 'room', up=False, n=256)
    annulus('halo_top', pc, rr_, rr_ + 0.012, zb1, m_canopy, 'room', up=True, n=256)
    torus('halo_led', pc, rr_ - 0.004, zb0 + 0.004, 0.0055, m_halo_led, 'neon', n=384, m=8)
    for i in range(3):
        a = math.radians(90 + 120 * i)
        hx, hy = pc[0] + (rr_ + 0.006) * math.cos(a), pc[1] + (rr_ + 0.006) * math.sin(a)
        tube(f'halo_rod_{i}', [(hx, hy, zb1), (hx, hy, P['ceil_z'])], 0.004, m_mullion, 'room')
    INFO['ring'] = dict(r=rr_, z=(zb0, zb1))

    # ---- LEFT: rotunda wall with an arched opening into a raised lounge nook
    dA = P['alcove_depth']
    a0p = rp(-260, 0, dA); a1p = rp(238, 0, dA)
    a0p.z = a1p.z = 0.0
    u = a1p - a0p; u.normalize(); v = Vector((0, 0, 1))
    n_in = Vector((u.y, -u.x, 0))          # towards the camera
    if n_in.y > 0:
        n_in = -n_in
    hs = lambda px: (flat(rp(px, 0, dA)) - a0p).dot(u)
    s_open0 = hs(22)                        # opening left edge
    s_open1 = (a1p - a0p).length            # opening right edge (x 238)
    t_floor = P['nook_z']                   # nook floor (opening sill)
    t_spring = rp(238, 180, dA).z           # where the rounded corner starts (x 238, y 180)
    r_arch = P['arch_r']
    frame_with_arch('alcove_wall', a0p, u, v, n_in, s_open0, s_open1, t_floor, t_spring, r_arch,
                    s_out1=hs(300) + 0.6, H=CZ, thick=P['nook_back'], mat=m_wall, mat_reveal=m_wall,
                    cname='room')
    # far-left dark doorway (ref x 0..22) with a lit edge
    dl0 = a0p + u * hs(-90) + n_in * 0.03
    panel('door_left', dl0, u, v, [(0, 0), (hs(18) - hs(-90), 0), (hs(18) - hs(-90), CZ), (0, CZ)],
          principled('door_dark', hexcol('#140d0c'), rough=0.6), 'room')
    # hidden LED cove in the right/top reveal of the opening (washes the nook back wall pink)
    cove = []
    for i in range(0, 25):
        a = (math.pi / 2) * i / 24
        s = s_open1 - r_arch[0] + r_arch[0] * math.cos(a) - 0.05
        t = t_spring + r_arch[1] * math.sin(a) - 0.05
        cove.append(tuple(a0p + u * s + v * t - n_in * 0.12))
    cove = [tuple(a0p + u * (s_open1 - 0.05) + v * (t_floor + 0.05) - n_in * 0.12)] + cove
    tube('nook_cove', cove, 0.022, m_neon_cove, 'neon').visible_camera = False
    area_at('wash_nook', a0p + u * (s_open1 - 0.06) + v * ((t_floor + t_spring) / 2 + 0.2) - n_in * 0.22, -u + n_in * 0.15,
            0.06, t_spring - t_floor + 0.4, P['wash_nook'], hexcol(COL['wash']), 'neon')   # long axis vertical
    area_at('wash_nook_top', a0p + u * (s_open1 - r_arch[0] * 0.6) + v * (t_spring + r_arch[1] * 0.85) - n_in * 0.22,
            -v - u * 0.3, 0.9, 0.06, P['wash_nook'] * 0.5, hexcol(COL['wash']), 'neon')
    # a thin LED on the opening's left edge (dimmer)
    tube('nook_cove_left', [tuple(a0p + u * (s_open0 + 0.04) + v * t - n_in * 0.12) for t in (t_floor + 0.05, CZ - 0.2)],
         0.012, m_neon_soft, 'neon').visible_camera = False
    # shallow niche: back panel (blank text surface) just behind the opening, washed by the hidden cove
    nb = P['nook_back']
    bw0 = a0p + u * (s_open0 - 0.3) - n_in * nb
    bw_w = (s_open1 - s_open0) + 0.6
    panel('nook_back', bw0, u, v, [(0, 0), (bw_w, 0), (bw_w, CZ), (0, CZ)], m_wall, 'room')
    INFO['nook_back'] = dict(o=bw0.copy(), u=u.copy(), v=v.copy(), n=n_in.copy())
    # raised lounge platform in front of the niche (floor t_floor), LED under its nosing
    fdep = P['nook_front']
    fl = [a0p + u * (s_open0 - 3.0) + n_in * fdep, a0p + u * (s_open1 + 0.3) + n_in * fdep,
          a0p + u * (s_open1 + 0.3) - n_in * nb, a0p + u * (s_open0 - 3.0) - n_in * nb]
    mesh_obj('nook_floor', [(p.x, p.y, t_floor) for p in fl], [(0, 1, 2, 3)], m_plinth, 'room')
    mesh_obj('nook_floor_face', [(fl[0].x, fl[0].y, t_floor), (fl[1].x, fl[1].y, t_floor), (fl[1].x, fl[1].y, 0),
                                 (fl[0].x, fl[0].y, 0)], [(0, 1, 2, 3)], m_plinth, 'room')
    tube('nook_sill_led', [tuple(Vector((p.x, p.y, t_floor - 0.03)) + n_in * 0.015) for p in (fl[0], fl[1])],
         0.012, m_neon, 'neon')
    # sofa, plinths, vase with dry branches on the platform, against the niche
    rz = math.atan2(u.y, u.x)
    sc = a0p + u * hs(112) + n_in * 0.1
    box('sofa_seat', (sc.x, sc.y, t_floor + 0.2), (1.05, 0.8, 0.34), m_sofa, 'room', rot_z=rz, bevel=0.06)
    sb = sc - n_in * 0.33
    box('sofa_back', (sb.x, sb.y, t_floor + 0.42), (1.05, 0.2, 0.5), m_sofa, 'room', rot_z=rz, bevel=0.07)
    for sgn in (-1, 1):
        sa = sc + u * (sgn * 0.6)
        box(f'sofa_arm_{sgn}', (sa.x, sa.y, t_floor + 0.3), (0.18, 0.8, 0.46), m_sofa, 'room', rot_z=rz, bevel=0.06)
    area_at('nook_down', sc + n_in * 0.4 + Vector((0, 0, t_floor + 2.3)), (0, 0, -1), 1.4, 1.0, 18.0,
            hexcol('#f6c2ae'), 'lights')
    for k, (s, w_, h_) in enumerate(((hs(190), 0.5, 0.42), (hs(250), 0.42, 0.28))):
        pp = a0p + u * s + n_in * 0.35
        box(f'nook_plinth_{k}', (pp.x, pp.y, t_floor + h_ / 2), (w_, w_, h_), m_plinth, 'room', rot_z=rz, bevel=0.02)
        tube(f'nook_plinth_led_{k}', [tuple(pp + u * (-w_ / 2) + n_in * (w_ / 2 + 0.01) + Vector((0, 0, t_floor + 0.02))),
                                      tuple(pp + u * (w_ / 2) + n_in * (w_ / 2 + 0.01) + Vector((0, 0, t_floor + 0.02)))],
             0.008, m_neon_soft, 'neon')
    vp = a0p + u * hs(190) + n_in * 0.35
    vz = t_floor + 0.45
    cyl_shell('vase', (vp.x, vp.y), 0.1, vz, vz + 0.5, m_vase, 'room', n=32, cap_top=True, r_top=0.06)
    branches('branch', (vp.x, vp.y, vz + 0.45), 0.8, rng, m_stem)
    # lower stepped platform in front of the opening, LED lip (ref y 600..640)
    lz = P['step_z']
    s0 = rp(40, 640, depth_for_z(640, lz)); s1 = rp(236, 604, depth_for_z(604, lz))
    s0.z = s1.z = lz
    su = (s1 - s0); su.z = 0; su.normalize()
    ext0 = s0 - su * 2.0; ext1 = s1 + su * 0.6
    back0 = a0p + u * -1.0; back1 = a0p + u * (s_open1 + 0.4)
    verts = [ext0, ext1, Vector((back1.x, back1.y, lz)), Vector((back0.x, back0.y, lz))]
    mesh_obj('step_top', verts, [(0, 1, 2, 3)[::-1]], m_plinth, 'room')
    mesh_obj('step_face', [ext0, ext1, Vector((ext1.x, ext1.y, 0)), Vector((ext0.x, ext0.y, 0))], [(0, 1, 2, 3)],
             m_plinth, 'room')
    sn = Vector((su.y, -su.x, 0))
    if sn.y > 0:
        sn = -sn
    tube('step_led', [tuple(ext0 + sn * 0.02 - Vector((0, 0, 0.03))), tuple(ext1 + sn * 0.02 - Vector((0, 0, 0.03)))],
         0.012, m_neon, 'neon')
    # return wall between the opening and the window jamb (x 238..300) + LED line at the jamb
    jr = rp(300, 0, P['win_left_depth']); jr.z = 0
    jl = a0p + u * (s_open1 + 0.35)
    ju = (jr - jl); jlen = ju.length; ju.normalize()
    panel('return_wall', jl, ju, v, [(0, 0), (jlen, 0), (jlen, CZ), (0, CZ)], m_wall_dark, 'room')
    tube('jamb_left_led', [tuple(jr - ju * 0.04 + Vector((0, 0, z))) for z in (wz0, CZ)], 0.009, m_neon, 'neon')
    # far-left potted olive tree on the pit floor
    tp = rp(45, 690, depth_for_z(690, 0.0))
    cyl_shell('pot_left', (tp.x, tp.y), 0.28, 0.0, 0.48, m_pot, 'plants', n=48, cap_top=True, r_top=0.34)
    shrub('tree_left', (tp.x, tp.y, 0.45), 1.6, 0.5, rng, m_leaf, m_blossom, n_leaves=1500, leaf_len=0.09,
          blossom_frac=0.12, crown_z0=0.12, mat_stem=m_stem)
    # warm key on the tree (from the lit room / pedestal side): warm-lit leaves, specular #e2997d
    area_at('tree_left_key', (tp.x + 1.4, tp.y - 1.6, 2.0), (-1.4, 1.6, -0.6), 1.0, 1.0, 150.0, hexcol('#f6b39c'),
            'lights')

    # ---- RIGHT: LED-outlined text panel (blank), ring light, dark door, stepped curved tiers
    ps = rp(1520, 598, depth_for_z(598, P['strip_z']))      # LED strip foot (meets the upper tier)
    pe = rp(1672, 0, ps.y - 1.0); pe.z = 0
    ru = Vector((pe.x - ps.x, pe.y - ps.y, 0)); ru.normalize()
    rn = Vector((-ru.y, ru.x, 0))
    if rn.y > 0:
        rn = -rn
    rw_len = 2.6
    panel('right_panel', Vector((ps.x, ps.y, 0)) - ru * 0.15, ru, v, [(0, 0), (rw_len, 0), (rw_len, CZ), (0, CZ)],
          m_wall_right, 'room')
    INFO['right_panel'] = dict(o=Vector((ps.x, ps.y, 0)) - ru * 0.15, u=ru.copy(), v=v.copy(), n=rn.copy())
    tube('right_strip_v', [tuple(Vector((ps.x, ps.y, z)) + rn * 0.03) for z in (ps.z, CZ)], 0.009, m_neon, 'neon')
    tube('right_strip_h', [tuple(Vector((ps.x, ps.y, ps.z)) + rn * 0.03 + ru * s) for s in (0.0, rw_len)], 0.009,
         m_neon, 'neon')
    # left return of the panel (pilaster between window jamb and strip), faint rose edge
    pj = rp(1478, 0, P['win_right_depth']); pj.z = 0
    pu = Vector((ps.x, ps.y, 0)) - pj; plen = pu.length; pu.normalize()
    m_pil = principled('pilaster_glass', hexcol('#1c1516'), rough=0.18, metal=0.3, coat=0.5)
    panel('pilaster_R', pj, pu, v, [(0, 0), (plen, 0), (plen, CZ), (0, CZ)], m_pil, 'room')
    tube('pilaster_R_led', [tuple(pj + pu * 0.05 + rn * 0.02 + Vector((0, 0, z))) for z in (wz0, CZ)], 0.007,
         m_neon_dim, 'neon')
    # wash on the right text panel from its LED strip
    area_at('wash_right_panel', Vector((ps.x, ps.y, (ps.z + CZ) / 2)) + rn * 0.08 + ru * 0.05, ru + rn * 0.35, 0.06, 3.4,
            P['wash_right'], hexcol(COL['wash']), 'neon')   # long axis vertical (was horizontal -> hotspot)
    # dark recessed door at the far right
    dpt = rp(1652, 0, ps.y - 1.0); dpt.z = 0
    sdoor = (dpt - Vector((ps.x, ps.y, 0))).dot(ru)
    panel('door_right', Vector((ps.x, ps.y, 0)) + ru * sdoor + rn * 0.01, ru, v,
          [(0, ps.z + 0.02), (1.2, ps.z + 0.02), (1.2, 3.1), (0, 3.1)], m_wall_dark, 'room')
    # ring light (vertical, on the panel, mostly off-frame top-right)
    rc = _ray_plane(dict(o=Vector((ps.x, ps.y, 0)), n=rn), P['ring_px'], P['ring_py']) + rn * 0.04
    tube('ring_light', [tuple(rc + ru * (P['ring_r'] * math.cos(2 * math.pi * i / 96)) +
                              Vector((0, 0, P['ring_r'] * math.sin(2 * math.pi * i / 96)))) for i in range(97)],
         0.012, m_neon, 'neon')
    # tiers: curved steps concentric with the window arc, LED under each nosing
    for k, (z, (px_a, py_a), (px_b, py_b)) in enumerate(((P['tier_z'][0], (1372, 645), (1700, 712)),
                                                         (P['tier_z'][1], (1331, 595), (1700, 628)))):
        pa = rp(px_a, py_a, depth_for_z(py_a, z)); pb = rp(px_b, py_b, depth_for_z(py_b, z))
        ra = (Vector((pa.x, pa.y)) - Vector(WC)).length; rb = (Vector((pb.x, pb.y)) - Vector(WC)).length
        r_edge = (ra + rb) / 2
        aa = math.atan2(pa.y - wcy, pa.x - wcx) + 0.05; ab = math.atan2(pb.y - wcy, pb.x - wcx) - 0.35
        annulus(f'tier_{k}_top', WC, r_edge, wr + 0.5, z, m_plinth, 'room', n=64, a0=ab, a1=aa)
        cyl_shell(f'tier_{k}_face', WC, r_edge, 0.0, z - 0.035, m_plinth, 'room', n=64, outward=True, a0=ab, a1=aa)
        tube(f'tier_{k}_led', arc_pts(WC, r_edge + 0.01, ab, aa, z - 0.03, 64), 0.012, m_neon, 'neon')
        INFO[f'tier_{k}'] = dict(r=r_edge, z=z)
    # potted tree on the lower tier
    pp = rp(1609, 662, depth_for_z(662, P['tier_z'][0]))
    cyl_shell('pot_right', (pp.x, pp.y), 0.24, P['tier_z'][0], P['tier_z'][0] + 0.36, m_pot, 'plants', n=48,
              cap_top=True, r_top=0.29)
    shrub('tree_right', (pp.x, pp.y, P['tier_z'][0] + 0.32), 1.45, 0.6, rng, m_leaf, m_blossom, n_leaves=1700,
          leaf_len=0.09, blossom_frac=0.12, crown_z0=0.12, mat_stem=m_stem)
    area_at('tree_right_key', (pp.x - 1.5, pp.y - 1.8, 2.0), (1.5, 1.8, -0.6), 1.0, 1.0, 45.0, hexcol('#f6b39c'),
            'lights')
    # blossom shrubs on the lower tier in front of the window (behind the pedestal, right of centre)
    for k, (px_, py_) in enumerate(((1330, 668), (1225, 650))):
        z = P['tier_z'][0]
        sp_ = rp(px_, py_, depth_for_z(py_, z))
        cyl_shell(f'planter_{k}', (sp_.x, sp_.y), 0.2, z, z + 0.22, m_pot, 'plants', n=32, cap_top=True)
        shrub(f'shrub_{k}', (sp_.x, sp_.y, z + 0.2), 0.55, 0.4, rng, m_leaf, m_blossom, n_leaves=520,
              leaf_len=0.07, blossom_frac=0.18, crown_z0=0.05)
    # floor inlay rings around the pedestal (dark bronze lines)
    for rr in P['inlay_r']:
        annulus(f'inlay_{rr}', pc, rr, rr + 0.03, 0.0015, m_mullion, 'room', n=256)

    # ================================================================== pedestal (foreground)
    R = P['ped_r']; top = P['ped_top']; band = P['ped_band']
    zb = top - band
    ped = []
    ped.append(cyl_shell('ped_band', pc, R, zb, top - 0.006, m_copper, 'fg', n=256))
    ped.append(torus('ped_lip', pc, R - 0.004, top - 0.004, 0.006, m_copper, 'fg', n=256, m=8))
    ped.append(annulus('ped_lip_top', pc, R - 0.03, R, top + 0.001, m_copper, 'fg', n=256))
    ped.append(disc('ped_glass', pc, R - 0.03, top + 0.004, m_gtop, 'fg', n=256))
    ped.append(torus('ped_emitter_rim', pc, R - 0.036, top + 0.006, 0.0045, m_emit, 'emitter', n=256, m=8))
    # recessed LED under the band + dark shadow gap + lower body
    ped.append(annulus('ped_band_under', pc, R - 0.04, R, zb, m_copper_satin, 'fg', n=256, up=False))
    ped.append(torus('ped_led_under', pc, R - 0.045, zb - 0.016, 0.016, m_under, 'under', n=256, m=8))
    ped.append(cyl_shell('ped_body', pc, R - 0.11, 0.0, zb - 0.02, m_ped_body, 'fg', n=192))
    ped.append(annulus('ped_body_top', pc, R - 0.11, R - 0.04, zb - 0.02, m_ped_body, 'fg', n=192, up=False))

    # ================================================================== books + ledge (foreground, bottom-left)
    lz_top = 0.80
    ledge_pts = [(-1.9, 2.35), (-0.56, 2.35), (-0.56, 3.7), (-1.9, 3.7)]
    lv = [(x, y, lz_top) for x, y in ledge_pts] + [(x, y, 0.0) for x, y in ledge_pts]
    mesh_obj('ledge', lv, [(0, 1, 2, 3), (4, 0, 3, 7)[::-1], (1, 5, 6, 2), (0, 4, 5, 1)], m_ledge, 'fg')
    # dark tray under the books
    tray_c = (-1.06, 3.2)
    box('book_tray', (tray_c[0], tray_c[1], lz_top + 0.012), (0.74, 0.52, 0.024), m_copper_satin, 'fg', rot_z=-0.12,
        bevel=0.004)
    Mt = Matrix.Rotation(-0.12, 3, 'Z')
    for k, (dx, dy, sx, sy) in enumerate(((0, -0.25, 0.74, 0.02), (0, 0.25, 0.74, 0.02), (-0.36, 0, 0.02, 0.52),
                                          (0.36, 0, 0.02, 0.52))):
        q = Vector(tray_c + (0,)) + Mt @ Vector((dx, dy, 0))
        box(f'book_tray_rim_{k}', (q.x, q.y, lz_top + 0.03), (sx, sy, 0.02), m_copper_satin, 'fg', rot_z=-0.12,
            bevel=0.003)
    bz = lz_top + 0.024
    books = []
    # (x centre, y centre, width(X), depth(Y), thickness, rot)
    for k, (x, y, wd, dp, th, rz) in enumerate(((-1.13, 3.2, 0.58, 0.40, 0.044, -0.13),
                                              (-1.14, 3.2, 0.56, 0.38, 0.043, -0.11),
                                              (-1.13, 3.19, 0.54, 0.36, 0.042, -0.14))):
        zc = bz + th / 2
        # hardcover: two boards + spine (towards the camera) + a page block visible at the head/tail ends
        Mb = Matrix.Rotation(rz, 3, 'Z'); cb = Vector((x, y, zc)); bd = 0.0035
        cover = box(f'book_{k}_top', cb + Mb @ Vector((0, 0, th / 2 - bd / 2)), (wd, dp, bd), m_book, 'fg', rot_z=rz, bevel=0.0012)
        box(f'book_{k}_bot', cb + Mb @ Vector((0, 0, -th / 2 + bd / 2)), (wd, dp, bd), m_book, 'fg', rot_z=rz, bevel=0.0012)
        box(f'book_{k}_spine', cb + Mb @ Vector((0, -dp / 2 + 0.003, 0)), (wd, 0.006, th), m_book, 'fg', rot_z=rz, bevel=0.002)
        box(f'book_{k}_pages', cb + Mb @ Vector((0, 0.001, 0)), (wd - 0.007, dp - 0.01, th - 2 * bd), m_pages, 'fg', rot_z=rz)
        books.append((cover, x, y, wd, dp, th, rz, zc))
        bz += th

    area_at('books_key', (-0.7, 2.6, 2.3), (-0.35, 0.45, -1.0), 0.8, 0.8, 15.0, hexcol('#f4c0ab'), 'lights')
    INFO['books'] = books
    return INFO


# ----------------------------------------------------------------------------- lights
def lights(scn):
    def area(name, loc, rot, size, energy, color, sy=None, cname='lights', lg=None):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.shape = 'RECTANGLE' if sy else 'SQUARE'
        ld.size = size
        if sy:
            ld.size_y = sy
        ld.energy = energy
        ld.color = color[:3]
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.rotation_euler = rot
        ob.visible_camera = False
        ob.visible_glossy = False
        link(ob, cname)
        return ob

    def point(name, loc, r, energy, color, cname='lights', glossy=True):
        ld = bpy.data.lights.new(name, 'POINT')
        ld.shadow_soft_size = r
        ld.energy = energy
        ld.color = color[:3]
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.visible_camera = False
        ob.visible_glossy = glossy
        link(ob, cname)
        return ob

    pc = P['ped_c']
    # cool hologram key: light emitted by the (code-built) hologram above the pedestal centre
    point('holo_key', (pc[0] - 0.05, pc[1] + 0.05, 1.45), 0.35, 70.0, hexcol('#8eb0f2'), glossy=False)
    point('holo_pool', (pc[0], pc[1], 1.05), 0.2, 25.0, hexcol('#9dbcff'), glossy=False)
    # warm low ambient fill from behind the camera (rose)
    area('fill_front', (0.0, -2.5, 2.8), (math.radians(70), 0, 0), 4.0, 65.0, hexcol('#f0a898'), sy=1.5)
    # soft warm overhead fill over the pit (lifts floor, tiers and plants; no glossy highlight)
    area_at('fill_top', (0.3, 7.5, P['ceil_z'] - 0.05), (0, 0, -1), 6.0, 6.0, P['fill_top'], hexcol('#f2b2a2'))


# ----------------------------------------------------------------------------- camera
def camera(scn, which='desktop'):
    cd = bpy.data.cameras.new('C1')
    cam = bpy.data.objects.new('C1', cd)
    link(cam, 'cameras')
    cam.location = (0.0, 0.0, P['cam_h'])
    cam.rotation_euler = (math.radians(90), 0, 0)
    cd.lens = P['lens']
    cd.sensor_fit = 'HORIZONTAL'
    if which == 'mobile':
        # portrait: horizontal coverage mobile_cov_px reference px; Blender's shift unit is the larger frame
        # dimension (here the height, in reference px: h_ref)
        W_, H_ = MOBILE_RES
        cov = P['mobile_cov_px']; h_ref = cov * H_ / W_
        y_c = P['mobile_ped_y'] - P['mobile_ped_frac'] * h_ref + h_ref / 2
        cd.sensor_width = 36.0 * cov / REF_W
        cd.shift_x = (P['mobile_cx'] - REF_W / 2) / h_ref
        cd.shift_y = (P['horizon_y'] - y_c) / h_ref
    else:
        # safe margin: widen the sensor about the (shifted) optical centre so the reference framing sits in
        # the middle 1/k of the plate (k = 1 + 2*margin); layout (rp) stays in reference pixels.
        k = 1.0 + 2.0 * P['margin']
        cd.sensor_width = 36.0 * k
        cd.shift_y = -(REF_H / 2 - P['horizon_y']) / REF_W / k
    cd.clip_start = 0.05
    cd.clip_end = 3000
    cd.dof.use_dof = True
    cd.dof.focus_distance = P['focus']
    cd.dof.aperture_fstop = P['fstop']
    cd.dof.aperture_blades = 0
    scn.camera = cam
    return cam


# ----------------------------------------------------------------------------- render setup
def setup_render(scn, args):
    tier = args['tier']
    if tier == 'final':
        W, H, spp = 2560, 1440, 64
    elif tier == 'blockout':
        W, H, spp = 960, 540, 1
    else:
        W, H, spp = 960, 540, 16
    if args['camera'] == 'mobile':
        W, H = MOBILE_RES if tier == 'final' else (MOBILE_RES[0] * 2 // 5, MOBILE_RES[1] * 2 // 5)
    if args['res']:
        W, H = args['res']
    if args['spp']:
        spp = args['spp']
    r = scn.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = W, H, 100
    r.film_transparent = False
    scn.view_settings.view_transform = 'AgX'
    scn.view_settings.look = 'None'
    scn.display_settings.display_device = 'sRGB'
    if tier == 'blockout':
        r.engine = 'BLENDER_WORKBENCH'
        scn.display.shading.light = 'STUDIO'
        scn.display.shading.color_type = 'MATERIAL'
        return W, H, spp
    r.engine = 'CYCLES'
    c = scn.cycles
    c.device = 'CPU'
    c.samples = spp
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.015 if tier == 'final' else 0.03
    c.adaptive_min_samples = 0
    c.use_denoising = True
    c.denoiser = 'OPENIMAGEDENOISE'
    c.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    c.denoising_prefilter = 'ACCURATE'
    try:
        c.denoising_quality = 'HIGH'
    except Exception:
        pass
    c.seed = 7
    c.use_animated_seed = False
    c.max_bounces = 8
    c.diffuse_bounces = 3
    c.glossy_bounces = 3
    c.transmission_bounces = 8
    c.transparent_max_bounces = 8
    c.volume_bounces = 0
    c.sample_clamp_indirect = 10.0
    c.sample_clamp_direct = 0.0
    c.use_light_tree = True
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.blur_glossy = 1.0
    r.threads_mode = 'AUTO'
    r.use_persistent_data = False
    c.use_auto_tile = W * H > 2.5e6
    c.tile_size = 1024
    return W, H, spp


def setup_passes(scn, out_dir, base):
    vl = scn.view_layers[0]
    vl.name = 'room'
    vl.use_pass_mist = True
    vl.cycles.denoising_store_passes = True
    aov = vl.aovs.add(); aov.name = 'fgmask'; aov.type = 'VALUE'
    for g in ('neon', 'emitter', 'under'):
        bpy.ops.scene.view_layer_add_lightgroup(name=g)
    # light-group membership by collection
    for cname, g in (('neon', 'neon'), ('emitter', 'emitter'), ('under', 'under')):
        if cname in COLS:
            for ob in COLS[cname].all_objects:
                ob.lightgroup = g
    bpy.data.objects['ped_glass'].lightgroup = 'emitter'   # inlaid rings pulse with the rim
    scn.world.mist_settings.start = 0.5
    scn.world.mist_settings.depth = 39.5
    scn.world.mist_settings.falloff = 'LINEAR'
    # compositor: denoise the light-group passes, write one multilayer EXR
    scn.use_nodes = True
    nt = scn.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new('CompositorNodeRLayers')
    rl.layer = 'room'
    comp = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(rl.outputs['Image'], comp.inputs['Image'])
    fo = nt.nodes.new('CompositorNodeOutputFile')
    fo.base_path = out_dir
    fo.format.file_format = 'OPEN_EXR_MULTILAYER'
    fo.format.color_depth = '16'
    fo.format.exr_codec = 'ZIP'
    fo.file_slots.clear() if hasattr(fo, 'file_slots') else None
    fo.layer_slots.clear()
    fo.layer_slots.new('rgb')
    nt.links.new(rl.outputs['Image'], fo.inputs['rgb'])
    names = [o.name for o in rl.outputs]
    for g in ('neon', 'emitter', 'under'):
        key = 'Combined_' + g
        if key not in names:
            print('WARN missing light group pass', key, names)
            continue
        dn = nt.nodes.new('CompositorNodeDenoise')
        dn.prefilter = 'ACCURATE'
        nt.links.new(rl.outputs[key], dn.inputs['Image'])
        nt.links.new(rl.outputs['Denoising Normal'], dn.inputs['Normal'])
        nt.links.new(rl.outputs['Denoising Albedo'], dn.inputs['Albedo'])
        fo.layer_slots.new(g)
        nt.links.new(dn.outputs[0], fo.inputs[g])
    fo.layer_slots.new('fgmask')
    nt.links.new(rl.outputs['fgmask'], fo.inputs['fgmask'])
    fo.layer_slots.new('mist')
    nt.links.new(rl.outputs['Mist'], fo.inputs['mist'])
    # file name: <base>#### -> we rename after render
    fo.base_path = os.path.join(out_dir, base + '_')
    return fo


# ----------------------------------------------------------------------------- anchors
def project(scn, cam, p):
    co = world_to_camera_view(scn, cam, Vector(p))
    return [round(co.x, 5), round(1.0 - co.y, 5)]   # plate-normalised, origin top-left


def fit_ellipse(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    cx = (max(xs) + min(xs)) / 2; cy = (max(ys) + min(ys)) / 2
    return dict(cx=round(cx, 5), cy=round(cy, 5), rx=round((max(xs) - min(xs)) / 2, 5),
                ry=round((max(ys) - min(ys)) / 2, 5), yTop=round(min(ys), 5), yBottom=round(max(ys), 5))


def coc_px(scn, cam, depth, W):
    """Circle-of-confusion diameter in plate px (at width W) for an object at `depth` metres."""
    cd = cam.data
    f = cd.lens / 1000.0
    N = cd.dof.aperture_fstop
    s = cd.dof.focus_distance
    c = abs(f * f / (N * (s - f)) * (depth - s) / depth)   # metres on the sensor
    return round(c / (cd.sensor_width / 1000.0) * W, 2)


def anchors(scn, cam, info, W, H):
    bpy.context.view_layer.update()   # make sure cam.matrix_world is current
    pc = P['ped_c']; R = P['ped_r']; top = P['ped_top']; band = P['ped_band']
    mobile = cam.data.sensor_width < 30.0 and H > W
    m = 0.0 if mobile else P['margin']; k = 1.0 + 2.0 * m
    A = dict(room='consult',
             plate=dict(w=W, h=H, aspect='9:19.5' if mobile else '16:9', overscan=None if mobile else round(k, 4)),
             ref=dict(image='ref4.png', w=REF_W, h=REF_H),
             refFrame=dict(x=round(m / k, 5), y=round(m / k, 5), w=round(1 / k, 5), h=round(1 / k, 5),
                           note='where the reference framing (ref4, 1672x941) sits inside the plate (normalised). '
                                'Scale the plate so this rect covers the design stage; the rest is safe margin '
                                'for object-fit: cover at other aspect ratios.'),
             coords='normalised 0..1 of the plate, origin top-left (x right, y down)')
    if mobile:
        A['refFrame'] = None
        A['ref']['note'] = 'mobile portrait camera C2: no reference framing exists (design sign-off needed)'
    S = {}
    # pedestal top ellipse + rings (hologram base)
    def circle_pts(r, z, n=180):
        return [project(scn, cam, (pc[0] + r * math.cos(2 * math.pi * i / n), pc[1] + r * math.sin(2 * math.pi * i / n), z))
                for i in range(n)]
    E = {}
    E['pedestal_top'] = fit_ellipse(circle_pts(R, top))
    E['pedestal_glass'] = fit_ellipse(circle_pts(R - 0.036, top + 0.006))
    for rf in (0.55, 0.72, 0.90):
        E[f'glass_ring_{int(rf * 100)}'] = fit_ellipse(circle_pts(R * rf, top + 0.005))
    E['hologram_base'] = fit_ellipse(circle_pts(0.36, top + 0.005))
    E['hologram_base']['note'] = 'suggested footprint of the code-built hologram on the glass (r = 0.36 m)'
    E['ceiling_halo'] = fit_ellipse(circle_pts(P['halo_r'], P['halo_z'][0]))
    A['ellipses'] = E
    A['points'] = dict(
        emitter_centre=project(scn, cam, (pc[0], pc[1], top + 0.005)),
        emitter_axis_top=project(scn, cam, (pc[0], pc[1], top + 1.15)),
        pedestal_front_top=project(scn, cam, (pc[0], pc[1] - R, top)),
        pedestal_front_bottom=project(scn, cam, (pc[0], pc[1] - R, top - band)),
    )
    # pedestal band: engraving path along the band mid-line (front half), + top/bottom edges
    def band_curve(z, a0=-math.pi + 0.35, a1=-0.35, n=64):
        return [project(scn, cam, (pc[0] + R * math.cos(a0 + (a1 - a0) * i / n), pc[1] + R * math.sin(a0 + (a1 - a0) * i / n), z))
                for i in range(n + 1)]
    zmid = top - band / 2
    A['curves'] = dict(
        pedestal_band_mid=dict(points=band_curve(zmid), note='SVG textPath for "Your skin. Understood." / "Evia"'),
        pedestal_band_top=dict(points=band_curve(top - 0.006)),
        pedestal_band_bottom=dict(points=band_curve(top - band)),
    )
    # engraving boxes (quads on the cylinder: 4 corners = band top/bottom at the two angles)
    def band_quad(x_left_ref, x_right_ref, pad=0.012):
        # find angles on the front half whose projection hits the given ref columns
        def angle_for(xref):
            best = None
            for i in range(2001):
                a = -math.pi + math.pi * i / 2000
                wx, wy = pc[0] + R * math.cos(a), pc[1] + R * math.sin(a)
                d = abs(REF_W / 2 + f_px() * wx / wy - xref)     # reference column of that band point
                if best is None or d < best[0]:
                    best = (d, a)
            return best[1]
        a0, a1 = angle_for(x_left_ref), angle_for(x_right_ref)
        pts = []
        for a, z in ((a0, top - pad), (a1, top - pad), (a1, top - band + pad), (a0, top - band + pad)):
            pts.append(project(scn, cam, (pc[0] + R * math.cos(a), pc[1] + R * math.sin(a), z)))
        return pts
    S['pedestal_text_left'] = dict(quad=band_quad(530, 750), text='Your skin. Understood.', tone='engraved',
                                   blurPx=coc_px(scn, cam, 2.85, W))
    S['pedestal_text_right'] = dict(quad=band_quad(1050, 1130), text='Evia', tone='engraved',
                                    blurPx=coc_px(scn, cam, 2.95, W))
    # wall text areas: physical rectangles on the blank wall surfaces, projected (perspective quads)
    S['wall_left_text'] = dict(quad=_plane_rect(scn, cam, info['nook_back'], (50, 125, 215, 272)),
                               lines=['Evia', 'HIGHER SKIN STANDARDS', 'A BRIGHTER YOU'], tone='engraved-glow',
                               refBox=[50, 125, 215, 272],
                               blurPx=coc_px(scn, cam, _plane_depth(info['nook_back'], (132, 200)), W))
    S['wall_right_text'] = dict(quad=_plane_rect(scn, cam, info['right_panel'], (1542, 70, 1640, 312)),
                                lines=['MORE', 'THAN', 'SKIN', 'ANALYZE', 'UNDERSTAND', 'PERSONALIZE', 'IMPROVE',
                                       'TOGETHER'], tone='engraved', refBox=[1542, 70, 1640, 312],
                                blurPx=coc_px(scn, cam, _plane_depth(info['right_panel'], (1590, 190)), W))
    # book spines
    titles = ['A BRIGHTER YOU', 'BEAUTY', 'SCIENCE']
    for (ob, x, y, wd, dp, th, rz, zc), t in zip(info['books'], titles):
        M = Matrix.Rotation(rz, 4, 'Z')
        c = Vector((x, y, zc))
        corners = []
        for sx, sz in ((-1, 1), (1, 1), (1, -1), (-1, -1)):
            p = c + (M @ Vector((sx * (wd / 2 - 0.02), -dp / 2 - 0.0015, sz * (th / 2 - 0.008))))
            corners.append(project(scn, cam, p))
        S['book_spine_' + t.split()[-1].lower()] = dict(quad=corners, text=t, tone='debossed',
                                                        blurPx=coc_px(scn, cam, y - dp / 2, W))
    A['surfaces'] = S
    # character slot (SVG overlay) in ref px -> normalised
    def nb(x, y, w, h, depth=4.35):
        # ref px box -> plate-normalised [x, y, w, h]: the box is a world rectangle facing the camera at `depth`
        # (the character plane), projected through the active camera (== ref box / margin on desktop)
        pts = [project(scn, cam, rp(px, py, depth)) for px, py in ((x, y), (x + w, y), (x + w, y + h), (x, y + h))]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        return [round(min(xs), 5), round(min(ys), 5), round(max(xs) - min(xs), 5), round(max(ys) - min(ys), 5)]
    char_depth = 4.35
    A['character'] = dict(
        bbox=nb(130, 135, 515, 665), note='bbox = [x, y, w, h]; lower body hidden by fg (pedestal + books)',
        restingHand=nb(425, 665, 95, 47), presentingHand=nb(490, 485, 155, 75),
        headTarget=project(scn, cam, rp(415, 255, char_depth)),
        depthM=char_depth, pxPerMetre=round(abs(project(scn, cam, rp(836, 400, char_depth) + Vector((1, 0, 0)))[0]
                                                - project(scn, cam, rp(836, 400, char_depth))[0]) * W, 1),
        blurPx=coc_px(scn, cam, char_depth, W),
        zIndex='between room plate (below) and fg plate (above); resting hand group above fg')
    A['layers'] = dict(
        plate=dict(depthM=12.0, z=0), character=dict(depthM=char_depth, z=1), fg=dict(depthM=3.3, z=2),
        hologram=dict(depthM=P['ped_c'][1], z=4), text=dict(z=5))
    A['light'] = dict(keyDir2d=[0.8, -0.3], keyColour='#8eb0f2', rimColour='#f8ad99', ambientColour='#3a2427',
                      note='cool hologram key from the pedestal centre (right of the character), warm rose rim from the left wall coves')
    A['camera'] = dict(name='C2 mobile' if mobile else 'C1 desktop', lens_mm=P['lens'],
                       sensor_width_mm=round(cam.data.sensor_width, 4), shift=[round(cam.data.shift_x, 5), round(cam.data.shift_y, 5)],
                       height_m=P['cam_h'], horizon_ref_y=P['horizon_y'], focus_m=P['focus'], fstop=P['fstop'])
    return A


def _ray_plane(pl, px, py):
    d = rp(px, py, 1.0) - Vector((0, 0, P['cam_h']))
    o = Vector((0, 0, P['cam_h']))
    t = (pl['o'] - o).dot(pl['n']) / d.dot(pl['n'])
    return o + d * t


def _plane_depth(pl, pt):
    return _ray_plane(pl, pt[0], pt[1]).y


def _plane_rect(scn, cam, pl, box_ref):
    """Rectangle on plane pl (o,u,v,n) whose projection spans the ref box; returns its projected quad
    (TL, TR, BR, BL) - a true perspective quad for a CSS matrix3d homography."""
    x0, y0, x1, y1 = box_ref
    xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
    o, u, v = pl['o'], pl['u'], pl['v']
    sl = (_ray_plane(pl, x0, ym) - o).dot(u); sr = (_ray_plane(pl, x1, ym) - o).dot(u)
    tt = (_ray_plane(pl, xm, y0) - o).dot(v); tb = (_ray_plane(pl, xm, y1) - o).dot(v)
    eps = -pl['n'] * 0.0 + pl['n'] * 0.002
    return [project(scn, cam, o + u * s + v * t + eps) for s, t in ((sl, tt), (sr, tt), (sr, tb), (sl, tb))]


# ----------------------------------------------------------------------------- main
# ----------------------------------------------------------------------------- living-room masks
STRIP_KINDS = [  # (object-name regex, kind, group) for `--passes masks`
    (r'^halo_(led|band)$', 'ring', 'ceiling_halo'), (r'^ring_light$', 'ring', 'ring_light'),
    (r'^tier_\d+_led$', 'tier', 'tiers'), (r'^ped_led_under$', 'under', 'pedestal'),
    (r'^nook_plinth_led_\d+$', 'plinth', 'nook'), (r'^nook_', 'nook', 'nook'), (r'^step_led$', 'step', None),
    (r'^(jamb_left|pilaster_R)_led$', 'wall', None), (r'^right_strip_', 'wall', 'right_panel'),
]


def mask_spec():
    """Object classification for mask_passes.render_masks (consult C1 desktop / C2 mobile)."""
    import re
    obs = sorted(bpy.data.objects, key=lambda o: o.name)
    plants = []
    for o in COLS['plants'].objects if 'plants' in COLS else []:
        mats = {sl.material.name for sl in o.material_slots if sl.material}
        if o.type != 'MESH' or not (mats & {'leaf', 'blossom'}):
            continue
        stems = [x.name for x in obs if re.match(rf'^{re.escape(o.name)}_stem\d+$', x.name)]
        plants.append(dict(name=o.name, kind='tree' if o.name.startswith('tree_') else 'shrub',
                           objects=[o.name] + stems, leaf_objects=[o.name], base=None))
    plants.sort(key=lambda d: d['name'])
    lamps = [dict(name=o.name, object=o.name, kind='beacon', motion='blink') for o in obs
             if o.type == 'MESH' and re.match(r'^bld_\d+_\d+_red$', o.name)]
    strips = []
    for cname in ('neon', 'under'):
        for o in sorted(COLS[cname].objects if cname in COLS else [], key=lambda o: o.name):
            if o.type not in ('MESH', 'CURVE') or not o.visible_camera:
                continue
            kind, group = 'strip', o.name
            for rx, k, g in STRIP_KINDS:
                if re.match(rx, o.name):
                    kind, group = k, (g or o.name)
                    break
            strips.append(dict(name=o.name, object=o.name, kind=kind, group=group))
    pc = P['ped_c']
    return dict(plants=plants, lamps=lamps, strips=strips, glass_mats=['window_glass'],
                facade_mats={'city': dict(hash_channel='Green', haze=False)}, street_mats=['city_street'],
                city_collections=['city'],
                emitter=dict(objects=['ped_emitter_rim'], glass='ped_glass', centre=(pc[0], pc[1], P['ped_top']),
                             radius=P['ped_r']))


def main_masks(args):
    """`--passes masks`: the living-room masks for the published plate of this camera (final-tier framing)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import mask_passes as MP
    P['margin'] = args['margin'] if args['margin'] is not None else (0.1 if args['camera'] == 'desktop' else 0.0)
    scn = reset()
    build(scn, args)
    lights(scn)
    cam = camera(scn, args['camera'])
    W, H = args['res'] or ((2560, 1440) if args['camera'] == 'desktop' else MOBILE_RES)
    base = f"consult_{args['camera']}"
    out_dir = os.path.abspath(args['out'])
    MP.render_masks(scn, cam, W, H, args['spp'] or 64, out_dir, base, mask_spec(), mist=(0.5, 39.5))
    if args['save_blend']:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args['save_blend']))
    if args['render']:
        MP.run(base, out_dir)


def main():
    args = parse_args()
    if args['passes'] == 'masks':
        return main_masks(args)
    if args['margin'] is not None:
        P['margin'] = args['margin']
    elif args['tier'] == 'final' and args['camera'] == 'desktop':
        P['margin'] = 0.1          # 10 % safe margin on every side for responsive object-fit: cover
    scn = reset()
    info = build(scn, args)
    lights(scn)
    cam = camera(scn, args['camera'])
    W, H, spp = setup_render(scn, args)
    out_dir = os.path.abspath(args['out'])
    os.makedirs(out_dir, exist_ok=True)
    base = f"consult_{args['camera']}_{args['tier']}"
    A = anchors(scn, cam, info, W, H)
    src = open(os.path.abspath(__file__), 'rb').read()
    A['build'] = dict(blender=bpy.app.version_string, script_sha256=hashlib.sha256(src).hexdigest(), seed=SEED,
                      tier=args['tier'], spp=spp, res=[W, H], params=P)
    with open(os.path.join(out_dir, base + '_anchors.json'), 'w') as fh:
        json.dump(A, fh, indent=1)
    if scn.render.engine == 'CYCLES':
        setup_passes(scn, out_dir, base)
    scn.render.filepath = os.path.join(out_dir, base + '_beauty.png')
    scn.render.image_settings.file_format = 'PNG'
    scn.render.image_settings.color_depth = '8'
    if args['save_blend']:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args['save_blend']))
    if not args['render']:
        print('built, not rendering'); return
    import time
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    # rename the file-output EXR (<base>_0001.exr -> <base>.exr)
    for fn in os.listdir(out_dir):
        if fn.startswith(base + '_') and fn.endswith('.exr'):
            os.replace(os.path.join(out_dir, fn), os.path.join(out_dir, base + '.exr'))
    A['build']['render_seconds'] = round(dt, 1)
    with open(os.path.join(out_dir, base + '_anchors.json'), 'w') as fh:
        json.dump(A, fh, indent=1)
    print(f'RENDER DONE {base} {W}x{H} spp={spp} in {dt:.1f}s')


if __name__ == '__main__':
    main()
