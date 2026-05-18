// src/renderer/core/plugins.ts
import { makeLogger } from "./logger.js";
import { unpatchAll } from "./patcher.js";
import { native } from "./paths.js";
import { findByPropsLazy } from "./webpack.js";
import type { SettingsStore } from "./settings.js";
import type { DiscreatePlugin, PluginContext } from "../api/index.js";

const log = makeLogger("plugins");

export interface Registered {
  id: string;
  plugin: DiscreatePlugin;
  source: "builtin" | "user";
  /** Absolute path of the source file for user plugins. */
  path?: string;
}

export class PluginManager {
  private registered: Registered[] = [];
  private running = new Set<string>();

  constructor(private settings: SettingsStore) {}

  register(id: string, plugin: DiscreatePlugin, source: "builtin" | "user" = "builtin", path?: string): void {
    this.registered.push({ id, plugin, source, path });
  }

  unregister(id: string): void {
    const idx = this.registered.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const entry = this.registered[idx];
    if (this.running.has(id)) this.stopOne(entry);
    this.registered.splice(idx, 1);
  }

  all(): Registered[] { return [...this.registered]; }

  isEnabled(id: string): boolean { return this.settings.isPluginEnabled(id); }

  private context(id: string): PluginContext {
    return {
      id,
      options: this.settings.getPluginOptions(id),
      saveOptions: (o) => this.settings.setPluginOptions(id, o),
    };
  }

  private startOne(entry: Registered): void {
    if (this.running.has(entry.id)) return;
    try {
      entry.plugin.start(this.context(entry.id));
      this.running.add(entry.id);
      log.log(`started ${entry.id}`);
      this.writePluginLog(`started ${entry.id}`);
    } catch (err: any) {
      log.error(`failed to start ${entry.id}:`, err);
      this.writePluginLog(`FAILED start ${entry.id}: ${err?.stack ?? err}`);
    }
  }

  private writePluginLog(line: string): void {
    try {
      const n = native();
      const path = `${n.root}/plugin-runtime.log`;
      const existing = n.readText(path) ?? "";
      n.writeText(path, existing + new Date().toISOString() + " " + line + "\n");
    } catch { /* ignore */ }
  }

  private stopOne(entry: Registered): void {
    if (!this.running.has(entry.id)) return;
    try {
      entry.plugin.stop(this.context(entry.id));
    } catch (err) {
      log.error(`error stopping ${entry.id}:`, err);
    }
    unpatchAll(entry.id);
    this.running.delete(entry.id);
    log.log(`stopped ${entry.id}`);
  }

  setEnabled(id: string, enabled: boolean): void {
    const entry = this.registered.find((r) => r.id === id);
    if (!entry) return;
    this.settings.setPluginEnabled(id, enabled);
    enabled ? this.startOne(entry) : this.stopOne(entry);
  }

  startEnabled(): void {
    for (const entry of this.registered) {
      if (this.settings.isPluginEnabled(entry.id)) this.startOne(entry);
    }
  }
}

// ---------------------------------------------------------------------------
// BD plugin meta parser
// ---------------------------------------------------------------------------

export interface BdMeta {
  name: string;
  version: string;
  description: string;
  author: string;
}

