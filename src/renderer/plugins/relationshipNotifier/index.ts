import type { DiscreatePlugin, PluginContext } from "../../api/index.js";
import { Discreate } from "../../api/index.js";
import { before } from "../../core/patcher.js";
import { findByProps, findStore } from "../../core/webpack.js";
import { makeLogger } from "../../core/logger.js";
import { native } from "../../core/paths.js";

const OWNER = "relationshipNotifier";
const log = makeLogger("RelationshipNotifier");

const GROUP_DM = 3;
const FRIEND = 1;
const INCOMING_REQUEST = 3;

interface SimpleGuild {
  id: string;
  name: string;
  iconURL?: string;
}

interface SimpleGroupChannel {
  id: string;
  name: string;
  iconURL?: string;
}

export interface RelationshipSnapshot {
  guilds: Record<string, SimpleGuild>;
  groups: Record<string, SimpleGroupChannel>;
  friends: {
    friends: string[];
    requests: string[];
  };
}

interface Options {
  notices: boolean;
  offlineRemovals: boolean;
  friends: boolean;
  friendRequestCancels: boolean;
  servers: boolean;
  groups: boolean;
}

const DEFAULT_OPTIONS: Options = {
  notices: false,
  offlineRemovals: true,
  friends: true,
  friendRequestCancels: true,
  servers: true,
  groups: true,
};

const EMPTY_SNAPSHOT: RelationshipSnapshot = {
  guilds: {},
  groups: {},
  friends: { friends: [], requests: [] },
};

let snapshot: RelationshipSnapshot = { ...EMPTY_SNAPSHOT, friends: { friends: [], requests: [] } };
let options: Options = DEFAULT_OPTIONS;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let manuallyRemovedFriend: string | undefined;
let manuallyRemovedGuild: string | undefined;
let manuallyRemovedGroup: string | undefined;

export function parseSnapshot(raw: string | null): RelationshipSnapshot {
  if (!raw) return { ...EMPTY_SNAPSHOT, friends: { friends: [], requests: [] } };
  try {
    const data = JSON.parse(raw) as Partial<RelationshipSnapshot>;
    return {
      guilds: data.guilds && typeof data.guilds === "object" ? data.guilds : {},
      groups: data.groups && typeof data.groups === "object" ? data.groups : {},
      friends: {
        friends: Array.isArray(data.friends?.friends) ? data.friends!.friends : [],
        requests: Array.isArray(data.friends?.requests) ? data.friends!.requests : [],
      },
    };
  } catch {
    return { ...EMPTY_SNAPSHOT, friends: { friends: [], requests: [] } };
  }
}

export function serializeSnapshot(data: RelationshipSnapshot): string {
  return JSON.stringify(data, null, 2);
}

export function missingKeys<T>(oldItems: Record<string, T>, newItems: Record<string, T>): T[] {
  const missing: T[] = [];
  for (const [id, value] of Object.entries(oldItems)) {
    if (!(id in newItems)) missing.push(value);
  }
  return missing;
}

function mergeOptions(ctx: PluginContext): Options {
  return { ...DEFAULT_OPTIONS, ...(ctx.options as Partial<Options>) };
}

function userId(): string | undefined {
  const UserStore = findStore("UserStore");
  return UserStore?.getCurrentUser?.()?.id;
}

function dataPath(id: string): string {
  return `${native().root}/relationship-notifier-${id}.json`;
}

function readSnapshot(id: string): RelationshipSnapshot {
  return parseSnapshot(native().readText(dataPath(id)));
}

function writeSnapshot(id: string, data: RelationshipSnapshot): void {
  native().writeText(dataPath(id), serializeSnapshot(data));
}

