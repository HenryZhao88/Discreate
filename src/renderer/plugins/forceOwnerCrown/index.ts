import type { DiscreatePlugin } from "../../api/index.js";
import { findStore } from "../../core/webpack.js";
import { makeLogger } from "../../core/logger.js";

const log = makeLogger("ForceOwnerCrown");
const STYLE_ID = "discreate-force-owner-crown-style";
const CROWN_CLASS = "discreate-owner-crown";

interface GuildLike {
  id?: string;
  ownerId?: string;
}

interface Stores {
  GuildStore?: { getGuild(id?: string): GuildLike | undefined };
  ChannelStore?: { getChannel(id?: string): any };
  MessageStore?: { getMessage(channelId: string, messageId: string): any };
  SelectedChannelStore?: { getChannelId(): string | undefined };
  SelectedGuildStore?: { getGuildId(): string | undefined };
}

export function isGuildOwner(guild: GuildLike | undefined, userId: string | undefined): boolean {
  return !!guild?.ownerId && !!userId && guild.ownerId === userId;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${CROWN_CLASS} {
      display: inline-flex;
      align-items: center;
      margin-left: 4px;
      color: var(--status-warning, #f0b232);
      vertical-align: -2px;
    }
    .${CROWN_CLASS} svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
    }
  `;
  document.head.appendChild(style);
}

function crownNode(): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = CROWN_CLASS;
  span.title = "Server owner";
  span.setAttribute("aria-label", "Server owner");
  span.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M5 16.8 3.2 7.1l5.1 3.2L12 4l3.7 6.3 5.1-3.2L19 16.8H5Zm.7 3.2h12.6c.5 0 .9-.4.9-.9v-.8H4.8v.8c0 .5.4.9.9.9Z"/>' +
    "</svg>";
  return span;
}

function stores(): Stores {
  return {
    GuildStore: findStore("GuildStore"),
    ChannelStore: findStore("ChannelStore"),
    MessageStore: findStore("MessageStore"),
    SelectedChannelStore: findStore("SelectedChannelStore"),
    SelectedGuildStore: findStore("SelectedGuildStore"),
  };
}

function currentGuildId(s: Stores): string | undefined {
  const selectedChannelId = s.SelectedChannelStore?.getChannelId?.();
  const selectedChannel = selectedChannelId ? s.ChannelStore?.getChannel?.(selectedChannelId) : undefined;
  return selectedChannel?.guild_id ?? s.SelectedGuildStore?.getGuildId?.();
}

function parseMessageRowId(row: Element): { channelId: string; messageId: string } | null {
  const match = /^chat-messages-(\d+)-(\d+)$/.exec(row.id);
  return match ? { channelId: match[1], messageId: match[2] } : null;
}

function parseLastSnowflake(value: string | undefined | null): string | undefined {
  const matches = String(value ?? "").match(/\d{15,25}/g);
  return matches?.[matches.length - 1];
}

function memberUserId(row: HTMLElement): string | undefined {
  return (
    parseLastSnowflake(row.dataset.listItemId) ??
    parseLastSnowflake(row.getAttribute("aria-label")) ??
    parseLastSnowflake(row.id)
  );
}

function usernameTarget(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(
    '[class*="username_"], [class*="memberName_"], [class*="name_"]',
  );
}

function setCrown(row: HTMLElement, shouldShow: boolean): void {
  const existing = row.querySelector(`:scope .${CROWN_CLASS}`);
  if (!shouldShow) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const target = usernameTarget(row);
  if (!target) return;
  target.insertAdjacentElement("afterend", crownNode());
}

function augmentMessageRow(row: HTMLElement, s: Stores): void {
  const ids = parseMessageRowId(row);
  if (!ids) return;
  const channel = s.ChannelStore?.getChannel?.(ids.channelId);
  const guildId = channel?.guild_id;
  const guild = s.GuildStore?.getGuild?.(guildId);
  const message = s.MessageStore?.getMessage?.(ids.channelId, ids.messageId);
  const userId = message?.author?.id;
  setCrown(row, isGuildOwner(guild, userId));
}

function augmentMemberRow(row: HTMLElement, s: Stores): void {
  const userId = memberUserId(row);
  if (!userId) return;
  const guildId = currentGuildId(s);
  const guild = s.GuildStore?.getGuild?.(guildId);
  setCrown(row, isGuildOwner(guild, userId));
}

let observer: MutationObserver | null = null;
let scheduled = false;

function augmentAll(): void {
  const s = stores();
  for (const row of document.querySelectorAll<HTMLElement>('[id^="chat-messages-"]')) {
    augmentMessageRow(row, s);
  }
  for (const row of document.querySelectorAll<HTMLElement>(
    '[data-list-item-id^="members-"], [data-list-item-id*="member"], [role="listitem"][class*="member"]',
  )) {
    augmentMemberRow(row, s);
  }
}

function scheduleAugment(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    try { augmentAll(); }
    catch (err) { log.warn("augment failed:", err); }
  });
}

const plugin: DiscreatePlugin = {
  name: "Force Owner Crown",
  description: "Adds the server owner crown beside owner usernames even when Discord omits it.",
  authors: ["Vencord contributors", "Discreate"],
  start() {
    ensureStyles();
    augmentAll();
    observer = new MutationObserver(scheduleAugment);
    observer.observe(document.body, { childList: true, subtree: true });
    log.log("started");
  },
  stop() {
    observer?.disconnect();
    observer = null;
    for (const crown of document.querySelectorAll(`.${CROWN_CLASS}`)) crown.remove();
    document.getElementById(STYLE_ID)?.remove();
    log.log("stopped");
  },
};

export default plugin;
