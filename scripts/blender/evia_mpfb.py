"""Evia character helpers on top of MPFB 2 (Blender 4.5 LTS, MPFB 2.0.17 extension).

WHAT
  A thin, deterministic layer over MPFB's own Python services (bl_ext.user_default.mpfb.services) so that
  the Evia build/export/look-dev scripts do not each re-discover the add-on, the asset folders or the call
  order. Nothing here downloads anything or touches Blender preferences on disk.

SETUP (one-off, per machine; see work/evia-rebuild/work/evia-char/MPFB-API-NOTES.md)
  Blender --command extension install-file -r user_default -e add-on-mpfb-v2.0.17.zip
  unzip the CC0 asset packs into  ~/Library/Application Support/Blender/4.5/extensions/.user/user_default/mpfb/data
  Scripts run with `--factory-startup` (the render lock does this), which does NOT enable user add-ons, so
  `enable_mpfb()` enables the extension for the running process only.

CONVENTIONS
  Blender Z-up, metres (MPFB scale 0.1 = decimetre base mesh -> metres). MPFB humans stand on Z=0 and face -Y;
  the character's LEFT is +X (same as public/character/proto). glTF export turns this into +Y up, facing +Z.

USE
  import sys; sys.path.insert(0, "<repo>/scripts/blender"); import evia_mpfb as E
  S = E.enable_mpfb()
  body = E.new_human(E.evia_macro())
  E.add_part(body, "eyes", "high-poly"); E.add_part(body, "hair", "long01")
"""

import glob
import math
import os

import bpy

MPFB_MODULE = "bl_ext.user_default.mpfb"
_SERVICES = None


# ----------------------------------------------------------------------------------------------- add-on

def enable_mpfb():
    """Enable the MPFB extension in this Blender process and return its `services` package."""
    global _SERVICES
    if _SERVICES is not None:
        return _SERVICES
    if MPFB_MODULE not in bpy.context.preferences.addons:
        result = bpy.ops.preferences.addon_enable(module=MPFB_MODULE)
        if "FINISHED" not in result:
            raise RuntimeError("Could not enable " + MPFB_MODULE + " - is the MPFB extension installed?")
    import importlib
    _SERVICES = importlib.import_module(MPFB_MODULE + ".services")
    return _SERVICES


def S():
    return enable_mpfb()


def user_data_dir():
    return S().LocationService.get_user_data()


def system_data_dir():
    return S().LocationService.get_mpfb_data()


def data_roots():
    """MPFB asset roots in MPFB's own priority order (system data first, then user data)."""
    return S().AssetService.get_available_data_roots()


# ----------------------------------------------------------------------------------------------- assets

def asset_dir(subdir, name):
    for root in data_roots():
        path = os.path.join(root, subdir, name)
        if os.path.isdir(path):
            return path
    raise FileNotFoundError(subdir + "/" + name + " is not installed in any MPFB data root")


def find_asset(subdir, name, ext="mhclo"):
    """Absolute path of <root>/<subdir>/<name>/*.<ext> (asset folder name, not file name)."""
    folder = asset_dir(subdir, name)
    hits = sorted(glob.glob(os.path.join(folder, "*." + ext)))
    if not hits:
        raise FileNotFoundError("No ." + ext + " in " + folder)
    return hits[0]


def list_assets(subdir, ext="mhclo"):
    """Sorted asset folder names under <root>/<subdir> that contain a .<ext> file directly."""
    names = set()
    for root in data_roots():
        for path in glob.glob(os.path.join(root, subdir, "*", "*." + ext)):
            names.add(os.path.basename(os.path.dirname(path)))
    return sorted(names)


def alternative_materials(subdir, name):
    """.mhmat files in sub-folders of an asset folder (MPFB 'alternative materials', e.g. hair colours)."""
    folder = asset_dir(subdir, name)
    return sorted(glob.glob(os.path.join(folder, "*", "*.mhmat")))


def mhclo_uuid(path):
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if line.startswith("uuid "):
                return line.split(None, 1)[1].strip()
    return None


