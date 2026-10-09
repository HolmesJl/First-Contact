"""Which ACCAD motion-capture takes make up each gendered animation set (frames are 30 fps source frames)."""
import os

ACCAD_DIR = os.environ.get("ACCAD_DIR", os.path.normpath(os.path.join(os.path.dirname(__file__), "../.cache/accad")))

# Each set is one performer: Male1 for the men, Female1 for the women. `ref` is a neutral standing frame
# used as the common rest pose between the performer and the generated character.
# Stylisation layered on the performer's own motion (documented in docs/character-spike.md).
#   amp:    per-bone multiplier on rotation about the clip's mean orientation (1 = unchanged)
#   adduct: degrees each leg is rotated toward (+) or away from (-) the midline: narrower or wider base
#   sway:   multiplier on the pelvis' lateral sway and vertical bob
#   head_up: degrees the gaze is raised (mocap performers look at the floor)
#   retract / elevate / extend: degrees the clavicles are drawn back and up and the spine straightened
STYLES = {
    "female": {
        "walk": {"amp": {"pelvis": 1.9, "spine_01": 1.2, "spine_03": 0.55, "neck_01": 0.7, "upperarm_l": 0.7, "upperarm_r": 0.7, "lowerarm_l": 0.8, "lowerarm_r": 0.8, "thigh_l": 0.92, "thigh_r": 0.92}, "adduct": 3.5, "sway": 1.5, "head_up": 7},
        "jog": {"amp": {"pelvis": 1.5, "spine_03": 0.7, "upperarm_l": 0.75, "upperarm_r": 0.75, "thigh_l": 0.95, "thigh_r": 0.95}, "adduct": 2.5, "sway": 1.3, "head_up": 5},
        "sprint": {"amp": {"pelvis": 1.4, "spine_03": 0.75, "upperarm_l": 0.8, "upperarm_r": 0.8}, "adduct": 2.0, "sway": 1.2, "head_up": 5},
        "idle": {"amp": {"pelvis": 1.0}, "adduct": 0.0, "sway": 1.0, "head_up": 14},
    },
    "male": {
        "walk": {"amp": {"pelvis": 0.85, "spine_03": 1.3, "spine_02": 1.2, "head": 0.8, "upperarm_l": 1.25, "upperarm_r": 1.25, "thigh_l": 1.05, "thigh_r": 1.05}, "adduct": -3.0, "sway": 0.8, "head_up": 7},
        "jog": {"amp": {"pelvis": 0.9, "spine_03": 1.2, "upperarm_l": 1.15, "upperarm_r": 1.15}, "adduct": -2.0, "sway": 0.9, "head_up": 5},
        "sprint": {"amp": {"pelvis": 0.9, "spine_03": 1.15, "upperarm_l": 1.1, "upperarm_r": 1.1}, "adduct": -1.5, "sway": 0.9, "head_up": 5},
        "idle": {"amp": {"pelvis": 1.0}, "adduct": -2.0, "sway": 1.0, "head_up": 10},
    },
}

CLIP_SETS = {
    "male": {
        # Male 1's Stand, Sway and Walk takes carry a ~13 deg left/right clavicle asymmetry (see retarget_export.py).
        "symmetric_shoulders": True,
        "reference": {"file": "Male1_bvh/Male1_A1_Stand.bvh", "frame": 90},
        "clips": {
            "idle": {"file": "Male1_bvh/Male1_A2_Sway.bvh", "frames": (24, 143)},
            "walk": {"file": "Male1_bvh/Male1_B3_Walk.bvh", "frames": (47, 81)},
            "jog": {"file": "Male1_bvh/Male1_C03_Run.bvh", "frames": (17, 37), "speed": 0.78},
            "sprint": {"file": "Male1_bvh/Male1_C03_Run.bvh", "frames": (17, 37), "speed": 1.0},
        },
    },
    "female": {
        "reference": {"file": "Female1_bvh/Female1_A01_Stand.bvh", "frame": 45},
        "clips": {
            "idle": {"file": "Female1_bvh/Female1_A02_Sway.bvh", "frames": (39, 165)},
            "walk": {"file": "Female1_bvh/Female1_B03_Walk1.bvh", "frames": (53, 91)},
            "jog": {"file": "Female1_bvh/Female1_C03_Run.bvh", "frames": (5, 26), "speed": 0.78},
            "sprint": {"file": "Female1_bvh/Female1_C03_Run.bvh", "frames": (5, 26), "speed": 1.0},
        },
    },
}
