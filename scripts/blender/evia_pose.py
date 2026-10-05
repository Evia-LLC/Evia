"""Evia's relaxed standing pose (arms hanging at her sides) for the MPFB mixamo_unity rig.

Used twice, so both agree:
  - evia_build.py grooms the HAIR against the body and garments in this pose (the rig's rest pose is MPFB's
    A-pose with the arms raised 47 degrees; hair groomed there would rest on the raised arms and float once
    the arms come down). The hair is skinned only to Head / Neck / Spine2, which this pose does not move,
    so hair built here is valid in the rest pose too.
  - evia_lookdev_render.py poses the character for every look-dev render.
The web idle pose should stay close to this (arms down, soft elbows) or the hair can touch the upper arms.
Bones are aimed in world space, so the result does not depend on MPFB's bone rolls.
"""

import math

import bpy
from mathutils import Matrix, Vector


def pb(rig, name):
    return rig.pose.bones.get("mixamorig:" + name) or rig.pose.bones.get(name)


def rotate_world(bone, axis, deg):
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


def aim_bone(bone, direction):
    """Rotate a pose bone about its head so its +Y (head->tail) points along `direction` (armature space)."""
    if bone is None:
        return
    m = bone.matrix.copy()
    y = (m.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
    q = y.rotation_difference(Vector(direction).normalized())
    head = m.to_translation()
    bone.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ m
    bpy.context.view_layer.update()


ARM = (0.17, 0.03, -1.0)       # upper arm: down, slightly away from the body (clears the hips / coat)
FOREARM = (0.07, -0.30, -1.0)  # soft elbow, hand a little forward
HAND = (0.02, -0.22, -1.0)
# i016: the rest-pose thumbs (A-pose: forward + toward the palm) hooked forward / inward once the arms hang
# (critic crop z-hands.png): lay them down along the index finger, a little forward, softly curled
THUMB = ((0.02, -0.62, -0.78), (0.0, -0.50, -0.86), (-0.02, -0.40, -0.92))


def relaxed_arms(rig):
    if rig is None:
        return
    for side, s in (("Left", 1.0), ("Right", -1.0)):
        rotate_world(pb(rig, side + "Shoulder"), "Y", 3.0 * s)
        aim_bone(pb(rig, side + "Arm"), (ARM[0] * s, ARM[1], ARM[2]))
        aim_bone(pb(rig, side + "ForeArm"), (FOREARM[0] * s, FOREARM[1], FOREARM[2]))
        aim_bone(pb(rig, side + "Hand"), (HAND[0] * s, HAND[1], HAND[2]))
        for finger in ("Index", "Middle", "Ring", "Pinky"):
            for k, deg in ((1, 12), (2, 18), (3, 12)):
                rotate_local(pb(rig, side + "Hand" + finger + str(k)), "X", deg)
        for k, d in enumerate(THUMB, start=1):
            aim_bone(pb(rig, side + "HandThumb" + str(k)), (d[0] * s, d[1], d[2]))


def head_pose(rig, yaw, tilt, nod):
    neck, headb = pb(rig, "Neck"), pb(rig, "Head")
    rotate_world(neck, "Z", yaw * 0.4)
    rotate_world(headb, "Z", yaw * 0.6)
    rotate_world(headb, "Y", tilt)
    rotate_world(headb, "X", nod)


def reset(rig):
    for b in rig.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
