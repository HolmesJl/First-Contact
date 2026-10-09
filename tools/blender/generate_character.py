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


# ---------------------------------------------------------------------------------- shoulder relief

def sculpt_shoulders(body, rig, lift=0.0):
    """Adds the bony landmarks MakeHuman's base mesh leaves out: clavicle ridge, infraclavicular hollow,
    acromion corner and a squarer trapezius line. Offsets are applied to the mesh and to every shape key.
    """
    import math

    me = body.data
    me.update()
    coords = [v.co.copy() for v in me.vertices]
    normals = [v.normal.copy() for v in me.vertices]
    offsets = [Vector() for _ in coords]

    def seg_dist(p, a, b):
        """Distance in the coronal (x, z) plane: the bones sit mid-body, the skin is in front of them."""
        p2, a2, b2 = Vector((p.x, p.z)), Vector((a.x, a.z)), Vector((b.x, b.z))
        ab = b2 - a2
        t = max(0.0, min(1.0, (p2 - a2).dot(ab) / ab.dot(ab)))
        return (p2 - (a2 + ab * t)).length

    g = lambda d, sigma: math.exp(-((d / sigma) ** 2))
    for side in ("l", "r"):
        bone = rig.data.bones[f"clavicle_{side}"]
        a = Vector(bone.head_local)
        b = Vector(bone.tail_local)
        sign = 1.0 if side == "l" else -1.0
        neck = Vector((sign * 0.05, a.y, b.z + 0.045))
        for i, p in enumerate(coords):
            n = normals[i]
            if abs(p.x) < 0.012:
                continue
            front = max(0.0, -n.y)
            w = g(seg_dist(p, a + Vector((0, 0, 0.012)), b + Vector((0, 0, 0.012))), 0.0115)
            offsets[i] += n * (0.011 * w * front)
            hollow = g(seg_dist(p, a + Vector((0, 0, -0.04)), b + Vector((0, 0, -0.045))), 0.02)
            offsets[i] -= n * (0.006 * hollow * front)
            up = max(0.0, n.z)
            acro = g(seg_dist(p, b + Vector((sign * 0.005, 0, 0.01)), b + Vector((sign * 0.005, 0, 0.011))), 0.026)
            offsets[i] += Vector((sign * 0.008, 0, 0.016)) * acro * max(up, abs(n.x) * 0.5)
            trap = g(seg_dist(p, neck, b + Vector((0, 0, 0.02))), 0.028)
            offsets[i] += Vector((0, 0, 0.012)) * trap * up
    if lift:
        # Square the shoulder line: raise the trapezius / clavicle / acromion band, tapering toward the neck and
        # down the arm, so the neck-to-shoulder drop is smaller.
        zmax = max(c.z for c in coords)
        sm = lambda e0, e1, x: (lambda t: t * t * (3 - 2 * t))(max(0.0, min(1.0, (x - e0) / (e1 - e0))))
        for i, p in enumerate(coords):
            ax = abs(p.x) / zmax
            f = sm(0.03, 0.08, ax) * (1 - sm(0.20, 0.27, ax))
            gz = sm(0.745, 0.80, p.z / zmax) * (1 - sm(0.90, 0.96, p.z / zmax))
            offsets[i] += Vector((0, 0, lift * f * gz))
    for v, o in zip(me.vertices, offsets):
        v.co += o
    if me.shape_keys:
        for k in me.shape_keys.key_blocks:
            for d, o in zip(k.data, offsets):
                d.co += o
    me.update()


def smooth_shoulder_weights(mesh, vweights, zmax, iterations=8, strength=0.6):
    """Laplacian-smooths skin weights around the armpit, chest edge and deltoid so lowering the arm rolls the
    skin instead of folding a shelf where the arm and chest weights meet."""
    neighbours = [[] for _ in mesh.vertices]
    for e in mesh.edges:
        a, b = e.vertices
        neighbours[a].append(b)
        neighbours[b].append(a)
    zone = [
        0.66 * zmax < v.co.z < HEAD_CUT * zmax and abs(v.co.x) < 0.34 * zmax for v in mesh.vertices
    ]
    for _ in range(iterations):
        new = []
        for i, w in enumerate(vweights):
            if not zone[i] or not neighbours[i]:
                new.append(w)
                continue
            acc = {}
            for j in neighbours[i]:
                for gi, x in vweights[j].items():
                    acc[gi] = acc.get(gi, 0.0) + x / len(neighbours[i])
            merged = {}
            for gi in set(w) | set(acc):
                merged[gi] = (1 - strength) * w.get(gi, 0.0) + strength * acc.get(gi, 0.0)
            new.append(merged)
        vweights[:] = new


