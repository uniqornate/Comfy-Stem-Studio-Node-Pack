"""Frame choice for video regions. No video, Torch or ComfyUI needed."""
import importlib.util
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'comfy_nodes/StemStudio/video_clip.py'
spec = importlib.util.spec_from_file_location('video_clip_fixture', path)
clip = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clip)


class FrameChoice(unittest.TestCase):
    def test_nearest_frame_per_moment(self):
        times = [i / 10 for i in range(20)]
        moments = [1.0 + i / 25 for i in range(5)]
        self.assertEqual(clip.frame_indices(times, moments), [10, 10, 11, 11, 12])

    def test_last_frame_is_held_only_briefly(self):
        times = [0.0, 0.1, 0.2]
        self.assertEqual(clip.frame_indices(times, [0.2, 0.5]), [2, 2])
        with self.assertRaisesRegex(ValueError, 'ends at about'):
            clip.frame_indices(times, [0.2, 1.5])

    def test_no_frames_is_an_error(self):
        with self.assertRaises(ValueError):
            clip.frame_indices([], [0.0])

    def test_rate_and_node_shape(self):
        self.assertEqual(clip.FPS, 25)
        self.assertEqual(clip.StemStudioVideoClip.RETURN_TYPES, ('IMAGE',))


if __name__ == '__main__':
    unittest.main()
