import { describe, it, expect } from "vitest";
import { SettingsStore } from "../../src/renderer/core/settings";

function memoryBackend() {
  let data: string | null = null;
  return {
    read: () => data,
    write: (d: string) => { data = d; },
    get raw() { return data; },
  };
}

describe("SettingsStore", () => {
  it("returns defaults when storage is empty", () => {
    const store = new SettingsStore(memoryBackend());
    expect(store.isPluginEnabled("anything")).toBe(false);
    expect(store.getEnabledThemes()).toEqual([]);
  });

  it("persists plugin enable state", () => {
    const backend = memoryBackend();
    const store = new SettingsStore(backend);
    store.setPluginEnabled("viewDeletedMessages", true);
    expect(store.isPluginEnabled("viewDeletedMessages")).toBe(true);
    expect(backend.raw).toContain("viewDeletedMessages");
  });

  it("reloads persisted state into a new store instance", () => {
    const backend = memoryBackend();
    new SettingsStore(backend).setEnabledThemes(["midnight.css"]);
    const reloaded = new SettingsStore(backend);
    expect(reloaded.getEnabledThemes()).toEqual(["midnight.css"]);
  });

  it("stores and retrieves per-plugin option objects", () => {
    const backend = memoryBackend();
    const store = new SettingsStore(backend);
    store.setPluginOptions("viewDeletedMessages", { redHighlight: false });
    expect(store.getPluginOptions("viewDeletedMessages")).toEqual({ redHighlight: false });
  });
});
