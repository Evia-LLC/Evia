"""Evia's own expression shape keys (Blender 4.5, MPFB 2.0.17, no downloads). Deterministic.

WHY
  The MakeHuman expression units shipped with MPFB are weak and move the wrong things for a warm smile: the
  i011-i014 'warm' preset (corner-puller 0.9 + parting) stretched the lips sideways and nothing moved above
  the mouth - critics read it as a pout / smirk (a social, non-Duchenne smile). ARKit face units need the
  faceunits01 pack (not installed). So the smile is built here from two kinds of ingredients:
    a) procedural displacement fields placed from landmarks measured on the SHAPED mesh (lips group, lid joints,
       nose wing, the mouth-open unit to tell upper from lower lip) - mouth corners, lip stretch / thinning,
       teeth reveal; they follow Evia's face targets;
    b) MPFB / MakeHuman CC0 modelling targets that are anatomically sculpted for the cheek apples, the
       nasolabial fold and the lower lids (the "cheek raiser" + "lid tightener" part of a Duchenne smile).
       Ingredient amounts were measured on her face (work/evia-char/probe/units.json, probe_smile.py).

KEYS (added to the base mesh; evia_build copies them onto brows / lashes through their MHCLO mapping)
  evia_smile       soft Duchenne smile, both sides: corners up + BACK + out (never forward), lips a little wider
                   and thinner (no pout), cheek apples rise and round forward, nasolabial fold deepens, lower
                   lids rise (slight squint).
  evia_smile_L/_R  the same, her left / right side only (L + R == evia_smile) - for asymmetric, livelier smiles.
  evia_teeth_show  upper lip up / lower lip down at the centre: with evia_smile it shows 2-3 mm of upper teeth.

UNITS / FRAME  metres, MPFB space: Z up, she faces -Y, her left is +X.
"""

import math
import os

import numpy as np

import evia_skin as S

SMILE = {
    # mouth corner (per side) at the corner itself + falloff (i016 lab-a: 3.4 / 2.6 / 2.0 mm was invisible)
    "corner_up": 0.0055, "corner_back": 0.0032, "corner_out": 0.0030,
    "corner_sigma": 0.010, "corner_sigma_wide": 0.020, "corner_wide_amount": 0.30,
    # lips: widen (fraction of x), upper lip lift at the centre (its red edge more than its top -> thinner),
    # lower lip flattened back (no pout)
    "lip_stretch": 0.06,
    "upper_lift": 0.0010, "upper_back": 0.0006, "upper_thin": 0.45,
    "lower_back": 0.0010, "lower_down": 0.0003,
    # procedural cheek / fold / lid terms (used only when targets are off: "use_targets": False)
    "cheek_up": 0.0030, "cheek_fwd": 0.0022, "cheek_out": 0.0008,
    "cheek_center": (0.012, 0.027),
    "cheek_sigma": (0.015, 0.012, 0.022),
    "fold_in": 0.0010, "fold_width": 0.0024,
    "lid_up": 0.0010, "lid_fwd": 0.0002, "lid_sigma": (0.0095, 0.0034),
    # teeth-show key
    "teeth_upper_up": 0.0024, "teeth_lower_down": 0.0020, "teeth_sigma_x": 0.014,
    "use_targets": True,
}

# (MPFB data/targets relative path, weight) - cheek raiser, nasolabial fold, lower-lid lift / squint.
# Amounts per the duplicate agent's probe (work/evia-char/probe/units.json, CONFLICT-0950.md); applied to the
# side of the face they belong to (l-* = her left).
SMILE_TARGETS = [
    ("cheek/l-cheek-trans-up", 0.30), ("cheek/r-cheek-trans-up", 0.30),
    ("cheek/l-cheek-volume-incr", 0.16), ("cheek/r-cheek-volume-incr", 0.16),
    ("mouth/mouth-laugh-lines-out", 0.55),
    ("eyes/l-eye-bag-height-decr", 0.35), ("eyes/r-eye-bag-height-decr", 0.35),
    ("eyes/l-eye-height3-decr", 0.60), ("eyes/r-eye-height3-decr", 0.60),
]


