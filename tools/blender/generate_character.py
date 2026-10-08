"""
Generates one MPFB character preset and exports it as a rigged glTF (no textures, no animation).

  blender -b --python tools/blender/generate_character.py -- <preset-id> <out-dir>

Stages: macro/detail targets -> baked basemesh -> game_engine rig -> ARKit face-unit shape keys ->
eyes / brows / lashes / hair -> shape keys propagated to the fitted assets -> body decimated to the
vertex budget (shape keys and skin weights re-projected) -> reduced to the expression shapes the
game uses -> exported. Textures are attached afterwards by tools/build-mpfb-characters.mjs.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mpfb_common import dynamic_import  # noqa: E402
from presets import PRESETS, BODY_VERTEX_BUDGET, KEEP_SHAPES  # noqa: E402

HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
TargetService = dynamic_import("mpfb.services.targetservice", "TargetService")
FaceService = dynamic_import("mpfb.services.faceservice", "FaceService")
AssetService = dynamic_import("mpfb.services.assetservice", "AssetService")
ExportService = dynamic_import("mpfb.services.exportservice", "ExportService")
ObjectService = dynamic_import("mpfb.services.objectservice", "ObjectService")


def log(*a):
    print("[spike]", *a, flush=True)


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def bake_shape_keys(obj):
    """Collapses every shape key (macro + detail targets) into the mesh itself."""
    keys = obj.data.shape_keys
    if not keys:
        return
    mix = obj.shape_key_add(name="__mix", from_mix=True)
    coords = [v.co.copy() for v in mix.data]
    for k in list(obj.data.shape_keys.key_blocks):
        obj.shape_key_remove(k)
    for v, c in zip(obj.data.vertices, coords):
        v.co = c
    obj.data.update()


def find_asset(fname, subdir):
    path = AssetService.find_asset_absolute_path(fname, asset_subdir=subdir)
    if path is None:
        raise RuntimeError(f"Asset {subdir}/{fname} not found; install makehuman_system_assets")
    return path


def child_by_asset(basemesh, stem):
    for o in bpy.data.objects:
        if o.parent == basemesh.parent and o != basemesh and o.name.endswith("." + stem):
            return o
    raise KeyError(stem)


def vertex_count_after_masks(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    return len(obj.evaluated_get(dg).data.vertices)


# ---------------------------------------------------------------------------------- decimation

HEAD_CUT = 0.86
HEAD_TARGET = 2700


def decimate_body(body, rig, budget):
    """Returns a new body object with at most ~budget vertices; keeps face and hands denser."""
    bpy.context.view_layer.objects.active = body
    body.select_set(True)

    # Keep a pristine high-res copy (with shape keys) as the projection source.
    src = body
    work = src.copy()
    work.data = src.data.copy()
    bpy.context.collection.objects.link(work)
    work.name = "body_work"
    for k in list(work.data.shape_keys.key_blocks) if work.data.shape_keys else []:
        work.shape_key_remove(k)
    for m in list(work.modifiers):
        work.modifiers.remove(m)

    zmax = max(v.co.z for v in src.data.vertices)
    head_z = HEAD_CUT * zmax
    head_before = sum(1 for v in work.data.vertices if v.co.z > head_z)

    def decimate_pass(protect_head, target_total):
        """One collapse pass; vertices in the protected group (weight 1, inverted) are left alone."""
        for g in list(work.vertex_groups):
            work.vertex_groups.remove(g)
        grp = work.vertex_groups.new(name="__protect")
        for v in work.data.vertices:
            if (v.co.z > head_z) == protect_head:
                grp.add([v.index], 1.0, "REPLACE")
        bpy.context.view_layer.objects.active = work
        mod = work.modifiers.new("dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.use_collapse_triangulate = True
        mod.vertex_group = "__protect"
        mod.invert_vertex_group = True
        lo, hi = 0.2, 1.0
        for _ in range(14):
            mod.ratio = (lo + hi) / 2
            if vertex_count_after_masks(work) > target_total:
                hi = mod.ratio
            else:
                lo = mod.ratio
        mod.ratio = lo
        bpy.ops.object.modifier_apply(modifier=mod.name)

    total = len(work.data.vertices)
    body_target = budget - HEAD_TARGET
    decimate_pass(True, body_target + head_before)
    decimate_pass(False, budget)
    new_mesh = work.data
    log("head verts", head_before, "->", sum(1 for v in new_mesh.vertices if v.co.z > head_z), "of", len(new_mesh.vertices))
    log("decimated body", total, "->", len(new_mesh.vertices))

    # ---- project shape keys / weights from src onto the decimated mesh
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)

    src_keys = src.data.shape_keys.key_blocks if src.data.shape_keys else []
    basis_co = [v.co.copy() for v in src.data.vertices]
    group_names = {g.index: g.name for g in src.vertex_groups}

    work.vertex_groups.clear()
    bone_names = {b.name for b in rig.data.bones}
    new_vgroups = {g.name: work.vertex_groups.new(name=g.name) for g in src.vertex_groups if g.name in bone_names}

    deltas = {k.name: [] for k in src_keys if k.name != "Basis"}
    for v in new_mesh.vertices:
        loc, _n, fi, _d = tree.find_nearest(v.co)
        face = bm.faces[fi]
        verts = [l.vert for l in face.loops]
        w = poly_3d_calc([vv.co for vv in verts], loc)
        for k in src_keys:
            if k.name == "Basis":
                continue
            d = Vector()
            for vv, ww in zip(verts, w):
                d += (k.data[vv.index].co - basis_co[vv.index]) * ww
            deltas[k.name].append(d)
        weights = {}
        for vv, ww in zip(verts, w):
            for g in src.data.vertices[vv.index].groups:
                if group_names[g.group] in bone_names:
                    weights[g.group] = weights.get(g.group, 0.0) + g.weight * ww
        top = sorted(weights.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(x for _, x in top) or 1.0
        top = [(gi, wt / tot) for gi, wt in top]
        for gi, wt in top:
            name = group_names[gi]
            if name in new_vgroups and wt > 0:
                new_vgroups[name].add([v.index], wt, "REPLACE")
    bm.free()

    work.shape_key_add(name="Basis")
    for name, ds in deltas.items():
        sk = work.shape_key_add(name=name)
        for i, d in enumerate(ds):
            sk.data[i].co = new_mesh.vertices[i].co + d

    work.name = src.name
    work.parent = src.parent
    work.matrix_parent_inverse = src.matrix_parent_inverse
    for m in src.modifiers:
        if m.type == "ARMATURE":
            nm = work.modifiers.new("Armature", "ARMATURE")
            nm.object = m.object
    bpy.data.objects.remove(src, do_unlink=True)
    work.name = "Body"
    return work


# ---------------------------------------------------------------------------------- underwear mask

MASK_RES = 1024
TORSO_LEG = ("pelvis", "spine_", "thigh_", "calf_", "foot_", "ball_", "neck", "clavicle_")


def bake_underwear_mask(body, sex, path):
    """Rasterises where underwear sits, in the body's UV space, from per-vertex height and bone family."""
    import numpy as np

    me = body.data
    zs = np.array([v.co.z for v in me.vertices])
    xs = np.array([abs(v.co.x) for v in me.vertices])
    height = zs.max()
    names = {g.index: g.name for g in body.vertex_groups}
    flag = np.zeros(len(me.vertices))
    for v in me.vertices:
        if not v.groups:
            continue
        top = max(v.groups, key=lambda g: g.weight)
        flag[v.index] = 1.0 if names[top.group].startswith(TORSO_LEG) else 0.0
    attrs = np.stack([zs / height, xs / height, flag], axis=1)

    uv = me.uv_layers.active.data
    img = np.zeros((MASK_RES, MASK_RES, 3))
    cov = np.zeros((MASK_RES, MASK_RES), dtype=bool)
    me.calc_loop_triangles()
    for tri in me.loop_triangles:
        pts = np.array([[uv[l].uv.x * (MASK_RES - 1), (1 - uv[l].uv.y) * (MASK_RES - 1)] for l in tri.loops])
        va = attrs[list(tri.vertices)]
        x0, y0 = np.floor(pts.min(axis=0)).astype(int)
        x1, y1 = np.ceil(pts.max(axis=0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, MASK_RES - 1), min(y1, MASK_RES - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        d = (pts[1][1] - pts[2][1]) * (pts[0][0] - pts[2][0]) + (pts[2][0] - pts[1][0]) * (pts[0][1] - pts[2][1])
        if abs(d) < 1e-9:
            continue
        w0 = ((pts[1][1] - pts[2][1]) * (gx - pts[2][0]) + (pts[2][0] - pts[1][0]) * (gy - pts[2][1])) / d
        w1 = ((pts[2][1] - pts[0][1]) * (gx - pts[2][0]) + (pts[0][0] - pts[2][0]) * (gy - pts[2][1])) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        val = w0[..., None] * va[0] + w1[..., None] * va[1] + w2[..., None] * va[2]
        img[y0:y1 + 1, x0:x1 + 1][inside] = val[inside]
        cov[y0:y1 + 1, x0:x1 + 1] |= inside

    z, x, f = img[..., 0], img[..., 1], img[..., 2]
    soft = lambda e0, e1, v: np.clip((v - e0) / (e1 - e0), 0, 1)
    if sex == "male":
        top = 1 - soft(0.528, 0.534, z)
        bottom = soft(0.425, 0.431, z)
        mask = top * bottom
    else:
        top = 1 - soft(0.528, 0.534, z)
        low_edge = 0.468 + 0.55 * x
        bottom = soft(0, 0.006, z - low_edge)
        briefs = top * bottom
        bra = soft(0.664, 0.670, z) * (1 - soft(0.742, 0.748, z))
        mask = np.maximum(briefs, bra)
    mask = mask * f * cov
    out = bpy.data.images.new("mask", MASK_RES, MASK_RES, alpha=False)
    rgba = np.zeros((MASK_RES, MASK_RES, 4), dtype=np.float32)
    flipped = mask[::-1]
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = flipped
    rgba[..., 3] = 1
    out.pixels = rgba.ravel()
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)


# ---------------------------------------------------------------------------------- main

def build(preset_id, out_dir):
    preset = PRESETS[preset_id]
    clear_scene()

    macro = {
        "gender": preset["gender"],
        "age": preset.get("age", 0.5),
        "muscle": preset["muscle"],
        "weight": preset["weight"],
        "proportions": preset.get("proportions", 0.5),
        "height": preset["height"],
        "cupsize": preset.get("cupsize", 0.5),
        "firmness": 0.5,
        "race": preset["race"],
    }
    basemesh = HumanService.create_human(macro_detail_dict=macro)
    for name, weight in preset.get("details", {}).items():
        path = TargetService.target_full_path(name)
        if path is None:
            raise RuntimeError(f"Unknown target {name}")
        TargetService.load_target(basemesh, path, weight=weight)
    bake_shape_keys(basemesh)

    rig = HumanService.add_builtin_rig(basemesh, "game_engine")
    FaceService.load_targets(basemesh, load_microsoft_visemes=False, load_arkit_faceunits=True)

    assets = [("eyes", "low-poly.mhclo", "Eyes"), ("eyebrows", preset["brows"] + ".mhclo", "Eyebrows"), ("eyelashes", "eyelashes01.mhclo", "Eyelashes")]
    for h in preset["hair"]:
        assets.append(("hair", h + ".mhclo", "Hair"))
    for subdir, fname, atype in assets:
        HumanService.add_mhclo_asset(find_asset(fname, subdir), basemesh, asset_type=atype, material_type="GAMEENGINE")
    FaceService.interpolate_targets(basemesh)

    # Plain, role-named materials: textures are assigned in the Node post-process.
    roles = {}
    for stem, role in [("low-poly", "Eyes"), (preset["brows"], "Brows"), ("eyelashes01", "Lashes")] + [(h, "Hair_" + h) for h in preset["hair"]]:
        roles[stem] = role

    body = basemesh
    objs = {}
    for o in list(bpy.data.objects):
        if o.type != "MESH" or o == body:
            continue
        stem = o.name.split(".", 1)[1] if "." in o.name else o.name
        if stem in roles:
            objs[roles[stem]] = o

    # Face-unit shapes only matter on the face parts; hair is rigid.
    for key, o in objs.items():
        if key.startswith("Hair_"):
            for k in list(o.data.shape_keys.key_blocks) if o.data.shape_keys else []:
                o.shape_key_remove(k)

    ExportService.bake_modifiers_remove_helpers(body, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=False)
    log("basemesh without helpers", len(body.data.vertices))
    body = decimate_body(body, rig, BODY_VERTEX_BUDGET)

    keep = set(KEEP_SHAPES) | {"Basis"}
    for o in [body] + [o for k, o in objs.items() if not k.startswith("Hair_")]:
        if not o.data.shape_keys:
            continue
        for k in list(o.data.shape_keys.key_blocks):
            if k.name not in keep:
                o.shape_key_remove(k)

    # normalise names, modifiers, materials
    def set_material(o, name, rgba):
        o.data.materials.clear()
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = rgba
        # The glTF exporter only writes TEXCOORD_0 for materials that sample an image; the Node stage
        # swaps this placeholder for the real textures.
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        img = bpy.data.images.get("placeholder")
        if img is None:
            img = bpy.data.images.new("placeholder", 4, 4)
            img.pixels = [1.0] * 64
            img.pack()
        node.image = img
        mat.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
        o.data.materials.append(mat)

    set_material(body, "Skin", (0.8, 0.6, 0.5, 1))
    body.name = "Body"
    counts = {"Body": len(body.data.vertices)}
    for key, o in objs.items():
        for m in list(o.modifiers):
            if m.type == "SUBSURF":
                o.modifiers.remove(m)
        set_material(o, key.split("_")[0], (0.2, 0.15, 0.1, 1))
        o.name = key
        o.data.name = key
        counts[key] = len(o.data.vertices)
    body.data.name = "Body"
    bake_underwear_mask(body, preset["sex"], os.path.join(out_dir, f"{preset_id}.underwear.png"))

    # drop helper bones' mesh groups that are not on the rig; keep only deform bones
    rig.name = "Armature"
    log("vertex counts", json.dumps(counts))

    # neutral export position
    os.makedirs(out_dir, exist_ok=True)
    blend = os.path.join(out_dir, f"{preset_id}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    log("saved", blend)
    return counts


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:]
    counts = build(argv[0], argv[1])
    with open(os.path.join(argv[1], f"{argv[0]}.counts.json"), "w") as f:
        json.dump(counts, f)
