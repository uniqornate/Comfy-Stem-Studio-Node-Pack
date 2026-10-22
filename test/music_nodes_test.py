"""Music separation wrapper tests. Uses Torch with a stand-in model; no ComfyUI, GPU or real weights."""
import importlib
import sys
import tempfile
import types
import unittest
from pathlib import Path

try:
    import torch
except ImportError:  # the Python suite runs where Torch is absent too
    torch = None

base = Path(__file__).resolve().parents[1] / 'comfy_nodes/StemStudio'
package = types.ModuleType('StemStudioMusicFixture')
package.__path__ = [str(base)]
sys.modules['StemStudioMusicFixture'] = package


@unittest.skipIf(torch is None, 'Torch is not installed')
class MusicNodes(unittest.TestCase):
    def setUp(self):
        self.music = importlib.import_module('StemStudioMusicFixture.music_nodes')

    def test_outputs_are_six_named_stems(self):
        self.assertEqual(len(self.music.OUTPUTS), 6)
        self.assertEqual(self.music.StemStudioMusicSeparate.RETURN_NAMES, ('vocals', 'drums', 'bass', 'guitar', 'piano', 'other'))
        self.assertEqual(len(self.music.StemStudioMusicSeparate.RETURN_TYPES), 6)

    def test_mono_becomes_stereo_and_extra_channels_are_dropped(self):
        mono = self.music.stereo({'waveform': torch.ones(1, 1, 100), 'sample_rate': 44100})
        self.assertEqual(tuple(mono.shape), (1, 2, 100))
        many = self.music.stereo({'waveform': torch.ones(1, 6, 100), 'sample_rate': 44100})
        self.assertEqual(tuple(many.shape), (1, 2, 100))
        with self.assertRaises(ValueError):
            self.music.stereo({'waveform': torch.full((1, 2, 10), float('nan')), 'sample_rate': 44100})

    def test_windows_cross_fade_back_to_the_original_levels(self):
        class Model:
            sources = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
            segment = 1.0
            samplerate = 1000

            def __call__(self, chunk):
                return torch.stack([chunk * (index + 1) / 21 for index in range(6)], dim=1)

        wave = torch.sin(torch.linspace(0, 40, 3700)).repeat(2, 1)[None] * 0.5 + 0.2
        steps = []
        result = self.music.separate_music(wave, Model(), torch.device('cpu'), progress=steps.append)
        self.assertEqual(tuple(result.shape), (6, 2, 3700))
        self.assertTrue(len(steps) > 3)
        centred = wave[0] - wave[0].mean(dim=0).mean()
        for index in range(6):
            self.assertTrue(torch.allclose(result[index], centred * (index + 1) / 21, atol=1e-4))
        self.assertTrue(torch.allclose(result.sum(dim=0), centred, atol=1e-4))

    def test_checkpoint_reader_refuses_unknown_classes(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'bad.th'
            torch.save({'klass': Path('x')}, path)
            with self.assertRaises(Exception):
                self.music.load_model(path)

    def test_missing_model_is_reported_not_listed(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, 'missing or incomplete'):
                self.music.verify(Path(folder) / 'nothing.th')


if __name__ == '__main__':
    unittest.main()
