"""Evia's hair: a procedural, web-friendly HAIR-CARD system (Blender 4.5, no add-ons, no downloads).

WHY
  None of the 34 MakeHuman/MPFB hair assets on disk is Evia's hair (long, dark brown, loose waves past the
  shoulders) and all of them read as flat shells. This module grows her hair from scratch, deterministically:

  1. ROOTS    Poisson-disc samples on the base mesh's `scalp` vertex group (per layer, seeded).
  2. GROOM    Each root becomes a strand by a single-pass "follow the leader" chain: a comb field (away from a
              side part, radial below the crown) + stiffness + gravity; the chain hugs the skull at a
              per-layer height while the offset surface faces up, then falls, colliding with the body AND the
              garments (BVH, nearest-surface push-out). Front / back locks get a small bias at shoulder height
              so some hair falls in front of the shoulders (framing the face, as in the Scan mockup) and the
              rest down the back. A keep-out zone stops strands crossing the eyes.
              Strands steer sideways before reaching a keep-out box around the eyes / cheeks (no zig-zags).
              Below the skull a strand's card normal is the HAIR-VOLUME normal (radial from the head centre /
              a head-to-chest axis), leaning toward the collider's normal only where the hair rests on it.
  3. WAVES    Strands are grouped into LOCKS by where they are when the waves start (about the ear lobes);
              each lock gets one loose, mostly planar S-wave (amplitude growing toward the tips) and its
              members converge on the lock's guide strand toward the tips; then collision + smoothing again.
  4. CARDS    Every strand becomes a tapered ribbon (U along the strand, V across) lying flat on the hair
              volume, with a little twist. Layers: base (wide, dense, darker), mid, top, wisps.
              Custom split normals point OUT of the hair volume (soft, volumetric shading, no flat-card look).
              Vertex colour `hair_ao` darkens inner layers and roots.
  5. TEXTURE  A 2048x2048 RGBA atlas of 8 horizontal strips (dense / medium / wispy locks) painted strand by
              strand in numpy: each lock = 2-6 sub-clumps with their own path and length, full at the root and
              pinching to points (gaps and split tips), thousands of anti-aliased hairs, root-to-tip colour,
              per-hair lightness, stray hairs; sRGB PNG with bled colour under zero alpha (clean mip-maps).
              Plus a tangent-space strand normal map.
  6. SKIN     Weights: Head near the skull, blending to Neck and Spine2 where hair rests on the shoulders,
              back and chest, so head turns bend the hair at the neck instead of cutting through the body.

OUTPUT
  One mesh object (default name "Evia.hair") parented to the rig with an Armature modifier, one material
  (`EviaHair`, Principled + image + vertex colour), and the atlas PNG written to `texture_path`.

USE (from evia_build.py)
  import evia_hair
  hair = evia_hair.build(body, rig, colliders=[coat, top], texture_path=".../evia_hair_atlas.png")
  All tunables live in DEFAULTS; pass overrides as keyword args (hair = build(..., length_back=0.6)).
  Coordinates: MPFB Blender space - Z up, metres, character faces -Y, her left is +X.
"""

import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

DEFAULTS = {
    "seed": 11,
    "exclude_arms": False,      # True only if grooming in the rig's A-pose rest (arms up)
    # groom
    "part_x": 0.028,            # side part on HER LEFT (+X), metres from the midline
    "part_front_pad": 0.012,    # part starts this far behind the front hairline
    "crown_back": 0.075,        # crown whorl this far behind the part start (along +Y)
    "seg": 0.016,               # chain segment length (m)
    "stiffness": 1.0,
    "gravity": 0.16,
    "gravity_free": 0.60,
    "comb_weight": 0.9,
    "comb_len": 0.10,           # arc length over which the comb field fades out
    "root_lift": 0.35,          # volume at the roots (lift along the scalp normal)
    "front_bias": 0.32,         # pull toward front / back at shoulder height
    "front_lane_x": 0.105,      # front locks drape over the collarbone at |x| ~ this (inside the shoulder)
    "back_lane_x": 0.07,        # back hair falls in a lane this wide either side of the spine (i011: .10 left a gap)
    "lane_pull": 0.8,
    "x_limit": 0.165,           # |x| cap below the shoulders (inside the upper arms)
    "front_split_right": 0.005, # roots in front of y = ear_y + this go to the FRONT (her right, the heavy side)
    "front_split_left": -0.012, # same on her left
    "front_min_abs_x": 0.035,   # roots nearer the midline than this always go back
    "shoulder_dz": -0.055,      # front/back bias starts this far below the Head joint (skull base)
    # i010: shorter - ref4 hair ends around the bust in front and a little lower down the back (was 0.64/0.58/0.50,
    # which reached her waist in the full-body renders)
    "length_back": 0.56,        # arc length of a strand from the crown / back of the head
    "length_side": 0.52,
    "length_front": 0.44,       # face-framing strands from the front hairline
    "length_jitter": 0.07,
    # waves - i010: waves are shared by LOCKS (strands that are close at the height where the waves start), not
    # by root position: roots far apart end up side by side after falling, and different phases there read as
    # crimped / frizzy hair
    "wave_amp": 0.017,
    "wave_len": 0.125,
    "wave_depth": 0.22,         # fraction of the wave in/out of the hair surface (i011: .50 twisted locks into ropes)
    "wave_start_dz": 0.0,       # waves begin below the Head joint + this (about cheekbone / ear-lobe level)
    "wave_ramp": 0.07,
    "lock_radius": 0.017,       # strands within this distance at the wave start form one lock (one wave phase)
    "lock_pull": 0.42,          # members converge on the lock's guide strand toward the tips (0 = no clumping)
    "lock_pull_len": 0.16,      # arc length below the wave start over which the pull ramps in
    "phase_jitter": 0.10,
    "side_volume": 0.008,       # extra lift of the hair above the skull away from the crown (flat top, fuller sides)
    # i016 (critics: "no crown lift", "helmet"): extra hug height near the top of the head only (fades out
    # above the ears, so side locks are not pushed across the cheeks as in i012)
    "crown_lift": 0.011,
    # i016 (from lookdev2's h1 test): hair passes OUTSIDE a smooth dome over each ear (lateral, y, z radii) -
    # hugging the ear itself drew concentric ear-shaped outlines in the side hair
    "ear_dome": (0.016, 0.036, 0.034),
    "hairline_count": 70,
    # i016: the hairline cards at the temples start a little OUT on the skin (the visible hairline read high and
    # bare) and are longer, so they lie over the temple corners and blend into the side hair
    "temple_outset": 0.006,
    "temple_len": (0.08, 0.15),
    # i016: crown = many NARROW cards from medium strips (was 110 x 24 mm dense = "a few big shells")
    "crown_count": 190,
    "crown_width": 0.013,
    "crown_radius": 0.055,
    # i016: short density cards along both sides of the part (pale scalp read through as a bald streak)
    "part_count": 70,
    "part_width": 0.010,
    # card side fade in the atlas (fraction of the strip height on each side) - soft card edges, no stair steps
    "edge_fade": 0.16,
    "ao_min": 0.72,             # i016: inner layers were 0.50 AO -> near-black hair on the web
    # card orientation below the skull: cards lie on the HAIR VOLUME (facing out from the head / body axis), with
    # a little of the nearest collider's normal where the hair rests on it (i009 used the collider normal only:
    # cards hanging beside the neck turned edge-on / flat and read as shredded strips)
    "contact_normal": 0.6,
    # cards
    "layers": [
        # name,    count, width, h_head, h_body, strips,          ao,   len_scale
        # a little more volume above the skull than i011 (.0035/.0075/.0115/.0145 read as a flat helmet from the
        # front; i012's .005/.0105/.016/.020 + side_volume .012 pushed side strands across the cheeks)
        # i016: top layer narrower + more cards (breaks the one smooth glossy highlight), inner layers lighter AO
        ("base",   140, 0.036, 0.0045, 0.005, (0, 1, 2),         0.74, 0.93),
        ("mid",    250, 0.024, 0.0095, 0.011, (1, 2, 3, 4),      0.86, 0.98),
        ("top",    430, 0.013, 0.0145, 0.017, (3, 4, 5, 6),      1.00, 1.00),
        ("wisp",    18, 0.007, 0.0160, 0.021, (5, 6),            1.00, 0.90),   # strip 7 read as doodle lines
    ],
    "twist_deg": 3.0,
    "tip_taper": 0.22,
    "normal_blend": 0.80,       # 0 = card normals, 1 = hair-volume normals (smooth, no shingles)
    # texture - i016: lifted ~1.6x (critics: the atlas averaged sRGB (39,25,16) and read BLACK on the web);
    # still dark chocolate, with more warm chestnut strands and per-card tone variation (vertex colour)
    "tex_size": 2048,
    "strips": 8,
    # (first i016 render at x1.6 read auburn under the rose key -> x1.25 and a little less red)
    "color_root": (0.012, 0.0063, 0.0037),  # linear RGB - dark chocolate roots
    "color_mid": (0.021, 0.0112, 0.0066),   # ~ sRGB (40, 27, 19)
    "color_tip": (0.026, 0.0138, 0.0080),   # ends only slightly lighter (no ombre)
    "color_hi": (0.058, 0.031, 0.0165),     # warm chestnut strands
    "hi_fraction": 0.18,
    "card_tone_jitter": 0.14,               # per-card brightness variation (breaks up the shell)
    # shading
    "roughness": 0.58,
    "specular": 0.13,
    "normal_map_strength": 0.45,
}

