// src/renderer/core/themes.ts
import { native } from "./paths.js";
import { makeLogger } from "./logger.js";
import type { SettingsStore } from "./settings.js";

const log = makeLogger("themes");
const STYLE_PREFIX = "discreate-theme-";
const CACHE_DIR = "theme-cache";

// Cache resolved `@import url(...)` bodies so we don't re-fetch on hot-reload.
const importCache = new Map<string, string>();

function cacheKey(url: string): string {
  // FNV-1a: stable, short, and available in the renderer without Node crypto.
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cachedImport(url: string): string | null {
  try {
    return native().readText(`${native().root}/${CACHE_DIR}/${cacheKey(url)}.css`);
  } catch {
    return null;
  }
}

function cacheImport(url: string, css: string): void {
  try {
    native().writeText(`${native().root}/${CACHE_DIR}/${cacheKey(url)}.css`, css);
  } catch (err) {
    log.warn(`could not cache theme import ${url}:`, err);
  }
}

/** GitHub Pages occasionally fails while raw.githubusercontent.com is healthy. */
export function importCandidates(url: string): string[] {
  try {
    const parsed = new URL(url);
    const match = parsed.hostname.match(/^([^.]+)\.github\.io$/i);
    const [, repo, ...rest] = parsed.pathname.split("/");
    if (match && repo && rest.length) {
      return [
        `https://raw.githubusercontent.com/${match[1]}/${repo}/HEAD/${rest.join("/")}`,
        url,
      ];
    }
  } catch { /* leave malformed/non-GitHub URLs unchanged */ }
  return [url];
}

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
        let body: string | null = null;
        let lastError: unknown;
        for (const candidate of importCandidates(t.url)) {
          try {
            body = await native().fetchText(candidate);
            break;
          } catch (err) {
            lastError = err;
          }
        }
        if (body == null) throw lastError ?? new Error("no import URL succeeded");
        // Recurse: imported sheet may itself contain imports.
        replacement = await inlineImports(body, depth + 1);
        importCache.set(t.url, replacement);
        cacheImport(t.url, replacement);
      } catch (err) {
        const previous = cachedImport(t.url);
        if (previous != null) {
          log.warn(`@import refresh failed for ${t.url}; using cached copy: ${err}`);
          replacement = previous;
          importCache.set(t.url, replacement);
        } else {
          // Keep the original import as a final browser-level fallback instead
          // of permanently caching an empty failure for this session.
          log.warn(`@import fetch failed for ${t.url}: ${err}`);
          replacement = t.raw;
        }
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
