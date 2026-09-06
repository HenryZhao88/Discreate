// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectSettings } from "../../src/renderer/ui/inject-settings";
import { PluginManager } from "../../src/renderer/core/plugins";
import { ThemeManager } from "../../src/renderer/core/themes";
import { SettingsStore } from "../../src/renderer/core/settings";

function mount() {
  (window as any).DiscreateNative = { root: "/fixture", writeText() {}, readDeletedLog: () => null };
  const settings = new SettingsStore({ read: () => null, write() {} });
  injectSettings({ settings, plugins: new PluginManager(settings), themes: new ThemeManager(settings) });
}
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); document.head.replaceChildren(); delete (window as any).DiscreateNative; });

describe("settings UI lifecycle", () => {
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
});
