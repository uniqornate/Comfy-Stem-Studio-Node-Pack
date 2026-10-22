"""Music stem separation with the pinned HTDemucs 6-source model (Meta, MIT). No model activity at node discovery."""
import hashlib
import pickle
from pathlib import Path

MODEL_ID = 'htdemucs_6s'
MODEL_FILE = 'htdemucs-6s/htdemucs_6s.th'
MODEL_SIZE = 54996327
MODEL_SHA256 = '34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd'
RATE = 44100
# Output order of the node. The model itself returns drums, bass, other, vocals, guitar, piano.
OUTPUTS = ('vocals', 'drums', 'bass', 'guitar', 'piano', 'other')
NOT_INSTALLED = 'Model not installed'


def model_path():
    from .extra_nodes import model_root
    return model_root() / MODEL_FILE


def available_models():
    try:
        path = model_path()
        return [MODEL_ID] if path.is_file() and path.stat().st_size == MODEL_SIZE else [NOT_INSTALLED]
    except (OSError, ValueError, KeyError):
        return [NOT_INSTALLED]


def verify(path):
    if not path.is_file() or path.stat().st_size != MODEL_SIZE:
        raise ValueError(f'The music model is missing or incomplete: {path}. Download it from the 6-stem dialog in Stem Studio.')
    value = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(block)
    if value.hexdigest() != MODEL_SHA256:
        raise ValueError('The music model checksum failed. Delete the file and download it again.')


def load_model(path):
    """Reads Meta's checkpoint package with an unpickler that knows only the four classes it contains."""
    import torch
    from .vendor_extra.demucs.htdemucs import HTDemucs
    from fractions import Fraction
    from collections import OrderedDict
    allowed = {('collections', 'OrderedDict'): OrderedDict, ('fractions', 'Fraction'): Fraction, ('demucs.htdemucs', 'HTDemucs'): HTDemucs}

    class Reader(pickle.Unpickler):
        def find_class(self, module, name):
            if (module, name) in allowed:
                return allowed[(module, name)]
            if module == 'torch._utils' and name == '_rebuild_tensor_v2':
                return super().find_class(module, name)
            if module == 'torch' and name.endswith('Storage'):
                return super().find_class(module, name)
            raise pickle.UnpicklingError(f'Unexpected object in the music model file: {module}.{name}')

    class Shim:
        Unpickler = Reader
        load = staticmethod(pickle.load)
        __name__ = 'stemstudio_pickle'

    package = torch.load(path, map_location='cpu', weights_only=False, pickle_module=Shim)
    model = package['klass'](*package['args'], **package['kwargs'])
    model.load_state_dict(package['state'], strict=True)
    return model.eval()


def stereo(audio):
    import torch
    import torchaudio.functional as AF
    value = audio['waveform'].detach().float().cpu()
    if value.ndim != 3 or value.shape[0] != 1 or not value.shape[-1] or not torch.isfinite(value).all():
        raise ValueError('Choose one source with finite non-empty audio.')
    if value.shape[1] == 1:
        value = value.repeat(1, 2, 1)
    value = value[:, :2]
    return AF.resample(value, audio['sample_rate'], RATE) if audio['sample_rate'] != RATE else value


def separate_music(wave, model, device, progress=None, interrupted=None):
    """Overlapping 50 percent windows with a triangular cross-fade. wave: (1, 2, T). Returns (6, 2, T) in model order."""
    import torch
    length = wave.shape[-1]
    size = int(model.segment * model.samplerate)
    shift = size // 2
    starts = [0] if length <= size else list(range(0, length - size + shift, shift))
    reference = wave[0].mean(dim=0)
    mean, deviation = reference.mean(), reference.std().clamp_min(1e-8)
    normal = (wave - mean) / deviation
    output = torch.zeros(len(model.sources), 2, length)
    weight = torch.zeros(length)
    ramp = torch.cat([torch.arange(1, size // 2 + 1), torch.arange(size - size // 2, 0, -1)]).float()
    ramp = ramp / ramp.max()
    with torch.inference_mode():
        for index, start in enumerate(starts):
            if interrupted: interrupted()
            valid = min(size, length - start)
            chunk = normal[..., start:start + valid]
            if torch.count_nonzero(chunk).item():
                estimate = model(chunk.to(device))[0].detach().float().cpu()[..., :valid]
                output[..., start:start + valid] += estimate * ramp[:valid]
            weight[start:start + valid] += ramp[:valid]
            if progress: progress(index + 1)
    # The input's constant offset was removed before separation and is not added back to each stem.
    output = output / weight.clamp_min(1e-6)[None, None, :] * deviation
    if not torch.isfinite(output).all():
        raise RuntimeError('Separation produced invalid samples; no stems were exported.')
    return output


class StemStudioMusicSeparate:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'audio': ('AUDIO',), 'model': (available_models(),)}}

    RETURN_TYPES = ('AUDIO',) * len(OUTPUTS)
    RETURN_NAMES = OUTPUTS
    FUNCTION = 'separate'
    CATEGORY = 'Stem Studio'

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float('nan')

    def separate(self, audio, model):
        import comfy.model_management as mm
        from comfy.utils import ProgressBar
        if model != MODEL_ID:
            raise ValueError('Download the 6-stem music model from the Stem Studio dialog first.')
        path = model_path()
        verify(path)
        wave = stereo(audio)
        device = mm.get_torch_device()
        mm.unload_all_models()
        mm.soft_empty_cache()
        net = None
        try:
            net = load_model(path).to(device)
            size = int(net.segment * net.samplerate)
            count = 1 if wave.shape[-1] <= size else len(range(0, wave.shape[-1] - size + size // 2, size // 2))
            bar = ProgressBar(count)
            result = separate_music(wave, net, device, progress=bar.update, interrupted=mm.throw_exception_if_processing_interrupted)
            order = {name: index for index, name in enumerate(net.sources)}
            return tuple({'waveform': result[order[name]][None].contiguous(), 'sample_rate': RATE} for name in OUTPUTS)
        finally:
            del net
            mm.soft_empty_cache()