HEAD_BONE = "mixamorig:Head"
NECK_BONE = "mixamorig:Neck"
CHEST_BONE = "mixamorig:Spine2"


# ----------------------------------------------------------------------------------------------- helpers

def _smoothstep(a, b, x):
    if b == a:
        return 1.0 if x >= b else 0.0
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3.0 - 2.0 * t)


ARM_KEYS = ("Arm", "Hand", "Thumb", "Index", "Middle", "Ring", "Pinky", "upperarm", "lowerarm", "hand")


def _evaluated_world_mesh(obj, exclude_arms=False, arm_limit=0.3):
    """World-space verts / polys of the evaluated mesh. exclude_arms drops polygons skinned to the arm bones
    (>arm_limit): the rig's A-pose arms must not shape the hair, which is groomed for arms-down display."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    mw = obj.matrix_world
    verts = [mw @ v.co for v in mesh.vertices]
    armw = None
    if exclude_arms:
        arm_groups = {g.index for g in obj.vertex_groups
                      if any(k in g.name for k in ARM_KEYS) and "Shoulder" not in g.name and "clavicle" not in g.name}
        armw = [sum(g.weight for g in v.groups if g.group in arm_groups) for v in mesh.vertices]
    polys = []
    for p in mesh.polygons:
        if armw is not None and max(armw[i] for i in p.vertices) > arm_limit:
            continue
        polys.append(tuple(p.vertices))
    ev.to_mesh_clear()
    return verts, polys


def collision_bvh(objects, exclude_arms=False):
    verts, polys = [], []
    for obj in objects:
        v, p = _evaluated_world_mesh(obj, exclude_arms)
        base = len(verts)
        verts.extend(v)
        polys.extend(tuple(i + base for i in poly) for poly in p)
    return BVHTree.FromPolygons(verts, polys, all_triangles=False)


def scalp_triangles(body, group="scalp"):
    """World-space triangles of the (evaluated, shape-keyed) base mesh whose 3 corners are in `group`."""
    gi = body.vertex_groups[group].index
    member = set()
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == gi and g.weight > 0.5:
                member.add(v.index)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(depsgraph)
    # evaluate shape keys but not masks: use the shape-key mix of the original topology
    mesh = ev.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    mw = body.matrix_world
    tris = []
    if len(mesh.vertices) == len(body.data.vertices):
        co = [mw @ v.co for v in mesh.vertices]
    else:  # masks changed topology: fall back to the shape-key mix on the original mesh
        co = [mw @ v.co for v in body.data.vertices]
        keys = body.data.shape_keys
        if keys:
            basis = keys.reference_key
            co = [c.copy() for c in co]
            for kb in keys.key_blocks:
                if kb == basis or kb.value == 0.0 or kb.mute:
                    continue
                for i, d in enumerate(kb.data):
                    co[i] += (mw.to_3x3() @ (d.co - basis.data[i].co)) * kb.value
    ev.to_mesh_clear()
    for poly in body.data.polygons:
        vs = list(poly.vertices)
        if all(i in member for i in vs):
            for k in range(1, len(vs) - 1):
                tris.append((co[vs[0]], co[vs[k]], co[vs[k + 1]]))
    return tris


def poisson_on_triangles(tris, count, rng, min_dist=None, candidates=30):
    """Area-weighted samples with best-candidate (Mitchell) blue-noise selection."""
    areas = [((b - a).cross(c - a)).length * 0.5 for a, b, c in tris]
    total = sum(areas)
    cum = np.cumsum(areas) / total

    def one():
        i = int(np.searchsorted(cum, rng.random()))
        i = min(i, len(tris) - 1)
        a, b, c = tris[i]
        r1, r2 = rng.random(), rng.random()
        if r1 + r2 > 1.0:
            r1, r2 = 1.0 - r1, 1.0 - r2
        p = a + (b - a) * r1 + (c - a) * r2
        n = (b - a).cross(c - a).normalized()
        return p, n

    pts = []
    arr = np.zeros((0, 3))
    for _ in range(count):
        best, best_d = None, -1.0
        for _ in range(candidates if len(pts) else 1):
            p, n = one()
            if len(pts):
                d = float(np.min(np.sum((arr - np.array(p)) ** 2, axis=1)))
            else:
                d = 1.0
            if d > best_d:
                best, best_d = (p, n), d
        pts.append(best)
        arr = np.vstack([arr, np.array(best[0])[None, :]])
    return pts


class HeadFrame:
    """Landmarks measured from the scalp + rig: hairline, part, crown, ears."""

    def __init__(self, tris, rig, P):
        pts = np.array([[*a] for t in tris for a in t])
        self.xmin, self.ymin, self.zmin = pts.min(axis=0)
        self.xmax, self.ymax, self.zmax = pts.max(axis=0)
        head = rig.pose.bones[HEAD_BONE] if rig else None
        mw = rig.matrix_world if rig else None
        self.head_base = (mw @ head.head) if head else Vector((0, -0.04, 1.47))
        # front hairline (min y) near the top, crown behind the top
        top = pts[np.argmax(pts[:, 2])]
        self.top = Vector(top)
        self.center = Vector((0.0, float(top[1]) + 0.005, float(top[2]) - 0.095))
        front_pts = pts[pts[:, 1] < self.ymin + 0.012]
        fz = float(np.median(front_pts[:, 2])) if len(front_pts) else float(top[2]) - 0.03
        self.part_a = Vector((P["part_x"], float(self.ymin) + P["part_front_pad"], fz + 0.01))
        self.part_b = Vector((P["part_x"] * 0.55, float(top[1]) + P["crown_back"], float(top[2]) - 0.01))
        self.ear_y = float(self.head_base.y) + 0.005   # coronal plane through the ears (approx.)
        self.ear_z = float(self.head_base.z) + 0.04
        chest = rig.pose.bones.get(CHEST_BONE) if rig else None
        self.chest_y = float((mw @ chest.head).y) if chest else float(self.head_base.y) + 0.01
        self.chest_z = float((mw @ chest.head).z) if chest else float(self.head_base.z) - 0.25

    def volume_normal(self, p):
        """Outward normal of the hair volume at p: radial from the head centre around the skull, radial from a
        vertical body axis (head centre -> chest) below it. Hair cards should lie on this surface."""
        if p.z >= self.center.z - 0.03:
            n = p - self.center
        else:
            k = _smoothstep(self.chest_z, self.center.z - 0.03, p.z)
            ay = self.chest_y + (self.center.y - self.chest_y) * k
            n = Vector((p.x, p.y - ay, 0.0))
        if n.length < 1e-6:
            return Vector((0.0, -1.0, 0.0))
        return n.normalized()


def closest_on_segment(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return a + ab * t, t


# ----------------------------------------------------------------------------------------------- groom

def comb_dir(p, n, H, P):
    c, t = closest_on_segment(p, H.part_a, H.part_b)
    v = p - c
    if t >= 1.0:                                   # behind the crown: radial from the whorl
        v = p - H.part_b
    if t <= 0.0:                                   # in front of the part start: sweep back a little
        v = v + Vector((0.0, 0.6, 0.0)) * v.length
    v = v + Vector((0.0, 0.0, -0.25)) * max(v.length, 0.01)
    v = v - n * v.dot(n)
    if v.length < 1e-6:
        v = Vector((0.0, 1.0, -1.0))
        v = v - n * v.dot(n)
    return v.normalized()


def strand_group(root, H, P):
    """'front' strands fall in front of the shoulders, 'back' strands down the back."""
    if abs(root.x) < P["front_min_abs_x"]:
        return "back"
    split = H.ear_y + (P["front_split_right"] if root.x < 0 else P["front_split_left"])
    return "front" if root.y < split else "back"


def strand_length(root, H, P, rng, scale):
    # front hairline -> length_front, back of the head -> length_back, sides in between
    fy = _smoothstep(H.ymin, H.ymin + 0.07, root.y)          # 0 at the front hairline
    by = _smoothstep(H.ear_y, H.ymax, root.y)                # 1 at the back
    L = P["length_front"] + (P["length_side"] - P["length_front"]) * fy
    L = L + (P["length_back"] - L) * by
    L *= scale * (1.0 + P["length_jitter"] * (rng.random() * 2.0 - 1.0))
    return L


def ear_domes(body, P):
    """Centres of the two ears (vertex group `ears`), a little inside the ear's outer surface (lookdev2 h1)."""
    import evia_skin
    if "ears" not in body.vertex_groups or not P.get("ear_dome"):
        return []
    co = evia_skin.shaped_coords(body)
    w = evia_skin.group_weights(body, "ears")
    mw = body.matrix_world
    out = []
    for side in (1.0, -1.0):
        m = (w > 0.5) & (co[:, 0] * side > 0)
        if m.sum() < 10:
            continue
        pts = co[m]
        c = pts.mean(axis=0)
        c[0] = pts[:, 0].max() if side > 0 else pts[:, 0].min()     # outer surface of the ear
        c[0] -= side * P["ear_dome"][0] * 0.55                      # dome centre a little inside it
        out.append((mw @ Vector(c), side))
    return out


