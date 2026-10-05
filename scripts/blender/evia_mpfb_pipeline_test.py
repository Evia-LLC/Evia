"""MPFB -> glTF pipeline TEST for Evia (Blender 4.5 LTS + MPFB 2.0.17). Not the final character.

WHAT
  Proves, end to end and headless, that an MPFB woman can be rigged, given facial shape keys, cleaned for the
  web and exported as a skinned, morphing GLB that re-imports correctly:
    1. Evia base macro (female ~30 y, European ancestry), MPFB rig (default: mixamo_unity), then eyes, brows,
       lashes, teeth, tongue, hair (long01), one jacket (toigo_female_suit) - all fitted + weighted by MPFB.
    2. Materials: MPFB "GAMEENGINE" model (plain Principled BSDF + textures) so glTF can carry them; alpha set
       explicitly per part: skin/teeth/tongue/clothes OPAQUE, hair/brows/lashes/eyes MASK (Math:Round clip).
    3. Face shape keys: ARKit face units (52) + Meta/Oculus visemes (15) when the faceunits01/visemes02 packs are
       installed; otherwise the 34 MakeHuman "expression units" that ship inside MPFB (caucasian set) as a
       stand-in, named "mh_<unit>". Keys are interpolated onto brows/lashes/teeth/tongue/hair via MHCLO.
    4. Export prep: bake modelling targets, apply helper + clothes delete-group masks while KEEPING shape keys
       (MPFB ExportService), strip the "mixamorig:" bone prefix (three.js drops ':' from node names), export
       GLB (+Y up, skins, morphs with normals, <=4 influences, images as WEBP or PNG).
    5. Re-import the GLB into an empty scene and report bones / meshes / weights / shape keys / materials, plus
       the raw glTF JSON (targetNames, alphaMode, image bytes). Optional check render of the RE-IMPORTED rig
       posed (head turn, arm down) with a mouth key and a blink applied.

RUN
  LOCK=/Users/olaajibade/Documents/Codex/2026-09-16/hi/work/evia-rebuild/tools/blender-render.sh
  $LOCK scripts/blender/evia_mpfb_pipeline_test.py -- --out <workdir> [--rig mixamo_unity] [--images WEBP|AUTO]
        [--render]  [--glb <path>]
  Writes <workdir>/pipeline-<rig>.glb, pipeline-<rig>.json (report), pipeline-<rig>.blend, and with --render
  pipeline-<rig>-check.png. Never writes into the repo unless --glb points there.
"""

import importlib
import json
import math
import os
import struct
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evia_mpfb as E  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"out": None, "rig": "mixamo_unity", "images": "WEBP", "render": False, "glb": None,
            "hair": "long01", "clothes": "toigo_female_suit"}
    i = 0
    while i < len(argv):
        key = argv[i].lstrip("-")
        if key == "render":
            opts["render"] = True
            i += 1
            continue
        opts[key] = argv[i + 1]
        i += 2
    return opts


# ----------------------------------------------------------------------------------------------- face keys

def mh_expression_units_dir():
    return os.path.join(E.system_data_dir(), "targets", "expression", "units", "caucasian")


def load_face_keys(basemesh, report):
    S = E.S()
    FS = S.FaceService
    have_faceunits = FS.is_faceunits01_installed()
    have_meta = S.TargetService.target_full_path("viseme_aa") is not None
    report["face_packs"] = {"faceunits01": have_faceunits, "visemes02": have_meta}
    names = []
    if have_faceunits or have_meta:
        FS.load_targets(basemesh, load_microsoft_visemes=False, load_meta_visemes=have_meta,
                        load_arkit_faceunits=have_faceunits)
        face_module = importlib.import_module(E.MPFB_MODULE + ".services.faceservice")
        if have_faceunits:
            names += list(face_module.ARKIT_FACEUNITS)
        if have_meta:
            names += list(face_module.META_VISEMES)
        report["face_key_source"] = "MPFB packs"
    else:
        folder = mh_expression_units_dir()
        for fname in sorted(os.listdir(folder)):
            if not fname.endswith(".target.gz"):
                continue
            name = "mh_" + fname[:-len(".target.gz")]
            S.TargetService.load_target(basemesh, os.path.join(folder, fname), weight=0.0, name=name)
            names.append(name)
        report["face_key_source"] = "MakeHuman expression units shipped in MPFB (stand-in; packs missing)"
    return names