function iconUrl(kind: "guild" | "group", id: string, icon?: string): string | undefined {
  if (!icon) return undefined;
  if (/^https?:\/\//.test(icon)) return icon;
  return kind === "guild"
    ? `https://cdn.discordapp.com/icons/${id}/${icon}.png`
    : `https://cdn.discordapp.com/channel-icons/${id}/${icon}.png`;
}

function collectSnapshot(): RelationshipSnapshot | null {
  const me = userId();
  if (!me) return null;

  const GuildStore = findStore("GuildStore");
  const GuildMemberStore = findStore("GuildMemberStore");
  const ChannelStore = findStore("ChannelStore");
  const RelationshipStore = findStore("RelationshipStore");

  const guilds: Record<string, SimpleGuild> = {};
  for (const [id, guild] of Object.entries<any>(GuildStore?.getGuilds?.() ?? {})) {
    let isMember = true;
    try {
      if (typeof GuildMemberStore?.isMember === "function") {
        isMember = GuildMemberStore.isMember(id, me);
      }
    } catch { /* include guild if the membership helper is unavailable */ }
    if (!isMember) continue;
    guilds[id] = {
      id,
      name: guild.name ?? id,
      iconURL: guild.getIconURL?.() ?? iconUrl("guild", id, guild.icon),
    };
  }

  const groups: Record<string, SimpleGroupChannel> = {};
  for (const channel of ChannelStore?.getSortedPrivateChannels?.() ?? []) {
    if (channel?.type !== GROUP_DM) continue;
    groups[channel.id] = {
      id: channel.id,
      name: channel.name || channel.rawRecipients?.map((r: any) => r.username).join(", ") || "Group DM",
      iconURL: channel.getIconURL?.() ?? iconUrl("group", channel.id, channel.icon),
    };
  }

  const friends = { friends: [] as string[], requests: [] as string[] };
  const relationships = RelationshipStore?.getMutableRelationships?.() ?? RelationshipStore?.getRelationships?.();
  const entries =
    relationships instanceof Map
      ? [...relationships.entries()]
      : Object.entries(relationships ?? {});
  for (const [id, type] of entries) {
    if (type === FRIEND) friends.friends.push(id);
    if (type === INCOMING_REQUEST) friends.requests.push(id);
  }

  return { guilds, groups, friends };
}

function scheduleSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void sync();
  }, 100);
}

async function sync(): Promise<void> {
  const id = userId();
  const next = collectSnapshot();
  if (!id || !next) return;
  snapshot = next;
  try { writeSnapshot(id, snapshot); }
  catch (err) { log.warn("failed to persist snapshot:", err); }
}

function isGuildUnavailable(id: string, actionUnavailable?: boolean): boolean {
  if (actionUnavailable) return true;
  const GuildAvailabilityStore = findStore("GuildAvailabilityStore");
  try { return !!GuildAvailabilityStore?.isUnavailable?.(id); }
  catch { return false; }
}

function showNotice(text: string): void {
  const id = "discreate-relationship-notice";
  document.getElementById(id)?.remove();
  const notice = document.createElement("div");
  notice.id = id;
  notice.textContent = text;
  notice.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
    "background:#5865f2;color:white;padding:10px 16px;text-align:center;" +
    "font:600 14px var(--font-primary,system-ui,sans-serif);box-shadow:0 2px 10px rgba(0,0,0,.35)";
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 8000);
}

