"""Build EVIA - the embodied skincare consultant - with MPFB 2 (Blender 4.5 LTS, MPFB 2.0.17). Deterministic.

WHO SHE IS (art direction, from the Scan mockup ref4 - identity only, not a likeness of any real person)
  A white woman in her late 20s / early 30s: fair skin, soft warm smile, natural makeup, defined brows,
  long dark-brown loose-wavy hair past the shoulders. Consult outfit: white knee-length lab coat with notched
  lapels and pockets over a light top. Lounge outfit: cream/blush soft knit top + relaxed trousers.

WHAT THIS SCRIPT DOES
  1. MPFB human from RECIPE["macro"], then RECIPE["body"] + RECIPE["face"] detail targets (MPFB's own
     face/body targets, chosen deliberately; `sym` targets are applied to both sides) + RECIPE["asym"]
     (subtle asymmetry so she is not a mirror-perfect doll).
  2. Rig (default mixamo_unity: Mixamo names + fingers, Jaw, eye bones, eyelids) BEFORE parts, so every part
     is parented + weighted by MPFB.
  3. Parts: high-poly eyes, eyebrows, eyelashes, teeth, tongue; garments of the chosen outfit.
  4. Face keys: MakeHuman expression units (shipped in MPFB) as `mh_<unit>` shape keys, copied onto the
     brows/lashes/teeth through their MHCLO mapping. ARKit-52 / visemes need the faceunits01 / visemes02
     packs (not installed - see work/evia-char/PROGRESS.md).
  5. Hair: evia_hair.build (procedural cards grown on the scalp, colliding with body + garments).
  6. Look-dev materials (Blender): layered skin shader (see evia_skin.py), procedural eyes, tinted brows/lashes.
  7. Saves the .blend (never into the repo).

RUN (always through the render lock on this machine)
  work/evia-rebuild/tools/blender-render.sh scripts/blender/evia_build.py -- \
      --outfit consult|lounge|none --blend <work>/evia-consult.blend [--no-hair] [--rig mixamo_unity]
"""

import importlib
import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evia_mpfb as E  # noqa: E402