export function parseBdMeta(source: string): BdMeta | null {
  // Look at the first JSDoc-style block at the top of the file.
  const head = source.slice(0, 1500);
  const blockMatch = head.match(/\/\*\*([\s\S]*?)\*\//);
  if (!blockMatch) return null;
  const block = blockMatch[1];
  function field(name: string): string {
    const re = new RegExp(`@${name}\\s+(.+)`);
    const m = block.match(re);
    return m ? m[1].trim() : "";
  }
  const name = field("name");
  if (!name) return null;
  return {
    name,
    version: field("version"),
    description: field("description"),
    author: field("author") || field("authorName"),
  };
}

/** Strip the JScript `/*@cc_on ... @*\/` IIFE used by BD plugins. */
export function stripCcOn(source: string): string {
  return source.replace(/\/\*@cc_on[\s\S]*?@\*\//g, "");
}

/**
 * BetterDiscord plugins are written against Electron renderers with full Node
 * integration and expect `require('electron' | 'fs' | 'path' | …)` to work.
 * Discord proper sandboxes the renderer, so we hand back lightweight stubs:
 *
 * - `fs` / `path` get the renderer-safe subset routed through our preload bridge
 *   (read/write/list inside `~/.discreate`; everything else is a logging no-op).
 * - `electron` returns a minimal object exposing `shell.openExternal` (via
 *   `window.open`) and nothing else; methods plugins never call return a
 *   not-implemented proxy.
 *
 * Plugins that depend on heavyweight Node features still won't fully work, but
 * they reach their patching stage and provide most of their visible behaviour.
 */
function makeRequireShim(): (id: string) => any {
  function notImpl(path: string): any {
    return new Proxy(function () {}, {
      get: (_t, k) => typeof k === "string" ? notImpl(`${path}.${k}`) : undefined,
      apply: () => undefined, // swallow calls; plugin code keeps going
    });
  }
  const cache = new Map<string, any>();
  return (id: string): any => {
    if (cache.has(id)) return cache.get(id);
    let mod: any;
    if (id === "electron") {
      mod = {
        shell: { openExternal: (url: string) => window.open(url, "_blank") },
        ipcRenderer: notImpl("electron.ipcRenderer"),
        clipboard: { writeText: (t: string) => navigator.clipboard?.writeText(t) },
        remote: notImpl("electron.remote"),
      };
    } else if (id === "fs") {
      // No real filesystem in the renderer; back what we can with the native bridge.
      const n = native();
      const noopSync = (..._a: any[]) => undefined;
      mod = {
        readFileSync: (p: string, _enc?: any) => n.readText(p) ?? "",
        writeFileSync: (p: string, data: string) => n.writeText(p, String(data)),
        existsSync: (_p: string) => false,
        statSync: () => ({ size: 0, isDirectory: () => false, isFile: () => true }),
        readdirSync: (p: string) => n.listDir(p),
        mkdirSync: noopSync,
        unlinkSync: noopSync,
        createWriteStream: () => notImpl("fs.createWriteStream"),
        createReadStream: () => notImpl("fs.createReadStream"),
        promises: notImpl("fs.promises"),
      };
    } else if (id === "path") {
      mod = {
        join: (...parts: string[]) => parts.filter(Boolean).join("/").replace(/\/+/g, "/"),
        resolve: (...parts: string[]) => parts.filter(Boolean).join("/").replace(/\/+/g, "/"),
        dirname: (p: string) => p.substring(0, Math.max(0, p.lastIndexOf("/"))),
        basename: (p: string, ext?: string) => {
          const b = p.substring(p.lastIndexOf("/") + 1);
          return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
        },
        extname: (p: string) => { const i = p.lastIndexOf("."); return i < 0 ? "" : p.slice(i); },
        sep: "/",
      };
    } else if (id === "request") {
      // No-op shim; plugin code that depends on it logs and moves on.
      mod = notImpl("require('request')");
    } else if (id === "events") {
      const { EventEmitter } = require_events_polyfill();
      mod = { EventEmitter };
    } else {
      mod = notImpl(`require('${id}')`);
    }
    cache.set(id, mod);
    return mod;
  };
}

function require_events_polyfill(): { EventEmitter: any } {
  class EE {
    private _h: Record<string, ((...a: any[]) => void)[]> = {};
    on(ev: string, fn: (...a: any[]) => void): this { (this._h[ev] ??= []).push(fn); return this; }
    off(ev: string, fn: (...a: any[]) => void): this {
      this._h[ev] = (this._h[ev] ?? []).filter(f => f !== fn); return this;
    }
    emit(ev: string, ...args: any[]): boolean {
      const list = this._h[ev]; if (!list?.length) return false;
      for (const f of list.slice()) { try { f(...args); } catch { /* ignore */ } }
      return true;
    }
    removeAllListeners(ev?: string): this {
      if (ev) delete this._h[ev]; else this._h = {}; return this;
    }
    once(ev: string, fn: (...a: any[]) => void): this {
      const wrap = (...a: any[]) => { this.off(ev, wrap); fn(...a); };
      return this.on(ev, wrap);
    }
  }
  return { EventEmitter: EE };
}

function appendBdLog(line: string): void {
  try {
    const path = `${native().root}/bd-load.log`;
    const prev = native().readText(path) ?? "";
    native().writeText(path, prev + line + "\n");
  } catch { /* ignore */ }
}

/**
 * Wrap a BD plugin instance into a Discreate plugin.
 */
function wrapBdInstance(instance: any, meta: BdMeta): DiscreatePlugin {
  return {
    name: meta.name,
    description: meta.description,
    authors: meta.author ? [meta.author] : [],
    start() {
      // BD plugins assume every Discord store/module is reachable at boot.
      // Modern Discord lazy-loads MessageStore until the user enters a
      // channel — so until that happens, the plugin's initialize() will
      // throw on a MessageStore lookup. Wait for the store to appear (a
      // CHANNEL_SELECT loads the relevant chunk), then call start().
      void waitForMessageStore().then(() => {
        try { instance.load?.(); } catch (e) { log.warn(`${meta.name}.load() threw:`, e); }
        try { instance.start?.(); } catch (e) { log.error(`${meta.name}.start() threw:`, e); }
        appendBdLog(`bd-start ${meta.name} (after MessageStore ready)`);
      }).catch((e) => log.error(`${meta.name} deferred start failed:`, e));
    },
    stop() {
      try { instance.stop?.(); } catch (e) { log.error(`${meta.name}.stop() threw:`, e); }
      try { instance.unload?.(); } catch (e) { log.warn(`${meta.name}.unload() threw:`, e); }
    },
  };
}

/**
 * Resolve once Discord's MessageStore has been loaded (and so its module is
 * findable). Discord loads MessageStore on first CHANNEL_SELECT — we either
 * see the store synchronously (it's already there) or wait at most 10 minutes
 * for a channel-open event. If the user never opens a channel, the deferred
 * BD-plugin start simply never runs, which is fine.
 */
function waitForMessageStore(): Promise<void> {
  return new Promise((resolve) => {
    function probe(): boolean {
      try {
        const store = findByPropsLazy("getMessage", "getMessages");
        return !!store;
      } catch {
        return false;
      }
    }
    if (probe()) return resolve();

    // Poll every second; resolve on first hit. Also subscribe to
    // FluxDispatcher CHANNEL_SELECT, which is the canonical trigger.
    const interval = setInterval(() => {
      if (probe()) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);

    try {
      const dispatcher = (window as any).BdApi?.Webpack?.getByKeys?.("dispatch", "subscribe")
        ?? (window as any).DiscreateFluxDispatcher;
      if (dispatcher?.subscribe) {
        const handler = () => {
          dispatcher.unsubscribe?.("CHANNEL_SELECT", handler);
          // give the store one tick to populate after the chunk loads
          setTimeout(() => {
            if (probe()) { clearInterval(interval); resolve(); }
          }, 50);
        };
        dispatcher.subscribe("CHANNEL_SELECT", handler);
      }
    } catch { /* the polling fallback covers us */ }
  });
}

export function loadUserPlugins(manager: PluginManager): void {
  const n = native();
  const dir = n.pluginsDir;
  const files = n.listDir(dir).filter((f) => /\.(plugin\.js|js)$/i.test(f));
  for (const file of files) {
    const path = `${dir}/${file}`;
    try {
      const code = n.readText(path);
      if (code == null) continue;

      const meta = parseBdMeta(code);
      const looksLikeBd = !!meta && (code.includes("BdApi") || /module\.exports\s*=\s*class/.test(code));

      if (looksLikeBd && meta) {
        const cleaned = stripCcOn(code);
        const module: { exports: any } = { exports: {} };
        const fn = new Function(
          "module", "exports", "global", "window", "BdApi", "require",
          cleaned,
        );
        try {
          fn(
            module,
            module.exports,
            window,
            window,
            (window as any).BdApi,
            makeRequireShim(),
          );
        } catch (err) {
          log.error(`BD plugin ${file} failed to evaluate:`, err);
          appendBdLog(`failed-eval ${meta.name}: ${(err as any)?.message ?? err}`);
          continue;
        }
        const Exported = module.exports?.default ?? module.exports;
        if (!Exported) {
          log.warn(`BD plugin ${file} did not export anything`);
          appendBdLog(`failed-noexport ${meta.name}`);
          continue;
        }
        let instance: any;
        try {
          instance = typeof Exported === "function" ? new Exported() : Exported;
        } catch (err) {
          log.error(`BD plugin ${file} constructor threw:`, err);
          appendBdLog(`failed-ctor ${meta.name}: ${(err as any)?.message ?? err}`);
          continue;
        }
        const id = file.replace(/\.plugin\.js$/i, "").replace(/\.js$/i, "");
        manager.register(id, wrapBdInstance(instance, meta), "user", path);
        log.log(`loaded BD plugin ${meta.name} (${id})`);
        appendBdLog(`loaded ${meta.name}`);
        continue;
      }

      // Discreate-native plugin
      const module: { exports: any } = { exports: {} };
      const fn = new Function("module", "exports", code);
      fn(module, module.exports);
      const exported = module.exports?.default ?? module.exports;
      if (!exported || typeof exported.start !== "function" || typeof exported.stop !== "function") {
        log.warn(`plugin ${file} did not export a valid plugin object`);
        continue;
      }
      const id = (exported.id as string) || file.replace(/\.(plugin\.)?js$/i, "");
      manager.register(id, exported, "user", path);
      log.log(`loaded user plugin ${id} from ${file}`);
    } catch (err) {
      log.error(`failed to load plugin ${file}:`, err);
      appendBdLog(`failed ${file}: ${(err as any)?.message ?? err}`);
    }
  }
}
