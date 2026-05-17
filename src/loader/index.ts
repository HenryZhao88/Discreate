// src/loader/index.ts
import electron from "electron";
import { join } from "node:path";

const PRELOAD = join(__dirname, "preload.js");

class PatchedBrowserWindow extends electron.BrowserWindow {
  constructor(options: Electron.BrowserWindowConstructorOptions) {
    const wp = options.webPreferences ?? {};
    // Pass Discord's own preload to this window's preload process via argv,
    // so multiple windows don't clobber a shared value.
    const original = wp.preload ?? "";
    super({
      ...options,
      webPreferences: {
        ...wp,
        preload: PRELOAD,
        sandbox: false,
        additionalArguments: [
          ...(wp.additionalArguments ?? []),
          `--discreate-original-preload=${original}`,
        ],
      },
    });
  }
}

// Replace the exported BrowserWindow with the patched subclass.
const desc = Object.getOwnPropertyDescriptor(electron, "BrowserWindow")!;
Object.defineProperty(electron, "BrowserWindow", { ...desc, value: PatchedBrowserWindow });
