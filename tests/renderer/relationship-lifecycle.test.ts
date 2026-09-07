// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../../src/renderer/plugins/relationshipNotifier/index";
import { Discreate } from "../../src/renderer/api/index";
import { unpatchAll } from "../../src/renderer/core/patcher";
const stores = vi.hoisted(() => ({} as Record<string, any>));
vi.mock("../../src/renderer/core/webpack", () => ({
  findStore: (name: string) => stores[name],
  findByProps: (name: string) => name === "getUser" ? stores.UserUtils : undefined,
}));
const ctx = { id: "relationshipNotifier", options: { offlineRemovals: true, notices: false }, saveOptions() {} };
let writes: ReturnType<typeof vi.fn>;
// Notifications are delivered as our own DOM toasts (`.dc-rn-toast`), never
// through Discord's internal notification module (which could hang the renderer).
const toasts = () => [...document.querySelectorAll(".dc-rn-toast")].map((n) => n.textContent ?? "");
beforeEach(() => {
  vi.useFakeTimers();
  writes = vi.fn();
  (window as any).DiscreateNative = { root: "/fixture", readText: () => JSON.stringify({
    guilds: { removed: { id: "removed", name: "Former Guild" } }, groups: {}, friends: { friends: [], requests: [] },
  }), writeText: writes };
  Object.assign(stores, {
    UserStore: { getCurrentUser: () => ({ id: "account" }) },
    GuildStore: { getGuilds: () => ({}) },
    ChannelStore: { getSortedPrivateChannels: () => [] },
    RelationshipStore: { getRelationships: () => ({}) },
  });
  Discreate.FluxDispatcher = { dispatch: vi.fn() };
});
afterEach(() => {
  plugin.stop(ctx);
  unpatchAll(ctx.id);
  vi.useRealTimers();
  document.body.replaceChildren();
  delete (window as any).DiscreateNative;
  for (const key of Object.keys(stores)) delete stores[key];
  Discreate.FluxDispatcher = undefined;
});

describe("relationship snapshots", () => {
  it("keeps the persisted baseline through early connection events", async () => {
    plugin.start(ctx);
    Discreate.FluxDispatcher.dispatch({ type: "CONNECTION_OPEN" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    expect(toasts().some((t) => t.includes("Former Guild"))).toBe(true);
    expect(writes).toHaveBeenCalledOnce();
  });

  it("does not infer removals or overwrite history when stores are missing", async () => {
    delete stores.GuildStore;
    plugin.start(ctx);
    await vi.advanceTimersByTimeAsync(5000);
    expect(toasts()).toHaveLength(0);
    expect(writes).not.toHaveBeenCalled();
  });

  it("does not send a delayed notification after the plugin stops", async () => {
    let resolveUser!: (user: any) => void;
    stores.UserUtils = { getUser: () => new Promise((resolve) => { resolveUser = resolve; }) };
    stores.RelationshipStore = { getRelationships: () => ({ friend: 1 }) };
    plugin.start(ctx);
    await vi.advanceTimersByTimeAsync(5000);
    document.body.replaceChildren();
    Discreate.FluxDispatcher.dispatch({ type: "RELATIONSHIP_REMOVE", relationship: { id: "friend", type: 1 } });
    plugin.stop(ctx);
    resolveUser({ username: "Friend" });
    await Promise.resolve();
    expect(toasts()).toHaveLength(0);
  });
});
