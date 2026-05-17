import electron from "electron";
import { join } from "node:path";

const PRELOAD = join(__dirname, "preload.js");
const OriginalBrowserWindow = electron.BrowserWindow;

class PatchedBrowserWindow extends OriginalBrowserWindow {
  constructor(options: Electron.BrowserWindowConstructorOptions) {
    const wp = options.webPreferences ?? {};
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

// Replace BrowserWindow with a clean data descriptor (no getter/value conflict).
Object.defineProperty(electron, "BrowserWindow", {
  value: PatchedBrowserWindow,
  configurable: true,
  enumerable: true,
  writable: true,
});
