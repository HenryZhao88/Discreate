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
let notify: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  writes = vi.fn();
  notify = vi.fn();
  (window as any).BdApi = { UI: { showNotification: notify } };
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
  delete (window as any).DiscreateNative;
  delete (window as any).BdApi;
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
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Former Guild") }));
    expect(writes).toHaveBeenCalledOnce();
  });

  it("does not infer removals or overwrite history when stores are missing", async () => {
    delete stores.GuildStore;
    plugin.start(ctx);
    await vi.advanceTimersByTimeAsync(5000);
    expect(notify).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it("does not send a delayed notification after the plugin stops", async () => {
    let resolveUser!: (user: any) => void;
    stores.UserUtils = { getUser: () => new Promise((resolve) => { resolveUser = resolve; }) };
    stores.RelationshipStore = { getRelationships: () => ({ friend: 1 }) };
    plugin.start(ctx);
    await vi.advanceTimersByTimeAsync(5000);
    notify.mockClear();
    Discreate.FluxDispatcher.dispatch({ type: "RELATIONSHIP_REMOVE", relationship: { id: "friend", type: 1 } });
    plugin.stop(ctx);
    resolveUser({ username: "Friend" });
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
  });
});
