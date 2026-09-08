// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installBdApi } from "../../src/renderer/api/bd-api";
import { loadUserPlugins, PluginManager } from "../../src/renderer/core/plugins";
import { SettingsStore } from "../../src/renderer/core/settings";

vi.mock("../../src/renderer/core/webpack", () => ({ findByProps: () => undefined, findStore: () => ({}) }));
afterEach(() => { document.head.replaceChildren(); delete (window as any).DiscreateNative; delete (window as any).BdApi; });

describe("BetterDiscord plugin entry points", () => {
  it("supports scoped API instances while retaining the static API", () => {
    const files = new Map<string, string>();
    (window as any).DiscreateNative = { root: "/fixture", readText: (p: string) => files.get(p), writeText: (p: string, value: string) => files.set(p, value) };
    const BdApi = installBdApi();
    const a = new BdApi("Plugin A");
    const b = new BdApi("Plugin B");
    a.Data.save("enabled", true);
    expect(BdApi.Data.load("Plugin A", "enabled")).toBe(true);
    expect(b.Data.load("enabled")).toBeUndefined();
    expect(new BdApi("Plugin A")).toBe(a);
    expect(new BdApi()).toBe(BdApi);
    a.DOM.addStyle("body { color: red }");
    b.DOM.addStyle("body { color: blue }");
    a.DOM.removeStyle();
    expect(document.head.textContent).toBe("body { color: blue }");
    const target = { method: () => 1 };
    a.Patcher.after(target, "method", (_ctx: any, _args: any[], value: number) => value + 1);
    b.Patcher.after(target, "method", (_ctx: any, _args: any[], value: number) => value * 2);
    expect(target.method()).toBe(4);
    a.Patcher.unpatchAll();
    expect(target.method()).toBe(2);
    b.Patcher.unpatchAll();
    expect(target.method()).toBe(1);
  });

  it.each([
    'class { constructor(meta) { this.meta = meta; } start() { BdApi.Data.save(this.meta.name, "version", this.meta.version); } stop() {} }',
    '(meta) => ({ start() { BdApi.Data.save(meta.name, "version", meta.version); }, stop() {} })',
  ])("passes metadata to class and factory exports", (exported) => {
    const files = new Map<string, string>([["/fixture/plugins/test.plugin.js", `/**\n * @name TestPlugin\n * @version 2.3.4\n */\nmodule.exports = ${exported};`]]);
    (window as any).DiscreateNative = {
      root: "/fixture", pluginsDir: "/fixture/plugins", listDir: () => ["test.plugin.js"],
      readText: (p: string) => files.get(p) ?? null, writeText: (p: string, v: string) => files.set(p, v),
    };
    const BdApi = installBdApi();
    const manager = new PluginManager(new SettingsStore({ read: () => null, write() {} }));
    loadUserPlugins(manager);
    expect(manager.all()).toHaveLength(1);
    manager.setEnabled("test", true);
    expect(BdApi.Data.load("TestPlugin", "version")).toBe("2.3.4");
    manager.setEnabled("test", false);
  });
});
