"""Shared helpers for the MPFB headless scripts (run inside Blender)."""
import importlib
import sys


def dynamic_import(package_suffix, key):
    """MPFB ships as a Blender extension, so its absolute module path is not known ahead of time."""
    for name in list(sys.modules):
        if name.endswith(package_suffix):
            mod = importlib.import_module(name)
            if hasattr(mod, key):
                return getattr(mod, key)
    raise ValueError(f"No module ending in {package_suffix} exposes {key}")