function showToast(text: string): void {
  const toast = document.createElement("div");
  toast.textContent = text;
  toast.style.cssText =
    "position:fixed;right:24px;bottom:24px;z-index:2147483647;" +
    "max-width:360px;background:#1e1f22;color:#f2f3f5;padding:12px 14px;" +
    "border:1px solid #2b2d31;border-radius:6px;font:14px/1.35 system-ui,sans-serif;" +
    "box-shadow:0 8px 24px rgba(0,0,0,.45)";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

function notify(text: string, icon?: string, onClick?: () => void): void {
  if (options.notices) showNotice(text);
  const BdApi = (window as any).BdApi;
  try {
    if (BdApi?.UI?.showNotification) {
      BdApi.UI.showNotification({
        title: "Relationship Notifier",
        content: text,
        body: text,
        icon,
        onClick,
      });
      return;
    }
  } catch (err) {
    log.warn("BdApi notification failed:", err);
  }
  showToast(text);
}

function userDisplayName(user: any, fallback: string): string {
  if (!user) return fallback;
  if (typeof user.tag === "string" && user.tag) return user.tag;
  return user.globalName ?? user.username ?? fallback;
}

async function notifyUserRemoval(id: string, message: (name: string) => string): Promise<void> {
  const UserUtils = findByProps("getUser");
  const UserStore = findStore("UserStore");
  let user: any;
  try { user = await UserUtils?.getUser?.(id); }
  catch { user = undefined; }
  user ??= UserStore?.getUser?.(id);
  const icon = user?.getAvatarURL?.(undefined, undefined, false);
  notify(message(userDisplayName(user, id)), icon);
}

function handleRelationshipRemove(action: any): void {
  const relationship = action?.relationship;
  if (!relationship?.id) return;

  const id = relationship.id;
  if (manuallyRemovedFriend === id) {
    manuallyRemovedFriend = undefined;
    return;
  }

  if (relationship.type === FRIEND && options.friends && snapshot.friends.friends.includes(id)) {
    void notifyUserRemoval(id, (name) => `${name} removed you as a friend.`);
  }
  if (
    relationship.type === INCOMING_REQUEST &&
    options.friendRequestCancels &&
    snapshot.friends.requests.includes(id)
  ) {
    void notifyUserRemoval(id, (name) => `A friend request from ${name} has been removed.`);
  }
}

function handleGuildDelete(action: any): void {
  const guild = action?.guild;
  if (!guild?.id || !options.servers) return;
  if (isGuildUnavailable(guild.id, guild.unavailable)) return;
  if (manuallyRemovedGuild === guild.id) {
    manuallyRemovedGuild = undefined;
    return;
  }
  const old = snapshot.guilds[guild.id];
  if (old) notify(`You were removed from the server ${old.name}.`, old.iconURL);
}

function handleChannelDelete(action: any): void {
  const channel = action?.channel;
  if (!channel?.id || channel.type !== GROUP_DM || !options.groups) return;
  if (manuallyRemovedGroup === channel.id) {
    manuallyRemovedGroup = undefined;
    return;
  }
  const old = snapshot.groups[channel.id];
  if (old) notify(`You were removed from the group ${old.name}.`, old.iconURL);
}

function handleAction(action: any): void {
  switch (action?.type) {
    case "GUILD_DELETE":
      handleGuildDelete(action);
      scheduleSync();
      break;
    case "CHANNEL_DELETE":
      handleChannelDelete(action);
      scheduleSync();
      break;
    case "RELATIONSHIP_REMOVE":
      handleRelationshipRemove(action);
      scheduleSync();
      break;
    case "GUILD_CREATE":
    case "CHANNEL_CREATE":
    case "RELATIONSHIP_ADD":
    case "RELATIONSHIP_UPDATE":
    case "CONNECTION_OPEN":
      scheduleSync();
      break;
  }
}

async function syncAndRunChecks(): Promise<void> {
  const id = userId();
  if (!id) return;
  const previous = readSnapshot(id);
  const next = collectSnapshot();
  if (!next) return;

  if (options.offlineRemovals) {
    if (options.groups) {
      for (const group of missingKeys(previous.groups, next.groups)) {
        notify(`You are no longer in the group ${group.name}.`, group.iconURL);
      }
    }
    if (options.servers) {
      for (const guild of missingKeys(previous.guilds, next.guilds)) {
        if (!isGuildUnavailable(guild.id)) {
          notify(`You are no longer in the server ${guild.name}.`, guild.iconURL);
        }
      }
    }
    if (options.friends) {
      for (const id of previous.friends.friends) {
        if (!next.friends.friends.includes(id)) {
          void notifyUserRemoval(id, (name) => `You are no longer friends with ${name}.`);
        }
      }
    }
    if (options.friendRequestCancels) {
      for (const id of previous.friends.requests) {
        if (!next.friends.requests.includes(id) && !next.friends.friends.includes(id)) {
          void notifyUserRemoval(id, (name) => `Friend request from ${name} has been revoked.`);
        }
      }
    }
  }

  snapshot = next;
  writeSnapshot(id, snapshot);
}

function patchManualActions(): void {
  const RelationshipActions = findByProps("removeRelationship");
  if (RelationshipActions && typeof RelationshipActions.removeRelationship === "function") {
    before(OWNER, RelationshipActions, "removeRelationship", (args) => {
      if (args[0]) manuallyRemovedFriend = String(args[0]);
    });
  }

  const GuildActions = findByProps("leaveGuild");
  if (GuildActions && typeof GuildActions.leaveGuild === "function") {
    before(OWNER, GuildActions, "leaveGuild", (args) => {
      if (args[0]) manuallyRemovedGuild = String(args[0]);
    });
  }

  const PrivateChannelActions = findByProps("closePrivateChannel");
  if (PrivateChannelActions && typeof PrivateChannelActions.closePrivateChannel === "function") {
    before(OWNER, PrivateChannelActions, "closePrivateChannel", (args) => {
      if (args[0]) manuallyRemovedGroup = String(args[0]);
    });
  }
}

const plugin: DiscreatePlugin = {
  name: "Relationship Notifier",
  description: "Notifies you when a friend, group chat, or server removes you.",
  authors: ["Vencord contributors", "Discreate"],
  start(ctx) {
    options = mergeOptions(ctx);
    patchManualActions();
    const dispatcher = Discreate.FluxDispatcher;
    if (dispatcher && typeof dispatcher.dispatch === "function") {
      before(OWNER, dispatcher, "dispatch", (args) => handleAction(args[0]));
    } else {
      log.warn("FluxDispatcher unavailable; relationship events will not be live");
    }

    startupTimer = setTimeout(() => {
      startupTimer = null;
      void syncAndRunChecks().catch((err) => log.warn("initial sync failed:", err));
    }, 5000);
    log.log("started");
  },
  stop() {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = null;
    manuallyRemovedFriend = undefined;
    manuallyRemovedGuild = undefined;
    manuallyRemovedGroup = undefined;
    document.getElementById("discreate-relationship-notice")?.remove();
    log.log("stopped");
  },
};

export default plugin;
