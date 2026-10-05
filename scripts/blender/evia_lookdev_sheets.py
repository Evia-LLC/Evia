"""Evia look-dev CONTACT SHEETS of the installed MPFB assets (Blender 4.5 LTS + MPFB 2.0.17, EEVEE).

WHAT
  One labelled PNG per run: a grid of MPFB women (Evia's base macro: female, ~30 y, European ancestry) each
  wearing one asset, so hair / skin / eyebrow / eyelash / clothing candidates can be compared side by side.
  It is a selection aid, not the character: every cell uses stock MPFB assets and default MakeHuman materials
  (MAKESKIN node trees), neutral studio suns and AgX. Nothing is exported.

  sheets   hair        every hair asset, 3/4-front + back view (pages of 12)
           haircolors  long01 in its default + all alternative colour materials, + ponytail01 default/brown
           skin        every skin .mhmat on the same head, head-and-shoulders 3/4 (pages of 16)
           browlash    every eyebrow (front) and every eyelash asset (3/4) on the same head (one page)
           browclose   eye-band close-up of every eyebrow;  lashclose  eye-band close-up of every eyelash (3/4)
           clothes     clothing that could become a lounge outfit or a white lab coat, full body (pages of 12)

RUN (through the render lock; one render per process)
  LOCK=/Users/olaajibade/Documents/Codex/2026-09-16/hi/work/evia-rebuild/tools/blender-render.sh
  $LOCK scripts/blender/evia_lookdev_sheets.py -- --sheet hair --page 1 --out <dir>
  options: --samples 32  --scale 1.0 (resolution multiplier)  --list (print the page plan and exit)
           --norender (build + save <sheet>-p<page>.blend only; no render, so no lock needed)
  Output: <dir>/<sheet>-p<page>.png and <dir>/<sheet>-p<page>.json (cell labels + asset paths + licences).
"""

import json
import math
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evia_mpfb as E  # noqa: E402

BASE_SKIN = "young_caucasian_female"
BASE_BROWS = "eyebrow001"
BASE_LASHES = "eyelashes01"
BASE_HAIR = "long01"
BASE_TOP = "toigo_camisole_top"      # modesty layer for hair/skin cells (CC0, shirts01)
SHEET_RIG = "game_engine"            # only used to swing the arms down, then baked away

CLOTHES_PAGES = [
    # 1: jackets / suits / robes -> lab-coat bases
    ["toigo_female_suit", "toigo_female_suit_2", "toigo_female_double-breasted_suit", "female_elegantsuit01",
     "male_worksuit01", "male_elegantsuit01", "toigo_male_double-breasted_suit", "toigo_male_suit_3",
     "toigo_male_suit_tie_and_jacket", "toigo_suit_with_dinner_jacket", "toigo_suit_with_jacket_and_bowtie",
     "mindfront_kimono"],
    # 2: tops / casual sets -> lounge outfit + what goes under a coat (rendered waist-up: no separate trousers)
    ["female_casualsuit01", "female_casualsuit02", "female_sportsuit01", "toigo_fisherman_sweater",
     "toigo_turtleneck_halter_top", "toigo_basic_tucked_t-shirt", "joepal_crude_t-shirt_female",
     "toigo_camisole_top", "toigo_keyhole_tank_top", "toigo_bodice-style_top",
     "skalldyrssuppe_tube_top_funky_colors", "namuhekam_male_polo_shirt", "elvs_crude_t-shirt_male"],
    # 3: dresses
    ["aethelraed_flapper_dress", "toigo_bodice_dress_with_lace_ruffle_skirt", "toigo_camisole_dress_with_full_skirt",
     "toigo_cut_out_dress", "toigo_dress_with_tiered_skirt", "toigo_halter_dress_knee_length",
     "toigo_halter_dress_midi", "toigo_halter_dress_with_fluted_skirt", "toigo_keyhole_neck_dress",
     "toigo_shift_dress", "toigo_strapless_ruffle_top_dress", "wdg_mycenaean_tunic"],
    # 4: remaining (male casual sets with trousers)
    ["male_casualsuit01", "male_casualsuit02", "male_casualsuit03", "male_casualsuit04", "male_casualsuit05",
     "male_casualsuit06"],
]

