"""Non-destructive, full-length clip/gain rendering. No media or model imports."""
import json
import math


def parse_edits(raw, duration):
    value = json.loads(raw) if isinstance(raw, str) else raw
    if not value:
        return None
    if not isinstance(value, dict) or not isinstance(value.get('clips'), list) or not isinstance(value.get('gains'), list) or len(value['clips']) > 256 or len(value['gains']) > 512:
        raise ValueError('Invalid clip edits')
    for key in ['clips', 'gains']:
        previous = -1
        for item in value[key]:
            start, end = item['start'], item['end']
            offset = item.get('offset', 0) if key == 'clips' else 0
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in [start, end, offset]) or start < 0 or end <= start or end > 864000 or abs(offset) > 864000:
                raise ValueError('Invalid clip range')
            # Clips sit at [start + offset, end + offset] on the timeline and may not overlap there.
            if start + offset < -.000001 or end + offset > 864000 or start + offset < previous - .000001:
                raise ValueError('Invalid clip range')
            previous = end + offset
            if key == 'gains' and (not isinstance(item['db'], (int, float)) or not math.isfinite(item['db']) or not -60 <= item['db'] <= 24):
                raise ValueError('Invalid clip gain')
    return value


def edit_array(wave, rate, raw):
    import numpy as np
    length = wave.shape[-1]
    edit = parse_edits(raw, length / rate)
    if edit is None:
        return wave
    result = np.zeros_like(wave)
    for clip in edit['clips']:
        source = max(0, round(clip['start'] * rate))
        stop = min(length, round(clip['end'] * rate))
        target = round((clip['start'] + clip.get('offset', 0)) * rate)
        if target < 0:
            source, target = source - target, 0
        count = min(stop - source, length - target)
        if count > 0:
            result[..., target:target + count] = wave[..., source:source + count]
    envelope = np.ones(length, dtype=np.float32)
    for region in edit['gains']:
        envelope[round(region['start'] * rate):round(region['end'] * rate)] *= 10 ** (region['db'] / 20)
    return result * envelope


class StemStudioEditAudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'audio': ('AUDIO',), 'edits_json': ('STRING', {'default': '{}'})}}
    RETURN_TYPES = ('AUDIO',)
    FUNCTION = 'render'
    CATEGORY = 'Stem Studio'

    def render(self, audio, edits_json='{}'):
        import torch
        wave = audio['waveform']
        result = edit_array(wave.detach().float().cpu().numpy(), audio['sample_rate'], edits_json)
        return ({'waveform': torch.from_numpy(result).to(device=wave.device, dtype=wave.dtype), 'sample_rate': audio['sample_rate']},)
