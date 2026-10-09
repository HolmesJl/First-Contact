"""
Retargets ACCAD motion capture (BVH, CC BY 3.0) onto a generated MPFB character and exports a GLB.

  blender -b <preset>.blend --python tools/blender/retarget_export.py -- <preset-id> <out.glb>

Method (details in docs/character-spike.md): the source's own rest pose (a T-pose with a different bone
frame convention) is replaced by a neutral standing frame of the same performer. For every mapped bone

    W_target(t) = Rz * [ W_src(t) * W_src(ref)^-1 ] * Q_bone * W_rest_target

in armature space, where Q_bone is the shortest rotation taking the target's rest bone direction onto the
performer's bone direction in the reference frame (limbs only; spine, neck and head use identity), and
Rz turns the performer's heading to the character's forward axis. Pose-bone rotations follow from the
parent chain. Root motion is reduced to height and sway scaled by leg length, loops are cut on gait cycles
and cross-faded closed, and each clip is re-grounded so the lowest foot touches the floor.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bvh import Bvh  # noqa: E402
from clips import ACCAD_DIR, CLIP_SETS, STYLES  # noqa: E402
from presets import PRESETS  # noqa: E402

FPS = 30.0

# (source joint, target bone, child joint giving the rest direction | "END" | None for identity)
MAP = [
    ("Hips", "pelvis", None), ("ToSpine", "spine_01", None), ("Spine", "spine_02", None), ("Spine1", "spine_03", None),
    ("Neck", "neck_01", None), ("Head", "head", None),
]
for _side, _s in (("Left", "l"), ("Right", "r")):
    MAP += [
        (f"{_side}Shoulder", f"clavicle_{_s}", f"{_side}Arm"), (f"{_side}Arm", f"upperarm_{_s}", f"{_side}ForeArm"),
        (f"{_side}ForeArm", f"lowerarm_{_s}", f"{_side}Hand"), (f"{_side}Hand", f"hand_{_s}", "END"),
        (f"{_side}UpLeg", f"thigh_{_s}", f"{_side}Leg"), (f"{_side}Leg", f"calf_{_s}", f"{_side}Foot"),
        (f"{_side}Foot", f"foot_{_s}", f"{_side}ToeBase"), (f"{_side}ToeBase", f"ball_{_s}", "END"),
    ]
TARGET_BONES = [m[1] for m in MAP]

# BVH (x left, y up, z forward) -> Blender/MPFB (x left, y back, z up)
B2BL = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=float)


def m3(a):
    return Matrix([list(r) for r in a])


def np3(m):
    return np.array([list(r) for r in m])


def quat(R):
    return m3(R).to_quaternion()


def slerp(a, b, w):
    return np3(quat(a).slerp(quat(b), w).to_matrix())


def shortest_arc(a, b):
    return np3(Vector(a / np.linalg.norm(a)).rotation_difference(Vector(b / np.linalg.norm(b))).to_matrix())


def rot_z(theta):
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def mean_quat(mats):
    qs = [quat(R) for R in mats]
    acc = np.zeros(4)
    for q in qs:
        v = np.array([q.w, q.x, q.y, q.z])
        acc += v if v @ np.array([qs[0].w, qs[0].x, qs[0].y, qs[0].z]) >= 0 else -v
    return Quaternion(acc / np.linalg.norm(acc))


def symmetrize_shoulders(bvh, a, b):
    """Removes a constant left/right difference in how the clavicles sit over frames [a, b).

    Local clavicle rotations (relative to the chest) of a mirror-symmetric posture satisfy R_right = M R_left M,
    where M reflects across the body's sagittal plane. Some performers' standing and walking takes are not
    symmetric (ACCAD Male 1: right shoulder joint about 13 deg further rotated than the left in Stand, Sway
    and Walk, level in the Run take), and the reference-pose method then imprints that as a hunched, twisted
    shoulder. Both sides are moved onto the mirrored average of the take; the arms keep their captured
    world orientation. Returns {joint: world rotations (frames, 3, 3) in BVH axes}.
    """
    il, ir = bvh.index["LeftShoulder"], bvh.index["RightShoulder"]
    lat = bvh.offset[bvh.index["LeftUpLeg"]] - bvh.offset[bvh.index["RightUpLeg"]]
    n = lat / np.linalg.norm(lat)
    M = np.eye(3) - 2 * np.outer(n, n)
    Ll, Lr = bvh.local[:, il], bvh.local[:, ir]
    ql, qr = mean_quat(Ll[a:b]), mean_quat(Lr[a:b])
    mirrored = quat(M @ np3(qr.to_matrix()) @ M)
    S = ql.slerp(mirrored, 0.5)
    Sm = np3(S.to_matrix())
    Cl = np3((S @ ql.inverted()).to_matrix())
    Cr = np3((quat(M @ Sm @ M) @ qr.inverted()).to_matrix())
    parent_world = bvh.world_rot[:, bvh.parent[il]]
    return {"LeftShoulder": parent_world @ (Cl @ Ll), "RightShoulder": parent_world @ (Cr @ Lr)}


class Source:
    """A BVH clip with world rotations and hips position converted to Blender axes (metres).

    `symmetric_shoulders=(a, b)` applies symmetrize_shoulders over that frame range.
    """

    def __init__(self, path, symmetric_shoulders=None):
        self.bvh = Bvh(path)
        b = self.bvh
        if abs(b.dt - 1 / FPS) > 1e-3:
            raise ValueError(f"{path}: expected 30 fps, got dt={b.dt}")
        self.n = b.frames
        world = {n: b.world_rot[:, i] for i, n in enumerate(b.names)}
        if symmetric_shoulders:
            world.update(symmetrize_shoulders(b, *symmetric_shoulders))
        self.rot = {n: np.einsum("ij,fjk,lk->fil", B2BL, world[n], B2BL) for n in b.names}
        self.hips = (B2BL @ (b.pos("Hips") * 0.01).T).T


def hips_forward(bvh):
    """Forward axis of the hips in their own frame: (left x up), from the leg and spine offsets.

    The performers' BVH skeletons are not all built the same way (Female 1 faces +Z, Male 1 faces +X), so the
    facing cannot be assumed from the axes.
    """
    lat = bvh.offset[bvh.index["LeftUpLeg"]] - bvh.offset[bvh.index["RightUpLeg"]]
    up = sum(bvh.offset[bvh.index[n]] for n in ("ToSpine", "Spine", "Spine1", "Neck"))
    f = np.cross(lat / np.linalg.norm(lat), up / np.linalg.norm(up))
    return f / np.linalg.norm(f)


def heading(R_hips, fwd_local):
    """Mean heading of the hips' forward as an angle about +Z in Blender axes (R_hips already in Blender axes)."""
    f = (R_hips @ (B2BL @ fwd_local))[..., :2]
    f = f.mean(axis=0) if f.ndim == 2 else f
    return math.atan2(f[1], f[0])


