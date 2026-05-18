// src/renderer/core/webpack.ts
export type ModuleFilter = (mod: any) => boolean;

/**
 * Discord's `IntlMessagesProxy` is a JS Proxy that responds to ANY property
 * access with a translation resolver. If a finder only checks
 * `mod[p] !== undefined`, the intl proxy matches every query and shadows the
 * real modules. We disqualify it by name.
 */
function isIntlMessagesProxy(mod: any): boolean {
  if (!mod || typeof mod !== "object") return false;
  // The proxy's Symbol.toStringTag is "IntlMessagesProxy".
  try {
    const tag = Object.prototype.toString.call(mod);
    return tag.includes("IntlMessagesProxy");
  } catch {
    return false;
  }
}

export function byProps(...props: string[]): ModuleFilter {
  return (mod) =>
    mod != null &&
    !isIntlMessagesProxy(mod) &&
    props.every((p) => mod[p] !== undefined);
}

export function byCode(...fragments: string[]): ModuleFilter {
  return (mod) => {
    if (typeof mod === "function") {
      const src = Function.prototype.toString.call(mod);
      return fragments.every((f) => src.includes(f));
    }
    if (mod && typeof mod === "object") {
      return Object.values(mod).some(
        (v) =>
          typeof v === "function" &&
          fragments.every((f) =>
            Function.prototype.toString.call(v).includes(f),
          ),
      );
    }
    return false;
  };
}

export function searchModules(modules: any[], filter: ModuleFilter): any {
  for (const mod of modules) if (filter(mod)) return mod;
  return undefined;
}

// --- live webpack hook (exercised inside Discord, not in unit tests) ---

let wpRequire: any = null;
const cache: any[] = [];
const waiters: { filter: ModuleFilter; cb: (mod: any) => void }[] = [];

function notifyWaiters(exports: any): void {
  if (!exports) return;
  for (let i = waiters.length - 1; i >= 0; i--) {
    const w = waiters[i];
    let match: any;
    try {
      if (w.filter(exports)) match = exports;
      else if (exports.default && w.filter(exports.default)) match = exports.default;
    } catch {
      // A hostile module's filter can throw; ignore and keep scanning.
    }
    if (match) {
      waiters.splice(i, 1);
      try {
        w.cb(match);
      } catch (err) {
        console.error("[Discreate] waiter callback threw:", err);
      }
    }
  }
}

function collect(exports: any): void {
  if (!exports) return;
  cache.push(exports);
  notifyWaiters(exports);
}

/**
 * Webpack 5's entry bundle pre-evaluates a large chunk of modules (including
 * React and FluxDispatcher) before any `chunk.push` happens. Those modules
 * never come through our push hook, so we grab `__webpack_require__` from the
 * first factory call and read its module cache directly.
 */
function ingestCacheFromRequire(): void {
  if (!wpRequire?.c) return;
  const c = wpRequire.c;
  for (const id of Object.keys(c)) {
    const ex = c[id]?.exports;
    if (ex) collect(ex);
  }
}

let chunksForceLoaded = false;

/**
 * Discord aggressively code-splits — stores like MessageStore and ChannelStore
 * live in chunks that don't load until the user opens a relevant view. BD-style
 * plugins assume everything is reachable at boot, so we force-load every async
 * chunk the runtime knows about. Vencord and BetterDiscord do the same.
 *
 * Uses `__webpack_require__.e(chunkId)` to load each chunk, then re-ingests
 * the now-populated module cache so finders can see the new exports.
 */
