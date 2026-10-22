// Stem Studio frontend extension. Adds a sidebar tab and a command that open the Stem Studio app in its own browser tab.
// The app itself is served from /stemstudio/app/ (see web_routes.py) and is also reachable standalone there.
// Only this file lives in the extension web directory: ComfyUI imports every .js file found there.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const APP_PATH = "/stemstudio/app/index.html";
const TAB_NAME = "stemstudio-app";

// One named tab: opening Stem Studio again focuses the tab that is already open instead of starting a second copy.
function openApp() {
  const tab = window.open(api.fileURL(APP_PATH), TAB_NAME);
  if (tab) tab.focus();
  return !!tab;
}

function renderSidebar(element) {
  element.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText = "padding:16px;display:flex;flex-direction:column;gap:12px;font:13px system-ui,sans-serif;";
  const text = document.createElement("p");
  text.style.cssText = "margin:0;opacity:.85;line-height:1.5;";
  text.textContent = "Separate dialogue, music and effects from a video or audio file, pull one sound out with USS, SAM Audio or GuideSep, paint sounds with the brush, mix the stems and export. Everything runs in this ComfyUI.";
  const note = document.createElement("p");
  note.style.cssText = "margin:0;opacity:.7;line-height:1.5;font-size:12px;";
  const button = document.createElement("button");
  button.type = "button"; button.textContent = "Open Stem Studio";
  button.className = "p-button p-component";
  button.style.cssText = "padding:8px 14px;cursor:pointer;";
  button.addEventListener("click", () => { note.textContent = openApp() ? "" : "Your browser blocked the new tab. Allow pop-ups for this page and press the button again."; });
  box.append(text, button, note);
  element.append(box);
  // Opening the tab for the first time needs no second click. A browser that blocks pop-ups leaves the button as the way in.
  if (!openApp()) note.textContent = "Press the button to open Stem Studio in a new tab.";
}

app.registerExtension({
  name: "StemStudio.Panel",
  commands: [{ id: "StemStudio.Open", label: "Open Stem Studio", icon: "pi pi-sliders-h", function: openApp }],
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
    button.addEventListener("click", openApp);
    document.body.append(button);
  },
});