def _gauss(d2):
    return np.exp(-0.5 * d2)


def _key_delta(body, name):
    keys = body.data.shape_keys
    n = len(body.data.vertices)
    a = np.zeros(n * 3)
    b = np.zeros(n * 3)
    keys.key_blocks[name].data.foreach_get("co", a)
    keys.reference_key.data.foreach_get("co", b)
    return (a - b).reshape(n, 3)


def target_delta(body, recipe):
    """Sum of weighted MPFB target deltas (each loaded as a temporary key, read, removed)."""
    import evia_mpfb as E
    Svc = E.S()
    tdir = os.path.join(E.system_data_dir(), "targets")
    total = np.zeros((len(body.data.vertices), 3))
    used = []
    for rel, w in recipe:
        path = os.path.join(tdir, rel + ".target.gz")
        if not os.path.exists(path):
            print("EVIA EXPR missing target", rel)
            continue
        kb = Svc.TargetService.load_target(body, path, weight=0.0, name="tmp_expr")
        total += _key_delta(body, kb.name) * w
        body.shape_key_remove(kb)
        used.append(rel)
    return total, used


def landmarks(body, co):
    """Mouth corners, lip heights, upper/lower lip split, lid joints, nose wings - on the shaped mesh."""
    lips = S.group_weights(body, "lips")
    idx = np.where(lips > 0.5)[0]
    L = co[idx]
    out = {}
    corners = {}
    for s in (1.0, -1.0):
        corners[s] = co[idx[int(np.argmax(s * L[:, 0]))]].copy()
    out["corners"] = corners
    zs = 0.5 * (corners[1.0][2] + corners[-1.0][2])
    out["z_stomion"] = zs
    front = L[np.abs(L[:, 0]) < 0.004]
    out["z_upper_top"] = float(front[:, 2].max())
    out["z_lower_bottom"] = float(front[:, 2].min())
    out["y_front"] = float(front[:, 1].min())
    # upper vs lower lip: the MakeHuman mouth-open unit moves the lower lip / jaw down (a z threshold
    # misclassified the lip centre - lab-a showed no teeth at all)
    lower = None
    keys = body.data.shape_keys
    if keys is not None and keys.key_blocks.get("mh_mouth-open") is not None:
        lower = _key_delta(body, "mh_mouth-open")[:, 2] < -0.0008
    out["lower_mask"] = lower
    for s, side in ((1.0, "l"), (-1.0, "r")):
        out["lowerlid", s] = S.group_center(body, co, "joint-%s-lowerlid" % side)
    body_w = S.group_weights(body, "body") > 0.5
    zl = out["lowerlid", 1.0][2]
    band = body_w & (co[:, 2] < zl - 0.022) & (co[:, 2] > zs + 0.012) & (np.abs(co[:, 0]) < 0.03)
    out["ala"] = {}
    for s in (1.0, -1.0):
        pts = co[band & (s * co[:, 0] > 0.008)]
        wing = pts[(np.abs(pts[:, 0]) > 0.012) & (np.abs(pts[:, 0]) < 0.020)] if len(pts) else pts
        out["ala"][s] = wing[np.argmin(wing[:, 1])].copy() if len(wing) else \
            np.array([s * 0.016, out["y_front"] + 0.004, zs + 0.024])
    return out


def _fold_signed_distance(co, a, b):
    ax, az, bx, bz = a[0], a[2], b[0], b[2]
    ln = math.hypot(bx - ax, bz - az)
    ux, uz = (bx - ax) / ln, (bz - az) / ln
    px, pz = co[:, 0] - ax, co[:, 2] - az
    t = (px * ux + pz * uz) / ln
    nx, nz = uz, -ux
    if nx * np.sign(ax) < 0:
        nx, nz = -nx, -nz
    return px * nx + pz * nz, t


