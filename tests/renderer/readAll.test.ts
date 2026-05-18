import { describe, it, expect } from "vitest";
import { collectUnreadChannels } from "../../src/renderer/plugins/readAll/index";

function fixtureStores() {
  return {
    GuildStore: { getGuilds: () => ({ g1: { id: "g1" } }) },
    GuildChannelStore: {
      getChannels: (_g: string) => ({
        SELECTABLE: [{ channel: { id: "c1" } }, { channel: { id: "c2" } }],
        VOCAL: [{ channel: { id: "v1" } }],
      }),
    },
    ActiveJoinedThreadsStore: { getActiveJoinedThreadsForGuild: (_g: string) => ({}) },
    ReadStateStore: {
      hasUnread: (id: string) => id === "c1" || id === "v1",
      lastMessageId: (id: string) => `last-${id}`,
    },
  };
}

describe("collectUnreadChannels", () => {
  it("returns BULK_ACK entries only for unread channels", () => {
    expect(collectUnreadChannels(fixtureStores())).toEqual([
      { channelId: "c1", messageId: "last-c1", readStateType: 0 },
      { channelId: "v1", messageId: "last-v1", readStateType: 0 },
    ]);
  });

  it("returns an empty list when nothing is unread", () => {
    const stores = fixtureStores();
    stores.ReadStateStore.hasUnread = () => false;
    expect(collectUnreadChannels(stores)).toEqual([]);
  });
});
