// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import memberCount from "../../src/renderer/plugins/memberCount/index";
import hiddenThings from "../../src/renderer/plugins/showHiddenThings/index";
import ownerCrown from "../../src/renderer/plugins/forceOwnerCrown/index";
import hiddenChannels from "../../src/renderer/plugins/showHiddenChannels/index";
import { editHistory } from "../../src/renderer/plugins/viewDeletedMessages/log";
import { startDomLayer, stopDomLayer, markDeleted } from "../../src/renderer/plugins/viewDeletedMessages/domLayer";
import { unpatchAll } from "../../src/renderer/core/patcher";

const stores = vi.hoisted(() => ({} as Record<string, any>));
vi.mock("../../src/renderer/core/webpack", () => ({ findStore: (name: string) => stores[name] }));
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
const ctx = { id: "test", options: {}, saveOptions() {} };

async function frame() {
  await Promise.resolve();
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((fn) => fn(0));
  await Promise.resolve();
}

beforeEach(() => {
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++nextFrame, fn); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  document.body.innerHTML = '<aside class="membersWrap_test"></aside><a href="/channels/1" style="position:static"></a><li id="chat-messages-1-2"><div class="messageContent_test">Hello</div></li>';
  Object.assign(stores, {
    SelectedChannelStore: { getChannelId: () => "2" },
    ChannelStore: { getChannel: () => ({ guild_id: "1" }) },
    GuildStore: { getGuilds: () => ({ "1": { features: ["INVITES_DISABLED"] } }), getGuild: () => ({ memberCount: 10 }) },
  });
});

afterEach(() => {
  for (const plugin of [memberCount, hiddenThings, ownerCrown, hiddenChannels]) plugin.stop(ctx);
  for (const id of ["memberCount", "showHiddenThings", "showHiddenChannels"]) unpatchAll(id);
  stopDomLayer();
  editHistory.clear();
  for (const key of Object.keys(stores)) delete stores[key];
  document.head.replaceChildren();
  vi.unstubAllGlobals();
});

describe("DOM observers settle and stop", () => {
  it("hidden-channel icons and lock screen settle after rendering", async () => {
    const channel = { id: "2", guild_id: "1", name: "hidden", type: 0 };
    stores.ChannelStore = { getChannel: () => channel };
    stores.PermissionStore = { can: () => false };
    document.body.insertAdjacentHTML("beforeend", '<a href="/channels/1/2">hidden</a><main></main>');
    hiddenChannels.start(ctx);
    stores.PermissionStore.can(1024n, channel);
    expect(stores.PermissionStore.can(1024n | 2048n, channel)).toBe(false);
    for (let i = 0; i < 5; i++) await frame();
    expect(document.querySelector("#discreate-hidden-channel-lock")).not.toBeNull();
    expect(document.querySelector(".discreate-hidden-channel-icon")).not.toBeNull();
    expect(frames.size).toBe(0);
  });
  it("moderator affordances do not make combined permission checks pass", () => {
    stores.PermissionStore = { canManageUser: () => false };
    hiddenThings.start(ctx);
    expect(stores.PermissionStore.canManageUser(1n << 40n)).toBe(true);
    expect(stores.PermissionStore.canManageUser((1n << 40n) | 8n)).toBe(false);
  });
  it.each(["can", "canWithPartialContext"])("keeps hidden status when %s delegates to another patched permission method", async (outer) => {
    const channel = { id: "2", guild_id: "1", name: "hidden", type: 0 };
    stores.ChannelStore = { getChannel: () => channel };
    const inner = outer === "can" ? "canWithPartialContext" : "can";
    stores.PermissionStore = {
      [outer](permission: bigint, ch: any) { return this[inner](permission, ch); },
      [inner]: () => false,
    };
    document.body.insertAdjacentHTML("beforeend", '<a href="/channels/1/2">hidden</a><main></main>');
    hiddenChannels.start(ctx);
    expect(stores.PermissionStore[outer](1024n, channel)).toBe(true);
    for (let i = 0; i < 4; i++) await frame();
    expect(document.querySelector("#discreate-hidden-channel-lock")).not.toBeNull();
    expect(document.querySelector(".discreate-hidden-channel-icon")).not.toBeNull();
    expect(frames.size).toBe(0);
  });

  it("does not reveal a nested VIEW_CHANNEL check inside a combined permission query", () => {
    const channel = { id: "2", guild_id: "1" };
    stores.PermissionStore = {
      can(permission: bigint, ch: any) { return this.canWithPartialContext(1024n, ch); },
      canWithPartialContext: () => false,
    };
    hiddenChannels.start(ctx);
    expect(stores.PermissionStore.can(1024n | 2048n, channel)).toBe(false);
  });

  it("restores chat positioning when a hidden channel becomes visible and when disabled", async () => {
    let allowed = false;
    const channel = { id: "2", guild_id: "1" };
    stores.ChannelStore = { getChannel: () => channel };
    stores.PermissionStore = { can: () => allowed };
    document.body.insertAdjacentHTML("beforeend", '<main style="position:static"></main>');
    const main = document.querySelector("main")!;
    hiddenChannels.start(ctx);
    await frame();
    expect(main.style.position).toBe("relative");
    allowed = true;
    document.body.appendChild(document.createElement("div"));
    await frame();
    expect(main.style.position).toBe("static");
    allowed = false;
    document.body.appendChild(document.createElement("div"));
    await frame();
    expect(main.style.position).toBe("relative");
    hiddenChannels.stop(ctx);
    expect(main.style.position).toBe("static");
  });
  it.each([memberCount, hiddenThings])("$name does not trigger endless updates from its own mutations", async (plugin) => {
    plugin.start(ctx);
    document.body.appendChild(document.createElement("div"));
    for (let i = 0; i < 4; i++) await frame();
    expect(frames.size).toBe(0);
  });

  it("edit markers settle after one update", async () => {
    editHistory.set("2", [{ time: 1, content: "old" }]);
    startDomLayer();
    document.body.appendChild(document.createElement("div"));
    for (let i = 0; i < 4; i++) await frame();
    expect(frames.size).toBe(0);
    expect(document.querySelector(".discreate-ml-edit-marker")?.textContent).toBe("(edited ×1)");
  });

  it.each([memberCount, hiddenThings, ownerCrown, hiddenChannels])("$name cancels updates when stopped", async (plugin) => {
    plugin.start(ctx);
    document.body.appendChild(document.createElement("div"));
    await Promise.resolve();
    expect(frames.size).toBeGreaterThan(0);
    plugin.stop(ctx);
    expect(frames.size).toBe(0);
  });

  it("Message Logger cancels pending augmentation on stop", () => {
    startDomLayer();
    markDeleted("1", "2");
    expect(frames.size).toBe(1);
    stopDomLayer();
    expect(frames.size).toBe(0);
  });
});