def fk_head(f, bone, W, parent, rest, head, pelvis_pos):
    chain = []
    b = bone
    while b is not None:
        chain.append(b)
        b = parent[b]
    pos = None
    for b in reversed(chain):
        p = parent[b]
        if b == "pelvis":
            pos = pelvis_pos.copy()
        elif p is None:
            pos = head[b].copy()
        else:
            Wp = W[p][f] if p in W else rest[p]
            pos = pos + Wp @ np.linalg.inv(rest[p]) @ (head[b] - head[p])
    return pos


LEG_BONES = {"l": ["thigh_l", "calf_l", "foot_l", "ball_l"], "r": ["thigh_r", "calf_r", "foot_r", "ball_r"]}


def scale_about_mean(d, k):
    """Scales a rotation track about its mean orientation: k > 1 exaggerates the motion, k < 1 calms it."""
    qs = [quat(R) for R in d]
    ref = qs[0]
    acc = Quaternion((0, 0, 0, 0))
    for q in qs:
        if ref.dot(q) < 0:
            q = -q.copy()
        acc = Quaternion((acc.w + q.w, acc.x + q.x, acc.y + q.y, acc.z + q.z))
    acc.normalize()
    out = []
    for q in qs:
        delta = acc.inverted() @ q
        axis, angle = delta.to_axis_angle()
        out.append(np3((acc @ Quaternion(axis, angle * k)).to_matrix()))
    return np.array(out)


