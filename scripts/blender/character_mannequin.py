"""Evia character PROTOTYPE - neutral stand-in mannequin, rigged, exported as glTF binary (Blender 4.5 LTS).

WHAT
  A faceless, adult, art-figure / premium store-mannequin body (~1.68 m, slim, A-pose rest) in a soft matte
  rose-cream material, with a humanoid armature using Mixamo-style names (Hips, Spine, Spine1, Spine2, Neck, Head,
  Jaw, LeftShoulder, LeftArm, LeftForeArm, LeftHand, Left{Thumb,Index,Middle,Ring,Pinky}{1,2,3}, LeftIndexTip,
  LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase and the Right* mirror), bound with bone-heat automatic weights, exported
  to public/character/proto/mannequin.glb. It is an explicit PLACEHOLDER for the character prototype (off by default
  behind a switch), not a likeness of anyone. Axes, sizes and the pose conventions are documented in
  public/character/proto/README.md.

HOW (deterministic; primitives + modifiers only; no downloads, textures, add-ons or network)
  1. A joint table (metres; Blender Z up; the figure faces -Y; its LEFT side is +X) is the single source for both
     the body shape and the bones, so bones sit exactly in the middle of the limbs they drive.
  2. The body is a signed-distance field built from simple primitives (IQ round cones, ellipsoids, an elliptical
     torso loft, a flattened trapezoid palm) combined with polynomial smooth-min. It is evaluated with numpy only
     near the surface (8^3-voxel blocks, 2.5 mm voxels, X-mirrored), written to an OpenVDB level set (Blender's
     bundled `openvdb` module) and polygonised with convertToQuads.
  3. Blender's Decimate (collapse, X-symmetric, triangulate) takes it to ~12k triangles; smooth shading.
  4. Armature from the same table; rolls give every bone a documented local frame; auto weights (bone heat);
     the Jaw weights are painted procedurally on the lower head; <= 4 influences per vertex, normalised.
  5. glTF binary export (+Y up, facing +Z), then VALIDATION in a fresh scene: re-import the .glb, check names,
     counts, weights, sizes, rest positions, then pose the RE-IMPORTED rig (reach, point, palm-up present, head
     turn/tilt, the ref4 presenting pose, stress poses) and render a Workbench contact sheet.

RUN (always through the render lock wrapper; the machine is a slow 2-core Mac):
  LOCK=/Users/olaajibade/Documents/Codex/2026-09-16/hi/work/evia-rebuild/tools/blender-render.sh
  $LOCK scripts/blender/character_mannequin.py -- --out <workdir>               # build + export + validate + sheet
  $LOCK scripts/blender/character_mannequin.py -- --out <workdir> --stage mesh  # shape iteration: mesh + 4 views
  options: --glb PATH (default public/character/proto/mannequin.glb)  --vox 0.0025  --tris 12000
           --no-sheet  --save-blend FILE.blend
Outputs in <workdir>: shape_*.png (stage mesh), tiles/*.png + mannequin_sheet.png, validate.json, rig_table.md.
"""
import sys
import os
import math
import json
import struct
import time

import numpy as np
import bpy
import bmesh
from mathutils import Vector, Matrix, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DEFAULT_GLB = os.path.join(REPO, 'public', 'character', 'proto', 'mannequin.glb')

P = dict(
    a_pose=40.0,              # arms, degrees below horizontal (rest pose)
    vox=0.0025,               # SDF voxel size (m)
    block=8,                  # voxels per block edge for the sparse evaluation
    tris=12000,               # decimation target (hard limit 15k)
    color_srgb=(0.922, 0.824, 0.784),   # #EBD2C8 soft rose-cream
    roughness=0.62,
)
BAND_VOX = 3.0
BIG = 1.0e3
T0 = time.time()


def log(*a):
    print('[mannequin %6.1fs]' % (time.time() - T0), *a, flush=True)


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = dict(out='.', glb=DEFAULT_GLB, stage='all', sheet=True, save_blend=None)
    i = 0
    while i < len(argv):
        k = argv[i]
        if k == '--no-sheet':
            a['sheet'] = False; i += 1; continue
        v = argv[i + 1]
        if k == '--out': a['out'] = v
        elif k == '--glb': a['glb'] = v
        elif k == '--stage': a['stage'] = v
        elif k == '--vox': P['vox'] = float(v)
        elif k == '--tris': P['tris'] = int(v)
        elif k == '--save-blend': a['save_blend'] = v
        i += 2
    return a


def V(*a):
    return np.array(a, dtype=np.float64)


