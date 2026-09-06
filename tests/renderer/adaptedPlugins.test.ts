import { describe, expect, it } from "vitest";
import { isGuildOwner } from "../../src/renderer/plugins/forceOwnerCrown/index";
import { countVisibleVoiceUsers, sumOnlineGroups, sumThreadSections } from "../../src/renderer/plugins/memberCount/index";
import { missingKeys, parseSnapshot, serializeSnapshot } from "../../src/renderer/plugins/relationshipNotifier/index";
import { guildHasInvitesPaused, permissionIncludes as hiddenThingsPermissionIncludes } from "../../src/renderer/plugins/showHiddenThings/index";
import { shouldRevealHiddenChannel } from "../../src/renderer/plugins/showHiddenChannels/index";

describe("ForceOwnerCrown helpers", () => {
  it("matches the user id against the guild owner id", () => {
    expect(isGuildOwner({ ownerId: "u1" }, "u1")).toBe(true);
    expect(isGuildOwner({ ownerId: "u1" }, "u2")).toBe(false);
  });
});

describe("MemberCount helpers", () => {
  it("sums online groups while ignoring offline and unknown buckets", () => {
    expect(sumOnlineGroups([
      { id: "online", count: 4 },
      { id: "idle", count: 2 },
      { id: "offline", count: 10 },
      { id: "unknown", count: 99 },
    ])).toBe(6);
  });

  it("sums thread sections while ignoring offline users", () => {
    expect(sumThreadSections({
      online: { sectionId: "online", userIds: ["1", "2"] },
      offline: { sectionId: "offline", userIds: ["3"] },
    })).toBe(2);
  });

  it("counts only voice states in visible channels", () => {
    expect(countVisibleVoiceUsers(
      { a: { channelId: "c1" }, b: { channelId: "c2" }, c: {} },
      (id) => ({ id }),
      (channel) => channel.id === "c1",
    )).toBe(1);
  });
});

describe("RelationshipNotifier snapshot helpers", () => {
  it("round-trips snapshots and tolerates corrupt input", () => {
    const snapshot = {
      guilds: { g1: { id: "g1", name: "Guild" } },
      groups: { c1: { id: "c1", name: "Group" } },
      friends: { friends: ["u1"], requests: ["u2"] },
    };
    expect(parseSnapshot(serializeSnapshot(snapshot))).toEqual(snapshot);
    expect(parseSnapshot("{bad")).toEqual({ guilds: {}, groups: {}, friends: { friends: [], requests: [] } });
  });

  it("detects keys that disappeared from a later snapshot", () => {
    expect(missingKeys({ a: 1, b: 2 }, { b: 2 })).toEqual([1]);
  });
});

describe("ShowHiddenThings helpers", () => {
  it("checks bigint permission masks and paused invite features", () => {
    expect(hiddenThingsPermissionIncludes(1n << 40n, 1n << 40n)).toBe(true);
    expect(hiddenThingsPermissionIncludes(0n, 1n << 40n)).toBe(false);
    expect(guildHasInvitesPaused({ features: ["INVITES_DISABLED"] })).toBe(true);
  });
});

describe("ShowHiddenChannels helpers", () => {
  it("reveals only guild channels denied by VIEW_CHANNEL", () => {
    const channel = { id: "c1", guild_id: "g1" };
    expect(shouldRevealHiddenChannel(1n << 10n, false, channel)).toBe(true);
    expect(shouldRevealHiddenChannel(1n << 10n, true, channel)).toBe(false);
    expect(shouldRevealHiddenChannel(1n << 20n, false, channel)).toBe(false);
    expect(shouldRevealHiddenChannel((1n << 10n) | (1n << 11n), false, channel)).toBe(false);
    expect(shouldRevealHiddenChannel(1n << 10n, false, { id: "dm1" })).toBe(false);
  });
});
