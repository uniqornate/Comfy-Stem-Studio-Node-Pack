"""Region-only detail processing with full-timeline, silence-padded outputs."""
import math

class StemStudioLoadAudioRange:
    """Decode only the requested portion of a native ComfyUI input file."""
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'file': ('STRING', {'default': ''}), 'start_seconds': ('FLOAT', {'default': 0, 'min': 0, 'max': 864000}), 'end_seconds': ('FLOAT', {'default': 60, 'min': 0, 'max': 864000})}}
    RETURN_TYPES = ('AUDIO',)
    FUNCTION = 'load'
    CATEGORY = 'Stem Studio'

    def load(self, file, start_seconds, end_seconds):
        import av
        import folder_paths
        import torch
        if not math.isfinite(start_seconds) or not math.isfinite(end_seconds) or start_seconds < 0 or end_seconds <= start_seconds or end_seconds > 864000:
            raise ValueError('Choose a valid audio interval.')
        path = folder_paths.get_annotated_filepath(file)
        with av.open(path) as media:
            if not media.streams.audio:
                raise ValueError('The selected input has no audio stream.')
            stream = media.streams.audio[0]
            rate = stream.codec_context.sample_rate
            channels = stream.channels
            first, last = round(start_seconds * rate), round(end_seconds * rate)
            waveform = torch.zeros((1, channels, last - first), dtype=torch.float32)
            if start_seconds > 1:
                media.seek(int((start_seconds - 1) / stream.time_base), stream=stream, backward=True)
            cursor = 0
            copied = False
            for frame in media.decode(streams=stream.index):
                data = torch.from_numpy(frame.to_ndarray())
                if data.shape[0] != channels:
                    data = data.reshape(-1, channels).T
                if data.dtype == torch.int16:
                    data = data.float() / 32768
                elif data.dtype == torch.int32:
                    data = data.float() / 2147483648
                else:
                    data = data.float()
                position = round(float(frame.time) * rate) if frame.time is not None else cursor
                cursor = position + data.shape[-1]
                if position >= last:
                    break
                lo, hi = max(first, position), min(last, cursor)
                if hi > lo:
                    waveform[..., lo - first:hi - first] = data[:, lo - position:hi - position]
                    copied = True
            if not copied:
                raise ValueError('The requested interval contains no audio.')
            return ({'waveform': waveform, 'sample_rate': rate},)

def bounds(audio, start_seconds, end_seconds):
    rate = int(audio['sample_rate'])
    if not math.isfinite(start_seconds) or not math.isfinite(end_seconds) or start_seconds < 0 or end_seconds <= start_seconds:
        raise ValueError('Select a valid timeline range first.')
    start = min(audio['waveform'].shape[-1], round(start_seconds * rate))
    end = min(audio['waveform'].shape[-1], round(end_seconds * rate))
    if end <= start:
        raise ValueError('The selection is outside this channel.')
    return start, end

def restore(audio, reference, start_seconds):
    import torch
    rate = audio['sample_rate']
    length = round(reference['waveform'].shape[-1] / reference['sample_rate'] * rate)
    start = max(0, min(length, round(start_seconds * rate)))
    output = torch.zeros((*audio['waveform'].shape[:-1], length), dtype=audio['waveform'].dtype, device=audio['waveform'].device)
    count = min(audio['waveform'].shape[-1], length - start)
    output[..., start:start + count] = audio['waveform'][..., :count]
    return {'waveform': output, 'sample_rate': rate}

class StemStudioAudioRange:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'audio': ('AUDIO',), 'start_seconds': ('FLOAT', {'default': 0, 'min': 0, 'max': 864000}), 'end_seconds': ('FLOAT', {'default': 1, 'min': 0, 'max': 864000})}}
    RETURN_TYPES = ('AUDIO',)
    FUNCTION = 'crop'
    CATEGORY = 'Stem Studio'
    def crop(self, audio, start_seconds, end_seconds):
        start, end = bounds(audio, start_seconds, end_seconds)
        return ({'waveform': audio['waveform'][..., start:end], 'sample_rate': audio['sample_rate']},)