def sideness(co, s):
    """Partition of unity across the midline: w_L + w_R = 1 (nothing moves twice at the centre)."""
    return np.clip((co[:, 0] * s + 0.004) / 0.008, 0.0, 1.0)


def mouth_field(body, co, lm, s, P):
    """Corners + lips of a one-sided smile (not yet masked by sideness)."""
    n = len(co)
    D = np.zeros((n, 3))
    C = lm["corners"][s]
    lips = np.clip(S.smooth_field(body, S.group_weights(body, "lips"), 2), 0, 1)
    d = co - C
    r2 = (d ** 2).sum(axis=1)
    g = np.maximum(_gauss(r2 / P["corner_sigma"] ** 2), _gauss(r2 / P["corner_sigma_wide"] ** 2) *
                   P["corner_wide_amount"])
    D[:, 0] += s * P["corner_out"] * g
    D[:, 1] += P["corner_back"] * g
    D[:, 2] += P["corner_up"] * g
    D[:, 0] += co[:, 0] * P["lip_stretch"] * lips * np.clip(np.abs(co[:, 0]) / 0.02, 0, 1)
    zs = lm["z_stomion"]
    up = ~lm["lower_mask"] if lm.get("lower_mask") is not None else co[:, 2] > zs
    hu = max(lm["z_upper_top"] - zs, 0.004)
    centre = _gauss((co[:, 0] / 0.016) ** 2)
    frac = np.clip((co[:, 2] - zs) / hu, 0.0, 1.0)
    D[:, 2] += np.where(up, P["upper_lift"] * (1.0 - P["upper_thin"] * frac) * centre, 0.0) * lips
    D[:, 1] += np.where(up, P["upper_back"] * centre, 0.0) * lips
    D[:, 1] += np.where(~up, P["lower_back"] * centre, 0.0) * lips
    D[:, 2] -= np.where(~up, P["lower_down"] * centre, 0.0) * lips
    return D


def cheek_field(body, co, lm, s, P):
    """Procedural cheek raise + fold + lower-lid rise (fallback when the MPFB targets are not used)."""
    n = len(co)
    D = np.zeros((n, 3))
    C = lm["corners"][s]
    ll = lm["lowerlid", s]
    cx, cz = P["cheek_center"]
    A = np.array([ll[0] + s * cx, ll[1], ll[2] - cz])
    sx, sz, sy = P["cheek_sigma"]
    d = co - A
    front_y = co[:, 1] - lm["y_front"]
    bulge = _gauss((d[:, 0] / sx) ** 2 + (d[:, 2] / sz) ** 2 + (np.maximum(front_y - 0.03, 0) / sy) ** 2)
    fd, ft = _fold_signed_distance(co, lm["ala"][s] + np.array([s * 0.004, 0.0, 0.002]),
                                   C + np.array([s * 0.011, 0.0, -0.013]))
    lateral = 1.0 / (1.0 + np.exp(-fd / 0.0012))
    below_eye = np.clip((ll[2] - 0.004 - co[:, 2]) / 0.006, 0, 1)
    bulge = bulge * np.where(ft < 1.15, lateral, 1.0) * below_eye * (co[:, 0] * s > 0)
    D[:, 2] += P["cheek_up"] * bulge
    D[:, 1] -= P["cheek_fwd"] * bulge
    D[:, 0] += s * P["cheek_out"] * bulge
    along = np.clip(ft / 0.12, 0, 1) * np.clip((1.2 - ft) / 0.25, 0, 1)
    groove = _gauss((fd / P["fold_width"]) ** 2) * along * (np.abs(front_y) < 0.05) * (co[:, 0] * s > 0)
    D[:, 1] += P["fold_in"] * groove
    lsx, lsz = P["lid_sigma"]
    d = co - (ll + np.array([0.0, 0.0, -0.0015]))
    lid = _gauss((d[:, 0] / lsx) ** 2 + (d[:, 2] / lsz) ** 2 + (d[:, 1] / 0.012) ** 2) * (co[:, 2] < ll[2] + 0.0008)
    D[:, 2] += P["lid_up"] * lid
    D[:, 1] -= P["lid_fwd"] * lid
    return D