def nrm(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def srgb_to_linear(c):
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# ============================================================================ joint table
FINGERS = [
    # name,   MCP (u, s),        spread deg, phalanx lengths (MCP-PIP, PIP-DIP, DIP-tip centre), radii (MCP, PIP, DIP, tip)
    ('Index',  (0.084, 0.0235),   7.0, (0.039, 0.023, 0.018), (0.0082, 0.0076, 0.0069, 0.0061)),
    ('Middle', (0.087, 0.0055),   0.0, (0.043, 0.026, 0.019), (0.0085, 0.0079, 0.0071, 0.0062)),
    ('Ring',   (0.083, -0.0125), -7.0, (0.040, 0.025, 0.018), (0.0080, 0.0074, 0.0067, 0.0059)),
    ('Pinky',  (0.076, -0.0290), -15.0, (0.031, 0.019, 0.016), (0.0071, 0.0066, 0.0060, 0.0053)),
]
THUMB_R = (0.0120, 0.0100, 0.0092, 0.0080)
THUMB_L = (0.040, 0.030, 0.022)


def joint_table():
    """World-space joints (Blender: metres, Z up, figure faces -Y, its LEFT is +X). Left side authored, right
    side mirrored. Keys ending in End/Tip are bone tails / tip markers. Also returns the per-side hand frames."""
    a = math.radians(P['a_pose'])
    J = {}
    J['Hips'] = V(0, 0.012, 0.905)
    J['Spine'] = V(0, 0.012, 0.995)
    J['Spine1'] = V(0, 0.010, 1.095)
    J['Spine2'] = V(0, 0.008, 1.205)
    J['Neck'] = V(0, 0.020, 1.398)
    J['Head'] = V(0, 0.012, 1.505)
    J['HeadEnd'] = V(0, 0.008, 1.680)
    J['Jaw'] = V(0, 0.002, 1.540)
    J['JawEnd'] = V(0, -0.068, 1.470)

    u = V(math.cos(a), 0, -math.sin(a))      # along the arm (shoulder -> fingers)
    n = V(-math.sin(a), 0, -math.cos(a))     # palm normal (points out of the palm)
    s = np.cross(n, u)                        # toward the thumb (= -Y, forward, in this A-pose)
    L = {}
    S = V(0.160, 0.010, 1.362)
    L['Shoulder'] = V(0.024, 0.014, 1.392)
    L['Arm'] = S
    L['ForeArm'] = E = S + 0.282 * u
    L['Hand'] = W = E + 0.234 * u

    def hp(uu, ss, nn=0.0):
        return W + uu * u + ss * s + nn * n

    for name, (mu, ms), ang, lens, rad in FINGERS:
        f = math.cos(math.radians(ang)) * u + math.sin(math.radians(ang)) * s
        p = hp(mu, ms)
        L[name + '1'] = p
        L[name + '2'] = p = p + lens[0] * f
        L[name + '3'] = p = p + lens[1] * f
        L[name + 'End'] = p = p + lens[2] * f
        L[name + 'Tip'] = p + rad[3] * f          # the surface fingertip
        L['_dir' + name] = f
    t1 = nrm(0.72 * u + 0.58 * s + 0.30 * n)
    t2 = nrm(t1 + 0.20 * u - 0.08 * s)
    t3 = nrm(t2 + 0.12 * u)
    L['Thumb1'] = p = hp(0.014, 0.016, 0.006)
    L['Thumb2'] = p = p + THUMB_L[0] * t1
    L['Thumb3'] = p = p + THUMB_L[1] * t2
    L['ThumbEnd'] = p = p + THUMB_L[2] * t3
    L['ThumbTip'] = p + THUMB_R[3] * t3
    L['_t1'], L['_t2'], L['_t3'] = t1, t2, t3
    L['_u'], L['_n'], L['_s'] = u, n, s
    L['UpLeg'] = V(0.086, 0.006, 0.880)
    L['Leg'] = V(0.097, -0.004, 0.480)
    L['Foot'] = V(0.104, 0.022, 0.080)
    L['ToeBase'] = V(0.108, -0.098, 0.024)
    L['ToeEnd'] = V(0.110, -0.168, 0.020)

    M = np.array([-1.0, 1.0, 1.0])
    for k, v in L.items():
        J['Left' + k] = v
        J['Right' + k] = v * M
    return J


def bone_specs(J):
    """(name, head, tail, parent, z_hint, connected, deform). z_hint = where the bone's local +Z should point:
    trunk/arm/leg bones -> forward (-Y), hand/fingers -> palm normal, feet -> up, jaw -> down."""
    fwd, up, down = V(0, -1, 0), V(0, 0, 1), V(0, 0, -1)
    B = [
        ('Hips', J['Hips'], J['Spine'], None, fwd, False, True),
        ('Spine', J['Spine'], J['Spine1'], 'Hips', fwd, True, True),
        ('Spine1', J['Spine1'], J['Spine2'], 'Spine', fwd, True, True),
        ('Spine2', J['Spine2'], J['Neck'], 'Spine1', fwd, True, True),
        ('Neck', J['Neck'], J['Head'], 'Spine2', fwd, True, True),
        ('Head', J['Head'], J['HeadEnd'], 'Neck', fwd, True, True),
        ('Jaw', J['Jaw'], J['JawEnd'], 'Head', down, False, True),
    ]
    for side, mx in (('Left', 1.0), ('Right', -1.0)):
        M = np.array([mx, 1.0, 1.0])
        g = lambda k: J[side + k]
        pn = J['Left_n'] * M
        B += [
            (side + 'Shoulder', g('Shoulder'), g('Arm'), 'Spine2', fwd, False, True),
            (side + 'Arm', g('Arm'), g('ForeArm'), side + 'Shoulder', fwd, True, True),
            (side + 'ForeArm', g('ForeArm'), g('Hand'), side + 'Arm', fwd, True, True),
            (side + 'Hand', g('Hand'), g('Middle1'), side + 'ForeArm', pn, True, True),
            (side + 'Thumb1', g('Thumb1'), g('Thumb2'), side + 'Hand', pn, False, True),
            (side + 'Thumb2', g('Thumb2'), g('Thumb3'), side + 'Thumb1', pn, True, True),
            (side + 'Thumb3', g('Thumb3'), g('ThumbEnd'), side + 'Thumb2', pn, True, True),
        ]
        for name, *_ in FINGERS:
            B += [
                (side + name + '1', g(name + '1'), g(name + '2'), side + 'Hand', pn, False, True),
                (side + name + '2', g(name + '2'), g(name + '3'), side + name + '1', pn, True, True),
                (side + name + '3', g(name + '3'), g(name + 'End'), side + name + '2', pn, True, True),
            ]
        tip = g('IndexTip')
        B += [
            (side + 'IndexTip', tip, tip + 0.012 * (J['Left_dirIndex'] * M), side + 'Index3', pn, False, False),
            (side + 'UpLeg', g('UpLeg'), g('Leg'), 'Hips', fwd, False, True),
            (side + 'Leg', g('Leg'), g('Foot'), side + 'UpLeg', fwd, True, True),
            (side + 'Foot', g('Foot'), g('ToeBase'), side + 'Leg', up, True, True),
            (side + 'ToeBase', g('ToeBase'), g('ToeEnd'), side + 'Foot', up, True, True),
        ]
    return B


# ============================================================================ SDF primitives (numpy, float64)
class Prim:
    def __init__(self, fn, lo, hi):
        self.fn, self.lo, self.hi = fn, np.asarray(lo, float), np.asarray(hi, float)


class Group:
    def __init__(self, op, items, cut=None):
        self.op, self.items, self.cut = op, items, cut
        self.lo = np.min([c.lo - k for c, k in items], axis=0)
        self.hi = np.max([c.hi + k for c, k in items], axis=0)


def smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def round_cone(a, b, ra, rb):
    """Inigo Quilez's exact round cone between spheres (a, ra) and (b, rb)."""
    a = np.asarray(a, float); b = np.asarray(b, float)
    ba = b - a; l2 = float(ba @ ba); rr = ra - rb; a2 = l2 - rr * rr; il2 = 1.0 / l2
    sg = float(np.sign(rr))

    def fn(Pt):
        pa = Pt - a
        y = pa @ ba
        z = y - l2
        x = pa * l2 - y[:, None] * ba
        x2 = np.einsum('ij,ij->i', x, x)
        y2 = y * y * l2
        z2 = z * z * l2
        k = sg * rr * rr * x2
        d_b = np.sqrt(x2 + z2) * il2 - rb
        d_a = np.sqrt(x2 + y2) * il2 - ra
        d_s = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - ra
        return np.where(np.sign(z) * a2 * z2 > k, d_b, np.where(np.sign(y) * a2 * y2 < k, d_a, d_s))
    return Prim(fn, np.minimum(a - ra, b - rb), np.maximum(a + ra, b + rb))


def ellipsoid(c, radii, axes=None):
    """IQ's approximate ellipsoid distance; axes = 3 unit vectors (local x, y, z in world)."""
    c = np.asarray(c, float); r = np.asarray(radii, float)
    Rm = np.eye(3) if axes is None else np.column_stack([nrm(x) for x in axes])

    def fn(Pt):
        q = (Pt - c) @ Rm
        k0 = np.sqrt(((q / r) ** 2).sum(1))
        k1 = np.sqrt(((q / (r * r)) ** 2).sum(1))
        return np.where(k1 < 1e-9, -r.min(), k0 * (k0 - 1.0) / np.maximum(k1, 1e-12))
    ext = np.sqrt(((Rm * r[None, :]) ** 2).sum(1))
    return Prim(fn, c - ext, c + ext)


def hermite(zk, vk, zq):
    """Cubic Hermite (Catmull-Rom slopes) through knots (zk, vk), evaluated at zq (clamped)."""
    n = len(zk)
    m = np.empty(n)
    m[0] = (vk[1] - vk[0]) / (zk[1] - zk[0])
    m[-1] = (vk[-1] - vk[-2]) / (zk[-1] - zk[-2])
    m[1:-1] = (vk[2:] - vk[:-2]) / (zk[2:] - zk[:-2])
    i = np.clip(np.searchsorted(zk, zq, side='right') - 1, 0, n - 2)
    h = zk[i + 1] - zk[i]
    t = (zq - zk[i]) / h
    t2 = t * t; t3 = t2 * t
    return ((2 * t3 - 3 * t2 + 1) * vk[i] + (t3 - 2 * t2 + t) * h * m[i]
            + (-2 * t3 + 3 * t2) * vk[i + 1] + (t3 - t2) * h * m[i + 1])


def ellipse2(qx, qy, a, b):
    k0 = np.sqrt((qx / a) ** 2 + (qy / b) ** 2)
    k1 = np.sqrt((qx / (a * a)) ** 2 + (qy / (b * b)) ** 2)
    return np.where(k1 < 1e-9, -np.minimum(a, b), k0 * (k0 - 1.0) / np.maximum(k1, 1e-12))


def loft(table, k_bottom, k_top):
    """Torso: elliptical cross-sections (z, centre y, half width, half depth) interpolated along z, with rounded
    (smooth-max) end caps."""
    T = np.array(table, float)
    zk = T[:, 0]
    z0, z1 = zk[0], zk[-1]

    def fn(Pt):
        zq = np.clip(Pt[:, 2], z0, z1)
        cy = hermite(zk, T[:, 1], zq)
        hw = hermite(zk, T[:, 2], zq)
        hd = hermite(zk, T[:, 3], zq)
        d2 = ellipse2(Pt[:, 0], Pt[:, 1] - cy, hw, hd)
        return smax(smax(d2, z0 - Pt[:, 2], k_bottom), Pt[:, 2] - z1, k_top)
    hwm = T[:, 2].max()
    return Prim(fn, (-hwm, (T[:, 1] - T[:, 3]).min(), z0), (hwm, (T[:, 1] + T[:, 3]).max(), z1))


def palm(center, u, s, n, r1, r2, he, h, rnd):
    """Flat palm: a 2D trapezoid in the (s, u) plane (half width r1 at the wrist, r2 at the knuckles, half length
    he) extruded by +-h along the palm normal, all rounded by rnd."""
    center = np.asarray(center, float)
    Rm = np.column_stack([s, u, n])
    R1, R2, HE = r1 - rnd, r2 - rnd, he - rnd
    k1x, k1y, k2x, k2y = R2, HE, R2 - R1, 2 * HE
    k2d = k2x * k2x + k2y * k2y

    def fn(Pt):
        q = (Pt - center) @ Rm
        px = np.abs(q[:, 0]); py = q[:, 1]; pz = q[:, 2]
        rs = np.where(py < 0, R1, R2)
        cax = px - np.minimum(px, rs); cay = np.abs(py) - HE
        t = np.clip(((k1x - px) * k2x + (k1y - py) * k2y) / k2d, 0.0, 1.0)
        cbx = px - k1x + k2x * t; cby = py - k1y + k2y * t
        sg = np.where((cbx < 0) & (cay < 0), -1.0, 1.0)
        d2 = sg * np.sqrt(np.minimum(cax * cax + cay * cay, cbx * cbx + cby * cby))
        wy = np.abs(pz) - h
        return (np.minimum(np.maximum(d2, wy), 0.0)
                + np.sqrt(np.maximum(d2, 0.0) ** 2 + np.maximum(wy, 0.0) ** 2) - rnd)
    ext_local = np.array([r2, he, h + rnd])
    ext = np.abs(Rm) @ ext_local
    return Prim(fn, center - ext, center + ext)


TORSO = [  # z, centre y, half width (x), half depth (y)
    (0.770, 0.008, 0.060, 0.045),   # tapers inside the thighs: no shelf at the crotch / seat
    (0.805, 0.010, 0.120, 0.070),
    (0.855, 0.014, 0.155, 0.092),   # hips / seat
    (0.920, 0.009, 0.152, 0.088),
    (0.990, 0.007, 0.128, 0.083),
    (1.045, 0.007, 0.115, 0.080),   # waist
    (1.110, 0.004, 0.123, 0.085),
    (1.170, 0.001, 0.130, 0.090),   # under-bust / lower ribs
    (1.240, 0.001, 0.136, 0.092),
    (1.310, 0.005, 0.139, 0.088),   # arm-pit level
    (1.350, 0.012, 0.128, 0.078),
    (1.388, 0.018, 0.076, 0.054),   # base of the neck
]


def build_sdf(J):
    body = [(loft(TORSO, 0.03, 0.05), 0.0)]
    body.append((ellipsoid(V(0, 0.006, 0.792), (0.055, 0.058, 0.034)), 0.04))           # soft crotch bridge
    body.append((round_cone(V(0, 0.024, 1.372), V(0, 0.010, 1.515), 0.053, 0.047), 0.03))   # neck
    head = Group('smin', [
        (ellipsoid(V(0, 0.012, 1.592), (0.070, 0.088, 0.088)), 0.0),     # cranium
        (ellipsoid(V(0, -0.018, 1.542), (0.064, 0.070, 0.068)), 0.035),  # face mass
        (ellipsoid(V(0, -0.006, 1.502), (0.050, 0.055, 0.036)), 0.030),  # jaw
        (ellipsoid(V(0, -0.047, 1.492), (0.034, 0.032, 0.030)), 0.030),  # chin
    ])
    body.append((head, 0.022))
    legs = []
    for sx in (1.0, -1.0):
        M = np.array([sx, 1.0, 1.0])
        side = 'Left' if sx > 0 else 'Right'
        g = lambda k: J[side + k]
        u, n, s = J['Left_u'] * M, J['Left_n'] * M, J['Left_s'] * M
        up_perp = nrm(np.cross(V(0, 1, 0), u)) if sx > 0 else nrm(np.cross(u, V(0, 1, 0)))
        if up_perp[2] < 0:
            up_perp = -up_perp
        S, E, W = g('Arm'), g('ForeArm'), g('Hand')
        # shoulders
        body.append((round_cone(V(0.035 * sx, 0.028, 1.425), V(0.135 * sx, 0.018, 1.383), 0.040, 0.037), 0.05))
        body.append((ellipsoid(S + 0.018 * u + 0.006 * up_perp, (0.058, 0.047, 0.045),
                               (u, V(0, 1, 0), up_perp)), 0.045))
        # bust / glutes (subtle)
        th, tl = math.radians(14.0), math.radians(18.0)       # outward yaw, top leaning back into the chest
        lat = V(math.cos(th) * sx, math.sin(th), 0)
        dep = V(math.sin(th) * sx, -math.cos(th), 0)
        dep, vert = math.cos(tl) * dep + math.sin(tl) * V(0, 0, 1), -math.sin(tl) * dep + math.cos(tl) * V(0, 0, 1)
        body.append((ellipsoid(V(0.057 * sx, -0.068, 1.220), (0.050, 0.036, 0.054), (lat, dep, vert)), 0.045))
        # arm
        F = E + 0.32 * (W - E)
        body.append((round_cone(S, E, 0.041, 0.031), 0.025))
        body.append((round_cone(E, F, 0.031, 0.0335), 0.006))
        body.append((round_cone(F, W, 0.0335, 0.0225), 0.004))
        # hand
        hp = lambda uu, ss, nn=0.0: W + uu * u + ss * s + nn * n
        t1 = J['Left_t1'] * M
        a2 = nrm(np.cross(n, t1))
        pg = Group('smin', [
            (palm(hp(0.045, -0.003), u, s, n, 0.024, 0.036, 0.042, 0.003, 0.009), 0.0),
            (ellipsoid(g('Thumb1') + 0.017 * t1 + 0.005 * n, (0.024, 0.015, 0.012),
                       (t1, a2, np.cross(t1, a2))), 0.012),
            (ellipsoid(hp(0.047, -0.021, 0.004), (0.034, 0.012, 0.010), (u, s, n)), 0.010),
        ])
        fingers = []
        for name, _, _, _, rad in FINGERS:
            fingers.append((Group('min', [
                (round_cone(g(name + '1'), g(name + '2'), rad[0], rad[1]), 0.0),
                (round_cone(g(name + '2'), g(name + '3'), rad[1], rad[2]), 0.0),
                (round_cone(g(name + '3'), g(name + 'End'), rad[2], rad[3]), 0.0),
            ]), 0.003))
        thumb = Group('min', [
            (round_cone(g('Thumb1'), g('Thumb2'), THUMB_R[0], THUMB_R[1]), 0.0),
            (round_cone(g('Thumb2'), g('Thumb3'), THUMB_R[1], THUMB_R[2]), 0.0),
            (round_cone(g('Thumb3'), g('ThumbEnd'), THUMB_R[2], THUMB_R[3]), 0.0),
        ])
        hand = Group('smin', [(pg, 0.0), (Group('smin', fingers), 0.008), (thumb, 0.010)])
        body.append((hand, 0.016))
        # leg + foot
        Hj, K, A = g('UpLeg'), g('Leg'), g('Foot')
        # the thigh grows out of the pelvis: its top sphere sits wholly inside the torso loft (no ridge)
        Ta = V(0.074 * sx, 0.008, 0.905)
        Tb = Hj + 0.25 * (K - Hj)
        T1 = Hj + 0.55 * (K - Hj)
        C = K + 0.30 * (A - K)
        x = 0.104 * sx
        foot = Group('smin', [
            (ellipsoid(V(0.106 * sx, -0.035, 0.030), (0.039, 0.088, 0.036)), 0.0),
            (ellipsoid(V(0.109 * sx, -0.118, 0.016), (0.043, 0.054, 0.024)), 0.02),
            (ellipsoid(V(x, 0.034, 0.030), (0.034, 0.034, 0.036)), 0.02),
            (round_cone(A, V(0.105 * sx, 0.005, 0.048), 0.029, 0.034), 0.02),
        ], cut=lambda acc, Q: smax(acc, -Q[:, 2].astype(np.float64), 0.006))
        leg = Group('smin', [
            (round_cone(Ta, Tb, 0.058, 0.077), 0.0),
            (round_cone(Tb, T1, 0.077, 0.062), 0.004),
            (round_cone(T1, K, 0.062, 0.046), 0.004),
            (ellipsoid(K + V(0, -0.026, 0.004), (0.028, 0.016, 0.030)), 0.02),
            (round_cone(K, C, 0.046, 0.049), 0.004),
            (round_cone(C, A, 0.049, 0.029), 0.004),
            (ellipsoid(K + 0.28 * (A - K) + V(0, 0.016, 0), (0.038, 0.040, 0.085)), 0.03),
            (foot, 0.012),
        ])
        legs.append((leg, 0.0))
    # the legs blend into the pelvis but not into each other (hard union between them)
    body.append((Group('min', legs), 0.06))
    return Group('smin', body)


def evaluate(node, Pt, extra):
    band = BAND_VOX * P['vox']

    def ev(node, idx):
        if isinstance(node, Prim):
            return node.fn(Pt[idx].astype(np.float64))
        Q = Pt[idx]
        acc = np.full(len(idx), BIG)
        for child, k in node.items:
            M = band + k + extra
            m = np.all((Q >= child.lo - M) & (Q <= child.hi + M), axis=1)
            if not m.any():
                continue
            vals = ev(child, idx[m])
            if node.op == 'smin' and k > 0:
                acc[m] = smin(acc[m], vals, k)
            else:
                acc[m] = np.minimum(acc[m], vals)
        if node.cut is not None:
            acc = node.cut(acc, Q)
        return acc
    return ev(node, np.arange(len(Pt)))


def polygonize(root):
    import openvdb as vdb
    vox, B = P['vox'], P['block']
    band = BAND_VOX * vox
    lo = root.lo - 2 * B * vox
    hi = root.hi + 2 * B * vox
    i0s = np.arange(0, int(math.ceil(hi[0] / vox)) + 1, B)          # x >= 0 half, mirrored later
    j0s = np.arange(int(math.floor(lo[1] / vox)), int(math.ceil(hi[1] / vox)) + 1, B)
    k0s = np.arange(int(math.floor(max(lo[2], -0.02) / vox)), int(math.ceil(hi[2] / vox)) + 1, B)
    blocks = np.stack(np.meshgrid(i0s, j0s, k0s, indexing='ij'), -1).reshape(-1, 3)
    centers = ((blocks + (B - 1) / 2.0) * vox).astype(np.float32)
    dc = evaluate(root, centers, 0.08)
    R = math.sqrt(3.0) * (B - 1) / 2.0 * vox
    thr = 2.0 * R + 0.004
    dense = blocks[np.abs(dc) < thr]
    inside = blocks[dc <= -thr]
    log('blocks %d, dense %d, inside %d' % (len(blocks), len(dense), len(inside)))
    offs = np.stack(np.indices((B, B, B)), -1).reshape(-1, 3)
    grid = vdb.FloatGrid(band)
    grid.transform = vdb.createLinearTransform(voxelSize=vox)
    grid.name = 'sdf'
    chunk = 1500
    for c0 in range(0, len(dense), chunk):
        db = dense[c0:c0 + chunk]
        ijk = (db[:, None, :] + offs[None, :, :]).reshape(-1, 3)
        d = evaluate(root, (ijk * vox).astype(np.float32), 0.0)
        d = np.clip(d, -band, band).astype(np.float32).reshape(len(db), B, B, B)
        for b, (i0, j0, k0) in enumerate(db):
            arr = np.ascontiguousarray(d[b])
            grid.copyFromArray(arr, ijk=(int(i0), int(j0), int(k0)), tolerance=0.0)
            grid.copyFromArray(np.ascontiguousarray(arr[::-1]), ijk=(int(-(i0 + B - 1)), int(j0), int(k0)),
                               tolerance=0.0)
        log('  dense %d/%d' % (min(c0 + chunk, len(dense)), len(dense)))
    for (i0, j0, k0) in inside:
        grid.fill((int(i0), int(j0), int(k0)), (int(i0 + B - 1), int(j0 + B - 1), int(k0 + B - 1)), -band, True)
        grid.fill((int(-(i0 + B - 1)), int(j0), int(k0)), (int(-i0), int(j0 + B - 1), int(k0 + B - 1)), -band, True)
    pts, quads = grid.convertToQuads(0.0)
    log('polygonised: %d verts, %d quads' % (len(pts), len(quads)))
    return np.asarray(pts, np.float32), np.asarray(quads, np.int64)


# ============================================================================ Blender helpers
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def make_mesh(name, pts, quads):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(pts))
    me.vertices.foreach_set('co', pts.ravel())
    nq = len(quads)
    me.loops.add(nq * 4)
    me.loops.foreach_set('vertex_index', quads.astype(np.int32).ravel())
    me.polygons.add(nq)
    me.polygons.foreach_set('loop_start', np.arange(0, nq * 4, 4, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def clean_mesh(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # keep only the largest connected piece (stray specks, if any)
    bm.verts.ensure_lookup_table()
    seen, parts = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            x = stack.pop(); comp.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index); stack.append(o)
        parts.append(comp)
    parts.sort(key=len, reverse=True)
    for comp in parts[1:]:
        bmesh.ops.delete(bm, geom=comp, context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    return len(parts)


def decimate(obj, target_tris, root):
    """Quadric collapse to ~target_tris (the input is X-symmetric and the collapse is deterministic, so the result
    stays symmetric; the modifier's own symmetry option folds faces on the mid-line, so it is not used), then a
    few passes of tangential relaxation re-projected onto the full-resolution surface to even out slivers."""
    from mathutils.bvhtree import BVHTree
    me = obj.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(obj, dg)
    mod = obj.modifiers.new('decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = min(1.0, target_tris / float(tris))
    mod.use_symmetry = False
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    new = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    obj.modifiers.remove(mod)
    old = obj.data
    obj.data = new
    bpy.data.meshes.remove(old)
    new.name = 'Mannequin'
    relax(new, bvh, iters=4, lam=0.45)
    folds = untangle(new, root, bvh)
    log('folds found/left after untangle: %d/%d' % folds)
    new.polygons.foreach_set('use_smooth', np.ones(len(new.polygons), dtype=bool))
    new.update()
    return sum(len(p.vertices) - 2 for p in new.polygons), folds


def relax(me, bvh, iters, lam):
    nv = len(me.vertices)
    co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    ed = np.empty(len(me.edges) * 2, np.int64); me.edges.foreach_get('vertices', ed); ed = ed.reshape(-1, 2)
    cnt = np.zeros(nv); np.add.at(cnt, ed[:, 0], 1); np.add.at(cnt, ed[:, 1], 1)
    co0 = co.copy()
    fn0 = np.empty(len(me.polygons) * 3); me.polygons.foreach_get('normal', fn0); fn0 = fn0.reshape(-1, 3)
    for _ in range(iters):
        me.vertices.foreach_set('co', co.ravel()); me.update()
        nr = np.empty(nv * 3); me.vertex_normals.foreach_get('vector', nr); nr = nr.reshape(-1, 3)
        acc = np.zeros((nv, 3)); np.add.at(acc, ed[:, 0], co[ed[:, 1]]); np.add.at(acc, ed[:, 1], co[ed[:, 0]])
        d = acc / cnt[:, None] - co
        d -= (d * nr).sum(1)[:, None] * nr
        co = co + lam * d
        for i in range(nv):
            hit = bvh.find_nearest(Vector(co[i]))
            if hit[0] is not None:
                co[i] = hit[0]
    me.vertices.foreach_set('co', co.ravel())
    me.update()
    # undo the move wherever relaxation turned a face against its decimated orientation
    for _ in range(5):
        me.vertices.foreach_set('co', co.ravel()); me.update()
        fn1 = np.empty(len(me.polygons) * 3); me.polygons.foreach_get('normal', fn1); fn1 = fn1.reshape(-1, 3)
        bad = np.where((fn0 * fn1).sum(1) < 0.3)[0]
        if not len(bad):
            break
        for f in bad:
            for vi in me.polygons[f].vertices:
                co[vi] = co0[vi]
    me.vertices.foreach_set('co', co.ravel())
    me.update()


def sdf_normals(root, pts, eps=0.0008):
    pts = np.asarray(pts, np.float64)
    g = np.zeros_like(pts)
    for ax in range(3):
        d = np.zeros(3); d[ax] = eps
        g[:, ax] = evaluate(root, (pts + d).astype(np.float32), 0.02) - evaluate(root, (pts - d).astype(np.float32), 0.02)
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-12)


def untangle(me, root, bvh, iters=12):
    """Find faces whose normal disagrees with the true surface normal (SDF gradient) - folds left by the
    collapse - and Laplacian-smooth their vertices (re-projected onto the full-resolution surface) until none are
    left. Returns (folds found, folds left)."""
    nv = len(me.vertices)
    ed = np.empty(len(me.edges) * 2, np.int64); me.edges.foreach_get('vertices', ed); ed = ed.reshape(-1, 2)
    cnt = np.zeros(nv); np.add.at(cnt, ed[:, 0], 1); np.add.at(cnt, ed[:, 1], 1)
    tri = np.empty(len(me.polygons) * 3, np.int64); me.polygons.foreach_get('vertices', tri); tri = tri.reshape(-1, 3)
    co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    found = None
    for _ in range(iters):
        a, b, c = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
        fn = np.cross(b - a, c - a)
        fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-15)
        gn = sdf_normals(root, (a + b + c) / 3.0)
        bad = np.where((fn * gn).sum(1) < 0.25)[0]
        if found is None:
            found = len(bad)
        if not len(bad):
            break
        sel = np.zeros(nv, bool); sel[tri[bad].ravel()] = True
        ring = sel.copy(); ring[ed[sel[ed[:, 0]], 1]] = True; ring[ed[sel[ed[:, 1]], 0]] = True
        acc = np.zeros((nv, 3)); np.add.at(acc, ed[:, 0], co[ed[:, 1]]); np.add.at(acc, ed[:, 1], co[ed[:, 0]])
        for i in np.where(ring)[0]:
            p = acc[i] / cnt[i]
            hit = bvh.find_nearest(Vector(p))
            co[i] = hit[0] if hit[0] is not None else p
    me.vertices.foreach_set('co', co.ravel())
    me.update()
    a, b, c = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    fn = np.cross(b - a, c - a); fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-15)
    cen = (a + b + c) / 3.0
    badl = np.where((fn * sdf_normals(root, cen)).sum(1) < 0.25)[0]
    if len(badl):
        log('remaining folds at', np.round(cen[badl], 3).tolist())
    return found, int(len(badl))


def mesh_stats(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    co = np.array([v.co[:] for v in bm.verts])
    bm.free()
    return dict(verts=len(co), tris=tris, non_manifold_edges=nm,
                bbox_min=[round(x, 4) for x in co.min(0)], bbox_max=[round(x, 4) for x in co.max(0)])


def make_material():
    lin = srgb_to_linear(P['color_srgb'])
    mat = bpy.data.materials.new('MannequinRoseCream')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*lin, 1.0)
    bsdf.inputs['Roughness'].default_value = P['roughness']
    bsdf.inputs['Metallic'].default_value = 0.0
    mat.diffuse_color = (*lin, 1.0)
    mat.roughness = P['roughness']
    return mat


def build_armature(J):
    scene = bpy.context.scene
    data = bpy.data.armatures.new('Armature')
    arm = bpy.data.objects.new('Armature', data)
    scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    specs = bone_specs(J)
    for name, h, t, parent, z, conn, deform in specs:
        eb = data.edit_bones.new(name)
        eb.head = Vector(h); eb.tail = Vector(t)
        eb.align_roll(Vector(z))
        eb.use_deform = deform
    for name, h, t, parent, z, conn, deform in specs:
        if parent:
            eb = data.edit_bones[name]
            eb.parent = data.edit_bones[parent]
            eb.use_connect = conn
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.select_set(False)
    return arm


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def finger_weights(co, Wt, col):
    """Bone heat lets neighbouring fingers share weights (curling the middle finger dragged the pointing index).
    Fingers are known capsule chains, so re-weight every vertex that bone heat gave to a finger: it belongs to the
    finger whose surface it is on, blends Hand -> phalanx 1 across the knuckle and between phalanges across each
    joint. The vertex's non-hand weights (e.g. ForeArm near the thumb base) are kept."""
    J = joint_table()
    names = ['Thumb'] + [f[0] for f in FINGERS]
    radii = dict([('Thumb', THUMB_R)] + [(f[0], f[4]) for f in FINGERS])
    for side in ('Left', 'Right'):
        hcol = col[side + 'Hand']
        fcols = [col['%s%s%d' % (side, n, i)] for n in names for i in (1, 2, 3)]
        cand = np.where(Wt[:, fcols].sum(1) > 1e-4)[0]
        if not len(cand):
            continue
        Pv = co[cand]
        dist = np.empty((len(cand), len(names)))
        arc = np.empty((len(cand), len(names)))
        segL = {}
        for fi, n in enumerate(names):
            pts = [J['%s%s%d' % (side, n, i)] for i in (1, 2, 3)] + [J[side + n + 'End']]
            r = radii[n]
            dist[:, fi] = np.min([round_cone(pts[k], pts[k + 1], r[k], r[k + 1]).fn(Pv) for k in range(3)], axis=0)
            L = [np.linalg.norm(pts[k + 1] - pts[k]) for k in range(3)]
            segL[n] = np.cumsum([0.0] + L)
            best = np.full(len(cand), np.inf)
            for k in range(3):
                A, Bp = pts[k], pts[k + 1]
                t = ((Pv - A) @ (Bp - A)) / (L[k] ** 2)
                t = np.clip(t, -np.inf if k == 0 else 0.0, np.inf if k == 2 else 1.0)
                dd = np.linalg.norm(Pv - (A + t[:, None] * (Bp - A)), axis=1)
                upd = dd < best
                best[upd] = dd[upd]
                arc[upd, fi] = segL[n][k] + t[upd] * L[k]
        owner = np.argmin(dist, axis=1)
        for j, vi in enumerate(cand):
            n = names[owner[j]]
            s = arc[j, owner[j]]
            portion = Wt[vi, hcol] + Wt[vi, fcols].sum()
            lo, hi = (-0.004, 0.024) if n == 'Thumb' else (-0.006, 0.010)
            w_hand = 1.0 - float(smoothstep(lo, hi, s))
            S1 = float(smoothstep(segL[n][1] - 0.005, segL[n][1] + 0.005, s))
            S2 = float(smoothstep(segL[n][2] - 0.004, segL[n][2] + 0.004, s))
            Wt[vi, hcol] = portion * w_hand
            Wt[vi, fcols] = 0.0
            rest = portion * (1.0 - w_hand)
            Wt[vi, col['%s%s1' % (side, n)]] = rest * (1.0 - S1)
            Wt[vi, col['%s%s2' % (side, n)]] = rest * (S1 - S2)
            Wt[vi, col['%s%s3' % (side, n)]] = rest * S2


def bind(obj, arm):
    """Bone-heat automatic weights, then Jaw weights on the lower head, <= 4 influences, normalised."""
    arm.data.bones['Jaw'].use_deform = False
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True); arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    arm.data.bones['Jaw'].use_deform = True
    names = [b.name for b in arm.data.bones if b.use_deform]
    for nm in names:
        if nm not in obj.vertex_groups:
            obj.vertex_groups.new(name=nm)
    gi = {g.index: g.name for g in obj.vertex_groups}
    col = {nm: i for i, nm in enumerate(names)}
    me = obj.data
    nv = len(me.vertices)
    Wt = np.zeros((nv, len(names)))
    for v in me.vertices:
        for g in v.groups:
            nm = gi[g.group]
            if nm in col:
                Wt[v.index, col[nm]] = g.weight
    co = np.array([v.co[:] for v in me.vertices])
    finger_weights(co, Wt, col)
    # jaw: take part of the Head weight on the lower front of the head
    jf = smoothstep(1.522, 1.492, co[:, 2]) * smoothstep(0.012, -0.022, co[:, 1]) * (co[:, 2] > 1.40)
    h, j = col['Head'], col['Jaw']
    Wt[:, j] = jf * Wt[:, h]
    Wt[:, h] -= Wt[:, j]
    # vertices bone heat left empty (should be none): nearest bone head
    empty = np.where(Wt.sum(1) < 1e-6)[0]
    if len(empty):
        heads = np.array([arm.data.bones[nm].head_local[:] for nm in names])
        for vi in empty:
            Wt[vi, np.argmin(((heads - co[vi]) ** 2).sum(1))] = 1.0
    # limit to 4 influences, normalise
    order = np.argsort(-Wt, axis=1)
    keep = np.zeros_like(Wt, dtype=bool)
    np.put_along_axis(keep, order[:, :4], True, axis=1)
    Wt = np.where(keep & (Wt > 1e-4), Wt, 0.0)
    Wt /= Wt.sum(1, keepdims=True)
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    for nm in names:
        vg = obj.vertex_groups.new(name=nm)
        c = Wt[:, col[nm]]
        nz = np.nonzero(c)[0]
        for w in np.unique(np.round(c[nz], 5)):
            ids = nz[np.round(c[nz], 5) == w]
            vg.add(ids.tolist(), float(w), 'REPLACE')
    return dict(unweighted_fallback=int(len(empty)), jaw_vertices=int((Wt[:, j] > 0.01).sum()),
                max_influences=int((Wt > 0).sum(1).max()))


