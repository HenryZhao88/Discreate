import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginManager, wrapBdInstance } from "../../src/renderer/core/plugins";
import { SettingsStore } from "../../src/renderer/core/settings";
import { after, unpatchAll } from "../../src/renderer/core/patcher";
const pending = vi.hoisted(() => new Set<() => void>());
vi.mock("../../src/renderer/core/webpack", () => ({
  findStore: () => undefined,
  byStoreName: () => () => true,
  waitFor: (_: unknown, cb: () => void) => { pending.add(cb); return () => pending.delete(cb); },
}));
afterEach(() => { pending.clear(); unpatchAll("broken"); });

describe("plugin lifecycle", () => {
  it("cleans up partial starts and clears the enabled flag", () => {
    const settings = new SettingsStore({ read: () => null, write() {} });
    const manager = new PluginManager(settings);
    const obj = { value: () => 1 };
    const stop = vi.fn();
    manager.register("broken", {
      name: "broken", description: "", stop,
      start() { after("broken", obj, "value", () => 2); throw new Error("failed"); },
    });
    manager.setEnabled("broken", true);
    expect(obj.value()).toBe(1);
    expect(stop).toHaveBeenCalledOnce();
    expect(manager.isEnabled("broken")).toBe(false);
  });

  it("rejects duplicate IDs so a user plugin cannot shadow a builtin", () => {
    const manager = new PluginManager(new SettingsStore({ read: () => null, write() {} }));
    const plugin = { name: "x", description: "", start() {}, stop() {} };
    manager.register("x", plugin);
    expect(() => manager.register("x", plugin, "user")).toThrow("already registered");
    expect(manager.all()).toHaveLength(1);
  });

  it("cancels deferred BD startup and only starts the latest enable", () => {
    const instance = { start: vi.fn(), stop: vi.fn() };
    const plugin = wrapBdInstance(instance, { name: "bd", description: "", version: "1", author: "" });
    const ctx = { id: "bd", options: {}, saveOptions() {} };
    plugin.start(ctx);
    plugin.stop(ctx);
    expect(pending.size).toBe(0);
    expect(instance.start).not.toHaveBeenCalled();
    plugin.start(ctx);
    for (const cb of pending) cb();
    expect(instance.start).toHaveBeenCalledOnce();
    plugin.stop(ctx);
    expect(instance.stop).toHaveBeenCalledOnce();
  });
});
