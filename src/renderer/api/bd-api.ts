// src/renderer/api/bd-api.ts
// BetterDiscord-compatible API shim. Builds `window.BdApi` so BD plugins
// (e.g. MessageLoggerV2.plugin.js) can be dropped into ~/.discreate/plugins/
// and load against Discreate's primitives.
//
// Anything we can't resolve becomes a Proxy that logs `not implemented`
// rather than throwing, so partial BdApi gaps degrade gracefully.

import { Discreate } from "./index.js";
import { find, findByProps, findByCode, byProps, byCode } from "../core/webpack.js";
import { before, after, instead, unpatchAll } from "../core/patcher.js";
import { native } from "../core/paths.js";
import { makeLogger } from "../core/logger.js";

const log = makeLogger("BdApi");

// ---------------------------------------------------------------------------
// not-implemented Proxy. Acts as both an object and a function: property
// access returns another stub, calling logs and returns undefined.
// ---------------------------------------------------------------------------

function notImplemented(path: string): any {
  const fn: any = function (..._args: any[]) {
    log.warn(`not implemented: ${path}`);
    return undefined;
  };
  return new Proxy(fn, {
    get(_t, key) {
      if (key === Symbol.toPrimitive) return () => `[BdApi:${path}]`;
      if (typeof key !== "string") return undefined;
      return notImplemented(`${path}.${key}`);
    },
    apply(_t, _this, args) {
      log.warn(`not implemented: ${path}`, ...args);
      return undefined;
    },
  });
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function findInTree(
  tree: any,
  filter: (n: any) => boolean,
  opts: { walkable?: string[] | null; ignore?: string[] } = {},
): any {
  if (tree == null || typeof tree !== "object") return null;
  const seen = new Set<any>();
  const ignore = new Set(opts.ignore ?? []);
  const stack: any[] = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (node == null || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    try {
      if (filter(node)) return node;
    } catch {
      // skip
    }
    const keys = opts.walkable && opts.walkable.length > 0 ? opts.walkable : Object.keys(node);
    for (const k of keys) {
      if (ignore.has(k)) continue;
      const v = (node as any)[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

function getNestedValue(obj: any, path: string): any {
  if (obj == null || !path) return undefined;
  return path.split(".").reduce((acc: any, k) => (acc == null ? acc : acc[k]), obj);
}

function parseVersion(v: string): number[] {
  return String(v ?? "0").split(/[.+-]/).map((p) => parseInt(p, 10) || 0);
}

function semverCompare(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const n = Math.max(av.length, bv.length);
  for (let i = 0; i < n; i++) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export const BdUtils = { findInTree, getNestedValue, semverCompare };

// ---------------------------------------------------------------------------
// Webpack
// ---------------------------------------------------------------------------

function buildWebpack(): any {
  function findAll(filter: (m: any) => boolean): any[] {
    // best-effort: scan our cache via repeated `find` not possible; expose via
    // proxy over the wp cache. Simpler: re-scan __webpack_require__.c.
    const out: any[] = [];
    const wp: any = (window as any).webpackChunkdiscord_app;
    const req: any = (window as any).__webpack_require__;
    const c = req?.c;
    if (c) {
      for (const id of Object.keys(c)) {
        const ex = c[id]?.exports;
        if (!ex) continue;
        try { if (filter(ex)) out.push(ex); } catch { /* skip */ }
        if (ex.default) {
          try { if (filter(ex.default)) out.push(ex.default); } catch { /* skip */ }
        }
      }
    }
    void wp;
    return out;
  }

  const Filters = {
    byKeys: (...keys: string[]) => byProps(...keys),
    byProps: (...keys: string[]) => byProps(...keys),
    byStrings: (...frags: string[]) => byCode(...frags),
    bySource: (...frags: string[]) => byCode(...frags.map(String)),
    byDisplayName: (name: string) => (mod: any) =>
      mod != null && (mod.displayName === name || mod?.default?.displayName === name),
    byPrototypeKeys: (...keys: string[]) => (mod: any) =>
      typeof mod === "function" && mod.prototype && keys.every((k) => k in mod.prototype),
  };

  function getModule(filter: any, opts: any = {}): any {
    const f: (m: any) => boolean = typeof filter === "function" ? filter : () => false;
    if (opts && opts.first === false) {
      return findAll(f);
    }
    const direct = find(f);
    if (direct) return direct;
    if (opts && opts.searchExports) {
      // probe individual exports of every module
      const req: any = (window as any).__webpack_require__;
      const c = req?.c;
      if (c) {
        for (const id of Object.keys(c)) {
          const ex = c[id]?.exports;
          if (!ex || typeof ex !== "object") continue;
          for (const k of Object.keys(ex)) {
            try {
              const v = ex[k];
              if (v != null && f(v)) return v;
            } catch { /* skip */ }
          }
        }
      }
    }
    return undefined;
  }

  function getByKeys(...keys: string[]): any { return findByProps(...keys); }
  function getBySource(...frags: any[]): any {
    return findByCode(...frags.map((f) => (typeof f === "function" ? f.toString() : String(f))));
  }
  function getByStrings(...strings: string[]): any { return findByCode(...strings); }

  function getMangled(filter: any, mapping: Record<string, any>): any {
    const result: Record<string, any> = {};
    if (!mapping) return result;
    for (const key of Object.keys(mapping)) {
      const m = mapping[key];
      if (typeof m === "function") {
        result[key] = getModule(m);
      } else {
        result[key] = undefined;
      }
    }
    void filter;
    return result;
  }

  // Lazy stores proxy: BdApi.Webpack.Stores.MessageStore -> findByProps lookup
  const storeCache = new Map<string, any>();
  const Stores = new Proxy({}, {
    get(_t, key: string) {
      if (typeof key !== "string") return undefined;
      if (storeCache.has(key)) return storeCache.get(key);
      const found = find((m) => m && typeof m.getName === "function" && (() => {
        try { return m.getName() === key; } catch { return false; }
      })());
      if (found) storeCache.set(key, found);
      return found;
    },
  });

  return {
    Filters,
    Stores,
    getModule,
    getByKeys,
    getBySource,
    getByStrings,
    getMangled,
    // Common BD aliases
    waitForModule: (filter: any) => getModule(filter),
    modules: [],
  };
}

// ---------------------------------------------------------------------------
// Patcher
// ---------------------------------------------------------------------------

function buildPatcher(): any {
  return {
    before(caller: string, target: any, key: string, fn: (ctx: any, args: any[]) => any) {
      return before(caller, target, key, (args) => { try { fn({}, args); } catch (e) { log.error("patcher.before cb threw:", e); } });
    },
    after(caller: string, target: any, key: string, fn: (ctx: any, args: any[], ret: any) => any) {
      return after(caller, target, key, (args, ret) => {
        try {
          const r = fn({}, args, ret);
          return r === undefined ? ret : r;
        } catch (e) {
          log.error("patcher.after cb threw:", e);
          return ret;
        }
      });
    },
    instead(caller: string, target: any, key: string, fn: (ctx: any, args: any[], orig: Function) => any) {
      return instead(caller, target, key, (args, orig) => {
        try {
          return fn({}, args, orig);
        } catch (e) {
          log.error("patcher.instead cb threw:", e);
          return undefined;
        }
      });
    },
    unpatchAll(caller: string) { unpatchAll(caller); },
    unbindAll(caller: string) { unpatchAll(caller); },
    getPatchesByCaller(_caller: string): any[] { return []; },
  };
}

// ---------------------------------------------------------------------------
// Data — JSON file under ~/.discreate/bd-data/<plugin>.json
// We piggyback on writeText/readText (which take an absolute path) via the
// existing native bridge.
// ---------------------------------------------------------------------------

function buildData(): any {
  const cache = new Map<string, Record<string, any>>();
  function dataPath(plugin: string): string {
    return `${native().root}/bd-data/${plugin}.json`;
  }
  function ensureDir(): void {
    const n = native() as any;
    // Try to make the dir by writing an empty placeholder if the directory
    // doesn't already exist; node's writeFileSync without mkdir would fail.
    // The native bridge doesn't expose mkdir, so we lazily try the write and
    // swallow errors.
    void n;
  }
  function read(plugin: string): Record<string, any> {
    if (cache.has(plugin)) return cache.get(plugin)!;
    let parsed: Record<string, any> = {};
    try {
      const raw = native().readText(dataPath(plugin));
      if (raw) parsed = JSON.parse(raw);
    } catch { /* ignore */ }
    cache.set(plugin, parsed);
    return parsed;
  }
  function write(plugin: string, data: Record<string, any>): void {
    cache.set(plugin, data);
    try {
      ensureDir();
      native().writeText(dataPath(plugin), JSON.stringify(data, null, 2));
    } catch (e) {
      log.warn(`Data.save failed for ${plugin}:`, e);
    }
  }
  return {
    load(plugin: string, key: string) { return read(plugin)[key]; },
    save(plugin: string, key: string, value: any) { const d = read(plugin); d[key] = value; write(plugin, d); },
    delete(plugin: string, key: string) { const d = read(plugin); delete d[key]; write(plugin, d); },
  };
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function buildDOM(): any {
  return {
    addStyle(id: string, css: string) {
      let el = document.querySelector(`style[data-discreate-bd="${id}"]`) as HTMLStyleElement | null;
      if (!el) {
        el = document.createElement("style");
        el.setAttribute("data-discreate-bd", id);
        document.head.appendChild(el);
      }
      el.textContent = css;
    },
    removeStyle(id: string) {
      document.querySelector(`style[data-discreate-bd="${id}"]`)?.remove();
    },
    createElement(tag: string, options: any = {}, child?: any) {
      const el = document.createElement(tag);
      if (options) {
        for (const k of Object.keys(options)) {
          if (k === "className") el.className = options[k];
          else if (k === "style" && typeof options[k] === "object") Object.assign(el.style, options[k]);
          else el.setAttribute(k, options[k]);
        }
      }
      if (child != null) {
        if (typeof child === "string") el.textContent = child;
        else if (child instanceof Node) el.appendChild(child);
      }
      return el;
    },
    parseHTML(html: string): Node {
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      return tpl.content.cloneNode(true);
    },
  };
}

// ---------------------------------------------------------------------------
// Net
// ---------------------------------------------------------------------------

function buildNet(): any {
  return {
    fetch(url: string, opts?: any) { return fetch(url, opts); },
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function buildUI(): any {
  function findToastMod(): any { return findByProps("showToast") || findByProps("createToast"); }
  function findNotificationMod(): any { return findByProps("showNotification"); }
  function findConfirmMod(): any { return findByProps("ConfirmModal") || findByProps("ConfirmationModal") || findByProps("openModal", "closeModal"); }
  function findTooltipMod(): any { return findByProps("Tooltip"); }

  function showToast(message: string, opts: any = {}): void {
    const m = findToastMod();
    try {
      if (m?.showToast) { m.showToast(message, opts?.type); return; }
      if (m?.createToast && m?.showToast) { m.showToast(m.createToast(message, opts?.type)); return; }
    } catch (e) { log.warn("showToast failed, falling back:", e); }
    // DOM fallback
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;bottom:24px;right:24px;background:#202225;color:#fff;padding:10px 16px;border-radius:6px;z-index:99999;font:14px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.5)";
    host.textContent = message;
    document.body.appendChild(host);
    setTimeout(() => host.remove(), opts?.timeout ?? 3000);
  }

  function showNotification(opts: any = {}): any {
    const m = findNotificationMod();
    try { if (m?.showNotification) return m.showNotification(opts); } catch { /* fallback */ }
    showToast(opts?.title || opts?.content || "Notification", opts);
  }

  function showConfirmationModal(title: string, content: any, opts: any = {}): void {
    const m = findConfirmMod();
    try {
      if (m?.openModal && m?.ConfirmModal) {
        const React = Discreate.React;
        m.openModal((props: any) => React.createElement(m.ConfirmModal, {
          ...props,
          header: title,
          confirmText: opts?.confirmText ?? "OK",
          cancelText: opts?.cancelText ?? "Cancel",
          onConfirm: opts?.onConfirm,
          onCancel: opts?.onCancel,
        }, typeof content === "string" ? content : null));
        return;
      }
    } catch (e) { log.warn("showConfirmationModal native path failed:", e); }
    const ok = window.confirm(`${title}\n\n${typeof content === "string" ? content : ""}`);
    if (ok) opts?.onConfirm?.(); else opts?.onCancel?.();
  }

  function showChangelogModal(opts: any = {}): void {
    const lines = (opts?.changes ?? []).map((c: any) => `- ${c.title ?? ""}`).join("\n");
    window.alert(`${opts?.title ?? "Changelog"}\n\n${lines}`);
  }

  function showInviteModal(code: string): void {
    window.alert(`Invite: discord.gg/${code}`);
  }

  function createTooltip(node: HTMLElement, content: string, _opts: any = {}): any {
    const m = findTooltipMod();
    if (m?.Tooltip) {
      // Native Discord Tooltip is React-based; we can't easily mount around an
      // arbitrary DOM node without remounting. Use the title attr fallback.
    }
    if (node && content) node.setAttribute("title", String(content));
    return { node, hide() { node?.removeAttribute("title"); } };
  }

  function buildSettingsPanel(spec: any): HTMLElement {
    const root = document.createElement("div");
    root.className = "discreate-bd-settings";
    const settings = spec?.settings ?? [];
    function emit(item: any, parent: HTMLElement): void {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2a2c31";
      const label = document.createElement("div");
      label.textContent = item.name ?? item.id ?? "";
      label.style.cssText = "color:#dcddde;font-size:14px";
      row.appendChild(label);
      let control: HTMLElement | null = null;
      if (item.type === "switch") {
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = !!item.value;
        cb.onchange = () => item.onChange?.(cb.checked);
        control = cb;
      } else if (item.type === "text") {
        const inp = document.createElement("input");
        inp.type = "text"; inp.value = item.value ?? "";
        inp.onchange = () => item.onChange?.(inp.value);
        control = inp;
      } else if (item.type === "number") {
        const inp = document.createElement("input");
        inp.type = "number"; inp.value = String(item.value ?? 0);
        inp.onchange = () => item.onChange?.(Number(inp.value));
        control = inp;
      } else if (item.type === "dropdown") {
        const sel = document.createElement("select");
        for (const o of item.options ?? []) {
          const opt = document.createElement("option");
          opt.value = String(o.value); opt.textContent = o.label ?? String(o.value);
          if (o.value === item.value) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.onchange = () => item.onChange?.(sel.value);
        control = sel;
      } else if (item.type === "category") {
        const cat = document.createElement("div");
        cat.style.cssText = "padding:8px 0";
        const h = document.createElement("h3");
        h.textContent = item.name ?? "";
        h.style.cssText = "color:#fff;font-size:14px;margin:8px 0";
        cat.appendChild(h);
        for (const sub of item.settings ?? []) emit(sub, cat);
        parent.appendChild(cat);
        return;
      }
      if (control) row.appendChild(control);
      parent.appendChild(row);
    }
    for (const item of settings) emit(item, root);
    return root;
  }

  return {
    showToast,
    showNotification,
    showConfirmationModal,
    showChangelogModal,
    showInviteModal,
    createTooltip,
    buildSettingsPanel,
  };
}

// ---------------------------------------------------------------------------
// ContextMenu
// ---------------------------------------------------------------------------

function buildContextMenu(): any {
  const callbacks = new Map<string, Set<(ret: any, props: any) => any>>();
  let patched = false;

  function ensurePatched(): void {
    if (patched) return;
    const m = findByProps("openContextMenu", "closeContextMenu");
    if (!m) return;
    after("discreate:bd-ctxmenu", m, "openContextMenu", (args) => {
      // BD's patch fires when the menu's React tree renders; we don't fully
      // emulate that. We can at least invoke registered callbacks with the
      // event's render output if accessible.
      try {
        const props = args?.[1];
        if (!props) return;
        // Each navId callback gets the tree to mutate; we pass through.
        for (const [navId, cbs] of callbacks) {
          for (const cb of cbs) {
            try { cb({ navId }, props); } catch (e) { log.warn(`ctxmenu cb ${navId} threw:`, e); }
          }
        }
      } catch { /* ignore */ }
    });
    patched = true;
  }

  return {
    patch(navId: string, cb: (ret: any, props: any) => any) {
      ensurePatched();
      let set = callbacks.get(navId);
      if (!set) { set = new Set(); callbacks.set(navId, set); }
      set.add(cb);
      return () => set!.delete(cb);
    },
    unpatch(navId: string, cb: any) {
      callbacks.get(navId)?.delete(cb);
    },
    buildMenu(items: any): any[] { return Array.isArray(items) ? items : []; },
    buildMenuChildren(items: any): any[] { return Array.isArray(items) ? items : []; },
    open(event: any, items: any) {
      const m = findByProps("openContextMenu", "closeContextMenu");
      if (m?.openContextMenu) {
        try { m.openContextMenu(event, () => items); return; } catch (e) { log.warn("ctxmenu.open failed:", e); }
      }
    },
    close() {
      const m = findByProps("openContextMenu", "closeContextMenu");
      try { m?.closeContextMenu?.(); } catch { /* ignore */ }
    },
  };
}

// ---------------------------------------------------------------------------
// Plugins / Components / ReactUtils
// ---------------------------------------------------------------------------

let pluginManagerRef: any = null;
export function setPluginManagerRef(mgr: any): void { pluginManagerRef = mgr; }

function buildPlugins(): any {
  return {
    get folder() { return native().pluginsDir; },
    get(name: string): any {
      if (!pluginManagerRef) return null;
      const all = pluginManagerRef.all?.() ?? [];
      return all.find((p: any) => p.id === name || p.plugin?.name === name) ?? null;
    },
    getAll(): any[] {
      return pluginManagerRef?.all?.() ?? [];
    },
    reload(name: string): void {
      if (!pluginManagerRef) return;
      try {
        pluginManagerRef.setEnabled(name, false);
        pluginManagerRef.setEnabled(name, true);
      } catch (e) { log.warn(`Plugins.reload(${name}) failed:`, e); }
    },
    isEnabled(name: string): boolean { return !!pluginManagerRef?.isEnabled?.(name); },
  };
}

function buildComponents(): any {
  const React = Discreate.React;
  // Discord's Button
  const btnMod = findByProps("Button", "BorderColors") || findByProps("Button", "ButtonColors");
  const NativeButton = btnMod?.Button;

  class ErrorBoundary extends (React?.Component ?? Object) {
    state: any = { error: null };
    static getDerivedStateFromError(error: any) { return { error }; }
    componentDidCatch(error: any) { log.error("BdApi ErrorBoundary caught:", error); }
    render(): any {
      if ((this as any).state?.error) {
        return React.createElement("div", { style: { color: "#f04747" } }, "Component error");
      }
      return (this as any).props.children;
    }
  }

  const Button = NativeButton ?? ((props: any) => React?.createElement("button", props, props.children));

  return { Button, ErrorBoundary };
}

function buildReactUtils(): any {
  const React = Discreate.React;
  return {
    wrapElement(element: any): HTMLElement {
      const host = document.createElement("div");
      try {
        const ReactDOM: any = Discreate.ReactDOM;
        if (ReactDOM?.createRoot) {
          ReactDOM.createRoot(host).render(element);
        } else if (ReactDOM?.render) {
          ReactDOM.render(element, host);
        }
      } catch (e) { log.warn("ReactUtils.wrapElement render failed:", e); }
      void React;
      return host;
    },
  };
}

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

export function installBdApi(): any {
  const Patcher = buildPatcher();
  const Webpack = buildWebpack();
  const Data = buildData();
  const DOM = buildDOM();
  const Net = buildNet();
  const UI = buildUI();
  const ContextMenu = buildContextMenu();
  const Plugins = buildPlugins();
  const Components = buildComponents();
  const ReactUtils = buildReactUtils();

  const root: any = {
    version: "discreate-bd-shim/1",
    React: Discreate.React,
    ReactDOM: Discreate.ReactDOM,
    Patcher, Webpack, Data, DOM, Net, UI, ContextMenu, Plugins, Components, ReactUtils,
    Utils: BdUtils,
    Logger: {
      log: (...a: any[]) => log.log(...a),
      info: (...a: any[]) => log.log(...a),
      warn: (...a: any[]) => log.warn(...a),
      error: (...a: any[]) => log.error(...a),
      debug: (...a: any[]) => log.log(...a),
      stacktrace: (msg: string, err: any) => log.error(msg, err),
    },
    alert(title: string, content: any) {
      window.alert(`${title}\n\n${typeof content === "string" ? content : ""}`);
    },
    // Legacy aliases that old BD plugins use
    findModule: Webpack.getModule,
    findModuleByProps: Webpack.getByKeys,
    findAllModules: (filter: any) => Webpack.getModule(filter, { first: false }),
    getCore: () => null,
    suppressErrors: <T extends (...a: any[]) => any>(fn: T, _label?: string): T => {
      return ((...args: any[]) => { try { return fn(...args); } catch (e) { log.warn("suppressed:", e); } }) as any;
    },
    injectCSS(id: string, css: string) { DOM.addStyle(id, css); },
    clearCSS(id: string) { DOM.removeStyle(id); },
    showToast: UI.showToast,
    showConfirmationModal: UI.showConfirmationModal,
    showNotification: UI.showNotification,
  };

  // Wrap with a Proxy so unknown property paths return not-implemented stubs.
  const wrapped = new Proxy(root, {
    get(t, key) {
      if (key in t) return (t as any)[key];
      if (typeof key !== "string") return undefined;
      return notImplemented(key);
    },
  });

  (window as any).BdApi = wrapped;
  try { (globalThis as any).BdApi = wrapped; } catch { /* ignore */ }
  return wrapped;
}

// Re-exports for tests (pure functions only)
export const __test = { findInTree, getNestedValue, semverCompare };