# ============================================================================ export + checks
def export_glb(obj, arm, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True); arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
              export_skins=True, export_morph=False, export_animations=False, export_texcoords=False,
              export_normals=True, export_tangents=False, export_materials='EXPORT', export_def_bones=False,
              export_rest_position_armature=True, export_all_influences=False, export_extras=False,
              export_cameras=False, export_lights=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:
        log('export kw fallback:', e)
        for k in ('export_rest_position_armature', 'export_all_influences', 'export_def_bones'):
            kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)
    return os.path.getsize(path)


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack_from('<III', data, 0)
    clen, ctype = struct.unpack_from('<II', data, 12)
    return json.loads(data[20:20 + clen].decode('utf-8')), len(data)


def trs(node):
    t = node.get('translation', [0, 0, 0])
    r = node.get('rotation', [0, 0, 0, 1])
    s = node.get('scale', [1, 1, 1])
    q = Quaternion((r[3], r[0], r[1], r[2]))
    return Matrix.LocRotScale(Vector(t), q, Vector(s))


def glb_report(path, arm_src):
    """Parse the .glb and report what three.js will see: counts, bounds, joint world positions (glTF space)."""
    js, size = read_glb(path)
    nodes = js['nodes']
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []):
            parent[c] = i
    world = {}

    def wm(i):
        if i not in world:
            world[i] = (wm(parent[i]) @ trs(nodes[i])) if i in parent else trs(nodes[i])
        return world[i]
    skin = js['skins'][0]
    joints = skin['joints']
    jn = [nodes[j]['name'] for j in joints]
    mesh_node = [i for i, nd in enumerate(nodes) if 'mesh' in nd][0]
    prim = js['meshes'][nodes[mesh_node]['mesh']]['primitives'][0]
    acc = js['accessors']
    pos = acc[prim['attributes']['POSITION']]
    rep = dict(bytes=size, joints=len(joints), vertices=pos['count'], triangles=acc[prim['indices']]['count'] // 3,
               attributes=sorted(prim['attributes'].keys()), materials=[m.get('name') for m in js.get('materials', [])],
               extensions=js.get('extensionsUsed', []), animations=len(js.get('animations', [])),
               morph_targets=len(prim.get('targets', [])),
               position_min=[round(x, 4) for x in pos['min']], position_max=[round(x, 4) for x in pos['max']],
               mesh_node_has_transform=any(k in nodes[mesh_node] for k in ('translation', 'rotation', 'scale')))
    # bone frames: child joint translation should lie on the parent's +Y (Blender bone axis kept)
    off_axis = 0.0
    jset = set(joints)
    for j in joints:
        for c in nodes[j].get('children', []):
            if c in jset and nodes[c]['name'] not in ('Jaw',) and not nodes[c]['name'].endswith(
                    ('Shoulder', 'Thumb1', 'Index1', 'Middle1', 'Ring1', 'Pinky1', 'IndexTip', 'UpLeg')):
                t = nodes[c].get('translation', [0, 0, 0])
                off_axis = max(off_axis, abs(t[0]), abs(t[2]))
    rep['max_off_axis_child_translation_m'] = round(off_axis, 6)
    # joint world positions vs the Blender bones (converted to glTF: x, z, -y)
    err = 0.0
    table = []
    for j in joints:
        nm = nodes[j]['name']
        p = wm(j).to_translation()
        b = arm_src.data.bones[nm]
        hb = b.head_local
        tb = b.tail_local
        err = max(err, (p - Vector((hb.x, hb.z, -hb.y))).length)
        yax = (wm(j).to_3x3() @ Vector((0, 1, 0))).normalized()
        zax = (wm(j).to_3x3() @ Vector((0, 0, 1))).normalized()
        table.append((nm, nodes[parent[j]]['name'] if j in parent else '-', (p.x, p.y, p.z),
                      (tb.x, tb.z, -tb.y), b.length, (yax.x, yax.y, yax.z), (zax.x, zax.y, zax.z)))
    rep['max_joint_position_error_m'] = round(err, 6)
    return rep, table


