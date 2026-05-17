// src/renderer/core/themes.ts
import { native } from "./paths.js";
import { makeLogger } from "./logger.js";
import type { SettingsStore } from "./settings.js";

const log = makeLogger("themes");
const STYLE_PREFIX = "discreate-theme-";

// Cache resolved `@import url(...)` bodies so we don't re-fetch on hot-reload.
const importCache = new Map<string, string>();

/**
 * BetterDiscord-style themes commonly do `@import url("https://.../main.css")`
 * for the actual ruleset and use the local file only for `:root` variable
 * overrides. Discord's renderer CSP blocks those imports silently, so the theme
 * appears applied (style element is in the head) but has no effect. We resolve
 * imports ahead of time and inline the fetched CSS.
 *
 * Also strips `@import` lines for Google Fonts and similar font CDNs: those
 * require a different fetch policy and aren't critical for the visual change.
 */
async function inlineImports(css: string, depth = 0): Promise<string> {
  if (depth > 3) return css; // defense against import cycles
  const importRe = /@import\s+url\(\s*['"]?([^'")]+)['"]?\s*\)\s*;?/g;
  const tasks: Array<{ raw: string; url: string }> = [];
  for (const m of css.matchAll(importRe)) tasks.push({ raw: m[0], url: m[1] });
  if (tasks.length === 0) return css;

  for (const t of tasks) {
    let replacement = "";
    if (importCache.has(t.url)) {
      replacement = importCache.get(t.url)!;
    } else {
      try {
        // Fetch via the main process — Discord's renderer CSP blocks direct fetch().
        const body = await native().fetchText(t.url);
        // Recurse: imported sheet may itself contain imports.
        replacement = await inlineImports(body, depth + 1);
        importCache.set(t.url, replacement);
      } catch (err) {
        log.warn(`@import fetch failed for ${t.url}: ${err}`);
        replacement = `/* @import ${t.url} failed: ${err} */`;
        importCache.set(t.url, replacement);
      }
    }
    css = css.replace(t.raw, replacement);
  }
  return css;
}

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

  private async apply(file: string): Promise<void> {
    const path = `${native().themesDir}/${file}`;
    const raw = native().readText(path);
    if (raw == null) { log.warn(`theme not found: ${file}`); return; }
    let el = document.getElementById(this.styleId(file)) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = this.styleId(file);
      document.head.appendChild(el);
    }
    // Inline @import urls so themes that depend on a remote stylesheet work.
    const resolved = await inlineImports(raw);
    el.textContent = resolved;
    log.log(`applied ${file} (${resolved.length} bytes)`);
  }

  private unapply(file: string): void {
    document.getElementById(this.styleId(file))?.remove();
  }

  setEnabled(file: string, enabled: boolean): void {
    const themes = new Set(this.settings.getEnabledThemes());
    if (enabled) {
      themes.add(file);
      void this.apply(file);
    } else {
      themes.delete(file);
      this.unapply(file);
    }
    this.settings.setEnabledThemes([...themes]);
  }

  /** Apply all enabled themes and hot-reload on directory changes. */
  start(): void {
    for (const file of this.settings.getEnabledThemes()) void this.apply(file);
    native().watchDir(native().themesDir, () => {
      log.log("themes folder changed, reloading");
      for (const file of this.settings.getEnabledThemes()) void this.apply(file);
    });
  }
}
