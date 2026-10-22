import importlib.util
import tempfile
import types
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('model_paths', Path(__file__).parent.parent / 'comfy_nodes' / 'StemStudio' / 'model_paths.py')
model_paths = importlib.util.module_from_spec(spec); spec.loader.exec_module(model_paths)


class FakeFolderPaths:
    def __init__(self, models_dir, categories):
        self.models_dir = models_dir
        self.folder_names_and_paths = {name: ([], set()) for name in categories}

    def add_model_folder_path(self, name, path):
        self.folder_names_and_paths.setdefault(name, ([], set()))[0].append(path)


class ModelPathsTest(unittest.TestCase):
    def test_brush_folder_joins_native_loader_lists_without_creating_categories_or_duplicates(self):
        with tempfile.TemporaryDirectory() as models:
            fake = FakeFolderPaths(models, ['checkpoints', 'text_encoders'])
            model_paths.register(fake); model_paths.register(fake)
            brush = str(Path(models) / 'audio_separation' / 'stable-audio-3')
            self.assertEqual(fake.folder_names_and_paths['checkpoints'][0], [brush])
            self.assertEqual(fake.folder_names_and_paths['text_encoders'][0], [brush])
            self.assertNotIn('clip', fake.folder_names_and_paths)
            self.assertEqual(fake.folder_names_and_paths['audio_separation'][0].count(str(Path(models) / 'audio_separation')), 1)


if __name__ == '__main__': unittest.main()
