// src/preload/native.ts
import { contextBridge } from "electron";
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, watch,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = join(homedir(), ".discreate");
const dirs = { themes: join(ROOT, "themes"), plugins: join(ROOT, "plugins") };

function ensureLayout(): void {
  for (const d of [ROOT, dirs.themes, dirs.plugins]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export function exposeNative(): void {
  ensureLayout();
  contextBridge.exposeInMainWorld("DiscreateNative", {
    root: ROOT,
    readText: (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null),
    writeText: (p: string, data: string) => writeFileSync(p, data),
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
  });
}
