"""Synthetic prompt and frame tests. No actual media/model/GPU is opened."""
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch
import numpy as np

ROOT = Path(__file__).resolve().parents[1] / 'comfy_nodes/StemStudio'
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
contract = load('sam_fixture.sam_contract', 'sam_contract.py')
visual = load('sam_fixture.sam_visual', 'sam_visual.py')

class Tests(unittest.TestCase):
    def test_anchor_validation_and_automatic_span_priority(self):
        data = contract.guidance(json.dumps({'anchors': [['+', 1, 2], ['-', 3, 4]], 'predictSpans': True}), 5)
        self.assertFalse(data['predictSpans'])
        self.assertTrue(contract.guidance('{"predictSpans":true}', 5)['predictSpans'])
        for anchors in [[['+', -1, 2]], [['+', 1, 3], ['-', 2, 4]], [['+', 1, 9]]]:
            with self.assertRaises(ValueError): contract.guidance(json.dumps({'anchors': anchors}), 5)

    def test_visual_bounds_and_interpolation(self):
        box = {'x': .1, 'y': .1, 'width': .2, 'height': .2}
        frames = [{'time': 0, 'box': box}, {'time': 4, 'box': {**box, 'x': .5}}]
        self.assertAlmostEqual(contract.box_at(frames, 2)['x'], .3)
        self.assertEqual(contract.box_at(frames, 4)['x'], .5)
        self.assertIsNone(contract.box_at(frames, 7)); self.assertIsNone(contract.box_at(frames, -1))
        self.assertEqual(contract.box_at(frames[:1], 9)['x'], .1)
        with self.assertRaises(ValueError): contract.guidance(json.dumps({'keyframes': frames}), 40)
        with self.assertRaises(ValueError): contract.guidance(json.dumps({'keyframes': [{'time': 0, 'box': {**box, 'width': 2}}]}), 5)
        result = contract.guidance(json.dumps({'keyframes': frames, 'visualOnly': True, 'predictSpans': True}), 5)
        self.assertTrue(result['visualOnly']); self.assertFalse(result['predictSpans'])
        with self.assertRaises(ValueError): contract.guidance('{"visualOnly":true}', 5)

    def test_mask_sampling_keeps_selected_pixels_and_last_frame_display_interval(self):
        class Frame:
            width = 4; height = 4; rotation = 0; duration = 1
            def __init__(self, pts): self.pts = pts
            def reformat(self, **kwargs): return self
            def to_ndarray(self): return np.full((4,4,3), 100, dtype=np.uint8)
        stream = types.SimpleNamespace(start_time=100, time_base=Fraction(1,10), average_rate=10)
        class Container:
            streams = types.SimpleNamespace(video=[stream])
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def seek(self, *args, **kwargs): pass
            def decode(self, stream): return iter([Frame(100), Frame(101)])
        fake_av = types.SimpleNamespace(open=lambda source: Container())
        mm = types.SimpleNamespace(throw_exception_if_processing_interrupted=lambda: None)
        modules = {'av': fake_av, 'comfy': types.ModuleType('comfy'), 'comfy.model_management': mm, 'sam_fixture': types.ModuleType('sam_fixture'), 'sam_fixture.sam_contract': contract}
        with tempfile.TemporaryDirectory(prefix='sam-mask-fixture-') as folder, patch.dict(sys.modules, modules):
            output = Path(folder) / 'frames.npy'
            visual.masked_frames(types.SimpleNamespace(get_stream_source=lambda: 'synthetic fixture'), 0, .2, [{'time': 0, 'box': {'x': .25, 'y': .25, 'width': .5, 'height': .5}}], output)
            frames = np.load(output, allow_pickle=False)
            self.assertEqual(frames.shape, (2,3,4,4))
            self.assertEqual(frames[0, :,1:3,1:3].min(), 100)
            self.assertEqual(frames[0,:,0,:].max(), 0)

    def test_short_video_gap_holds_the_last_frame_but_a_large_gap_is_rejected(self):
        class Frame:
            width = 4; height = 4; rotation = 0; duration = 1
            def __init__(self, pts): self.pts = pts
            def reformat(self, **kwargs): return self
            def to_ndarray(self): return np.full((4,4,3), 100, dtype=np.uint8)
        stream = types.SimpleNamespace(start_time=0, time_base=Fraction(1,10), average_rate=10)
        class Container:
            streams = types.SimpleNamespace(video=[stream])
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def seek(self, *args, **kwargs): pass
            def decode(self, stream): return iter([Frame(0), Frame(1)])
        fake_av = types.SimpleNamespace(open=lambda source: Container())
        mm = types.SimpleNamespace(throw_exception_if_processing_interrupted=lambda: None)
        modules = {'av': fake_av, 'comfy': types.ModuleType('comfy'), 'comfy.model_management': mm, 'sam_fixture': types.ModuleType('sam_fixture'), 'sam_fixture.sam_contract': contract}
        box = [{'time': 0, 'box': {'x': .25, 'y': .25, 'width': .5, 'height': .5}}]
        source = types.SimpleNamespace(get_stream_source=lambda: 'synthetic fixture')
        with tempfile.TemporaryDirectory(prefix='sam-mask-fixture-') as folder, patch.dict(sys.modules, modules):
            output = Path(folder) / 'frames.npy'
            visual.masked_frames(source, 0, .6, box, output)
            self.assertEqual(np.load(output, allow_pickle=False).shape[0], 4)
            with self.assertRaisesRegex(ValueError, 'ends at about'): visual.masked_frames(source, 0, 3, box, output)

if __name__ == '__main__': unittest.main()