def interpolate_keys_to_children(basemesh, key_names, root):
    """Same algorithm as MPFB FaceService.interpolate_targets, but for any key names: each child vertex follows
    the barycentric blend of the 3 base-mesh vertices its MHCLO maps it to (plus the MHCLO offset)."""
    S = E.S()
    Mhclo = importlib.import_module(E.MPFB_MODULE + ".entities.clothes.mhclo").Mhclo
    keys = basemesh.data.shape_keys.key_blocks
    basis = [v.co.copy() for v in basemesh.data.vertices]
    made = {}
    for child in [o for o in bpy.data.objects if o.parent == root and o.type == "MESH" and o != basemesh]:
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
                off = (src.data[v0].co - basis[v0]) * w0 + (src.data[v1].co - basis[v1]) * w1 + \
                      (src.data[v2].co - basis[v2]) * w2
                if off.length > 0.0001:
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

# eyes too: MakeHuman eyes carry a cornea shell whose texture alpha is 0 over the iris (opaque = white eyeball)
ALPHA_PARTS = ("hair", "eyebrows", "eyelashes", "eyes")


def principled(material):
    if not material or not material.use_nodes:
        return None
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def set_alpha_mode(obj, mode, single_sided=False):
    for slot in obj.material_slots:
        mat = slot.material
        bsdf = principled(mat)
        if bsdf is None:
            continue
        # glTF doubleSided = not backface culling. Closed skin-like meshes are single sided.
        mat.use_backface_culling = single_sided
        tree = mat.node_tree
        alpha = bsdf.inputs["Alpha"]
        src = alpha.links[0].from_socket if alpha.links else None
        for link in list(alpha.links):
            tree.links.remove(link)
        alpha.default_value = 1.0
        if mode == "MASK" and src is not None:
            rnd = tree.nodes.new("ShaderNodeMath")
            rnd.operation = "ROUND"
            tree.links.new(src, rnd.inputs[0])
            tree.links.new(rnd.outputs[0], alpha)
        elif mode == "BLEND" and src is not None:
            tree.links.new(src, alpha)


def part_kind(obj):
    try:
        return str(E.S().ObjectService.get_object_type(obj)).lower()
    except Exception:  # noqa: BLE001
        return ""


# ----------------------------------------------------------------------------------------------- glb json

def read_glb_json(path):
    with open(path, "rb") as handle:
        magic, version, length = struct.unpack("<4sII", handle.read(12))
        chunk_len, chunk_type = struct.unpack("<I4s", handle.read(8))
        doc = json.loads(handle.read(chunk_len))
    return doc


def summarize_gltf(doc):
    out = {"meshes": [], "skins": [], "materials": [], "images": [], "nodes": len(doc.get("nodes", [])),
           "extensionsUsed": doc.get("extensionsUsed", [])}
    views = doc.get("bufferViews", [])
    for mesh in doc.get("meshes", []):
        prims = mesh["primitives"]
        targets = len(prims[0].get("targets", [])) if prims else 0
        names = (mesh.get("extras") or {}).get("targetNames", [])
        attrs = sorted(prims[0]["attributes"].keys()) if prims else []
        verts = sum(doc["accessors"][p["attributes"]["POSITION"]]["count"] for p in prims)
        tris = sum(doc["accessors"][p["indices"]]["count"] // 3 for p in prims if "indices" in p)
        out["meshes"].append({"name": mesh.get("name"), "primitives": len(prims), "verts": verts, "tris": tris,
                              "morph_targets": targets, "targetNames_sample": names[:6],
                              "targetNames_count": len(names), "attributes": attrs})
    for skin in doc.get("skins", []):
        joints = [doc["nodes"][j].get("name") for j in skin["joints"]]
        out["skins"].append({"name": skin.get("name"), "joints": len(joints), "joint_names": joints})
    for mat in doc.get("materials", []):
        out["materials"].append({"name": mat.get("name"), "alphaMode": mat.get("alphaMode", "OPAQUE"),
                                 "alphaCutoff": mat.get("alphaCutoff"), "doubleSided": mat.get("doubleSided", False),
                                 "baseColorTexture": "baseColorTexture" in mat.get("pbrMetallicRoughness", {}),
                                 "normalTexture": "normalTexture" in mat})
    for img in doc.get("images", []):
        size = views[img["bufferView"]]["byteLength"] if "bufferView" in img else None
        out["images"].append({"name": img.get("name"), "mime": img.get("mimeType"), "bytes": size})
    return out


def _qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz)