def pack_metadata():
    """{asset_name: metadata} merged over every installed pack json (author, licence, description...)."""
    import json
    merged = {}
    for root in data_roots():
        for path in sorted(glob.glob(os.path.join(root, "packs", "*.json"))):
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            for key, value in data.items():
                value = dict(value)
                value["pack"] = os.path.basename(path)[:-5]
                merged[key] = value
    return merged


# ----------------------------------------------------------------------------------------------- humans

def evia_macro(**overrides):
    """MPFB macro details for Evia's base: adult woman, late 20s, European ancestry, otherwise average.

    MakeHuman age mapping: 0.0 = 1 y, 0.1875 = 11 y, 0.5 = 25 y, 1.0 = 90 y (linear between) -> 0.54 ~ 30 y.
    gender 0.0 = female, 1.0 = male. race values are normalised by MPFB.
    """
    macro = S().TargetService.get_default_macro_info_dict()
    macro.update({"gender": 0.0, "age": 0.54, "muscle": 0.5, "weight": 0.5, "proportions": 0.5,
                  "height": 0.5, "cupsize": 0.5, "firmness": 0.5})
    macro["race"] = {"caucasian": 1.0, "african": 0.0, "asian": 0.0}
    race = overrides.pop("race", None)
    if race:
        macro["race"].update(race)
    macro.update(overrides)
    return macro


def new_human(macro=None, name="Evia", mask_helpers=True, feet_on_ground=True):
    """HumanService.create_human with Evia defaults. Returns the base mesh object (named <name>)."""
    human = S().HumanService.create_human(mask_helpers=mask_helpers, detailed_helpers=True,
                                          extra_vertex_groups=True, feet_on_ground=feet_on_ground,
                                          scale=0.1, macro_detail_dict=macro or evia_macro())
    human.name = name
    return human


def set_targets(basemesh, targets):
    """Load/modify detail targets, e.g. {"nose-scale-horiz-decr": 0.3}. Names are target file stems."""
    T = S().TargetService
    for target, value in targets.items():
        existing = [k.name for k in basemesh.data.shape_keys.key_blocks] if basemesh.data.shape_keys else []
        if target in existing:
            T.set_target_value(basemesh, target, float(value))
            continue
        path = T.target_full_path(target)
        if path is None:
            raise FileNotFoundError("MPFB target not found: " + target)
        T.load_target(basemesh, path, weight=float(value), name=target)


def add_part(basemesh, subdir, name, material_type="MAKESKIN", alt_material=None, subdiv=0, **kwargs):
    """Fit an MHCLO asset (hair, eyebrows, eyelashes, eyes, teeth, tongue, clothes, proxymeshes) to the human.

    alt_material: absolute path (or 'folder/file.mhmat') of an alternative .mhmat for this asset.
    material_type: MAKESKIN (MakeHuman-style node tree), GAMEENGINE (plain Principled BSDF, export-friendly),
                   PROCEDURAL_EYES (eyes only) or NONE.
    """
    mhclo = find_asset(subdir, name, "mhclo" if subdir != "proxymeshes" else "proxy")
    alternative = None
    if alt_material:
        uuid = mhclo_uuid(mhclo)
        fragment = alt_material
        if os.path.isabs(alt_material):
            fragment = os.path.basename(os.path.dirname(alt_material)) + "/" + os.path.basename(alt_material)
        alternative = {uuid: fragment}
    asset_type = "Proxymeshes" if subdir == "proxymeshes" else subdir
    return S().HumanService.add_mhclo_asset(mhclo, basemesh, asset_type=asset_type, subdiv_levels=subdiv,
                                            material_type=material_type, alternative_materials=alternative,
                                            **kwargs)


