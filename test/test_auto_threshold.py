import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('calibration', Path(__file__).resolve().parents[1] / 'comfy_nodes/StemStudio/auto_threshold.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class CalibrationTests(unittest.TestCase):
    def test_silence_and_weak_noise_are_rejected(self):
        for scores in ([0] * 10, [0.001, 0.003, 0.02], [0.01] * 8):
            self.assertFalse(module.calibrate(scores)[0])
    def test_isolated_event_survives_without_minimum_duration(self):
        present, threshold = module.calibrate([0.001] * 20 + [0.16] + [0.002] * 20)
        self.assertTrue(present); self.assertLessEqual(threshold, 0.16); self.assertGreaterEqual(threshold, 0.025)
    def test_continuous_sound_is_not_rejected_as_background(self):
        present, threshold = module.calibrate([0.8] * 10)
        self.assertTrue(present); self.assertLess(threshold, 0.8)
    def test_per_class_calibration_adapts_to_score_distribution(self):
        self.assertLess(module.calibrate([0.01, 0.01, 0.2])[1], module.calibrate([0.3, 0.4, 0.6])[1])
    def test_single_window_is_supported(self):
        self.assertTrue(module.calibrate([0.15])[0])
    def test_invalid_confidences_fail(self):
        for scores in ([], [float('nan')], [-1], [2]):
            with self.assertRaises(ValueError): module.calibrate(scores)

if __name__ == '__main__': unittest.main()
