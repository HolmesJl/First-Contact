"""Minimal BVH reader with forward kinematics (numpy only; also runs inside Blender's Python)."""
import re

import numpy as np


def _rot(axis, deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    n = len(a)
    m = np.zeros((n, 3, 3))
    m[:, 0, 0] = m[:, 1, 1] = m[:, 2, 2] = 1
    if axis == "X":
        m[:, 1, 1], m[:, 1, 2], m[:, 2, 1], m[:, 2, 2] = c, -s, s, c
    elif axis == "Y":
        m[:, 0, 0], m[:, 0, 2], m[:, 2, 0], m[:, 2, 2] = c, s, -s, c
    else:
        m[:, 0, 0], m[:, 0, 1], m[:, 1, 0], m[:, 1, 1] = c, -s, s, c
    return m


class Bvh:
    """Joint rotations are returned as world matrices in BVH axes (X left, Y up, Z forward for ACCAD)."""

    def __init__(self, path):
        self.path = path
        text = open(path).read()
        head, motion = text.split("MOTION")
        self.names, self.parent, self.offset, self.channels = [], [], [], []
        self.end_offset = {}
        stack = []
        pending = None
        for raw in head.splitlines():
            t = raw.strip().split()
            if not t:
                continue
            if t[0] in ("ROOT", "JOINT"):
                self.names.append(t[1])
                self.parent.append(stack[-1] if stack else -1)
                self.offset.append(None)
                self.channels.append([])
                pending = len(self.names) - 1
            elif t[0] == "End":
                pending = -2
            elif t[0] == "{":
                stack.append(pending)
            elif t[0] == "}":
                stack.pop()
            elif t[0] == "OFFSET" and pending != -2:
                self.offset[pending] = np.array([float(x) for x in t[1:4]])
            elif t[0] == "OFFSET":
                self.end_offset[stack[-2]] = np.array([float(x) for x in t[1:4]])
            elif t[0] == "CHANNELS":
                self.channels[pending] = t[2:]
        lines = [l for l in motion.strip().splitlines() if l.strip()]
        self.frames = int(lines[0].split()[1])
        self.dt = float(lines[1].split()[-1])
        data = np.array([[float(x) for x in l.split()] for l in lines[2:2 + self.frames]])
        self.data = data
        self.offset = np.array(self.offset)
        self.index = {n: i for i, n in enumerate(self.names)}
        self._fk()

    def _fk(self):
        n, f = len(self.names), self.frames
        self.local = np.zeros((f, n, 3, 3))
        self.world_rot = np.zeros((f, n, 3, 3))
        self.world_pos = np.zeros((f, n, 3))
        col = 0
        root_pos = None
        for j in range(n):
            ch = self.channels[j]
            r = np.tile(np.eye(3), (f, 1, 1))
            pos = np.zeros((f, 3))
            for c in ch:
                v = self.data[:, col]
                col += 1
                if c.endswith("position"):
                    pos[:, "XYZ".index(c[0])] = v
                else:
                    r = r @ _rot(c[0], v)
            self.local[:, j] = r
            if j == 0:
                root_pos = pos
        for j in range(n):
            p = self.parent[j]
            if p < 0:
                self.world_rot[:, j] = self.local[:, j]
                self.world_pos[:, j] = root_pos
            else:
                self.world_rot[:, j] = self.world_rot[:, p] @ self.local[:, j]
                self.world_pos[:, j] = self.world_pos[:, p] + np.einsum("fij,j->fi", self.world_rot[:, p], self.offset[j])

    def pos(self, name):
        return self.world_pos[:, self.index[name]]

    def rot(self, name):
        return self.world_rot[:, self.index[name]]
