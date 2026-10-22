// Stem Studio frontend extension. Adds a sidebar tab and a command that open the Stem Studio app in a full-screen
// overlay. The app itself is served from /stemstudio/app/ (see web_routes.py) and is also reachable standalone there.
// Only this file lives in the extension web directory: ComfyUI imports every .js file found there.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const APP_PATH = "/stemstudio/app/index.html";
let overlay = null;

function closeOverlay() {
  if (!overlay) return;
  overlay.remove(); // Unmounting the frame stops playback; the app saves its project on page hide.
  overlay = null;
  document.removeEventListener("keydown", onKey, true);
}
function onKey(event) { if (event.key === "Escape" && overlay) closeOverlay(); }

function openOverlay() {
  if (overlay) return;
  const url = api.fileURL(APP_PATH);
  overlay = document.createElement("div");
  overlay.id = "stemstudio-overlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;background:#211927;";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;align-items:center;gap:12px;height:34px;padding:0 12px;background:#17101c;color:#e9e1ee;font:13px system-ui,sans-serif;flex:none;";
  const title = document.createElement("strong");
  title.textContent = "Stem Studio";
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  const external = document.createElement("a");
  external.href = url; external.target = "_blank"; external.rel = "noopener";
  external.textContent = "Open in a tab"; external.style.cssText = "color:#c9b8d6;";
  const close = document.createElement("button");
  close.type = "button"; close.textContent = "Close"; close.title = "Back to ComfyUI (Esc)";
  close.style.cssText = "background:#2d2236;color:#e9e1ee;border:1px solid #4a3a58;border-radius:6px;padding:3px 12px;cursor:pointer;";
  close.addEventListener("click", closeOverlay);
  bar.append(title, spacer, external, close);
  const frame = document.createElement("iframe");
  frame.src = url; frame.title = "Stem Studio";
  frame.allow = "fullscreen; clipboard-read; clipboard-write";
  frame.style.cssText = "flex:1;border:0;width:100%;background:#211927;";
  overlay.append(bar, frame);
  document.body.append(overlay);
  document.addEventListener("keydown", onKey, true);
}

function renderSidebar(element) {
  element.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText = "padding:16px;display:flex;flex-direction:column;gap:12px;font:13px system-ui,sans-serif;";
  const text = document.createElement("p");
  text.style.cssText = "margin:0;opacity:.85;line-height:1.5;";
  text.textContent = "Separate dialogue, music and effects from a video or audio file, pull one sound out with USS, SAM Audio or GuideSep, mix the stems and export. Everything runs in this ComfyUI.";
  const button = document.createElement("button");
  button.type = "button"; button.textContent = "Open Stem Studio";
  button.className = "p-button p-component";
  button.style.cssText = "padding:8px 14px;cursor:pointer;";
  button.addEventListener("click", openOverlay);
  box.append(text, button);
  element.append(box);
}

app.registerExtension({
  name: "StemStudio.Panel",
  commands: [{ id: "StemStudio.Open", label: "Open Stem Studio", icon: "pi pi-sliders-h", function: openOverlay }],
  menuCommands: [{ path: ["Extensions"], commands: ["StemStudio.Open"] }],
  setup() {
    const manager = app.extensionManager;
    if (manager && typeof manager.registerSidebarTab === "function") {
      manager.registerSidebarTab({ id: "stemstudio", icon: "pi pi-sliders-h", title: "Stem Studio", tooltip: "Stem Studio", type: "custom", render: renderSidebar });
      return;
    }
    // Older frontends without sidebar tabs: a small floating button.
    const button = document.createElement("button");
    button.type = "button"; button.textContent = "Stem Studio";
    button.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:9000;padding:6px 12px;border-radius:6px;border:1px solid #4a3a58;background:#2d2236;color:#e9e1ee;cursor:pointer;";
    button.addEventListener("click", openOverlay);
    document.body.append(button);
  },
});
