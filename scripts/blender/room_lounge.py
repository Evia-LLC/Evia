"""Evia lounge (Home screen environment): procedural Blender 4.5 LTS scene + render driver.

RENDER DRIVER. One render per process, always through the lock wrapper (serialises renders on this machine):

  LOCK=/Users/olaajibade/Documents/Codex/2026-09-16/hi/work/evia-rebuild/tools/blender-render.sh
  S=scripts/blender/room_lounge.py
  # preview tier (Cycles 16 spp adaptive 0.05, OIDN):  home 960x540 | home_mobile 360x780 | sidebar_window 320x1024
  $LOCK $S -- --camera home --tier preview --out /path/to/workdir
  # final tier (Cycles, OIDN + denoised 'glow' light group). Shipped plates (default spp 48):
  #   home 2560x1440 --spp 40 (~33 min on the 2-core i3) | home_mobile 1080x2340 --spp 40 (~17 min)
  #   sidebar_window 640x2048 --spp 32 (~11 min)
  $LOCK $S -- --camera home --tier final --spp 40 --out /path/to/workdir
  $LOCK $S -- --camera home_mobile --tier final --spp 40 --out /path/to/workdir
  $LOCK $S -- --camera sidebar_window --tier final --spp 32 --out /path/to/workdir
  # quick layout check (Workbench, seconds): --tier blockout ; other options: --spp N --res WxH
  #   --save-blend file.blend --no-render
  # then grade + encode (Blender's bundled python; see lounge_post.py for all options):
  PY=/Applications/Blender.app/Contents/Resources/4.5/python/bin/python3.11
  $PY scripts/blender/lounge_post.py preview <out>/cam_home_preview_0001.exr graded.png --look lounge
  $PY scripts/blender/lounge_post.py publish <out>/cam_home_final_0001.exr public/env/lounge home --look lounge
  $PY scripts/blender/lounge_post.py publish <out>/cam_home_mobile_final_0001.exr public/env/lounge mobile \
      --look lounge --sizes 1080,720
  $PY scripts/blender/lounge_post.py publish <out>/cam_sidebar_window_final_0001.exr public/env/lounge \
      strip-window --look strip --sizes 640,320 --soft 320:1.2 --no-layers
  # living-room masks (plants/sway, sky, glass, city windows, lamps, LED coves, depth) for the web layer's
  # animation: same scene/camera/DOF at the published plate size, flat AOV shaders, 128 spp, ~3-6 min each
  # (mask_passes.py), then encoded + merged into the anchors by mask_post.py (see public/env/lounge/README.md):
  $LOCK $S -- --camera home --passes masks --spp 128 --out /path/to/workdir          # -> home_masks.exr/.json
  $PY scripts/blender/mask_post.py publish <out>/home_masks.exr --out public/env/lounge --prefix home- \
      --sizes 2560,1280 --anchors public/env/lounge/anchors.json

Cameras: 'home' = L1 desktop Home plate (16:9; ref1 Home panel framed right-anchored inside a 10 % safe
margin, recorded as refFrame in the anchors); 'home_mobile' = L2 phone portrait (same lounge, seating
group framed for a 9:19.5 screen); 'sidebar_window' = L3 sidebar strip (ref2 sidebar): a dedicated corner
of the same lounge built by build_strip_scene() (same materials, sky and city): a big rose plaster column on
a stepped LED plinth, a floating D-shaped ceiling soffit whose cove arc is fitted to ref2's arc, the dusk
window with a few tall towers, a tall plant and cream banquette/sofa, glossy floor. The strip is rendered
clean; the app lays its dark rose-brown glass (CSS) over it.

Each render writes <out>/<camera>_<tier>_0001.exr (multilayer half float: rgb = denoised beauty,
glow = denoised 'glow' light group (LEDs/coves/lamps), mist, fgmask = cryptomatte matte of the
right-foreground props) plus <out>/<camera>_<tier>_anchors.json (projected overlay anchors) and _meta.json
(Blender version, seed, params, spp, render time, sha256 of this script and the lib).
Grading, bloom, view transform and WebP encoding are done by lounge_post.py (numpy + OpenImageIO +
PyOpenColorIO), so the look can be re-graded without re-rendering.

Everything is procedural and deterministic (random.Random(SEED), fixed Cycles seed, no textures/HDRIs).
Coordinates: metres, Z up. The Home camera stands at (0,0,1.0) looking along +Y.
Layout is reference-driven: key features are placed on the camera ray through their pixel in
ref1.png (Home panel = ref x 0..993, y 0..1023) at a chosen depth, so the 2D composition matches.
The armchair is deliberately further back (4 m) than in ref1 so the empty-chair plate reads across the
room; its character slot is exported in the anchors.
"""
import sys
import os
import math
import json
import random
import hashlib

import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lounge_lib as L  # noqa: E402

SEED = 1729
KSHIFT = 600   # interior light colour temperatures are authored as 'look' values; +600 K neutralises AgX's warm push


def K(k):
    return L.kelvin(k + KSHIFT)

# ----------------------------------------------------------------------------- parameters
P = dict(
    cam_loc=(0.0, 0.0, 1.0),
    lens_ref=35.0,                # lens (36 mm sensor) that frames the ref Home panel height as a 16:9 plate height
    axis_ref_x=83.8,              # ref1 x of the optical axis (yaw 0 looks along +Y)
    horizon_ref_y=387.0,          # ref1 horizon (pitch 0, vertical lens shift)
    plate=(2560, 1440),           # nominal design plate (16:9)
    margin=0.10,                  # safe margin around the ref frame, as a fraction of the ref frame size, every side
    ref_w=994, ref_h=1024,        # ref1 Home panel; placed right-anchored inside the plate, inset by the margin
    ceil_hi=3.30,                 # perimeter (raised) ceiling
    win_head=3.12,                # underside of the curtain-pocket bulkhead along the glazing
    island_z=2.90,                # floating ceiling island underside (its edge carries the amber cove)
    glass_y=13.5,
    focus=4.0, aperture_mm=12.5,  # physical aperture diameter (35 mm f/2.8); fstop = lens / aperture
    chair=(1.37, 4.0, -36.0),    # tub chair centre x, y (m) and yaw (deg; 0 = opening faces -Y)
    city_alt=60.0,               # camera height above the city streets (m)
    emit_gain=1.7,               # multiplier on every interior emitter (LEDs, globes, candle, downlights)
    sky_gain=1.8,                # multiplier on the dusk sky + city emission (exposure is pulled down in post)
)

# ref1 landmark curve of the amber cove (island edge), ref px
COVE_REF = [(300, -12), (320, 0), (380, 29), (460, 53), (540, 71), (620, 87), (700, 99), (760, 107), (790, 110),
            (830, 107), (870, 103), (910, 99), (950, 93), (985, 88), (1010, 84)]

COLORS = dict(
    plaster=L.hexcol('#D8BCB4'),
    ceiling=L.hexcol('#D9BCB2'),
    niche=L.hexcol('#DDB2A4'),
    floor=L.hexcol('#74524A'),
    chair=L.hexcol('#7E5A50'),
    sofa=L.hexcol('#A88E82'),
    ottoman=L.hexcol('#9E8276'),
    planter=L.hexcol('#DCCABF'),
    marble=L.hexcol('#E2D2CA'),
    vein=L.hexcol('#B7A59E'),
    leaf_a=L.hexcol('#3E4A2C'),
    leaf_b=L.hexcol('#8A8A4C'),
    bronze=L.hexcol('#4A3528'),
)


def ref_frame(W=None, H=None):
    """Where the ref1 Home panel sits inside a W x H plate: (x0, y0, scale, w, h) in plate px.
    The frame is inset by P['margin'] of its own size on every side and right-anchored."""
    W = W or P['plate'][0]
    H = H or P['plate'][1]
    m = P['margin']
    hf = H / (1 + 2 * m)
    s = hf / P['ref_h']
    wf = P['ref_w'] * s
    return W - m * wf - wf, m * hf, s, wf, hf


def ref_to_plate(rx, ry, W=None, H=None):
    x0, y0, s, _, _ = ref_frame(W, H)
    return x0 + rx * s, y0 + ry * s


def plate_to_ref(px, py, W=None, H=None):
    x0, y0, s, _, _ = ref_frame(W, H)
    return (px - x0) / s, (py - y0) / s


def home_lens_shift(W, H):
    """Lens + shifts so that every ref1 pixel keeps the same world ray whatever the plate margin."""
    x0, y0, s, _, _ = ref_frame(W, H)
    k_ref = 36.0 / P['lens_ref'] / 2560.0 * (1440.0 / P['ref_h'])   # tan per ref px
    big = max(W, H)
    lens = 36.0 / (k_ref / s * big)
    cx = x0 + P['axis_ref_x'] * s
    cy = y0 + P['horizon_ref_y'] * s
    return lens, (W / 2 - cx) / big, (cy - H / 2) / big


# ----------------------------------------------------------------------------- build

