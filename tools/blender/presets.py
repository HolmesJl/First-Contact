"""Preset bodies and faces live in presets.json so the Blender scripts and the Node build share them."""
import json
import os

_DATA = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "presets.json")))
BODY_VERTEX_BUDGET = _DATA["vertexBudget"]
KEEP_SHAPES = _DATA["keepShapes"]
PRESETS = _DATA["presets"]