def push_out_of_domes(p, domes, P, h):
    rx, ry, rz = P["ear_dome"]
    for c, side in domes:
        d = p - c
        q = (d.x / (rx + h)) ** 2 + (d.y / (ry + h)) ** 2 + (d.z / (rz + h)) ** 2
        if q < 1.0 and d.x * side > -rx:
            k = 1.0 / math.sqrt(max(q, 1e-6))
            p = c + Vector((d.x * k, d.y * k, d.z * k))
    return p


def grow(root, n0, H, P, bvh, head_bvh, h_head, h_body, L, group, rng, domes=()):
    seg = P["seg"]
    pts = [root + n0 * h_head * 0.35]
    nrm = [n0.copy()]
    hug = []
    d = (comb_dir(root, n0, H, P) + n0 * P["root_lift"]).normalized()
    s = 0.0
    hugging = True
    g = Vector((0.0, 0.0, -1.0))
    side = 1.0 if root.x >= 0 else -1.0
    lane_side = None
    while s < L:
        p0 = pts[-1]
        comb_w = P["comb_weight"] * max(0.0, 1.0 - s / P["comb_len"])
        loc, sn, _i, _dist = head_bvh.find_nearest(p0)
        sn = sn if sn is not None else nrm[-1]
        # hair is limp: once it has left the skull, gravity wins within a couple of segments (otherwise a
        # strand deflected by the shoulder keeps travelling sideways and the hair "flares")
        want = d * P["stiffness"] + g * (P["gravity"] if hugging else P["gravity_free"])
        if comb_w > 0.0:
            want += comb_dir(p0, sn, H, P) * comb_w
        sz = H.head_base.z + P["shoulder_dz"]
        if p0.z < sz:
            if lane_side is None:          # decide the side where the strand actually is (not where it grew)
                lane_side = 1.0 if p0.x >= 0 else -1.0
            side = lane_side
            fb = -1.0 if group == "front" else 1.0
            k = P["front_bias"] * _smoothstep(sz, sz - 0.08, p0.z)
            # drape over the collarbone / down the back: steer toward a lateral lane inside the shoulder
            lane = P["front_lane_x"] if group == "front" else P["back_lane_x"]
            lat = max(-1.0, min(1.0, (side * lane - p0.x) / 0.05))
            near = _smoothstep(sz - 0.28, sz - 0.12, p0.z)     # steer over the shoulder, then let it hang
            want += Vector((lat * P["lane_pull"] * near, fb * (0.35 + 0.65 * near), 0.0)) * k
        # steer away from the face BEFORE reaching the keep-out box (the hard clamp alone made zig-zag kinks in
        # strands that grazed the cheek - i012 portrait)
        if abs(p0.x) < 0.095 and p0.y < H.ear_y - 0.03 and H.head_base.z - 0.11 < p0.z < H.head_base.z + 0.11:
            sx = 1.0 if p0.x >= 0 else -1.0
            want += Vector((sx * 1.5 * _smoothstep(0.095, 0.07, abs(p0.x)), 0.0, 0.0))
        want.normalize()
        p = p0 + want * seg
        # below the shoulder line hair falls in front of or behind the shoulder, never down the outside of
        # the upper arm (it would slide off the deltoid and float beside the arm)
        if p.z < H.head_base.z + P["shoulder_dz"] - 0.04:
            xl = P["x_limit"]
            p.x = max(-xl, min(xl, p.x))
        # keep-out: never across the eyes / nose
        if -0.07 < p.x < 0.07 and p.y < H.ear_y - 0.045 and H.head_base.z - 0.09 < p.z < H.head_base.z + 0.11:
            p.x = 0.07 * (1.0 if p.x >= 0 else -1.0)
        # hug the skull while its surface faces up/sideways
        loc, hn, _i, _dist = head_bvh.find_nearest(p)
        if hugging and loc is not None:
            if hn.z > -0.12 and p.z > H.ear_z - 0.05:
                lift = P["crown_lift"] * _smoothstep(H.ear_z + 0.03, H.zmax - 0.03, p.z)
                p = loc + hn * (h_head + P["side_volume"] * _smoothstep(0.02, 0.12, s) + lift)
            else:
                hugging = False
        # collide with the ear domes, then body + garments
        if domes:
            p = push_out_of_domes(p, domes, P, h_head if hugging else h_body)
        for _ in range(2):
            loc, cn, _i, dist = bvh.find_nearest(p)
            if loc is None:
                break
            v = p - loc
            h = h_head if hugging else h_body
            if v.dot(cn) < 0.0 or v.length < h:
                p = loc + cn * h
                p = p0 + (p - p0).normalized() * seg
        if hugging or loc is None:
            n_out = cn if loc is not None else nrm[-1]
            if n_out.dot(nrm[-1]) < 0.0:
                n_out = -n_out
        else:
            # free-hanging: lie on the hair volume; where resting on a surface that faces the same way, lean
            # toward that surface's normal
            vol = H.volume_normal(p)
            gap = (p - loc).length
            contact = P["contact_normal"] * (1.0 - _smoothstep(h_body, h_body + 0.02, gap))
            c = cn if cn.dot(vol) >= 0.0 else -cn
            n_out = vol + c * contact if c.dot(vol) > 0.2 else vol
        d = (p - p0).normalized()
        pts.append(p)
        nrm.append(n_out.normalized())
        hug.append(hugging)
        s += seg
    hug.append(hug[-1] if hug else True)
    return pts, nrm, hug


