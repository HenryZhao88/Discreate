// src/loader/index.ts
import electron from "electron";
import { join } from "node:path";

const PRELOAD = join(__dirname, "preload.js");

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

// discord_desktop_core (and thus this loader) is loaded by Discord's host
// bootstrap *after* the app "ready" event has already fired, so a "ready"
// listener would never run. Register immediately when the app is already
// ready; this still happens before core.asar creates Discord's window.
if (electron.app.isReady()) {
  registerPreload();
} else {
  electron.app.once("ready", registerPreload);
}