# Grid geometry per sheet: columns, rows, cell pitch (x, z), visible window (z0, z1) relative to the cell
# floor, cell width, body crop height (verts below are masked so rows never overlap), label size, resolution.
LAYOUT = {
    "hair":       dict(cols=4, rows=3, px=1.00, pz=0.97, z0=0.93, z1=1.84, crop=0.95, label=0.045, res=(2400, 1760)),
    "haircolors": dict(cols=4, rows=3, px=1.00, pz=0.97, z0=0.93, z1=1.84, crop=0.95, label=0.045, res=(2400, 1760)),
    "skin":       dict(cols=4, rows=4, px=0.44, pz=0.47, z0=1.22, z1=1.69, crop=1.27, label=0.020, res=(1600, 1720)),
    "browlash":   dict(cols=7, rows=5, px=0.21, pz=0.29, z0=1.37, z1=1.65, crop=1.40, label=0.0115, res=(2000, 1960)),
    # eye-band close-ups: head masked to z 1.462..1.556 so rows can sit 0.11 m apart
    "browclose":  dict(cols=6, rows=5, px=0.16, pz=0.11, z0=1.455, z1=1.558, crop=1.462, crop_top=1.556,
                       label=0.0065, res=(2400, 1720)),
    "lashclose":  dict(cols=3, rows=3, px=0.17, pz=0.11, z0=1.455, z1=1.558, crop=1.462, crop_top=1.556,
                       label=0.0065, res=(1800, 1180), xoff=0.02),
    "clothes":    dict(cols=6, rows=2, px=0.80, pz=2.05, z0=-0.06, z1=1.90, crop=None, label=0.05, res=(2000, 1720)),
    # tops page: waist-up (no separate trousers are installed)
    "clothes2":   dict(cols=7, rows=2, px=0.80, pz=1.00, z0=0.86, z1=1.84, crop=0.90, crop_all=True, label=0.045,
                       res=(2800, 1030)),
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"sheet": "hair", "page": 1, "out": None, "samples": 32, "scale": 1.0, "list": False,
            "norender": False}
    i = 0
    while i < len(argv):
        key = argv[i].lstrip("-")
        if key in ("list", "norender"):
            opts[key] = True
            i += 1
            continue
        opts[key] = argv[i + 1]
        i += 2
    opts["page"] = int(opts["page"])
    opts["samples"] = int(opts["samples"])
    opts["scale"] = float(opts["scale"])
    return opts


# ----------------------------------------------------------------------------------------------- page plans

def plan(sheet, page):
    """[(label, spec)] for one page. spec keys: hair, hair_mat, skin, brows, lashes, clothes, yaw, views."""
    cells = []
    if sheet == "hair":
        names = E.list_assets("hair")
        chunk = names[(page - 1) * 12: page * 12]
        for name in chunk:
            cells.append((name, dict(hair=name)))
    elif sheet == "haircolors":
        cells.append(("long01 (default)", dict(hair="long01")))
        for mat in E.alternative_materials("hair", "long01"):
            cells.append(("long01 / " + os.path.basename(os.path.dirname(mat)), dict(hair="long01", hair_mat=mat)))
        cells.append(("ponytail01 (default)", dict(hair="ponytail01")))
        for mat in E.alternative_materials("hair", "ponytail01"):
            if "brown" in mat:
                cells.append(("ponytail01 / " + os.path.basename(os.path.dirname(mat)),
                              dict(hair="ponytail01", hair_mat=mat)))
        cells = cells[:12]
    elif sheet == "skin":
        names = E.list_assets("skins", "mhmat")
        chunk = names[(page - 1) * 16: page * 16]
        for name in chunk:
            cells.append((name, dict(skin=name, yaw=-22)))
    elif sheet == "browlash":
        for name in E.list_assets("eyebrows"):
            cells.append(("brows: " + name.replace("mindfront_", "mf_"), dict(brows=name, yaw=-8)))
        for name in E.list_assets("eyelashes"):
            cells.append(("lashes: " + name.replace("mindfront_", "mf_"), dict(lashes=name, yaw=-42)))
    elif sheet == "browclose":
        for name in E.list_assets("eyebrows"):
            cells.append((name, dict(brows=name, yaw=-6)))
    elif sheet == "lashclose":
        for name in E.list_assets("eyelashes"):
            cells.append((name, dict(lashes=name, yaw=-38)))
    elif sheet == "clothes":
        for name in CLOTHES_PAGES[page - 1]:
            cells.append((name, dict(clothes=name, yaw=-18)))
    else:
        raise ValueError("unknown sheet " + sheet)
    return cells


# ----------------------------------------------------------------------------------------------- build

def crop_below(basemesh, z_min, z_max=None):
    """Mask away base-mesh vertices below z_min (and above z_max) so stacked rows cannot overlap."""
    group = basemesh.vertex_groups.new(name="sheet_crop")
    keep = [v.index for v in basemesh.data.vertices
            if v.co.z >= z_min and (z_max is None or v.co.z <= z_max)]
    group.add(keep, 1.0, "REPLACE")
    mod = basemesh.modifiers.new("sheet_crop", "MASK")
    mod.vertex_group = "sheet_crop"