def add_waves(pts, nrm, P, phase, amp, wlen, H):
    """Displace a groomed strand with a loose, mostly in-surface S-wave below wave_start_z."""
    n = len(pts)
    s = [0.0]
    for i in range(1, n):
        s.append(s[-1] + (pts[i] - pts[i - 1]).length)
    s0 = None
    for i in range(n):
        if pts[i].z < H.head_base.z + P["wave_start_dz"]:
            s0 = s[i]
            break
    if s0 is None:
        return pts
    out = [p.copy() for p in pts]
    L = s[-1]
    for i in range(1, n):
        if s[i] <= s0:
            continue
        t = (pts[min(i + 1, n - 1)] - pts[i - 1]).normalized()
        no = nrm[i] - t * nrm[i].dot(t)
        if no.length < 1e-6:
            continue
        no.normalize()
        b = t.cross(no).normalized()
        ramp = _smoothstep(s0, s0 + P["wave_ramp"], s[i])
        grow_tip = 0.65 + 0.35 * (s[i] - s0) / max(L - s0, 1e-6)
        a = amp * ramp * grow_tip
        th = 2.0 * math.pi * (s[i] - s0) / wlen + phase
        out[i] = pts[i] + b * (a * math.cos(th)) + no * (a * P["wave_depth"] * math.sin(th))
    return out


def _arc(pts):
    s = [0.0]
    for i in range(1, len(pts)):
        s.append(s[-1] + (pts[i] - pts[i - 1]).length)
    return s


