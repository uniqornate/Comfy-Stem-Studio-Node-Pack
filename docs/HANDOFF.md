# Stem Studio Node Pack - Shared Handoff

> Protocol: `docs/HANDOFF_PROTOCOL.md`

## CONTROL BLOCK

### Active work

| Work | Status | Owner | Scope | Next |
|---|---|---|---|---|
| W-20261023-03 | WAITING_USER | Claude | 0.13.3: the Stem Studio sidebar tab opens the app in its own browser tab automatically (no overlay, no header bar). | User clicks the sidebar tab and checks the tab opens, and that a blocked pop-up leaves a working button. |
| W-20261022-02 | WAITING_USER | Claude | 0.13.2: Help panel (coloured shortcut groups, Models page with measured peak VRAM/RAM/CPU), channel rename (double-click or Ctrl+R), brush icon on painted channels, new tile icons; same changes as the desktop repository 0.12.11. | User tests in ComfyUI. |
| W-20261022-01 | WAITING_USER | Claude | Repository created from the node pack mode of the desktop repository (0.13.1): Stem Studio UI inside ComfyUI, browser Desktop adapter, Python preparation routes, brush models, six-stem music, MMAudio, batch, mix export. | User restarts ComfyUI with the pack installed, opens the Stem Studio tab and reports what breaks. |

### Next actions

1. User opens ComfyUI, uses the Stem Studio sidebar tab, downloads MRX from Connection and runs a short separation; then the six-stem model, brush models and MMAudio preparation. Report console and network errors.

## CHRONOLOGICAL LOG

### W-20261023-03: Open in its own tab

- Agent: Claude Sonnet 5.5 | Provider: Anthropic | Surface: Claude Code desktop
  Time: 2026-10-23T00:30:00+03:00 | Work: W-20261023-03
  Change: web/stemstudio.js no longer builds a full-screen overlay with an "Open in a tab" header. Clicking the sidebar tab (or the command) opens /stemstudio/app/index.html in a window named stemstudio-app, so a second click focuses the same tab. The first open happens when the sidebar panel renders; if the browser blocks the pop-up the panel keeps an Open button and says so.
  Validation: JS tests and the existing extension test pass. Not run in a browser.
  Limits: Whether the sidebar render call still counts as a user gesture for pop-up blockers is unconfirmed; the button is the fallback. The app has no ComfyUI chrome in its own tab, so use the browser's tab switcher to return.
  Artifacts: comfy_nodes/StemStudio/web/stemstudio.js, __init__.py comment, README.md, docs/ARCHITECTURE.md, package.json, pyproject.toml.
  Follow-up 0.13.4 (page zoom): in the browser the layout scale is CSS zoom, so popups placed from pointer coordinates landed far from the pointer (tooltips below it, context menus off screen). src/page-zoom.mjs gives the zoom; tooltips, channel/take/delete menus, the preview menu and the floating preview drag and resize convert screen pixels to the zoomed units, and context menus are measured and moved back inside the window (scrollbar if the window is shorter than the menu). Not run in a browser.
  Follow-up 0.13.7 (preview window in the browser): right-clicking the floating preview in the timeline fullscreen mode (arrange mode) opened the browser menu because the node pack had disabled the menu. The preview now moves to a popup (public/preview.html and preview.js, served at /stemstudio/app/) that follows this page's transport over a BroadcastChannel: position, play state and rate about every 300 ms, drift corrected above 0.3 s, muted video, sound stays in the main page. The popup is opened inside the click so it is not blocked, then moved to another display when the Window Management permission (getScreenDetails) is granted; otherwise drag it over. Double-click in the popup toggles fullscreen. After a page reload the popup is found again by a ping. Not run in a browser; whether the browser allows moveTo and resizeTo on the popup, and the permission prompt, are unconfirmed.
  Follow-up (Tab key): Tab switches between the normal view and the arrange view (timeline fullscreen), the same as the layout button, and no longer walks through the controls. Inside dialogs and text fields it keeps its normal job so forms stay usable; Shift+Tab is left alone. Listed in the shortcuts and in the button tooltip. Not run in an app.
  Follow-up (Tab, brush ghost): Tab is now blocked everywhere, dialogs and text fields included (Ctrl and Alt combinations stay with the browser); it only switches the view on the workspace itself. In brush mode, holding Alt no longer lights up the whole timeline: a skeleton channel row (shimmering placeholder bars and a dashed waveform area saying 'New channel') appears under the channels and a click brushes the whole timeline. The shimmer is a transform on a pseudo-element and stops with reduced-motion. Not run in an app.
  Follow-up (groups, playhead): Ctrl+G or the channel right-click menu groups the selected channels; a naming dialog (with an optional colour) comes first. A group is a thin header row with a fold arrow and its members under it; right-click the header to rename, recolour or ungroup, and 'Remove from group' is in the channel menu. A coloured group paints its header and every member (detail channels too); without a colour they take the colour of the topmost member. Groups are saved with the project timeline and are not part of undo. Playhead: there is now one playhead for the whole timeline, a transform on its own compositor layer, instead of a CSS variable on the timeline root that restyled every row on every frame plus a repainted line in each lane, which is what lagged with tall rows. Playback and scrubbing logic are untouched. Cause inferred from the code, not measured in the app. Not run in an app.
  Next: User verifies.

  Follow-up 0.13.5: (1) dialogs and context menus fit the window at any layout zoom (--page-zoom is set with the CSS zoom; max-height is divided by it); the Models page shows ten compact cards on one screen. (2) Connection dialog in the node pack: model packs are a clear list (name, license, size, state), the consent box shows only while something is missing, the Proxy status is hidden and the footer is Check and Done. (3) Projects: reload could silently make an empty 'Untitled project' when the last project failed to open, hiding existing work. Boot now reports the reason, tries the other projects, and creates a new empty one only when none can be opened; the last project is also written to userdata/stemstudio/last.json so another address or browser reopens it; project writes use keepalive so the last autosave survives a page close. The earlier project with runs was intact on disk (reopen it from Projects). Not run in a browser.

  Follow-up (lost brush results, engine check timeouts, all muted): Evidence from the user's ComfyUI: project a8698663 had one brush channel saved, while output/StemStudio/<project>/ held a second brush file written 2 minutes later that never reached the project; later attempts showed 'Audio engine could not be checked: signal timed out'; the saved mix had every channel muted (no solo, no code path found that does this by itself). Causes addressed: (1) the engine probe sent 22 requests at once with a 5 s limit, so a ComfyUI busy with a GPU job timed out, and a timed-out optional node counted as 'not installed'. Now 5 requests at a time, 20 s limit, one retry, an unreachable node fails the probe instead of being reported missing, and a failed probe falls back to the last good answer (marked stale). (2) A finished job lived only in the latest state, so starting the next job before the interface had read it dropped it. Finished jobs that were never delivered are now handed over once as job.earlier and added to the project like any result (Separation.poll in Electron, stemStatus in the browser adapter). (3) When every channel is muted the timeline status line says so with an Unmute all button. Not proven: why the second result was not read in this case (a hidden browser tab slows timers) and what muted every channel; this makes both visible and recoverable. Not run in an app or browser.

