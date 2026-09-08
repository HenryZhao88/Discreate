import type { DiscreatePlugin } from "../../api/index.js";
import { instead } from "../../core/patcher.js";
import { findStore } from "../../core/webpack.js";
import { makeLogger } from "../../core/logger.js";

const OWNER = "showHiddenChannels";
const log = makeLogger("ShowHiddenChannels");
const STYLE_ID = "discreate-show-hidden-channels-style";
const OVERLAY_ID = "discreate-hidden-channel-lock";
const HIDDEN_LINK_CLASS = "discreate-hidden-channel-link";
const HIDDEN_ICON_CLASS = "discreate-hidden-channel-icon";
const VIEW_CHANNEL = 1n << 10n;

const hiddenChannelIds = new Set<string>();

export function permissionIncludes(permission: unknown, bit: bigint): boolean {
  try {
    return (BigInt(permission as any) & bit) === bit;
  } catch {
    return false;
  }
}

export function isGuildChannelLike(channel: any): boolean {
  if (!channel || typeof channel !== "object") return false;
  if (!channel.id || !channel.guild_id) return false;
  if (["browse", "customize", "guide"].includes(channel.id)) return false;
  try {
    if (channel.isDM?.() || channel.isGroupDM?.() || channel.isMultiUserDM?.()) return false;
  } catch { /* fall through */ }
  return true;
}

export function shouldRevealHiddenChannel(permission: unknown, originalAllowed: boolean, channel: any): boolean {
  return !originalAllowed && isViewPermission(permission) && isGuildChannelLike(channel);
}

function isViewPermission(permission: unknown): boolean {
  try { return BigInt(permission as any) === VIEW_CHANNEL; } catch { return false; }
}

function channelTypeName(channel: any): string {
  if (channel?.isForumChannel?.()) return "forum";
  if (channel?.isGuildVoice?.()) return "voice";
  if (channel?.isGuildStageVoice?.()) return "stage";
  switch (channel?.type) {
    case 0: return "text";
    case 2: return "voice";
    case 5: return "announcement";
    case 13: return "stage";
    case 15: return "forum";
    default: return "guild";
  }
}

function markPermissionResult(permission: unknown, ret: boolean, channel: any): boolean {
  if (!isGuildChannelLike(channel) || !isViewPermission(permission)) return ret;
  if (ret) {
    hiddenChannelIds.delete(channel.id);
    return ret;
  }
  hiddenChannelIds.add(channel.id);
  return true;
}

/**
 * ChannelStore, resolved once. `can` is among the hottest functions in
 * Discord — it runs for every channel, message and menu on every render — so
 * its patch callback must never perform a module lookup. Refreshed off the
 * hot path by `scheduleUpdate` if it wasn't available when we patched.
 */
let channelStore: any;

function refreshChannelStore(): void {
  channelStore = findStore("ChannelStore");
}

function findChannelArg(args: any[], from: number): any {
  for (let i = from; i < args.length; i++) {
    const arg = args[i];
    if (isGuildChannelLike(arg)) return arg;
    if (isGuildChannelLike(arg?.channel)) return arg.channel;
    if (arg?.channelId) {
      const channel = channelStore?.getChannel?.(arg.channelId);
      if (isGuildChannelLike(channel)) return channel;
    }
  }
  return undefined;
}