def _sample(pts, s, x):
    """Point at arc length x on a polyline with cumulative lengths s (clamped at the root, extrapolated past the
    tip along the last segment so a member longer than its guide does not collapse onto the guide's tip)."""
    if x <= 0.0:
        return pts[0].copy()
    if x >= s[-1]:
        d = (pts[-1] - pts[-2]).normalized() if len(pts) > 1 else Vector((0, 0, -1))
        return pts[-1] + d * (x - s[-1])
    j = int(np.searchsorted(s, x))
    j = max(1, min(j, len(pts) - 1))
    t = (x - s[j - 1]) / max(s[j] - s[j - 1], 1e-9)
    return pts[j - 1] + (pts[j] - pts[j - 1]) * t


def lock_waves(strands, H, P, rng):
    """Group strands into LOCKS by where they are when the waves start, give every lock one wave (phase,
    amplitude, wavelength), and pull members toward the lock's guide strand toward the tips (clumping).
    Strands that never reach the wave start (short / hugging) are left alone. Deterministic (seeded rng,
    guides chosen longest-first)."""
    z_ws = H.head_base.z + P["wave_start_dz"]
    start = []
    for st in strands:
        i0 = next((i for i, p in enumerate(st["pts"]) if p.z < z_ws), None)
        start.append(i0)
    idx = [k for k, i0 in enumerate(start) if i0 is not None and len(strands[k]["pts"]) - i0 > 3]
    order = sorted(idx, key=lambda k: (-len(strands[k]["pts"]), k))
    R = P["lock_radius"]
    guides, gpos = [], []
    for k in order:
        p = strands[k]["pts"][start[k]]
        if all((p - q).length > R for q in gpos):
            guides.append(k)
            gpos.append(p)
    garr = np.array([[*q] for q in gpos]) if gpos else np.zeros((0, 3))
    params = {g: (rng.uniform(0, 2 * math.pi), P["wave_amp"] * rng.uniform(0.8, 1.2),
                  P["wave_len"] * rng.uniform(0.88, 1.15)) for g in guides}
    waved = {}
    for g in guides:
        ph, amp, wl = params[g]
        pts = add_waves(strands[g]["pts"], strands[g]["nrm"], P, ph, amp, wl, H)
        waved[g] = (pts, _arc(pts))
    members = {}
    for k in idx:
        p = strands[k]["pts"][start[k]]
        g = guides[int(np.argmin(np.sum((garr - np.array(p)) ** 2, axis=1)))]
        members.setdefault(g, []).append(k)
        if k == g:
            strands[k]["pts"] = waved[g][0]
            continue
        ph, amp, wl = params[g]
        ph += rng.uniform(-P["phase_jitter"], P["phase_jitter"]) * 2 * math.pi
        own = add_waves(strands[k]["pts"], strands[k]["nrm"], P, ph, amp * rng.uniform(0.9, 1.1), wl, H)
        s_own = _arc(own)
        gpts, gs = waved[g]
        g0 = gs[start[g]]
        s0 = s_own[start[k]]
        out = [q.copy() for q in own]
        for i in range(start[k] + 1, len(own)):
            srel = s_own[i] - s0
            f = P["lock_pull"] * _smoothstep(0.0, P["lock_pull_len"], srel)
            if f <= 0.0:
                continue
            gp = _sample(gpts, gs, g0 + srel)
            out[i] = own[i] * (1.0 - f) + gp * f
        strands[k]["pts"] = out
    return {"locks": len(guides), "lock_members_max": max((len(m) for m in members.values()), default=0)}


def hairline_roots(body, H, count, rng, inset=(0.002, 0.007), temple_outset=0.0):
    """Points just inside the scalp group's front / temple boundary (skin-side edge of the hairline)."""
    if count <= 0:
        return []
    import evia_skin
    co = evia_skin.shaped_coords(body)
    w = evia_skin.group_weights(body, "scalp")
    inside = w > 0.5
    e = np.zeros(len(body.data.edges) * 2, dtype=np.int64)
    body.data.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    mw = body.matrix_world
    border = set()
    for a, b in e:
        if inside[a] != inside[b]:
            border.add(a if inside[a] else b)
    pts = [mw @ Vector(co[i]) for i in border]
    pts = [p for p in pts if p.y < H.ear_y + 0.012 and p.z > H.ear_z - 0.03]
    if not pts:
        return []
    head_c = H.center
    out = []
    for _ in range(count):
        p = pts[int(rng.random() * len(pts))].copy()
        n = (p - head_c).normalized()
        # step toward the crown (inside the scalp) along the surface
        toward = (H.top - p)
        toward = (toward - n * toward.dot(n)).normalized()
        # temples / forehead corners (|x| > 3 cm, in front of the ears): start slightly OUT on the skin
        t = _smoothstep(0.025, 0.045, abs(p.x)) * (1.0 if p.y < H.ear_y - 0.01 else 0.0)
        step = rng.uniform(*inset) * (1.0 - t) - temple_outset * t * rng.uniform(0.6, 1.0)
        p = p + toward * step
        out.append((p, n))
    return out


def relax(pts, bvh, h_body, iters=2, keep=3):
    for _ in range(iters):
        new = [p.copy() for p in pts]
        for i in range(keep, len(pts) - 1):
            new[i] = pts[i] * 0.5 + (pts[i - 1] + pts[i + 1]) * 0.25
        pts = new
    for i in range(keep, len(pts)):
        loc, cn, _i, _d = bvh.find_nearest(pts[i])
        if loc is None:
            continue
        v = pts[i] - loc
        if v.dot(cn) < 0.0 or v.length < h_body * 0.8:
            pts[i] = loc + cn * (h_body * 0.8)
    return pts


# ----------------------------------------------------------------------------------------------- texture

def _srgb(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1.0 / 2.4) - 0.055)


def _save_rgba(name, arr, path, colorspace):
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


