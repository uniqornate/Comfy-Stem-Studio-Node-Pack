"""Experimental confidence calibration, independent of audio loudness."""
from statistics import median
import math


def calibrate(scores):
    values = [float(value) for value in scores]
    if not values or any(not math.isfinite(value) or not 0 <= value <= 1 for value in values):
        raise ValueError('Expected finite classifier confidences in [0, 1].')
    peak = max(values)
    baseline = median(values)
    deviation = median(abs(value - baseline) for value in values)
    # No consecutive-window requirement: isolated short events remain eligible.
    evidence = min(0.30, max(0.08, baseline + 3 * deviation))
    cutoff = max(0.025, min(0.30, peak * 0.5, baseline + 2 * deviation))
    return peak >= evidence, cutoff
