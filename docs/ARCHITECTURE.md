# Architecture of the node pack

Stem Studio runs inside ComfyUI. One folder, `comfy_nodes/StemStudio`, holds everything ComfyUI loads; the repository root `__init__.py` forwards to it so the repository can also be cloned straight into `custom_nodes`.

## Pieces

- **Nodes (Python)**: `__init__.py` registers the Stem Studio nodes: separation (`StemStudioSeparate` with MRX, BandIt v2 and SFC), USS (`StemStudioExtract`, `StemStudioExtractAll`), SAM Audio, GuideSep, six-stem music (`StemStudioMusicSeparate`, HTDemucs), clip editing (`StemStudioEditAudio`), range helpers, `StemStudioVideoClip` and native lossless video export. Model adapters are vendored under `vendor/`, `vendor_extra/` and `guidesep_model/`; notices are in `NOTICE.md`. Nothing downloads or loads a model at node discovery.
- **Routes (Python)**: `web_routes.py` adds aiohttp routes to ComfyUI's PromptServer: model pack, SAM, GuideSep, brush model, music model and MMAudio preparation (`/stemstudio/.../{status,prepare,cancel}`) and the static app under `/stemstudio/app/`. Routes accept only loopback callers and reject foreign Origin headers on POST. `prepare.py` is standard library only: resumable, hash-verified downloads, pinned `uv` per platform for the private SAM and GuideSep runtimes, and the pinned MMAudio node pack installer (git blob hashes, then `pip install` with ComfyUI's own interpreter).
- **Frontend extension**: `web/stemstudio.js` is the only file in `WEB_DIRECTORY` (ComfyUI imports every `.js` there). It adds a sidebar tab and a command that open the app in its own browser tab (one named tab, so a second click focuses it).
- **The app (React)**: `src/` is built with `npm run build` into `comfy_nodes/StemStudio/app`. It talks to `window.desktop`; `src/web-desktop.mjs` implements that interface over ComfyUI's HTTP API (`/upload/image`, `/prompt`, `/history`, `/queue`, `/interrupt`, `/view`, `/userdata`, `/system_stats`, the websocket for progress) and the Python routes above.
- **Shared pure modules**: `src/graphs.mjs` (API-format graph builders), `src/engine-status.mjs` (capability probe and request checks) and `src/shared/*` (model constants, brush, music and MMAudio graphs, endpoint checks). `test/nodepack.test.mjs` enforces that they import neither Node nor Electron.
- **Model pins**: `setup/models.json` (separators, USS, SFC) and `setup/extra-models.json` (brush models, HTDemucs, MMAudio), the latter generated from `src/shared`.

## Where things live

- Model weights: `<ComfyUI>/models/audio_separation/<model>`; MMAudio weights `<ComfyUI>/models/mmaudio`; MMAudio node pack `custom_nodes/ComfyUI-MMAudio` (marker `.stemstudio.json`).
- Source files: `input/StemStudio/...`; results: `output/StemStudio/<project>/...`; projects: `user/default/stemstudio/projects/<id>.json` (references only, no copies).
- Private SAM and GuideSep runtimes: `user/default/stemstudio/runtime`, never ComfyUI's environment.

## Differences from the desktop app

The preview can move to a second browser window (a popup that follows the page's transport over a BroadcastChannel, moved to another display when the browser grants the Window Management permission, `public/preview.html` and `public/preview.js`). Browser file dialogs instead of native ones (folder choice needs a Chromium browser), no API proxy, and no ComfyUI installer. Everything else follows the desktop app's UI.