def teeth_show_field(body, co, lm, P):
    lips = np.clip(S.smooth_field(body, S.group_weights(body, "lips"), 2), 0, 1)
    zs = lm["z_stomion"]
    D = np.zeros((len(co), 3))
    centre = _gauss((co[:, 0] / P["teeth_sigma_x"]) ** 2)
    up = ~lm["lower_mask"] if lm.get("lower_mask") is not None else co[:, 2] > zs
    hu = max(lm["z_upper_top"] - zs, 0.004)
    hl = max(zs - lm["z_lower_bottom"], 0.004)
    fu = 1.0 - 0.6 * np.clip((co[:, 2] - zs) / hu, 0, 1)
    fl = 1.0 - 0.6 * np.clip((zs - co[:, 2]) / hl, 0, 1)
    D[:, 2] += np.where(up, P["teeth_upper_up"] * fu, -P["teeth_lower_down"] * fl) * centre * lips
    return D


def add_key(body, name, disp):
    if not body.data.shape_keys:
        body.shape_key_add(name="Basis", from_mix=False)
    kb = body.data.shape_keys.key_blocks.get(name) or body.shape_key_add(name=name, from_mix=False)
    n = len(body.data.vertices)
    b = np.zeros(n * 3)
    body.data.shape_keys.reference_key.data.foreach_get("co", b)
    kb.data.foreach_set("co", (b.reshape(n, 3) + disp).ravel())
    kb.value = 0.0
    return kb


def add_smile_keys(body, params=None, suffix=""):
    """Add evia_smile, evia_smile_L, evia_smile_R, evia_teeth_show (+ suffix) to `body`. Returns the names."""
    P = dict(SMILE, **(params or {}))
    co = S.shaped_coords(body)
    lm = landmarks(body, co)
    # everything may move (skin AND the eyelash / brow helper geometry, so lashes follow the lids) EXCEPT the
    # helpers the teeth, tongue and eyeballs are fitted to - those parts must stay rigid
    rigid = np.zeros(len(co), dtype=bool)
    for g in ("helper-upper-teeth", "helper-lower-teeth", "helper-tongue", "helper-l-eye", "helper-r-eye"):
        rigid |= S.group_weights(body, g) > 0.5
    is_skin = ~rigid
    tgt = None
    if P["use_targets"]:
        tgt, used = target_delta(body, P.get("targets", SMILE_TARGETS))
    sides = {}
    for s in (1.0, -1.0):
        D = mouth_field(body, co, lm, s, P)
        if tgt is None:
            D += cheek_field(body, co, lm, s, P)
        sides[s] = D * sideness(co, s)[:, None]
        if tgt is not None:
            sides[s] += tgt * sideness(co, s)[:, None]
        sides[s] *= is_skin[:, None]
    both = sides[1.0] + sides[-1.0]
    names = []
    for nm, disp in (("evia_smile", both), ("evia_smile_L", sides[1.0]), ("evia_smile_R", sides[-1.0]),
                     ("evia_teeth_show", teeth_show_field(body, co, lm, P) * is_skin[:, None])):
        add_key(body, nm + suffix, disp)
        names.append(nm + suffix)
    info = {"corners": {k: [round(float(x), 4) for x in v] for k, v in lm["corners"].items()},
            "lower_lip_verts": int(lm["lower_mask"].sum()) if lm.get("lower_mask") is not None else None,
            "targets": P["use_targets"], "max_disp_mm": round(float(np.abs(both).max()) * 1000, 2)}
    print("EVIA EXPR keys", names, info)
    return names
