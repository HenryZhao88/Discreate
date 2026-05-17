// src/renderer/core/plugins.ts
import { makeLogger } from "./logger.js";
import { unpatchAll } from "./patcher.js";
import { native } from "./paths.js";
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
    } catch (err) {
      log.error(`failed to start ${entry.id}:`, err);
    }
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
      try { instance.load?.(); } catch (e) { log.warn(`${meta.name}.load() threw:`, e); }
      try { instance.start?.(); } catch (e) { log.error(`${meta.name}.start() threw:`, e); }
    },
    stop() {
      try { instance.stop?.(); } catch (e) { log.error(`${meta.name}.stop() threw:`, e); }
      try { instance.unload?.(); } catch (e) { log.warn(`${meta.name}.unload() threw:`, e); }
    },
  };
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
            (_id: string) => {
              throw new Error(`require('${_id}') not supported in Discreate BD shim`);
            },
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
