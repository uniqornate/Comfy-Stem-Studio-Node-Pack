# Stem Studio Node Pack - Shared Handoff

> Protocol: `docs/HANDOFF_PROTOCOL.md`

## CONTROL BLOCK

### Active work

| Work | Status | Owner | Scope | Next |
|---|---|---|---|---|
| W-20261022-01 | WAITING_USER | Claude | Repository created from the node pack mode of the desktop repository (0.13.1): Stem Studio UI inside ComfyUI, browser Desktop adapter, Python preparation routes, brush models, six-stem music, MMAudio, batch, mix export. | User restarts ComfyUI with the pack installed, opens the Stem Studio tab and reports what breaks. |

### Next actions

1. User opens ComfyUI, uses the Stem Studio sidebar tab, downloads MRX from Connection and runs a short separation; then the six-stem model, brush models and MMAudio preparation. Report console and network errors.

## CHRONOLOGICAL LOG

### W-20261022-01: Repository split

- Agent: Claude Sonnet 5.5 | Provider: Anthropic | Surface: Claude Code desktop
  Time: 2026-10-22T21:00:00+03:00 | Work: W-20261022-01
  Change: The node pack mode, written in a worktree of the desktop repository since 2026-10-17 and merged with desktop 0.12.10 (graph builders, brush/music/MMAudio, batch, mix export, live progress), was moved into this repository. Desktop-only code (Electron main process, preload, setup worker, installer packaging, managers that need Node) was left out. Pure modules shared with the desktop app are in `src/shared`, `src/graphs.mjs`, `src/engine-status.mjs`.
  Validation: TypeScript, `npm run build`, JS tests and Python tests pass; the installed copy in a local ComfyUI was syntax-checked with that ComfyUI's Python. Nothing was run in a real ComfyUI frontend or browser; no download, pip or model preparation was run.
  Limits: Never opened in a real ComfyUI frontend: sidebar registration, the overlay, annotated file names for LoadAudio/LoadVideo, browser file writing. Non-Windows platforms are untested. Desktop-only tests were not carried over; the desktop repository keeps them.
  Artifacts: whole repository.
  Next: User verifies in ComfyUI.