# ---------------------------------------------------------------------------------- decimation

HEAD_CUT = 0.86
HEAD_TARGET = 2700
SHOULDER_Z = (0.74, HEAD_CUT)
SHOULDER_X = 0.25


def decimate_body(body, rig, budget, sharp_shoulders=False, shoulder_lift=0.0):
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

    if sharp_shoulders:
        sculpt_shoulders(src, rig, shoulder_lift)
        for v, sv in zip(work.data.vertices, src.data.vertices):
            v.co = sv.co
    zmax = max(v.co.z for v in src.data.vertices)
    head_z = HEAD_CUT * zmax
    head_before = sum(1 for v in work.data.vertices if v.co.z > head_z)

    def in_shoulder_ring(co):
        """Clavicle, deltoid and upper-trapezius zone, kept at full density when sharp_shoulders is on."""
        return sharp_shoulders and SHOULDER_Z[0] * zmax < co.z <= head_z and abs(co.x) < SHOULDER_X * zmax

    shoulder_before = sum(1 for v in work.data.vertices if in_shoulder_ring(v.co))

    def decimate_pass(protect_head, target_total):
        """One collapse pass; vertices in the protected group (weight 1, inverted) are left alone."""
        for g in list(work.vertex_groups):
            work.vertex_groups.remove(g)
        grp = work.vertex_groups.new(name="__protect")
        for v in work.data.vertices:
            head = v.co.z > head_z
            if protect_head:
                protected = head or in_shoulder_ring(v.co)
            else:
                protected = not head
            if protected:
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
    log("shoulder ring verts", shoulder_before, "->", sum(1 for v in new_mesh.vertices if in_shoulder_ring(v.co)))
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
    new_normals = []
    vweights = []
    for v in new_mesh.vertices:
        loc, _n, fi, _d = tree.find_nearest(v.co)
        face = bm.faces[fi]
        verts = [l.vert for l in face.loops]
        w = poly_3d_calc([vv.co for vv in verts], loc)
        nrm = Vector()
        for vv, ww in zip(verts, w):
            nrm += src.data.vertices[vv.index].normal * ww
        new_normals.append(nrm.normalized() if nrm.length > 1e-6 else Vector((0, 0, 1)))
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
        vweights.append(weights)
    bm.free()

    if sharp_shoulders:
        smooth_shoulder_weights(new_mesh, vweights, zmax)
    for v, weights in zip(new_mesh.vertices, vweights):
        top = sorted(weights.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(x for _, x in top) or 1.0
        for gi, wt in top:
            name = group_names[gi]
            if name in new_vgroups and wt / tot > 0:
                new_vgroups[name].add([v.index], wt / tot, "REPLACE")

    if sharp_shoulders:
        # Decimated triangles are too coarse to shade the clavicle ridge and deltoid on their own: reuse the
        # smooth normals of the full-resolution mesh.
        new_mesh.polygons.foreach_set("use_smooth", [True] * len(new_mesh.polygons))
        new_mesh.normals_split_custom_set_from_vertices([tuple(n) for n in new_normals])

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


# ---------------------------------------------------------------------------------- detail normal map

NORMAL_RES = 1024
NORMAL_GAIN = 2.6  # the baked relief is exaggerated: it has to read at game distance under soft lighting


def muscle_height(pts, nrm, rig, H, strength):
    """Anatomical surface relief (metres, positive = out) at object-space points; `strength` scales groups.

    MakeHuman's muscle targets give the broad shapes but not the readable definition: pectoral edges, rectus
    abdominis blocks, deltoid and arm heads, scapulae, quadriceps and calves. These are analytic bumps and
    grooves placed from bone positions and body-height fractions, baked into a tangent-space normal map.
    """
    import numpy as np

    x, y, z = pts[:, 0], pts[:, 1], pts[:, 2]
    ax = np.abs(x)
    s = H / 1.8
    front = np.clip(-nrm[:, 1], 0, 1)
    back = np.clip(nrm[:, 1], 0, 1)
    G = lambda d, sig: np.exp(-((d / sig) ** 2))
    box = lambda d, half, soft: 1 / (1 + np.exp((np.abs(d) - half) / soft))
    h = np.zeros(len(pts))
    mm = 0.001 * s

    # pectorals, sternum, deltoid/pec groove
    st = strength
    pec = np.exp(-(((ax - 0.062 * H) / (0.058 * H)) ** 2 + ((z - 0.738 * H) / (0.036 * H)) ** 2) ** 1.5)
    h += st["pec"] * 6.5 * mm * pec * front
    h -= st["pec"] * 2.0 * mm * G(ax, 0.006 * H) * box(z - 0.74 * H, 0.04 * H, 0.006 * H) * front
    h -= st["pec"] * 2.5 * mm * G(ax - 0.112 * H, 0.007 * H) * box(z - 0.74 * H, 0.045 * H, 0.008 * H) * front

    # abdominals: three rows of rectus blocks, linea alba, serratus
    for zc in (0.672, 0.643, 0.614):
        for sx in (-1, 1):
            blk = box(x - sx * 0.0195 * H, 0.0145 * H, 0.006 * H) * box(z - zc * H, 0.0098 * H, 0.0045 * H)
            h += st["abs"] * 4.2 * mm * blk * front
    h -= st["abs"] * 2.2 * mm * G(ax, 0.0028 * H) * box(z - 0.645 * H, 0.06 * H, 0.006 * H) * front
    for zc in (0.712, 0.69, 0.668):
        e = np.exp(-(((ax - 0.087 * H) / (0.016 * H)) ** 2 + ((z - zc * H) / (0.0075 * H)) ** 2))
        h += st["abs"] * 2.0 * mm * e * np.clip(np.abs(nrm[:, 0]) + front * 0.5, 0, 1)

    # shoulder cap, arms
    for side in ("l", "r"):
        sgn = 1.0 if side == "l" else -1.0
        side_mask = (x * sgn > 0).astype(float)
        ua, ub = np.array(rig.data.bones[f"upperarm_{side}"].head_local), np.array(rig.data.bones[f"upperarm_{side}"].tail_local)
        fa, fb = np.array(rig.data.bones[f"lowerarm_{side}"].head_local), np.array(rig.data.bones[f"lowerarm_{side}"].tail_local)
        d = np.linalg.norm(pts - (ua + np.array([0.0, 0.0, 0.01 * s])), axis=1)
        h += st["delt"] * 4.5 * mm * G(d, 0.05 * s) * side_mask
        for (a, b, kind) in ((ua, ub, "up"), (fa, fb, "fore")):
            ab = b - a
            t = ((pts - a) @ ab) / (ab @ ab)
            closest = a + np.outer(np.clip(t, 0, 1), ab)
            rad = pts - closest
            rl = np.linalg.norm(rad, axis=1) + 1e-9
            cf = -rad[:, 1] / rl
            inside = box(t - 0.5, 0.5, 0.03) / 1.0 * (1 / (1 + np.exp((rl - 0.09 * s) / (0.008 * s)))) * (1 / (1 + np.exp(-(x * sgn - 0.05 * H) / (0.008 * H))))
            if kind == "up":
                bi = G(t - 0.52, 0.2) * np.clip((cf - 0.15) / 0.5, 0, 1)
                tri = G(t - 0.5, 0.24) * np.clip((-cf - 0.15) / 0.5, 0, 1)
                sulcus = G(t - 0.5, 0.3) * G(cf, 0.18)
                h += (st["arm"] * (4.2 * bi + 3.6 * tri) - st["arm"] * 2.0 * sulcus) * mm * inside
            else:
                bra = G(t - 0.22, 0.22) * np.clip((cf - 0.1) / 0.6, 0, 1)
                ext = G(t - 0.35, 0.3) * np.clip((-cf - 0.1) / 0.6, 0, 1)
                h += st["arm"] * (3.0 * bra + 2.4 * ext) * mm * inside

    # back: spine groove, scapulae, trapezius edge
    h -= st["back"] * 2.2 * mm * G(ax, 0.005 * H) * box(z - 0.69 * H, 0.11 * H, 0.01 * H) * back
    for sx in (-1, 1):
        e = np.exp(-(((x - sx * 0.065 * H) / (0.042 * H)) ** 2 + ((z - 0.752 * H) / (0.046 * H)) ** 2) ** 1.4)
        h += st["back"] * 4.0 * mm * e * back
        e2 = np.exp(-(((x - sx * 0.05 * H) / (0.03 * H)) ** 2 + ((z - 0.69 * H) / (0.05 * H)) ** 2))
        h += st["back"] * 2.2 * mm * e2 * back

    # legs: quadriceps (front) and calves (back)
    for side in ("l", "r"):
        sgn = 1.0 if side == "l" else -1.0
        for (bn, kind) in ((f"thigh_{side}", "thigh"), (f"calf_{side}", "calf")):
            a = np.array(rig.data.bones[bn].head_local)
            b = np.array(rig.data.bones[bn].tail_local)
            ab = b - a
            t = ((pts - a) @ ab) / (ab @ ab)
            closest = a + np.outer(np.clip(t, 0, 1), ab)
            rad = pts - closest
            rl = np.linalg.norm(rad, axis=1) + 1e-9
            cf = -rad[:, 1] / rl
            cl = (rad[:, 0] * sgn) / rl
            inside = box(t - 0.5, 0.5, 0.03) * (1 / (1 + np.exp((rl - 0.11 * s) / (0.008 * s)))) * (1 / (1 + np.exp(-(x * sgn) / (0.006 * H))))
            if kind == "thigh":
                vl = G(t - 0.5, 0.25) * G(cl - 0.55, 0.3) * np.clip(cf + 0.3, 0, 1)
                vm = G(t - 0.7, 0.18) * G(cl + 0.55, 0.3) * np.clip(cf + 0.3, 0, 1)
                rf = G(t - 0.45, 0.28) * G(cl, 0.25) * np.clip(cf, 0, 1)
                h += st["legs"] * (3.0 * vl + 2.8 * vm + 2.2 * rf) * mm * inside
            else:
                g1 = G(t - 0.25, 0.17) * G(cl - 0.45, 0.28) * np.clip(-cf + 0.1, 0, 1)
                g2 = G(t - 0.25, 0.17) * G(cl + 0.45, 0.28) * np.clip(-cf + 0.1, 0, 1)
                h += st["legs"] * 3.2 * (g1 + g2) * mm * inside
    return h


MUSCLE_STRENGTH = {
    "male": {"pec": 1.0, "abs": 1.0, "delt": 1.0, "arm": 1.0, "back": 1.0, "legs": 1.0},
    "female": {"pec": 0.0, "abs": 0.4, "delt": 0.4, "arm": 0.35, "back": 0.3, "legs": 0.4},
}


def bake_detail_normal(body, rig, sex, path):
    """Rasterises a tangent-space normal map (glTF/OpenGL convention) of the anatomical relief for `body`."""
    import numpy as np

    me = body.data
    me.calc_loop_triangles()
    res = NORMAL_RES
    uv = me.uv_layers.active.data
    cn = np.array([list(n.vector) for n in me.corner_normals])
    co = np.array([list(v.co) for v in me.vertices])
    H = co[:, 2].max()
    pos = np.zeros((res, res, 3))
    nor = np.zeros((res, res, 3))
    tan = np.zeros((res, res, 3))
    bit = np.zeros((res, res, 3))
    cov = np.zeros((res, res), dtype=bool)
    for tri in me.loop_triangles:
        uvs = np.array([[uv[l].uv.x, uv[l].uv.y] for l in tri.loops])
        p = co[list(tri.vertices)]
        n = cn[list(tri.loops)]
        e1, e2 = p[1] - p[0], p[2] - p[0]
        du1, du2 = uvs[1] - uvs[0], uvs[2] - uvs[0]
        det = du1[0] * du2[1] - du2[0] * du1[1]
        if abs(det) < 1e-12:
            continue
        T = (e1 * du2[1] - e2 * du1[1]) / det
        B = (e2 * du1[0] - e1 * du2[0]) / det
        T /= np.linalg.norm(T) + 1e-12
        B /= np.linalg.norm(B) + 1e-12
        pts = np.stack([uvs[:, 0] * (res - 1), (1 - uvs[:, 1]) * (res - 1)], axis=1)
        x0, y0 = np.floor(pts.min(axis=0)).astype(int)
        x1, y1 = np.ceil(pts.max(axis=0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, res - 1), min(y1, res - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        d = (pts[1][1] - pts[2][1]) * (pts[0][0] - pts[2][0]) + (pts[2][0] - pts[1][0]) * (pts[0][1] - pts[2][1])
        if abs(d) < 1e-9:
            continue
        w0 = ((pts[1][1] - pts[2][1]) * (gx - pts[2][0]) + (pts[2][0] - pts[1][0]) * (gy - pts[2][1])) / d
        w1 = ((pts[2][1] - pts[0][1]) * (gx - pts[2][0]) + (pts[0][0] - pts[2][0]) * (gy - pts[2][1])) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -0.03) & (w1 >= -0.03) & (w2 >= -0.03)
        sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
        pos[sl][inside] = (w0[..., None] * p[0] + w1[..., None] * p[1] + w2[..., None] * p[2])[inside]
        nor[sl][inside] = (w0[..., None] * n[0] + w1[..., None] * n[1] + w2[..., None] * n[2])[inside]
        tan[sl][inside] = T
        bit[sl][inside] = B
        cov[sl] |= inside

    idx = np.argwhere(cov)
    P = pos[cov]
    N = nor[cov]
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
    T = tan[cov]
    B = bit[cov]
    st = MUSCLE_STRENGTH[sex]
    eps = 0.002
    grad = np.zeros_like(P)
    for k in range(3):
        d = np.zeros(3)
        d[k] = eps
        grad[:, k] = (muscle_height(P + d, N, rig, H, st) - muscle_height(P - d, N, rig, H, st)) / (2 * eps)
    grad -= (grad * N).sum(axis=1, keepdims=True) * N
    Np = N - NORMAL_GAIN * grad
    Np /= np.linalg.norm(Np, axis=1, keepdims=True)
    # Gram-Schmidt the tangent frame against the smooth normal
    T = T - (T * N).sum(axis=1, keepdims=True) * N
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
    B = np.cross(N, T) * np.sign((np.cross(T, B) * N).sum(axis=1, keepdims=True) + 1e-12)
    ts = np.stack([(Np * T).sum(axis=1), (Np * B).sum(axis=1), (Np * N).sum(axis=1)], axis=1)
    img = np.zeros((res, res, 3))
    img[..., 2] = 1.0
    img[cov] = ts
    # pad the islands so mip-mapping does not pull in empty texels
    filled = cov.copy()
    for _ in range(6):
        grown = filled.copy()
        acc = np.zeros_like(img)
        cnt = np.zeros((res, res))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(filled, dy, axis=0), dx, axis=1)
            val = np.roll(np.roll(img, dy, axis=0), dx, axis=1)
            acc += val * sh[..., None]
            cnt += sh
        new = (~filled) & (cnt > 0)
        img[new] = acc[new] / cnt[new][:, None]
        grown |= new
        filled = grown
    rgba = np.ones((res, res, 4), dtype=np.float32)
    rgba[..., :3] = (img[::-1] * 0.5 + 0.5).astype(np.float32)
    out = bpy.data.images.new("normal", res, res, alpha=False)
    out.colorspace_settings.name = "Non-Color"
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
    body = decimate_body(body, rig, BODY_VERTEX_BUDGET, preset.get("sharpShoulders", False), preset.get("shoulderLift", 0.0))

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
    bake_detail_normal(body, rig, preset["sex"], os.path.join(out_dir, f"{preset_id}.normal.png"))

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
