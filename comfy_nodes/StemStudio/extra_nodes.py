"""Inference-only adapters. No model/network activity at node discovery."""
import csv
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).parent
PATHS = {'bandit': 'bandit-v2/checkpoint-multi.ckpt', 'mrx': 'mrx/adapted_loudness.pth'}

def runtime_config():
    """runtime.json is written by the desktop app or by node pack model preparation. Without it, use ComfyUI's models folder."""
    try:
        return json.loads((HERE / 'runtime.json').read_text(encoding='utf-8'))
    except FileNotFoundError:
        import folder_paths
        root = Path(folder_paths.models_dir) / 'audio_separation'
        return {'checkpoint': str(root / 'sfc-locoformer-dnr' / 'model.pth'), 'model_root': str(root)}

def model_root():
    config = runtime_config()
    return Path(config.get('model_root', str(Path(config['checkpoint']).parent.parent)))

def available_models():
    try:
        root = model_root()
        return [key for key, path in PATHS.items() if (root / path).is_file()] + ['sfc']
    except (OSError, ValueError, KeyError, ImportError):
        return ['sfc']

def labels():
    with (HERE / 'vendor_extra/audioset_labels.csv').open(encoding='utf-8', newline='') as handle:
        return list(csv.DictReader(handle))

def verified(relative):
    path = model_root() / relative
    entry = json.loads((HERE / 'vendor_extra/integrity.json').read_text(encoding='utf-8'))[relative]
    if not path.is_file() or path.stat().st_size != entry['size']:
        raise ValueError(f'Model file missing or incomplete: {path}. Select this model in Stem Studio setup.')
    checks = [(entry['algorithm'].lower(), entry['hash'])]
    if entry.get('sha256'): checks.append(('sha256', entry['sha256']))
    for algorithm, expected in checks:
        value = hashlib.new(algorithm)
        with path.open('rb') as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b''): value.update(block)
        if value.hexdigest() != expected: raise ValueError(f'Model checksum failed: {relative}')
    return path

def mono(audio, rate):
    import torch
    import torchaudio.functional as AF
    value = audio['waveform'].detach().float().cpu()
    if value.ndim != 3 or value.shape[0] != 1 or not value.shape[-1] or not torch.isfinite(value).all():
        raise ValueError('Choose one source with finite non-empty audio.')
    value = value.mean(dim=1, keepdim=True)
    return AF.resample(value, audio['sample_rate'], rate) if audio['sample_rate'] != rate else value

def overlap(wave, rate, seconds, n_sources, forward, device, indexed=False):
    import torch
    import comfy.model_management as mm
    from comfy.utils import ProgressBar
    length = wave.shape[-1]; size = int(seconds * rate); shift = size // 2
    starts = [0] if length <= size else list(range(0, length - size + shift, shift))
    output = torch.zeros(n_sources, 1, length); counts = torch.zeros(length)
    progress = ProgressBar(len(starts))
    with torch.inference_mode():
        for index, start in enumerate(starts):
            mm.throw_exception_if_processing_interrupted()
            valid = min(size, length - start)
            chunk = torch.nn.functional.pad(wave[..., start:start + valid], (0, size - valid))
            if torch.count_nonzero(chunk).item():
                estimate = (forward(chunk.to(device), start) if indexed else forward(chunk.to(device))).detach().float().cpu()[..., :valid]
                if estimate.shape != (n_sources, 1, valid): raise RuntimeError('Model output shape differs from the channel contract.')
                output[..., start:start + valid] += estimate
                del estimate
            counts[start:start + valid] += 1; progress.update(index + 1)
    output /= counts.clamp_min(1)[None, None, :]
    if not torch.isfinite(output).all(): raise RuntimeError('Model output contains invalid samples.')
    return output

