import importlib.util
from pathlib import Path
from fractions import Fraction
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
import sys
import unittest

BASE = Path(__file__).resolve().parents[1]

class Context:
    def __enter__(self): return self
    def __exit__(self, *args): return False

class NativeAdapterTests(unittest.TestCase):
    def load(self, fail=False):
        self.copied = []; self.muxed = []; self.checks = 0
        def check():
            self.checks += 1
            if fail and self.checks > 3: raise RuntimeError('mock interruption')
        def stream(kind, start=0):
            return SimpleNamespace(type=kind, start_time=start, time_base=Fraction(1, 1000), codec_context=SimpleNamespace(name='flac' if kind == 'audio' else 'h264'), metadata={}, disposition=0)
        video, original_audio = stream('video'), stream('audio', 50)
        def packet(value, timestamp, owner): return SimpleNamespace(payload=value, pts=timestamp, dts=timestamp, time_base=Fraction(1, 1000), stream=owner)
        class Container(Context):
            def __init__(inner, streams, packets): inner.streams = streams; inner.packets = packets
            def demux(inner, selected): return iter(inner.packets)
            def decode(inner, *args): raise AssertionError('No video/audio decode in separate-track mode')
        original = Container(SimpleNamespace(video=[video], audio=[original_audio]), [packet(b'v0', 0, video), packet(b'v1', 40, video), packet(b'v2', 80, video)])
        audio = stream('audio')
        track = Container(SimpleNamespace(audio=[audio]), [packet(b'a0', 0, audio), packet(b'a1', 20, audio)])
        class Output(Context):
            def add_stream_from_template(inner, source, **kwargs):
                self.copied.append(source); return stream(source.type)
            def mux(inner, value): self.muxed.append((value.payload, value.dts, value.stream.type))
        def open_media(path, mode='r', **kwargs):
            if mode == 'w': self.assertEqual(kwargs['format'], 'matroska'); return Output()
            return track if str(path).endswith('.flac') else original
        modules = {}
        for name in ['comfy_api', 'comfy_api.latest', 'comfy_api.latest._input', 'comfy_api.latest._input_impl', 'comfy_api.latest._input_impl.video_types', 'comfy', 'comfy.model_management', 'comfy.utils', 'av', 'numpy']:
            modules[name] = ModuleType(name)
        modules['comfy_api.latest._input'].VideoInput = object
        modules['comfy_api.latest._input_impl.video_types'].write_output_metadata = lambda *args: None
        modules['comfy.model_management'].throw_exception_if_processing_interrupted = check
        modules['comfy'].model_management = modules['comfy.model_management']
        class Progress:
            def __init__(self, *args): pass
            def update_absolute(self, *args): pass
        modules['comfy.utils'].ProgressBar = Progress
        modules['av'].open = open_media
        self.module_patch = patch.dict(sys.modules, modules); self.module_patch.start(); self.addCleanup(self.module_patch.stop)
        spec = importlib.util.spec_from_file_location('native_video_fixture', BASE / 'comfy_nodes/StemStudio/video_export.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        self.source = SimpleNamespace(get_stream_source=lambda: '/fixture/source.mp4', get_duration=lambda: 1.0, get_dimensions=lambda: (1920, 1080))
        self.tracks = [{'path': '/fixture/target.flac', 'label': 'Dialogue', 'level': 0.7, 'mute': False, 'solo': True}]
        return module

    def test_native_video_passes_encoded_packets_without_decoding_or_encoding(self):
        module = self.load()
        video = module.StemVideo(self.source, self.tracks, 'tracks')
        video.save_to('/fixture/new.mkv', format='mkv', codec='auto')
        self.assertEqual(len(self.copied), 2)
        self.assertEqual([item[0] for item in self.muxed if item[2] == 'video'], [b'v0', b'v1', b'v2'])
        self.assertEqual([item[1] for item in self.muxed], [0, 40, 50, 70, 80])
        self.assertGreater(self.checks, 0)

    def test_incompatible_native_save_overrides_fail_without_muxing(self):
        module = self.load(); video = module.StemVideo(self.source, self.tracks, 'tracks')
        for kwargs in [dict(format='mp4'), dict(format='mkv', codec='h264'), dict(format='mkv', crf=18)]:
            with self.assertRaises(ValueError): video.save_to('/fixture/new.mkv', **kwargs)
        self.assertEqual(self.muxed, [])

    def test_input_overwrite_and_frame_materialization_are_refused(self):
        module = self.load(); video = module.StemVideo(self.source, self.tracks, 'tracks')
        with self.assertRaises(ValueError): video.save_to('/fixture/source.mp4', format='mkv')
        with self.assertRaises(ValueError): video.get_components()

    def test_cancel_checks_stop_remux(self):
        module = self.load(fail=True); video = module.StemVideo(self.source, self.tracks, 'tracks')
        with self.assertRaisesRegex(RuntimeError, 'mock interruption'): video.save_to(str(BASE / 'test' / 'nonexistent-native-fixture.mkv'), format='mkv')

if __name__ == '__main__': unittest.main()
