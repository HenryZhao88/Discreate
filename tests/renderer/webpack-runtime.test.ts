import { afterEach, describe, expect, it, vi } from "vitest";

const originalDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, "m");
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalDescriptor) Object.defineProperty(Function.prototype, "m", originalDescriptor);
  else delete (Function.prototype as any).m;
});

async function setup() {
  vi.resetModules();
  vi.useFakeTimers();
  const wp = await import("../../src/renderer/core/webpack");
  const req: any = (id: string) => { req.calls = (req.calls ?? 0) + 1; return req.c[id]?.exports; };
  req.p = "/assets/";
  req.c = {};
  req.m = {};
  const chunk: any[] = [];
  chunk.push = ((item: any) => { item[2]?.(req); return 1; }) as any;
  vi.stubGlobal("window", { webpackChunkdiscord_app: chunk });
  wp.initWebpack();
  return { wp, req, chunk };
}

describe("webpack integration boundary", () => {
  it("contains synchronous chunk errors and yields between factory batches", async () => {
    const { wp, req } = await setup();
    req.m = Object.fromEntries(Array.from({ length: 1001 }, (_, id) => [id, () => {}]));
    req.m[0] = function (_mod: any, _exports: any, require: any) { require.e(123); require.e(456); };
    req.e = vi.fn((id: string) => { if (id === "123") throw new Error("missing chunk"); return Promise.resolve(); });
    const loading = wp.forceLoadAllChunks();
    let atFirstTask = 0;
    setTimeout(() => { atFirstTask = req.calls ?? 0; }, 0);
    await vi.runAllTimersAsync();
    await expect(loading).resolves.toBeUndefined();
    expect(req.e).toHaveBeenCalledWith("456");
    expect(atFirstTask).toBeLessThan(1001);
    expect(req.calls).toBe(1001);
  });
  it("preserves factory this/return and does not collect exports from auxiliary runtimes", async () => {
    const { wp, req, chunk } = await setup();
    const modules = { a: function (this: any, mod: any) { mod.exports = this; return 7; } };
    chunk.push([[1], modules]);
    const live = { live: true };
    expect((modules.a as any).call(live, {}, {}, req)).toBe(7);
    expect(wp.findByProps("live")).toBe(live);
    const auxiliary: any = () => undefined;
    auxiliary.m = {};
    auxiliary.c = {};
    const waiter = vi.fn();
    wp.waitFor(wp.byProps("auxiliary"), waiter);
    (modules.a as any).call({ auxiliary: true }, {}, {}, auxiliary);
    expect(wp.findByProps("auxiliary")).toBeUndefined();
    expect(waiter).not.toHaveBeenCalled();
  });

  it("BD find-all and prototype queries use captured exports without a global require", async () => {
    const { req } = await setup();
    class Component { render() {} }
    const a = { marker: 1 };
    const b = { marker: 2 };
    req.c = { 1: { exports: { Z: a, Q: b } }, 2: { exports: { Z: Component } }, 3: { exports: { Z: a } } };
    const { buildWebpack } = await import("../../src/renderer/api/bd-api");
    const bd = buildWebpack();
    expect(bd.getModule((v: any) => v?.marker, { first: false })).toEqual([a, b]);
    expect(bd.getByPrototypeKeys("render")).toBe(Component);
    expect(await bd.waitForModule((v: any) => v === a)).toBe(a);
  });

  it("cancels waiters and resolves active waits on a newly evaluated module", async () => {
    const { wp, req, chunk } = await setup();
    const cancelled = vi.fn();
    wp.waitFor(wp.byProps("late"), cancelled)();
    const active = vi.fn();
    wp.waitFor(wp.byProps("late"), active);
    const module = { late: true };
    const factories = { a: (mod: any) => { mod.exports = { Z: module }; } };
    chunk.push([[1], factories]);
    (factories.a as any)({}, {}, req);
    expect(cancelled).not.toHaveBeenCalled();
    expect(active).toHaveBeenCalledWith(module);
  });

  it("scopes mangled mappings to the selected module", async () => {
    const { req } = await setup();
    const decoy = () => 1;
    const wanted = () => 2;
    const module = { marker: "target", A: wanted, B: 42 };
    req.c = { 1: { exports: { A: decoy } }, 2: { exports: module } };
    const { buildWebpack } = await import("../../src/renderer/api/bd-api");
    expect(buildWebpack().getMangled((m: any) => m === module, {
      action: (v: any) => typeof v === "function", value: (v: any) => typeof v === "number",
    })).toEqual({ action: wanted, value: 42 });
  });

  it("passes the actual patched receiver to BetterDiscord callbacks", async () => {
    await setup();
    const { buildPatcher } = await import("../../src/renderer/api/bd-api");
    const patcher = buildPatcher();
    const obj = { value: 5, method(n: number) { return this.value + n; } };
    const receivers: any[] = [];
    patcher.before("bd-context", obj, "method", (ctx: any) => { receivers.push(ctx); });
    patcher.after("bd-context", obj, "method", (ctx: any) => { receivers.push(ctx); });
    patcher.instead("bd-context", obj, "method", (ctx: any, args: any[], orig: any) => { receivers.push(ctx); return orig(...args); });
    expect(obj.method(2)).toBe(7);
    expect(receivers).toEqual([obj, obj, obj]);
    patcher.unpatchAll("bd-context");
  });
});
