"""Evia Products hero backdrop (L5) — lightweight procedural Blender 4.5 scene + render driver.

High-key blush-pink room behind the Products hero (ref3.png x 160..1222, y 0..311): plaster wall with
faint lighter panels on the left, a tall arched glazed door/window with cream mullions on the right,
a warm globe pendant, a large rubber plant and a small leafy plant on a low tan sideboard. Heavy depth of field.
The character (SVG, holding a jar) is composited by the frontend over hero x 480..805 (screen x 640..965):
that area is kept clean. The handwritten quote is HTML (anchor exported).

Run through the lock wrapper (one render per process):
  LOCK=/Users/olaajibade/Documents/Codex/2026-09-16/hi/work/evia-rebuild/tools/blender-render.sh
  $LOCK scripts/blender/room_products_hero.py -- --tier preview --out /path/to/workdir   # 1276x374, 16 spp (~35 s)
  $LOCK scripts/blender/room_products_hero.py -- --tier final --out /path/to/workdir     # 2552x748, 32 spp (~4 min)
The plate is the 2x ref frame (2124x622) centred with a 10 % safe margin on every side (refFrame in anchors).
Then grade/encode with lounge_post.py (look 'hero'). The plate is smooth and high-key, where lossy WebP
bands, so it ships lossless:
  PY=/Applications/Blender.app/Contents/Resources/4.5/python/bin/python3.11
  $PY scripts/blender/lounge_post.py preview <out>/products_hero_preview_0001.exr graded.png --look hero
  $PY scripts/blender/lounge_post.py publish <out>/products_hero_final_0001.exr public/env/products-hero hero \
      --look hero --sizes 2552,1276 --no-layers --lossless
Outputs: <out>/products_hero_<tier>_0001.exr (+ anchors json).
"""
import sys
import os
import math
import json
import random
import hashlib

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lounge_lib as L  # noqa: E402

SEED = 311
W0, H0 = 1062, 311           # reference hero frame (ref3 screen x 160..1222, y 0..311)
P = dict(cam=(0.0, 0.0, 1.5), lens=50.0, wall_y=6.0, focus=2.2, fstop=2.8,
         margin=0.10)         # safe margin around the ref frame (fraction of the frame, every side)
