"""ComfyUI entry point when this repository is cloned into custom_nodes (ComfyUI Manager or the Comfy Registry).

The node pack itself lives in comfy_nodes/StemStudio so the desktop app can install the same folder on its own.
"""
from .comfy_nodes.StemStudio import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./comfy_nodes/StemStudio/web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