def apply_style(world, style):
    """`world` maps target bone -> (n,3,3) aligned world deltas; returns the styled copy."""
    out = dict(world)
    for bone, k in style.get("amp", {}).items():
        if bone in out and k != 1.0:
            out[bone] = scale_about_mean(out[bone], k)
    pitch = math.radians(style.get("head_up", 0.0))
    if pitch:
        # The performers look at the floor; raise the gaze so faces read from a raised camera.
        for bone, share in (("head", 0.7), ("neck_01", 0.3)):
            c, s = math.cos(-pitch * share), math.sin(-pitch * share)
            Rx = np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
            out[bone] = np.einsum("ij,fjk->fik", Rx, out[bone])
    # Posture: draw the shoulder girdle back and up, lift the chest (the performers stand and walk slightly
    # slumped, which reads as rolled-forward shoulders on a broad-chested character).
    retract = math.radians(style.get("retract", 0.0))
    elevate = math.radians(style.get("elevate", 0.0))
    for side, sign in (("l", 1.0), ("r", -1.0)):
        bone = f"clavicle_{side}"
        if bone in out and (retract or elevate):
            cz, sz = math.cos(retract * sign), math.sin(retract * sign)
            Rz_back = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
            ce, se = math.cos(-elevate * sign), math.sin(-elevate * sign)
            Ry_up = np.array([[ce, 0, se], [0, 1, 0], [-se, 0, ce]])
            out[bone] = np.einsum("ij,jk,fkl->fil", Rz_back, Ry_up, out[bone])
    extend = math.radians(style.get("extend", 0.0))
    if extend:
        for bone, share in (("spine_01", 0.2), ("spine_02", 0.4), ("spine_03", 0.4)):
            c, s_ = math.cos(-extend * share), math.sin(-extend * share)
            Rx = np.array([[1, 0, 0], [0, c, -s_], [0, s_, c]])
            out[bone] = np.einsum("ij,fjk->fik", Rx, out[bone])
    neck_back = math.radians(style.get("neck_back", 0.0))
    if neck_back:
        c, s_ = math.cos(-neck_back), math.sin(-neck_back)
        out["neck_01"] = np.einsum("ij,fjk->fik", np.array([[1, 0, 0], [0, c, -s_], [0, s_, c]]), out["neck_01"])
    a = math.radians(style.get("adduct", 0.0))
    if a:
        for side, sign in (("l", 1.0), ("r", -1.0)):
            c, s = math.cos(a * sign), math.sin(a * sign)
            Ry = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
            for bone in LEG_BONES[side]:
                out[bone] = np.einsum("ij,fjk->fik", Ry, out[bone])
    return out


