// src/loader/index.ts
import electron from "electron";
import { join } from "node:path";

const PRELOAD = join(__dirname, "preload.js");

class PatchedBrowserWindow extends electron.BrowserWindow {
  constructor(options: Electron.BrowserWindowConstructorOptions) {
    const wp = options.webPreferences ?? {};
    // Remember Discord's own preload so the bridge can chain to it.
    process.env.DISCREATE_ORIGINAL_PRELOAD = wp.preload ?? "";
    super({
      ...options,
      webPreferences: { ...wp, preload: PRELOAD, sandbox: false },
    });
  }
}

// Replace the exported BrowserWindow with the patched subclass.
const desc = Object.getOwnPropertyDescriptor(electron, "BrowserWindow")!;
Object.defineProperty(electron, "BrowserWindow", { ...desc, value: PatchedBrowserWindow });