def set_skin(basemesh, skin_name, skin_type="MAKESKIN", material_instances=False):
    """Skin from <data>/skins/<skin_name>/*.mhmat.

    skin_type: MAKESKIN | GAMEENGINE (export-friendly) | ENHANCED | ENHANCED_SSS | LAYERED (MPFB v2 skin).
    """
    mhmat = find_asset("skins", skin_name, "mhmat")
    S().HumanService.set_character_skin(mhmat, basemesh, skin_type=skin_type,
                                        material_instances=material_instances)
    return basemesh.material_slots[0].material if basemesh.material_slots else None


def add_rig(basemesh, rig_name="mixamo_unity"):
    """Built-in MPFB rig + its weights: default, default_no_toes, game_engine, game_engine_with_breast,
    mixamo, mixamo_unity, cmu_mb, openpose, or 'rigify.human' / 'rigify.human_toes' (meta-rig)."""
    return S().HumanService.add_builtin_rig(basemesh, rig_name, import_weights=True)


def children_of(obj):
    return [o for o in bpy.data.objects if o.parent == obj]


UPPER_ARMS = {  # rig -> (left, right); MPFB ".L"/"_l"/"Left" is the character's left = +X
    "game_engine": ("upperarm_l", "upperarm_r"),
    "game_engine_with_breast": ("upperarm_l", "upperarm_r"),
    "default": ("upperarm01.L", "upperarm01.R"),
    "default_no_toes": ("upperarm01.L", "upperarm01.R"),
    "mixamo": ("mixamorig:LeftArm", "mixamorig:RightArm"),
    "mixamo_unity": ("mixamorig:LeftArm", "mixamorig:RightArm"),
}


def lower_arms(rig, rig_name, degrees=38.0):
    """Swing both upper arms down from MPFB's A-pose rest by `degrees` about world Y (pose only)."""
    import mathutils
    left, right = UPPER_ARMS[rig_name]
    for bone_name, sign in ((left, 1.0), (right, -1.0)):
        pose_bone = rig.pose.bones[bone_name]
        matrix = pose_bone.matrix.copy()
        head = matrix.to_translation()
        spin = mathutils.Matrix.Rotation(math.radians(degrees) * sign, 4, "Y")
        pose_bone.matrix = (mathutils.Matrix.Translation(head) @ spin @
                            mathutils.Matrix.Translation(-head) @ matrix)
        bpy.context.view_layer.update()


def freeze_human(basemesh):
    """Bake shape keys + pose + every modifier (helper/delete masks) into plain meshes, delete the rig and
    re-parent the parts to the base mesh. For look-dev layouts only (the result can no longer be animated)."""
    rig = basemesh.parent if basemesh.parent and basemesh.parent.type == "ARMATURE" else None
    owners = {basemesh} | ({rig} if rig else set())
    parts = [o for o in bpy.data.objects if o.type == "MESH" and o.parent in owners and o != basemesh]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in [basemesh] + parts:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
        world = obj.matrix_world.copy()
        obj.modifiers.clear()
        if obj.data.shape_keys:
            obj.shape_key_clear()
        obj.data = mesh
        obj.parent = None
        obj.matrix_world = world
    for part in parts:
        attach(part, basemesh)
    if rig is not None:
        bpy.data.objects.remove(rig, do_unlink=True)
    return basemesh


# ----------------------------------------------------------------------------------------------- scene / render

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def set_eevee(scene, width, height, samples=24):
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.eevee.taa_render_samples = samples
    try:
        scene.eevee.use_raytracing = False
    except AttributeError:
        pass
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"


def world_color(scene, rgb=(0.62, 0.6, 0.57), strength=0.55):
    world = bpy.data.worlds.new("sheet_world")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    background.inputs[1].default_value = strength
    scene.world = world


def sun(name, rot_deg, energy, angle_deg=12.0, color=(1.0, 1.0, 1.0)):
    data = bpy.data.lights.new(name, "SUN")
    data.energy = energy
    data.angle = math.radians(angle_deg)
    data.color = color
    obj = bpy.data.objects.new(name, data)
    obj.rotation_euler = tuple(math.radians(a) for a in rot_deg)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def studio_suns():
    """Soft portrait-ish lighting that is identical for every cell of a grid (sun lights, no falloff).
    Camera looks along +Y at figures facing -Y; key comes from camera-left/above, fill from the right,
    rim from behind."""
    sun("key", (55, 0, -35), 2.6, 18, (1.0, 0.97, 0.93))
    sun("fill", (70, 0, 40), 0.9, 30, (0.93, 0.96, 1.0))
    sun("rim", (60, 0, 180), 1.6, 10, (1.0, 0.98, 0.95))


