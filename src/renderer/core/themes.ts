// src/renderer/core/themes.ts
import { native } from "./paths.js";
import { makeLogger } from "./logger.js";
import type { SettingsStore } from "./settings.js";

const log = makeLogger("themes");
const STYLE_PREFIX = "discreate-theme-";

export class ThemeManager {
  constructor(private settings: SettingsStore) {}

  /** All theme filenames available in ~/.discreate/themes. */
  list(): string[] {
    return native()
      .listDir(native().themesDir)
      .filter((f) => f.endsWith(".css"));
  }

  private styleId(file: string): string {
    return STYLE_PREFIX + file;
  }

  private apply(file: string): void {
    const path = `${native().themesDir}/${file}`;
    const css = native().readText(path);
    if (css == null) return log.warn(`theme not found: ${file}`);
    let el = document.getElementById(this.styleId(file)) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = this.styleId(file);
      document.head.appendChild(el);
    }
    el.textContent = css;
  }

  private unapply(file: string): void {
    document.getElementById(this.styleId(file))?.remove();
  }

  setEnabled(file: string, enabled: boolean): void {
    const themes = new Set(this.settings.getEnabledThemes());
    if (enabled) {
      themes.add(file);
      this.apply(file);
    } else {
      themes.delete(file);
      this.unapply(file);
    }
    this.settings.setEnabledThemes([...themes]);
  }

  /** Apply all enabled themes and hot-reload on directory changes. */
  start(): void {
    for (const file of this.settings.getEnabledThemes()) this.apply(file);
    native().watchDir(native().themesDir, () => {
      log.log("themes folder changed, reloading");
      for (const file of this.settings.getEnabledThemes()) this.apply(file);
    });
  }
}