def _qrot(q, v):
    x, y, z, w = q
    vq = (v[0], v[1], v[2], 0.0)
    r = _qmul(_qmul(q, vq), (-x, -y, -z, w))
    return (r[0], r[1], r[2])


def joint_rest_frames(doc, names):
    """World rest position and local +Y/+Z of joints in glTF space, straight from the node TRS (what three.js
    sees after GLTFLoader). Assumes no non-uniform scale (MPFB rigs have none)."""
    nodes = doc["nodes"]
    parent = {}
    for i, node in enumerate(nodes):
        for c in node.get("children", []):
            parent[c] = i
    index = {n.get("name"): i for i, n in enumerate(nodes)}

    def world(i):
        node = nodes[i]
        t = node.get("translation", [0.0, 0.0, 0.0])
        q = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
        s = node.get("scale", [1.0, 1.0, 1.0])
        if i in parent:
            pt, pq, ps = world(parent[i])
            scaled = (t[0] * ps[0], t[1] * ps[1], t[2] * ps[2])
            rt = _qrot(pq, scaled)
            return ((pt[0] + rt[0], pt[1] + rt[1], pt[2] + rt[2]), _qmul(pq, tuple(q)),
                    (ps[0] * s[0], ps[1] * s[1], ps[2] * s[2]))
        return (tuple(t), tuple(q), tuple(s))

    out = {}
    for name in names:
        if name not in index:
            continue
        t, q, _s = world(index[name])
        r = lambda v: [round(c, 3) for c in v]  # noqa: E731
        out[name] = {"pos": r(t), "localY": r(_qrot(q, (0, 1, 0))), "localZ": r(_qrot(q, (0, 0, 1)))}
    return out


# ----------------------------------------------------------------------------------------------- re-import check

def reimport_report(glb):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    rep = {"armatures": [], "meshes": []}
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            rep["armatures"].append({"name": obj.name, "bones": len(obj.data.bones),
                                     "bone_names": [b.name for b in obj.data.bones],
                                     "height_m": round(max((obj.matrix_world @ b.head_local).z
                                                           for b in obj.data.bones), 3)})
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        max_inf, unweighted, bad_sum = 0, 0, 0
        for v in mesh.vertices:
            groups = [g for g in v.groups if g.weight > 0.0]
            max_inf = max(max_inf, len(groups))
            if not groups:
                unweighted += 1
            elif abs(sum(g.weight for g in groups) - 1.0) > 0.02:
                bad_sum += 1
        keys = [k.name for k in mesh.shape_keys.key_blocks][1:] if mesh.shape_keys else []
        arm = [m.object.name for m in obj.modifiers if m.type == "ARMATURE" and m.object]
        rep["meshes"].append({"name": obj.name, "verts": len(mesh.vertices), "polys": len(mesh.polygons),
                              "vertex_groups": len(obj.vertex_groups), "max_influences": max_inf,
                              "unweighted_verts": unweighted, "weight_sum_off": bad_sum,
                              "shape_keys": len(keys), "shape_key_sample": keys[:8],
                              "materials": [s.material.name if s.material else None for s in obj.material_slots],
                              "armature": arm,
                              "dims_m": [round(d, 3) for d in obj.dimensions]})
    return rep


