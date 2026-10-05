"""Export EVIA for the web (glTF 2.0 binary) - Blender 4.5 LTS + MPFB 2.0.17. Deterministic.

  tools/blender-render.sh scripts/blender/evia_export.py -- --outfit consult|lounge \
      --out public/character/evia/evia-consult.glb [--work <dir for .blend + maps>] [--report <json>]

PIPELINE
  evia_build.build(face_keys=False)  ->  bake MPFB modelling targets into the base mesh
  -> face keys: ARKit-52 + Meta visemes if the faceunits01 / visemes02 packs are installed, otherwise the 34
     MakeHuman expression units as `mh_<unit>` (stand-in) -> copied onto brows / lashes / teeth / tongue
  -> MPFB ExportService: apply helper + delete masks while KEEPING shape keys
  -> glTF-friendly materials (every look-dev node graph replaced by Principled + direct image links):
       skin     albedo + roughness (G of a baked map) + normal map, IOR 1.4, OPAQUE, single-sided
       hair     strand atlas, alpha MASK (0.5; on the web prefer alphaTest 0.3 + alphaToCoverage),
                COLOR_0 = hair AO (three.js: vertexColors: true), double-sided, custom volume normals
       brows / lashes   recoloured copies of their alpha cards, BLEND
       eyes     eyeball texture OPAQUE + cornea shell (alpha .08, glossy) BLEND - no transmission
       garments flat colour + normal maps (coat twill via KHR_texture_transform), double-sided
       coat label slot `EviaCoatLabel` with UV set 1 (`label`, 0..1 over the left-chest patch) - blank
  -> rig in the motion prototype's convention (public/character/proto/README.md): Mixamo names without
     prefix, fingers LeftIndex1.., `Root` removed (root joint = Hips), non-deforming LeftIndexTip /
     RightIndexTip markers, bone rolls re-aligned (+Z forward on trunk / limbs, palm normal on hands /
     fingers, up on feet). Extra MPFB bones kept: Jaw, LeftEye/RightEye, eyelids, breasts, buttocks.
  -> i016: REST POSE = the relaxed display pose (evia_pose.relaxed_arms: arms down, soft elbows, relaxed
     fingers + thumbs) instead of MPFB's A-pose: every skinned mesh (and every shape key) is re-baked through
     the armature in that pose, then the pose is applied as the new rest. The hair was groomed in this pose,
     so a raw rest-pose frame can no longer show hair colliding with raised arms.
  -> GLB (WEBP textures, <=4 influences, morph normals) -> re-imported into an empty scene and checked.
"""

import importlib
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evia_mpfb as E  # noqa: E402
import evia_build as B  # noqa: E402

FINGERS = ("Thumb", "Index", "Middle", "Ring", "Pinky")


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"outfit": "consult", "out": None, "work": None, "report": None, "rig": "mixamo_unity",
         "images": "WEBP", "hair_seg": "0.018"}
    for i in range(0, len(argv), 2):
        o[argv[i].lstrip("-")] = argv[i + 1]
    return o


# ----------------------------------------------------------------------------------------------- materials