def ortho_camera(center_x, center_z, width, height, distance=20.0):
    data = bpy.data.cameras.new("sheet_cam")
    data.type = "ORTHO"
    scene = bpy.context.scene
    aspect = scene.render.resolution_x / scene.render.resolution_y
    # sensor fit AUTO: ortho_scale spans the LONGER image side
    if aspect >= 1.0:
        data.ortho_scale = max(width, height * aspect)
    else:
        data.ortho_scale = max(height, width / aspect)
    data.clip_start = 0.1
    data.clip_end = distance * 2
    cam = bpy.data.objects.new("sheet_cam", data)
    cam.location = (center_x, -distance, center_z)
    cam.rotation_euler = (math.radians(90), 0.0, 0.0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


_LABEL_MAT = None


def label(text, location, size, parent=None, color=(0.05, 0.05, 0.06)):
    """Flat text object facing the -Y camera. Emission-only so it reads the same under any light."""
    global _LABEL_MAT
    if _LABEL_MAT is None:
        _LABEL_MAT = bpy.data.materials.new("label")
        _LABEL_MAT.use_nodes = True
        nodes = _LABEL_MAT.node_tree.nodes
        nodes.clear()
        out = nodes.new("ShaderNodeOutputMaterial")
        emit = nodes.new("ShaderNodeEmission")
        emit.inputs[0].default_value = (color[0], color[1], color[2], 1.0)
        _LABEL_MAT.node_tree.links.new(emit.outputs[0], out.inputs[0])
    curve = bpy.data.curves.new("label", "FONT")
    curve.body = text
    curve.size = size
    curve.align_x = "CENTER"
    curve.align_y = "TOP"
    obj = bpy.data.objects.new("label", curve)
    obj.data.materials.append(_LABEL_MAT)
    obj.rotation_euler = (math.radians(90), 0.0, 0.0)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def cell_root(name, location, yaw_deg=0.0):
    root = bpy.data.objects.new(name, None)
    root.location = location
    root.rotation_euler = (0.0, 0.0, math.radians(yaw_deg))
    bpy.context.scene.collection.objects.link(root)
    return root


def attach(obj, parent):
    """Parent with identity inverse: obj's current world matrix is taken as its local matrix under parent."""
    local = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_parent_inverse.identity()
    obj.matrix_basis = local


def human_group(basemesh):
    """Base mesh + all objects parented (directly) to it (hair, eyes, brows, clothes...)."""
    return [basemesh] + children_of(basemesh)


def place_group(basemesh, root):
    """Hang a whole MPFB human (at origin) under a cell root empty."""
    kids = children_of(basemesh)
    attach(basemesh, root)
    for kid in kids:
        if kid.parent != basemesh:
            attach(kid, basemesh)


def linked_copy(basemesh, root):
    """Second view of the same human: object copies sharing mesh data, hung under another root."""
    kids = children_of(basemesh)
    body = basemesh.copy()
    bpy.context.scene.collection.objects.link(body)
    body.parent = root
    body.matrix_parent_inverse.identity()
    body.matrix_basis = basemesh.matrix_basis.copy()
    for kid in kids:
        dup = kid.copy()
        bpy.context.scene.collection.objects.link(dup)
        dup.parent = body
        dup.matrix_parent_inverse.identity()
        dup.matrix_basis = kid.matrix_basis.copy()
    return body


def flat_material(obj, name, rgb, roughness=0.8):
    """Replace every material slot of obj with one plain Principled BSDF (look-dev neutral garments)."""
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return mat


def render_png(path):
    scene = bpy.context.scene
    scene.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    return path
