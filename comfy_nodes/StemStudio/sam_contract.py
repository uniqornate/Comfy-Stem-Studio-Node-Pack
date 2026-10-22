"""Small dependency-free validation shared by the SAM worker."""
def sam_description(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        raise ValueError('Choose a named target sound for SAM Audio.')
    return value.strip().lower()

def guidance(value, duration):
    import json
    import math
    if not isinstance(value, str) or len(value) > 16000:
        raise ValueError('Invalid SAM guidance payload.')
    data = json.loads(value or '{}')
    if not isinstance(data, dict): raise ValueError('SAM guidance must be an object.')
    finite = lambda number: isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number)
    anchors = data.get('anchors', [])
    if not isinstance(anchors, list) or len(anchors) > 16: raise ValueError('Use up to 16 SAM anchors.')
    for anchor in anchors:
        if not isinstance(anchor, list) or len(anchor) != 3 or anchor[0] not in ['+', '-'] or not all(finite(n) for n in anchor[1:]) or anchor[1] < 0 or anchor[2] > duration + 0.001 or anchor[2] - anchor[1] < 0.019:
            raise ValueError('SAM anchors must stay within the selected audio.')
    for a in anchors:
        for b in anchors:
            if a[0] != b[0] and max(a[1], b[1]) < min(a[2], b[2]): raise ValueError('Opposite SAM anchors overlap.')
    frames = data.get('keyframes', [])
    if not isinstance(frames, list) or len(frames) > 12 or frames and duration > 30.001: raise ValueError('Use up to 12 visual marks within a 30-second selection.')
    times = set()
    for frame in frames:
        if not isinstance(frame, dict) or not finite(frame.get('time')) or not 0 <= frame['time'] <= duration + .001 or frame['time'] in times: raise ValueError('Invalid visual mark time.')
        times.add(frame['time']); box = frame.get('box', {})
        if not isinstance(box, dict) or not all(finite(box.get(key)) for key in ['x', 'y', 'width', 'height']) or min(box['x'], box['y']) < 0 or min(box['width'], box['height']) < .005 or box['x'] + box['width'] > 1.000001 or box['y'] + box['height'] > 1.000001:
            raise ValueError('Visual target boxes must be inside the picture.')
    visual_only = data.get('visualOnly') is True
    if visual_only and not frames: raise ValueError('Visual-only extraction needs a target box.')
    return {'anchors': anchors, 'keyframes': sorted(frames, key=lambda f: f['time']), 'visualOnly': visual_only, 'predictSpans': data.get('predictSpans') is True and not anchors and not visual_only}

def box_at(keyframes, time):
    # One mark holds (a still source). With two or more the target exists only between the first and last mark.
    if len(keyframes) == 1: return keyframes[0]['box']
    if time < keyframes[0]['time'] - 1e-6 or time > keyframes[-1]['time'] + 1e-6: return None
    if time <= keyframes[0]['time']: return keyframes[0]['box']
    for previous, following in zip(keyframes, keyframes[1:]):
        if time <= following['time']:
            fraction = (time - previous['time']) / (following['time'] - previous['time'])
            return {key: previous['box'][key] + (following['box'][key] - previous['box'][key]) * fraction for key in ['x', 'y', 'width', 'height']}
    return keyframes[-1]['box']