def _tex_of(mat):
    if mat is None or not mat.use_nodes:
        return None
    return next((n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)


def new_principled(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    return mat, mat.node_tree.nodes["Principled BSDF"], mat.node_tree


def image_node(nt, img, non_color=False):
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return t


def save_array_png(name, arr, path, colorspace="sRGB"):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


def pixels(img):
    w, h = img.size
    a = np.zeros(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def skin_export(body, work):
    old = body.material_slots[0].material
    imgs = {n.image.name: n.image for n in old.node_tree.nodes if n.type == "TEX_IMAGE" and n.image}
    albedo = next(i for k, i in imgs.items() if "albedo" in k)
    rough = next(i for k, i in imgs.items() if "rough" in k)
    normal = next(i for k, i in imgs.items() if "normal" in k)
    r = pixels(rough)
    val = r[..., 0]                                 # i016: absolute roughness (R channel of the look-dev map)
    mr = np.zeros_like(r)
    mr[..., 1] = val
    mr[..., 3] = 1.0
    rough_final = save_array_png("evia_skin_mr", mr, os.path.join(work, "evia_skin_mr.png"), "Non-Color")
    mat, bsdf, nt = new_principled("EviaSkin")
    ta = image_node(nt, albedo)
    nt.links.new(ta.outputs["Color"], bsdf.inputs["Base Color"])
    tr = image_node(nt, rough_final, True)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tr.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    tn = image_node(nt, normal, True)
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = 0.20          # i016 (was .12: no visible skin texture on the web)
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["IOR"].default_value = 1.4
    bsdf.inputs["Specular IOR Level"].default_value = 0.45
    # i016: glTF has no SSS - a warm sheen (KHR_materials_sheen) softens the grazing-angle look of the skin
    bsdf.inputs["Sheen Weight"].default_value = 0.25
    bsdf.inputs["Sheen Tint"].default_value = (1.0, 0.76, 0.66, 1.0)
    bsdf.inputs["Sheen Roughness"].default_value = 0.5
    mat.use_backface_culling = True
    body.data.materials.clear()
    body.data.materials.append(mat)


def hair_export(hair):
    import evia_hair
    HD = evia_hair.DEFAULTS
    old = hair.material_slots[0].material
    imgs = [n.image for n in old.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
    img = next(i for i in imgs if "normal" not in i.name)
    nimg = next((i for i in imgs if "normal" in i.name), None)
    mat, bsdf, nt = new_principled("EviaHair")
    if nimg is not None:
        tn = image_node(nt, nimg, True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = HD["normal_map_strength"]
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    t = image_node(nt, img)
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    rnd = nt.nodes.new("ShaderNodeMath")
    rnd.operation = "ROUND"
    nt.links.new(t.outputs["Alpha"], rnd.inputs[0])
    nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = HD["roughness"]          # same values as the look-dev shader
    bsdf.inputs["Specular IOR Level"].default_value = HD["specular"]
    bsdf.inputs["IOR"].default_value = 1.45
    mat.use_backface_culling = False
    hair.data.materials.clear()
    hair.data.materials.append(mat)
    ca = hair.data.color_attributes.get("hair_ao")
    if ca is not None:
        hair.data.color_attributes.active_color = ca


def card_export(obj, rgb_srgb, work, name):
    img = _tex_of(obj.material_slots[0].material)
    if img is None:                       # mindfront brows / lashes: real hair-strip geometry, no texture
        mat, bsdf, nt = new_principled(name)
        lin = [((c + 0.055) / 1.055) ** 2.4 for c in rgb_srgb]
        bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.6
        mat.use_backface_culling = False
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        return
    a = pixels(img)
    out = np.zeros_like(a)
    out[..., 0], out[..., 1], out[..., 2] = rgb_srgb
    out[..., 3] = a[..., 3]
    new = save_array_png(name, out, os.path.join(work, name + ".png"))
    mat, bsdf, nt = new_principled(name)
    t = image_node(nt, new)
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.65
    mat.use_backface_culling = False
    mat.surface_render_method = "BLENDED"
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def eyes_export(eyes):
    ball, cornea = eyes.material_slots[0].material, eyes.material_slots[1].material
    img = _tex_of(ball)
    mat, bsdf, nt = new_principled("EviaEyeball")
    t = image_node(nt, img)
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.25
    mat.use_backface_culling = True
    eyes.material_slots[0].material = mat
    # cornea: a thin, glossy, alpha-BLENDED shell (alpha .08). i014 used KHR_materials_transmission: the GLB
    # re-import rendered dark, glassy "dead" eyes (no refraction without ray tracing), and transmission costs
    # three.js an extra render pass. A faint blended shell keeps the iris visible everywhere and adds the wet
    # specular highlight.
    cm, cb, _cn = new_principled("EviaCornea")
    cb.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    cb.inputs["Roughness"].default_value = 0.03
    cb.inputs["IOR"].default_value = 1.376
    cb.inputs["Specular IOR Level"].default_value = 1.0
    cb.inputs["Alpha"].default_value = 0.08
    cm.surface_render_method = "BLENDED"
    cm.use_backface_culling = True
    eyes.material_slots[1].material = cm


def garment_export(obj):
    """Clean glTF material per garment slot: base colour factor, roughness, sheen, and the garment's own normal
    map when it has one (Bump nodes / extra maps from the MakeHuman materials are dropped)."""
    for slot in obj.material_slots:
        old = slot.material
        if old is None or not old.use_nodes or old.name.startswith("EviaLabCoat") or old.name == "EviaCoatLabel":
            continue
        ob = next((n for n in old.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        nmap = next((n for n in old.node_tree.nodes if n.type == "NORMAL_MAP"), None)
        nimg = None
        if nmap is not None and nmap.inputs["Color"].links:
            src = nmap.inputs["Color"].links[0].from_node
            nimg = src.image if src.type == "TEX_IMAGE" else None
        mat, bsdf, nt = new_principled(old.name + ".web")
        if ob is not None:
            bsdf.inputs["Base Color"].default_value = ob.inputs["Base Color"].default_value
            bsdf.inputs["Roughness"].default_value = ob.inputs["Roughness"].default_value
            bsdf.inputs["Sheen Weight"].default_value = ob.inputs["Sheen Weight"].default_value
            bsdf.inputs["Specular IOR Level"].default_value = 0.35
        if nimg is not None:
            downscale_image(nimg, 1024)
            tn = image_node(nt, nimg, True)
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = nmap.inputs["Strength"].default_value
            nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        mat.use_backface_culling = False
        slot.material = mat


def simple_textured(obj, name, rough):
    img = _tex_of(obj.material_slots[0].material) if obj.material_slots else None
    mat, bsdf, nt = new_principled(name)
    if img is not None:
        t = image_node(nt, img)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    mat.use_backface_culling = True
    obj.data.materials.clear()
    obj.data.materials.append(mat)


# ----------------------------------------------------------------------------------------------- web slimming

def thin_strips(obj, keep_every=2, keep_min_verts=0):
    """mindfront brows / lashes are thousands of little hair strips (one loose part each). For the web keep
    every `keep_every`-th strip (deterministic) - half the vertices and morph data, same shape and colour."""
    import bmesh
    import evia_garments
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    comps = evia_garments.components(bm)
    comps.sort(key=lambda c: min(v.index for v in c))
    kill = [v for i, c in enumerate(comps) if i % keep_every != 0 and len(c) > keep_min_verts for v in c]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(comps)


def keep_keys(obj, prefixes):
    """Drop shape keys that do not belong to this part (a brow does not need the mouth units)."""
    keys = obj.data.shape_keys
    if not keys:
        return 0
    removed = 0
    for kb in list(keys.key_blocks)[1:]:
        if not any(kb.name.startswith(p) for p in prefixes):
            obj.shape_key_remove(kb)
            removed += 1
    if len(obj.data.shape_keys.key_blocks) == 1:
        obj.shape_key_remove(obj.data.shape_keys.key_blocks[0])
    return removed


def downscale_image(img, size):
    if max(img.size) > size:
        img.scale(size, size)
    return img


# ----------------------------------------------------------------------------------------------- rig

def proto_name(name):
    n = name.replace("mixamorig:", "")
    for side in ("Left", "Right"):
        for f in FINGERS:
            if n.startswith(side + "Hand" + f):
                return side + f + n[len(side + "Hand" + f):]
    return n


def to_proto_rig(rig):
    """Rename to the motion prototype's names, drop Root and end bones, add IndexTip markers, re-roll."""
    for b in rig.data.bones:
        b.name = proto_name(b.name)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig.data.edit_bones
    removed = []
    for b in list(eb):
        if b.name == "Root" or b.name.endswith("4") or b.name.endswith("_End") or b.name.endswith("End"):
            if b.name.startswith("Left") or b.name.startswith("Right") or b.name in ("Root", "HeadTop_End"):
                for child in b.children:
                    child.parent = b.parent
                removed.append(b.name)
                eb.remove(b)
    fwd = Vector((0.0, -1.0, 0.0))
    up = Vector((0.0, 0.0, 1.0))
    for b in eb:
        n = b.name
        if n.endswith("Foot") or n.endswith("ToeBase"):
            b.align_roll(up)
        elif n.endswith("Hand") or any(f in n for f in FINGERS):
            pass                                          # palm normals set below from the hand
        elif n in ("Jaw",) or "Eye" in n or "Orbicularis" in n:
            pass
        else:
            b.align_roll(fwd)
    for side, sgn in (("Left", 1.0), ("Right", -1.0)):
        hand = eb.get(side + "Hand")
        if hand is None:
            continue
        # palm normal: perpendicular to the hand axis and to the index->pinky spread, pointing down/in
        i1, p1 = eb.get(side + "Index1"), eb.get(side + "Pinky1")
        axis = (hand.tail - hand.head).normalized()
        spread = (p1.head - i1.head).normalized() if (i1 and p1) else Vector((0, 1, 0))
        palm = axis.cross(spread).normalized()
        if palm.z > 0:
            palm = -palm
        hand.align_roll(palm)
        for b in eb:
            if b.name.startswith(side) and any(f in b.name for f in FINGERS):
                b.align_roll(palm)
        i3 = eb.get(side + "Index3")
        if i3 is not None:
            tip = eb.new(side + "IndexTip")
            d = (i3.tail - i3.head).normalized()
            tip.head = i3.tail
            tip.tail = i3.tail + d * 0.012
            tip.parent = i3
            tip.use_deform = False
            tip.align_roll(palm)
    bpy.ops.object.mode_set(mode="OBJECT")
    return removed


# ----------------------------------------------------------------------------------------------- rest pose

def bake_rest_pose(rig, pose_fn):
    """Make `pose_fn(rig)`'s pose the armature's REST pose without changing how anything looks: every mesh
    deformed by `rig` gets its basis AND each shape key re-evaluated through the armature in that pose (Blender's
    own evaluation, key by key), then the pose is applied as rest (pose.armature_apply). Meshes the pose does
    not move (the hair: Head / Neck / Spine2 only) are left untouched, so their custom normals survive."""
    import bmesh  # noqa: F401
    pose_fn(rig)
    dg = bpy.context.evaluated_depsgraph_get()
    report = {}
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and
              any(m.type == "ARMATURE" and m.object == rig for m in o.modifiers)]
    for ob in meshes:
        me = ob.data
        n = len(me.vertices)
        keys = me.shape_keys.key_blocks if me.shape_keys else []
        saved = {kb.name: kb.value for kb in keys}
        for kb in keys:
            kb.value = 0.0
        others = [m for m in ob.modifiers if m.type != "ARMATURE" and m.show_viewport]
        for m in others:
            m.show_viewport = False

        def evaluated():
            dg.update()
            ev = ob.evaluated_get(dg)
            tmp = ev.to_mesh()
            arr = np.zeros(len(tmp.vertices) * 3)
            tmp.vertices.foreach_get("co", arr)
            ok = len(tmp.vertices) == n
            ev.to_mesh_clear()
            return arr.reshape(-1, 3) if ok else None

        base = evaluated()
        orig = np.zeros(n * 3)
        me.vertices.foreach_get("co", orig)
        orig = orig.reshape(n, 3)
        if base is None or np.abs(base - orig).max() < 1e-6:
            report[ob.name] = "unchanged"
            for m in others:
                m.show_viewport = True
            for kb in keys:
                kb.value = saved[kb.name]
            continue
        new_keys = {}
        for kb in keys[1:] if keys else []:
            kb.value = 1.0
            new_keys[kb.name] = evaluated()
            kb.value = 0.0
        me.vertices.foreach_set("co", base.ravel())
        if keys:
            keys[0].data.foreach_set("co", base.ravel())
            for kb in keys[1:]:
                kb.data.foreach_set("co", new_keys[kb.name].ravel())
        me.update()
        for m in others:
            m.show_viewport = True
        for kb in keys:
            kb.value = saved[kb.name]
        report[ob.name] = "baked (%d keys), max move %.1f mm" % (len(new_keys), float(np.abs(base - orig).max()) * 1000)
    bpy.context.view_layer.objects.active = rig
    for o in bpy.context.selected_objects:
        o.select_set(False)
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    # the modifiers now see rest == pose: check that nothing moves any more
    dg.update()
    worst = 0.0
    for ob in meshes:
        ev = ob.evaluated_get(dg)
        tmp = ev.to_mesh()
        if len(tmp.vertices) == len(ob.data.vertices):
            a = np.zeros(len(tmp.vertices) * 3)
            b = np.zeros(len(tmp.vertices) * 3)
            tmp.vertices.foreach_get("co", a)
            ob.data.vertices.foreach_get("co", b)
            worst = max(worst, float(np.abs(a - b).max()))
        ev.to_mesh_clear()
    report["_max_residual_mm"] = round(worst * 1000, 3)
    print("EVIA REST POSE", report)
    return report


# ----------------------------------------------------------------------------------------------- face keys

def face_keys(body, rig):
    S = E.S()
    FS = S.FaceService
    face_module = importlib.import_module(E.MPFB_MODULE + ".services.faceservice")
    have_fu = FS.is_faceunits01_installed()
    have_vis = S.TargetService.target_full_path("viseme_aa") is not None
    names = []
    if have_fu or have_vis:
        FS.load_targets(body, load_microsoft_visemes=False, load_meta_visemes=have_vis,
                        load_arkit_faceunits=have_fu)
        names += list(face_module.ARKIT_FACEUNITS) if have_fu else []
        names += list(face_module.META_VISEMES) if have_vis else []
        source = "MPFB faceunits01/visemes02 packs"
    else:
        folder = os.path.join(E.system_data_dir(), "targets", "expression", "units", "caucasian")
        units = sorted(f[:-len(".target.gz")] for f in os.listdir(folder) if f.endswith(".target.gz"))
        names = B.load_expression_units(body, units)
        source = "MakeHuman expression units (stand-in: faceunits01 / visemes02 not installed)"
    import evia_expr
    names += evia_expr.add_smile_keys(body, B.RECIPE.get("smile"))
    made = B.interpolate_keys_to_children(body, names, {body, rig})
    return names, source, made


# ----------------------------------------------------------------------------------------------- check

def reimport_report(glb):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    rep = {"meshes": {}, "bones": 0}
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if arm:
        rep["bones"] = len(arm.data.bones)
        rep["bone_names"] = [b.name for b in arm.data.bones]
    for o in bpy.data.objects:
        if o.type != "MESH" or o.name.startswith("Icosphere"):   # importer's bone-shape helper
            continue
        me = o.data
        groups = {g.index: g.name for g in o.vertex_groups}
        unweighted = 0
        maxinf = 0
        bad_sum = 0
        for v in me.vertices:
            ws = [g.weight for g in v.groups if g.weight > 0]
            maxinf = max(maxinf, len(ws))
            if not ws:
                unweighted += 1
            elif abs(sum(ws) - 1.0) > 0.01:
                bad_sum += 1
        rep["meshes"][o.name] = {
            "verts": len(me.vertices), "tris": sum(len(p.vertices) - 2 for p in me.polygons),
            "morphs": len(me.shape_keys.key_blocks) - 1 if me.shape_keys else 0,
            "materials": [m.name for m in me.materials if m], "max_influences": maxinf,
            "unweighted": unweighted, "weight_sum_off": bad_sum, "uv_sets": [u.name for u in me.uv_layers],
            "color_attrs": [c.name for c in me.color_attributes]}
    return rep


def main():
    o = args()
    t0 = time.time()
    work = o["work"] or os.path.join(bpy.app.tempdir, "evia-export")
    os.makedirs(work, exist_ok=True)
    recipe = json.loads(json.dumps(B.RECIPE))
    recipe.setdefault("hair", {})["seg"] = float(o["hair_seg"])
    parts = B.build(o["outfit"], True, o["rig"], recipe, work_dir=work, face_keys=False)
    body, rig = parts["body"], parts["rig"]
    S = E.S()
    S.TargetService.bake_targets(body)
    names, source, made = face_keys(body, rig)
    if recipe.get("lower_lashes"):
        B.shorten_lower_lashes(parts["eyelashes"], parts["eyes"], recipe["lower_lashes"])
    S.ExportService.bake_modifiers_remove_helpers(body, bake_masks=True, bake_subdiv=False, remove_helpers=True)
    # web slimming: half of the brow / lash hair strips, only the keys each part needs, 1K skin normal map
    strips = {"brows": thin_strips(parts["eyebrows"]), "lashes": thin_strips(parts["eyelashes"])}
    # brows keep only the brow units (the eye units act on the lids below them; each extra key on the ~12.5k
    # exported brow vertices costs ~0.3 MB: positions + normals)
    kept = {"brows": keep_keys(parts["eyebrows"], ("mh_eyebrows", "brow")),
            "lashes": keep_keys(parts["eyelashes"], ("mh_eye-", "eye")),
            "teeth": keep_keys(parts["teeth"], ("mh_mouth-open", "jaw", "mouth", "viseme")),
            "tongue": keep_keys(parts["tongue"], ("mh_mouth-open", "jaw", "tongue", "mouth", "viseme"))}
    for g in parts.get("garments", []):
        if g is not None and g.data.shape_keys:
            keep_keys(g, ())
    # materials
    skin_export(body, work)
    for n in body.material_slots[0].material.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image and "normal" in n.image.name:
            downscale_image(n.image, 1024)
    hair_export(parts["hair"])
    card_export(parts["eyebrows"], (0.082, 0.059, 0.045), work, "evia_brows")   # sRGB of RECIPE brow_tint
    card_export(parts["eyelashes"], (0.07, 0.05, 0.045), work, "evia_lashes")
    eyes_export(parts["eyes"])
    simple_textured(parts["teeth"], "EviaTeeth", 0.35)
    for g in parts.get("garments", []):
        if g is not None:
            garment_export(g)
    simple_textured(parts["tongue"], "EviaTongue", 0.45)
    import evia_pose
    rest = bake_rest_pose(rig, evia_pose.relaxed_arms)
    removed = to_proto_rig(rig)
    body.name = "EviaBody"
    rig.name = "Evia"
    # export only the character
    for ob in bpy.data.objects:
        ob.select_set(False)
    def skinned(ob):
        return ob.type == "MESH" and any(m.type == "ARMATURE" and m.object == rig for m in ob.modifiers)
    keep = [rig] + [ob for ob in bpy.data.objects if skinned(ob)]
    for ob in keep:
        ob.select_set(True)
    out = os.path.abspath(o["out"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(work, "evia-%s-export.blend" % o["outfit"]))
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_apply=False,
                              export_skins=True, export_influence_nb=4, export_morph=True,
                              export_morph_normal=True, export_animations=False, export_yup=True,
                              export_image_format=o["images"], export_image_quality=85,
                              export_vertex_color="NAME", export_vertex_color_name="hair_ao",
                              export_all_vertex_colors=False,
                              export_texcoords=True, export_normals=True, export_tangents=False)
    rep = {"outfit": o["outfit"], "glb": out, "bytes": os.path.getsize(out), "face_keys": len(names),
           "strips_before_thinning": strips, "keys_removed_per_part": kept,
           "face_key_source": source, "keys_copied": made, "bones_removed": removed, "rest_pose": rest,
           "build_seconds": round(time.time() - t0, 1)}
    rep["reimport"] = reimport_report(out)
    print("EVIA EXPORT", json.dumps({k: v for k, v in rep.items() if k != "reimport"}))
    if o["report"]:
        with open(o["report"], "w") as handle:
            json.dump(rep, handle, indent=1)


if __name__ == "__main__":
    main()