def separate_alternative(audio, model_id, seconds):
    import torch
    import comfy.model_management as mm
    if model_id not in PATHS: raise ValueError('Unknown separation model.')
    checkpoint = verified(PATHS[model_id]); rate = 48000 if model_id == 'bandit' else 44100
    wave = mono(audio, rate); device = mm.get_torch_device()
    mm.unload_all_models(); mm.soft_empty_cache()
    model = None
    try:
        state = torch.load(checkpoint, map_location='cpu', weights_only=True)
        if model_id == 'bandit':
            from .vendor_extra.bandit.bandit import Bandit
            model = Bandit(in_channels=1, stems=['speech', 'music', 'sfx'], fs=48000,
                n_sqm_modules=8, emb_dim=128, rnn_dim=256, rnn_type='GRU',
                n_bands=64, mlp_dim=512, normalized=True, pad_mode='reflect')
            state = state.get('state_dict', state)
            # Training wrapper prefixes its inference module with model.
            weights = {key[6:]: value for key, value in state.items() if key.startswith('model.')}
            model.load_state_dict(weights or state, strict=True)
            def forward(chunk):
                batch = model({'mixture': {'audio': chunk}})
                return torch.cat([batch['estimates'][name]['audio'] for name in ['speech', 'music', 'sfx']], dim=0)
        else:
            from .vendor_extra.mrx import MRX
            model = MRX(); model.load_state_dict(state, strict=True)
            def forward(chunk):
                # MRX training order is music, speech, sfx.
                return model(chunk)[0, [1, 0, 2]]
        del state
        model.eval().to(device)
        output = overlap(wave, rate, seconds, 3, forward, device)
        return tuple({'waveform': output[i:i + 1], 'sample_rate': rate} for i in range(3))
    finally:
        del model
        mm.soft_empty_cache()

