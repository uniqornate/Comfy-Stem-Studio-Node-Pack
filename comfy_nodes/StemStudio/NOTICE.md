# SFC DnR adapter

Vendor files are from b-sigpro/spectral-feature-compression at revision
bf61e1e37471d7a28bc5727d3d07d6cb8b177370. Original copyright headers retained.
See vendor/MIT.txt and vendor/Apache-2.0.txt. Local modifications: relative
imports; musical-only band configuration; standard equal-tempered MIDI/Hz
conversion formulas replace a librosa import. Unsupported alternative filterbanks
are blocked before their optional imports could be needed. Mamba, training,
Hydra and aiaccel are not imported or installed by this adapter.

The selected pretrained model remains CC BY-NC-SA 4.0, independently of code
licenses. It outputs three MONO stems at 44100 Hz, ordered speech/music/sfx
according to the author's DnR configuration. No claim of stereo preservation.
The wrapper and model parameters follow the published Medium SFC-CA config.
Chunk inference is serial with half-overlap averaging; all-silent chunks are
zeroed, and very short chunks are padded for STFT then trimmed. Live numerical
parity, separation quality, seams and VRAM remain user-unverified.

## Comparison and detail adapters (0.4.0)

Inference sources vendored under vendor_extra, with original license files:

- BandIt v2: kwatcharasupat/bandit-v2 d5563d9031e95fdaa3e5a73d5020b9a0df61adb6, Apache 2.0. Lightning base replaced with nn.Module for inference, musical MIDI/Hz functions replaced with equivalent NumPy formulas. Training, Ray, Hydra, private package indexes and package installers are not included. Official multilingual weights: Zenodo 12701995, CC BY-SA 4.0.
- MERL MRX: merlresearch/cocktail-fork-separation 19b3de827ebc4bfb014570cf92dd32b4ee3b6921, MIT, including repository model files. Uses adapted-loudness weights; output order music/speech/sfx is remapped to dialogue/music/effects. Inference is chunked, with no automatic LUFS normalization or mixture consistency correction. This is a comparison baseline, not a claim of higher quality.
- USS: bytedance/uss c19e2c5a74a3f5790acd9d7d927f08d156aa1e23, Apache 2.0. Only ResUNet30/Base/FiLM inference definitions retained; relative imports. at_soft wrapper is identity after masking the Cnn14 clipwise scores. Uses 2-second half-overlap chunks, configurable detection gate (default 0.1 versus upstream 0.2). Outputs target and arithmetical residual at mono 32 kHz. No free-text conditioning, hierarchy expansion or automatic all-class scan is claimed.
- PANNs Cnn14: qiuqiangkong/panns_inference f673f604ec6f4805a61c5b3be087e24776ec5fda, selected init functions/ConvBlock/Cnn14 extracted without alteration to inference math. Training mixup is unsupported. Original MIT license retained; model checkpoint separately CC BY 4.0. AudioSet class labels are retained from USS metadata; AudioSet attribution: Google, https://research.google.com/audioset/ontology/index.html (CC BY 4.0 metadata).
- torchlibrosa: qiuqiangkong/torchlibrosa d4e8add6c9ee49ae531c78a4901e4fdcc88c746a, MIT. STFT/augmentation source vendored for relative imports without installing packages into ComfyUI. Requires existing torch, numpy and librosa; adapter also uses existing torchaudio and einops.

All new adapters load weights with weights_only=True and strict model keys, and verify manifest size/hash before loading. No model binaries are redistributed with the installer. Inference parity, new model compatibility, quality, VRAM and timeline playback acceptance remain user-owned. SFC 0.3.2 three-stem success was confirmed by the user screenshot in this turn.


## GuideSep (0.12.0)

guidesep_model is the inference-only subset of YutongWen/GuideSep f6bcbdee55b56909a6dc4096f8f75fb93b47c202 (source repository commit), MIT, license in guidesep_model/LICENSE. Retained: UNet2dBase backbone, EluDiffusion, DPMSampler, KarrasSchedule and spectrogram helpers. Local modifications: omegaconf ListConfig check removed, Lightning/Hydra wrapper replaced by guidesep_model/inference.py, which mirrors ConditionInsExtractionComplex.inference with mel masks always dropped (the upstream notebook default) and 4.08 s overlap-add windows. Net architecture (1002 tensors) was checked tensor by tensor (names and shapes) against the published checkpoint YutongCooper/GuideSep-v1 revision c7f97a2f938e355a6aefa53bf5e81ceaf3604275 without downloading its tensors. The checkpoint is hash-pinned (SHA-256 9f09a077a17981dd6a76c9438f3c4a3dc8e801edfb7c50c266c5cff6eb5eaa24), loaded with an allowlist of inert omegaconf classes and rewritten as a tensor-only guidesep.pt. Output is mono 16 kHz resampled to the source rate, so it is band-limited. Separation quality, VRAM and time are user-unverified.

vendor_extra/demucs is the inference subset of facebookresearch/demucs 4.0.1 (PyPI sdist), MIT, license in vendor_extra/DEMUCS-LICENSE: htdemucs, transformer, hdemucs, demucs, spec and utils. Local modifications: states.py reduced to capture_init, the openunmix Wiener filter and julius resampling replaced by stubs that raise (the pinned model uses neither). Weights: htdemucs_6s, file 5c90dfd2-34c22ccb.th from dl.fbaipublicfiles.com, 54996327 bytes, SHA-256 34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd (the filename suffix is the first 8 hex digits of that hash). The checkpoint package is read with an unpickler that accepts only OrderedDict, Fraction, the HTDemucs class and the two tensor rebuild functions. The checkpoint was downloaded once during development to compute the hash and to confirm that its 525 tensors load strictly into the vendored model; separation quality was not judged. Meta labels the 6-source model experimental: piano shows bleed and guitar is acceptable.
