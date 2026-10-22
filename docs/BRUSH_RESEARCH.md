# Brush tool research: adding generated sound effects to a region

Checked on 2026-10-18 from vendor pages, repositories and model cards. Figures that a source did not state are marked "not stated"; nothing here was run or benchmarked by us.

Goal: a timeline brush that fills a selected region of a new channel with a sound described by a prompt, ideally aware of what the video shows there.

## Video-aware (video + optional text prompt)

| Model | What it is | Size and speed | License | Notes for a brush |
|---|---|---|---|---|
| [Woosh (Sony AI)](https://github.com/SonyResearch/Woosh), May 2026 | Text-to-audio (Flow, DFlow) and video-to-audio (VFlow, DVFlow) with an optional text prompt | Parameter counts not stated; Sony says the V2A model has fewer parameters than its baseline; distilled DFlow/DVFlow variants exist | Code MIT (VFlow/DVFlow Apache-2.0), weights CC-BY-NC | Newest. `uv`-based, GPU or CPU extras. VFlow reuses MMAudio code. |
| [HunyuanVideo-Foley (Tencent)](https://github.com/Tencent-Hunyuan/HunyuanVideo-Foley), Aug 2025 | Text + video to 48 kHz foley | XXL 20 GB (12 GB offload), XL 16 GB (8 GB offload); community [ComfyUI nodes](https://github.com/phazei/ComfyUI-HunyuanVideo-Foley) report fp8 under 8 GB | [Tencent Hunyuan Community License](https://raw.githubusercontent.com/Tencent-Hunyuan/HunyuanVideo-Foley/main/LICENSE): not valid in the EU, UK and South Korea, may not be used to improve other AI models | Best-supported in ComfyUI today, strong audio quality, but the territory rule is a problem for an open-source release. |
| [ThinkSound (Alibaba)](https://github.com/FunAudioLLM/ThinkSound) | Video-to-audio with chain-of-thought reasoning, object-centric refinement by clicking or selecting a region, and editing by instruction | Size, VRAM and sample rate not stated; a lighter model followed in July 2025; Windows scripts provided | Code and models Apache-2.0, but the README says research and education only, no commercial use; bundled Stable Audio Open VAE is under the Stability Community License | The only candidate built around visual reasoning and region-level control, which is exactly a brush with a box. |
| [MMAudio (Sony)](https://huggingface.co/AEmotionStudio/mmaudio-models), CVPR 2025 | Video + text to audio | Large 44 kHz checkpoint about 2 GB in fp16, about 6 GB VRAM (vendor figure); trained on 8 s clips, 5 to 12 s works | Code MIT, weights CC-BY-NC | Mature, many ComfyUI wrappers, the baseline everyone else compares to. |
| [LTX-2](https://introl.com/blog/ltx-2-audiovisual-diffusion-synchronized-video-audio-2026) | Generates video and synchronized audio together | Large | Open weights | Not a tool for adding sound to an existing video; mention only. |

## Audio-only (text prompt, no video)

| Model | What it is | Size and speed | License | Notes for a brush |
|---|---|---|---|---|
| Stable Audio 3 [Small-SFX](https://huggingface.co/stabilityai/stable-audio-3-small-sfx), May 2026 | Sound effects and ambiance from text, with **inpainting** (regenerate a masked region, or continue a recording) | 0.6B parameters, up to 2 minutes, small enough for CPU per the [ComfyUI docs](https://docs.comfy.org/tutorials/audio/stable-audio/stable-audio-3.md) | Stability AI Community License (commercial use allowed below a revenue threshold), Gemma terms for the T5Gemma encoder | Official ComfyUI templates exist, so no private Python runtime is needed. Inpainting maps directly onto brushing over existing audio. |
| Stable Audio 3 Medium | Longer music and SFX, 1.4B per one report, needs a GPU | up to about 6:20 | same | More than a brush needs. |
| Stable Audio Open Small (2025) | 341M text-to-audio | about 11 s of audio in under 8 s on a phone CPU | Stability AI Community License | Fallback if Small-SFX is unavailable. |

## Status

Phase 1 is implemented: the timeline brush paints a prompt into a new channel with Stable Audio 3 Small-SFX through ComfyUI's native nodes (`src/shared/brush.mjs`, `src/BrushModal.tsx`, workflow `Stem-Studio_06`). The two files (from [Comfy-Org/stable-audio-3](https://huggingface.co/Comfy-Org/stable-audio-3), not gated, hash pinned) live in `models/audio_separation/stable-audio-3`, which the StemStudio node adds to ComfyUI's checkpoint and text encoder lists. Sampler settings (8 steps, cfg 1, lcm, simple) are copied from the Medium template shipped with ComfyUI; they were not checked on Small-SFX itself. Phase 2 (video-aware) is open.

## Recommendation

1. **Phase 1, ship first:** a brush backed by **Stable Audio 3 Small-SFX** through native ComfyUI nodes. A prompt plus the painted region gives a new channel with the effect placed at that time (padded with the existing `StemStudioRestoreRange`); painting over an existing channel uses inpainting. Small, fast, official ComfyUI support, works on audio-only sources, and its license is the most permissive of the set.
2. **Phase 2, video-aware brush:** crop the video to the selected interval (clips up to about 10 s work best for every model above) and send it with the prompt. Preferred order for this project:
   - **ThinkSound** if region-level visual control matters most and a research-use license is acceptable for the contest build.
   - **Woosh-VFlow or DVFlow** for the newest model with a simple optional-text interface, once its checkpoint sizes are confirmed.
   - **HunyuanVideo-Foley** only if the territory restriction is acceptable.
   - **MMAudio** as the well-trodden fallback.
3. All video-aware models are non-commercial or restricted, so the UI should state the license next to the model choice, the same way SFC is handled today.

Open questions before building: exact checkpoint sizes for Woosh and ThinkSound, whether a ComfyUI-native node exists for the chosen video model (otherwise it needs a private runtime like SAM and GuideSep), and how much of the 8 to 12 s training length a brush region should be chunked to.

## Update (0.12.9)

Stable Audio 3 Large (2.7B) is API-only, so it cannot be used. Medium (1.4B, open) and MMAudio (video-aware, via the kijai ComfyUI pack) were added next to Small-SFX in the brush dialog. ThinkSound was not added; see docs/MODELS.md for the reasons. Nothing here was run or judged for quality.