def check_render(path, key_names):
    """Pose the RE-IMPORTED rig in world space (arms down from the A-pose, head turned), apply a mouth key and a
    one-sided blink, and render a waist-up EEVEE frame."""
    import mathutils
    scene = bpy.context.scene
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    pose = arm.pose.bones
    to_arm = arm.matrix_world.inverted()

    def spin(name, axis, deg):
        bone = pose.get(name)
        if bone is None:
            return False
        head_world = arm.matrix_world @ bone.matrix.to_translation()
        rot = (mathutils.Matrix.Translation(head_world) @ mathutils.Matrix.Rotation(math.radians(deg), 4, axis) @
               mathutils.Matrix.Translation(-head_world))
        bone.matrix = to_arm @ rot @ arm.matrix_world @ bone.matrix
        bpy.context.view_layer.update()
        return True

    posed = {}
    for left, right in (("LeftArm", "RightArm"), ("upperarm01.L", "upperarm01.R"), ("upperarm_l", "upperarm_r")):
        if left in pose:
            posed[left] = spin(left, "Y", 38)
            posed[right] = spin(right, "Y", -38)
            break
    for head in ("Head", "head"):
        if head in pose:
            posed[head] = spin(head, "Z", 14)
            break
    wanted = {"mh_mouth-open": 0.35, "mh_mouth-corner-puller": 0.5, "mh_eye-right-closure": 1.0,
              "jawOpen": 0.3, "mouthSmileLeft": 0.5, "mouthSmileRight": 0.5, "eyeBlinkRight": 1.0}
    applied = {}
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.data.shape_keys:
            for kb in obj.data.shape_keys.key_blocks:
                if kb.name in wanted:
                    kb.value = wanted[kb.name]
                    applied[kb.name] = wanted[kb.name]
    E.set_eevee(scene, 900, 1000, 32)
    E.world_color(scene, (0.6, 0.58, 0.55), 0.6)
    E.studio_suns()
    data = bpy.data.cameras.new("cam")
    data.lens = 70
    cam = bpy.data.objects.new("cam", data)
    scene.collection.objects.link(cam)
    # glTF re-import is Z-up in Blender again; the character faces -Y.
    target = mathutils.Vector((0.0, 0.0, 1.30))
    cam.location = (0.35, -2.1, 1.40)
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    E.render_png(path)
    return {"posed": posed, "shape_keys_applied": applied,
            "armature_matrix_is_identity": arm.matrix_world == mathutils.Matrix.Identity(4)}


# ----------------------------------------------------------------------------------------------- main

