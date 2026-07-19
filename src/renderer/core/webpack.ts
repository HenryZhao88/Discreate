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

/**
 * Match a Flux store by its registered name (`getName()`).
 *
 * Prop-based finders are unreliable for stores: many unrelated modules expose
 * a `getMessage`/`getMessages` (or similar) method pair, and the first match
 * is often a helper that holds no data. Every real Flux store reports a stable
 * name, so matching on that picks the genuine store.
 */
export function byStoreName(name: string): ModuleFilter {
  return (mod) => {
    if (!mod || typeof mod !== "object") return false;
    const getName = (mod as any).getName;
    if (typeof getName !== "function") return false;
    try {
      return getName.call(mod) === name;
    } catch {
      return false;
    }
  };
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

/**
 * Yield a module's exports object plus each of its own object/function values.
 *
 * Discord's bundler mangles export names — a store the source calls
 * `UserStore` ships as `exports.Z` (or `.ZP`, `.default`, …). A finder that
 * only checks the exports object and `.default` misses every such module, so
 * we surface each individual export value as a candidate too.
 */
export function* exportCandidates(exports: any): Generator<any> {
  if (exports == null) return;
  yield exports;
  if (typeof exports !== "object" && typeof exports !== "function") return;
  let keys: string[];
  try {
    keys = Object.keys(exports);
  } catch {
    return;
  }
  for (const k of keys) {
    let v: any;
    try {
      v = exports[k];
    } catch {
      // a hostile module can expose a throwing getter; skip it
      continue;
    }
    if (v != null && (typeof v === "object" || typeof v === "function")) yield v;
  }
}

/**
 * Search a list of module-exports objects, drilling into mangled named
 * exports. Returns the matching candidate itself (the inner store/component),
 * not its wrapper module.
 */
export function findIn(modules: any[], filter: ModuleFilter): any {
  for (const mod of modules) {
    for (const candidate of exportCandidates(mod)) {
      try {
        if (filter(candidate)) return candidate;
      } catch {
        // skip
      }
    }
  }
  return undefined;
}

// --- live webpack hook (exercised inside Discord, not in unit tests) ---

let wpRequire: any = null;
const webpackRequires = new Set<any>();
const cache: any[] = [];
const waiters: { filter: ModuleFilter; cb: (mod: any) => void }[] = [];
const ORIGINAL_FACTORY = Symbol.for("discreate.originalWebpackFactory");

function webpackRequireScore(require: any): number {
  if (typeof require !== "function") return -1;
  let score = 0;
  if (require.p === "/assets/") score += 1_000_000;
  if (require.c && typeof require.c === "object") score += 100_000;
  if (typeof require.e === "function") score += 10_000;
  if (require.m && typeof require.m === "object") {
    try { score += Math.min(Object.keys(require.m).length, 9_999); } catch { /* ignore */ }
  }
  return score;
}

function selectBestWebpackRequire(): void {
  let best = wpRequire;
  for (const candidate of webpackRequires) {
    if (webpackRequireScore(candidate) > webpackRequireScore(best)) best = candidate;
  }
  if (!best || best === wpRequire) return;
  wpRequire = best;
  // Do not let exports collected from an auxiliary runtime shadow Discord's
  // main stores. The selected runtime's live cache is authoritative.
  cache.length = 0;
  ingestCacheFromRequire();
  makeRendererLogger("webpack")(
    `selected runtime p=${String(wpRequire.p)}, factories=${Object.keys(wpRequire.m ?? {}).length}, cache=${Object.keys(wpRequire.c ?? {}).length}`,
  );
}

function registerWebpackRequire(require: any): void {
  if (typeof require !== "function") return;
  webpackRequires.add(require);
  selectBestWebpackRequire();
  // `m`, `c`, and `p` are assigned at different points during bootstrap.
  // Re-score after those assignments have had a chance to complete.
  for (const delay of [0, 50, 250, 1000]) {
    setTimeout(selectBestWebpackRequire, delay);
  }
}

function installWebpackInstanceCapture(): void {
  const proto = Function.prototype as any;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "m");
  if (descriptor && !descriptor.configurable) return;
  Object.defineProperty(proto, "m", {
    configurable: true,
    enumerable: false,
    set(this: any, modules: any) {
      Object.defineProperty(this, "m", {
        value: modules,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      registerWebpackRequire(this);
    },
  });
}

export async function waitForMainWebpack(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    selectBestWebpackRequire();
    const factoryCount = wpRequire?.m ? Object.keys(wpRequire.m).length : 0;
    if (wpRequire?.p === "/assets/" && wpRequire?.c && factoryCount > 1000) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  selectBestWebpackRequire();
}

/** Read Discord's factory source even after initWebpack has wrapped it. */
export function getWebpackFactorySource(factory: any): string {
  const original = factory?.[ORIGINAL_FACTORY] ?? factory;
  return Function.prototype.toString.call(original);
}

/** Require a known module from Discord's currently loaded bundle. */
export function getWebpackModuleById(id: string | number): any {
  if (!wpRequire) return undefined;
  try {
    return wpRequire(String(id));
  } catch {
    return undefined;
  }
}

function notifyWaiters(exports: any): void {
  if (!exports) return;
  for (let i = waiters.length - 1; i >= 0; i--) {
    const w = waiters[i];
    let match: any;
    for (const candidate of exportCandidates(exports)) {
      try {
        if (w.filter(candidate)) {
          match = candidate;
          break;
        }
      } catch {
        // A hostile module's filter can throw; ignore and keep scanning.
      }
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
  if (chunksForceLoaded) return;
  await waitForMainWebpack();
  // wpRequire is captured lazily, the first time Discord pushes a chunk. We
  // may be called before that happens — wait for it to appear so we can
  // actually enumerate factories. Bail out after 15s if it never shows.
  const deadline = Date.now() + 15000;
  while (!wpRequire?.e && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!wpRequire?.e) return;
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
      try { src = getWebpackFactorySource(fn); } catch { continue; }
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
  const loadLazyChunks = ids.length <= 256;
  if (loadLazyChunks) log(`force-loading ${ids.length} chunks…`);
  else {
    log(`skipping ${ids.length} lazy chunks; using the live main-bundle cache`);
    ingestCacheFromRequire();
    log("force-load done");
    return;
  }

  // Trigger each chunk; swallow individual failures so one broken chunk doesn't
  // stop the rest.
  if (loadLazyChunks) {
    await Promise.all(
      ids.map((id) =>
        Promise.resolve(wpRequire.e(id)).catch(() => undefined),
      ),
    );
  }

  // Fetching a chunk only populates `__webpack_require__.m` (the factory map)
  // with new factories — it does NOT evaluate them. BD plugins like
  // MessageLoggerV2 expect every Flux store to be reachable at boot, which
  // requires the factories to actually run. Evaluate them all, mirroring
  // BetterDiscord's "load every module" behaviour. Some factories will throw
  // (circular deps, missing globals); swallow and continue.
  await evaluateAllFactories();
  ingestCacheFromRequire();
  log("force-load done");
}

let factoriesEvaluated = false;

async function evaluateAllFactories(): Promise<void> {
  if (factoriesEvaluated || !wpRequire?.m) return;
  factoriesEvaluated = true;
  const ids = Object.keys(wpRequire.m);
  let ok = 0, fail = 0;
  // Run in small async batches so we yield to Discord and don't block the UI
  // for too long. 100 modules per microtask is responsive yet fast.
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    for (const id of slice) {
      try { wpRequire(id); ok++; } catch { fail++; }
    }
    await Promise.resolve();
  }
  makeRendererLogger("webpack")(`evaluated ${ok}/${ids.length} factories (${fail} failed)`);
}

function makeRendererLogger(tag: string): (...a: any[]) => void {
  return (...a: any[]) => console.log(`%c[Discreate:${tag}]`, "color:#5865F2;font-weight:bold", ...a);
}

export function initWebpack(): void {
  installWebpackInstanceCapture();
  const key = "webpackChunkdiscord_app";
  const chunk: any[] = (window as any)[key] ?? ((window as any)[key] = []);
  const originalPush = chunk.push.bind(chunk);
  chunk.push = (item: any) => {
    const modules = item[1];
    if (modules) {
      for (const id of Object.keys(modules)) {
        const original = modules[id]?.[ORIGINAL_FACTORY] ?? modules[id];
        const wrapped = (mod: any, mExports: any, require: any) => {
          registerWebpackRequire(require);
          original(mod, mExports, require);
          if (mod?.exports) collect(mod.exports);
          if (mExports && mExports !== mod?.exports) collect(mExports);
        };
        Object.defineProperty(wrapped, ORIGINAL_FACTORY, { value: original });
        modules[id] = wrapped;
      }
    }
    return originalPush(item);
  };

  // Capture the runtime immediately. Waiting for a later module factory to
  // execute is unreliable once Discord's initial chunks have already loaded,
  // and leaves `wpRequire` null even though the module cache is available.
  // Webpack invokes the third tuple member with its live require function.
  try {
    originalPush([
      [`discreate_capture_${Date.now()}`],
      {},
      (require: any) => {
        registerWebpackRequire(require);
      },
    ]);
  } catch (err) {
    makeRendererLogger("webpack")("immediate runtime capture failed", err);
  }
}

/**
 * Find a module matching the filter. Checks our collected cache first, then
 * falls back to a live scan of `__webpack_require__.c` so callers can find
 * modules that loaded before initWebpack ran.
 */
export function find(filter: ModuleFilter): any {
  // Prefer the selected main runtime's cache. The auxiliary runtime cache can
  // contain same-named disconnected store proxies.
  if (wpRequire?.c) {
    const c = wpRequire.c;
    const live: any[] = [];
    for (const id of Object.keys(c)) {
      const ex = c[id]?.exports;
      if (ex) live.push(ex);
    }
    const found = findIn(live, filter);
    if (found !== undefined) return found;
  }
  return findIn(cache, filter);
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

/** Find a live Flux store instance by its registered `getName()`. */
export function findStore(name: string): any {
  // Discord's bridged-store rollout can leave multiple exported instances with
  // the same display name in webpack. Only the instances registered on the
  // active FluxStore base class receive gateway actions. Prefer that registry
  // over the first matching export in module insertion order.
  let liveStore: any;
  find((candidate) => {
    if (typeof candidate !== "function" || typeof candidate.getAll !== "function") return false;
    let stores: any;
    try { stores = candidate.getAll(); } catch { return false; }
    if (!Array.isArray(stores)) return false;
    liveStore = stores.find((store: any) => {
      try { return store?.getName?.() === name; } catch { return false; }
    });
    return liveStore !== undefined;
  });
  if (liveStore !== undefined) return liveStore;
  return find(byStoreName(name));
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

/**
 * Require a module by matching its factory source, deliberately skipping the
 * loaded-export cache. Discord's bridged stores can expose same-shaped but
 * disconnected mirrors there; the current factory exports the concrete store.
 */
export function findByFactoryProps(...props: string[]): any {
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
    try { src = getWebpackFactorySource(fn); } catch { continue; }
    if (!matchers.every((m) => m(src))) continue;
    let mod: any;
    try { mod = wpRequire(id); } catch { continue; }
    for (const c of exportCandidates(mod)) {
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
    try { src = getWebpackFactorySource(fn); } catch { continue; }
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

/**
 * Locate Discord's live FluxDispatcher *instance* (not the class).
 *
 * Direct lookup is unreliable: the dispatcher isn't a clean top-level export,
 * and Discord's `IntlMessagesProxy` answers `dispatch`/`subscribe` truthy for
 * every property so it floods prop-based finders.
 *
 * Instead we go through a Flux *store*. Every Flux store instance holds a
 * `_dispatcher` reference back to the singleton dispatcher. Stores are easy
 * to find by their distinctive methods, so we find one and read `_dispatcher`.
 */
export function findFluxDispatcher(): any {
  // Prefer stores from the active FluxStore registry. A same-name webpack
  // duplicate may carry a dispatcher that never receives live actions.
  for (const name of ["UserStore", "ChannelStore", "GuildStore", "ReadStateStore"]) {
    const store = findStore(name);
    const dispatcher = store?._dispatcher;
    if (dispatcher && typeof dispatcher.dispatch === "function") return dispatcher;
  }
  // Candidate store finders — any one resolving gives us `_dispatcher`.
  const storeFilters: ModuleFilter[] = [
    byProps("getCurrentUser", "getUser"),       // UserStore
    byProps("getChannel", "hasChannel"),        // ChannelStore
    byProps("getGuild", "getGuilds"),           // GuildStore
    byProps("getMessage", "getMessages"),       // MessageStore
    byProps("isDeveloper"),                     // DeveloperExperimentStore etc.
  ];
  for (const filter of storeFilters) {
    const store = find(filter);
    const dispatcher = store?._dispatcher;
    if (dispatcher && typeof dispatcher.dispatch === "function") {
      return dispatcher;
    }
  }
  // Fallback: scan every cached object for a `_dispatcher` with a callable
  // dispatch. The first store we hit hands us the singleton.
  let found: any;
  find((mod) => {
    if (found) return true;
    const d = mod?._dispatcher;
    if (d && typeof d === "object" && typeof d.dispatch === "function" &&
        typeof d.subscribe === "function" && !isIntlMessagesProxy(d)) {
      found = d;
      return true;
    }
    return false;
  });
  return found;
}

/** DEBUG: describe every cached module exposing dispatch + subscribe. */
export function debugDumpDispatchers(): string[] {
  const out: string[] = [];
  const seen = new Set<any>();
  function consider(m: any, src: string): void {
    if (!m || typeof m !== "object" || seen.has(m)) return;
    seen.add(m);
    if (typeof m.dispatch === "function" && typeof m.subscribe === "function") {
      let keys: string[] = [];
      try { keys = Object.keys(m); } catch { /* ignore */ }
      let protoKeys: string[] = [];
      try { protoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(m) ?? {}); } catch { /* ignore */ }
      out.push(
        `[${src}] tag=${Object.prototype.toString.call(m)} ` +
        `ownKeys=[${keys.slice(0, 20).join(",")}] ` +
        `protoKeys=[${protoKeys.slice(0, 20).join(",")}]`,
      );
    }
  }
  for (const mod of cache) {
    consider(mod, "cache");
    if (mod && typeof mod === "object") {
      try { consider(mod.default, "cache.default"); } catch { /* ignore */ }
    }
  }
  if (wpRequire?.c) {
    for (const id of Object.keys(wpRequire.c)) {
      const ex = wpRequire.c[id]?.exports;
      if (!ex) continue;
      consider(ex, `c[${id}]`);
      if (typeof ex === "object") {
        try { consider(ex.default, `c[${id}].default`); } catch { /* ignore */ }
      }
    }
  }
  out.unshift(`-- ${out.length} dispatch+subscribe objects, cache=${cache.length}, c=${wpRequire?.c ? Object.keys(wpRequire.c).length : 0} --`);
  return out;
}

export function waitFor(filter: ModuleFilter, cb: (mod: any) => void): void {
  const existing = find(filter);
  if (existing) return cb(existing);
  waiters.push({ filter, cb });
}
