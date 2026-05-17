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
        (v) => typeof v === "function" &&
          fragments.every((f) => Function.prototype.toString.call(v).includes(f)),
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

const cache: any[] = [];
const waiters: { filter: ModuleFilter; cb: (mod: any) => void }[] = [];

function collect(exports: any): void {
  if (!exports) return;
  cache.push(exports);
  if (exports.default && typeof exports.default === "object") cache.push(exports.default);
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i].filter(exports) || (exports.default && waiters[i].filter(exports.default))) {
      waiters[i].cb(waiters[i].filter(exports) ? exports : exports.default);
      waiters.splice(i, 1);
    }
  }
}

export function initWebpack(): void {
  const key = "webpackChunkdiscord_app";
  const chunk: any[] = (window as any)[key] ?? ((window as any)[key] = []);
  const originalPush = chunk.push.bind(chunk);
  chunk.push = (item: any) => {
    const modules = item[1];
    for (const id of Object.keys(modules)) {
      const original = modules[id];
      modules[id] = (mod: any, mExports: any, require: any) => {
        original(mod, mExports, require);
        collect(mod.exports);
      };
    }
    return originalPush(item);
  };
}

export function find(filter: ModuleFilter): any {
  return searchModules(cache, filter);
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