def paint_atlas(path, P):
    """RGBA atlas + tangent-space normal map: `strips` horizontal locks, U (x) runs root -> tip.

    Each strip is a lock made of 2-6 separate sub-clumps (own path, own length, pinching to a point, gaps
    between them), thousands of 1-px hairs with uneven tips, per-hair lightness, a few chestnut hairs,
    per-clump tone, stray hairs. Alpha is steep with the faint haze cut, so cards do not read as grey film. The normal map tilts across every hair (a cylinder) so light breaks up per strand.
    Returns (albedo_image, normal_image)."""
    size = P["tex_size"]
    strips = P["strips"]
    sh = size // strips
    rng = np.random.default_rng(P["seed"] + 101)
    D = np.zeros(size * size, dtype=np.float64)       # hair density
    C = np.zeros((size * size, 3), dtype=np.float64)  # colour * coverage
    NY = np.zeros(size * size, dtype=np.float64)      # across-hair normal tilt * coverage
    xs = np.arange(size, dtype=np.float64)
    u = xs / (size - 1)
    base_root = np.array(P["color_root"])
    base_mid = np.array(P["color_mid"])
    base_tip = np.array(P["color_tip"])
    hi = np.array(P["color_hi"])
    # strip recipes (atlas v5, i010): every strip is ONE lock built from `nsub` separate sub-clumps. Each
    # sub-clump follows its own gently sinuous path across the lock, is full at the root and pinches to a point
    # at its own end (0.6-1.0 of the length), so gaps open between sub-clumps and the tip splits into several
    # points - v4 filled the whole lock evenly and every card read as one opaque painted stroke.
    # (sub-clumps, hairs per sub-clump, lock half-width at root / tip (fraction of the strip height),
    #  sub-clump sigma in px, stray fraction, short-hair fraction). 0-2 dense (base), 3-5 medium, 6-7 wispy.
    kinds = [(6, 150, 0.40, 0.30, 9.0, 0.03, 0.12), (5, 160, 0.38, 0.28, 9.0, 0.03, 0.15),
             (5, 140, 0.36, 0.26, 8.0, 0.04, 0.18), (4, 130, 0.34, 0.22, 8.0, 0.05, 0.20),
             (4, 115, 0.32, 0.20, 7.0, 0.05, 0.22), (3, 110, 0.30, 0.18, 7.0, 0.06, 0.25),
             (3, 70, 0.26, 0.15, 5.5, 0.10, 0.30), (2, 60, 0.22, 0.12, 4.5, 0.14, 0.35)]

    def col_along(t):
        t = t[:, None]
        return np.where(t < 0.25, base_root + (base_mid - base_root) * (t / 0.25),
                        base_mid + (base_tip - base_mid) * ((t - 0.25) / 0.75))

    grad = col_along(np.clip(u, 0, 1))
    for j in range(strips):
        nsub, per, w_root, w_tip, sig, stray, short = kinds[j % len(kinds)]
        y0 = j * sh
        env = (w_root + (w_tip - w_root) * u ** 1.2) * (sh - 1)          # lock half-width (px) along the strand
        center = 0.5 * (sh - 1) + float(rng.normal(0.0, 0.03)) * (sh - 1) * u
        base_off = np.linspace(-0.72, 0.72, nsub) + rng.normal(0.0, 0.10, nsub)
        hairs = []      # (yy, u0, u1, width, opacity, lightness)
        for k in range(nsub):
            u_end = float(np.clip(1.0 - abs(rng.normal(0.0, 0.14)), 0.6, 1.0))
            drift = float(rng.normal(0.0, 0.10))
            a1, f1, p1 = rng.uniform(0.02, 0.07), rng.uniform(0.5, 1.6), rng.uniform(0, 2 * math.pi)
            cpath = base_off[k] * (1.0 - 0.30 * u) + drift * u + a1 * np.sin(2 * math.pi * f1 * u + p1)
            # wide at the root (neighbouring sub-clumps overlap -> a full root), pinching toward its end
            spread = sig * (0.8 + 0.4 * rng.random()) * (1.7 - 1.55 * np.clip(u / u_end, 0, 1) ** 1.2)
            tone = float(np.exp(rng.normal(0.0, 0.16)))
            for _ in range(per):
                r = float(np.clip(rng.normal(0.0, 1.0), -2.2, 2.2))
                u0 = float(rng.uniform(0.0, 0.04))
                u1 = u_end * (float(rng.uniform(0.40, 0.85)) if rng.random() < short
                              else 1.0 - abs(float(rng.normal(0.0, 0.04))))
                wig = float(rng.uniform(0.2, 0.8)) * np.sin(2 * math.pi * rng.uniform(1.5, 5.0) * u +
                                                            rng.uniform(0, 2 * math.pi))
                yy = center + cpath * env + r * spread + wig
                light = float(np.exp(rng.normal(0.0, 0.20))) * tone * (0.92 + 0.08 * abs(r))
                hairs.append((yy, u0, u1, float(rng.uniform(0.6, 1.0)), float(rng.uniform(0.7, 1.0)), light))
        for _ in range(int(nsub * per * stray)):
            yy = (center + float(rng.uniform(-1.1, 1.1)) * env + float(rng.normal(0.0, 0.08)) * (sh - 1) * u +
                  float(rng.uniform(1.0, 3.0)) * np.sin(2 * math.pi * rng.uniform(0.5, 2.0) * u +
                                                        rng.uniform(0, 2 * math.pi)))
            u1 = float(rng.uniform(0.5, 1.0))
            hairs.append((yy, float(rng.uniform(0.0, 0.1)), u1, float(rng.uniform(0.5, 0.8)),
                          float(rng.uniform(0.45, 0.75)), float(np.exp(rng.normal(0.05, 0.2)))))
        idx_l, w_l, c_l, n_l = [], [], [], []
        for yy, u0, u1, width, opac, light in hairs:
            valid = (u >= u0) & (u <= u1)
            if not valid.any():
                continue
            # soft fade-in at the root (overlapping cards blend into the layer below, no "roof tiles")
            fade = np.clip((u - u0) / 0.045, 0, 1) ** 1.5 * np.clip((u1 - u) / 0.035, 0, 1) ** 0.6
            col = grad * light
            if rng.random() < P["hi_fraction"]:
                col = grad * 0.4 * light + hi * 0.6
            iy = np.floor(yy).astype(np.int64)
            for off in (-1, 0, 1, 2):
                row = iy + off
                d = (row - yy) / width
                w = np.exp(-d ** 2) * fade * opac
                ok = valid & (row >= 0) & (row < sh) & (w > 1e-3)
                idx_l.append(row[ok] * size + xs[ok].astype(np.int64))
                w_l.append(w[ok])
                c_l.append(col[ok] * w[ok][:, None])
                n_l.append(np.clip(d[ok], -1.5, 1.5) * 0.55 * w[ok])
        if not idx_l:
            continue
        idx = np.concatenate(idx_l)
        ww = np.concatenate(w_l)
        cc_ = np.concatenate(c_l)
        nn = np.concatenate(n_l)
        n_px = sh * size
        base = y0 * size
        D[base:base + n_px] += np.bincount(idx, weights=ww, minlength=n_px)
        NY[base:base + n_px] += np.bincount(idx, weights=nn, minlength=n_px)
        for ch in range(3):
            C[base:base + n_px, ch] += np.bincount(idx, weights=cc_[:, ch], minlength=n_px)
    alpha = 1.0 - np.exp(-1.8 * D)
    alpha = np.clip((alpha - 0.05) / 0.95, 0.0, 1.0)            # cut the faint haze
    # i016: soft card SIDES - fade alpha across the strip height near both edges (hard card edges read as
    # stair steps and concentric "ghost" outlines where layers overlap)
    ef = P.get("edge_fade", 0.0)
    if ef > 0:
        vrow = (np.arange(size) % sh) / max(sh - 1, 1)
        win = np.clip(np.minimum(vrow, 1.0 - vrow) / ef, 0.0, 1.0)
        win = win * win * (3.0 - 2.0 * win)
        alpha = alpha * np.repeat(win, size)
    rgb = C / np.maximum(D, 1e-6)[:, None]
    mean = (np.array(P["color_mid"]) + np.array(P["color_tip"])) * 0.5
    blend = np.clip(D / 0.25, 0, 1)[:, None]
    rgb = rgb * blend + mean * (1 - blend)          # bleed colour under empty texels (clean mip-maps)
    albedo = np.zeros((size * size, 4), dtype=np.float32)
    albedo[:, :3] = _srgb(rgb)
    albedo[:, 3] = alpha
    ny = np.clip(NY / np.maximum(D, 1e-6), -0.8, 0.8)
    nz = np.sqrt(1.0 - ny ** 2)
    nrm = np.zeros((size * size, 4), dtype=np.float32)
    nrm[:, 0] = 0.5
    nrm[:, 1] = ny * 0.5 + 0.5
    nrm[:, 2] = nz * 0.5 + 0.5
    nrm[:, 3] = 1.0
    shp = (size, size, 4)
    img = _save_rgba("evia_hair_atlas", albedo.reshape(shp), path, "sRGB")
    npath = path.replace(".png", "_normal.png")
    nimg = _save_rgba("evia_hair_normal", nrm.reshape(shp), npath, "Non-Color")
    return img, nimg