RECIPE = {
    # MakeHuman macros (0..1). age 0.53 ~ 29 y. proportions 1 = "idealised" proportions.
    "macro": {"gender": 0.0, "age": 0.53, "muscle": 0.48, "weight": 0.42, "proportions": 0.85,
              "height": 0.52, "cupsize": 0.52, "firmness": 0.62,
              "race": {"caucasian": 1.0, "african": 0.0, "asian": 0.0}},
    "body": {
        "neck-scale-horiz-decr": 0.25, "measure-neck-height-incr": 0.35, "neck-scale-depth-decr": 0.2,
        "measure-shoulder-dist-decr": 0.15, "measure-waist-circ-decr": 0.25,
    },
    # face - chosen on the i004 A/B sheet (lookdev/i004/variants-a.png): heart-shaped lower face, high cheekbones,
    # fuller lips with a defined bow, slightly larger almond eyes lifted at the outer corner with a soft upper
    # lid (not wide open - a relaxed, warm gaze), straight refined nose with a small lift at the tip.
    "face": {
        # i012: B5 of the i012 A/B sheet (lookdev/i012/variants-b-front.png): slimmer lower face (chin width,
        # jaw angles, inverted triangle), larger almond eyes lifted at the outer corner, LOWER + flatter brows
        # (the old high arch read surprised), higher cheekbones, and a flatter / wider mouth (i011 lips pushed
        # forward into a pout even when smiling).
        "head-oval": 0.55, "head-scale-horiz-decr": 0.10, "head-age-decr": 0.35, "head-invertedtriangular": 0.28,
        "head-fat-decr": 0.25, "forehead-scale-vert-decr": 0.15,
        # i016: a little more arch again (ref4: defined, gently arched brows; critics: flat, thin brows)
        "eyebrows-angle-up": 0.28, "eyebrows-trans-down": 0.12,
        "sym:eye-scale-incr": 0.35, "sym:eye-corner2-up": 0.45, "sym:eye-height2-incr": 0.18,
        "sym:eye-eyefold-down": 0.25,
        "nose-scale-horiz-decr": 0.30, "nose-point-width-decr": 0.40, "nose-point-up": 0.35,
        "nose-hump-decr": 0.40, "nose-nostrils-width-decr": 0.25, "nose-width1-decr": 0.25,
        "nose-width2-decr": 0.25, "nose-width3-decr": 0.20, "nose-volume-decr": 0.15, "nose-scale-vert-decr": 0.15,
        # i016: critics read the neutral mouth as pushed forward (a thick, sausage-like lower lip): volumes down
        # (i014 .15 / .30)
        "mouth-upperlip-volume-incr": 0.10, "mouth-lowerlip-volume-incr": 0.15, "mouth-cupidsbow-incr": 0.40,
        # i013: vertical lip size down (i012 front: puffy upper lip, "trout" pout when smiling)
        "mouth-angles-up": 0.20, "mouth-scale-vert-incr": 0.0, "mouth-upperlip-height-incr": 0.0,
        "mouth-lowerlip-height-incr": 0.12, "mouth-scale-horiz-incr": 0.12,
        "mouth-scale-depth-decr": 0.30, "mouth-trans-backward": 0.12,
        "sym:cheek-bones-incr": 0.45, "sym:cheek-trans-up": 0.20, "sym:cheek-volume-decr": 0.12,
        "chin-width-decr": 0.35, "chin-triangle": 0.25, "chin-bones-decr": 0.55, "chin-prominent-incr": 0.15,
        "chin-height-decr": 0.20,
    },
    # subtle asymmetry (not on the eyes - there even 0.15 read as mismatched irises)
    "asym": {"asym-mouth-1-r": 0.10, "asym-nose-1-l": 0.10, "asym-brown-1-r": 0.10, "asym-cheek-1-l": 0.10},
    "skin": {"base": "young_caucasian_female"},
    # i010: warm medium-dark brown like ref4 (i007-i009 pushed the iris to hazel-green, which read olive/cold);
    # eyeball value 0.9 so the sclera is off-white, not glowing
    # i016: the i010 hue-shift route read olive / grey-green at bust distance -> the iris is RECOLOURED from the
    # texture's own luminance detail into a warm brown ramp (sRGB dark / mid / light), with a darker limbal
    # ring; sclera warmed (off-white, faint pink toward the corners; the texture's own veins are kept)
    "eyes": {"mesh": "high-poly", "texture": "brownlight",
             "iris_ramp": ((0.105, 0.058, 0.032), (0.30, 0.165, 0.085), (0.50, 0.31, 0.16)),
             "limbal_dark": 0.45, "sclera_tint": (0.96, 0.925, 0.89), "sclera_pink": (0.93, 0.76, 0.74),
             "sclera_pink_amount": 0.30,
             "iris_major": (0.115, 0.095, 0.042), "iris_minor": (0.045, 0.032, 0.014),
             "limbal": (0.018, 0.016, 0.014), "sclera": (0.80, 0.75, 0.71),
             # eye-occlusion shell (MetaHuman-style): darkens the top of the eyeball + the corners
             "occlusion": {"top": 0.62, "corner": 0.40, "color": (0.035, 0.022, 0.018)}},
    # i016: lower lashes about half as long and half as many (critics: "spider legs")
    "lower_lashes": {"length": 0.5, "keep_every": 2},
    "eyebrows": "mindfront_eyebrows_11",
    "eyelashes": "mindfront_eyelashes_05",   # i011: _04 vanished on the near eye in 3/4 close-ups; _05 is fuller
    "brow_tint": (0.0075, 0.0048, 0.0035),  # i015: darker again (ref4 brows are strong, dark)
    # garments (linear RGB). "@labcoat" = evia_labcoat.build (knee-length coat made from toigo_female_suit_2)
    "teeth": {"target_srgb": (0.85, 0.82, 0.76), "tongue_mul": 0.55},
    "outfits": {
        "none": [],
        "lookdev": [{"asset": "toigo_basic_tucked_t-shirt", "colors": {"upper": ((0.62, 0.60, 0.58), 0.85)}}],
        # i016 consult: a light blush-cream V-neck top (ref4; the lavender crew tee read as a neck brace), warm
        # taupe tailored trousers + tan loafers (charcoal leggings + grey clogs read "pharmacy assistant")
        "consult": [
            {"asset": "toigo_basic_tucked_t-shirt", "keep": "all", "sheen": 0.3, "hide_under": True,
             "normal_strength": 0.5, "drop_arms": 0.35, "neckline": {"depth": 0.075, "half_width": 0.075},
             "colors": {"upper": ((0.60, 0.50, 0.46), 0.82)}},
            {"asset": "toigo_female_suit_2", "keep": "lower", "sheen": 0.2, "hide_under": True,
             "normal_strength": 0.3, "delete_suffix": "trousers",
             "colors": {"lower": ((0.33, 0.27, 0.22), 0.80)}},
            {"asset": "shoes02", "keep": "all", "colors": {"feet": ((0.20, 0.12, 0.075), 0.42)}},
            "@labcoat",
        ],
        "lounge": [
            {"asset": "male_casualsuit02", "keep": "upper", "sheen": 0.55, "hide_under": True, "knit": 150,
             "normal_strength": 0.8, "colors": {"upper": ((0.66, 0.52, 0.46), 0.95)}},
            {"asset": "toigo_female_suit_2", "keep": "lower", "sheen": 0.2, "hide_under": True,
             "normal_strength": 0.3, "colors": {"lower": ((0.24, 0.195, 0.165), 0.82)}},
            {"asset": "shoes02", "keep": "all", "colors": {"feet": ((0.55, 0.47, 0.42), 0.5)}},
        ],
    },
    "expression_units": ["mouth-corner-puller", "mouth-elevation", "mouth-parling", "mouth-open",
                         "eye-left-slit", "eye-right-slit", "eye-left-closure", "eye-right-closure",
                         "eyebrows-left-inner-up", "eyebrows-right-inner-up", "eyebrows-left-up",
                         "eyebrows-right-up", "mouth-retraction", "mouth-compression"],
    "hair": {},
}


