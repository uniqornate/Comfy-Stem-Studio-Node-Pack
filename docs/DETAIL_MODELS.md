# Targeted sound extraction, 2026-10-16

Project: `C:\Users\erayg\Desktop\Projects\StemStudio`.

## Current implementation and limits

0.9.0 has a shared channel/range picker and parent/child timeline model. USS automatic discovery and an experimental SAM Audio adapter use that same workflow. Only USS and SAM adapters are implemented. SAM now supports free text, positive/negative anchors, optional predicted spans and manually boxed video targets. Other models below are research candidates, not installed or advertised as available engines.

USS class scores are not evidence that the corresponding extracted channels are independent. Parent/child AudioSet concepts can overlap, and class-conditioned estimates can repeat the same audio. The new near-duplicate waveform filter addresses obvious repeated estimates. It does not prove correct labels, eliminate all leakage or repair USS precision. Children start muted to avoid doubling the current mix; solo or unmute them for inspection. Collapse is visual only.

Right-click a channel after Shift-selecting a region:

1. **Extract details** runs USS All with automatic detection on that channel and region.
2. **Extract sound…** opens category cards and all 527 sound labels, with an optional filter. Choose a model and target without writing a prompt.
3. New outputs are grouped beneath that source. They contain silence outside the selected region and keep original timeline placement. Nested extraction is supported. Parent files are unchanged.

The selected region is a crop, not proof that a named sound occurs throughout it. Separate positive/negative examples inside it now provide actual temporal prompts. Visual boxes can be updated at up to12 times; their positions interpolate and are not automatically tracked. Picture only suppresses the text query. Automatic loop playback starts at selection commit; clear/unlock remain available. Export still spans the full source.

## Model candidates

| Model | Relevant capability | Decision for this app |
|---|---|---|
| [SAM Audio](https://github.com/facebookresearch/sam-audio) | Text, visual and temporal conditioning; target and residual outputs. Official small/base/large and tv variants. | Experimental small-tv adapter added. Upstream describes tv variants as improving target correctness. The adapter accepts card/free text, manual anchors or optional predicted spans, and rectangular masked video. It uses one candidate. SAM3/object tracking is not integrated. |
| [CLAPSep](https://github.com/Aisaka0v0/CLAPSep) | Contrastive CLAP-based, multi-modal query-conditioned target extraction; published weights. | My recommended next comparison against USS and SAM. Its query-conditioned design fits the same channel/range contract. Actual superiority on film foley is unmeasured. |
| [AudioSep](https://github.com/Audio-AGI/AudioSep) | Natural-language sound extraction with published checkpoints and chunk inference; official pipeline uses 32 kHz. | Useful established comparison baseline. Labels can be translated to its text query without changing the picker. Not integrated in 0.8.0. |
| [SoloAudio](https://github.com/WangHelin1997/SoloAudio) | Diffusion-based language or reference-audio target extraction, with published pretrained models. | Interesting future reference-sound mode: select an example footstep instead of relying only on a label. Generative separation needs careful fidelity and latency review. |
| [FlowSep](https://github.com/Audio-AGI/FlowSep) | Rectified-flow language-queried separation with published checkpoint links. | Research alternative. Its latent generative pipeline and separate components add integration work. Not a drop-in precision guarantee. |
| [ClearSep](https://clearsep.github.io/) | Natural-mixture training, iterative separation/data filtering and silence analysis are directly relevant to false targets. | Worth following. This pass verified the authors' project/demo description, not an independently downloadable, licensed production package. |

## SAM setup and provenance

[SAM small-tv](https://huggingface.co/facebook/sam-audio-small-tv) is gated. The user must approve access and authenticate with their own Hugging Face read token. Its PE-AV dependency can require separate access. The app links to both official model pages. A token is supplied only to child process environments and redacted from preparation output; it is not written to settings or runtime markers.

The private preparation flow downloads a matched CUDA runtime and source dependencies, the model snapshot and secondary encoder/tokenizer files. Weights/caches live in `ComfyUI\models\audio_separation\sam-audio-small-tv`; the Python environment lives in app data. Existing files are cached/reused. The ready marker requires successful processor/model construction on CPU and a second offline load. No separation is run during preparation. Preparation is cancellable; downloaded cache data is retained.

Source commits inspected and pinned for preparation:

- SAM Audio: `bb4c6999d2677c7402360e426afc01ddfad6dce0`.
- DACVAE: `414c20785fc3a28373073ea8ef7a1316eeeaca6e`.
- Perception Models: `e72b6810b1133e1c879f2cc965d276eb73803f1f` (`unpin-deps` branch snapshot).
- ImageBind: `53680b02d7e37b19b124fa37bae4b6c98c38f5be`.
- PyTorchVideo: `6cdc929315aab1b5674b6dcf73b16ec99147735f`, the commit referenced by ImageBind.
- SAM's CLAP fork: `b85cb7ecac0af7d064cbf03ebd990e709e959fe7`.

Model snapshot revision is resolved and recorded by the user's authenticated preparation, rather than inventing a revision for inaccessible weights. Auxiliary package versions remain a constrained resolution, not a fully locked and user-validated Windows environment. The agent has not downloaded these models or executed that environment.

[SAM's license](https://github.com/facebookresearch/sam-audio/blob/main/LICENSE) is separate from this app's MIT code. [Perception Models](https://github.com/facebookresearch/perception_models) uses its own FAIR noncommercial research terms; ImageBind also has separate terms. Those dependencies must not be relabeled MIT. An open-source app does not remove model, dependency, weight or data restrictions. CLAPSep and SoloAudio describe MIT code; weight/data conditions still need a separate check before redistribution. No third-party weights are bundled in this installer.

Torch/codec compatibility follows the [official TorchCodec matrix](https://github.com/meta-pytorch/torchcodec): the private recipe pairs Torch 2.11 with TorchCodec 0.15. It uses [official CUDA wheels](https://pytorch.org/get-started/previous-versions/) and tensor inputs plus soundfile output. No external ffmpeg executable is introduced; video export remains the existing native ComfyUI SaveVideo workflow.

## User acceptance, still open

- Start with a short Effects region containing a clear footstep or door event. Compare the same target on USS and SAM and listen for retained transients, leakage, missing event tails and repeated sources.
- Actual SAM installation on Windows, access to all secondary models, initialization RAM, peak VRAM and inference speed are unmeasured. No fixed VRAM guarantee is given. SAM currently constructs its full model on CPU, then drops unused visual/ranking/span modules before CUDA transfer when those modules are unused. Visual/predicted-span modes keep their required modules.
- A generative model producing a plausible sound is insufficient. Compare timing and character against the original event; use target-absent selections to expose false positives.
- Group controls, loop seek behavior, floating preview drag at page zoom and the compact toolbar still require user visual/playback acceptance. The agent only performed static and synthetic offline checks.
