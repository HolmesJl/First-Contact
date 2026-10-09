"""
Retargets the same ACCAD gendered clips onto the original game characters (Quaternius Universal Base Characters,
CC0) so both character sets can be compared with identical motion.

  blender -b --python tools/blender/quaternius_retarget.py -- <male|female> <out.glb>

Imports client/public/models/body-<sex>.glb, drops the parts the comparison does not show, and reuses
retarget_export.run(). The result is re-exported from Blender, so the meshes and the animations share one
skeleton convention.
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import retarget_export  # noqa: E402

sex, out = sys.argv[sys.argv.index("--") + 1:][:2]
src = os.path.normpath(os.path.join(HERE, f"../../client/public/models/body-{sex}.glb"))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src, guess_original_bind_pose=False)

KEEP_HAIR = "HairParted" if sex == "male" else "HairLong"
for o in list(bpy.data.objects):
    if o.type == "MESH" and (o.name in {"Beard", "Icosphere"} or (o.name.startswith("Hair") and o.name != KEEP_HAIR)):
        bpy.data.objects.remove(o, do_unlink=True)
arm = bpy.data.objects["Armature"]
arm.data.bones["Head"].name = "head"
retarget_export.run(sex, out)
