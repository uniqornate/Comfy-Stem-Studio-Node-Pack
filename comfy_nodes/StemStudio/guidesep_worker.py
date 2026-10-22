"""Runs only on a user-submitted Comfy job in the private GuideSep environment."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


def main(folder):
    import soundfile as sf
    import torch
    import torchaudio.functional as AF
    from guidesep_model.inference import SAMPLE_RATE, load_model, separate
    request = json.loads((folder / 'request.json').read_text(encoding='utf-8'))
    if not torch.cuda.is_available():
        raise RuntimeError('GuideSep requires a CUDA GPU in this experimental integration.')

    def mono(name):
        wave, rate = sf.read(folder / name, dtype='float32', always_2d=True)
        return torch.from_numpy(wave.T.copy()).mean(0), rate

    mixture, rate = mono('input.wav')
    reference, reference_rate = mono('reference.wav')
    if not torch.isfinite(mixture).all() or not torch.isfinite(reference).all():
        raise ValueError('Input audio contains invalid sample values.')
    mixture16 = AF.resample(mixture, rate, SAMPLE_RATE) if rate != SAMPLE_RATE else mixture
    reference16 = AF.resample(reference, reference_rate, SAMPLE_RATE) if reference_rate != SAMPLE_RATE else reference
    # A positive offset delays the reference (it starts that many seconds into the mixture); a negative one skips its first seconds.
    shift = int(round(float(request.get('reference_offset', 0.0)) * SAMPLE_RATE))
    if shift > 0:
        reference16 = torch.nn.functional.pad(reference16, (shift, 0))
    elif shift < 0:
        reference16 = reference16[-shift:] if -shift < reference16.shape[-1] else torch.zeros(1)
    weights = torch.load(request['weights'], map_location='cpu', weights_only=True)
    model = load_model(weights, steps=int(request.get('steps', 8)), device=request.get('device', 'cuda:0'))
    torch.manual_seed(int(request.get('seed', 12345)))
    with torch.inference_mode():
        target16 = separate(model, mixture16, reference16)
    target = AF.resample(target16, SAMPLE_RATE, rate) if rate != SAMPLE_RATE else target16
    target = torch.nn.functional.pad(target, (0, max(0, mixture.shape[-1] - target.shape[-1])))[:mixture.shape[-1]]
    remainder = mixture - target
    for name, data in [('target', target), ('remainder', remainder)]:
        if not torch.isfinite(data).all():
            raise ValueError('GuideSep produced invalid audio samples.')
        sf.write(folder / (name + '.flac'), data.numpy(), rate, subtype='PCM_24')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