def build_clip(spec, ref_rot, ref_fwd, q_bone, rest, head, parent, r, style=None):
    path = os.path.join(ACCAD_DIR, spec["file"])
    a, b = spec["frames"]
    src = Source(path, (a, b) if spec.get("symmetric_shoulders") else None)
    speed = spec.get("speed", 1.0)
    n = max(4, int(round((b - a) / speed)))
    step = (b - a) / n
    k = min(spec.get("blend", 6), n // 4)
    times = np.concatenate([a - np.arange(k, 0, -1) * step, a + np.arange(n) * step])
    times = np.clip(times, 0, src.n - 1)

    def at(arr, t):
        i = int(math.floor(t))
        f = t - i
        if f < 1e-6:
            return arr[i]
        j = min(i + 1, len(arr) - 1)
        if arr.ndim == 3:
            return slerp(arr[i], arr[j], f)
        return arr[i] * (1 - f) + arr[j] * f

    # heading: face the character's forward axis (-Y) for the whole clip
    theta = -math.pi / 2 - heading(src.rot["Hips"][a:b], hips_forward(src.bvh))
    Rz = rot_z(theta)
    theta_ref = -math.pi / 2 - heading(ref_rot["Hips"], ref_fwd)
    Rz_ref = rot_z(theta_ref)

    world = {}
    for sj, tb, _ in MAP:
        raw = np.array([at(src.rot[sj], t) for t in times])
        d = np.einsum("ij,fjk,kl->fil", Rz, raw, np.linalg.inv(Rz_ref @ ref_rot[sj]))
        world[tb] = d

    hips = np.array([at(src.hips, t) for t in times])
    # remove steady travel so the cycle is periodic, then blend the tail onto the lead-in frames
    v = (at(src.hips, b) - at(src.hips, a)) / (b - a)
    hips = hips - np.outer(times - a, v)
    hips = hips @ Rz.T

    def close(arr, is_rot):
        seg = arr[k:].copy()
        for j in range(k):
            w = (j + 1) / k
            i = len(seg) - k + j
            seg[i] = slerp(seg[i], arr[j], w) if is_rot else seg[i] * (1 - w) + arr[j] * w
        return seg

    closed = {tb: close(world[tb], True) for _, tb, _ in MAP}
    if style:
        closed = apply_style(closed, style)
    W = {tb: np.einsum("fij,jk,kl->fil", closed[tb], q_bone[tb], rest[tb]) for _, tb, _ in MAP}
    damp = style.get("clav_damp", 0.0) if style else 0.0
    if damp:
        # Skinning meshes built for subtle clavicle motion collapse at the shoulder under the performer's full
        # shoulder girdle motion; pull the clavicles part-way back to their bind orientation (arms keep theirs).
        for tb in ("clavicle_l", "clavicle_r"):
            W[tb] = np.array([slerp(W[tb][f], rest[tb], damp) for f in range(len(W[tb]))])
    hips = close(hips, False)
    ground_speed = float(np.linalg.norm(((at(src.hips, b) - at(src.hips, a)))[:2]) * r / (n / FPS))

    pelvis = np.zeros((n, 3))
    sway = style.get("sway", 1.0) if style else 1.0
    pelvis[:, 0] = (hips[:, 0] - hips[:, 0].mean()) * r * sway
    pelvis[:, 1] = (hips[:, 1] - hips[:, 1].mean()) * r
    pelvis[:, 2] = (hips[:, 2].mean() + (hips[:, 2] - hips[:, 2].mean()) * sway) * r
    return W, pelvis, n, ground_speed


def posture_metrics(W, pelvis, n, parent, rest, head):
    """Side-view posture in cm over the clip: shoulder joint ahead of (+) or behind (-) the hip joint, shoulder
    height above the hip, shoulder width, head ahead of the hip."""
    rows = []
    for f in range(n):
        p = lambda b: fk_head(f, b, W, parent, rest, head, pelvis[f])
        sh = (p("upperarm_l") + p("upperarm_r")) / 2
        hip = (p("thigh_l") + p("thigh_r")) / 2
        rows.append([hip[1] - sh[1], sh[2] - hip[2], abs(p("upperarm_l")[0] - p("upperarm_r")[0]), hip[1] - p("head")[1]])
    m = np.mean(rows, axis=0) * 100
    return {"shoulderAheadOfHipCm": round(float(m[0]), 1), "shoulderAboveHipCm": round(float(m[1]), 1), "shoulderWidthCm": round(float(m[2]), 1), "headAheadOfHipCm": round(float(m[3]), 1)}


def foot_slide(W, pelvis, n, parent, rest, head, ground_speed, ball_rest_z):
    """Mean world speed (m/s) of the planted foot: 0 means no skating at the clip's ground speed.

    The planted foot is the lower of the two on each frame, counted only when its ball joint is within 2 cm
    of the standing height and moving slower than 0.15 m/s vertically.
    """
    pos = {s: np.array([fk_head(f, f"ball_{s}", W, parent, rest, head, pelvis[f]) for f in range(n)]) for s in ("l", "r")}
    vel = {}
    for s in ("l", "r"):
        v = (np.roll(pos[s], -1, axis=0) - pos[s]) * FPS
        v[-1] = v[-2]
        v[:, 1] -= ground_speed  # the character travels along -Y at the clip's ground speed
        vel[s] = v
    speeds = []
    for f in range(n):
        s = "l" if pos["l"][f][2] <= pos["r"][f][2] else "r"
        if pos[s][f][2] < ball_rest_z + 0.02 and abs(vel[s][f][2]) < 0.15:
            speeds.append(float(np.linalg.norm(vel[s][f][:2])))
    return (float(np.mean(speeds)) if speeds else 0.0, len(speeds))


def run(preset_id, out_glb):
    # Presets are MPFB characters; "quaternius-male|female" are the original game characters (same skeleton family).
    sex = PRESETS[preset_id]["sex"] if preset_id in PRESETS else preset_id.split("-")[-1]
    rig = bpy.data.objects["Armature"]
    clipset = CLIP_SETS[sex]
    bpy.context.view_layer.objects.active = rig

    bones = rig.data.bones
    rest = {b.name: np3(b.matrix_local.to_3x3()) for b in bones}
    head = {b.name: np.array(b.matrix_local.translation) for b in bones}
    tail = {b.name: np.array(b.matrix_local @ Vector((0, b.length, 0))) for b in bones}
    parent = {b.name: (b.parent.name if b.parent else None) for b in bones}

    rf = clipset["reference"]["frame"]
    ref = Source(os.path.join(ACCAD_DIR, clipset["reference"]["file"]), (rf, rf + 1) if clipset.get("symmetric_shoulders") else None)
    ref_rot = {n: ref.rot[n][rf] for n in ref.bvh.names}
    ref_fwd = hips_forward(ref.bvh)
    theta_ref = -math.pi / 2 - heading(ref_rot["Hips"], ref_fwd)
    Rz_ref = rot_z(theta_ref)

    q_bone = {}
    for sj, tb, child in MAP:
        if child is None:
            q_bone[tb] = np.eye(3)
            continue
        Wr = Rz_ref @ ref_rot[sj]
        if child == "END":
            sdir = Wr @ (B2BL @ ref.bvh.end_offset[ref.bvh.index[sj]])
            tdir = (tail[tb.replace("hand", "middle_03")] - head[tb]) if tb.startswith("hand") else (tail[tb] - head[tb])
        else:
            tdir = tail[tb] - head[tb]
            sdir = Wr @ (B2BL @ ref.bvh.offset[ref.bvh.index[child]])
        q_bone[tb] = shortest_arc(tdir, sdir)

    r = head["pelvis"][2] / ref.hips[rf][2]
    ball_rest_z = min(head["ball_l"][2], head["ball_r"][2])

    clips = {}
    meta = {"scale": round(float(r), 4)}
    calib = {}
    if preset_id not in PRESETS:
        # Other skeletons bring their own rest posture (the Quaternius bind pose leans forward more than the MPFB one),
        # because the reference-pose method keeps the rest posture. Straighten the spine and neck until the idle
        # side-view posture matches the MPFB character of the same sex, and apply that to every styled clip.
        idle_spec = {**clipset["clips"]["idle"], "symmetric_shoulders": clipset.get("symmetric_shoulders", False)}
        base = dict(STYLES[sex]["idle"])
        t_sh, t_head = (-0.4, 0.2) if sex == "male" else (3.0, 2.2)
        ext = ret = nb = 0.0
        clamp = lambda v, lo, hi: max(lo, min(hi, v))

        def measure():
            st = {**base, "extend": base.get("extend", 0) + ext, "retract": base.get("retract", 0) + ret, "neck_back": base.get("neck_back", 0) + nb}
            Wc, pc, nc, _gs = build_clip(idle_spec, ref_rot, ref_fwd, q_bone, rest, head, parent, r, st)
            return posture_metrics(Wc, pc, nc, parent, rest, head)

        # Prefer straightening the spine (up to 12 deg); only then draw the clavicles back (up to 8 deg more), so the
        # shoulder girdle is not twisted far from the skinning's bind pose.
        for _ in range(6):
            ext = clamp(ext + 0.8 * (measure()["shoulderAheadOfHipCm"] - t_sh), 0.0, 12.0)
        for _ in range(6):
            ret = clamp(ret + 0.5 * (measure()["shoulderAheadOfHipCm"] - t_sh) / 0.28, 0.0, 8.0)
        for _ in range(6):
            pm = measure()
            nb = clamp(nb + 0.5 * ((pm["headAheadOfHipCm"] - pm["shoulderAheadOfHipCm"]) - (t_head - t_sh)) / 0.17, -14.0, 16.0)
        calib = {"extend": ext, "retract": ret, "neck_back": nb, "clav_damp": 0.6}
        print("[spike] posture calibration", {k: round(v, 2) for k, v in calib.items()})
    jobs = []
    for name, spec in clipset["clips"].items():
        spec = {**spec, "symmetric_shoulders": clipset.get("symmetric_shoulders", False)}
        style = STYLES[sex].get(name)
        if style and calib:
            style = {**style, **{k: style.get(k, 0) + v for k, v in calib.items() if k != "clav_damp"}, "elevate": 0.0, "clav_damp": calib["clav_damp"]}
        jobs.append((name, spec, style))
        jobs.append(("raw_" + name, spec, {"clav_damp": calib["clav_damp"]} if calib else None))
    for name, spec, style in jobs:
        W, pelvis, n, gs = build_clip(spec, ref_rot, ref_fwd, q_bone, rest, head, parent, r, style)
        lows = []
        for f in range(n):
            lows.append(min(fk_head(f, f"ball_{s}", W, parent, rest, head, pelvis[f])[2] for s in ("l", "r")))
        pelvis[:, 2] += ball_rest_z - np.percentile(lows, 30 if name.endswith("idle") else 4)
        pelvis[:, 0] += head["pelvis"][0]
        pelvis[:, 1] += head["pelvis"][1]
        posture = posture_metrics(W, pelvis, n, parent, rest, head)
        slide = foot_slide(W, pelvis, n, parent, rest, head, gs, ball_rest_z)
        clips[name] = (W, pelvis, n)
        meta[name] = {"posture": posture, "footSlideCmS": round(slide[0] * 100, 1), "contactFrames": slide[1], "frames": n, "duration": round(n / FPS, 3), "groundSpeed": round(gs, 3), "source": spec["file"], "takeFrames": list(spec["frames"])}

    rig.animation_data_create()
    for tb in TARGET_BONES:
        rig.pose.bones[tb].rotation_mode = "QUATERNION"
    for name, (W, pelvis, n) in clips.items():
        act = bpy.data.actions.new(name)
        rig.animation_data.action = act
        for f in range(n):
            for tb in TARGET_BONES:
                p = parent[tb]
                Wpar = W[p][f] if p in W else rest[p]
                basis = np.linalg.inv(rest[tb]) @ rest[p] @ np.linalg.inv(Wpar) @ W[tb][f]
                pb = rig.pose.bones[tb]
                pb.rotation_quaternion = np3_to_q(basis)
                pb.keyframe_insert("rotation_quaternion", frame=f + 1)
            pb = rig.pose.bones["pelvis"]
            pb.location = Vector(np.linalg.inv(rest["pelvis"]) @ (pelvis[f] - head["pelvis"]))
            pb.keyframe_insert("location", frame=f + 1)
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 1, act)
        strip.name = name
        rig.animation_data.action = None
    for tb in TARGET_BONES:
        pb = rig.pose.bones[tb]
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.scene.render.fps = int(FPS)

    with open(out_glb.replace(".glb", ".motion.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print("[spike] motion", json.dumps(meta))

    for o in bpy.data.objects:
        o.select_set(o.type in {"MESH", "ARMATURE"})
    bpy.ops.export_scene.gltf(
        filepath=out_glb, export_format="GLB", use_selection=True,
        export_animations=True, export_animation_mode="NLA_TRACKS",
        export_force_sampling=True, export_optimize_animation_size=True,
        export_morph=True, export_morph_normal=False, export_try_sparse_sk=True, export_skins=True,
        export_yup=True, export_apply=False, export_cameras=False, export_lights=False,
    )
    print("[spike] wrote", out_glb)


def np3_to_q(R):
    return m3(R).to_quaternion()


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:]
    run(argv[0], argv[1])
