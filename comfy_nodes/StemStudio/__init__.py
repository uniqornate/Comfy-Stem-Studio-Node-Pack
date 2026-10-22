"""Stem Studio SFC DnR integration. Application code: MIT; see vendor notices."""
import hashlib
import json
from pathlib import Path

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
# Frontend extension (sidebar entry + full-screen overlay). The built app itself is served by web_routes.py.
WEB_DIRECTORY = "./web"
try:
    import folder_paths
    from .model_paths import register as _register_model_paths
    _register_model_paths(folder_paths)
except ImportError:
    pass


class StemStudioSeparate:
    @classmethod
    def INPUT_TYPES(cls):
        from .extra_nodes import available_models
        return {"required": {"audio": ("AUDIO",), "segment_seconds": ("INT", {"default": 12, "min": 6, "max": 12, "step": 6}), "model": (available_models(),)}}

    RETURN_TYPES = ("AUDIO", "AUDIO", "AUDIO")
    RETURN_NAMES = ("dialogue", "music", "effects")
    FUNCTION = "separate"
    CATEGORY = "Stem Studio"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def separate(self, audio, segment_seconds, model="mrx"):
        if model != "sfc":
            from .extra_nodes import separate_alternative
            return separate_alternative(audio, model, min(segment_seconds, 8))
        # Import lazily so the integration remains discoverable if dependencies fail.
        import torch
        import torchaudio.functional as AF
        import comfy.model_management as mm
        from comfy.utils import ProgressBar
        from .vendor.crossattn_enc_dec import CrossAttnEncoder, CrossAttnDecoder
        from .vendor.bslocoformer import BSLocoformer
        from .vendor.model_wrapper import ModelWrapper

        from .extra_nodes import runtime_config
        config = runtime_config()
        checkpoint = Path(config["checkpoint"])
        hasher = hashlib.sha256()
        with checkpoint.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                hasher.update(block)
        if hasher.hexdigest() != "b878ea0ffe29c67401727d51cdaab8db0394178d8e0eafa9d2ca5e241fd472e2":
            raise ValueError("The SFC checkpoint differs from the pinned DnR Medium model. Recheck model preparation.")
        waveform = audio["waveform"].detach().float().cpu()
        if waveform.ndim != 3 or waveform.shape[0] != 1 or waveform.shape[-1] == 0:
            raise ValueError("Choose one video with a non-empty audio track.")
        if not torch.isfinite(waveform).all():
            raise ValueError("Input audio contains invalid sample values.")
        # This specific pretrained DnR model is mono, 44.1 kHz.
        waveform = waveform.mean(dim=1, keepdim=True)
        if audio["sample_rate"] != 44100:
            waveform = AF.resample(waveform, audio["sample_rate"], 44100)
        length = waveform.shape[-1]
        device = mm.get_torch_device()
        mm.unload_all_models()
        mm.soft_empty_cache()
        attention = dict(n_heads=4, slope=[1, 1, 1, 1], learnable_slope=False, learnable_pos_bias=True, mask_outside_bands=False)
        encoder = CrossAttnEncoder(d_inner=96, d_model=128, n_chan=1, sample_rate=44100, n_fft=2048, n_bands=64, **attention)
        decoder = CrossAttnDecoder(d_inner=96, d_model=128, n_src=3, n_chan=1, sample_rate=44100, n_fft=2048, n_bands=64, **attention)
        separator = BSLocoformer(encoder=encoder, decoder=decoder, n_src=3, n_chan=1, n_layers=6,
            emb_dim=128, norm_type="rmsgroupnorm", num_groups=8, tf_order="ft", n_heads=8,
            flash_attention=device.type == "cuda", attention_dim=128,
            ffn_type=["swiglu_conv1d", "swiglu_conv1d"], ffn_hidden_dim=[192, 192],
            conv1d_kernel=8, conv1d_shift=1, dropout=0.1, eps=1e-5)
        model = ModelWrapper(separator, n_fft=2048, hop_length=512, fs=44100, scaling=True)
        state = torch.load(checkpoint, map_location="cpu", weights_only=True)
        if "state_dict" in state:
            state = state["state_dict"]
        # Author's averaged .pth contains SupTask state; use its inference model, not training/EMA objects.
        weights = {key[len("model."):]: value for key, value in state.items() if key.startswith("model.")}
        model.load_state_dict(weights if weights else state, strict=True)
        del state, weights
        model = model.eval().to(device)
        size = int(segment_seconds) * 44100
        shift = size // 2
        starts = [0] if length <= size else list(range(0, length - size + shift, shift))
        result = torch.zeros(3, 1, length, dtype=torch.float32)
        count = torch.zeros(length, dtype=torch.float32)
        progress = ProgressBar(len(starts))
        dtype = torch.bfloat16 if device.type == "cuda" and torch.cuda.is_bf16_supported() else torch.float16
        try:
            with torch.inference_mode():
                for index, start in enumerate(starts):
                    mm.throw_exception_if_processing_interrupted()
                    valid = min(size, length - start)
                    chunk = waveform[..., start:start + valid]
                    if torch.count_nonzero(chunk).item():
                        chunk = torch.nn.functional.pad(chunk, (0, max(0, (size if length > size else 4096) - valid)))
                        with torch.autocast(device_type=device.type, dtype=dtype, enabled=device.type == "cuda"):
                            estimate = model(chunk.to(device))[0, ..., :valid].float().cpu()
                        result[..., start:start + valid] += estimate
                        del estimate
                    count[start:start + valid] += 1
                    progress.update(index + 1)
            result /= count.clamp_min(1)[None, None, :]
            if not torch.isfinite(result).all():
                raise RuntimeError("Separation produced invalid samples; no stems were exported.")
            return tuple({"waveform": result[i:i + 1].contiguous(), "sample_rate": 44100} for i in range(3))
        finally:
            del model, separator, encoder, decoder
            mm.soft_empty_cache()


