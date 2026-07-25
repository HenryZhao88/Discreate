import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Regression tests for the boot freeze / sustained lag.
 *
 * The renderer's own freeze detector recorded an 84-second main-thread block
 * starting the moment plugins started. Two O(modules x modules) loops caused
 * it, and both are cheap to assert against: they show up as repeated
 * enumeration of the webpack runtime's `m` (factory map) and `c` (module
 * cache). We count those enumerations directly.
 */

/** Fresh module registry per test — webpack.ts holds global runtime state. */
async function freshWebpack() {
  vi.resetModules();
  return import("../../src/renderer/core/webpack");
}

/** A fake `__webpack_require__` that counts how often `m` and `c` are read. */
function makeRuntime(opts: { factories: number; cached: number }) {
  const counts = { m: 0, c: 0 };

  const m: Record<string, any> = {};
  for (let i = 0; i < opts.factories; i++) m[i] = function () { return i; };

  const c: Record<string, any> = {};
  for (let i = 0; i < opts.cached; i++) {
    c[i] = { exports: { a: { x: 1 }, b: { y: 2 }, d: { z: 3 } } };
  }
  // The store lives near the end so a full scan is required to reach it.
  const channelStore = { getName: () => "ChannelStore", getChannel: () => null };
  c[opts.cached - 1] = { exports: { Z: channelStore } };

  const require: any = function (id: string) { return c[id]?.exports; };
  Object.defineProperty(require, "c", { get() { counts.c++; return c; } });
  require.e = () => Promise.resolve();
  require.p = "/assets/";

  return { require, counts, channelStore, factories: m, mCounter: () => counts.m, m };
}

/**
 * Install the runtime by assigning `.m`, which is what
 * `installWebpackInstanceCapture` hooks. The assignment is counted so we can
 * see how often the runtime gets re-scored.
 */
function installRuntime(rt: ReturnType<typeof makeRuntime>) {
  Object.defineProperty(rt.require, "m", {
    configurable: true,
    enumerable: true,
    get() { rt.counts.m++; return rt.m; },
  });
}

describe("webpack runtime registration cost", () => {
  let previousWindow: any;

  beforeEach(() => {
    previousWindow = (globalThis as any).window;
  });

  it("does not re-score the runtime on every module factory call", async () => {
    const wp = await freshWebpack();
    const rt = makeRuntime({ factories: 3000, cached: 50 });

    const chunk: any[] = [];
    const pushed: any[] = [];
    chunk.push = ((item: any) => { pushed.push(item); return 1; }) as any;
    (globalThis as any).window = { webpackChunkdiscord_app: chunk };

    try {
      wp.initWebpack();
      installRuntime(rt);

      // Discord pushes a chunk of 2000 modules, then webpack evaluates each
      // one. Every evaluation runs our wrapped factory.
      const modules: Record<string, any> = {};
      for (let i = 0; i < 2000; i++) modules[i] = function () { /* module body */ };
      (window as any).webpackChunkdiscord_app.push([["c1"], modules]);

      const wrapped = pushed[pushed.length - 1][1];
      rt.counts.m = 0;
      for (const id of Object.keys(wrapped)) {
        wrapped[id]({ exports: {} }, {}, rt.require);
      }

      // Before the fix this was ~2 reads per factory call (4000+), each one an
      // Object.keys() over the full 3000-entry factory map, plus 4 setTimeouts
      // queued per call. The runtime only needs scoring when it is new.
      expect(rt.counts.m).toBeLessThan(50);
    } finally {
      (globalThis as any).window = previousWindow;
    }
  });

  it("schedules re-score timers once per runtime, not once per factory", async () => {
    vi.useFakeTimers();
    const wp = await freshWebpack();
    const rt = makeRuntime({ factories: 3000, cached: 50 });

    const chunk: any[] = [];
    const pushed: any[] = [];
    chunk.push = ((item: any) => { pushed.push(item); return 1; }) as any;
    (globalThis as any).window = { webpackChunkdiscord_app: chunk };

    try {
      wp.initWebpack();
      installRuntime(rt);

      const modules: Record<string, any> = {};
      for (let i = 0; i < 1000; i++) modules[i] = function () { /* body */ };
      (window as any).webpackChunkdiscord_app.push([["c1"], modules]);
      const wrapped = pushed[pushed.length - 1][1];

      for (const id of Object.keys(wrapped)) {
        wrapped[id]({ exports: {} }, {}, rt.require);
      }

      // 1000 factory calls x 4 delays = 4000 pending timers before the fix.
      expect(vi.getTimerCount()).toBeLessThanOrEqual(4);
    } finally {
      vi.useRealTimers();
      (globalThis as any).window = previousWindow;
    }
  });
});

describe("findStore lookup cost", () => {
  let previousWindow: any;

  beforeEach(() => {
    previousWindow = (globalThis as any).window;
  });

  it("resolves a store once and reuses it on later calls", async () => {
    const wp = await freshWebpack();
    const rt = makeRuntime({ factories: 10, cached: 4000 });

    const chunk: any[] = [];
    chunk.push = ((item: any) => { item[2]?.(rt.require); return 1; }) as any;
    (globalThis as any).window = { webpackChunkdiscord_app: chunk };

    try {
      wp.initWebpack();
      installRuntime(rt);
      await wp.waitForMainWebpack(50);

      expect(wp.findStore("ChannelStore")).toBe(rt.channelStore);

      // PermissionStore.can is patched by showHiddenChannels and runs tens of
      // thousands of times during Discord's first render. Each call used to
      // re-enumerate the entire module cache.
      rt.counts.c = 0;
      for (let i = 0; i < 5000; i++) {
        expect(wp.findStore("ChannelStore")).toBe(rt.channelStore);
      }
      expect(rt.counts.c).toBe(0);
    } finally {
      (globalThis as any).window = previousWindow;
    }
  });

  it("does not cache a miss, so a late-loading store is still found", async () => {
    const wp = await freshWebpack();
    const rt = makeRuntime({ factories: 10, cached: 200 });

    const chunk: any[] = [];
    chunk.push = ((item: any) => { item[2]?.(rt.require); return 1; }) as any;
    (globalThis as any).window = { webpackChunkdiscord_app: chunk };

    try {
      wp.initWebpack();
      installRuntime(rt);
      await wp.waitForMainWebpack(50);

      expect(wp.findStore("GuildStore")).toBeUndefined();

      const guildStore = { getName: () => "GuildStore", getGuild: () => null };
      (rt.require as any)("0"); // touch the cache
      const c = (rt.require as any).c;
      c[0] = { exports: { Z: guildStore } };

      expect(wp.findStore("GuildStore")).toBe(guildStore);
    } finally {
      (globalThis as any).window = previousWindow;
    }
  });
});
