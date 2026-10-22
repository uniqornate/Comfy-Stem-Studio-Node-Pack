import torch


def spec_fwd(spec, spec_abs_exponent=0.5, spec_factor=0.3):
    if spec_abs_exponent != 1:
        spec = spec.abs() ** spec_abs_exponent * torch.exp(1j * spec.angle())
    return spec * spec_factor


def spec_back(spec, spec_abs_exponent=0.5, spec_factor=0.3):
    spec = spec / spec_factor
    if spec_abs_exponent != 1:
        spec = spec.abs() ** (1 / spec_abs_exponent) * torch.exp(1j * spec.angle())
    return spec