NODE_CLASS_MAPPINGS["StemStudioSeparate"] = StemStudioSeparate
NODE_DISPLAY_NAME_MAPPINGS["StemStudioSeparate"] = "Stem Studio - Separate DnR Stems"
from .extra_nodes import StemStudioExtract, StemStudioExtractAll
NODE_CLASS_MAPPINGS["StemStudioExtract"] = StemStudioExtract
NODE_DISPLAY_NAME_MAPPINGS["StemStudioExtract"] = "Stem Studio - USS Target Sound"
NODE_CLASS_MAPPINGS["StemStudioExtractAll"] = StemStudioExtractAll
NODE_DISPLAY_NAME_MAPPINGS["StemStudioExtractAll"] = "Stem Studio - USS All Detected Sounds"

try:
    from .video_export import StemStudioVideoTrack, StemStudioVideo
    NODE_CLASS_MAPPINGS['StemStudioVideoTrack'] = StemStudioVideoTrack
    NODE_CLASS_MAPPINGS['StemStudioVideo'] = StemStudioVideo
    NODE_DISPLAY_NAME_MAPPINGS['StemStudioVideoTrack'] = 'Stem Studio - Video Audio Track'
    NODE_DISPLAY_NAME_MAPPINGS['StemStudioVideo'] = 'Stem Studio - Lossless Video Audio'
except ImportError:
    pass  # Older ComfyUI can still use separation; export capability is checked separately.

from .resources import register as register_resources
register_resources()

from .detail_nodes import StemStudioAudioRange, StemStudioRestoreRange, StemStudioSAM, StemStudioGuideSep
NODE_CLASS_MAPPINGS.update(StemStudioAudioRange=StemStudioAudioRange, StemStudioRestoreRange=StemStudioRestoreRange, StemStudioSAM=StemStudioSAM, StemStudioGuideSep=StemStudioGuideSep)

from .audio_edits import StemStudioEditAudio
NODE_CLASS_MAPPINGS["StemStudioEditAudio"] = StemStudioEditAudio

from .music_nodes import StemStudioMusicSeparate
NODE_CLASS_MAPPINGS["StemStudioMusicSeparate"] = StemStudioMusicSeparate
NODE_DISPLAY_NAME_MAPPINGS["StemStudioMusicSeparate"] = "Stem Studio - Music Stems (6)"

from .video_clip import StemStudioVideoClip
NODE_CLASS_MAPPINGS["StemStudioVideoClip"] = StemStudioVideoClip
NODE_DISPLAY_NAME_MAPPINGS["StemStudioVideoClip"] = "Stem Studio - Video Region Frames"

try:
    from .web_routes import register as register_web
    register_web()
except ImportError:
    pass  # Outside ComfyUI (tests, tooling) there is no PromptServer.