def rig_table_md(table):
    lines = ['| bone | parent | head x, y, z (m) | tail x, y, z (m) | length (m) | local +Y (along bone) | local +Z |',
             '|---|---|---|---|---|---|---|']
    def f(v, nd):
        return ', '.join(('%.*f' % (nd, x if abs(x) >= 0.5 * 10 ** -nd else 0.0)) for x in v)
    for nm, par, h, t, L, y, z in table:
        lines.append('| %s | %s | %s | %s | %.3f | %s | %s |' % (nm, par, f(h, 3), f(t, 3), L, f(y, 2), f(z, 2)))
    return '\n'.join(lines) + '\n'


# ============================================================================ posing (works on any armature
# with these bone names: armature-space aims + IK, bone-local rotations for curls)
AX = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}


class Poser:
    def __init__(self, arm):
        self.arm = arm
        self.mw = arm.matrix_world.copy()
        self.mw3 = self.mw.to_3x3().normalized()
        self.mw3i = self.mw3.inverted()

    def upd(self):
        bpy.context.view_layer.update()

    def reset(self):
        for pb in self.arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
        self.upd()

    def head(self, name):
        self.upd()
        return self.mw @ self.arm.pose.bones[name].head

    def tail(self, name):
        self.upd()
        return self.mw @ self.arm.pose.bones[name].tail

    def axis(self, name, ax):
        self.upd()
        return (self.mw3 @ self.arm.pose.bones[name].matrix.to_3x3().col['XYZ'.index(ax)]).normalized()

    def rot(self, name, ax, deg):
        pb = self.arm.pose.bones[name]
        pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion(AX[ax], math.radians(deg))
        self.upd()

    def aim(self, name, d_world):
        self.upd()
        pb = self.arm.pose.bones[name]
        M = pb.matrix.copy()
        d = (self.mw3i @ Vector(d_world)).normalized()
        R = M.to_3x3().normalized()
        q = R.col[1].normalized().rotation_difference(d)
        pb.matrix = Matrix.LocRotScale(M.to_translation(), (q.to_matrix() @ R).to_quaternion(), Vector((1, 1, 1)))
        self.upd()

    def ik(self, upper, lower, target, pole):
        S = self.head(upper)
        L1 = (self.tail(upper) - S).length
        L2 = (self.tail(lower) - self.head(lower)).length
        D = Vector(target) - S
        dist = min(D.length, (L1 + L2) * 0.995)
        Dn = D.normalized()
        a = (L1 * L1 + dist * dist - L2 * L2) / (2 * dist)
        h = math.sqrt(max(L1 * L1 - a * a, 0.0))
        pv = Vector(pole)
        pv = (pv - Dn * pv.dot(Dn)).normalized()
        E = S + Dn * a + pv * h
        self.aim(upper, E - S)
        self.aim(lower, (S + Dn * dist) - E)

    def twist_to(self, bones_fracs, ref, want):
        """Roll the listed bones about their own Y so that `ref` bone's local +Z (palm normal for a hand) turns
        toward the world direction `want`; the angle is shared across bones by the given fractions."""
        ax = self.axis(bones_fracs[0][0], 'Y')
        cur = self.axis(ref, 'Z')
        w = Vector(want).normalized()
        c = cur - ax * cur.dot(ax)
        t = w - ax * w.dot(ax)
        if c.length < 1e-6 or t.length < 1e-6:
            return 0.0
        c.normalize(); t.normalize()
        ang = math.atan2(ax.dot(c.cross(t)), c.dot(t))
        for name, frac in bones_fracs:
            pb = self.arm.pose.bones[name]
            pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion((0, 1, 0), ang * frac)
            self.upd()
        return math.degrees(ang)

    def point_at(self, side, target, iters=3):
        """Turn the hand about the wrist so the index-tip ray (<side>IndexTip +Y) passes through `target`."""
        for _ in range(iters):
            tip = self.head(side + 'IndexTip')
            q = self.axis(side + 'IndexTip', 'Y').rotation_difference((Vector(target) - tip).normalized())
            pb = self.arm.pose.bones[side + 'Hand']
            M = pb.matrix.copy()
            R = self.mw3i @ q.to_matrix() @ self.mw3 @ M.to_3x3().normalized()
            pb.matrix = Matrix.LocRotScale(M.to_translation(), R.to_quaternion(), Vector((1, 1, 1)))
            self.upd()

    def thumb_onto(self, side, finger):
        """Tuck the thumb over a curled finger: aim Thumb2 at its middle joint, Thumb3 just past its last joint."""
        m2, m3 = self.head(side + finger + '2'), self.head(side + finger + '3')
        self.aim(side + 'Thumb2', m2 - self.head(side + 'Thumb2'))
        self.aim(side + 'Thumb3', m3.lerp(m2, 0.3) - self.head(side + 'Thumb3'))

    def fingers(self, side, curls, thumb=(0, 0, 0), spread=0.0):
        for (name, *_), c in zip(FINGERS, curls):
            for i in range(3):
                self.rot('%s%s%d' % (side, name, i + 1), 'X', c[i])
        for i in range(3):
            self.rot('%sThumb%d' % (side, i + 1), 'X', thumb[i])
        if spread:
            for (name, *_), f in zip(FINGERS, (1.0, 0.0, -1.0, -2.0)):
                sgn = 1.0 if side == 'Left' else -1.0
                self.rot('%s%s1' % (side, name), 'Z', spread * f * sgn)