class Scene:
    def __init__(self):
        self.rng = random.Random(SEED)
        self.scn = L.reset_scene()
        self.col_room = L.collection('room')
        self.col_city = L.collection('city')
        self.col_fg = L.collection('fg')
        self.col_light = L.collection('lights')
        self.col_cam = L.collection('cams')
        self.glow_objs = []
        self.anchors = {}
        self.mats = {}
        self.home = None

    # -- materials
    def build_materials(self):
        C = COLORS
        M = self.mats
        EG, SG = P['emit_gain'], P['sky_gain']
        M['plaster'] = L.plaster_material('plaster', C['plaster'], rough=0.9, var=0.05)
        M['ceiling'] = L.plaster_material('ceiling', C['ceiling'], rough=0.9, var=0.04, scale=1.5)
        M['niche'] = L.plaster_material('niche_face', C['niche'], rough=0.85, var=0.03)
        M['floor'] = L.stone_floor_material('floor', C['floor'], tile=1.2, rough=0.16)
        M['chair'] = L.boucle_material('chair_boucle', C['chair'], scale=160, strength=0.5)
        M['sofa'] = L.boucle_material('sofa_boucle', C['sofa'], scale=120, strength=0.5)
        M['ottoman'] = L.boucle_material('ottoman_boucle', C['ottoman'], scale=120, strength=0.5)
        M['rug'] = L.boucle_material('rug_wool', L.hexcol('#8E7268'), scale=90, strength=0.35, sheen=0.3)
        M['planter'] = L.plaster_material('planter', C['planter'], rough=0.6, var=0.03)
        M['planter_dim'] = L.plaster_material('planter_dim', L.hexcol('#C9B2A6'), rough=0.6, var=0.03)
        M['marble'] = L.marble_material('marble', C['marble'], C['vein'], vein_width=0.05)
        M['leaf'] = L.leaf_material('leaf', C['leaf_a'], C['leaf_b'], trans=0.42)
        M['stem'] = L.principled('stem', L.hexcol('#3B2A1C'), rough=0.7)
        M['fluted'] = self.flute_material('column_fluted', C['plaster'], axis='X', freq=90.0)
        M['bronze'] = L.metal_material('bronze', C['bronze'], rough=0.35)
        M['glass'] = L.glass_material('window_glass', refl=0.0)   # no LED reflections streaking across the sky
        M['acrylic'] = L.acrylic_material('acrylic', tint='#EBCFC2', rough=0.12)
        M['acrylic_edge'] = L.emission_mat('acrylic_edge', K(2700), 5.0 * EG, indirect=0.3)
        M['dark'] = L.principled('dark_recess', L.hexcol('#2A1A12'), rough=0.8)
        M['wood'] = L.principled('walnut', L.hexcol('#5A3A28'), rough=0.45, coat=0.3)
        M['soil'] = L.principled('soil', L.hexcol('#2B1C12'), rough=1.0)
        # emitters (light group 'glow')
        M['cove'] = L.emission_mat('led_cove', L.kelvin(2500), 40.0 * EG, indirect=0.5)
        M['cove_wash'] = L.emission_mat('led_cove_wash', K(2800), 3.0)
        M['portal'] = self.gradient_led('led_portal', L.kelvin(3000), 16.0 * EG, z0=0.6, z1=2.4)
        M['niche_led'] = L.emission_mat('led_niche', L.kelvin(2800), 120.0 * EG, indirect=0.35)
        M['niche_back'] = L.emission_mat('led_niche_back', K(3200), 32.0)
        M['strip'] = L.emission_mat('led_strip', K(2800), 25.0 * EG, indirect=0.45)
        M['globe'] = L.principled('globe_opal', L.hexcol('#FFF3E6'), rough=0.3, emission=L.kelvin(2500),
                                  estrength=20.0 * EG)
        M['candle'] = L.principled('candle_glass', L.hexcol('#FFF0E0'), rough=0.2, emission=L.kelvin(2300),
                                   estrength=18.0)
        M['downlight'] = L.emission_mat('downlight', K(3000), 40.0 * EG, indirect=0.3)
        # city
        M['facade'] = L.city_window_material('facade', L.hexcol('#2A2230'), L.kelvin(2300), L.kelvin(3400),
                                             density=0.30, emit=2.4 * SG, floor_h=3.4, bay=1.7,
                                             haze=(L.hexcol('#A0606A'), 900.0, 0.88, 0.8 * SG),
                                             win=(0.3, 0.7, 0.3, 0.72), cool_frac=0.12)
        M['city_ground'] = self.city_ground_material()
        M['red'] = L.emission_mat('aviation_red', (1, 0.05, 0.02, 1), 40.0)
        for k, m in M.items():
            # viewport colour for Workbench blockouts
            try:
                bsdf = m.node_tree.nodes.get(m.get('_bsdf', ''))
                if bsdf:
                    m.diffuse_color = bsdf.inputs['Base Color'].default_value
            except Exception:
                pass
        return M

    def flute_material(self, name, color, axis='X', freq=80.0):
        """Plaster with vertical flutes (sine bump along an object axis)."""
        m, nb, out = L.new_material(name)
        tc = nb.node('ShaderNodeTexCoord')
        sep = nb.node('ShaderNodeSeparateXYZ')
        nb.link(tc.outputs['Object'], sep.inputs['Vector'])
        mul = nb.node('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = freq
        nb.link(sep.outputs[axis], mul.inputs[0])
        sn = nb.node('ShaderNodeMath')
        sn.operation = 'SINE'
        nb.link(mul.outputs['Value'], sn.inputs[0])
        ab = nb.node('ShaderNodeMath')
        ab.operation = 'ABSOLUTE'
        nb.link(sn.outputs['Value'], ab.inputs[0])
        bp = nb.node('ShaderNodeBump')
        bp.inputs['Strength'].default_value = 0.5
        bp.inputs['Distance'].default_value = 0.01
        nb.link(ab.outputs['Value'], bp.inputs['Height'])
        p = nb.node('ShaderNodeBsdfPrincipled')
        p.inputs['Base Color'].default_value = color
        p.inputs['Roughness'].default_value = 0.8
        nb.link(bp.outputs['Normal'], p.inputs['Normal'])
        nb.link(p.outputs['BSDF'], out.inputs['Surface'])
        return m

    def gradient_led(self, name, color, strength, z0, z1):
        """Emitter whose strength fades toward the floor (portal LED: bright at the arch, dim low down)."""
        m, nb, out = L.new_material(name)
        geo = nb.node('ShaderNodeNewGeometry')
        sep = nb.node('ShaderNodeSeparateXYZ')
        nb.link(geo.outputs['Position'], sep.inputs['Vector'])
        mr = nb.node('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = z0
        mr.inputs['From Max'].default_value = z1
        mr.inputs['To Min'].default_value = 0.15
        mr.inputs['To Max'].default_value = 1.0
        nb.link(sep.outputs['Z'], mr.inputs['Value'])
        mul = nb.node('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = strength
        nb.link(mr.outputs['Result'], mul.inputs[0])
        em = nb.node('ShaderNodeEmission')
        em.inputs['Color'].default_value = color
        nb.link(mul.outputs['Value'], em.inputs['Strength'])
        nb.link(em.outputs['Emission'], out.inputs['Surface'])
        return m

    def city_ground_material(self):
        """Dark city floor with scattered warm street-light speckles."""
        m, nb, out = L.new_material('city_ground')
        tc = nb.node('ShaderNodeTexCoord')
        vo = nb.node('ShaderNodeTexVoronoi')
        vo.inputs['Scale'].default_value = 0.02
        vo.feature = 'F1'
        nb.link(tc.outputs['Object'], vo.inputs['Vector'])
        nz = nb.node('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 0.004
        nz.inputs['Detail'].default_value = 4
        nb.link(tc.outputs['Object'], nz.inputs['Vector'])
        lt = nb.node('ShaderNodeMath')
        lt.operation = 'LESS_THAN'
        lt.inputs[1].default_value = 0.08
        nb.link(vo.outputs['Distance'], lt.inputs[0])
        mul = nb.node('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        nb.link(lt.outputs['Value'], mul.inputs[0])
        nb.link(nz.outputs['Fac'], mul.inputs[1])
        mul2 = nb.node('ShaderNodeMath')
        mul2.operation = 'MULTIPLY'
        mul2.inputs[1].default_value = 60.0 * P['sky_gain']
        nb.link(mul.outputs['Value'], mul2.inputs[0])
        em = nb.node('ShaderNodeEmission')
        em.inputs['Color'].default_value = L.kelvin(2400)
        nb.link(mul2.outputs['Value'], em.inputs['Strength'])
        df = nb.node('ShaderNodeBsdfDiffuse')
        df.inputs['Color'].default_value = L.hexcol('#120E14')
        ad = nb.node('ShaderNodeAddShader')
        nb.link(df.outputs['BSDF'], ad.inputs[0])
        nb.link(em.outputs['Emission'], ad.inputs[1])
        # same aerial haze as the facades so the ground fades into the lit dusk haze toward the horizon
        L.add_haze(nb, ad.outputs['Shader'], out, (L.hexcol('#A0606A'), 900.0, 0.88, 0.8 * P['sky_gain']))
        return m

    # -- world / sky
    def build_world(self):
        w = bpy.data.worlds.new('dusk')
        self.scn.world = w
        w.use_nodes = True
        nt = w.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        nb = L.NodeBuilder(nt)
        out = nb.node('ShaderNodeOutputWorld')
        tc = nb.node('ShaderNodeTexCoord')
        sep = nb.node('ShaderNodeSeparateXYZ')
        nb.link(tc.outputs['Generated'], sep.inputs['Vector'])
        ramp = nb.node('ShaderNodeValToRGB')
        cr = ramp.color_ramp
        cr.interpolation = 'B_SPLINE'
        stops = [(-0.08, '#2A1A26'), (-0.002, '#D8482A'), (0.02, '#C83E30'), (0.05, '#AC3A40'),
                 (0.085, '#843A52'), (0.115, '#5C3A60'), (0.14, '#463866'), (0.17, '#38366A'), (0.3, '#262B52'),
                 (0.5, '#161A36')]
        # map z in [-0.1, 0.5] -> [0,1]
        z_lo, z_hi = -0.1, 0.5
        els = cr.elements
        while len(els) < len(stops):
            els.new(0.5)
        for e, (z, hx) in zip(els, stops):
            e.position = (z - z_lo) / (z_hi - z_lo)
            e.color = L.hexcol(hx)
        mr = nb.node('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = z_lo
        mr.inputs['From Max'].default_value = z_hi
        nb.link(sep.outputs['Z'], mr.inputs['Value'])
        nb.link(mr.outputs['Result'], ramp.inputs['Fac'])
        # sun glow lobe behind the main window (azimuth ~ +11 deg, just below horizon)
        az, el = math.radians(-11.5), math.radians(2.5)
        sd = Vector((-math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
        dp = nb.node('ShaderNodeVectorMath')
        dp.operation = 'DOT_PRODUCT'
        dp.inputs[1].default_value = tuple(sd)
        nb.link(tc.outputs['Generated'], dp.inputs[0])
        mx0 = nb.node('ShaderNodeMath')
        mx0.operation = 'MAXIMUM'
        mx0.inputs[1].default_value = 0.0
        nb.link(dp.outputs['Value'], mx0.inputs[0])
        pw = nb.node('ShaderNodeMath')
        pw.operation = 'POWER'
        pw.inputs[1].default_value = 70.0
        nb.link(mx0.outputs['Value'], pw.inputs[0])
        glow_col = nb.node('ShaderNodeMix')
        glow_col.data_type = 'RGBA'
        glow_col.blend_type = 'ADD'
        glow_col.inputs['B'].default_value = L.hexcol('#FF8466')
        gm = nb.node('ShaderNodeMath')
        gm.operation = 'MULTIPLY'
        gm.inputs[1].default_value = 0.55
        nb.link(pw.outputs['Value'], gm.inputs[0])
        nb.link(gm.outputs['Value'], glow_col.inputs['Factor'])
        nb.link(ramp.outputs['Color'], glow_col.inputs['A'])
        bg = nb.node('ShaderNodeBackground')
        bg.inputs['Strength'].default_value = 1.6 * P['sky_gain']
        self.world_bg = bg
        nb.link(glow_col.outputs['Result'], bg.inputs['Color'])
        nb.link(bg.outputs['Background'], out.inputs['Surface'])
        w.lightgroup = ''
        return w

    # -- camera
    def build_home_camera(self):
        W, H = P['plate']
        lens, shift_x, shift_y = home_lens_shift(W, H)
        cam = L.Cam('cam_home', P['cam_loc'], 0.0, lens, W, H, shift_x=shift_x, shift_y=shift_y,
                    col=self.col_cam)
        self.home = cam
        return cam

    def R(self, rx, ry, depth):
        px, py = ref_to_plate(rx, ry)
        return self.home.at_depth(px, py, depth)

    def Rz(self, rx, ry, z):
        px, py = ref_to_plate(rx, ry)
        return self.home.on_plane_z(px, py, z)

    def Rplane(self, rx, ry, p0, n):
        px, py = ref_to_plate(rx, ry)
        return self.home.on_plane(px, py, p0, n)

    def glow(self, ob):
        self.glow_objs.append(ob)
        return ob

    # -- architecture
    def build_architecture(self):
        M = self.mats
        col = self.col_room
        ch = P['ceil_hi']
        # floor + raised ceiling are built at the end (clipped to the glazing and the right wall)

        # --- glazing: plan polyline, floor to ceiling, bronze mullions
        gy = P['glass_y']
        glaze = [(-14.0, 8.4), (-10.5, 10.2), (-7.0, 11.4), (-4.2, 12.2), (-1.6, 12.8), (1.0, 13.25)]
        self.glaze = glaze
        # right wall corner: where the window meets the niche wall (ref x ~720)
        corner = self.Rplane(720, 300, (0, gy + 0.05, 0), (0, 1, 0))
        corner = Vector((corner.x, gy + 0.05, 0))
        glaze.append((corner.x, corner.y))
        self.corner = corner
        for i in range(len(glaze) - 1):
            a, b = Vector(glaze[i] + (0,)), Vector(glaze[i + 1] + (0,))
            ob = L.mesh_from_pydata(f'glass_{i}', [a, b, b + Vector((0, 0, ch)), a + Vector((0, 0, ch))],
                                    [(0, 1, 2, 3)], M['glass'], col)
            ob.visible_shadow = False
            seg = (b - a)
            # mullion at each polyline vertex; the panes between are wide (ref shows few mullions)
            L.box(f'mullion_{i}', (0.045, 0.06, ch), (a.x, a.y, ch / 2),
                  rot_z=math.atan2(seg.y, seg.x), mat=M['bronze'], col=col)
            # head + sill profiles
            mid = (a + b) / 2
            L.box(f'head_{i}', (seg.length + 0.05, 0.10, 0.06), (mid.x, mid.y, P['win_head'] - 0.03),
                  rot_z=math.atan2(seg.y, seg.x), mat=M['bronze'], col=col)
            # curtain-pocket bulkhead above the glass (window head sits below the raised ceiling)
            nrm = Vector((-seg.y, seg.x, 0)).normalized()
            if nrm.y > 0:
                nrm = -nrm
            bw = 0.42
            L.box(f'bulkhead_{i}', (seg.length + 0.1, bw, ch - P['win_head']),
                  (mid.x + nrm.x * bw / 2, mid.y + nrm.y * bw / 2, (ch + P['win_head']) / 2),
                  rot_z=math.atan2(seg.y, seg.x), mat=M['ceiling'], col=col)
            L.box(f'sill_{i}', (seg.length + 0.05, 0.16, 0.05), (mid.x, mid.y, 0.025),
                  rot_z=math.atan2(seg.y, seg.x), mat=M['bronze'], col=col)
        # extra mullion that ref shows at x~477 (main window)
        pm = self.Rplane(477, 250, (0, 13.3, 0), (0, 1, 0))
        L.box('mullion_ref477', (0.05, 0.06, ch), (pm.x, 13.3, ch / 2), mat=M['bronze'], col=col)

        # --- right wall (niche wall) running from the corner toward the camera at ~30 deg
        wd = Vector((math.sin(math.radians(30)), -math.cos(math.radians(30)), 0))   # toward camera-right
        self.wall_dir = wd
        wn = Vector((-wd.y, wd.x, 0))  # normal; ensure it faces the camera side (-x side)
        if wn.x > 0:
            wn = -wn
        self.wall_n = wn
        w0 = corner
        w1 = corner + wd * 12.0
        L.mesh_from_pydata('wall_right', [w0, w1, w1 + Vector((0, 0, ch)), w0 + Vector((0, 0, ch))],
                           [(0, 3, 2, 1)], M['plaster'], col)
        # floor + raised ceiling clipped to the interior (nothing may poke outside the glass)
        poly = [(-30.0, -8.0), (w1.x + 4, -8.0), (w1.x + 4, w1.y - 6.93 * 0), (w1.x, w1.y), (w0.x, w0.y)]
        poly += [tuple(g) for g in reversed(glaze[:-1])]
        poly += [(-30.0, glaze[0][1])]
        # ensure CCW (normal +Z for the floor)
        ar = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                 for i in range(len(poly)))
        if ar < 0:
            poly = poly[::-1]
        L.mesh_from_pydata('floor', [(x, y, 0) for x, y in poly], [tuple(range(len(poly)))], M['floor'], col)
        L.mesh_from_pydata('ceiling_hi', [(x, y, ch) for x, y in poly], [tuple(range(len(poly) - 1, -1, -1))],
                           M['ceiling'], col)
        # skirting shadow gap
        # --- niche panel: find the wall point that projects to ref x=826
        def wall_point_for_ref_x(rx, ry):
            return self.Rplane(rx, ry, w0, wn)
        pl = wall_point_for_ref_x(826, 300)
        u0 = (pl - w0).dot(wd)
        top_z = wall_point_for_ref_x(826, 150).z
        # panel in wall coords: u from u0 to u0+2.4, z from 0.25 to top_z
        pw, ph = 2.4, top_z - 0.25
        r = 0.36
        off = 0.10
        origin = w0 + wd * (u0 + pw / 2) + wn * off + Vector((0, 0, 0.25 + ph / 2))
        pts = L.rounded_rect(pw, ph, r, n=10)
        # u axis = wd (to the right in image), v axis = up; face normal = u x v must point to camera
        u_dir, v_dir = wd, Vector((0, 0, 1))
        panel = L.panel_on_plane('niche_panel', origin, u_dir, v_dir, pts, thickness=0.05, mat=M['niche'], col=col)
        # make sure its front faces the camera: normal = u x v
        self.niche = dict(origin=origin, u=u_dir, v=v_dir, w=pw, h=ph)
        # LED edge ring (visible bright edge) slightly behind the face, a hair larger than the panel
        ring_pts = L.rounded_rect(pw + 0.03, ph + 0.03, r + 0.015, n=10)
        ring3 = [origin + u_dir * a + v_dir * b - wn * 0.03 for a, b in ring_pts]
        self.glow(L.tube('niche_led', ring3, 0.03, M['niche_led'], col, closed=True))
        # back light: emitter plane behind the panel facing the wall -> halo on the wall
        back = L.panel_on_plane('niche_backlight', origin - wn * 0.06, u_dir, -v_dir,
                                L.rounded_rect(pw - 0.1, ph - 0.1, r, n=6), 0.0, M['niche_back'], col)
        back.visible_camera = False
        self.glow(back)
        # text anchor quad on the panel face (projected later)
        tl = self.Rplane(852, 238, origin, wn)
        bl = self.Rplane(851, 308, origin, wn)
        up = (tl - bl)
        # width: find along wd so that the right edge projects to ref x~975
        best = None
        for i in range(1, 400):
            wdt = i * 0.005
            tr = tl + wd * wdt
            px, py, _ = self.home.project(tr)
            rx = plate_to_ref(px, py)[0]
            if best is None or abs(rx - 975) < best[0]:
                best = (abs(rx - 975), wdt)
        wdt = best[1]
        self.anchor_quads = {'niche_text': [tl, tl + wd * wdt, bl + wd * wdt, bl]}
        # accent rule under the text (ref ~ (852..881, 334))
        rl = self.Rplane(852, 334, origin, wn)
        self.anchor_quads['niche_rule'] = [rl, rl + wd * (wdt * 30 / 123), rl + wd * (wdt * 30 / 123) - Vector((0, 0, 0.015)),
                                           rl - Vector((0, 0, 0.015))]

        # --- partition wall with the rounded portal (left). Column = ref x 291..400 at depth ~7.9
        py0 = 9.0
        c_left = self.Rplane(300, 300, (0, py0, 0), (0, 1, 0)).x    # LED jamb
        c_right = self.Rplane(400, 300, (0, py0, 0), (0, 1, 0)).x
        self.col_x = (c_left, c_right)
        open_l, open_r = -4.4, c_left
        open_top = 3.0
        rad = 0.5
        thick = 0.32
        # wall outline (front face) with a hole: build as separate pieces
        pieces = []
        # right column
        pieces.append(((open_r, c_right), (0, ch)))
        # left pier
        pieces.append(((-9.0, open_l), (0, ch)))
        # lintel above the opening
        pieces.append(((open_l, open_r), (open_top, ch)))
        for i, ((x0, x1), (z0, z1)) in enumerate(pieces):
            L.box(f'partition_{i}', (x1 - x0, thick, z1 - z0), ((x0 + x1) / 2, py0 + thick / 2, (z0 + z1) / 2),
                  mat=M['fluted'] if i == 0 else M['plaster'], col=col, bevel=0.02 if i == 0 else 0.0, seg=2)
        # rounded top corners of the opening (fillets)
        for side, xc in (('r', open_r - rad), ('l', open_l + rad)):
            pts = []
            n = 10
            for k in range(n + 1):
                a = math.radians(90 * k / n)
                if side == 'r':
                    pts.append((xc + rad * math.cos(a) , open_top - rad + rad * math.sin(a)))
                else:
                    pts.append((xc - rad * math.cos(a), open_top - rad + rad * math.sin(a)))
            corner_pt = (open_r, open_top) if side == 'r' else (open_l, open_top)
            poly = [corner_pt] + pts if side == 'l' else pts + [corner_pt]
            # prism in XZ plane -> build verts manually
            v = [(x, py0, z) for x, z in poly] + [(x, py0 + thick, z) for x, z in poly]
            nn = len(poly)
            f = [tuple(range(nn)), tuple(range(2 * nn - 1, nn - 1, -1))]
            for k in range(nn):
                j = (k + 1) % nn
                f.append((k, j, nn + j, nn + k))
            L.mesh_from_pydata(f'portal_fillet_{side}', v, f, M['plaster'], col)
        # LED along the right jamb + arch (on the jamb face, facing into the opening)
        led = []
        for k in range(12):
            z = 0.05 + (open_top - rad - 0.05) * k / 11
            led.append((open_r - 0.01, py0 - 0.005, z))
        for k in range(1, 13):
            a = math.radians(90 * k / 12)
            led.append((open_r - rad + (rad - 0.01) * math.cos(a), py0 - 0.005, open_top - rad + (rad - 0.01) * math.sin(a)))
        led.append((open_l + rad, py0 - 0.005, open_top - 0.01))
        for k in range(1, 13):
            a = math.radians(90 + 90 * k / 12)
            led.append((open_l + rad + (rad - 0.01) * math.cos(a), py0 - 0.005, open_top - rad + (rad - 0.01) * math.sin(a)))
        for k in range(1, 12):
            z = open_top - rad - (open_top - rad - 0.05) * k / 11
            led.append((open_l + 0.01, py0 - 0.005, z))
        self.glow(L.tube('portal_led', led, 0.010, M['portal'], col))

        # --- floating ceiling island: edge from ref cove curve at z=island_z, closed off-screen
        iz = P['island_z']
        edge = [self.Rz(rx, ry, iz) for rx, ry in COVE_REF]
        e_last = edge[-1]
        closure = [Vector((e_last.x + 0.45, e_last.y - 1.2, iz)), Vector((e_last.x + 0.6, e_last.y - 3.2, iz)),
                   Vector((e_last.x + 0.2, 4.0, iz)), Vector((3.0, 1.6, iz)), Vector((0.8, 1.2, iz)),
                   Vector((-0.6, 2.4, iz)), Vector((-0.4, 5.2, iz)), Vector((0.3, 7.0, iz))]
        ring = L.catmull([Vector(p) for p in edge] + closure, n_per=6, closed=True)
        self.island_ring = ring
        pts2 = [(p.x, p.y) for p in ring]
        # ensure CCW
        area = sum(pts2[i][0] * pts2[(i + 1) % len(pts2)][1] - pts2[(i + 1) % len(pts2)][0] * pts2[i][1]
                   for i in range(len(pts2)))
        if area < 0:
            pts2 = pts2[::-1]
        L.prism('ceiling_island', pts2, iz, iz + 0.16, M['ceiling'], col)
        # visible amber cove line at the lower outer edge
        cen = Vector((sum(p[0] for p in pts2) / len(pts2), sum(p[1] for p in pts2) / len(pts2), 0))
        led_pts = []
        wash_pts = []
        for x, y in pts2:
            d = Vector((x, y, 0)) - cen
            d.normalize()
            led_pts.append(Vector((x, y, iz)) + d * 0.012 + Vector((0, 0, 0.012)))
            wash_pts.append(Vector((x, y, iz + 0.17)) - d * 0.05)
        self.glow(L.tube('cove_led', led_pts, 0.014, M['cove'], col, closed=True))
        wash = L.tube('cove_wash', wash_pts, 0.03, M['cove_wash'], col, closed=True)
        wash.visible_camera = False
        self.glow(wash)
        # downlights in the island
        for i, (rx, ry) in enumerate([(472, 3), (640, 30), (860, 40)]):
            p = self.Rz(rx, ry, iz - 0.001)
            L.cylinder(f'downlight_{i}', 0.045, 0.005, (p.x, p.y, iz - 0.004), M['downlight'], col, n=24)
            L.spot_light(f'downspot_{i}', (p.x, p.y, iz - 0.02), (0, 0, 0), 0.03, 8.0, K(3000),
                         angle_deg=50, blend=0.8, col=self.col_light)

    # -- furniture and props
    def build_props(self):
        M = self.mats
        col = self.col_room
        rng = self.rng

        # console + candle globe in front of the column (ref (315..378, 452..461), globe (354,443) d~24)
        cd = 8.55
        cz = self.R(345, 457, cd).z
        cx0, cx1 = self.R(300, 457, cd).x - 0.25, self.R(390, 457, cd).x + 0.4
        L.box('console_top', (cx1 - cx0, 0.36, 0.04), ((cx0 + cx1) / 2, cd + 0.1, cz - 0.02), mat=M['marble'], col=col,
              bevel=0.008)
        L.box('console_base', (0.18, 0.28, cz - 0.04), ((cx0 + cx1) / 2, cd + 0.1, (cz - 0.04) / 2), mat=M['wood'],
              col=col)
        g = self.R(354, 443, cd)
        rr = 12 * ref_frame()[2] * self.home.k * cd
        self.glow(L.uv_sphere('candle_globe', rr, (g.x, cd + 0.1, cz + rr), M['candle'], col))
        self.glow(L.point_light('candle_globe_light', (g.x, cd - 0.05, cz + rr), rr, 2.0, K(2000), self.col_light))

        # fluted cream planter + plant (ref x 181..310, y 601..701)
        fp = self.Rz(245, 701, 0.0)
        fr = 0.5 * abs(self.Rz(310, 701, 0).x - self.Rz(181, 701, 0).x)
        fc = Vector((fp.x, fp.y + fr, 0))
        ftop = self.Rplane(245, 601, (0, fc.y - fr, 0), (0, 1, 0)).z
        pl = L.cylinder('fluted_planter', fr, ftop, (fc.x, fc.y, 0), M['planter'], col, n=64)
        # flutes: displace via a wave bump in a dedicated material
        self.fluted(pl)
        L.cylinder('fluted_soil', fr * 0.92, 0.01, (fc.x, fc.y, ftop - 0.03), M['soil'], col)
        self.glow(L.tube('fluted_rim_led', [(fc.x + (fr + 0.01) * math.cos(a), fc.y + (fr + 0.01) * math.sin(a), ftop + 0.005)
                                            for a in [2 * math.pi * k / 48 for k in range(48)]],
                         0.006, M['strip'], col, closed=True))
        # bushy plant, ref x 190..300, y 440..600
        L.plant_broadleaf('plant_fluted', (fc.x, fc.y, ftop), 0.5, rng, M['leaf'], M['stem'], col, n_leaves=120,
                          leaf_len=(0.10, 0.16), leaf_w=(0.06, 0.10), stems=6, lean=(0.2, 0.5))

        # ottomans in front of the column with floor LED (ref (336..426, 554..635), LED y 641..650)
        op = self.Rz(380, 645, 0.0)
        for i, (dx, dy, s) in enumerate([(-0.2, 0.0, 0.42), (0.26, 0.12, 0.40)]):
            L.box(f'ottoman_{i}', (s, s, 0.36), (op.x + dx, op.y + 0.25 + dy, 0.18 + 0.02), mat=M['ottoman'], col=col,
                  bevel=0.07, seg=4)
        # thin floor-LED line in front of the ottomans (ref y 641..650)
        self.glow(L.box('ottoman_led', (0.95, 0.025, 0.01), (op.x + 0.03, op.y + 0.02, 0.005), mat=M['strip'], col=col))

        # low curved planter with LED top edge (bottom-left, ref (0..300, 735..830))
        # the LED top-front edge is fitted to the ref strip (1,769)->(132,741)->(200,728); body ends ~ref x 210
        hgt = 0.2
        top_curve = [self.Rz(rx, ry, hgt) for rx, ry in [(-1250, 640), (-950, 700), (-650, 745), (-320, 776), (1, 769), (132, 741), (210, 727)]]
        base_curve = [Vector((p.x, p.y, 0.0)) for p in top_curve]
        pc = L.catmull(base_curve, n_per=6)
        depth_w = 0.42
        # build a strip body: front face along pc, extruded backwards (away from camera) by depth_w
        v, f = [], []
        for p in pc:
            v += [(p.x, p.y, 0), (p.x, p.y, hgt), (p.x, p.y + depth_w, hgt), (p.x, p.y + depth_w, 0)]
        for i in range(len(pc) - 1):
            a, b = 4 * i, 4 * (i + 1)
            f += [(a, b, b + 1, a + 1), (a + 1, b + 1, b + 2, a + 2), (a + 2, b + 2, b + 3, a + 3)]
        f.append((0, 1, 2, 3))
        n4 = 4 * (len(pc) - 1)
        f.append((n4 + 3, n4 + 2, n4 + 1, n4))
        L.mesh_from_pydata('low_planter', v, f, M['planter_dim'], col)
        # soil/moss bed inset on top so no bright white top shows between the shrubs
        vs = []
        for p in pc:
            vs += [(p.x, p.y + 0.04, hgt + 0.004), (p.x, p.y + depth_w - 0.03, hgt + 0.004)]
        fs = [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) for i in range(len(pc) - 1)]
        L.mesh_from_pydata('low_planter_soil', vs, fs, M['soil'], col)
        self.glow(L.tube('low_planter_led', [(p.x, p.y - 0.012, hgt - 0.012) for p in pc], 0.009, M['strip'], col))
        # low leafy shrubs only on the left part of the bed (ref shrubs x 0..115, y 665..752)
        x_lim = self.Rz(120, 745, hgt).x
        for i, p in enumerate(pc):
            if p.x > x_lim:
                continue
            L.plant_shrub(f'shrub_{i}', (p.x + rng.uniform(-0.04, 0.04), p.y + depth_w * 0.5, hgt - 0.02), 0.2,
                          0.16, rng, M['leaf'], col, n_leaves=110, leaf_len=(0.045, 0.075))

        # tub armchair (behind the character) — visible parts: left back/arm, right arm front
        self.build_chair(Vector((P['chair'][0], P['chair'][1], 0.0)), math.radians(P['chair'][2]))

        # right-foreground marble side table + acrylic sign (ref table top (841,745)->(995,806))
        tz = 0.42
        left = self.Rz(840, 745, tz)
        tr_ = 0.34
        tc = Vector((left.x + tr_, left.y + 0.05, 0))
        self.table_c = tc
        top = L.cylinder('table_top', tr_, 0.27, (tc.x, tc.y, tz - 0.27), M['marble'], self.col_fg, n=96, bevel=0.05)
        L.cylinder('table_base', tr_ * 0.6, tz - 0.27, (tc.x, tc.y, 0), M['dark'], self.col_fg, n=48)
        self.fg_names = ['table_top', 'table_base', 'acrylic_sign', 'sign_led', 'sign_base', 'sign_edge']
        # sign: bottom edge from ref (866,738) toward (960,758) on the table top plane
        b0 = self.Rz(866, 738, tz)
        b1 = self.Rz(960, 758, tz)
        sd = (b1 - b0)
        sd.z = 0
        sd.normalize()
        top0 = self.Rplane(866, 579, b0, Vector((-sd.y, sd.x, 0)))
        sh = top0.z - tz
        sw = 0.24
        snrm = Vector((-sd.y, sd.x, 0))
        if snrm.dot(Vector(P['cam_loc']) - b0) < 0:
            snrm = -snrm
        # acrylic slab: thickness toward the back
        th = 0.018
        corners = [b0, b0 + sd * sw, b0 + sd * sw + Vector((0, 0, sh)), b0 + Vector((0, 0, sh))]
        vv = [c for c in corners] + [c - snrm * th for c in corners]
        ff = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        sign = L.mesh_from_pydata('acrylic_sign', vv, ff, M['acrylic'], self.col_fg)
        L.add_modifier_bevel(sign, 0.004, 2)
        # light piped to the polished left and top edges (reads as the bright acrylic rim in ref1)
        c0, c3, c2 = corners[0] - snrm * th * 0.5, corners[3] - snrm * th * 0.5, corners[2] - snrm * th * 0.5
        self.glow(L.tube('sign_edge', [c0 + Vector((0, 0, 0.01)), c3 - Vector((0, 0, 0.004)), c2 - sd * 0.004 - Vector((0, 0, 0.004))],
                         0.0022, M['acrylic_edge'], self.col_fg))
        # LED base bar under the sign
        mid = b0 + sd * sw / 2 - snrm * th / 2
        base = L.box('sign_base', (sw + 0.02, th + 0.02, 0.012), (mid.x, mid.y, tz + 0.006),
                     rot_z=math.atan2(sd.y, sd.x), mat=M['bronze'], col=self.col_fg)
        self.glow(L.box('sign_led', (sw, th * 0.6, 0.004), (mid.x, mid.y, tz + 0.0125), rot_z=math.atan2(sd.y, sd.x),
                        mat=M['strip'], col=self.col_fg))
        self.glow(L.point_light('sign_led_light', (mid.x, mid.y, tz + 0.03), 0.05, 1.2 * P['emit_gain'], K(2600), self.col_light))
        # sign text quad (ref TL (898,627) TR (990,641) BR (990,701) BL (897,684)) on the sign's front plane
        q = [self.Rplane(898, 627, b0, snrm), None, None, self.Rplane(897, 684, b0, snrm)]
        upv = q[0] - q[3]
        # width along sd so the right edge projects near ref x=990
        best = None
        for i in range(1, 300):
            wdt = i * 0.001
            px, py, _ = self.home.project(q[0] + sd * wdt)
            rx = plate_to_ref(px, py)[0]
            if best is None or abs(rx - 990) < best[0]:
                best = (abs(rx - 990), wdt)
        q[1] = q[0] + sd * best[1]
        q[2] = q[3] + sd * best[1]
        self.anchor_quads['sign_text'] = q
        rl = self.Rplane(896, 709, b0, snrm)
        self.anchor_quads['sign_rule'] = [rl, rl + sd * best[1] * 23 / 92, rl + sd * best[1] * 23 / 92 - Vector((0, 0, 0.004)),
                                          rl - Vector((0, 0, 0.004))]

        # globe lamps (ref (975,559) d~35 and (854,630) d~30)
        s = ref_frame()[2]
        for i, (rx, ry, dpx, depth) in enumerate([(975, 559, 35, 6.6), (854, 630, 30, 5.2)]):
            c = self.R(rx, ry, depth)
            rr = 0.5 * dpx * s * self.home.k * depth
            L.cylinder(f'globe_stand_{i}', rr * 1.4, max(0.02, c.z - rr), (c.x, c.y, 0), M['planter'], col, n=32,
                       bevel=0.01)
            self.glow(L.uv_sphere(f'globe_{i}', rr, (c.x, c.y, c.z), M['globe'], col))
            self.glow(L.point_light(f'globe_light_{i}', (c.x, c.y, c.z), rr * 0.9, (4.0 + 2 * i), K(2300),
                                    self.col_light))

        # right lounge: bouclé modular sofa with round bolsters (ref x 830..993, y 470..560) + palms
        sp = self.R(905, 555, 9.4)
        sx, sy = sp.x - 0.35, sp.y + 0.2
        for i, (dx, dy, w, d) in enumerate([(0.0, 0.0, 0.95, 0.9), (0.95, 0.0, 0.95, 0.9), (1.9, -0.3, 0.9, 1.5)]):
            L.box(f'sofa_seat_{i}', (w, d, 0.34), (sx + dx, sy + dy, 0.17), mat=M['sofa'], col=col, bevel=0.1, seg=5)
            L.box(f'sofa_back_{i}', (w, 0.26, 0.22), (sx + dx, sy + dy + d / 2 - 0.13, 0.44), mat=M['sofa'], col=col,
                  bevel=0.1, seg=5)
        # plump round cushions along the back (ref shows a row of rounded cushions)
        for i, (dx, dy) in enumerate([(-0.3, 0.22), (0.1, 0.25), (0.55, 0.22), (1.0, 0.25), (1.45, 0.2)]):
            # plump bouclé back cushions (rounded boxes, slightly tilted back)
            cu = L.box(f'sofa_cushion_{i}', (0.44, 0.2, 0.36), (sx + dx, sy + dy, 0.5), mat=M['sofa'], col=col,
                       bevel=0.09, seg=5)
            cu.rotation_euler = (math.radians(-12), 0, cu.rotation_euler[2])
        self.sofa_c = Vector((sx + 0.6, sy, 0.4))
        for i, (rx, ry, depth, hgt) in enumerate([(868, 470, 10.8, 0.75), (968, 462, 10.4, 0.95)]):
            base = self.R(rx, ry, depth)
            L.cylinder(f'palm_pot_{i}', 0.24, 0.45, (base.x, base.y, 0), M['planter'], col, n=40, bevel=0.03)
            L.plant_broadleaf(f'palm_{i}', (base.x, base.y, 0.43), hgt, rng, M['leaf'], M['stem'], col,
                              n_leaves=160, leaf_len=(0.15, 0.24), leaf_w=(0.10, 0.15), stems=6, lean=(0.15, 0.4))
        self.plants_r = [self.R(868, 430, 10.8), self.R(968, 420, 10.4)]

        # curved cream banquette in front of the glazing, beyond the portal, facing the view (left extension, L3)
        for i, (bx, by, rot) in enumerate([(-4.3, 10.75, 24.0), (-2.95, 11.3, 15.0), (-1.55, 11.65, 9.0)]):
            L.box(f'banquette_seat_{i}', (1.42, 0.8, 0.4), (bx, by, 0.2), rot_z=math.radians(rot), mat=M['sofa'],
                  col=col, bevel=0.12, seg=5)
            ob = L.box(f'banquette_back_{i}', (1.42, 0.24, 0.34), (bx, by, 0.52), rot_z=math.radians(rot),
                       mat=M['sofa'], col=col, bevel=0.1, seg=5)
            # back cushion sits on the camera side of the seat
            d = Vector((math.sin(math.radians(rot)), -math.cos(math.radians(rot)), 0))
            ob.location += d * 0.28
        self.glow(L.box('banquette_led', (4.4, 0.02, 0.01), (-2.9, 10.72, 0.006), rot_z=math.radians(15),
                        mat=M['strip'], col=col))
        bp2 = Vector((-5.4, 10.2, 0))
        L.cylinder('palm_pot_l', 0.3, 0.55, bp2, M['planter'], col, n=48, bevel=0.03)
        L.plant_broadleaf('palm_l', (bp2.x, bp2.y, 0.53), 1.35, rng, M['leaf'], M['stem'], col, n_leaves=170,
                          leaf_len=(0.16, 0.26), leaf_w=(0.10, 0.15), stems=6, lean=(0.15, 0.4))

        # left-extension set dressing (only visible on wide screens): big rubber plant + planter
        bp = Vector((-1.9, 6.2, 0))
        L.cylinder('big_planter', 0.38, 0.55, bp, M['planter'], col, n=64, bevel=0.03)
        L.plant_broadleaf('plant_big', (bp.x, bp.y, 0.52), 1.5, random.Random(SEED + 7), M['leaf'], M['stem'], col,
                          n_leaves=210, leaf_len=(0.18, 0.28), leaf_w=(0.10, 0.15), stems=7, lean=(0.12, 0.4))
        # consume the shared RNG exactly as the earlier (sparser) plant did, so the city layout downstream is unchanged
        tmp = L.plant_broadleaf('tmp_rng', (0, 0, -50), 1.5, rng, M['leaf'], M['stem'], col, n_leaves=90,
                                leaf_len=(0.2, 0.32), leaf_w=(0.09, 0.14), stems=4)
        for ob in [o for o in bpy.data.objects if o.name.startswith('tmp_rng')]:
            bpy.data.objects.remove(ob, do_unlink=True)
        L.box('bench_left', (1.8, 0.5, 0.38), (-3.6, 4.2, 0.19), rot_z=math.radians(-20), mat=M['sofa'], col=col,
              bevel=0.09, seg=4)

    def fluted(self, ob):
        """Give the fluted planter vertical flutes with a wave bump."""
        m, nb, out = L.new_material('fluted_planter')
        tc = nb.node('ShaderNodeTexCoord')
        sep = nb.node('ShaderNodeSeparateXYZ')
        nb.link(tc.outputs['Object'], sep.inputs['Vector'])
        at = nb.node('ShaderNodeMath')
        at.operation = 'ARCTAN2'
        nb.link(sep.outputs['Y'], at.inputs[0])
        nb.link(sep.outputs['X'], at.inputs[1])
        mul = nb.node('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = 24.0
        nb.link(at.outputs['Value'], mul.inputs[0])
        sn = nb.node('ShaderNodeMath')
        sn.operation = 'SINE'
        nb.link(mul.outputs['Value'], sn.inputs[0])
        bp = nb.node('ShaderNodeBump')
        bp.inputs['Strength'].default_value = 0.6
        bp.inputs['Distance'].default_value = 0.02
        nb.link(sn.outputs['Value'], bp.inputs['Height'])
        p = nb.node('ShaderNodeBsdfPrincipled')
        p.inputs['Base Color'].default_value = L.hexcol('#B8A296')
        p.inputs['Roughness'].default_value = 0.6
        nb.link(bp.outputs['Normal'], p.inputs['Normal'])
        nb.link(p.outputs['BSDF'], out.inputs['Surface'])
        L.assign(ob, m)

    def build_chair(self, c, yaw):
        """Rounded tub chair: a thick curved back/arm shell + seat cushion."""
        M = self.mats
        col = self.col_room
        R = Matrix.Rotation(yaw, 4, 'Z')
        # shell: extruded thick arc (270 deg) of radius 0.46, thickness 0.17, height 0.7
        n = 40
        r_out, r_in = 0.48, 0.31
        h_back, h_front = 0.74, 0.55
        v, f = [], []
        a0, a1 = math.radians(-45), math.radians(225)     # opening toward -Y (front) after yaw
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            # arms slope down toward the front tips (tub chair)
            k = min(1.0, abs(a - math.pi / 2) / math.radians(135))
            h = h_back - (h_back - h_front) * k ** 1.6
            for rr, zz in ((r_out, 0.0), (r_out, h), (r_in, h), (r_in, 0.0)):
                p = R @ Vector((rr * math.cos(a), rr * math.sin(a), zz))
                v.append(p + c)
        for i in range(n):
            a, b = 4 * i, 4 * (i + 1)
            for k in range(4):
                k2 = (k + 1) % 4
                f.append((a + k, b + k, b + k2, a + k2))
        f.append((0, 1, 2, 3))
        f.append((4 * n + 3, 4 * n + 2, 4 * n + 1, 4 * n))
        # flip rotation: arc from -45 to 225 means opening centred at -90 (front, -Y)
        shell = L.mesh_from_pydata('chair_shell', v, f, M['chair'], col)
        md = shell.modifiers.new('sub', 'SUBSURF')
        md.levels = 2
        md.render_levels = 2
        L.shade_smooth(shell)
        seat = L.cylinder('chair_seat', 0.35, 0.2, (c.x, c.y, 0.22), M['chair'], col, n=48, bevel=0.07)
        L.cylinder('chair_plinth', 0.45, 0.22, (c.x, c.y, 0.0), M['chair'], col, n=48, bevel=0.05)
        self.chair_c = c
        # soft oval rug under the chair (grounds the empty chair in the open floor)
        rug = L.cylinder('rug', 1.0, 0.012, (c.x - 0.2, c.y - 0.05, 0.0), M['rug'], col, n=96, bevel=0.005)
        rug.scale = (1.2, 0.95, 1.0)

    # -- city
    def build_city(self, extra_hero=()):
        M = self.mats
        alt = P['city_alt']
        # hero towers from ref1: tops at (232,347) and (410,355) -> ~4.8 deg / 10.5 deg right of the axis
        # slender towers (ref left pane x 195..290 tops y 330..420; right pane tower ~(410,355))
        hero = [(1100, 4.8, 18, 18, alt + 25), (900, 10.5, 20, 20, alt + 17), (1500, 1.5, 26, 24, alt + 30),
                (1300, -6.0, 22, 22, alt + 28), (800, -14.0, 24, 24, alt + 20), (1700, 15.5, 30, 28, alt + 34),
                (2200, -22.0, 40, 36, alt + 45), (1000, 18.5, 20, 20, alt + 12),
                (1250, 6.6, 14, 14, alt + 18), (1400, 3.2, 16, 16, alt + 14), (950, 8.2, 18, 18, alt + 8),
                (1600, 12.4, 18, 18, alt + 22), (1200, 16.5, 22, 22, alt + 10), (2000, 2.6, 28, 26, alt + 40)]
        hero += list(extra_hero)
        L.build_city(self.col_city, self.rng, (0, 0), (0, 1), 1.0 - alt, M['facade'], M['city_ground'], M['red'],
                     n=1400, r_min=650, r_max=5000, fov_deg=100, hero=hero, h_median=34.0, h_sigma=0.6,
                     h_max=alt + 20)

    # -- lights
    def build_lights(self):
        cl = self.col_light
        # warm soft key from front-right/above onto the chair + table zone
        key = L.area_light('key', (2.6, -0.2, 2.6), (0, 0, 0), 1.6, 85.0, K(3200), cl, size_y=1.2, spread=50)
        L.aim(key, (P['chair'][0], P['chair'][1], 0.55))
        fill = L.area_light('fill', (-1.6, -0.8, 1.6), (0, 0, 0), 2.0, 22.0, K(3000), cl, spread=70)
        L.aim(fill, (P['chair'][0] - 0.3, P['chair'][1], 0.8))
        # soft bounce lifting the island underside and upper walls (stands in for GI from the warm floor)
        # soft omni bounce under the island (a point light: no hemisphere terminator line on the pillar/walls)
        L.point_light('ceiling_bounce', (3.4, 8.8, 2.4), 1.0, 120.0, K(2900), cl)
        # warm front light on the right-hand plants (ref leaves are lit warm, not silhouettes)
        pm = (self.plants_r[0] + self.plants_r[1]) / 2
        pl_ = L.area_light('plants_fill', tuple(pm + Vector((-1.8, -2.5, 0.9))), (0, 0, 0), 1.2, 150.0, K(2700), cl, spread=24)
        L.aim(pl_, tuple(pm + Vector((0, 0, 0.45))))
        # up-light between the partition and the glazing (curtain-pocket cove) + forward fill on the window head
        wu = L.area_light('pocket_uplight', (-1.5, 11.8, 2.95), (0, 0, 0), 7.0, 50.0, K(2700), cl, size_y=1.0)
        wu.rotation_euler = (math.radians(180), 0, 0)
        wf = L.area_light('head_fill', (0.8, 6.5, 2.4), (0, 0, 0), 4.0, 25.0, K(2900), cl, size_y=0.6)
        L.aim(wf, (0.8, 13.2, 3.1))
        # wash on the right wall around the niche
        ww = L.area_light('wall_wash', (3.2, 8.5, 2.6), (0, 0, 0), 1.5, 14.0, K(3000), cl)
        L.aim(ww, (5.6, 11.8, 1.6))
        o = self.niche['origin']
        nf = L.area_light('niche_fill', tuple(o + self.wall_n * 2.2 + Vector((0, 0, 0.4))), (0, 0, 0), 2.0, 20.0,
                          K(3100), cl, size_y=1.5)
        L.aim(nf, tuple(o))

        # fill lights stand in for bounce light: keep them out of reflections (glass, floor, acrylic)
        for ob in cl.objects:
            if ob.type == 'LIGHT':
                ob.visible_camera = False          # lamps are never seen directly (emissive meshes show the fixtures)
                if ob.data.type == 'AREA':
                    ob.visible_glossy = False
                    ob.visible_transmission = False

    # -- anchors
    def export_anchors(self, cam, W, H, path, cam_name):
        def proj(p):
            bpy.context.view_layer.update()
            from bpy_extras.object_utils import world_to_camera_view
            co = world_to_camera_view(self.scn, cam.ob, Vector(p))
            return [round(co.x, 5), round(1.0 - co.y, 5)], co.z

        out = {'room': 'lounge', 'camera': cam_name, 'plate': {'w': W, 'h': H},
               'coords': 'normalised plate coordinates, origin top-left, x right, y down',
               'surfaces': {}, 'ellipses': {}, 'character': {}, 'layers': {}}
        f_mm, S = cam.cd.lens, cam.cd.sensor_width
        fstop = cam.cd.dof.aperture_fstop if cam.cd.dof.use_dof else 0
        focus = cam.cd.dof.focus_distance

        def coc_px(depth):
            if not fstop:
                return 0.0
            f = f_mm / 1000.0
            c = abs(f * f * (depth - focus) / (fstop * depth * (focus - f)))   # metres on sensor
            return c / (S / 1000.0) * max(W, H)

        for name, quad in self.anchor_quads.items():
            pts = []
            ds = []
            for p in quad:
                xy, d = proj(p)
                pts.append(xy)
                ds.append(d)
            dm = sum(ds) / len(ds)
            out['surfaces'][name] = {'quad': pts, 'order': 'TL,TR,BR,BL', 'depthM': round(dm, 3),
                                     'cocPx': round(coc_px(dm), 2)}
        # character slot: a person seated in the tub chair (the SVG character is an overlay; nothing is rendered)
        c = self.chair_c
        yaw = math.radians(P['chair'][2])
        fwd = Vector((math.cos(yaw - math.pi / 2), math.sin(yaw - math.pi / 2), 0))   # direction a sitter faces
        side = Vector((-fwd.y, fwd.x, 0))
        seat = Vector((c.x, c.y, 0.44))
        head = c + fwd * 0.02 + Vector((0, 0, 1.18))
        body = [c + fwd * f + side * sd + Vector((0, 0, z)) for f, sd, z in
                [(0.0, -0.24, 1.0), (0.0, 0.24, 1.0), (0.02, 0.0, 1.30), (0.55, -0.18, 0.5), (0.55, 0.18, 0.5),
                 (0.62, -0.12, 0.0), (0.62, 0.12, 0.0), (0.1, -0.3, 0.55), (0.1, 0.3, 0.55)]]
        xy_s, d_s = proj(seat)
        xy_h, d_h = proj(head)
        bx = [proj(p)[0] for p in body]
        a, _ = proj(seat)
        b, _ = proj(seat + side * 0.5)
        out['character'] = {
            'note': 'slot for a person seated in the armchair; the plate renders the chair empty',
            'seatAnchor': xy_s, 'headTarget': xy_h, 'depthM': round(d_s, 3),
            'bbox': [round(min(p[0] for p in bx), 5), round(min(p[1] for p in bx), 5),
                     round(max(p[0] for p in bx), 5), round(max(p[1] for p in bx), 5)],
            'bboxOrder': 'x0,y0,x1,y1',
            'pxPerMetre': round(math.hypot(b[0] - a[0], b[1] - a[1]) * W / 0.5, 1),
            'cocPx': round(coc_px(d_s), 2)}
        # ellipses: marble table top and the two globe lamps (for glow/hover effects)
        def ell(cen, r, n=48):
            pts = [proj(cen + Vector((r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), 0)))[0]
                   for i in range(n)]
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            return {'cx': round((min(xs) + max(xs)) / 2, 5), 'cy': round((min(ys) + max(ys)) / 2, 5),
                    'rx': round((max(xs) - min(xs)) / 2, 5), 'ry': round((max(ys) - min(ys)) / 2, 5)}
        out['ellipses']['table_top'] = ell(Vector((self.table_c.x, self.table_c.y, 0.42)), 0.34)
        out['layers'] = {'plate': {'depthM': 'mixed'},
                         'fg': {'depthM': round(proj(self.table_c + Vector((0, 0, 0.5)))[1], 3),
                                'note': 'marble table + acrylic sign, drawn over the character'}}
        if cam_name == 'home_mobile':
            out['note'] = 'L2 phone-portrait Home plate; no reference frame exists (composition is new)'
            with open(path, 'w') as fh:
                json.dump(out, fh, indent=1)
            return out
        x0, y0, s, wf, hf = ref_frame(W, H)
        out['refFrame'] = {'x': round(x0 / W, 5), 'y': round(y0 / H, 5), 'w': round(wf / W, 5), 'h': round(hf / H, 5),
                           'refPx': [P['ref_w'], P['ref_h']],
                           'note': 'ref1 Home panel (x0..993, y0..1023 of ref1.png) inside this plate; '
                                   'the rest is safe margin/extension for other aspect ratios'}
        with open(path, 'w') as fh:
            json.dump(out, fh, indent=1)
        return out


def configure_render(sc, camname, tier, W, H, spp, out_dir):
    scn = sc.scn
    scn.camera = bpy.data.objects[camname]
    if tier == 'blockout':
        scn.render.engine = 'BLENDER_WORKBENCH'
        scn.display.shading.light = 'STUDIO'
        scn.display.shading.color_type = 'MATERIAL'
        scn.render.resolution_x, scn.render.resolution_y = W, H
        scn.render.image_settings.file_format = 'PNG'
        scn.render.filepath = os.path.join(out_dir, f'{camname}_blockout.png')
        return
    thr = L.TIERS[tier]['thr']
    L.setup_cycles(scn, W, H, spp, thr, seed=7)
    # light group 'glow' for LEDs, coves, lamps
    vl = scn.view_layers[0]
    vl.lightgroups.add(name='glow')
    for ob in sc.glow_objs:
        ob.lightgroup = 'glow'
    L.setup_passes_and_compositor(scn, out_dir, f'{camname}_{tier}', fg_names=getattr(sc, 'fg_names', ()),
                                  glow_group='glow', mist=(0.5, 30.0))
    scn.render.image_settings.file_format = 'PNG'
    scn.render.image_settings.color_depth = '8'
    scn.render.filepath = os.path.join(out_dir, f'{camname}_{tier}_agx.png')


def build_all():
    sc = Scene()
    sc.build_materials()
    sc.build_world()
    cam = sc.build_home_camera()
    sc.build_architecture()
    sc.build_props()
    sc.build_city()
    sc.build_lights()
    return sc


# ----------------------------------------------------------------------------- L3 sidebar strip (ref2 sidebar)
# A dedicated corner of the same lounge (same materials, dusk sky and city), built on its own so the tall
# strip can be composed like ref2's sidebar: a big rose plaster column on a stepped, LED-lit plinth fills the
# left ~70 %, a floating ceiling disc with an indirect cove sweeps across the top, the dusk window + skyline,
# a tall plant and cream seating sit to the right, glossy floor below. Values are in ref2-sidebar px
# (320 x 1024, origin top-left) projected through the strip camera, so the 2D layout follows the reference.
STRIP = dict(
    cam=(-0.3, 6.7, 1.35), yaw=2.0, lens=30.0, shift_y=-0.09,
    glass_y=13.1, ceil=3.5, disc_z=3.05, disc_t=0.15,
    # ref2 sidebar landmarks (px): the bright cove arc at the near disc edge, the column's right silhouette
    arc=[(149, 0), (173, 12), (222, 27), (271, 49), (296, 73)], column_edge_x=223,
    mullion_x=278,
    sky_gain=2.8,        # the strip's window is small and seen through dark CSS glass: brighter dusk than the Home plate
    led_gain=3.0,        # plinth/banquette LED tapes relative to the lounge's 'strip' emitter
)


def build_strip_scene():
    import numpy as np
    S = STRIP
    P['sky_gain'] = S['sky_gain']
    sc = Scene()
    sc.build_materials()
    sc.build_world()
    M = sc.mats
    col = sc.col_room
    W, H = CAMERAS['sidebar_window'][2]
    cam = L.Cam('cam_sidebar_window', S['cam'], S['yaw'], S['lens'], W, H, shift_y=S['shift_y'], col=sc.col_cam)
    sc.strip_cam = cam
    k = W / 320.0

    def on_z(u, v, z):
        return cam.on_plane_z(u * k, v * k, z)

    ch = S['ceil']
    gy = S['glass_y']
    dz = S['disc_z']
    # --- floating ceiling disc: fit a circle (least squares) to the ref cove arc on the plane z = disc_z
    P2 = np.array([[on_z(u, v, dz).x, on_z(u, v, dz).y] for u, v in S['arc']])
    A = np.c_[2 * P2, np.ones(len(P2))]
    cx, cy, c0 = np.linalg.lstsq(A, (P2 ** 2).sum(1), rcond=None)[0]
    Rd = math.sqrt(c0 + cx * cx + cy * cy)
    C = Vector((cx, cy, 0.0))
    # column concentric with the disc, radius set by the ref silhouette (x=223): distance from C to that ray
    d = cam.ray(S['column_edge_x'] * k, 500 * k)
    d2 = Vector((d.x, d.y, 0)).normalized()
    rel = C - Vector((cam.loc.x, cam.loc.y, 0))
    Rc = abs(rel.x * d2.y - rel.y * d2.x)
    sc.strip_geo = dict(C=(round(cx, 3), round(cy, 3)), Rd=round(Rd, 3), Rc=round(Rc, 3))
    print('[strip] disc centre', sc.strip_geo)

    # materials specific to the strip
    M['column_rose'] = L.plaster_material('column_rose', L.hexcol('#B98B88'), rough=0.9, var=0.03, scale=0.8)
    M['floor_l3'] = L.stone_floor_material('floor_l3', L.hexcol('#A27C6E'), tile=1.2, rough=0.10)
    M['led_l3'] = L.emission_mat('led_strip_l3', K(2400), 25.0 * P['emit_gain'] * S['led_gain'], indirect=0.6)
    M['disc_under'] = L.plaster_material('disc_under', L.hexcol('#E2C4B8'), rough=0.9, var=0.02, scale=1.5)
    M['cream'] = L.boucle_material('cream_boucle', L.hexcol('#B49C94'), scale=120, strength=0.5)

    # --- shell: floor, ceiling, glazing
    L.mesh_from_pydata('l3_floor', [(-12, -4, 0), (12, -4, 0), (12, gy, 0), (-12, gy, 0)], [(0, 1, 2, 3)],
                       M['floor_l3'], col)
    L.mesh_from_pydata('l3_ceiling', [(-12, -4, ch), (-12, gy, ch), (12, gy, ch), (12, -4, ch)], [(0, 1, 2, 3)],
                       M['ceiling'], col)
    glass = L.mesh_from_pydata('l3_glass', [(-12, gy, 0), (12, gy, 0), (12, gy, ch), (-12, gy, ch)], [(0, 1, 2, 3)],
                               M['glass'], col)
    glass.visible_shadow = False
    mx = cam.on_plane(S['mullion_x'] * k, 300 * k, (0, gy, 0), (0, 1, 0)).x
    for i in range(-5, 5):
        L.box(f'l3_mullion_{i}', (0.07, 0.07, ch), (mx + 1.8 * i, gy - 0.02, ch / 2), mat=M['bronze'], col=col)
    L.box('l3_head', (24, 0.12, 0.08), (0, gy - 0.04, ch - 0.04), mat=M['bronze'], col=col)
    L.box('l3_sill', (24, 0.16, 0.05), (0, gy - 0.06, 0.025), mat=M['bronze'], col=col)

    # --- floating D-shaped soffit (underside at dz): the fitted circle's near arc, cut by a straight back edge
    # that projects at ref y ~80 (the lobe between the arc and that edge is the lit underside with downlights);
    # an indirect cove on its top washes the ceiling, which shows as the bright band between it and the window
    n = 144
    ring = [(cx + Rd * math.cos(2 * math.pi * i / n), cy + Rd * math.sin(2 * math.pi * i / n)) for i in range(n)]
    clip_y = on_z(260, 80, dz).y
    disc = [(x, min(y, clip_y)) for x, y in ring]
    L.prism('l3_disc', disc, dz, dz + S['disc_t'], M['disc_under'], col)
    arc = [(x, y) for x, y in ring if y < clip_y - 0.01]
    arc.sort(key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
    xs = [x for x, y in disc if abs(y - clip_y) < 1e-6]
    cove = [(x, y, dz + S['disc_t'] + 0.02) for x, y in arc]
    sc.glow(L.tube('l3_disc_cove', cove, 0.02, M['cove'], col))
    if xs:
        sc.glow(L.tube('l3_disc_cove_back', [(min(xs) + 0.05, clip_y - 0.03, dz + S['disc_t'] + 0.02),
                                            (max(xs) - 0.05, clip_y - 0.03, dz + S['disc_t'] + 0.02)], 0.02,
                       M['cove'], col))
    # the disc's rim is a backlit diffuser band: the broad bright arc of ref2 (not just a thin line)
    rim = [(x + (x - cx) / Rd * 0.004, y + (y - cy) / Rd * 0.004, dz) for x, y in arc]
    M['rim_l3'] = L.emission_mat('led_rim_l3', L.kelvin(2600), 14.0 * P['emit_gain'], indirect=0.5)
    sc.glow(L.ribbon('l3_disc_rim', rim, (0, 0, S['disc_t']), M['rim_l3'], col))
    # downlights in the underside (ref dots around (232,54), (259,70))
    for i, (u, v) in enumerate([(236, 56), (268, 70)]):
        p = on_z(u, v, dz - 0.002)
        if (Vector((p.x, p.y, 0)) - C).length < Rd - 0.08 and p.y < clip_y - 0.08:
            L.cylinder(f'l3_downlight_{i}', 0.028, 0.005, (p.x, p.y, dz - 0.004), M['downlight'], col, n=24)

    # --- column (floor to ceiling, concentric with the fitted arc) + low stepped plinth with LED lips
    L.cylinder('l3_column', Rc, ch, (cx, cy, 0.0), M['column_rose'], col, n=160)
    steps = [(Rc + 0.80, 0.0, 0.08), (Rc + 0.50, 0.08, 0.22)]
    for i, (r, z0, z1) in enumerate(steps):
        L.cylinder(f'l3_step_{i}', r, z1 - z0, (cx, cy, z0), M['planter'], col, n=160, bevel=0.012)
        sc.glow(L.tube(f'l3_step_led_{i}', [(cx + (r + 0.012) * math.cos(2 * math.pi * j / 160),
                                             cy + (r + 0.012) * math.sin(2 * math.pi * j / 160), z1 - 0.02)
                                            for j in range(160)], 0.016, M['led_l3'], col, closed=True))
    # small leafy plant in a white pot on the upper step, front-right of the column (ref pot ~(182, 675))
    pp = on_z(182, 680, 0.22)
    rp = Vector((pp.x, pp.y, 0)) - C
    rp = rp.normalized() * min(max(rp.length, Rc + 0.30), Rc + 0.34)
    pp = C + rp
    L.cylinder('l3_pot_small', 0.14, 0.24, (pp.x, pp.y, 0.22), M['planter'], col, n=40, bevel=0.02)
    L.plant_broadleaf('l3_plant_small', (pp.x, pp.y, 0.45), 0.42, sc.rng, M['leaf'], M['stem'], col,
                      n_leaves=110, leaf_len=(0.08, 0.13), leaf_w=(0.055, 0.085), stems=6, lean=(0.25, 0.55))

    # --- window banquette (cream cushions) + tall plant on it + two glowing globe lamps
    bx0 = cx + 0.1
    L.box('l3_banq_base', (6.0, 0.62, 0.40), (bx0 + 3.0, gy - 0.36, 0.20), mat=M['planter'], col=col)
    L.box('l3_banq_seat', (6.0, 0.60, 0.14), (bx0 + 3.0, gy - 0.37, 0.47), mat=M['cream'], col=col, bevel=0.05)
    for i in range(4):
        L.box(f'l3_banq_back_{i}', (0.72, 0.18, 0.5), (bx0 + 0.9 + 0.78 * i, gy - 0.16, 0.78), mat=M['cream'],
              col=col, bevel=0.07, seg=4)
    sc.glow(L.box('l3_banq_led', (6.0, 0.02, 0.01), (bx0 + 3.0, gy - 0.68, 0.012), mat=M['led_l3'], col=col))
    tp = on_z(246, 530, 0.54)
    L.cylinder('l3_pot_tall', 0.2, 0.36, (tp.x, tp.y, 0.54), M['planter'], col, n=48, bevel=0.03)
    L.plant_broadleaf('l3_plant_tall', (tp.x, tp.y, 0.88), 1.55, sc.rng, M['leaf'], M['stem'], col, n_leaves=170,
                      leaf_len=(0.16, 0.26), leaf_w=(0.10, 0.16), stems=5, lean=(0.12, 0.35))
    for i, (u, v) in enumerate([(305, 462)]):
        g = on_z(u, v, 0.62)
        sc.glow(L.uv_sphere(f'l3_globe_{i}', 0.07, (g.x, g.y, g.z + 0.07), M['globe'], col))

    # --- cream lounge sofa in front of the banquette (ref x 225..315, y 560..690) and a near armchair (right edge)
    so = on_z(270, 690, 0.0)
    for i, (dx, dy) in enumerate([(0.0, 0.0), (0.95, 0.12)]):
        L.box(f'l3_sofa_seat_{i}', (0.95, 0.9, 0.40), (so.x + dx, so.y + 0.45 + dy, 0.21), rot_z=math.radians(-8),
              mat=M['cream'], col=col, bevel=0.12, seg=5)
        L.box(f'l3_sofa_back_{i}', (0.95, 0.26, 0.40), (so.x + dx + 0.04, so.y + 0.82 + dy, 0.58),
              rot_z=math.radians(-8), mat=M['cream'], col=col, bevel=0.11, seg=5)
    near = on_z(318, 1000, 0.0)
    ob = L.cylinder('l3_near_chair', 0.46, 0.9, (near.x + 0.5, near.y + 0.35, 0.0), M['cream'], col, n=64,
                    bevel=0.12)
    L.shade_smooth(ob)

    # ref2's window shows a few tall towers rising well above the skyline on the right of the strip
    sc.build_city(extra_hero=[(700, 6.8, 24, 22, 135), (860, 8.4, 18, 18, 118), (640, 4.2, 20, 20, 96),
                              (760, 9.6, 26, 24, 104), (900, 5.6, 16, 16, 150)])
    # lighter, lilac-to-peach dusk in the strip's window (ref2), same ramp structure as the lounge sky
    ramp = [n for n in sc.scn.world.node_tree.nodes if n.type == 'VALTORGB'][0].color_ramp
    stops = [(-0.08, '#2A1A26'), (-0.002, '#F07040'), (0.03, '#EC8A62'), (0.07, '#E08A80'), (0.11, '#C8889A'),
             (0.15, '#A888AE'), (0.19, '#9090BC'), (0.24, '#8290C4'), (0.32, '#6E80BC'), (0.5, '#4A5C98')]
    for e, (z, hx) in zip(ramp.elements, stops):
        e.position = (z + 0.1) / 0.6
        e.color = L.hexcol(hx)

    # --- lights (fills stand in for bounce; never seen directly or in reflections)
    cl = sc.col_light
    fill = L.area_light('l3_fill_right', (cam.loc.x + 1.6, cam.loc.y + 1.0, 2.6), (0, 0, 0), 1.5, 75.0, K(3000), cl,
                        spread=60)
    L.aim(fill, (cx + 0.3, cy - Rc, 1.4))
    floor_fill = L.area_light('l3_floor_fill', (cx + 0.6, cy - Rc - 1.2, 2.9), (0, 0, 0), 2.5, 110.0, K(3200), cl,
                              size_y=1.5)
    L.aim(floor_fill, (cx + 0.6, cy - Rc - 1.5, 0.0))
    up = L.area_light('l3_disc_wash', (cx, cy, dz + S['disc_t'] + 0.05), (0, 0, 0), Rd * 1.6, 420.0, K(2600), cl,
                      shape='DISK')
    up.rotation_euler = (math.radians(180), 0, 0)
    sc.glow(up)
    # wash on the ceiling between the soffit's back edge and the window head (ref: bright band above the glass)
    bw = L.area_light('l3_band_wash', (cx + 0.9, clip_y + 0.1, dz + S['disc_t'] + 0.05), (0, 0, 0), 2.4, 420.0,
                      K(2800), cl, size_y=0.3)
    L.aim(bw, (cx + 0.9, gy - 0.2, ch))
    sc.glow(bw)
    for ob in cl.objects:
        if ob.type == 'LIGHT':
            ob.visible_camera = False
            if ob.data.type == 'AREA':
                ob.visible_glossy = False
                ob.visible_transmission = False
    return sc, cam


# ----------------------------------------------------------------------------- living-room masks
# `--passes masks` (see mask_passes.py): which objects are plants, lamps, LED strips, glass and city.
LAMP_KINDS = [  # (object-name regex, kind, suggested motion, colour temperature K)
    (r'^candle_globe$', 'candle', 'flicker', 2300),
    (r'^(l3_)?globe_\d+$', 'globe', 'breathe', 2500),
    (r'^(l3_)?downlight_\d+$', 'downlight', 'steady', 3000),
    (r'^city_red\d+$', 'beacon', 'blink', None),
]
STRIP_KINDS = [  # (object-name regex, kind, group)
    (r'^cove_(led|wash)$', 'cove', 'island_cove'), (r'^portal_led$', 'cove', 'portal'),
    (r'^niche_led$', 'outline', 'niche'), (r'^niche_backlight$', 'panel', 'niche'),
    (r'^fluted_rim_led$', 'ring', 'fluted_planter'), (r'^low_planter_led$', 'edge', 'low_planter'),
    (r'^(ottoman|banquette)_led$', 'floor', None), (r'^sign_(edge|led)$', 'edge', 'sign'),
    (r'^l3_disc_(cove|cove_back|rim)$', 'cove', 'soffit'), (r'^l3_step_led_\d+$', 'plinth', 'plinth'),
    (r'^l3_banq_led$', 'floor', None),
]


def mask_spec(sc):
    """Object classification for mask_passes.render_masks (lounge scenes: home, home_mobile, sidebar_window)."""
    import re
    obs = sorted(bpy.data.objects, key=lambda o: o.name)
    leaf = sc.mats['leaf'].name
    plants = []
    for o in obs:
        if o.type != 'MESH' or not any(s.material and s.material.name == leaf for s in o.material_slots):
            continue
        if o.location.z < -10:          # 'tmp_rng' (built far below the floor only to advance the RNG)
            continue
        stems = [s.name for s in obs if re.match(rf'^{re.escape(o.name)}_(stem|trunk)\d+$', s.name)]
        kind = 'shrub' if o.name.startswith('shrub_') else 'plant'
        plants.append(dict(name=o.name, kind=kind, objects=[o.name] + stems, leaf_objects=[o.name],
                           base=tuple(o.location)))
    lamps = []
    for rx, kind, motion, temp in LAMP_KINDS:
        for o in obs:
            if o.type == 'MESH' and re.match(rx, o.name):
                lamps.append(dict(name=o.name, object=o.name, kind=kind, motion=motion, tempK=temp))
    lamp_names = {d['object'] for d in lamps}
    strips = []
    seen = set()
    for ob in sc.glow_objs:
        if ob.name in seen or ob.name in lamp_names or ob.type not in ('MESH', 'CURVE') or not ob.visible_camera:
            continue
        seen.add(ob.name)
        kind, group = 'strip', ob.name
        for rx, k, g in STRIP_KINDS:
            if re.match(rx, ob.name):
                kind, group = k, (g or ob.name)
                break
        strips.append(dict(name=ob.name, object=ob.name, kind=kind, group=group))
    return dict(plants=plants, lamps=lamps, strips=strips,
                glass_mats=[sc.mats['glass'].name], pass_mats=[sc.mats['acrylic'].name],
                facade_mats={sc.mats['facade'].name: dict(hash_channel='Red', haze=True)},
                city_collections=['city'])


CAMERAS = {
    # name: (object name, default preview res, default final res)
    'home': ('cam_home', (960, 540), (2560, 1440)),                  # L1 desktop Home plate (16:9, ref frame + margin)
    'home_mobile': ('cam_home_mobile', (360, 780), (1080, 2340)),     # L2 phone portrait Home plate (9:19.5)
    'sidebar_window': ('cam_sidebar_window', (320, 1024), (640, 2048)),  # L3 sidebar strip (ref2 sidebar)
}


def add_extra_cameras(sc, which):
    """Extra cameras on the same lounge. Only the requested one is built (one render per process)."""
    M = sc.mats
    if which == 'home_mobile':
        # L2: same eye as Home, a little further back; portrait frame holding the window, pillar, niche, chair
        # and the marble table. Horizon ~40 % from the top, like the desktop plate.
        W, H = CAMERAS['home_mobile'][2]
        return L.Cam('cam_home_mobile', (0.5, 0.2, 1.05), -12.0, 28.0, W, H, shift_y=-0.04, col=sc.col_cam)
    return None


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = dict(camera='home', tier='preview', out='.', spp=None, res=None, save_blend=None, no_render=False, passes=None)
    i = 0
    while i < len(argv):
        k = argv[i]
        if k == '--camera':
            a['camera'] = argv[i + 1]; i += 2
        elif k == '--tier':
            a['tier'] = argv[i + 1]; i += 2
        elif k == '--out':
            a['out'] = argv[i + 1]; i += 2
        elif k == '--spp':
            a['spp'] = int(argv[i + 1]); i += 2
        elif k == '--res':
            w, h = argv[i + 1].lower().split('x'); a['res'] = (int(w), int(h)); i += 2
        elif k == '--save-blend':
            a['save_blend'] = argv[i + 1]; i += 2
        elif k == '--no-render':
            a['no_render'] = True; i += 1
        elif k == '--passes':
            a['passes'] = argv[i + 1]; i += 2
        else:
            i += 1
    return a


def main():
    import time
    a = parse_args()
    os.makedirs(a['out'], exist_ok=True)
    t0 = time.time()
    camname, res_prev, res_final = CAMERAS[a['camera']]
    if a['camera'] == 'sidebar_window':
        sc, cam = build_strip_scene()
    else:
        sc = build_all()
        cam = sc.home if a['camera'] == 'home' else add_extra_cameras(sc, a['camera'])
    focus = {'home': P['focus'], 'home_mobile': 3.9, 'sidebar_window': 4.2}[a['camera']]
    L.set_dof(cam, focus, cam.cd.lens / P['aperture_mm'])
    if a['passes'] == 'masks':
        # living-room masks (mask_passes.py): same scene, camera and DOF, at the published plate's full size
        import mask_passes as MP
        W, H = a['res'] or res_final
        MP.render_masks(sc.scn, cam.ob, W, H, a['spp'] or 64, a['out'], a['camera'], mask_spec(sc),
                        mist=(0.5, 30.0))
        if a['save_blend']:
            bpy.ops.wm.save_as_mainfile(filepath=a['save_blend'])
        if not a['no_render']:
            MP.run(a['camera'], a['out'])
        return
    tier = a['tier']
    if a['res']:
        W, H = a['res']
    else:
        W, H = res_prev if tier in ('preview', 'blockout') else res_final
    spp = a['spp'] or L.TIERS[tier]['spp']
    configure_render(sc, camname, tier, W, H, spp, a['out'])
    if a['camera'] == 'sidebar_window':
        with open(os.path.join(a['out'], f"sidebar_window_{tier}_anchors.json"), 'w') as fh:
            json.dump({'room': 'lounge', 'camera': 'sidebar_window', 'plate': {'w': W, 'h': H},
                       'note': 'L3 sidebar strip (ref2 sidebar x0..319, y0..1023 at 2x). No overlays; '
                               'the sidebar glass/darkening is CSS.',
                       'refFrame': {'x': 0.0, 'y': 0.0, 'w': 1.0, 'h': 1.0, 'refPx': [320, 1024]},
                       'geometry': sc.strip_geo}, fh, indent=1)
    else:
        sc.export_anchors(cam, W, H, os.path.join(a['out'], f"{a['camera']}_{tier}_anchors.json"), a['camera'])
    meta = dict(blender=bpy.app.version_string, seed=SEED, tier=tier, spp=spp, res=[W, H], camera=a['camera'],
                params=dict(P, strip=STRIP) if a['camera'] == 'sidebar_window' else P, script_sha256=hashlib.sha256(open(__file__, 'rb').read()).hexdigest(),
                lib_sha256=hashlib.sha256(open(L.__file__, 'rb').read()).hexdigest())
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print(f'[lounge] build {time.time() - t0:.1f}s, objects={len(bpy.data.objects)}, faces={tris}')
    if a['save_blend']:
        bpy.ops.wm.save_as_mainfile(filepath=a['save_blend'])
    if a['no_render']:
        return
    t1 = time.time()
    bpy.ops.render.render(write_still=True)
    meta['render_seconds'] = round(time.time() - t1, 1)
    print(f"[lounge] render {meta['render_seconds']}s")
    with open(os.path.join(a['out'], f"{a['camera']}_{tier}_meta.json"), 'w') as fh:
        json.dump(meta, fh, indent=1)


if __name__ == '__main__':
    main()