class StemStudioRestoreRange:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'audio': ('AUDIO',), 'reference': ('AUDIO',), 'start_seconds': ('FLOAT', {'default': 0, 'min': 0, 'max': 864000})}}
    RETURN_TYPES = ('AUDIO',)
    FUNCTION = 'pad'
    CATEGORY = 'Stem Studio'
    def pad(self, audio, reference, start_seconds):
        return (restore(audio, reference, start_seconds),)

class StemStudioSAM:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'audio': ('AUDIO',), 'description': ('STRING', {'default': 'footsteps'})}, 'optional': {'model_variant': (['small-tv', 'large-tv'],), 'guidance_json': ('STRING', {'default': '{}'}), 'video': ('VIDEO',), 'video_start': ('FLOAT', {'default': 0, 'min': 0, 'max': 864000})}}
    RETURN_TYPES = ('AUDIO', 'AUDIO')
    RETURN_NAMES = ('target', 'remainder')
    FUNCTION = 'extract'
    CATEGORY = 'Stem Studio'
    def extract(self, audio, description, guidance_json='{}', video=None, video_start=0, model_variant='small-tv'):
        import json
        import os
        import subprocess
        import tempfile
        import time
        from pathlib import Path
        import soundfile as sf
        import torch
        import comfy.model_management as mm
        from .extra_nodes import model_root
        from .sam_contract import sam_description, guidance
        prompts = guidance(guidance_json, audio['waveform'].shape[-1] / audio['sample_rate'])
        description = '' if prompts['visualOnly'] else sam_description(description)
        import math
        if not math.isfinite(video_start) or video_start < 0:
            raise ValueError('Invalid source video offset.')
        if prompts['keyframes'] and video is None:
            raise ValueError('Visual guidance needs the original video input.')
        if model_variant not in ['small-tv', 'large-tv']:
            raise ValueError('Unsupported SAM variant')
        model = model_root() / ('sam-audio-' + model_variant)
        try:
            config = json.loads((model / 'stem-runtime.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise ValueError('Prepare SAM Audio in the Extract sound dialog first.')
        python = Path(config['python'])
        if not python.is_file():
            raise ValueError('SAM private runtime missing. Retry Prepare SAM Audio.')
        device = str(mm.get_torch_device())
        if not device.startswith('cuda'):
            raise ValueError('SAM Audio needs a CUDA device in this experimental integration.')
        mm.unload_all_models(); mm.soft_empty_cache()
        with tempfile.TemporaryDirectory(prefix='stem-sam-') as directory:
            folder = Path(directory)
            sf.write(folder / 'input.wav', audio['waveform'][0].float().cpu().numpy().T, audio['sample_rate'], subtype='FLOAT')
            (folder / 'request.json').write_text(json.dumps({'model': str(model), 'description': description, 'device': device, 'guidance': prompts}), encoding='utf-8')
            if prompts['keyframes']:
                from .sam_visual import masked_frames
                masked_frames(video, video_start, audio['waveform'].shape[-1] / audio['sample_rate'], prompts['keyframes'], folder / 'visual.npy')
            cache = Path(config.get('cacheRoot', model / 'cache'))
            env = dict(os.environ, HF_HOME=str(cache), TORCH_HOME=str(cache / 'torch'), XDG_CACHE_HOME=str(cache / 'xdg'), HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
            for key in ['PYTHONHOME', 'PYTHONPATH', 'ELECTRON_RUN_AS_NODE', 'HF_TOKEN']:
                env.pop(key, None)
            with (folder / 'worker.log').open('wb') as log:
                process = subprocess.Popen([str(python), str(Path(__file__).with_name('sam_worker.py')), str(folder)], env=env, stdout=log, stderr=log, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                try:
                    while process.poll() is None:
                        mm.throw_exception_if_processing_interrupted(); time.sleep(0.2)
                    if process.returncode:
                        detail = (folder / 'worker.log').read_text(encoding='utf-8', errors='replace')[-2000:]
                        raise RuntimeError('SAM Audio failed: ' + detail)
                finally:
                    if process.poll() is None:
                        process.kill(); process.wait()
            outputs = []
            for name in ['target', 'remainder']:
                wave, rate = sf.read(folder / (name + '.flac'), always_2d=True, dtype='float32')
                outputs.append({'waveform': torch.from_numpy(wave.T.copy()).unsqueeze(0), 'sample_rate': rate})
            return tuple(outputs)


class StemStudioGuideSep:
    """User-guided music separation (GuideSep, MIT). Runs in a private runtime prepared from the app."""
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'audio': ('AUDIO',), 'reference': ('AUDIO',), 'steps': ('INT', {'default': 8, 'min': 4, 'max': 24, 'step': 1})}, 'optional': {'reference_offset': ('FLOAT', {'default': 0.0, 'min': -600.0, 'max': 600.0, 'step': 0.1})}}
    RETURN_TYPES = ('AUDIO', 'AUDIO')
    RETURN_NAMES = ('target', 'remainder')
    FUNCTION = 'extract'
    CATEGORY = 'Stem Studio'

    def extract(self, audio, reference, steps=8, reference_offset=0.0):
        import json
        import os
        import subprocess
        import tempfile
        import time
        from pathlib import Path
        import soundfile as sf
        import torch
        import comfy.model_management as mm
        from .extra_nodes import model_root
        model = model_root() / 'guidesep-v1'
        try:
            config = json.loads((model / 'stem-runtime.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise ValueError('Prepare GuideSep in Stem Studio first.')
        python = Path(config['python'])
        weights = model / 'guidesep.pt'
        if not python.is_file() or not weights.is_file():
            raise ValueError('GuideSep runtime or weights are missing. Retry Prepare GuideSep.')
        device = str(mm.get_torch_device())
        if not device.startswith('cuda'):
            raise ValueError('GuideSep needs a CUDA device in this experimental integration.')
        mm.unload_all_models(); mm.soft_empty_cache()
        with tempfile.TemporaryDirectory(prefix='stem-guidesep-') as directory:
            folder = Path(directory)
            for name, item in [('input.wav', audio), ('reference.wav', reference)]:
                sf.write(folder / name, item['waveform'][0].float().cpu().numpy().T, int(item['sample_rate']), subtype='FLOAT')
            (folder / 'request.json').write_text(json.dumps({'weights': str(weights), 'device': device, 'steps': int(steps), 'reference_offset': float(reference_offset)}), encoding='utf-8')
            env = dict(os.environ)
            for key in ['PYTHONHOME', 'PYTHONPATH', 'ELECTRON_RUN_AS_NODE']:
                env.pop(key, None)
            with (folder / 'worker.log').open('wb') as log:
                process = subprocess.Popen([str(python), str(Path(__file__).with_name('guidesep_worker.py')), str(folder)], env=env, stdout=log, stderr=log, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                try:
                    while process.poll() is None:
                        mm.throw_exception_if_processing_interrupted(); time.sleep(0.2)
                    if process.returncode:
                        detail = (folder / 'worker.log').read_text(encoding='utf-8', errors='replace')[-2000:]
                        raise RuntimeError('GuideSep failed: ' + detail)
                finally:
                    if process.poll() is None:
                        process.kill(); process.wait()
            outputs = []
            for name in ['target', 'remainder']:
                wave, rate = sf.read(folder / (name + '.flac'), always_2d=True, dtype='float32')
                outputs.append({'waveform': torch.from_numpy(wave.T.copy()).unsqueeze(0), 'sample_rate': rate})
            return tuple(outputs)