RELAX = [(6, 8, 4), (9, 10, 5), (12, 12, 6), (15, 14, 8)]


def pose_reach(p):
    """Right arm reaches forward-right to chest height, palm leading, head follows."""
    p.reset()
    p.rot('Spine1', 'Y', -5); p.rot('Spine2', 'Y', -6); p.rot('Spine2', 'X', 3)
    p.ik('RightArm', 'RightForeArm', Vector((-0.34, -0.50, 1.24)), (-0.5, 0.3, -1.0))
    p.twist_to([('RightForeArm', 0.7), ('RightHand', 0.3)], 'RightHand', (-0.1, -0.7, -0.7))
    p.rot('RightHand', 'X', -12)
    p.fingers('Right', RELAX, (0, 5, 5))
    p.rot('Neck', 'Y', -10); p.rot('Head', 'Y', -18); p.rot('Head', 'X', 6)


def pose_point(p):
    """Right arm points forward-right with the index finger; other fingers curled, thumb tucked."""
    p.reset()
    p.rot('Spine2', 'Y', -6)
    p.ik('RightArm', 'RightForeArm', Vector((-0.30, -0.42, 1.30)), (-0.6, 0.4, -1.0))
    target = Vector((-0.75, -1.40, 1.42))
    p.twist_to([('RightForeArm', 0.7), ('RightHand', 0.3)], 'RightHand', (0.35, 0.0, -1.0))
    p.aim('RightHand', target - p.head('RightHand'))
    p.fingers('Right', [(0, 0, 0), (80, 95, 55), (88, 95, 55), (95, 90, 50)], (20, 0, 0))
    p.point_at('Right', target)
    p.thumb_onto('Right', 'Middle')
    p.rot('Neck', 'Y', -10); p.rot('Head', 'Y', -20); p.rot('Head', 'X', 4)