def build_cell(index, spec, lay, shared, sheet):
    body = E.new_human(E.evia_macro(), name="cell%02d" % index)
    rig = E.add_rig(body, SHEET_RIG)
    E.add_part(body, "eyes", "high-poly")
    E.add_part(body, "eyebrows", spec.get("brows", BASE_BROWS))
    E.add_part(body, "eyelashes", spec.get("lashes", BASE_LASHES))
    hair = spec.get("hair")
    if hair is None and "clothes" in spec:
        hair = BASE_HAIR
    if hair:
        E.add_part(body, "hair", hair, alt_material=spec.get("hair_mat"))
    if "clothes" in spec:
        E.add_part(body, "clothes", spec["clothes"])
    elif sheet in ("hair", "haircolors"):   # skin cells are cropped above the bust instead
        top = E.add_part(body, "clothes", BASE_TOP)
        E.flat_material(top, "neutral_top", (0.55, 0.53, 0.50))   # the stock print is loud pink paisley
    skin = spec.get("skin")
    if skin:
        E.set_skin(body, skin)
    else:
        if "skin_mat" not in shared:
            shared["skin_mat"] = E.set_skin(body, BASE_SKIN)
        else:
            body.data.materials.clear()
            body.data.materials.append(shared["skin_mat"])
    E.lower_arms(rig, SHEET_RIG, 38.0)
    E.freeze_human(body)
    if lay["crop"] is not None:
        crop_below(body, lay["crop"], lay.get("crop_top"))
        if lay.get("crop_all"):   # also cut garments / hair (waist-up page: casual sets carry trousers)
            for part in E.children_of(body):
                if part.type == "MESH":
                    crop_below(part, lay["crop"], lay.get("crop_top"))
    return body


def main():
    opts = parse_args()
    E.enable_mpfb()
    sheet, page = opts["sheet"], opts["page"]
    lay = LAYOUT["clothes2" if (sheet == "clothes" and page == 2) else sheet]
    cells = plan(sheet, page)
    if opts["list"] or not cells:
        for label_text, spec in cells:
            print("CELL", label_text, spec)
        print("CELLS", len(cells))
        return
    out_dir = opts["out"] or os.getcwd()
    t0 = time.time()

    scene = bpy.context.scene
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    cols = lay["cols"]
    rows = min(lay["rows"], -(-len(cells) // cols))          # drop empty rows
    width = int(lay["res"][0] * opts["scale"])
    height = int(lay["res"][1] * opts["scale"] * rows / lay["rows"])
    E.set_eevee(scene, width, height, opts["samples"])
    E.world_color(scene)
    E.studio_suns()

    shared = {}
    meta = {"sheet": sheet, "page": page, "cells": [], "blender": bpy.app.version_string}
    packs = E.pack_metadata()
    two_views = sheet in ("hair", "haircolors")
    for i, (label_text, spec) in enumerate(cells):
        col, row = i % cols, i // cols
        cx = col * lay["px"]
        ox = lay.get("xoff", 0.0)          # shift a yawed head back into its cell
        cz = -row * lay["pz"]
        body = build_cell(i, spec, lay, shared, sheet)
        if two_views:
            front = E.cell_root("cell%02d_front" % i, (cx - 0.24, 0.0, cz), -32)
            back = E.cell_root("cell%02d_back" % i, (cx + 0.24, 0.0, cz), 180)
            E.place_group(body, front)
            E.linked_copy(body, back)
        else:
            root = E.cell_root("cell%02d" % i, (cx + ox, 0.0, cz), spec.get("yaw", 0))
            E.place_group(body, root)
        E.label(label_text, (cx, -1.5, cz + lay["z0"] - 0.004), lay["label"])
        asset = spec.get("hair") or spec.get("skin") or spec.get("brows") or spec.get("lashes") or spec.get("clothes")
        info = packs.get(asset, {})
        meta["cells"].append({"label": label_text, "spec": {k: v for k, v in spec.items()},
                              "author": info.get("author"), "license": info.get("license"),
                              "pack": info.get("pack"), "description": info.get("description")})
        print("BUILT", i, label_text, round(time.time() - t0, 1))

    total_w = cols * lay["px"]
    total_h = rows * lay["pz"]
    top = lay["z1"]
    bottom = -(rows - 1) * lay["pz"] + lay["z0"] - lay["label"] * 1.6
    E.ortho_camera((cols - 1) * lay["px"] / 2.0, (top + bottom) / 2.0, total_w + 0.02,
                   (top - bottom) + 0.02)
    name = "%s-p%d" % (sheet, page)
    if opts["norender"]:
        os.makedirs(out_dir, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, name + ".blend"))
        print("BUILD-ONLY", round(time.time() - t0, 1), "s")
        return
    png = E.render_png(os.path.join(out_dir, name + ".png"))
    meta["seconds"] = round(time.time() - t0, 1)
    meta["resolution"] = [width, height]
    with open(os.path.join(out_dir, name + ".json"), "w") as handle:
        json.dump(meta, handle, indent=1)
    print("WROTE", png, meta["seconds"], "s")


if __name__ == "__main__":
    main()
