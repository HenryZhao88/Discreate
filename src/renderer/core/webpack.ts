// src/renderer/core/webpack.ts
export type ModuleFilter = (mod: any) => boolean;

export function byProps(...props: string[]): ModuleFilter {
  return (mod) => mod != null && props.every((p) => mod[p] !== undefined);
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
  return find(byProps(...props));
}

export function findByCode(...fragments: string[]): any {
  return find(byCode(...fragments));
}

export function waitFor(filter: ModuleFilter, cb: (mod: any) => void): void {
  const existing = find(filter);
  if (existing) return cb(existing);
  waiters.push({ filter, cb });
}
