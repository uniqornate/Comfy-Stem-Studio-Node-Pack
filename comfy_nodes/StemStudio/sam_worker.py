"""Runs only on a user-submitted Comfy job in the private SAM environment."""
import json
import sys
from pathlib import Path

def main(folder):
    import soundfile as sf
    import torch
    import torchaudio.functional as AF
    from sam_audio import SAMAudio, SAMAudioProcessor
    request = json.loads((folder / 'request.json').read_text(encoding='utf-8'))
    if not torch.cuda.is_available():
        raise RuntimeError('SAM Audio requires a CUDA GPU in this experimental integration.')
    processor = SAMAudioProcessor.from_pretrained(request['model'])
    model = SAMAudio.from_pretrained(request['model']).eval()
    prompts = request.get('guidance', {})
    visual = bool(prompts.get('keyframes'))
    predict_spans = prompts.get('predictSpans', False) and not prompts.get('anchors')
    if not visual:
        # Free the video encoder but keep the feature width: separate() builds zero video features from `.dim`.
        class NoVision(torch.nn.Module):
            def __init__(self, dim):
                super().__init__()
                self.dim = dim
        model.vision_encoder = NoVision(model.vision_encoder.dim)
    else:
        model.vision_encoder.batch_size = 2
    model.visual_ranker = None
    model.text_ranker = None
    if not predict_spans and hasattr(model, 'span_predictor'):
        del model.span_predictor
    device = request.get('device', 'cuda:0')
    model = model.to(device)
    waveform, rate = sf.read(folder / 'input.wav', dtype='float32', always_2d=True)
    wave = torch.from_numpy(waveform.T.copy()).mean(0, keepdim=True)
    if rate != processor.audio_sampling_rate:
        wave = AF.resample(wave, rate, processor.audio_sampling_rate)
    kwargs = {}
    if prompts.get('anchors'):
        kwargs['anchors'] = [prompts['anchors']]
    if visual:
        import numpy as np
        kwargs['masked_videos'] = [torch.from_numpy(np.load(folder / 'visual.npy', allow_pickle=False))]
    batch = processor(audios=[wave], descriptions=[request['description']], **kwargs).to(device)
    with torch.inference_mode():
        result = model.separate(batch, predict_spans=predict_spans, reranking_candidates=1)
    for name, data in [('target', result.target), ('remainder', result.residual)]:
        item = data[0].detach().float().cpu().reshape(-1)
        if not torch.isfinite(item).all():
            raise ValueError('SAM produced invalid audio samples.')
        sf.write(folder / (name + '.flac'), item.numpy(), processor.audio_sampling_rate, subtype='PCM_24')

if __name__ == '__main__':
    main(Path(sys.argv[1]))
