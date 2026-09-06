// src/preload/native.ts
import { contextBridge, ipcRenderer } from "electron";
import {
  readFileSync, writeFileSync, appendFileSync, statSync, mkdirSync, existsSync, readdirSync, unlinkSync,
  watch,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { downloadFile, fetchText } from "./network.js";

const ROOT = join(homedir(), ".discreate");
const dirs = { themes: join(ROOT, "themes"), plugins: join(ROOT, "plugins"), bdData: join(ROOT, "bd-data") };

function ensureLayout(): void {
  for (const d of [ROOT, dirs.themes, dirs.plugins, dirs.bdData]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function ensureParent(p: string): void {
  try {
    const parent = p.substring(0, p.lastIndexOf("/"));
    if (parent && !existsSync(parent)) mkdirSync(parent, { recursive: true });
  } catch { /* ignore */ }
}

/** True if `p` resolves to a path inside `parent`. */
function isUnder(p: string, parent: string): boolean {
  const a = resolve(p);
  const b = resolve(parent);
  return a === b || a.startsWith(b + "/");
}

function isAllowedExt(name: string): boolean {
  return /\.(css|plugin\.js|js)$/i.test(name);
}

function deriveFilename(url: string): string {
  try {
    const u = new URL(url);
    const base = basename(u.pathname) || "download";
    return base.split("?")[0];
  } catch {
    return "download";
  }
}

/** Compute the `open` args for the installer, verifying it exists. Exported for testing. */
export function installerLaunchArgs(root: string, exists: (p: string) => boolean): string[] {
  const p = join(root, "install.command");
  if (!exists(p)) throw new Error("installer not found: " + p);
  return [p];
}

export function exposeNative(): void {
  ensureLayout();
  contextBridge.exposeInMainWorld("DiscreateNative", {
    root: ROOT,
    readText: (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null),
    writeText: (p: string, data: string) => { ensureParent(p); writeFileSync(p, data); },

    /**
     * Append to a log file, truncating it when it passes `capBytes`.
     *
     * Callers used to emulate this by reading the whole file and writing it
     * back with the new lines appended. These are synchronous fs calls on
     * Discord's renderer thread, so that cost grows with the log: the deleted
     * message log reached 33 MB, meaning a 66 MB read+write of the UI thread
     * every flush.
     */
    appendText: (p: string, data: string, capBytes = 2_000_000): void => {
      ensureParent(p);
      try {
        if (existsSync(p) && statSync(p).size > capBytes) unlinkSync(p);
      } catch { /* fall through and just append */ }
      appendFileSync(p, data);
    },
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    readSettings: () => {
      const f = join(ROOT, "settings.json");
      return existsSync(f) ? readFileSync(f, "utf8") : null;
    },
    writeSettings: (data: string) => writeFileSync(join(ROOT, "settings.json"), data),
    readDeletedLog: () => {
      const f = join(ROOT, "deleted-log.json");
      return existsSync(f) ? readFileSync(f, "utf8") : null;
    },
    writeDeletedLog: (data: string) => writeFileSync(join(ROOT, "deleted-log.json"), data),
    watchDir: (p: string, cb: () => void) => {
      if (existsSync(p)) watch(p, () => cb());
    },
    themesDir: dirs.themes,
    pluginsDir: dirs.plugins,

    /** Re-run the injector via the main process. */
    reinject: (): Promise<{ patched: string[] }> => ipcRenderer.invoke("discreate-reinject"),

    /**
     * Delete a file, but only within ~/.discreate/themes or
     * ~/.discreate/plugins. Refuses anything else.
     */
    deleteFile: (p: string): void => {
      if (!isUnder(p, dirs.themes) && !isUnder(p, dirs.plugins)) {
        throw new Error("refuse to delete outside themes/plugins: " + p);
      }
      if (existsSync(p)) unlinkSync(p);
    },

    /** Open a folder in Finder. Only allowed for themes/plugins dirs (or ~/.discreate). */
    openFolder: (p: string): void => {
      if (!isUnder(p, dirs.themes) && !isUnder(p, dirs.plugins) && p !== ROOT) {
        throw new Error("refuse to open path outside ~/.discreate: " + p);
      }
      spawn("open", [p], { detached: true, stdio: "ignore" }).unref();
    },

    /** Fetch a URL as text via the main process (bypasses renderer CSP). */
    fetchText: (url: string): Promise<string> => fetchText(url),

    readInstalled: () => {
      const f = join(ROOT, "installed.json");
      return existsSync(f) ? readFileSync(f, "utf8") : null;
    },
    runInstaller: (): void => {
      const args = installerLaunchArgs(ROOT, existsSync);
      spawn("open", args, { detached: true, stdio: "ignore" }).unref();
    },

    /**
     * Download a URL into themes or plugins. Validates the destination folder
     * and the resulting filename's extension. Returns the saved filename.
     */
    downloadToFolder: async (url: string, folder: string, filename?: string): Promise<string> => {
      if (folder !== dirs.themes && folder !== dirs.plugins) {
        throw new Error("refuse to download outside themes/plugins: " + folder);
      }
      const name = (filename && basename(filename)) || deriveFilename(url);
      if (!isAllowedExt(name)) {
        throw new Error("disallowed file extension: " + name);
      }
      const dest = join(folder, name);
      if (!isUnder(dest, folder)) {
        throw new Error("path traversal blocked: " + name);
      }
      await downloadFile(url, dest);
      return name;
    },
  });
}