### W-20261022-02: Help panel, rename, brush icon (ported from desktop 0.12.11)

- Agent: Claude Sonnet 5.5 | Provider: Anthropic | Surface: Claude Code desktop
  Time: 2026-10-22T23:30:00+03:00 | Work: W-20261022-02
  Change: Ported from the desktop repository: question-mark help button, Help panel with Shortcuts (tinted groups) and Models (exact pinned disk sizes, where each model runs, and peak VRAM, RAM and CPU measured on this PC while jobs run, kept in localStorage), channel rename (double-click name or Ctrl+R; the label is saved, the file is untouched), brush icon on channels made by the brush (kind 'brush' saved in the project), stack icon for BandIt and music icon for the 6-stem model. The browser adapter saves renamed labels and the kind. The ComfyUI sidebar tab was missing because the desktop app's dev loop had overwritten this pack's `__init__.py` in custom_nodes/StemStudio with its own copy (no WEB_DIRECTORY, no routes); the desktop repository now skips its copy when this pack is installed.
  Validation: TypeScript, build, 112 JS tests, Python tests unchanged. Not run in ComfyUI.
  Limits: Measured usage depends on ComfyUI's /system_stats; CPU is the shared machine load. Old brush channels have no kind.
  Artifacts: src/{ShortcutsPanel,StemTimeline,main,ModelPicker,web-desktop}, src/{usage,model-info,shortcuts}.mjs, src/styles.css, comfy_nodes/StemStudio/app, package.json, pyproject.toml, tests.
  Next: User installs this repository as a clone in custom_nodes (not the desktop copy) and verifies.

### W-20261022-01: Repository split

- Agent: Claude Sonnet 5.5 | Provider: Anthropic | Surface: Claude Code desktop
  Time: 2026-10-22T21:00:00+03:00 | Work: W-20261022-01
  Change: The node pack mode, written in a worktree of the desktop repository since 2026-10-17 and merged with desktop 0.12.10 (graph builders, brush/music/MMAudio, batch, mix export, live progress), was moved into this repository. Desktop-only code (Electron main process, preload, setup worker, installer packaging, managers that need Node) was left out. Pure modules shared with the desktop app are in `src/shared`, `src/graphs.mjs`, `src/engine-status.mjs`.
  Validation: TypeScript, `npm run build`, JS tests and Python tests pass; the installed copy in a local ComfyUI was syntax-checked with that ComfyUI's Python. Nothing was run in a real ComfyUI frontend or browser; no download, pip or model preparation was run.
  Limits: Never opened in a real ComfyUI frontend: sidebar registration, the overlay, annotated file names for LoadAudio/LoadVideo, browser file writing. Non-Windows platforms are untested. Desktop-only tests were not carried over; the desktop repository keeps them.
  Artifacts: whole repository.
  Next: User verifies in ComfyUI.
