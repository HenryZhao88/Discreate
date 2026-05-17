// src/renderer/core/settings.ts
import { native } from "./paths.js";

export interface SettingsBackend {
  read(): string | null;
  write(data: string): void;
}

interface SettingsData {
  enabledPlugins: string[];
  enabledThemes: string[];
  pluginOptions: Record<string, Record<string, unknown>>;
}

const DEFAULTS: SettingsData = { enabledPlugins: [], enabledThemes: [], pluginOptions: {} };

export class SettingsStore {
  private data: SettingsData;

  constructor(private backend: SettingsBackend) {
    const raw = backend.read();
    let parsed: Partial<SettingsData> = {};
    if (raw) {
      try { parsed = JSON.parse(raw); }
      catch { parsed = {}; }
    }
    this.data = { ...DEFAULTS, ...parsed };
  }

  private persist(): void {
    this.backend.write(JSON.stringify(this.data, null, 2));
  }

  isPluginEnabled(id: string): boolean {
    return this.data.enabledPlugins.includes(id);
  }

  setPluginEnabled(id: string, enabled: boolean): void {
    const set = new Set(this.data.enabledPlugins);
    enabled ? set.add(id) : set.delete(id);
    this.data.enabledPlugins = [...set];
    this.persist();
  }

  getEnabledThemes(): string[] {
    return [...this.data.enabledThemes];
  }

  setEnabledThemes(themes: string[]): void {
    this.data.enabledThemes = [...themes];
    this.persist();
  }

  getPluginOptions(id: string): Record<string, unknown> {
    return this.data.pluginOptions[id] ?? {};
  }

  setPluginOptions(id: string, options: Record<string, unknown>): void {
    this.data.pluginOptions[id] = options;
    this.persist();
  }
}

/** Backend wired to the native bridge, for use inside Discord. */
export function nativeBackend(): SettingsBackend {
  const n = native();
  return { read: () => n.readSettings(), write: (d) => n.writeSettings(d) };
}