def expand_targets(targets):
    out = {}
    for name, value in targets.items():
        if name.startswith("sym:"):
            base = name[4:]
            out["l-" + base] = value
            out["r-" + base] = value
        else:
            out[name] = value
    return out


# ----------------------------------------------------------------------------------------------- face keys

def load_expression_units(body, units):
    S = E.S()
    folder = os.path.join(E.system_data_dir(), "targets", "expression", "units", "caucasian")
    names = []
    for unit in units:
        path = os.path.join(folder, unit + ".target.gz")
        if not os.path.exists(path):
            print("WARN missing expression unit", unit)
            continue
        S.TargetService.load_target(body, path, weight=0.0, name="mh_" + unit)
        names.append("mh_" + unit)
    return names


def interpolate_keys_to_children(body, key_names, owners):
    """Copy base-mesh shape keys onto MHCLO parts (same maths as MPFB FaceService.interpolate_targets)."""
    S = E.S()
    Mhclo = importlib.import_module(E.MPFB_MODULE + ".entities.clothes.mhclo").Mhclo
    keys = body.data.shape_keys.key_blocks
    basis = keys[0]
    made = {}
    for child in [o for o in bpy.data.objects if o.parent in owners and o.type == "MESH" and o != body]:
        path = S.ClothesService.find_clothes_absolute_path(child)
        if not path:
            continue
        mhclo = Mhclo()
        mhclo.load(path)
        count = 0
        for name in key_names:
            src = keys.get(name)
            if src is None:
                continue
            moved = []
            for idx, mapping in mhclo.verts.items():
                if idx >= len(child.data.vertices):
                    continue
                (v0, v1, v2), (w0, w1, w2) = mapping["verts"], mapping["weights"]
                off = ((src.data[v0].co - basis.data[v0].co) * w0 + (src.data[v1].co - basis.data[v1].co) * w1 +
                       (src.data[v2].co - basis.data[v2].co) * w2)
                if off.length > 0.00005:
                    moved.append((idx, off))
            if not moved:
                continue
            if not child.data.shape_keys:
                child.shape_key_add(name="Basis", from_mix=False)
            key = child.shape_key_add(name=name, from_mix=False)
            for idx, off in moved:
                key.data[idx].co = child.data.vertices[idx].co + off
            count += 1
        made[child.name] = count
    return made


# ----------------------------------------------------------------------------------------------- materials

def principled_of(mat):
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            return n
    return None


def tint_card_material(obj, rgb, roughness=0.6):
    """Brows / lashes: keep the MakeHuman alpha texture, replace colour with a tint (dark brown)."""
    for slot in obj.material_slots:
        mat = slot.material
        nt = mat.node_tree
        bsdf = principled_of(mat)
        tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        for link in list(bsdf.inputs["Base Color"].links):
            nt.links.remove(link)
        if tex is not None:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 0.35
            mix.inputs["B"].default_value = (rgb[0] * 3, rgb[1] * 3, rgb[2] * 3, 1.0)
            flat = nt.nodes.new("ShaderNodeRGB")
            flat.outputs[0].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
            nt.links.new(flat.outputs[0], mix.inputs["A"])
            nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
            if not bsdf.inputs["Alpha"].links:
                nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        else:
            bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        mat.surface_render_method = "DITHERED"
        mat.use_backface_culling = False


def set_procedural_eyes(eyes, cfg):
    for slot in eyes.material_slots:
        for n in slot.material.node_tree.nodes:
            if n.type == "GROUP" and "IrisMajorColor" in n.inputs:
                n.inputs["IrisMajorColor"].default_value = (*cfg["iris_major"], 1.0)
                n.inputs["IrisMinorColor"].default_value = (*cfg["iris_minor"], 1.0)
                n.inputs["IrisSection4Color"].default_value = (*cfg["limbal"], 1.0)
                n.inputs["EyeWhiteColor"].default_value = (*cfg["sclera"], 1.0)
                n.inputs["PupilSize"].default_value = 0.34
                n.inputs["Clearcoat"].default_value = 0.8