def pose_present(p):
    """Left hand presents palm-up to her front-left (toward the hologram), fingers softly open."""
    p.reset()
    p.rot('Spine1', 'Y', 5); p.rot('Spine2', 'Y', 6)
    p.ik('LeftArm', 'LeftForeArm', Vector((0.36, -0.33, 1.10)), (0.6, 0.35, -1.0))
    p.twist_to([('LeftForeArm', 0.75), ('LeftHand', 0.25)], 'LeftHand', (0.0, 0.0, 1.0))
    p.rot('LeftHand', 'X', -8)
    p.fingers('Left', RELAX, (-8, 6, 6), spread=4)
    p.rot('Neck', 'Y', 10); p.rot('Head', 'Y', 22); p.rot('Head', 'X', 10)


def pose_head(p):
    """Head turn toward her left plus a tilt."""
    p.reset()
    p.rot('Neck', 'Y', 14); p.rot('Head', 'Y', 26); p.rot('Head', 'Z', -12); p.rot('Head', 'X', 6)
    p.rot('Jaw', 'X', 10)


def pose_ref4(p):
    """The Scan mockup pose: leaning in, left hand palm-up toward the hologram, right hand on the pedestal rim,
    head turned and tilted toward the hologram."""
    p.reset()
    for b, x, y in (('Spine', 4, 5), ('Spine1', 5, 6), ('Spine2', 4, 5)):
        p.rot(b, 'X', x); p.rot(b, 'Y', y)
    p.rot('LeftUpLeg', 'X', -3); p.rot('RightUpLeg', 'X', -3)
    p.ik('LeftArm', 'LeftForeArm', Vector((0.40, -0.40, 1.12)), (0.7, 0.3, -1.0))
    p.twist_to([('LeftForeArm', 0.75), ('LeftHand', 0.25)], 'LeftHand', (0.0, 0.0, 1.0))
    p.rot('LeftHand', 'X', -8)
    p.fingers('Left', RELAX, (-8, 6, 6), spread=4)
    p.ik('RightArm', 'RightForeArm', Vector((0.03, -0.36, 0.97)), (-0.8, 0.5, -0.4))
    p.twist_to([('RightForeArm', 0.75), ('RightHand', 0.25)], 'RightHand', (0.0, 0.0, -1.0))
    p.aim('RightHand', (0.25, -0.75, -0.35))
    p.fingers('Right', [(8, 6, 3), (8, 6, 3), (9, 7, 3), (10, 8, 4)], (0, 4, 4))
    p.rot('Neck', 'Y', 10); p.rot('Head', 'Y', 20); p.rot('Head', 'Z', -8); p.rot('Head', 'X', 6)


