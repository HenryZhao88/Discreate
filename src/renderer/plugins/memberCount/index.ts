import type { DiscreatePlugin } from "../../api/index.js";
import { Discreate } from "../../api/index.js";
import { after } from "../../core/patcher.js";
import { findStore } from "../../core/webpack.js";
import { makeLogger } from "../../core/logger.js";

const OWNER = "memberCount";
const log = makeLogger("MemberCount");
const STYLE_ID = "discreate-membercount-style";
const HOST_ID = "discreate-membercount";
const VIEW_CHANNEL = 1n << 10n;

interface GroupCount {
  id: string;
  count: number;
}

interface Stores {
  ChannelStore?: { getChannel(id?: string): any };
  ChannelMemberStore?: { getProps(guildId?: string, channelId?: string): { groups?: GroupCount[] } };
  GuildMemberCountStore?: { getMemberCount(guildId: string): number | undefined };
  GuildStore?: { getGuild(id?: string): any };
  PermissionStore?: { can(permission: bigint, channel: any): boolean };
  SelectedChannelStore?: { getChannelId(): string | undefined };
  ThreadMemberListStore?: { getMemberListSections(channelId?: string): Record<string, { sectionId: string; userIds: string[] }> | undefined };
  VoiceStateStore?: { getVoiceStates(guildId?: string): Record<string, { channelId?: string }> | undefined };
}

