"""Inference-only GuideSep wrapper (YutongWen/GuideSep, MIT).

Mirrors ConditionInsExtractionComplex.inference without Lightning or Hydra. Mel masks are always
dropped (as in the upstream notebook defaults), so the model is guided by the reference waveform only.
"""
import math
import torch
import torch.nn as nn
from .backbones.unet2d import UNet2dBase
from .components.diffusion import EluDiffusion
from .components.sampler import DPMSampler
from .components.scheduler import KarrasSchedule
from .spec import spec_fwd, spec_back

SAMPLE_RATE = 16000
N_FFT = 510
HOP = 256
FRAMES = 256
CHUNK = (FRAMES - 1) * HOP
SPEC_ABS_EXPONENT = 0.2
SPEC_FACTOR = 0.6


class GuideSepNet(nn.Module):
    def __init__(self, steps=8):
        super().__init__()
        self.net = UNet2dBase(
            dim=128, cond_on_text=True, text_embed_dim=768, max_text_len=120, cond_drop_prob=0.0,
            dim_mults=[1, 2, 2, 2], channels=2, condition_channels=5, num_resnet_blocks=2, resnet_groups=8,
            layer_attns=[False, False, True, True], layer_cross_attns=[False, False, True, True],
            attn_heads=2, ff_mult=2.0, memory_efficient=True, use_condition_block=True, mixture_input=False)
        self.diffusion = EluDiffusion(sigma_data=0.2, dynamic_threshold=0.0)
        self.sampler = DPMSampler(num_steps=steps, cond_scale=1, order=1, multisteps=True, x0_pred=False, log_time_spacing=False)
        self.register_buffer('sigmas', KarrasSchedule(sigma_min=0.002, sigma_max=80.0, rho=7.0, num_steps=steps)(), persistent=False)


def load_model(weights, steps=8, device='cpu'):
    """`weights` is the tensor-only dict written by prepare-guidesep.py (net.* keys)."""
    model = GuideSepNet(steps)
    state = {key[4:]: value for key, value in weights.items() if key.startswith('net.')}
    model.net.load_state_dict(state, strict=True)
    return model.to(device).eval()


@torch.no_grad()
def separate_chunk(model, mixture, reference):
    """mixture, reference: [1, CHUNK] float tensors at 16 kHz on the model device. Returns [1, CHUNK]."""
    device = mixture.device
    window = torch.hann_window(N_FFT, periodic=True, device=device)
    stft = dict(n_fft=N_FFT, hop_length=HOP, center=True)
    mix_spec = torch.stft(mixture, window=window, normalized=True, return_complex=True, **stft)
    ref_spec = torch.stft(reference, window=window, normalized=True, return_complex=True, **stft)
    frames = min(mix_spec.shape[-1], ref_spec.shape[-1]) // 16 * 16
    ref = spec_fwd(ref_spec[..., :frames], SPEC_ABS_EXPONENT, SPEC_FACTOR).unsqueeze(1).abs()
    mix = spec_fwd(mix_spec[..., :frames], SPEC_ABS_EXPONENT, SPEC_FACTOR).unsqueeze(1)
    mix = torch.cat((mix.real, mix.imag), dim=1)
    mask = -torch.ones((mix.shape[0], 2, N_FFT // 2 + 1, frames), device=device)
    inj = torch.cat((mix, ref, mask), dim=1)
    noise = torch.randn((mix.shape[0], 2, N_FFT // 2 + 1, frames), device=device)
    spec = model.sampler(noise, fn=model.diffusion.denoise_fn, net=model.net, sigmas=model.sigmas, inj_channels=inj, mask=None, source=None)
    spec = torch.view_as_complex(torch.permute(spec, (0, 2, 3, 1)).contiguous())[:, None, :, :]
    spec = spec_back(spec, SPEC_ABS_EXPONENT, SPEC_FACTOR)
    return torch.istft(spec.squeeze(1), window=window, normalized=True, **stft)


def separate(model, mixture, reference, progress=lambda done, total: None):
    """Overlap-add over 4.08 s windows. mixture, reference: [T] mono float tensors at 16 kHz."""
    device = next(model.parameters()).device
    length = mixture.shape[-1]
    peak = float(mixture.abs().max())
    if length == 0 or peak < 1e-8:
        return torch.zeros(length)
    mixture = mixture / peak
    ref_peak = float(reference.abs().max())
    reference = reference / ref_peak if ref_peak > 1e-8 else reference
    if reference.shape[-1] < length:
        reference = torch.nn.functional.pad(reference, (0, length - reference.shape[-1]))
    reference = reference[:length]
    hop = CHUNK // 2
    starts = list(range(0, max(1, length - hop), hop))
    out = torch.zeros(length + CHUNK)
    weight = torch.zeros(length + CHUNK)
    fade = torch.hann_window(CHUNK, periodic=False).clamp_min(1e-3)
    for index, start in enumerate(starts):
        piece = mixture[start:start + CHUNK]
        ref_piece = reference[start:start + CHUNK]
        valid = piece.shape[-1]
        if float(piece.abs().max()) > 1e-6:
            piece = torch.nn.functional.pad(piece, (0, CHUNK - valid))
            ref_piece = torch.nn.functional.pad(ref_piece, (0, CHUNK - ref_piece.shape[-1]))
            result = separate_chunk(model, piece[None].to(device), ref_piece[None].to(device))[0].cpu()
            result = torch.nn.functional.pad(result, (0, max(0, CHUNK - result.shape[-1])))[:CHUNK]
        else:
            result = torch.zeros(CHUNK)
        out[start:start + CHUNK] += result * fade
        weight[start:start + CHUNK] += fade
        progress(index + 1, len(starts))
    target = out[:length] / weight[:length].clamp_min(1e-3)
    if not torch.isfinite(target).all():
        raise ValueError('GuideSep produced invalid samples.')
    return target * peak
