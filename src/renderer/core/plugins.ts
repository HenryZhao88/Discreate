// src/renderer/core/plugins.ts
import { makeLogger } from "./logger.js";
import { unpatchAll } from "./patcher.js";
import type { SettingsStore } from "./settings.js";
import type { DiscreatePlugin, PluginContext } from "../api/index.js";

const log = makeLogger("plugins");

interface Registered {
  id: string;
  plugin: DiscreatePlugin;
}

export class PluginManager {
  private registered: Registered[] = [];
  private running = new Set<string>();

  constructor(private settings: SettingsStore) {}

  /** Register a built-in or user plugin under a stable id. */
  register(id: string, plugin: DiscreatePlugin): void {
    this.registered.push({ id, plugin });
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
