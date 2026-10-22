# Copyright (c) Meta Platforms, Inc. and affiliates. MIT License, see ../DEMUCS-LICENSE.
# Stem Studio keeps only capture_init from the upstream states module (training, quantization and logging helpers removed).
import functools


def capture_init(init):
    @functools.wraps(init)
    def __init__(self, *args, **kwargs):
        self._init_args_kwargs = (args, kwargs)
        init(self, *args, **kwargs)

    return __init__
