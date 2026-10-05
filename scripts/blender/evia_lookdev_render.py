"""Look-dev renders of an Evia .blend (built by evia_build.py). ONE render per Blender process (EEVEE Next is
only reliable that way headless on this Mac); Cycles for final beauty checks.

RUN (through the render lock)
  tools/blender-render.sh scripts/blender/evia_lookdev_render.py -- --blend <evia.blend> --out <png>
      [--shot portrait34|portraitfront|profile|face34|facefront|full34|fullfront|fullback|bust34]
      [--light studio|consult] [--expr neutral|soft|smile] [--engine eevee|cycles] [--res 800x1000]
      [--samples 64] [--yaw DEG (override camera azimuth)] [--dof 1]
      [--exprjson '{"mh_mouth-corner-puller":0.4}' (extra / overriding shape-key values, no spaces)]
      [--hairshadow transparent|opaque]  (default transparent; opaque = no speckle but hard card shadows)

CONVENTIONS
  MPFB space: Z up, she faces -Y, her left is +X. Camera azimuth 0 = straight in front; negative azimuth puts
  the camera on HER RIGHT, so she appears turned toward image-right (like the Scan mockup, ref4).
  Lights are defined in her frame (azimuth from her front, + = her left) so shots stay comparable.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SHOTS = {
    # name: (target xyz, vertical span m, azimuth deg, elevation deg, lens mm, head yaw/tilt/nod deg)
    "portrait34": ((0.0, -0.035, 1.455), 0.52, -34, 4, 85, (-4, 3, 2)),
    "portraitfront": ((0.0, -0.035, 1.455), 0.52, 0, 3, 85, (0, 2, 2)),
    "profile": ((0.0, -0.02, 1.49), 0.36, -88, 2, 85, (0, 0, 1)),
    "face34": ((0.0, -0.06, 1.475), 0.30, -32, 3, 100, (-4, 3, 2)),
    "facefront": ((0.0, -0.06, 1.475), 0.30, 0, 2, 100, (0, 2, 2)),
    "bust34": ((0.0, -0.03, 1.36), 0.80, -30, 3, 70, (-4, 3, 2)),
    "full34": ((0.0, 0.0, 0.88), 1.86, -30, 2, 50, (-3, 2, 1)),
    "fullfront": ((0.0, 0.0, 0.88), 1.86, 0, 2, 50, (0, 0, 1)),
    "fullback": ((0.0, 0.0, 0.88), 1.86, 180, 2, 50, (0, 0, 0)),
    "back34": ((0.0, 0.02, 1.25), 1.0, 150, 4, 60, (0, 0, 0)),
}

EXPRESSIONS = {
    "neutral": {},
    "soft": {"mh_mouth-corner-puller": 0.16, "mh_eye-left-slit": 0.08, "mh_eye-right-slit": 0.08,
             "mh_eyebrows-left-inner-up": 0.06, "mh_eyebrows-right-inner-up": 0.06},
    "smile": {"mh_mouth-corner-puller": 0.55, "mh_mouth-parling": 0.25, "mh_eye-left-slit": 0.2,
              "mh_eye-right-slit": 0.2, "mh_mouth-elevation": 0.1},
    # i011-i014 "warm" = MakeHuman units (corner-puller .9, parting .32, eye slit .16): critics read it as a
    # pout / smirk (nothing moved above the mouth). Kept as "warm_mh" for comparison.
    "warm_mh": {"mh_mouth-corner-puller": 0.9, "mh_mouth-parling": 0.32, "mh_eye-left-slit": 0.16,
                "mh_eye-right-slit": 0.16, "mh_mouth-elevation": 0.04, "mh_eyebrows-left-inner-up": 0.04,
                "mh_eyebrows-right-inner-up": 0.04},
    # i016: ref4's soft, warm smile = the sculpted Duchenne smile (evia_face.py: corners up + back, cheeks
    # rise, lower lids rise, nasolabial fold) + a hint of teeth; a touch asymmetric (her right side a little
    # stronger) so it is not a mirror-perfect doll smile
    # (i016 lab-b: evia_smile at 1.0 still read subtle at portrait distance -> 1.3; teeth at .6 looked grey)
    "warm": {"evia_smile": 1.3, "evia_smile_R": 0.15, "evia_teeth_show": 0.35,
             "mh_eyebrows-left-inner-up": 0.03, "mh_eyebrows-right-inner-up": 0.03},
}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"blend": None, "glb": None, "out": None, "shot": "portrait34", "light": "studio", "expr": "soft",
         "engine": "eevee", "res": None, "samples": None, "yaw": None, "dof": "1", "arms": "34",
         "exposure": "0", "raytrace": "0"}
    for i in range(0, len(argv), 2):
        o[argv[i].lstrip("-")] = argv[i + 1]
    return o


def find_rig():
    return next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)


def pb(rig, name):
    return rig.pose.bones.get("mixamorig:" + name) or rig.pose.bones.get(name)


def rotate_world(rig, bone, axis, deg):
    """Rotate a pose bone about a WORLD axis through its head."""
    if bone is None:
        return
    m = bone.matrix.copy()
    head = m.to_translation()
    r = Matrix.Rotation(math.radians(deg), 4, axis)
    bone.matrix = Matrix.Translation(head) @ r @ Matrix.Translation(-head) @ m
    bpy.context.view_layer.update()


def rotate_local(bone, axis, deg):
    if bone is None:
        return
    bone.rotation_mode = "XYZ"
    e = list(bone.rotation_euler)
    e["XYZ".index(axis)] += math.radians(deg)
    bone.rotation_euler = e
    bpy.context.view_layer.update()


def relaxed_pose(rig, arms_deg, head):
    """Shared relaxed pose (evia_pose.py - the hair was groomed in it) + a small head yaw / tilt / nod."""
    if rig is None:
        return
    import evia_pose
    evia_pose.relaxed_arms(rig)
    evia_pose.head_pose(rig, *head)


def set_expression(name, extra=None):
    vals = dict(EXPRESSIONS.get(name, {}))
    vals.update(extra or {})
    for obj in bpy.data.objects:
        if obj.type != "MESH" or not obj.data.shape_keys:
            continue
        for kb in obj.data.shape_keys.key_blocks:
            if kb.name.startswith("mh_") or kb.name.startswith("evia_"):
                kb.value = vals.get(kb.name, 0.0)


def area(name, loc, target, size, power, color):
    data = bpy.data.lights.new(name, "AREA")
    data.shape = "DISK"
    data.size = size
    data.energy = power
    data.color = color
    obj = bpy.data.objects.new(name, data)
    obj.location = loc
    d = Vector(target) - Vector(loc)
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    # i016: EEVEE Next soft shadows need jitter; without it the key's shadows were hard-edged (a straight
    # diagonal line across the neck, card-shaped hair shadows on the cheek)
    try:
        data.use_shadow_jitter = True
        data.shadow_jitter_overblur = 10.0
    except AttributeError:
        pass
    bpy.context.scene.collection.objects.link(obj)
    return obj


def her_frame(az, el, dist, target):
    a, e = math.radians(az), math.radians(el)
    return (target[0] + dist * math.cos(e) * math.sin(a), target[1] - dist * math.cos(e) * math.cos(a),
            target[2] + dist * math.sin(e))


BACKDROP_BEHIND_CAMERA = False


def backdrop(color, loc=(0, 1.6, 2.5), size=(24.0, 10.0), rough=0.9):
    if BACKDROP_BEHIND_CAMERA:           # back views: the wall goes in front of her (behind the camera's target)
        loc = (loc[0], -loc[1], loc[2])
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=loc, rotation=(math.radians(90), 0, 0))
    plane = bpy.context.active_object
    plane.scale = (size[0], size[1], 1)
    mat = bpy.data.materials.new("backdrop")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    plane.data.materials.append(mat)
    # floor
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.scale = (8, 8, 1)
    floor.data.materials.append(mat)
    return plane


def lights(kind, target):
    t = target
    if kind == "consult":
        area("key", her_frame(42, 28, 1.7, t), t, 1.1, 190, (1.0, 0.80, 0.70))
        area("fill", her_frame(-60, 8, 2.0, t), t, 1.8, 40, (0.60, 0.70, 1.0))
        area("rim", her_frame(-150, 30, 1.6, t), t, 0.8, 230, (1.0, 0.56, 0.60))
        area("rim2", her_frame(150, 38, 1.8, t), t, 0.7, 90, (0.80, 0.70, 1.0))
        backdrop((0.035, 0.038, 0.058))
        world((0.018, 0.02, 0.032), 1.0)
    else:
        area("key", her_frame(40, 30, 1.8, t), t, 1.2, 120, (1.0, 0.97, 0.93))
        area("fill", her_frame(-55, 10, 2.0, t), t, 2.0, 38, (0.92, 0.95, 1.0))
        area("rim", her_frame(-145, 35, 1.7, t), t, 0.8, 110, (1.0, 0.96, 0.9))
        backdrop((0.30, 0.30, 0.31))
        world((0.05, 0.05, 0.055), 1.0)


def world(rgb, strength):
    w = bpy.data.worlds.new("lookdev_world")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*rgb, 1)
    bg.inputs[1].default_value = strength
    bpy.context.scene.world = w


def shot_target(shot, eyes_z, height):
    """SHOTS targets were authored for eyes at z=1.50 / height 1.605 m; rescale to this character."""
    tx, ty, tz = SHOTS[shot][0]
    if shot.startswith("full") or shot == "back34":
        return (tx, ty, tz * height / 1.605)
    return (tx, ty, tz + (eyes_z - 1.50))


def camera(shot, o, eyes_z, height=1.605):
    _t, span, az, el, lens, _head = SHOTS[shot]
    target = shot_target(shot, eyes_z, height)
    if shot.startswith("full"):
        span = span * height / 1.605
    if o["yaw"] is not None:
        az = float(o["yaw"])
    data = bpy.data.cameras.new("cam")
    data.lens = lens
    data.sensor_fit = "VERTICAL"
    data.sensor_height = 24.0
    vfov = 2 * math.atan(12.0 / lens)
    dist = (span / 2.0) / math.tan(vfov / 2.0)
    cam = bpy.data.objects.new("cam", data)
    cam.location = her_frame(az, el, dist, target)
    d = Vector(target) - Vector(cam.location)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    data.clip_start = 0.05
    data.clip_end = 30
    if o["dof"] == "1" and span < 1.0:
        data.dof.use_dof = True
        data.dof.focus_distance = (Vector(cam.location) - Vector((0.0, -0.10, eyes_z))).length
        data.dof.aperture_fstop = 2.8 if span < 0.4 else 4.0
    return cam


def look_at_camera(rig, cam):
    """Eye bones track the camera: she looks at the viewer."""
    if rig is None:
        return
    for side in ("Left", "Right"):
        b = pb(rig, side + "Eye")
        if b is None:
            continue
        c = b.constraints.new("DAMPED_TRACK")
        c.target = cam
        c.track_axis = "TRACK_Y"
        c.influence = 0.85
    bpy.context.view_layer.update()


def main():
    o = args()
    if o["glb"]:            # verify the WEB asset: re-import the exported GLB into an empty scene
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=o["glb"])
        for ob in list(bpy.data.objects):
            if ob.name.startswith("Icosphere"):
                bpy.data.objects.remove(ob, do_unlink=True)
    else:
        bpy.ops.wm.open_mainfile(filepath=o["blend"])
    scene = bpy.context.scene
    shot = o["shot"]
    rig = find_rig()
    if o["arms"] == "rest":          # i016: show the file's REST pose as is (GLB check of the baked rest pose)
        pass
    else:
        relaxed_pose(rig, float(o["arms"]), SHOTS[shot][5])
    import json
    set_expression(o["expr"], json.loads(o["exprjson"]) if o.get("exprjson") else None)
    eyes_z = 1.50
    if rig is not None and pb(rig, "LeftEye") is not None:
        eyes_z = (rig.matrix_world @ pb(rig, "LeftEye").head).z
    body = next((ob for ob in bpy.data.objects if ob.type == "MESH" and
                 (ob.name.endswith(".body") or ob.name in ("Evia", "EviaBody"))), None)
    height = 1.605
    if body is not None:
        height = max((body.matrix_world @ v.co).z for v in body.data.vertices[:13380])
        if o["glb"]:
            height = max(height, 1.5)
    global BACKDROP_BEHIND_CAMERA
    az = float(o["yaw"]) if o["yaw"] is not None else SHOTS[shot][2]
    BACKDROP_BEHIND_CAMERA = abs(az) > 90
    cam = camera(shot, o, eyes_z, height)
    look_at_camera(rig, cam)
    lights(o["light"], shot_target(shot, eyes_z, height))
    full = shot.startswith("full") or shot == "back34"
    res = o["res"] or ("720x960" if full else "640x800")
    w, h = (int(x) for x in res.split("x"))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    if o["engine"] == "cycles":
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = int(o["samples"] or 96)
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 8
        scene.cycles.transparent_max_bounces = 64
    else:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
        scene.eevee.taa_render_samples = int(o["samples"] or 48)   # 32 left shadow grain under the hair
        scene.eevee.use_raytracing = o["raytrace"] == "1"
        scene.eevee.use_shadows = True
        scene.eevee.shadow_ray_count = 2        # i012: less soft-shadow noise on skin in shadow
        scene.eevee.shadow_step_count = 6
    if o.get("hairshadow", "transparent") == "opaque":
        # opaque card shadows remove the stochastic speckle but cast hard polygon-shaped shadows on the face
        # (i012 facefront) - so transparent (default) for faces, opaque only as an option
        for m in bpy.data.materials:
            if m.name.startswith("EviaHair"):
                try:
                    m.use_transparent_shadow = False
                except AttributeError:
                    pass
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast" if o["light"] == "consult" else "None"
    except TypeError:
        pass
    scene.view_settings.exposure = float(o["exposure"])
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = o["out"]
    os.makedirs(os.path.dirname(o["out"]), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print("RENDERED", o["out"])


if __name__ == "__main__":
    main()