PLATE = (2552, 748)          # final plate: the 2x ref frame (2124x622) centred, plus the margin
FRAME = ((PLATE[0] - 2 * W0) // 2, (PLATE[1] - 2 * H0) // 2)   # top-left of the 2x ref frame inside the plate


def build(tier_w, tier_h):
    rng = random.Random(SEED)
    scn = L.reset_scene()
    col = L.collection('hero')
    cl = L.collection('hero_lights')
    lens = P['lens'] * (2 * W0) / PLATE[0]          # same view of the ref frame, wider plate
    cam = L.Cam('cam_products_hero', P['cam'], 0.0, lens, PLATE[0], PLATE[1], col=col)
    L.set_dof(cam, P['focus'], lens / (P['lens'] / P['fstop']))   # keep the physical aperture (same blur)

    def R(hx, hy, depth):
        return cam.at_depth(FRAME[0] + hx * 2, FRAME[1] + hy * 2, depth)

    wy = P['wall_y']
    # materials
    plaster = L.plaster_material('blush_plaster', L.hexcol('#F2CBC6'), rough=0.9, var=0.03)
    panel = L.plaster_material('panel_plaster', L.hexcol('#F7E0DA'), rough=0.85, var=0.02)
    frame = L.principled('cream_frame', L.hexcol('#F4E6DC'), rough=0.5)
    console = L.principled('console', L.hexcol('#B07252'), rough=0.45, coat=0.2)
    pot = L.plaster_material('pot', L.hexcol('#EADBD0'), rough=0.6, var=0.02)
    leaf = L.leaf_material('leaf_h', L.hexcol('#1E2610'), L.hexcol('#3C4418'), trans=0.12)
    stem = L.principled('stem_h', L.hexcol('#4A3522'), rough=0.7)
    floor = L.principled('floor_h', L.hexcol('#E8CFC4'), rough=0.4)
    globe = L.principled('globe_h', L.hexcol('#FFF6EE'), rough=0.3, emission=L.kelvin(2700), estrength=14.0)
    daylight = L.emission_mat('daylight', L.hexcol('#FFC2B6'), 2.3)

    # back wall with an arched opening on the right
    L.mesh_from_pydata('floor', [(-8, -2, 0), (8, -2, 0), (8, wy + 3, 0), (-8, wy + 3, 0)], [(0, 1, 2, 3)], floor, col)
    x_open0 = R(815, 150, wy).x
    x_open1 = x_open0 + 1.9
    top = 2.7
    rad = (x_open1 - x_open0) / 2
    pieces = [((-8, x_open0), (0, 4)), ((x_open1, 8), (0, 4))]
    for i, ((a, b), (z0, z1)) in enumerate(pieces):
        L.box(f'wall_{i}', (b - a, 0.2, z1 - z0), ((a + b) / 2, wy + 0.1, (z0 + z1) / 2), mat=plaster, col=col)
    # arch head above the opening
    cx = (x_open0 + x_open1) / 2
    zc = top - rad
    verts, faces = [], []
    n = 24
    for k in range(n + 1):
        a = math.pi * k / n
        verts.append((cx + rad * math.cos(a), wy, zc + rad * math.sin(a)))
    verts += [(x_open0, wy, 4.0), (x_open1, wy, 4.0)]
    # build arch head as fan strips to top
    arch = []
    for k in range(n + 1):
        a = math.pi * k / n
        arch.append((cx + rad * math.cos(a), zc + rad * math.sin(a)))
    v2 = []
    f2 = []
    for k in range(n + 1):
        x, z = arch[k]
        v2 += [(x, wy, z), (x, wy, 4.0), (x, wy + 0.2, z), (x, wy + 0.2, 4.0)]
    for k in range(n):
        a, b = 4 * k, 4 * (k + 1)
        f2 += [(a, b, b + 1, a + 1), (a + 2, a + 3, b + 3, b + 2)]
    L.mesh_from_pydata('arch_head', v2, f2, plaster, col)
    # glazing: bright daylight panes behind cream mullions (vertical panels)
    L.mesh_from_pydata('daylight_plane', [(x_open0 - 0.5, wy + 0.6, 0), (x_open1 + 0.5, wy + 0.6, 0),
                                          (x_open1 + 0.5, wy + 0.6, 4.0), (x_open0 - 0.5, wy + 0.6, 4.0)],
                       [(0, 1, 2, 3)], daylight, col)
    for k in range(6):
        x = x_open0 + (x_open1 - x_open0) * k / 5
        L.box(f'mullion_{k}', (0.07, 0.08, top), (x, wy + 0.12, top / 2), mat=frame, col=col)
    L.box('transom', (x_open1 - x_open0, 0.08, 0.06), (cx, wy + 0.12, 2.05), mat=frame, col=col)
    # faint raised panels on the left wall (screen x 480..620 -> hero x 320..460)
    for i, (h0, h1) in enumerate([(318, 386), (398, 462)]):
        a, b = R(h0, 150, wy - 0.02).x, R(h1, 150, wy - 0.02).x
        L.box(f'panel_{i}', (b - a, 0.03, 2.4), ((a + b) / 2, wy - 0.015, 1.5), mat=panel, col=col, bevel=0.01)
    # pendant globe (hotspot at screen (1003,88) -> hero (843,88))
    g = R(843, 88, 5.0)
    L.uv_sphere('pendant', 0.11, g, globe, col)
    L.tube('pendant_cord', [(g.x, g.y, g.z + 0.1), (g.x, g.y, 4.0)], 0.004, stem, col)
    L.point_light('pendant_light', g, 0.1, 25.0, L.kelvin(2700), cl)
    # low sideboard across the bottom right (ref: a warm tan band, hero y ~292..311) + a small leafy plant on it
    c = R(930, 296, 5.3)
    L.box('console', (2.6, 0.42, c.z), (c.x + 0.7, c.y + 0.2, c.z / 2), mat=console, col=col, bevel=0.02)
    f = R(952, 292, 5.3)
    L.cylinder('fern_pot', 0.1, 0.16, (f.x, f.y + 0.1, c.z), pot, col, n=32, bevel=0.01)
    L.plant_broadleaf('fern', (f.x, f.y + 0.1, c.z + 0.15), 0.32, rng, leaf, stem, col, n_leaves=40,
                      leaf_len=(0.1, 0.16), leaf_w=(0.06, 0.1), stems=4, lean=(0.2, 0.45))
    # rubber plant (screen x 960..1060 -> hero 800..900, top y 185)
    p = R(852, 204, 4.8)
    base = Vector((p.x, p.y, 0))
    L.cylinder('rubber_pot', 0.22, 0.5, base, pot, col, n=40, bevel=0.02)
    L.plant_broadleaf('rubber', (base.x, base.y, 0.48), p.z - 0.48 + 0.05, rng, leaf, stem, col, n_leaves=80,
                      leaf_len=(0.2, 0.3), leaf_w=(0.11, 0.17), stems=4, lean=(0.12, 0.3))
    # soft light: big window key from the back-right (daylight) + warm fill from front-left
    k = L.area_light('window_key', (cx, wy + 0.4, 1.6), (0, 0, 0), 2.0, 900.0, L.hexcol('#FFE0D4'), cl, size_y=3.0)
    L.aim(k, (0.0, 2.0, 1.2))
    f = L.area_light('fill', (-2.5, -1.0, 2.2), (0, 0, 0), 3.0, 260.0, L.kelvin(4200), cl)
    L.aim(f, (0.0, wy, 1.4))
    w = bpy.data.worlds.new('hero_world')
    scn.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = L.hexcol('#F4D8D0')
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    anchors = {}
    # handwritten quote (screen bbox 1047,103 -> 1193,225, rotated -10 deg, fronto-parallel wall)
    q = [(1047 - 160, 103), (1193 - 160, 103), (1193 - 160, 225), (1047 - 160, 225)]
    def nx(hx):
        return round((FRAME[0] + 2 * hx) / PLATE[0], 5)

    def ny(hy):
        return round((FRAME[1] + 2 * hy) / PLATE[1], 5)
    anchors['quote'] = {'quad': [[nx(x), ny(y)] for x, y in q], 'rotateDeg': -10,
                        'order': 'TL,TR,BR,BL', 'note': 'axis-aligned bbox of the quote block; rotate -10deg'}
    anchors['characterSlot'] = {'bbox': [nx(480), ny(0), nx(805), ny(311)], 'bboxOrder': 'x0,y0,x1,y1',
                                'note': 'kept clean for the SVG character holding the jar (ref3 screen x 640..965)'}
    anchors['refFrame'] = {'x': round(FRAME[0] / PLATE[0], 5), 'y': round(FRAME[1] / PLATE[1], 5),
                           'w': round(2 * W0 / PLATE[0], 5), 'h': round(2 * H0 / PLATE[1], 5), 'refPx': [W0, H0],
                           'note': 'ref3 hero (screen x 160..1222, y 0..311) inside this plate'}
    return scn, cam, anchors


def main():
    import time
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    tier = argv[argv.index('--tier') + 1] if '--tier' in argv else 'preview'
    out = argv[argv.index('--out') + 1] if '--out' in argv else '.'
    os.makedirs(out, exist_ok=True)
    W, H = (PLATE[0] // 2, PLATE[1] // 2) if tier == 'preview' else PLATE
    spp = int(argv[argv.index('--spp') + 1]) if '--spp' in argv else (16 if tier == 'preview' else 32)
    scn, cam, anchors = build(W, H)
    scn.camera = cam.ob
    L.setup_cycles(scn, W, H, spp, 0.03 if tier == 'final' else 0.05, seed=7)
    L.setup_passes_and_compositor(scn, out, f'products_hero_{tier}', fg_names=(), glow_group='', mist=(0.5, 12.0))
    scn.render.filepath = os.path.join(out, f'products_hero_{tier}_agx.png')
    with open(os.path.join(out, f'products_hero_{tier}_anchors.json'), 'w') as fh:
        json.dump({'room': 'products-hero', 'camera': 'products_hero', 'plate': {'w': W, 'h': H},
                   'coords': 'normalised plate coordinates (0..1), origin top-left, x right, y down',
                   'refFrame': anchors.pop('refFrame'), 'character': anchors.pop('characterSlot'),
                   'surfaces': anchors}, fh, indent=1)
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    meta = dict(blender=bpy.app.version_string, seed=SEED, tier=tier, spp=spp, res=[W, H], params=P,
                render_seconds=round(time.time() - t0, 1),
                script_sha256=hashlib.sha256(open(__file__, 'rb').read()).hexdigest())
    with open(os.path.join(out, f'products_hero_{tier}_meta.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)
    print('[hero] render', meta['render_seconds'])


if __name__ == '__main__':
    main()