export async function forceLoadAllChunks(): Promise<void> {
  if (chunksForceLoaded || !wpRequire?.e) return;
  chunksForceLoaded = true;

  // `wpRequire.u(id)` returns the chunk filename for `id`, but it throws for
  // invalid IDs. Enumerate IDs by scanning `wpRequire.O` (onChunksLoaded) /
  // `wpRequire.f.j` (jsonp chunk loading function) for their internal maps —
  // they hold the manifest. Different webpack runtimes expose it differently;
  // try multiple known shapes.
  const chunkIds = new Set<string | number>();

  // The most reliable enumeration: scan every loaded module factory for calls
  // to `__webpack_require__.e(id)` (or its minified equivalent — single-letter
  // member access on the require). Each such call references a known chunk.
  // This finds every chunk the loaded code ever lazy-imports.
  try {
    const factories = wpRequire.m as Record<string, any>;
    // Discord's minified require: `.e(<num>)` or `.e("<num>")`. Match both.
    const re = /\.e\(["']?(\d+)["']?\)/g;
    for (const id of Object.keys(factories)) {
      const fn = factories[id];
      if (typeof fn !== "function") continue;
      let src: string;
      try { src = Function.prototype.toString.call(fn); } catch { continue; }
      for (const m of src.matchAll(re)) chunkIds.add(m[1]);
    }
  } catch { /* ignore */ }

  // Also include any chunk IDs already announced in the chunk push array
  // (covers any chunks the runtime knows about even if not referenced).
  try {
    const arr = (window as any).webpackChunkdiscord_app as any[];
    for (const item of arr) {
      const ids = item?.[0];
      if (Array.isArray(ids)) for (const id of ids) chunkIds.add(id);
    }
  } catch { /* ignore */ }

  const ids = [...chunkIds];
  const log = makeRendererLogger("webpack");
  log(`force-loading ${ids.length} chunks…`);

  // Trigger each chunk; swallow individual failures so one broken chunk doesn't
  // stop the rest. Then re-scan the require cache.
  await Promise.all(
    ids.map((id) =>
      Promise.resolve(wpRequire.e(id)).catch(() => undefined),
    ),
  );
  ingestCacheFromRequire();
  log("force-load done");
}

function makeRendererLogger(tag: string): (...a: any[]) => void {
  return (...a: any[]) => console.log(`%c[Discreate:${tag}]`, "color:#5865F2;font-weight:bold", ...a);
}

export function initWebpack(): void {
  const key = "webpackChunkdiscord_app";
  const chunk: any[] = (window as any)[key] ?? ((window as any)[key] = []);
  const originalPush = chunk.push.bind(chunk);
  chunk.push = (item: any) => {
    const modules = item[1];
    if (modules) {
      for (const id of Object.keys(modules)) {
        const original = modules[id];
        modules[id] = (mod: any, mExports: any, require: any) => {
          if (!wpRequire && require) {
            wpRequire = require;
            ingestCacheFromRequire();
          }
          original(mod, mExports, require);
          if (mod?.exports) collect(mod.exports);
          if (mExports && mExports !== mod?.exports) collect(mExports);
        };
      }
    }
    return originalPush(item);
  };
}

/**
 * Find a module matching the filter. Checks our collected cache first, then
 * falls back to a live scan of `__webpack_require__.c` so callers can find
 * modules that loaded before initWebpack ran.
 */
export function find(filter: ModuleFilter): any {
  for (const mod of cache) {
    try {
      if (filter(mod)) return mod;
    } catch {
      // skip
    }
  }
  if (wpRequire?.c) {
    const c = wpRequire.c;
    for (const id of Object.keys(c)) {
      const ex = c[id]?.exports;
      if (!ex) continue;
      try {
        if (filter(ex)) return ex;
        if (ex.default && filter(ex.default)) return ex.default;
      } catch {
        // skip
      }
    }
  }
  return undefined;
}

export function findByProps(...props: string[]): any {
  // Two-pass: prefer modules whose listed props are plain strings (typical CSS
  // class modules) over modules that just happen to share the prop names (most
  // often Discord's intl messages proxy, whose values are function resolvers).
  const stringy = find((mod) =>
    mod != null && props.every((p) => typeof mod[p] === "string"),
  );
  if (stringy !== undefined) return stringy;
  return find(byProps(...props));
}

/**
 * Like `findByProps`, but also scans `__webpack_require__.m` (the factory map)
 * for lazy-loaded modules that haven't been required yet. Used as an explicit
 * last-resort by the BdApi shim for plugin queries like MessageStore that only
 * load once the user opens a channel. Not used by the default `findByProps`
 * because eagerly requiring random factories can disturb Discord's boot order.
 */
export function findByPropsLazy(...props: string[]): any {
  const live = findByProps(...props);
  if (live !== undefined) return live;
  return findByLazyProps(props);
}

function findByLazyProps(props: string[]): any {
  if (!wpRequire?.m) return undefined;
  const factories = wpRequire.m as Record<string, (...a: any[]) => any>;
  // Match each prop as either a quoted string literal OR a bare identifier in
  // the factory source. Class-method names appear unquoted (`getMessage() {}`),
  // while object-literal keys appear quoted. We need both shapes.
  const matchers = props.map((p) => {
    const ident = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`);
    return (src: string) =>
      src.includes(`"${p}"`) || src.includes(`'${p}'`) || ident.test(src);
  });
  for (const id of Object.keys(factories)) {
    const fn = factories[id];
    if (typeof fn !== "function") continue;
    let src: string;
    try { src = Function.prototype.toString.call(fn); } catch { continue; }
    if (!matchers.every((m) => m(src))) continue;
    let mod: any;
    try { mod = wpRequire(id); } catch { continue; }
    const candidates = [mod, mod?.default].filter(Boolean);
    for (const c of candidates) {
      if (!isIntlMessagesProxy(c) && props.every((p) => c[p] !== undefined)) {
        return c;
      }
    }
  }
  return undefined;
}

export function findByCode(...fragments: string[]): any {
  return find(byCode(...fragments));
}

/**
 * Search module factory source for fragments. Factory source is the function
 * webpack invokes to populate the module — it contains all the string literals
 * the module's code uses, so it's the right place to look for distinctive
 * substrings like `"data-excessive-heading-level"`. This is what BD-style
 * `getBySource` / `getByStrings` actually expects.
 *
 * Returns the module's evaluated exports (calling the factory via the real
 * webpack require) so callers get a usable export, not the factory function.
 */
export function findByFactorySource(...fragments: string[]): any {
  return findByFactorySourceImpl(fragments, false);
}

/**
 * Like `findByFactorySource`, but drills into the matching module's exports
 * and returns the first individual export (typically a function) whose own
 * source contains all the fragments. This matches BD's `searchExports: true`
 * semantics — many modern Discord modules export a single helper under a
 * mangled key (e.g. `D` or `Z`), and BD plugins expect that callable, not
 * the wrapper.
 */
export function findByFactorySourceExport(...fragments: string[]): any {
  return findByFactorySourceImpl(fragments, true);
}

function findByFactorySourceImpl(fragments: string[], drill: boolean): any {
  if (!wpRequire?.m) return undefined;
  const factories = wpRequire.m as Record<string, (...a: any[]) => any>;
  for (const id of Object.keys(factories)) {
    const fn = factories[id];
    if (typeof fn !== "function") continue;
    let src: string;
    try { src = Function.prototype.toString.call(fn); } catch { continue; }
    if (!fragments.every((f) => src.includes(f))) continue;
    let exports: any;
    try { exports = wpRequire(id); } catch { continue; }
    if (!drill) return exports;

    // Drill: look at the module's keys and return the function whose own
    // source contains all the fragments. Then try default. Then fall back.
    const candidates: any[] = [];
    if (exports && typeof exports === "object") {
      for (const k of Object.keys(exports)) candidates.push(exports[k]);
      if (exports.default) candidates.unshift(exports.default);
    } else {
      candidates.push(exports);
    }
    for (const c of candidates) {
      if (typeof c !== "function") continue;
      let csrc: string;
      try { csrc = Function.prototype.toString.call(c); } catch { continue; }
      if (fragments.every((f) => csrc.includes(f))) return c;
    }
    // No individual export matched; return the first function export if any,
    // else the whole module.
    for (const c of candidates) if (typeof c === "function") return c;
    return exports;
  }
  return undefined;
}

export function waitFor(filter: ModuleFilter, cb: (mod: any) => void): void {
  const existing = find(filter);
  if (existing) return cb(existing);
  waiters.push({ filter, cb });
}
