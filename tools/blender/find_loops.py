"""Offline helper: finds low-cost loop points in ACCAD clips. Prints candidates for tools/blender/clips.py.

  python3 tools/blender/find_loops.py Female1_bvh/Female1_A02_Sway.bvh 90 220
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bvh import Bvh  # noqa: E402

ACCAD = os.environ.get("ACCAD_DIR", os.path.join(os.path.dirname(__file__), "../.cache/accad"))
BONES = ["Hips", "Spine", "Spine1", "Head", "LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "LeftFoot", "RightFoot"]


def candidates(path, min_len, max_len, top=6, margin=20):
    b = Bvh(os.path.join(ACCAD, path))
    rot = np.stack([b.rot(n) for n in BONES], axis=1)
    pos = b.pos("Hips") * 0.01
    n = b.frames
    res = []
    for a in range(margin, n - min_len):
        for L in range(min_len, min(max_len, n - a - 2) + 1):
            c = a + L
            pose = np.linalg.norm(rot[a] - rot[c], axis=(1, 2)).sum()
            vel = np.linalg.norm((rot[a + 1] - rot[a]) - (rot[c + 1] - rot[c]), axis=(1, 2)).sum() * 3
            hgt = abs(pos[a, 1] - pos[c, 1]) * 5
            res.append((pose + vel + hgt, a, c))
    res.sort()
    out = []
    for cost, a, c in res:
        if all(abs(a - oa) > 15 for _, oa, _ in out):
            out.append((cost, a, c))
        if len(out) >= top:
            break
    return out


if __name__ == "__main__":
    for cost, a, c in candidates(sys.argv[1], int(sys.argv[2]), int(sys.argv[3])):
        print(f"cost {cost:.3f}  frames ({a}, {c})  len {c - a} ({(c - a) / 30:.1f}s)")