export function numberFormat(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function sumOnlineGroups(groups: GroupCount[] | undefined): number | undefined {
  if (!groups?.length || groups.every((g) => g.id === "unknown")) return undefined;
  return groups.reduce((total, group) => {
    if (group.id === "offline" || group.id === "unknown") return total;
    return total + (Number.isFinite(group.count) ? group.count : 0);
  }, 0);
}

export function sumThreadSections(
  sections: Record<string, { sectionId: string; userIds: string[] }> | undefined,
): number | undefined {
  if (!sections || Object.keys(sections).length === 0) return undefined;
  return Object.values(sections).reduce((total, section) => {
    if (section.sectionId === "offline") return total;
    return total + (Array.isArray(section.userIds) ? section.userIds.length : 0);
  }, 0);
}

export function countVisibleVoiceUsers(
  voiceStates: Record<string, { channelId?: string }> | undefined,
  getChannel: (id: string) => any,
  canView: (channel: any) => boolean,
): number {
  if (!voiceStates) return 0;
  let count = 0;
  for (const state of Object.values(voiceStates)) {
    if (!state.channelId) continue;
    const channel = getChannel(state.channelId);
    if (channel && canView(channel)) count++;
  }
  return count;
}

const onlineCounts = new Map<string, number>();

function stores(): Stores {
  return {
    ChannelStore: findStore("ChannelStore"),
    ChannelMemberStore: findStore("ChannelMemberStore"),
    GuildMemberCountStore: findStore("GuildMemberCountStore"),
    GuildStore: findStore("GuildStore"),
    PermissionStore: findStore("PermissionStore"),
    SelectedChannelStore: findStore("SelectedChannelStore"),
    ThreadMemberListStore: findStore("ThreadMemberListStore"),
    VoiceStateStore: findStore("VoiceStateStore"),
  };
}

function currentContext(s: Stores): { guildId?: string; channelId?: string } {
  const channelId = s.SelectedChannelStore?.getChannelId?.();
  const channel = channelId ? s.ChannelStore?.getChannel?.(channelId) : undefined;
  return { guildId: channel?.guild_id, channelId };
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${HOST_ID} {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 12px 8px;
      color: var(--text-muted, #949ba4);
      font: 600 12px/1.2 var(--font-primary, system-ui, sans-serif);
      border-bottom: 1px solid var(--background-modifier-accent, rgba(255,255,255,.06));
    }
    #${HOST_ID} .dc-membercount-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }
    #${HOST_ID} .dc-membercount-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      display: inline-block;
    }
    #${HOST_ID} .online { color: var(--status-positive, #23a55a); }
    #${HOST_ID} .total { color: var(--text-muted, #949ba4); }
    #${HOST_ID} .voice { color: var(--interactive-normal, #b5bac1); }
    #${HOST_ID} .dc-membercount-dot.online { background: var(--status-positive, #23a55a); }
    #${HOST_ID} .dc-membercount-dot.total { border: 2px solid var(--text-muted, #949ba4); box-sizing: border-box; }
  `;
  document.head.appendChild(style);
}

function memberListContainer(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[class*="membersWrap_"]') ??
    document.querySelector<HTMLElement>('aside[class*="members"]') ??
    document.querySelector<HTMLElement>('[aria-label*="Members" i]')?.closest<HTMLElement>('[class*="members"]') ??
    null
  );
}

function ensureHost(): HTMLElement | null {
  const container = memberListContainer();
  if (!container) return null;
  let host = document.getElementById(HOST_ID) as HTMLElement | null;
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.innerHTML = `
      <span class="dc-membercount-item" title="Online in this channel">
        <span class="dc-membercount-dot online"></span><span class="online" data-kind="online">?</span>
      </span>
      <span class="dc-membercount-item" title="Total server members">
        <span class="dc-membercount-dot total"></span><span class="total" data-kind="total">?</span>
      </span>
      <span class="dc-membercount-item voice-wrap" title="Members in voice">
        <svg class="voice" width="13" height="13" viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M15.7 3a5.3 5.3 0 0 0-5.4 5.3v5.4a5.3 5.3 0 0 0 10.7 0V8.3A5.3 5.3 0 0 0 15.7 3Z"/>
          <path fill="currentColor" d="M7.7 13.7a1.3 1.3 0 1 0-2.7 0 10.7 10.7 0 0 0 9.3 10.6V27h-2.6a1.3 1.3 0 1 0 0 2.7h8a1.3 1.3 0 1 0 0-2.7H17v-2.7a10.7 10.7 0 0 0 9.3-10.6 1.3 1.3 0 1 0-2.7 0 8 8 0 0 1-16 0Z"/>
        </svg>
        <span class="voice" data-kind="voice">0</span>
      </span>
    `;
  }
  if (host.parentElement !== container) container.insertBefore(host, container.firstChild);
  return host;
}

function setText(host: HTMLElement, kind: string, value: string): void {
  const el = host.querySelector<HTMLElement>(`[data-kind="${kind}"]`);
  if (el && el.textContent !== value) el.textContent = value;
}

function updateWidget(): void {
  const s = stores();
  const { guildId, channelId } = currentContext(s);
  if (!guildId) {
    document.getElementById(HOST_ID)?.remove();
    return;
  }
  const host = ensureHost();
  if (!host) return;

  const total =
    s.GuildMemberCountStore?.getMemberCount?.(guildId) ??
    s.GuildStore?.getGuild?.(guildId)?.memberCount;

  const memberGroups = s.ChannelMemberStore?.getProps?.(guildId, channelId)?.groups;
  const threadSections = s.ThreadMemberListStore?.getMemberListSections?.(channelId);
  const online =
    sumThreadSections(threadSections) ??
    sumOnlineGroups(memberGroups) ??
    onlineCounts.get(guildId);

  const voice = countVisibleVoiceUsers(
    s.VoiceStateStore?.getVoiceStates?.(guildId),
    (id) => s.ChannelStore?.getChannel?.(id),
    (channel) => {
      try { return s.PermissionStore?.can?.(VIEW_CHANNEL, channel) ?? true; }
      catch { return true; }
    },
  );

  setText(host, "online", online == null ? "?" : numberFormat(online));
  setText(host, "total", total == null ? "?" : numberFormat(total));
  setText(host, "voice", numberFormat(voice));
  const voiceWrap = host.querySelector<HTMLElement>(".voice-wrap");
  if (voiceWrap) voiceWrap.hidden = voice <= 0;
}

let observer: MutationObserver | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let scheduled: number | null = null;

function scheduleUpdate(): void {
  if (scheduled !== null) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = null;
    try { updateWidget(); }
    catch (err) { log.warn("update failed:", err); }
  });
}

function handleFluxAction(action: any): void {
  if (action?.type === "GUILD_MEMBER_LIST_UPDATE" && action.guildId && Array.isArray(action.groups)) {
    const count = sumOnlineGroups(action.groups);
    if (count != null) onlineCounts.set(action.guildId, count);
  }
  if (action?.type === "ONLINE_GUILD_MEMBER_COUNT_UPDATE" && action.guildId && typeof action.count === "number") {
    onlineCounts.set(action.guildId, action.count);
  }
}

const plugin: DiscreatePlugin = {
  name: "Member Count",
  description: "Shows online, total, and voice member counts above the member list.",
  authors: ["Vencord contributors", "Discreate"],
  start() {
    ensureStyles();
    const dispatcher = Discreate.FluxDispatcher;
    if (dispatcher && typeof dispatcher.dispatch === "function") {
      after(OWNER, dispatcher, "dispatch", (args, ret) => {
        handleFluxAction(args[0]);
        scheduleUpdate();
        return ret;
      });
    } else {
      log.warn("FluxDispatcher unavailable; live member counts may lag");
    }
    updateWidget();
    observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, { childList: true, subtree: true });
    interval = setInterval(scheduleUpdate, 2500);
    log.log("started");
  },
  stop() {
    if (scheduled !== null) cancelAnimationFrame(scheduled);
    scheduled = null;
    observer?.disconnect();
    observer = null;
    if (interval) clearInterval(interval);
    interval = null;
    document.getElementById(HOST_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    onlineCounts.clear();
    log.log("stopped");
  },
};

export default plugin;
