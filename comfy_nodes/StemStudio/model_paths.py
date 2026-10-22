"""Registers Stem Studio's model folders with ComfyUI's folder_paths."""
from pathlib import Path


def register(folder_paths):
    models = Path(folder_paths.models_dir)
    root = models / "audio_separation"
    known = folder_paths.folder_names_and_paths
    if str(root) not in known.get("audio_separation", ([], set()))[0]:
        folder_paths.add_model_folder_path("audio_separation", str(root))
    # The brush uses ComfyUI's own Stable Audio 3 nodes. Its two files stay under audio_separation, and the native
    # checkpoint and text encoder lists also search that folder, so nothing is scattered across ComfyUI/models.
    brush = str(root / "stable-audio-3")
    for category in ("checkpoints", "text_encoders", "clip"):
        if category in known and brush not in known[category][0]:
            folder_paths.add_model_folder_path(category, brush)