def shifted_eye_texture(img, shift, out_dir, sclera_value=1.0):
    """Copy of the MakeHuman eye texture with the iris pushed toward a softer green-hazel.
    shift = (hue_deg, saturation_mul, value_mul); only saturated (iris) pixels are affected."""
    import colorsys
    import numpy as np
    w, h = img.size
    a = np.zeros(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)
    rgb = a[..., :3]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    wgt = np.clip((sat - 0.18) / 0.25, 0, 1)[..., None]          # iris pixels only (sclera is ~grey)
    # hue rotation in YIQ space (cheap, vectorised)
    th = math.radians(shift[0])
    yiq = np.array([[0.299, 0.587, 0.114], [0.596, -0.274, -0.322], [0.211, -0.523, 0.312]], dtype=np.float32)
    inv = np.linalg.inv(yiq).astype(np.float32)
    rot = np.array([[1, 0, 0], [0, math.cos(th), -math.sin(th)], [0, math.sin(th), math.cos(th)]], dtype=np.float32)
    m = inv @ rot @ yiq
    q = rgb @ m.T
    lum = q.mean(axis=2, keepdims=True)
    q = lum + (q - lum) * shift[1]
    q = q * shift[2]
    a[..., :3] = np.clip(rgb * (1 - wgt) * sclera_value + q * wgt, 0, 1)
    new = bpy.data.images.new("evia_eye", w, h, alpha=True)
    new.pixels.foreach_set(a.ravel())
    new.filepath_raw = os.path.join(out_dir, "evia_eye.png")
    new.file_format = "PNG"
    new.save()
    return new


