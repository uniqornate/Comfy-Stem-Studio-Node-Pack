"""Synthetic region tests only. No Torch, GPU, model, codec or Comfy runtime."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np

path = Path(__file__).resolve().parents[1] / 'comfy_nodes/StemStudio/detail_nodes.py'
spec = importlib.util.spec_from_file_location('detail_nodes_fixture', path)
nodes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nodes)

class Tensor:
    def __init__(self, data): self.data = np.asarray(data)
    @property
    def shape(self): return self.data.shape
    @property
    def dtype(self): return self.data.dtype
    device = 'cpu'
    def __getitem__(self, key): return Tensor(self.data[key])
    def __setitem__(self, key, value): self.data[key] = value.data

def audio(data, rate): return {'waveform': Tensor(data), 'sample_rate': rate}

class RegionTests(unittest.TestCase):
    def test_crop_uses_fractional_range_and_rejects_empty_or_invalid_selection(self):
        source = audio(np.arange(20).reshape(1, 1, 20), 10)
        cropped, = nodes.StemStudioAudioRange().crop(source, .3, .8)
        self.assertEqual(cropped['waveform'].data.tolist(), [[[3, 4, 5, 6, 7]]])
        for start, end in [(-1, 1), (1, 1), (5, 6), (0, float('inf'))]:
            with self.assertRaises(ValueError): nodes.bounds(source, start, end)

    def test_padding_preserves_original_duration_at_output_rate(self):
        reference = audio(np.zeros((1, 1, 20)), 10)
        target = audio(np.ones((1, 1, 8)), 20)
        fake = types.SimpleNamespace(zeros=lambda shape, **kwargs: Tensor(np.zeros(shape, dtype=kwargs['dtype'])))
        with patch.dict(sys.modules, {'torch': fake}):
            result = nodes.restore(target, reference, .5)
        expected = np.zeros((1, 1, 40)); expected[..., 10:18] = 1
        np.testing.assert_array_equal(result['waveform'].data, expected)
        self.assertEqual(result['sample_rate'], 20)

if __name__ == '__main__': unittest.main()