function patchPermissionStore(): void {
  const PermissionStore = findStore("PermissionStore");
  if (!PermissionStore || typeof PermissionStore.can !== "function") {
    log.warn("PermissionStore.can unavailable");
    return;
  }
  refreshChannelStore();

  let depth = 0;
  let suppressReveal = 0;
  const revealedInCall = new Set<string>();
  const handle = (args: any[], original: (...args: any[]) => any): any => {
    const viewOnly = isViewPermission(args[0]);
    depth++;
    if (!viewOnly) suppressReveal++;
    try {
      const ret = original(...args);
      // Combined permission queries must keep their native result even if
      // Discord delegates part of the query to a VIEW_CHANNEL-only check.
      if (!viewOnly || suppressReveal) return ret;
      const channel = findChannelArg(args, 1);
      // A nested patched method may already have changed false to true. That
      // is not evidence that Discord granted access to this channel.
      if (ret && revealedInCall.has(channel?.id)) return ret;
      const result = markPermissionResult(args[0], !!ret, channel);
      if (!ret && result) revealedInCall.add(channel.id);
      return result;
    } finally {
      if (!viewOnly) suppressReveal--;
      if (--depth === 0) revealedInCall.clear();
    }
  };

  instead(OWNER, PermissionStore, "can", handle);

  if (typeof PermissionStore.canWithPartialContext === "function") {
    instead(OWNER, PermissionStore, "canWithPartialContext", handle);
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${HIDDEN_LINK_CLASS} {
      opacity: .58;
      filter: saturate(.65);
    }
    .${HIDDEN_ICON_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      margin-left: 6px;
      color: var(--interactive-muted, #80848e);
      vertical-align: -3px;
      pointer-events: none;
    }
    .${HIDDEN_ICON_CLASS} svg {
      width: 15px;
      height: 15px;
      fill: currentColor;
    }
    #${OVERLAY_ID} {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--background-primary, #313338);
      color: var(--text-normal, #dbdee1);
      text-align: center;
      font: 14px/1.45 var(--font-primary, system-ui, sans-serif);
    }
    #${OVERLAY_ID} .dc-hidden-lock-card {
      max-width: 620px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    #${OVERLAY_ID} .dc-hidden-lock-icon {
      width: 92px;
      height: 92px;
      color: var(--interactive-muted, #80848e);
    }
    #${OVERLAY_ID} h2 {
      margin: 0;
      color: var(--header-primary, #f2f3f5);
      font-size: 24px;
      line-height: 1.2;
    }
    #${OVERLAY_ID} p {
      margin: 0;
      color: var(--text-muted, #949ba4);
    }
    #${OVERLAY_ID} .dc-hidden-topic {
      max-width: min(560px, 80vw);
      margin-top: 8px;
      padding: 10px 12px;
      border-radius: 6px;
      background: var(--background-secondary, #2b2d31);
      color: var(--text-normal, #dbdee1);
      text-align: left;
      white-space: pre-wrap;
    }
  `;
  document.head.appendChild(style);
}

function selectedChannel(): any {
  const SelectedChannelStore = findStore("SelectedChannelStore");
  const ChannelStore = findStore("ChannelStore");
  const channelId = SelectedChannelStore?.getChannelId?.();
  return channelId ? ChannelStore?.getChannel?.(channelId) : undefined;
}

function ensureHiddenStatus(channel: any): boolean {
  if (!isGuildChannelLike(channel)) return false;
  const PermissionStore = findStore("PermissionStore");
  try {
    PermissionStore?.can?.(VIEW_CHANNEL, channel);
  } catch { /* ignore */ }
  return hiddenChannelIds.has(channel.id);
}

function parseChannelIdFromHref(href: string | null): string | undefined {
  const match = String(href ?? "").match(/\/channels\/\d+\/(\d+)/);
  return match?.[1];
}

function lockIcon(): HTMLElement {
  const span = document.createElement("span");
  span.className = HIDDEN_ICON_CLASS;
  span.title = "Hidden channel";
  span.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M17 11V7a5 5 0 0 0-10 0v4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-8 0V7a3 3 0 0 1 6 0v4H9Z"/>' +
    "</svg>";
  return span;
}

function updateChannelLinks(): void {
  for (const link of document.querySelectorAll<HTMLElement>('a[href*="/channels/"]')) {
    const channelId = parseChannelIdFromHref(link.getAttribute("href"));
    if (!channelId || !hiddenChannelIds.has(channelId)) {
      link.classList.remove(HIDDEN_LINK_CLASS);
      link.querySelector(`.${HIDDEN_ICON_CLASS}`)?.remove();
      continue;
    }
    link.classList.add(HIDDEN_LINK_CLASS);
    const textTarget = link.querySelector<HTMLElement>('[class*="name_"], [class*="channelName_"]') ?? link;
    if (!textTarget.querySelector(`.${HIDDEN_ICON_CLASS}`)) textTarget.appendChild(lockIcon());
  }
}

function snowflakeTimestamp(id: string | undefined): number | undefined {
  if (!id) return undefined;
  try {
    return Number((BigInt(id) >> 22n) + 1420070400000n);
  } catch {
    return undefined;
  }
}

function chatContainer(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[class*="chatContent_"]') ??
    document.querySelector<HTMLElement>('[class*="chat_"]') ??
    document.querySelector<HTMLElement>("main")
  );
}

let positionedContainer: { element: HTMLElement; position: string; priority: string } | null = null;

function restoreChatPosition(): void {
  if (!positionedContainer) return;
  const { element, position, priority } = positionedContainer;
  if (element.style.position === "relative") element.style.setProperty("position", position, priority);
  positionedContainer = null;
}

function renderLockScreen(channel: any): void {
  const container = chatContainer();
  if (positionedContainer?.element !== container) restoreChatPosition();
  if (!container) return;
  const computed = getComputedStyle(container);
  if (computed.position === "static") {
    positionedContainer = { element: container, position: container.style.position, priority: container.style.getPropertyPriority("position") };
    container.style.position = "relative";
  }

  let overlay = document.getElementById(OVERLAY_ID) as HTMLElement | null;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    container.appendChild(overlay);
  } else if (overlay.parentElement !== container) {
    container.appendChild(overlay);
  }

  const typeName = channelTypeName(channel);
  const contentKey = JSON.stringify([channel.id, channel.name, typeName, channel.lastMessageId, channel.topic]);
  if (overlay.dataset.contentKey === contentKey && overlay.firstChild) return;
  overlay.dataset.contentKey = contentKey;
  overlay.replaceChildren();

  const card = document.createElement("div");
  card.className = "dc-hidden-lock-card";
  const icon = document.createElement("div");
  icon.className = "dc-hidden-lock-icon";
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 11V7a5 5 0 0 0-10 0v4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-8 0V7a3 3 0 0 1 6 0v4H9Z"/></svg>';

  const title = document.createElement("h2");
  title.textContent = `This is a hidden ${typeName} channel`;

  const detail = document.createElement("p");
  detail.textContent = `You can see that #${channel.name ?? channel.id} exists, but Discord did not grant message access.`;

  card.append(icon, title, detail);

  const lastTime = snowflakeTimestamp(channel.lastMessageId);
  if (lastTime) {
    const last = document.createElement("p");
    last.textContent = `Last activity: ${new Date(lastTime).toLocaleString()}`;
    card.appendChild(last);
  }

  if (typeof channel.topic === "string" && channel.topic.trim()) {
    const topic = document.createElement("div");
    topic.className = "dc-hidden-topic";
    topic.textContent = channel.topic;
    card.appendChild(topic);
  }

  overlay.appendChild(card);
}

function updateLockScreen(): void {
  const channel = selectedChannel();
  if (ensureHiddenStatus(channel)) {
    renderLockScreen(channel);
  } else {
    document.getElementById(OVERLAY_ID)?.remove();
    restoreChatPosition();
  }
}

let observer: MutationObserver | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let scheduled: number | null = null;

function scheduleUpdate(): void {
  if (scheduled !== null) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = null;
    try {
      refreshChannelStore();
      updateChannelLinks();
      updateLockScreen();
    } catch (err) {
      log.warn("update failed:", err);
    }
  });
}

const plugin: DiscreatePlugin = {
  name: "Show Hidden Channels",
  description: "Shows channels hidden by VIEW_CHANNEL checks and displays a lock screen instead of message access.",
  authors: ["Vencord contributors", "Discreate"],
  start() {
    ensureStyles();
    patchPermissionStore();
    scheduleUpdate();
    observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, { childList: true, subtree: true });
    interval = setInterval(scheduleUpdate, 1500);
    log.log("started");
  },
  stop() {
    if (scheduled !== null) cancelAnimationFrame(scheduled);
    scheduled = null;
    observer?.disconnect();
    observer = null;
    if (interval) clearInterval(interval);
    interval = null;
    document.getElementById(OVERLAY_ID)?.remove();
    restoreChatPosition();
    document.getElementById(STYLE_ID)?.remove();
    for (const old of document.querySelectorAll(`.${HIDDEN_ICON_CLASS}`)) old.remove();
    for (const old of document.querySelectorAll(`.${HIDDEN_LINK_CLASS}`)) old.classList.remove(HIDDEN_LINK_CLASS);
    hiddenChannelIds.clear();
    log.log("stopped");
  },
};

export default plugin;