class StemStudioExtract:
    @classmethod
    def INPUT_TYPES(cls):
        try: installed = (model_root() / 'uss/at_soft.ckpt').is_file() and (model_root() / 'uss/Cnn14_mAP=0.431.pth').is_file()
        except (OSError, ValueError, KeyError): installed = False
        choices = ['All'] + [row['display_name'] for row in labels()] if installed else ['USS models not installed']
        return {'required': {'audio': ('AUDIO',), 'target': (choices,),
            'threshold': ('FLOAT', {'default': 0.1, 'min': 0.0, 'max': 1.0, 'step': 0.05})}, 'optional': {'auto_threshold': ('BOOLEAN', {'default': False})}}
    RETURN_TYPES = ('AUDIO', 'AUDIO')
    RETURN_NAMES = ('target_sound', 'remainder')
    FUNCTION = 'extract'
    CATEGORY = 'Stem Studio'

    def extract(self, audio, target, threshold, auto_threshold=False):
        iterator = self.iter_targets(audio, target, threshold, auto_threshold=auto_threshold)
        try:
            _, output, wave = next(iterator)
            return ({'waveform': output, 'sample_rate': 32000}, {'waveform': wave - output, 'sample_rate': 32000})
        finally:
            iterator.close()

    def iter_targets(self, audio, target, threshold, all_detected=False, auto_threshold=False):
        import torch
        import comfy.model_management as mm
        from .vendor_extra.uss.resunet import ResUNet30
        from .vendor_extra.panns import Cnn14
        targets = {row['display_name']: int(row['index']) for row in labels()}
        if not all_detected and target not in targets: raise ValueError('Choose a supported AudioSet sound class.')
        if all_detected and not 0 < threshold <= 1: raise ValueError('All requires a detection threshold above zero.')
        checkpoint = verified('uss/at_soft.ckpt'); panns_path = verified('uss/Cnn14_mAP=0.431.pth')
        wave = mono(audio, 32000); device = mm.get_torch_device()
        mm.unload_all_models(); mm.soft_empty_cache()
        separator = None; tagger = None
        try:
            separator = ResUNet30(input_channels=1, output_channels=1, condition_size=527)
            state = torch.load(checkpoint, map_location='cpu', weights_only=True)
            state = state.get('state_dict', state)
            weights = {key[len('ss_model.'):]: value for key, value in state.items() if key.startswith('ss_model.')}
            if not weights: raise ValueError('USS checkpoint does not contain the expected ss_model weights.')
            separator.load_state_dict(weights, strict=True); del weights
            tagger = Cnn14(sample_rate=32000, window_size=1024, hop_size=320, mel_bins=64, fmin=50, fmax=14000, classes_num=527)
            pretrained = torch.load(panns_path, map_location='cpu', weights_only=True)
            tagger.load_state_dict(pretrained['model'], strict=True); del pretrained
            query_weights = {key[len('query_net.base.'):]: value for key, value in state.items() if key.startswith('query_net.base.')}
            if query_weights: tagger.load_state_dict(query_weights, strict=True)
            del state, query_weights
            separator.eval().to(device); tagger.eval().to(device)
            cached_scores = {}; selected = [target]
            if all_detected or auto_threshold:
                from comfy.utils import ProgressBar
                size = 64000; length = wave.shape[-1]
                starts = [0] if length <= size else list(range(0, length - size + size // 2, size // 2))
                progress = ProgressBar(len(starts)); maximum = torch.zeros(527)
                with torch.inference_mode():
                    for index, start in enumerate(starts):
                        mm.throw_exception_if_processing_interrupted()
                        chunk = wave[..., start:start + size]
                        chunk = torch.nn.functional.pad(chunk, (0, size - chunk.shape[-1]))
                        scores = tagger(chunk[:, 0].to(device))['clipwise_output'].float().cpu() if torch.count_nonzero(chunk).item() else torch.zeros(1, 527)
                        cached_scores[start] = scores
                        maximum = torch.maximum(maximum, scores[0]); progress.update(index + 1)
                if auto_threshold:
                    from .auto_threshold import calibrate
                    calibrated = {name: calibrate([row[0, class_id].item() for row in cached_scores.values()]) for name, class_id in targets.items() if all_detected or name == target}
                    selected = [name for name, (present, _) in calibrated.items() if present]
                    thresholds = {name: cutoff for name, (_, cutoff) in calibrated.items()}
                    if not selected: raise ValueError('Auto found insufficient sound evidence. Try Manual with a lower threshold or another target.')
                    print('Stem Studio Auto thresholds: ' + ', '.join(f'{name}={thresholds[name]:.3f}' for name in selected))
                else:
                    selected = [name for name, class_id in targets.items() if maximum[class_id].item() >= threshold]
                    if not selected: raise ValueError('No sound class reached the threshold. Lower the threshold and retry All, or choose a specific target.')
            for name in selected:
                mm.throw_exception_if_processing_interrupted()
                def forward(chunk, start):
                    scores = cached_scores[start].to(device) if all_detected or auto_threshold else tagger(chunk[:, 0])['clipwise_output']
                    condition = torch.zeros_like(scores); condition[:, targets[name]] = scores[:, targets[name]]
                    if scores[0, targets[name]].item() < (thresholds[name] if auto_threshold else threshold): return torch.zeros_like(chunk)
                    return separator({'mixture': chunk, 'condition': condition})['waveform']
                output = overlap(wave, 32000, 2, 1, forward, device, indexed=True)
                yield name, output, wave
                del output
        finally:
            del separator, tagger
            mm.soft_empty_cache()

class StemStudioExtractAll(StemStudioExtract):
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'audio': ('AUDIO',), 'threshold': ('FLOAT', {'default': 0.1, 'min': 0.01, 'max': 1.0, 'step': 0.05})}, 'optional': {'filename_prefix': ('STRING', {'default': ''}), 'auto_threshold': ('BOOLEAN', {'default': False}), 'range_reference': ('AUDIO',), 'range_start': ('FLOAT', {'default': 0, 'min': 0}), 'suppress_duplicates': ('BOOLEAN', {'default': True})}}
    RETURN_TYPES = ()
    RETURN_NAMES = ()
    OUTPUT_NODE = True
    FUNCTION = 'extract_all'

    def extract_all(self, audio, threshold, auto_threshold=False, range_reference=None, range_start=0, suppress_duplicates=True, filename_prefix=''):
        import re
        import uuid
        from comfy_api.latest import UI
        # Save each class before computing the next: never retain 527 full-length
        # waveforms simultaneously. Built-in FLAC encoding and SDK outputs apply.
        class_ids = {row['display_name']: int(row['index']) for row in labels()}
        folder = filename_prefix or 'StemStudio/USSAll/' + uuid.uuid4().hex[:12]
        if filename_prefix and not re.fullmatch(r'StemStudio/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+', filename_prefix):
            raise ValueError('Invalid project output prefix')
        outputs = []
        fingerprints = []
        iterator = self.iter_targets(audio, 'All', threshold, all_detected=True, auto_threshold=auto_threshold)
        try:
            for name, output, _ in iterator:
                if suppress_duplicates:
                    import torch
                    feature = torch.nn.functional.adaptive_avg_pool1d(output.detach().float().cpu().reshape(1, 1, -1), min(4096, output.shape[-1])).flatten()
                    norm = feature.norm()
                    if norm.item() < 1e-8:
                        continue
                    feature /= norm
                    if any(torch.dot(feature, previous).abs().item() >= 0.995 for previous in fingerprints):
                        continue
                    fingerprints.append(feature)
                if range_reference is not None:
                    from .detail_nodes import restore
                    output = restore({'waveform': output, 'sample_rate': 32000}, range_reference, range_start)['waveform']
                slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:70]
                prefix = f'{folder}/class-{class_ids[name]:03d}-{slug}'
                saved = UI.AudioSaveHelper.get_save_audio_ui({'waveform': output, 'sample_rate': 32000}, filename_prefix=prefix, cls=None, format='flac')
                outputs.extend(saved.as_dict()['audio'])
                del output
        finally:
            iterator.close()
        return {'ui': {'audio': outputs}}
