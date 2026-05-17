// src/loader/index.ts
import electron from "electron";
import { join } from "node:path";
import { selfHealSiblings } from "./self-heal.js";
import { findDiscordInstalls } from "../injector/discord-paths.js";
import { patchCore } from "../injector/core-patch.js";

const PRELOAD = join(__dirname, "preload.js");
const RUNTIME_DIR = __dirname; // loader.js sits alongside preload.js + renderer.js

// Expose a global the patched index.js can call so siblings get healed at boot.
(global as any).__discreateSelfHeal = (coreDir: string) =>
  selfHealSiblings(coreDir, __filename);

// Discord defines electron.BrowserWindow as a non-configurable property, so it
// cannot be replaced. Instead we register an *additional* session preload that
// runs alongside Discord's own preload — Discord's window stays untouched.
function registerPreload(): void {
  const ses = electron.session.defaultSession as Electron.Session & {
    registerPreloadScript?: (script: {
      type: string;
      id: string;
      filePath: string;
    }) => void;
  };
  if (typeof ses.registerPreloadScript === "function") {
    ses.registerPreloadScript({ type: "frame", id: "discreate", filePath: PRELOAD });
  } else {
    ses.setPreloads([...ses.getPreloads(), PRELOAD]);
  }
}

function registerReinjectIpc(): void {
  try {
    electron.ipcMain.handle("discreate-reinject", async () => {
      const installs = findDiscordInstalls();
      const patched: string[] = [];
      for (const i of installs) {
        patchCore(i.coreDir, RUNTIME_DIR);
        patched.push(i.coreDir);
        for (const sib of selfHealSiblings(i.coreDir, join(RUNTIME_DIR, "loader.js"))) {
          patched.push(sib);
        }
      }
      return { patched };
    });
  } catch {
    // ipcMain.handle throws if the channel is already registered. Safe to ignore.
  }
}

// discord_desktop_core (and thus this loader) is loaded by Discord's host
// bootstrap *after* the app "ready" event has already fired, so a "ready"
// listener would never run. Register immediately when the app is already
// ready; this still happens before core.asar creates Discord's window.
if (electron.app.isReady()) {
  registerPreload();
  registerReinjectIpc();
} else {
  electron.app.once("ready", () => {
    registerPreload();
    registerReinjectIpc();
  });
}
