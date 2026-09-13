// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectSettings } from "../../src/renderer/ui/inject-settings";
import { PluginManager } from "../../src/renderer/core/plugins";
import { ThemeManager } from "../../src/renderer/core/themes";
import { SettingsStore } from "../../src/renderer/core/settings";
import { Discreate } from "../../src/renderer/api/index";

function mount(bridge: Record<string, any> = {}) {
  (window as any).DiscreateNative = {
    root: "/fixture", pluginsDir: "/fixture/plugins", themesDir: "/fixture/themes",
    writeText() {}, readDeletedLog: () => null, listDir: () => [], ...bridge,
  };
  const settings = new SettingsStore({ read: () => null, write() {} });
  injectSettings({ settings, plugins: new PluginManager(settings), themes: new ThemeManager(settings) });
}
afterEach(() => { vi.restoreAllMocks(); Discreate.ReactDOM = undefined; document.body.replaceChildren(); document.head.replaceChildren(); delete (window as any).DiscreateNative; });

describe("settings UI lifecycle", () => {
  it("mounts plugin settings and unmounts them before switching tabs", () => {
    mount();
    const settings = new SettingsStore({ read: () => null, write() {} });
    const plugins = new PluginManager(settings);
    const panel = { type: "panel" };
    plugins.register("test", { name: "Test", description: "", start() {}, stop() {}, getSettingsPanel: () => panel });
    plugins.setEnabled("test", true);
    const reactRoot = { render: vi.fn(), unmount: vi.fn() };
    Discreate.ReactDOM = { createRoot: vi.fn(() => reactRoot) };
    injectSettings({ settings, plugins, themes: new ThemeManager(settings) });
    [...document.querySelectorAll<HTMLButtonElement>(".dc-row button")].find((b) => b.textContent === "Settings")!.click();
    expect(reactRoot.render).toHaveBeenCalledWith(panel);
    document.querySelector<HTMLButtonElement>('[data-tab="themes"]')!.click();
    expect(reactRoot.unmount).toHaveBeenCalledOnce();
  });
  it("does not append a stale message log after switching tabs", async () => {
    mount();
    document.querySelector<HTMLButtonElement>('[data-tab="messagelog"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-tab="plugins"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector(".dc-body")?.textContent).not.toContain("No logged messages yet.");
    expect(document.querySelector(".dc-body")?.textContent).toContain("No plugins.");
  });
  it("removes the previous keyboard handler on remount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    mount();
    const handler = add.mock.calls.find(([event]) => event === "keydown")![1];
    mount();
    expect(remove).toHaveBeenCalledWith("keydown", handler, true);
    expect(document.querySelectorAll("#discreate-modal-root")).toHaveLength(1);
  });

  it.each(["plugins", "themes"])("installs %s using an input form without Electron's unsupported prompt", async (tab) => {
    const prompt = vi.spyOn(window, "prompt").mockImplementation(() => { throw new Error("prompt() is not supported."); });
    const downloadToFolder = vi.fn().mockResolvedValue(tab === "themes" ? "theme.css" : "test.plugin.js");
    mount({ downloadToFolder });
    document.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)!.click();
    [...document.querySelectorAll<HTMLButtonElement>(".dc-toolbar button")].find((b) => b.textContent === "Install from URL…")!.click();
    const form = document.querySelector<HTMLFormElement>(".dc-install-form")!;
    expect(form).not.toBeNull();
    form.querySelector("input")!.value = "https://example.test/addon";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector(".dc-body")?.textContent).toContain("Installed"));
    expect(downloadToFolder).toHaveBeenCalledWith("https://example.test/addon", `/fixture/${tab}`);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("shows download errors and permits a retry without closing the form", async () => {
    const downloadToFolder = vi.fn().mockRejectedValueOnce(new Error("HTTP 404")).mockResolvedValueOnce("ok.plugin.js");
    mount({ downloadToFolder });
    [...document.querySelectorAll<HTMLButtonElement>(".dc-toolbar button")].find((b) => b.textContent === "Install from URL…")!.click();
    const form = document.querySelector<HTMLFormElement>(".dc-install-form")!;
    expect(form).not.toBeNull();
    form.querySelector("input")!.value = "https://example.test/plugin.js";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(form.textContent).toContain("HTTP 404"));
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector(".dc-body")?.textContent).toContain("Installed ok.plugin.js"));
    expect(downloadToFolder).toHaveBeenCalledTimes(2);
  });

  it("ignores an update result from a previous mount", async () => {
    let resolve!: (body: string) => void;
    mount({ readInstalled: () => '{"commit":"old"}', fetchText: () => new Promise<string>((r) => { resolve = r; }) });
    mount({ readInstalled: () => '{"commit":"current"}', fetchText: () => Promise.resolve('{"sha":"current"}') });
    await Promise.resolve();
    resolve('{"sha":"new"}');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("discreate-update-overlay")).toBeNull();
  });
});
