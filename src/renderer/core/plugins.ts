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

  /** Register a built-in or user plugin under a stable id. */
  register(id: string, plugin: DiscreatePlugin, source: "builtin" | "user" = "builtin", path?: string): void {
    this.registered.push({ id, plugin, source, path });
  }

  /** Remove a plugin from the manager. If running, it's stopped first. */
  unregister(id: string): void {
    const idx = this.registered.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const entry = this.registered[idx];
    if (this.running.has(id)) this.stopOne(entry);
    this.registered.splice(idx, 1);
  }

  all(): Registered[] {
    return [...this.registered];
  }

  isEnabled(id: string): boolean {
    return this.settings.isPluginEnabled(id);
  }

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

  /** Start every plugin marked enabled in settings. */
  startEnabled(): void {
    for (const entry of this.registered) {
      if (this.settings.isPluginEnabled(entry.id)) this.startOne(entry);
    }
  }
}

/**
 * Load every `*.plugin.js` (and `*.js`) file in ~/.discreate/plugins and
 * register it as a user plugin. Each file is evaluated as a CommonJS module:
 * `module.exports = { name, description, start, stop }` or
 * `export default { ... }` (after a typical bundle).
 * One bad plugin doesn't break the others.
 */
export function loadUserPlugins(manager: PluginManager): void {
  const n = native();
  const dir = n.pluginsDir;
  const files = n.listDir(dir).filter((f) => /\.(plugin\.js|js)$/i.test(f));
  for (const file of files) {
    const path = `${dir}/${file}`;
    try {
      const code = n.readText(path);
      if (code == null) continue;
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
    }
  }
}
