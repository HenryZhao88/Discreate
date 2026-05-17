// src/renderer/core/patcher.ts
type AnyFn = (...args: any[]) => any;
type Unpatch = () => void;

const registry = new Map<string, Unpatch[]>();

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
  const original: AnyFn = target[key];
  target[key] = wrap(original);
  return track(owner, () => { target[key] = original; });
}

export function before(
  owner: string, target: any, key: string,
  fn: (args: any[]) => void,
): Unpatch {
  return patch(owner, target, key, (orig) => function (this: any, ...args: any[]) {
    fn(args);
    return orig.apply(this, args);
  });
}

export function after(
  owner: string, target: any, key: string,
  fn: (args: any[], ret: any) => any,
): Unpatch {
  return patch(owner, target, key, (orig) => function (this: any, ...args: any[]) {
    const ret = orig.apply(this, args);
    const replaced = fn(args, ret);
    return replaced === undefined ? ret : replaced;
  });
}

export function instead(
  owner: string, target: any, key: string,
  fn: (args: any[], orig: AnyFn) => any,
): Unpatch {
  return patch(owner, target, key, (orig) => function (this: any, ...args: any[]) {
    return fn(args, orig.bind(this));
  });
}

export function unpatchAll(owner: string): void {
  const list = registry.get(owner) ?? [];
  for (let i = list.length - 1; i >= 0; i--) list[i]();
  registry.delete(owner);
}