# ----------------------------------------------------------------------------------------------- mesh

def hair_material(img, nimg=None, name="EviaHair", P=None):
    P = P or DEFAULTS
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    ao = nt.nodes.new("ShaderNodeVertexColor")
    ao.layer_name = "hair_ao"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mul.inputs["A"])
    nt.links.new(ao.outputs["Color"], mul.inputs["B"])
    nt.links.new(mul.outputs["Result"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = P["roughness"]
    bsdf.inputs["IOR"].default_value = 1.45
    bsdf.inputs["Specular IOR Level"].default_value = P["specular"]
    bsdf.inputs["Specular Tint"].default_value = (1.0, 0.85, 0.72, 1.0)
    bsdf.inputs["Anisotropic"].default_value = 0.35
    if nimg is not None:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = nimg
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = P["normal_map_strength"]
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    tang = nt.nodes.new("ShaderNodeTangent")
    tang.direction_type = "UV_MAP"
    tang.uv_map = "UVMap"
    nt.links.new(tang.outputs["Tangent"], bsdf.inputs["Tangent"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mat.surface_render_method = "DITHERED"
    try:
        mat.use_transparent_shadow = True
    except AttributeError:
        pass
    mat.use_backface_culling = False
    return mat


def build_cards(strands, P, name="Evia.hair", H=None):
    """strands: list of dict(pts, nrm, width, strip, ao, rng_twist)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    col_layer = bm.loops.layers.color.new("hair_ao")
    strips = P["strips"]
    vnormals = []
    vweights = []    # (head, neck, chest)
    for st in strands:
        pts, nrm = st["pts"], st["nrm"]
        n = len(pts)
        if n < 3:
            continue
        s = [0.0]
        for i in range(1, n):
            s.append(s[-1] + (pts[i] - pts[i - 1]).length)
        L = s[-1]
        v0 = (st["strip"] + 0.03) / strips
        v1 = (st["strip"] + 0.97) / strips
        tone = st.get("tone", 1.0)
        twist_amp = math.radians(P["twist_deg"])
        tw_ph = st["twist_phase"]
        left, right = [], []
        for i in range(n):
            t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            no = nrm[i] - t * nrm[i].dot(t)
            if no.length < 1e-6:
                no = Vector((0, 0, 1))
            no.normalize()
            b = t.cross(no).normalized()
            ang = twist_amp * math.sin(tw_ph + 6.0 * s[i] / max(L, 1e-6)) * _smoothstep(0.0, 0.08, s[i])
            b = b * math.cos(ang) + no * math.sin(ang)
            w = st["width"] * (1.0 - P["tip_taper"] * (s[i] / L) ** 1.5)
            w *= 0.55 + 0.45 * _smoothstep(0.0, 0.03, s[i])      # narrow root, hides the card start
            a = bm.verts.new(pts[i] - b * (w * 0.5))
            c = bm.verts.new(pts[i] + b * (w * 0.5))
            left.append(a)
            right.append(c)
            card_n = b.cross(t).normalized()
            if card_n.dot(no) < 0:
                card_n = -card_n
            vn = (card_n * (1.0 - P["normal_blend"]) + no * P["normal_blend"]).normalized()
            vnormals.extend([vn, vn])
            z = pts[i].z
            hz = H.head_base.z if H is not None else 1.47
            wh = _smoothstep(hz - 0.13, hz - 0.03, z)          # Head above the jaw line
            wn = (1.0 - wh) * _smoothstep(hz - 0.27, hz - 0.15, z)  # Neck, then Spine2 on the shoulders
            wc = max(0.0, 1.0 - wh - wn)
            vweights.extend([(wh, wn, wc), (wh, wn, wc)])
        for i in range(n - 1):
            f = bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
            f.smooth = True
            uu0 = s[i] / L
            uu1 = s[i + 1] / L
            uvs = ((uu0, v0), (uu0, v1), (uu1, v1), (uu1, v0))
            ao_root = st["ao"] * (0.72 + 0.28 * _smoothstep(0.0, 0.10, s[i]))
            ao_root1 = st["ao"] * (0.72 + 0.28 * _smoothstep(0.0, 0.10, s[i + 1]))
            aos = (ao_root, ao_root, ao_root1, ao_root1)
            for loop, uv, aov in zip(f.loops, uvs, aos):
                loop[uv_layer].uv = uv
                c = min(aov * tone, 1.0)
                loop[col_layer] = (c, c, c, 1.0)
    bm.to_mesh(me)
    bm.free()
    me.normals_split_custom_set_from_vertices([tuple(v) for v in vnormals])
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj, vweights


# ----------------------------------------------------------------------------------------------- build

def build(body, rig, colliders=(), texture_path=None, name="Evia.hair", **overrides):
    P = dict(DEFAULTS)
    P.update(overrides)
    rng = random.Random(P["seed"])
    tris = scalp_triangles(body)
    H = HeadFrame(tris, rig, P)
    # the caller poses the rig for display (arms down) before calling build(): collide with what is there
    bvh = collision_bvh([body] + [c for c in colliders if c is not None], exclude_arms=P["exclude_arms"])
    head_bvh = collision_bvh([body], exclude_arms=True)
    domes = ear_domes(body, P)
    print("EVIA HAIR ear domes", [(tuple(round(x, 3) for x in c), s) for c, s in domes])
    strands = []
    stats = {"front": 0, "back": 0, "cards": 0}
    for (lname, count, width, h_head, h_body, strip_ids, ao, len_scale) in P["layers"]:
        roots = poisson_on_triangles(tris, count, rng)
        if lname == "wisp":      # i016: no wisps on top of the head (they stuck up as thick strands at the crown)
            roots = [(r, n) for r, n in roots if r.z < H.zmax - 0.035]
        ao = max(ao, P["ao_min"])
        for root, n0 in roots:
            group = strand_group(root, H, P)
            stats[group] += 1
            L = strand_length(root, H, P, rng, len_scale)
            pts, nrm, hug = grow(root, n0, H, P, bvh, head_bvh, h_head, h_body, L, group, rng, domes)
            strands.append({"pts": pts, "nrm": nrm, "width": width * rng.uniform(0.85, 1.15), "h_body": h_body,
                            "strip": rng.choice(strip_ids), "ao": ao, "twist_phase": rng.uniform(0, 6.28)})
    # waves per lock (clump-coherent), then settle against the body / garments again
    stats.update(lock_waves(strands, H, P, rng))
    for st in strands:
        st["pts"] = relax(st["pts"], bvh, st["h_body"])
    # hairline: short, sparse, flat cards just inside the front / temple edge of the scalp so the hairline
    # fades in instead of starting as a hard line of card roots
    edge = hairline_roots(body, H, P["hairline_count"], rng, temple_outset=P["temple_outset"])
    for root, n0 in edge:
        temple = _smoothstep(0.025, 0.045, abs(root.x)) * (1.0 if root.y < H.ear_y - 0.01 else 0.0)
        L = rng.uniform(0.035, 0.075) * (1.0 - temple) + rng.uniform(*P["temple_len"]) * temple
        pts, nrm, hug = grow(root, n0, H, P, bvh, head_bvh, 0.0022, 0.004, L, "back", rng, domes)
        strands.append({"pts": pts, "nrm": nrm, "width": 0.009 * rng.uniform(0.8, 1.2),
                        "strip": rng.choice((6, 7)), "ao": 0.95, "twist_phase": rng.uniform(0, 6.28)})
    stats["hairline_cards"] = len(edge)
    # crown: short dense cards radiating from the whorl so the scalp never shows where the layers part
    crown_tris = [t for t in tris if min((c - H.part_b).length for c in t) < P["crown_radius"]]
    if crown_tris:
        for root, n0 in poisson_on_triangles(crown_tris, P["crown_count"], rng):
            # (i016: 9-15 cm crown cards ended ON the crown -> visible ragged ends; now they run on under the
            # outer layers)
            L = rng.uniform(0.18, 0.30)
            pts, nrm, hug = grow(root, n0, H, P, bvh, head_bvh, 0.006, 0.008, L, "back", rng, domes)
            strands.append({"pts": pts, "nrm": nrm, "width": P["crown_width"] * rng.uniform(0.85, 1.15),
                            "strip": rng.choice((2, 3, 4)), "ao": max(0.8, P["ao_min"]),
                            "twist_phase": rng.uniform(0, 6.28)})
    stats["crown_cards"] = P["crown_count"] if crown_tris else 0
    # part density: short, flat cards rooted within ~6 mm either side of the part, combed away from it
    part_tris = []
    for t in tris:
        c = (t[0] + t[1] + t[2]) / 3.0
        q, u = closest_on_segment(c, H.part_a, H.part_b)
        if (c - q).length < 0.007 and 0.0 <= u <= 1.0:
            part_tris.append(t)
    if part_tris and P["part_count"] > 0:
        for root, n0 in poisson_on_triangles(part_tris, P["part_count"], rng):
            L = rng.uniform(0.16, 0.28)
            pts, nrm, hug = grow(root, n0, H, P, bvh, head_bvh, 0.0025, 0.004, L, "back", rng, domes)
            strands.append({"pts": pts, "nrm": nrm, "width": P["part_width"] * rng.uniform(0.8, 1.2),
                            "strip": rng.choice((3, 4, 5)), "ao": 0.9, "twist_phase": rng.uniform(0, 6.28)})
    stats["part_cards"] = P["part_count"] if part_tris else 0
    stats["cards"] = len(strands)
    trng = random.Random(P["seed"] + 7)
    for st in strands:
        st["tone"] = 1.0 + P["card_tone_jitter"] * (trng.random() * 2.0 - 1.0)
    obj, vweights = build_cards(strands, P, name, H)
    # skinning
    if rig is not None:
        for bone, k in ((HEAD_BONE, 0), (NECK_BONE, 1), (CHEST_BONE, 2)):
            g = obj.vertex_groups.new(name=bone)
            for vi, w in enumerate(vweights):
                if w[k] > 1e-4:
                    g.add([vi], w[k], "REPLACE")
        obj.parent = rig
        obj.matrix_parent_inverse = rig.matrix_world.inverted()
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
    if texture_path:
        img, nimg = paint_atlas(texture_path, P)
        obj.data.materials.append(hair_material(img, nimg, P=P))
    stats["verts"] = len(obj.data.vertices)
    stats["tris"] = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    stats["head_frame"] = {"part_a": tuple(round(x, 3) for x in H.part_a),
                           "part_b": tuple(round(x, 3) for x in H.part_b),
                           "ear_y": round(H.ear_y, 3), "ear_z": round(H.ear_z, 3),
                           "scalp_bbox": [round(float(x), 3) for x in (H.xmin, H.xmax, H.ymin, H.ymax, H.zmin, H.zmax)]}
    obj["evia_hair_stats"] = str(stats)
    print("EVIA HAIR", stats)
    return obj
