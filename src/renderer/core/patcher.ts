// src/renderer/core/patcher.ts
import { makeLogger } from "./logger.js";

type AnyFn = (...args: any[]) => any;
type Unpatch = () => void;

const log = makeLogger("patcher");

const registry = new Map<string, Unpatch[]>();
interface PatchState {
  original: AnyFn;
  descriptor?: PropertyDescriptor;
  layers: { wrap: (orig: AnyFn) => AnyFn }[];
  installed: AnyFn;
}
const targets = new WeakMap<object, Map<string, PatchState>>();

function track(owner: string, unpatch: Unpatch): Unpatch {
  const list = registry.get(owner) ?? [];
  list.push(unpatch);
  registry.set(owner, list);
  return unpatch;
}

function patch(
  owner: string, target: any, key: string,
  wrap: (orig: AnyFn) => AnyFn,
): Unpatch {
  if (typeof target?.[key] !== "function") throw new TypeError(`Cannot patch ${key}: not a function`);
  let keys = targets.get(target);
  if (!keys) targets.set(target, keys = new Map());
  let state = keys.get(key);
  if (!state || target[key] !== state.installed) {
    state = { original: target[key], descriptor: Object.getOwnPropertyDescriptor(target, key), layers: [], installed: target[key] };
    keys.set(key, state);
  }
  const layer = { wrap };
  const rebuild = () => state!.layers.reduce((fn, item) => item.wrap(fn), state!.original);
  state.layers.push(layer);
  target[key] = state.installed = rebuild();
  let active = true;
  const unpatch = () => {
    if (!active) return;
    active = false;
    state!.layers.splice(state!.layers.indexOf(layer), 1);
    if (target[key] === state!.installed) {
      if (state!.layers.length) target[key] = state!.installed = rebuild();
      else if (state!.descriptor) Object.defineProperty(target, key, state!.descriptor);
      else delete target[key];
    }
    if (!state!.layers.length && keys!.get(key) === state) keys!.delete(key);
    const list = registry.get(owner);
    if (list) {
      const i = list.indexOf(unpatch);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) registry.delete(owner);
    }
  };
  return track(owner, unpatch);
}

// Plugin callbacks are isolated: a throwing hook is logged and swallowed so it
// can never break the host method (e.g. FluxDispatcher.dispatch) or other
// plugins' patches stacked on the same target.
export function before(
  owner: string, target: any, key: string,
  fn: (args: any[]) => void,
): Unpatch {
  return patch(owner, target, key, (orig) => function (this: any, ...args: any[]) {
    try { fn.call(this, args); }
    catch (err) { log.error(`before hook for ${owner} on ${key} threw:`, err); }
    return orig.apply(this, args);
  });
}

export function after(
  owner: string, target: any, key: string,
  fn: (args: any[], ret: any) => any,
): Unpatch {
  return patch(owner, target, key, (orig) => function (this: any, ...args: any[]) {
    const ret = orig.apply(this, args);
    try {
      const replaced = fn.call(this, args, ret);
      return replaced === undefined ? ret : replaced;
    } catch (err) {
      log.error(`after hook for ${owner} on ${key} threw:`, err);
      return ret;
    }
  });
}

export function instead(
  owner: string, target: any, key: string,
  fn: (args: any[], orig: AnyFn) => any,
): Unpatch {
  return patch(owner, target, key, (orig) => function (this: any, ...args: any[]) {
    let called = false;
    let result: any;
    let failure: { error: unknown } | undefined;
    const callOriginal = (...forwarded: any[]) => {
      called = true;
      failure = undefined;
      try { return result = orig.apply(this, forwarded); }
      catch (error) { failure = { error }; throw error; }
    };
    try { return fn.call(this, args, callOriginal); }
    catch (err) {
      // Host failures retain their original semantics. Retrying a dispatcher
      // (or any other stateful host method) can duplicate partial side effects.
      if (failure) throw failure.error;
      log.error(`instead hook for ${owner} on ${key} threw:`, err);
      return called ? result : orig.apply(this, args);
    }
  });
}

export function unpatchAll(owner: string): void {
  const list = registry.get(owner) ?? [];
  for (let i = list.length - 1; i >= 0; i--) list[i]();
  registry.delete(owner);
}