def pose_fist(p):
    p.reset()
    p.ik('RightArm', 'RightForeArm', Vector((-0.30, -0.35, 1.15)), (-0.6, 0.4, -1.0))
    p.twist_to([('RightForeArm', 0.7), ('RightHand', 0.3)], 'RightHand', (0.6, 0.0, -0.8))
    p.fingers('Right', [(85, 100, 60), (90, 100, 60), (95, 100, 60), (100, 95, 55)], (25, 0, 0))
    p.thumb_onto('Right', 'Index')


def pose_elbow(p):
    p.reset()
    p.rot('RightArm', 'X', 45)
    p.rot('RightForeArm', 'X', 125)
    p.rot('RightHand', 'X', 50)
    p.rot('LeftArm', 'X', 30)
    p.rot('LeftForeArm', 'X', 90)
    p.rot('LeftHand', 'X', -45)


def pose_overhead(p):
    p.reset()
    for side, sx in (('Left', 1.0), ('Right', -1.0)):
        p.aim(side + 'Shoulder', (sx * 0.94, 0.0, 0.34))
        p.aim(side + 'Arm', (sx * 0.30, -0.10, 0.95))
        p.aim(side + 'ForeArm', (sx * 0.05, -0.05, 1.0))


def pose_legs(p):
    p.reset()
    p.rot('LeftUpLeg', 'X', 75)
    p.rot('LeftLeg', 'X', -95)
    p.rot('LeftFoot', 'X', -15)
    p.rot('RightUpLeg', 'X', -10)
    p.rot('Spine', 'X', -3)


# ============================================================================ rendering
def setup_render(scene, res):
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'OBJECT'
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_shadows = False           # Workbench stencil shadows streak across a smooth low-poly body
    scene.display.render_aa = '8'
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('bg')
    world.color = (0.045, 0.036, 0.040)
    scene.world = world


def add_floor():
    me = bpy.data.meshes.new('floor')
    s = 4.0
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new('floor', me)
    ob.color = (0.16, 0.13, 0.14, 1.0)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def make_camera():
    cd = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cd.clip_start = 0.02
    txt = bpy.data.curves.new('label', 'FONT')
    lab = bpy.data.objects.new('label', txt)
    bpy.context.scene.collection.objects.link(lab)
    lab.parent = cam
    lab.color = (1.0, 1.0, 1.0, 1.0)
    txt.align_x = 'LEFT'
    return cam, lab


def shoot(cam, lab, loc, target, lens, text, path):
    scene = bpy.context.scene
    cam.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    bpy.context.view_layer.update()
    fr = cam.data.view_frame(scene=scene)       # tr, br, bl, tl at depth |z|
    depth = 0.10
    k = depth / abs(fr[0].z)
    tl = fr[3] * k
    height = (fr[0].y - fr[1].y) * k
    lab.data.body = text
    lab.data.size = height * 0.030
    lab.location = (tl.x + height * 0.03, tl.y - height * 0.055, -depth)
    lab.rotation_euler = (0, 0, 0)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def compose_sheet(paths, cols, tile, out):
    tw, th = tile
    rows = (len(paths) + cols - 1) // cols
    W, H = cols * tw, rows * th
    sheet = np.zeros((H, W, 4), np.float32)
    sheet[..., 3] = 1.0
    for i, pth in enumerate(paths):
        img = bpy.data.images.load(pth)
        a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
        img.pixels.foreach_get(a)
        a = a.reshape(img.size[1], img.size[0], 4)
        r, c = divmod(i, cols)
        y0 = H - (r + 1) * th                      # bpy images are bottom-up
        sheet[y0:y0 + th, c * tw:(c + 1) * tw] = a[:th, :tw]
        bpy.data.images.remove(img)
    im = bpy.data.images.new('sheet', W, H, alpha=False)
    im.pixels.foreach_set(sheet.ravel())
    im.filepath_raw = out
    im.file_format = 'PNG'
    im.save()


def orbit(target, dist, az_deg, el_deg):
    az, el = math.radians(az_deg), math.radians(el_deg)
    t = Vector(target)
    return t + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist


