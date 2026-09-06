// src/renderer/core/patcher.ts
type AnyFn = (...args: any[]) => any;
type Unpatch = () => void;

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

export function before(
  owner: string, target: any, key: string,
  fn: (args: any[]) => void,
): Unpatch {
  return patch(owner, target, key, (orig) => function (this: any, ...args: any[]) {
    fn.call(this, args);
    return orig.apply(this, args);
  });
}

export function after(
  owner: string, target: any, key: string,
  fn: (args: any[], ret: any) => any,
): Unpatch {
  return patch(owner, target, key, (orig) => function (this: any, ...args: any[]) {
    const ret = orig.apply(this, args);
    const replaced = fn.call(this, args, ret);
    return replaced === undefined ? ret : replaced;
  });
}

export function instead(
  owner: string, target: any, key: string,
  fn: (args: any[], orig: AnyFn) => any,
): Unpatch {
  return patch(owner, target, key, (orig) => function (this: any, ...args: any[]) {
    return fn.call(this, args, orig.bind(this));
  });
}

export function unpatchAll(owner: string): void {
  const list = registry.get(owner) ?? [];
  for (let i = list.length - 1; i >= 0; i--) list[i]();
  registry.delete(owner);
}