def _srgb_to_lin(c):
    import numpy as np
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def recolour_eye_texture(img, cfg, out_dir):
    """i016: new eye texture from the MakeHuman one (CC0): the iris keeps its own fibre detail (luminance) but
    is mapped onto a warm brown ramp with a darker limbal ring; the sclera is warmed and turns faintly pink
    toward the eye corners (radially away from the iris); the texture's own veins are kept.
    Works in sRGB (Blender stores the PNG's pixels as sRGB floats)."""
    import numpy as np
    w, h = img.size
    a = np.zeros(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)
    rgb = a[..., :3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    out = rgb.copy()
    dark, mid, light = (np.array(c, dtype=np.float32) for c in cfg["iris_ramp"])
    info = []
    for quad in ((xx < w / 2) & (yy < h / 2), (xx >= w / 2) & (yy >= h / 2), (xx < w / 2) & (yy >= h / 2),
                 (xx >= w / 2) & (yy < h / 2)):
        iris = quad & (sat > 0.35) & (mx > 0.12)
        if iris.sum() < 500:
            continue
        cy, cx = yy[iris].mean(), xx[iris].mean()
        r = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
        R = float(np.percentile(r[iris], 97))
        lum = rgb.mean(axis=2)
        disc = quad & (r < R * 1.02)
        pupil = disc & (lum < 0.06) & (r < R * 0.45)
        ring = disc & ~pupil
        l = lum[ring]
        t = np.clip((l - np.percentile(l, 5)) / max(np.percentile(l, 95) - np.percentile(l, 5), 1e-3), 0, 1)
        col = np.where(t[:, None] < 0.5, dark + (mid - dark) * (t[:, None] / 0.5),
                       mid + (light - mid) * ((t[:, None] - 0.5) / 0.5))
        rr = r[ring] / R
        limb = 1.0 - cfg["limbal_dark"] * np.clip((rr - 0.78) / 0.2, 0, 1)        # darker limbal ring
        col = col * limb[:, None]
        edge = np.clip((R * 1.02 - r[ring]) / 3.0, 0, 1)[:, None]                  # 3 px soft edge
        out[ring] = rgb[ring] * (1 - edge) + col * edge
        # sclera of this eye: warm tint + pink toward the corners
        scl = quad & (r >= R * 1.02)
        k = np.clip((r[scl] / R - 1.5) / 1.0, 0, 1)[:, None] * cfg["sclera_pink_amount"]
        base = out[scl] * np.array(cfg["sclera_tint"], dtype=np.float32)
        out[scl] = base * (1 - k) + np.array(cfg["sclera_pink"], dtype=np.float32) * base.mean(axis=1, keepdims=True) \
            / max(float(np.mean(cfg["sclera_pink"])), 1e-3) * k
        info.append((round(float(cx)), round(float(cy)), round(R, 1)))
    a[..., :3] = np.clip(out, 0, 1)
    new = bpy.data.images.new("evia_eye", w, h, alpha=True)
    new.pixels.foreach_set(a.ravel())
    new.filepath_raw = os.path.join(out_dir, "evia_eye.png")
    new.file_format = "PNG"
    new.save()
    print("EVIA EYE TEXTURE irises (cx, cy, R px)", info)
    return new


def eye_occlusion(eyes, rig, cfg, work_dir):
    """i016: MetaHuman-style eye-occlusion shell: a copy of the front of each eyeball, scaled out a little,
    weighted to the HEAD (it must not turn with the eyes), with an alpha-gradient texture that darkens the top
    ~third of the eyeball (the upper lid's shadow) and the corners. Its own UV: u = across, v = up (per eye).
    Kills the flat 'doll stare' sclera. Alpha-blended, casts no shadow."""
    import bmesh
    import numpy as np
    oc = cfg["occlusion"]
    me = eyes.data
    cornea_idx = 1
    verts = np.array([v.co[:] for v in me.vertices])
    ball_faces = [p for p in me.polygons if p.material_index != cornea_idx]
    import evia_skin
    body = next((o for o in bpy.data.objects if o.type == "MESH" and "lips" in o.vertex_groups), None)
    skin_pts = []
    if body is not None:
        bco = evia_skin.shaped_coords(body)
        isb = evia_skin.group_weights(body, "body") > 0.5
        ec = eyes.matrix_world @ Vector(verts.mean(axis=0))
        near = isb & (np.abs(bco[:, 2] - ec.z) < 0.03) & (np.abs(np.abs(bco[:, 0]) - 0.03) < 0.03)
        skin_pts = [body.matrix_world @ Vector(p) for p in bco[near]]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    for side in (1.0, -1.0):
        fs = [p for p in ball_faces if verts[list(p.vertices)][:, 0].mean() * side > 0]
        ids = sorted({i for p in fs for i in p.vertices})
        c = verts[ids].mean(axis=0)
        rad = float(np.linalg.norm(verts[ids] - c, axis=1).mean())
        # shell offset from the eyeball: a fraction of the gap to the nearest lid skin (0.08..0.3 mm), so it
        # never pokes through the lids (idea from the duplicate agent's version, CONFLICT-0950.md)
        wc = eyes.matrix_world @ Vector(c)
        gap = min(((wc - b).length for b in skin_pts), default=rad + 0.001) - rad
        scale = (rad + max(0.00008, min(0.0003, gap * 0.35))) / rad
        vmap = {}
        for p in fs:
            pc = verts[list(p.vertices)].mean(axis=0) - c
            if pc[1] / rad > -0.25:                  # front part only (she faces -Y)
                continue
            for i in p.vertices:
                if i not in vmap:
                    q = c + (verts[i] - c) * scale
                    vmap[i] = bm.verts.new(q)
            f = bm.faces.new([vmap[i] for i in p.vertices])
            f.smooth = True
            for loop, i in zip(f.loops, p.vertices):
                q = (verts[i] - c) / rad
                loop[uv].uv = (0.5 + 0.5 * q[0] * side, 0.5 + 0.5 * q[2])
    occ_me = bpy.data.meshes.new("Evia.eye_occlusion")
    bm.to_mesh(occ_me)
    bm.free()
    obj = bpy.data.objects.new("Evia.eye_occlusion", occ_me)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = eyes.matrix_world.copy()
    # gradient texture: alpha = top shadow (v > .55 -> up to oc.top) + corners (|u - .5| > .28 -> oc.corner)
    S = 64
    v, u = np.mgrid[0:S, 0:S].astype(np.float32) / (S - 1)
    top = oc["top"] * np.clip((v - 0.50) / 0.30, 0, 1) ** 1.3
    corner = oc["corner"] * np.clip((np.abs(u - 0.5) - 0.26) / 0.22, 0, 1) ** 1.5
    alpha = np.clip(top + corner * (1 - top), 0, 0.9)
    arr = np.zeros((S, S, 4), dtype=np.float32)
    arr[..., 0], arr[..., 1], arr[..., 2] = (float(x) ** (1 / 2.2) for x in oc["color"])
    arr[..., 3] = alpha
    img = bpy.data.images.new("evia_eye_occlusion", S, S, alpha=True)
    img.pixels.foreach_set(arr.ravel())
    img.filepath_raw = os.path.join(work_dir or bpy.app.tempdir, "evia_eye_occlusion.png")
    img.file_format = "PNG"
    img.save()
    mat = bpy.data.materials.new("EviaEyeOcclusion")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    t.extension = "EXTEND"
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    mat.surface_render_method = "BLENDED"
    mat.use_backface_culling = True
    try:
        mat.use_transparent_shadow = True
    except AttributeError:
        pass
    occ_me.materials.append(mat)
    obj.visible_shadow = False
    if rig is not None:
        g = obj.vertex_groups.new(name="mixamorig:Head")
        g.add(list(range(len(occ_me.vertices))), 1.0, "REPLACE")
        mw = obj.matrix_world.copy()
        obj.parent = rig
        obj.matrix_world = mw
        md = obj.modifiers.new("Armature", "ARMATURE")
        md.object = rig
    print("EVIA EYE OCCLUSION verts", len(occ_me.vertices))
    return obj


def shorten_lower_lashes(lashes, eyes, cfg):
    """i016: lower lashes about half as long and half as many. Works on every shape-key layer (bmesh), so the
    copied expression keys stay consistent. Each strip is a loose part; a strip whose centre is below the eye
    centre is a lower lash; it is scaled toward its root (the vertex nearest the eyeball centre)."""
    import bmesh
    import numpy as np
    import evia_garments
    ev = np.array([v.co[:] for v in eyes.data.vertices])
    centres = {s: ev[ev[:, 0] * s > 0].mean(axis=0) for s in (1.0, -1.0)}
    bm = bmesh.new()
    bm.from_mesh(lashes.data)
    comps = evia_garments.components(bm)
    comps.sort(key=lambda c: min(v.index for v in c))
    layers = list(bm.verts.layers.shape.values())
    kill = []
    n_low = 0
    k = cfg.get("length", 0.5)
    for ci, comp in enumerate(comps):
        pts = np.array([v.co[:] for v in comp])
        m = pts.mean(axis=0)
        c = centres[1.0 if m[0] > 0 else -1.0]
        if m[2] >= c[2] - 0.002:
            continue
        n_low += 1
        if cfg.get("keep_every", 1) > 1 and n_low % cfg["keep_every"] != 0:
            kill.extend(comp)
            continue
        d = np.linalg.norm(pts - c, axis=1)
        root = comp[int(np.argmin(d))]
        r0 = root.co.copy()
        roots = [root[layer].copy() for layer in layers]
        for v in comp:
            v.co = r0 + (v.co - r0) * k
            for layer, rl in zip(layers, roots):
                v[layer] = rl + (v[layer] - rl) * k
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(lashes.data)
    bm.free()
    lashes.data.update()
    print("EVIA LOWER LASHES", n_low, "strips, removed verts", len(kill))


def teeth_materials(teeth, tongue, cfg, work_dir):
    """i016: teeth read as a dim grey sliver -> brighten the MakeHuman teeth texture to a natural ivory mean
    (sRGB target_srgb); tongue darker (it read as a bright pink slab when the mouth opens)."""
    import numpy as np
    for obj, mode in ((teeth, "teeth"), (tongue, "tongue")):
        if obj is None or not obj.material_slots:
            continue
        mat = obj.material_slots[0].material
        tex = next((n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)
        if tex is None:
            continue
        img = tex.image
        w, h = img.size
        a = np.zeros(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)
        if mode == "teeth":
            rgb = a[..., :3]
            mx, mn = rgb.max(axis=2), rgb.min(axis=2)
            sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
            enamel = (a[..., 3] > 0.5) & (sat < 0.30) & (mx > 0.25)         # not the pink gums
            mean = rgb[enamel].mean(axis=0) if enamel.any() else rgb.reshape(-1, 3).mean(axis=0)
            gain = np.array(cfg["target_srgb"], dtype=np.float32) / np.maximum(mean, 1e-3)
            wgt = (1.0 - np.clip((sat - 0.2) / 0.2, 0, 1))[..., None]
            a[..., :3] = np.clip(rgb * (1 - wgt) + rgb * gain * wgt, 0, 1)
            print("EVIA TEETH enamel mean sRGB", [round(float(x), 3) for x in mean], "gain",
                  [round(float(x), 2) for x in gain])
        else:
            a[..., :3] = a[..., :3] * cfg["tongue_mul"]
        new = bpy.data.images.new("evia_" + mode, w, h, alpha=True)
        new.pixels.foreach_set(a.ravel())
        new.filepath_raw = os.path.join(work_dir or bpy.app.tempdir, "evia_%s.png" % mode)
        new.file_format = "PNG"
        new.save()
        tex.image = new
        bsdf = principled_of(mat)
        if bsdf is not None:
            bsdf.inputs["Roughness"].default_value = 0.30 if mode == "teeth" else 0.45
            if mode == "teeth":
                bsdf.inputs["Subsurface Weight"].default_value = 0.15


def texture_eyes(eyes, cfg):
    """Eyes for BOTH Blender and the web: MakeHuman eye texture (CC0) on the eyeball + a separate clear, wet
    cornea material on the cornea shell (faces mapped to the white disc at UV ~(0.94, 0.06))."""
    src = eyes.material_slots[0].material
    tex = next((n.image for n in src.node_tree.nodes if n.type == "TEX_IMAGE"), None)
    if tex is not None and cfg.get("iris_ramp"):
        tex = recolour_eye_texture(tex, cfg, cfg.get("work_dir") or bpy.app.tempdir)
    elif tex is not None and cfg.get("iris_shift"):
        tex = shifted_eye_texture(tex, cfg["iris_shift"], cfg.get("work_dir") or bpy.app.tempdir,
                                  cfg.get("sclera_value", 1.0))
    me = eyes.data
    ball = bpy.data.materials.new("EviaEyeball")
    ball.use_nodes = True
    nt = ball.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = tex
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Hue"].default_value = cfg.get("hue", 0.5)
    hsv.inputs["Saturation"].default_value = cfg.get("saturation", 1.0)
    hsv.inputs["Value"].default_value = cfg.get("value", 1.0)
    nt.links.new(t.outputs["Color"], hsv.inputs["Color"])
    nt.links.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.38
    bsdf.inputs["Specular IOR Level"].default_value = 0.3
    bsdf.inputs["Subsurface Weight"].default_value = 0.3
    bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.5, 0.35)
    bsdf.inputs["Subsurface Scale"].default_value = 0.002
    # cornea: a clear, wet shell - Fresnel mix of transparent and a sharp glossy lobe (highlights + rim
    # reflections, nothing in front of the iris at normal incidence)
    cornea = bpy.data.materials.new("EviaCornea")
    cornea.use_nodes = True
    cn = cornea.node_tree
    cn.nodes.clear()
    out = cn.nodes.new("ShaderNodeOutputMaterial")
    fres = cn.nodes.new("ShaderNodeFresnel")
    fres.inputs["IOR"].default_value = 1.376
    tr = cn.nodes.new("ShaderNodeBsdfTransparent")
    gl = cn.nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.015
    mix = cn.nodes.new("ShaderNodeMixShader")
    cn.links.new(fres.outputs[0], mix.inputs[0])
    cn.links.new(tr.outputs[0], mix.inputs[1])
    cn.links.new(gl.outputs[0], mix.inputs[2])
    cn.links.new(mix.outputs[0], out.inputs["Surface"])
    cornea.surface_render_method = "BLENDED"
    cornea.use_backface_culling = True
    me.materials.clear()
    me.materials.append(ball)
    me.materials.append(cornea)
    uv = me.uv_layers.active.data
    n_c = 0
    for p in me.polygons:
        us = [uv[i].uv for i in p.loop_indices]
        cu = sum(u.x for u in us) / len(us)
        cv = sum(u.y for u in us) / len(us)
        if (cu - 0.94) ** 2 + (cv - 0.06) ** 2 < 0.07 ** 2:
            p.material_index = 1
            n_c += 1
    print("EVIA EYES cornea faces", n_c, "of", len(me.polygons))


def garment_material(obj, rgb, roughness, name=None):
    """Recolour a garment: keep its normal map if any, flat base colour (look-dev)."""
    for slot in obj.material_slots:
        mat = slot.material
        bsdf = principled_of(mat)
        if bsdf is None:
            continue
        nt = mat.node_tree
        for link in list(bsdf.inputs["Base Color"].links):
            nt.links.remove(link)
        bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        for link in list(bsdf.inputs["Alpha"].links):
            nt.links.remove(link)
        bsdf.inputs["Alpha"].default_value = 1.0
        if name:
            mat.name = name


# ----------------------------------------------------------------------------------------------- build

def body_height(body):
    import evia_skin
    co = evia_skin.shaped_coords(body)
    w = evia_skin.group_weights(body, "body")
    return float(co[w > 0.5][:, 2].max())


def build(outfit="lookdev", hair=True, rig_name="mixamo_unity", recipe=None, work_dir=None, face_keys=True):
    R = recipe or RECIPE
    t0 = time.time()
    E.reset_scene()
    E.enable_mpfb()
    macro = dict(R["macro"])
    race = macro.pop("race", None)
    body = E.new_human(E.evia_macro(race=race, **macro))
    E.set_targets(body, expand_targets(R["body"]))
    E.set_targets(body, expand_targets(R["face"]))
    E.set_targets(body, expand_targets(R["asym"]))
    rig = E.add_rig(body, rig_name)
    parts = {"body": body, "rig": rig}
    if R["eyes"].get("texture"):
        parts["eyes"] = E.add_part(body, "eyes", R["eyes"]["mesh"], material_type="MAKESKIN",
                                   alt_material=os.path.join(E.asset_dir("eyes", "materials"),
                                                             R["eyes"]["texture"] + ".mhmat"))
    else:
        parts["eyes"] = E.add_part(body, "eyes", R["eyes"]["mesh"], material_type="PROCEDURAL_EYES")
    parts["eyebrows"] = E.add_part(body, "eyebrows", R["eyebrows"])
    parts["eyelashes"] = E.add_part(body, "eyelashes", R["eyelashes"])
    parts["teeth"] = E.add_part(body, "teeth", "teeth_base")
    parts["tongue"] = E.add_part(body, "tongue", "tongue01")
    height = body_height(body)
    print("EVIA HEIGHT", round(height, 3), "t", round(time.time() - t0, 1))
    import evia_garments
    garments = []
    for spec in R["outfits"].get(outfit, []):
        if spec == "@labcoat":
            import evia_labcoat
            garments.append(evia_labcoat.build(body, rig, work_dir or bpy.app.tempdir, height,
                                               under=list(garments), **R.get("labcoat", {})))
        else:
            garments.append(evia_garments.add_garment(body, spec, height, work_dir or bpy.app.tempdir))
    parts["garments"] = garments
    print("EVIA GARMENTS", [g.name for g in garments], "t", round(time.time() - t0, 1))
    # face keys (on the base mesh, then copied onto brows / lashes / teeth)
    if face_keys:
        units = load_expression_units(body, R["expression_units"])
        import evia_expr
        units += evia_expr.add_smile_keys(body, R.get("smile"))
        interpolate_keys_to_children(body, units, {body, rig})
    if R.get("lower_lashes") and face_keys:
        # after the keys were copied (the MHCLO mapping is by vertex index; evia_export calls this itself after
        # its own face keys)
        shorten_lower_lashes(parts["eyelashes"], parts["eyes"], R["lower_lashes"])
    # materials
    import evia_skin
    evia_skin.apply(body, R["skin"], work_dir=work_dir, brows=parts["eyebrows"])
    print("EVIA SKIN", "t", round(time.time() - t0, 1))
    if R["eyes"].get("texture"):
        texture_eyes(parts["eyes"], dict(R["eyes"], work_dir=work_dir))
    else:
        set_procedural_eyes(parts["eyes"], R["eyes"])
    if R["eyes"].get("occlusion"):
        parts["eye_occlusion"] = eye_occlusion(parts["eyes"], rig, R["eyes"], work_dir)
    if R.get("teeth"):
        teeth_materials(parts["teeth"], parts["tongue"], R["teeth"], work_dir)
    tint_card_material(parts["eyebrows"], R["brow_tint"], 0.85)
    tint_card_material(parts["eyelashes"], (0.008, 0.006, 0.005), 0.7)
    if hair:
        import evia_hair
        import evia_pose
        tex = os.path.join(work_dir or bpy.app.tempdir, "evia_hair_atlas.png")
        # groom in the display pose (arms down), then return to rest: hair is skinned to Head/Neck/Spine2 only,
        # which the relaxed pose leaves untouched
        evia_pose.relaxed_arms(rig)
        parts["hair"] = evia_hair.build(body, rig, colliders=garments, texture_path=tex, **R.get("hair", {}))
        evia_pose.reset(rig)
    print("EVIA BUILD", outfit, round(time.time() - t0, 1), "s")
    return parts


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"outfit": "lookdev", "blend": None, "hair": True, "rig": "mixamo_unity", "recipe": None}
    i = 0
    while i < len(argv):
        key = argv[i].lstrip("-")
        if key == "no-hair":
            opts["hair"] = False
            i += 1
            continue
        opts[key] = argv[i + 1]
        i += 2
    return opts


def main():
    opts = parse_args()
    recipe = RECIPE
    if opts["recipe"]:
        with open(opts["recipe"]) as handle:
            patch = json.load(handle)
        recipe = json.loads(json.dumps(RECIPE))
        for key, value in patch.items():
            if isinstance(value, dict) and isinstance(recipe.get(key), dict):
                recipe[key].update(value)
            else:
                recipe[key] = value
    work = os.path.dirname(os.path.abspath(opts["blend"])) if opts["blend"] else None
    build(opts["outfit"], opts["hair"], opts["rig"], recipe, work_dir=work)
    if opts["blend"]:
        bpy.ops.wm.save_as_mainfile(filepath=opts["blend"])
        print("SAVED", opts["blend"])


if __name__ == "__main__":
    main()