def main():
    opts = parse_args()
    out = opts["out"] or os.getcwd()
    os.makedirs(out, exist_ok=True)
    rig_name = opts["rig"]
    tag = "pipeline-" + rig_name.replace(".", "_")
    glb = opts["glb"] or os.path.join(out, tag + ".glb")
    report = {"rig": rig_name, "blender": bpy.app.version_string, "timings": {}}
    t0 = time.time()

    S = E.enable_mpfb()
    scene = bpy.context.scene
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    body = E.new_human(E.evia_macro(), name="Evia")
    rig = E.add_rig(body, rig_name)
    parts = [("eyes", "high-poly"), ("eyebrows", "eyebrow001"), ("eyelashes", "eyelashes01"),
             ("teeth", "teeth_base"), ("tongue", "tongue01"), ("hair", opts["hair"]), ("clothes", opts["clothes"])]
    for subdir, name in parts:
        E.add_part(body, subdir, name, material_type="GAMEENGINE")
    E.set_skin(body, "young_caucasian_female", skin_type="GAMEENGINE")
    report["timings"]["build"] = round(time.time() - t0, 1)

    # 1) bake modelling targets (macro shape keys) into the mesh
    S.TargetService.bake_targets(body)
    # 2) face keys on the base mesh, then onto the fitted parts
    key_names = load_face_keys(body, report)
    root = body.parent if body.parent else body
    report["interpolated_to_children"] = interpolate_keys_to_children(body, key_names, root)
    report["timings"]["face_keys"] = round(time.time() - t0, 1)
    # 3) apply helper + delete-group masks, keep shape keys
    S.ExportService.bake_modifiers_remove_helpers(body, bake_masks=True, bake_subdiv=False, remove_helpers=True,
                                                  also_proxy=False)
    report["timings"]["bake_masks"] = round(time.time() - t0, 1)
    # 4) bone names: strip the Mixamo prefix (three.js sanitises ':' out of node names anyway)
    renamed = 0
    for bone in rig.data.bones:
        if bone.name.startswith("mixamorig:"):
            bone.name = bone.name[len("mixamorig:"):]
            renamed += 1
    report["bones_renamed"] = renamed
    # 5) alpha per part
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        kind = part_kind(obj)
        set_alpha_mode(obj, "MASK" if kind in ALPHA_PARTS else "OPAQUE",
                       single_sided=obj == body or kind in ("eyes", "teeth", "tongue"))
    # names in the GLB
    body.name = "Evia_body"
    rig.name = "Evia"
    for obj in [o for o in bpy.data.objects if o.type == "MESH" and o != body]:
        kind = part_kind(obj) or "part"
        obj.name = "Evia_" + kind
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        obj.data.name = obj.name
    report["blender_side"] = {
        "meshes": {o.name: {"verts": len(o.data.vertices),
                            "shape_keys": len(o.data.shape_keys.key_blocks) - 1 if o.data.shape_keys else 0,
                            "modifiers": [m.type for m in o.modifiers]}
                   for o in bpy.data.objects if o.type == "MESH"},
        "bones": len(rig.data.bones)}
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, tag + ".blend"))

    # 6) export
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    t1 = time.time()
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=False, export_skins=True, export_influence_nb=4,
                              export_all_influences=False, export_morph=True, export_morph_normal=True,
                              export_morph_tangent=False, export_animations=False, export_def_bones=False,
                              export_image_format=opts["images"], export_image_quality=85,
                              export_materials="EXPORT", export_tangents=False,
                              export_rest_position_armature=True)
    report["timings"]["export"] = round(time.time() - t1, 1)
    report["glb"] = glb
    report["glb_bytes"] = os.path.getsize(glb)
    doc = read_glb_json(glb)
    report["gltf"] = summarize_gltf(doc)
    report["gltf"]["images_total_bytes"] = sum((i["bytes"] or 0) for i in report["gltf"]["images"])
    probe = ["Root", "Hips", "Spine", "Spine2", "Neck", "Head", "Jaw", "LeftEye", "LeftShoulder", "LeftArm",
             "LeftForeArm", "LeftHand", "LeftHandIndex1", "LeftHandIndex3", "LeftHandThumb1", "LeftUpLeg",
             "LeftLeg", "LeftFoot", "LeftToeBase", "RightArm", "RightHand",
             "root", "spine05", "head", "jaw", "upperarm01.L", "lowerarm01.L", "wrist.L", "eye.L",
             "pelvis", "upperarm_l", "lowerarm_l", "hand_l", "head"]
    frames = joint_rest_frames(doc, probe)
    report["joint_rest_frames_gltf"] = frames
    for arm, fore in (("LeftArm", "LeftForeArm"), ("upperarm01.L", "lowerarm01.L"), ("upperarm_l", "lowerarm_l")):
        if arm in frames and fore in frames:
            a, b = frames[arm]["pos"], frames[fore]["pos"]
            d = [b[k] - a[k] for k in range(3)]
            report["a_pose_arm_below_horizontal_deg"] = round(math.degrees(math.atan2(-d[1], math.hypot(d[0], d[2]))), 1)

    # 7) re-import into an empty scene and check
    report["reimport"] = reimport_report(glb)
    if opts["render"]:
        report["check_render"] = check_render(os.path.join(out, tag + "-check.png"), key_names)
    report["timings"]["total"] = round(time.time() - t0, 1)
    with open(os.path.join(out, tag + ".json"), "w") as handle:
        json.dump(report, handle, indent=1)
    print("REPORT", os.path.join(out, tag + ".json"), report["glb_bytes"], "bytes")


if __name__ == "__main__":
    main()