def render_sheet(arm, body, out_dir):
    scene = bpy.context.scene
    tile = (480, 640)
    setup_render(scene, tile)
    add_floor()
    body.color = (*P['color_srgb'], 1.0)
    cam, lab = make_camera()
    tiles = os.path.join(out_dir, 'tiles')
    os.makedirs(tiles, exist_ok=True)
    p = Poser(arm)
    shots = []

    def shot(name, text, pose, target, dist, az, el, lens=50, target_fn=None, loc_fn=None):
        pose(p) if pose else p.reset()
        tgt = target_fn(p) if target_fn else Vector(target)
        path = os.path.join(tiles, '%02d_%s.png' % (len(shots), name))
        loc = loc_fn(p, tgt) if loc_fn else orbit(tgt, dist, az, el)
        shoot(cam, lab, loc, tgt, lens, text, path)
        shots.append(path)

    full = (0, 0, 0.86)
    shot('rest_front', 'rest A-pose - front', None, full, 3.0, 0, 2)
    shot('rest_34', 'rest - 3/4 (her left)', None, full, 3.0, 45, 4)
    shot('rest_side', 'rest - side (her left)', None, full, 3.0, 90, 2)
    shot('rest_back', 'rest - back', None, full, 3.0, 180, 2)
    shot('reach', 'reach fwd-right, chest height', pose_reach, full, 3.0, -35, 6)
    shot('point', 'point (RightIndexTip)', pose_point, full, 3.0, -30, 6)
    shot('present', 'palm-up present (left)', pose_present, full, 3.0, 35, 6)
    shot('head', 'head turn + tilt, jaw 10deg', pose_head, None, 0.9, 20, 5, 60,
         target_fn=lambda p: p.head('Head') + Vector((0, 0, 0.02)))
    shot('reach_shoulder', 'reach: shoulder/elbow close', pose_reach, None, 0.95, -75, 25, 50,
         target_fn=lambda p: p.head('RightForeArm'))
    # side-on to the pointing ray so the straight index reads in profile
    shot('point_hand', 'point: hand close (side-on)', pose_point, None, 0, 0, 0, 60,
         target_fn=lambda p: p.head('RightIndex2'),
         loc_fn=lambda p, t: t + (p.axis('RightIndexTip', 'Y').cross(Vector((0, 0, 1))).normalized() * -0.40
                                  + Vector((0, 0, 0.12))))
    shot('present_hand', 'palm-up: hand close', pose_present, None, 0.45, 15, 40, 60,
         target_fn=lambda p: p.head('LeftMiddle1'))
    shot('ref4', 'ref4: lean in + present + rim', pose_ref4, (0.05, 0, 1.10), 2.3, -25, 8, 50)
    shot('fist', 'stress: fist', pose_fist, None, 0.42, -20, 15, 60,
         target_fn=lambda p: p.head('RightMiddle1'))
    shot('elbow', 'stress: elbow 125 / wrist 50', pose_elbow, (0, 0, 1.15), 1.9, -40, 8, 50)
    shot('overhead', 'stress: arms overhead', pose_overhead, (0, 0, 1.0), 3.3, 0, 4, 50)
    shot('legs', 'stress: hip 75 / knee 95', pose_legs, full, 3.0, 60, 6, 50)
    p.reset()
    sheet = os.path.join(out_dir, 'mannequin_sheet.png')
    compose_sheet(shots, 4, tile, sheet)
    return sheet, shots


def render_shape(obj, out_dir):
    scene = bpy.context.scene
    setup_render(scene, (560, 760))
    add_floor()
    obj.color = (*P['color_srgb'], 1.0)
    cam, lab = make_camera()
    out = []
    J = joint_table()
    hc = Vector(J['LeftHand'] + 0.07 * J['Left_u'])
    views = [('front', orbit((0, 0, 0.86), 3.0, 0, 2), (0, 0, 0.86), 50),
             ('34', orbit((0, 0, 0.86), 3.0, 40, 5), (0, 0, 0.86), 50),
             ('side', orbit((0, 0, 0.86), 3.0, 90, 2), (0, 0, 0.86), 50),
             ('back', orbit((0, 0, 0.86), 3.0, 180, 2), (0, 0, 0.86), 50),
             ('hand', hc + Vector((0.05, -0.12, 0.30)), hc, 50),
             ('palm', hc + Vector(J['Left_n']) * 0.33 + Vector((0, -0.08, 0)), hc, 50),
             ('head', orbit((0, 0, 1.40), 0.9, 30, 5), (0, 0, 1.40), 50),
             ('hips', orbit((0, 0, 0.85), 1.1, -30, 5), (0, 0, 0.85), 50)]
    for name, loc, tgt, lens in views:
        pth = os.path.join(out_dir, 'shape_%s.png' % name)
        shoot(cam, lab, Vector(loc), Vector(tgt), lens, name, pth)
        out.append(pth)
    return out


# ============================================================================ main
def main():
    a = parse_args()
    out = os.path.abspath(a['out'])
    os.makedirs(out, exist_ok=True)
    reset_scene()
    J = joint_table()
    root = build_sdf(J)
    pts, quads = polygonize(root)
    obj = make_mesh('Mannequin', pts, quads)
    del pts, quads
    parts = clean_mesh(obj)
    log('connected parts before cleanup: %d' % parts)
    tris, folds = decimate(obj, P['tris'], root)
    st = mesh_stats(obj)
    st['folds_found_fixed_left'] = list(folds)
    log('decimated:', st)
    if a['stage'] == 'mesh':
        render_shape(obj, out)
        log('shape renders in', out)
        return
    obj.data.materials.append(make_material())
    arm = build_armature(J)
    wrep = bind(obj, arm)
    log('weights:', wrep)
    if a['save_blend']:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a['save_blend']))
    size = export_glb(obj, arm, a['glb'])
    log('exported %s (%d bytes)' % (a['glb'], size))
    rep, table = glb_report(a['glb'], arm)
    with open(os.path.join(out, 'rig_table.md'), 'w') as f:
        f.write(rig_table_md(table))
    report = dict(source_mesh=st, weights=wrep, glb=rep)

    # ---------------------------------------------------------------- validation on the RE-IMPORTED file
    reset_scene()
    try:
        bpy.ops.import_scene.gltf(filepath=a['glb'], bone_heuristic='BLENDER', disable_bone_shape=True)
    except TypeError:
        bpy.ops.import_scene.gltf(filepath=a['glb'], bone_heuristic='BLENDER')
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.find_armature() is not None]
    assert len(arms) == 1 and len(meshes) == 1, (arms, meshes)
    iarm, ibody = arms[0], meshes[0]
    expected = [b[0] for b in bone_specs(J)]
    got = [b.name for b in iarm.data.bones]
    missing = sorted(set(expected) - set(got))
    extra = sorted(set(got) - set(expected))
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ibody.evaluated_get(dg)
    co = np.array([ibody.matrix_world @ v.co for v in ev.data.vertices])
    wsum = np.zeros(len(ibody.data.vertices)); ninf = np.zeros(len(ibody.data.vertices), int)
    for v in ibody.data.vertices:
        ws = [g.weight for g in v.groups if g.weight > 0]
        wsum[v.index] = sum(ws); ninf[v.index] = len(ws)
    frames = {}
    for nm in ('LeftArm', 'LeftForeArm', 'LeftHand', 'LeftIndex1', 'Head', 'LeftUpLeg'):
        bi = iarm.data.bones[nm]
        frames[nm] = [[round(x, 3) for x in bi.matrix_local.to_3x3().col[c]] for c in range(3)]
    report['reimport'] = dict(
        bones=len(got), missing=missing, extra=extra,
        height_m=round(float(co[:, 2].max() - co[:, 2].min()), 4),
        min_z=round(float(co[:, 2].min()), 4),
        faces=len(ibody.data.polygons), verts=len(ibody.data.vertices),
        weight_sum_min=round(float(wsum.min()), 4), weight_sum_max=round(float(wsum.max()), 4),
        max_influences=int(ninf.max()), unweighted=int((ninf == 0).sum()),
        materials=[m.name for m in ibody.data.materials],
        bone_axes_blender_space=frames,
        armature_matrix_world=[list(r) for r in iarm.matrix_world])
    log('reimport:', json.dumps(report['reimport']))
    if a['sheet']:
        sheet, shots = render_sheet(iarm, ibody, out)
        report['sheet'] = sheet
        log('sheet:', sheet)
    with open(os.path.join(out, 'validate.json'), 'w') as f:
        json.dump(report, f, indent=1)
    log('done')


if __name__ == '__main__':
    main()
