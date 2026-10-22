# Candidate model files, version 0.1.2

These are optional evaluation candidates. No audio model execution, ComfyUI custom node, dependency installation, separation benchmark or VRAM measurement is included in this build. Download size is not a VRAM estimate. The main candidate's superiority over BandIt on the user's film is unverified.

| Pack | Purpose | Download | License |
|---|---|---:|---|
| SFC-Locoformer Medium / DnR / SFC-CA | Dialogue, music and effects separation evaluation | 128,212,278 bytes | Weights CC BY-NC-SA 4.0 |
| USS at_soft, full training + PANNs Cnn14 | Named class-based detail extraction evaluation | 1,448,454,867 bytes | USS Apache 2.0; PANNs checkpoint CC BY 4.0 |

SFC uses the author's pinned revision `0827e70a9e0c6f21b9b46cb9dfe4f7e4ebd307c5` and the DnR checkpoint, not its MUSDB music-stem checkpoint. See [author repository](https://github.com/b-sigpro/spectral-feature-compression) and [weights](https://huggingface.co/kohei0209/spectral_feature_compression). The non-commercial and share-alike requirements apply independently of this app being open source. Competition/prize and later commercial eligibility are not confirmed by selecting this checkpoint.

USS uses the [ByteDance implementation](https://github.com/bytedance/uss). Its at_soft checkpoint and config are downloaded from the third-party [RSNuts mirror](https://huggingface.co/RSNuts/Universal_Source_Separation), pinned at `3053b3c087ff5d32993a849ee44133021a3e0ba4`. Mirror integrity is pinned; this is not a claim that the mirror is maintained by ByteDance. The accompanying PANNs Cnn14 checkpoint is from the [author's Zenodo record](https://zenodo.org/records/3987831), which provides CC BY 4.0 metadata and MD5. The other checkpoint/config files use SHA-256. HTTPS is required. This build does not deserialize checkpoint files.

USS class tagging is a candidate for AudioSet classes such as footsteps. Its model/config uses 32 kHz mono. Automatic class selection, time localization, overlapping effects, source reconstruction, licensing attribution packaging and stereo preservation still require runtime implementation and user-led quality checks. It is not an automatic guarantee of one clean stem for every audible event.

The manifest pins expected bytes and hashes. Large weights were not downloaded during implementation. Tiny YAML configs were fetched to compute their pinned SHA-256 values. There is no measured combined VRAM claim yet; a future serial model lifecycle should unload the separator before loading USS/PANNs and measure peak allocation with the actual workflow.

Since 0.1.6, PANNs downloads first from the third-party [thelou1s mirror](https://huggingface.co/thelou1s/panns-inference/blob/5546cbe0c06a7695a23c041ef5e6dab76b3312d6/Cnn14_mAP%3D0.431.pth), pinned at revision 5546cbe0c06a7695a23c041ef5e6dab76b3312d6. Its published size is 327428481 bytes and SHA-256 is 0dc499e40e9761ef5ea061ffc77697697f277f6a960894903df3ada000e34b31. The original Zenodo MD5 remains mandatory in addition to this SHA-256; original weight license/attribution is retained despite the mirror card's Apache label. Byte identity is enforced when downloaded, not claimed from having downloaded the binary during development. Zenodo remains the request-failure fallback. Actual speed is user-unverified.

## 0.4.0 additions

The installer now offers BandIt v2 multilingual (446680129 bytes, official Zenodo MD5 fea2868787551b0cff36cfcf7c3622a3, CC BY-SA 4.0 weights) and MERL MRX adapted-loudness (122317657 bytes, Git LFS SHA256 4bc4eabf554cf980d3328a2c45452c47beca1ca76324d75583e7587377dce409, MIT). URLs/revisions are pinned in setup/models.json. MRX is a downloadable cinematic baseline, not an assertion that it beats SFC/BandIt. USS at_soft/PANNs previously offered as weights now have an experimental class-conditioned extraction adapter. Model binaries are not embedded in the application package; only consenting user setup prepares them in ComfyUI/models/audio_separation. Their runtime quality/performance remains to be tested by the user.

## 0.4.1 transport and BandIt source update

Pinned third-party BandIt mirror: https://huggingface.co/jsoncx/bandit-v2/tree/fde0ff714b879259f3f436a0eb9046626f82a880 . Published metadata lists original-sized checkpoint-multi.ckpt (446680129 bytes), SHA256 abcfccf65446752a057f4a302c941479a54b7560ebf8d7bca039d2ea98e64cfc. Downloader requires original Zenodo MD5 in addition to that hash, with Zenodo fallback. Mirror repository license does not replace the original weight license. Only metadata was read during this change; no model binary downloaded or executed by the agent. All five large checkpoint files share four concurrent 8 MiB range tasks, per-range resume/retry/slow-source recovery and mandatory full-model hashes. No new mirror was invented for other models; configured original pinned sources remain.


## Where files live

Decision for the desktop installer and for node-pack installs: **every model file goes inside your ComfyUI, in `<ComfyUI>/models/audio_separation/<model>`**, never into the app folder and never into `custom_nodes/StemStudio`.

- The StemStudio node registers `audio_separation` with ComfyUI's `folder_paths`, so `extra_model_paths.yaml` can move the whole category to another drive without touching Stem Studio.
- Weights survive node updates and removal. ComfyUI Manager deletes a node's folder when it is uninstalled or reinstalled, which would throw away gigabytes of verified downloads if the weights lived there.
- It follows the convention other ComfyUI tools use, so files are visible, shareable between tools and easy to back up.
- Includes the Hugging Face cache that SAM Audio and GuideSep need for their encoders (`models/audio_separation/sam-shared-cache`, `guidesep-v1/cache`).

What is deliberately not a model file: the private Python environments for SAM Audio and GuideSep and the package download cache. They are tooling, shared by both features and fully regenerable, so the desktop app keeps them in its own data folder (`%APPDATA%\stem-studio`). A node-pack install should keep them next to the node, so removing the node removes them too.

If ComfyUI is not installed yet, the desktop setup can install the official portable build first (GitHub release, checked against the SHA-256 GitHub publishes, unpacked with Windows `tar` or 7-Zip) and then uses its `models` folder as above.

## HTDemucs 6-source (0.12.8)

`htdemucs_6s` (Meta, MIT) gives vocals, drums, bass, guitar, piano and other from stereo music. File `https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/5c90dfd2-34c22ccb.th`, 54996327 bytes, SHA-256 `34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd`, saved in `<ComfyUI>/models/audio_separation/htdemucs-6s`. Downloaded from the 6-Stem dialog after consent. BS-Roformer SW (also six stems, better reported scores) was not chosen: no checkpoint download or license could be verified. Meta calls the six-source model experimental; piano bleeds.

## Brush models (0.12.9)

The brush dialog offers three models. Each is downloaded from the dialog after consent, with pinned revisions, sizes and SHA-256 hashes, into your ComfyUI.

| Model | Files | Where | License |
|---|---|---|---|
| Stable Audio 3 Small-SFX | checkpoint 2.3 GB + T5Gemma encoder 1.2 GB | `models/audio_separation/stable-audio-3` | Stability AI Community License |
| Stable Audio 3 Medium | `stable_audio_3_medium.safetensors`, 9222116660 bytes, SHA-256 `48d9c65e...8ce0b5`, plus the shared encoder | same folder | same |
| MMAudio (video + text) | large 44k v2 fp16 (2.1 GB), VAE (0.6 GB), Synchformer (0.5 GB), DFN5B CLIP (2.0 GB), BigVGAN v2 vocoder (0.5 GB) from Kijai/MMAudio_safetensors and nvidia/bigvgan_v2_44khz_128band_512x, pinned revisions | `models/mmaudio` (the folder the node pack reads) | Node pack MIT; MMAudio weights CC BY-NC 4.0, non-commercial only |

MMAudio runs through the community node pack [kijai/ComfyUI-MMAudio](https://github.com/kijai/ComfyUI-MMAudio), commit `8eaeb72edc3aaf2059b57f2d96a1f6f689f19ae2`. The node pack downloads that commit archive, unpacks it, checks every file against the git blob hashes in `setup/mmaudio-manifest.json` and only then copies it to `custom_nodes/ComfyUI-MMAudio` (marker `.stemstudio.json`). It also runs `pip install -r requirements.txt` with the Python that runs ComfyUI. This changes your ComfyUI Python environment, which the dialog states before consent. The BigVGAN files are placed by the node pack so the pack does not download them itself.

ThinkSound was looked at and not added: its checkpoints are 21 GB (5.7 GB light) plus a 2.5 GB VAE and 1 GB Synchformer, the only ComfyUI wrapper last changed in July 2025 bundles the model source and pins `einops==0.7.0` and `vector-quantize-pytorch==1.9.14`, which can break ComfyUI's own environment, and it asks for 12 GB of VRAM.
