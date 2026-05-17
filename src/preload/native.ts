// src/preload/native.ts
import { contextBridge, ipcRenderer } from "electron";
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, watch, createWriteStream,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import * as https from "node:https";
import * as http from "node:http";

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

function downloadFile(url: string, dest: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const mod = url.startsWith("http://") ? http : https;
    mod.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        downloadFile(next, dest, maxRedirects - 1).then(resolveP, rejectP);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        rejectP(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      const out = createWriteStream(dest);
      res.pipe(out);
      out.on("finish", () => out.close(() => resolveP()));
      out.on("error", rejectP);
    }).on("error", rejectP);
  });
}

export function exposeNative(): void {
  ensureLayout();
  contextBridge.exposeInMainWorld("DiscreateNative", {
    root: ROOT,
    readText: (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null),
    writeText: (p: string, data: string) => { ensureParent(p); writeFileSync(p, data); },
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
