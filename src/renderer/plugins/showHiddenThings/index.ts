import type { DiscreatePlugin, PluginContext } from "../../api/index.js";
import { after } from "../../core/patcher.js";
import { findStore } from "../../core/webpack.js";
import { makeLogger } from "../../core/logger.js";

const OWNER = "showHiddenThings";
const log = makeLogger("ShowHiddenThings");
const STYLE_ID = "discreate-show-hidden-things-style";
const BADGE_CLASS = "discreate-invites-paused";
const MODERATE_MEMBERS = 1n << 40n;

interface Options {
  showTimeouts: boolean;
  showInvitesPaused: boolean;
  showModView: boolean;
}

const DEFAULT_OPTIONS: Options = {
  showTimeouts: true,
  showInvitesPaused: true,
  showModView: true,
};

let options: Options = DEFAULT_OPTIONS;
let observer: MutationObserver | null = null;
let scheduled: number | null = null;
const positionedAnchors = new Map<HTMLElement, string>();

export function permissionIncludes(permission: unknown, bit: bigint): boolean {
  try {
    return (BigInt(permission as any) & bit) === bit;
  } catch {
    return false;
  }
}

export function guildHasInvitesPaused(guild: any): boolean {
  try {
    if (guild?.hasFeature?.("INVITES_DISABLED")) return true;
  } catch { /* fall through */ }
  return (
    guild?.invitesDisabled === true ||
    guild?.features?.includes?.("INVITES_DISABLED") ||
    guild?.features?.includes?.("INVITES_DISABLED_UNTIL")
  );
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${BADGE_CLASS} {
      position: absolute;
      right: 1px;
      bottom: 1px;
      width: 16px;
      height: 16px;
      display: grid;
      place-items: center;
      color: white;
      background: var(--status-danger, #f23f43);
      border: 2px solid var(--background-tertiary, #111214);
      border-radius: 999px;
      pointer-events: none;
      box-sizing: border-box;
    }
    .${BADGE_CLASS} svg {
      width: 10px;
      height: 10px;
      fill: currentColor;
    }
  `;
  document.head.appendChild(style);
}

function guildAnchor(guildId: string): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(`a[href="/channels/${guildId}"]`) ??
    document.querySelector<HTMLElement>(`[data-list-item-id*="${guildId}"]`) ??
    null
  );
}

function ensureBadge(anchor: HTMLElement): void {
  if (anchor.querySelector(`:scope > .${BADGE_CLASS}`)) return;
  const computed = getComputedStyle(anchor);
  if (computed.position === "static") {
    positionedAnchors.set(anchor, anchor.style.position);
    anchor.style.position = "relative";
  }
  const badge = document.createElement("span");
  badge.className = BADGE_CLASS;
  badge.title = "Invites paused";
  badge.setAttribute("aria-label", "Invites paused");
  badge.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M8 5h3v14H8V5Zm5 0h3v14h-3V5Z"/>' +
    "</svg>";
  anchor.appendChild(badge);
}

function updateInviteBadges(): void {
  const wanted = new Set<HTMLElement>();
  const GuildStore = findStore("GuildStore");
  for (const [guildId, guild] of Object.entries<any>(options.showInvitesPaused ? GuildStore?.getGuilds?.() ?? {} : {})) {
    if (!guildHasInvitesPaused(guild)) continue;
    const anchor = guildAnchor(guildId);
    if (anchor) { wanted.add(anchor); ensureBadge(anchor); }
  }
  for (const badge of document.querySelectorAll(`.${BADGE_CLASS}`)) {
    if (!wanted.has(badge.parentElement!)) badge.remove();
  }
  for (const [anchor, position] of positionedAnchors) {
    if (wanted.has(anchor)) continue;
    if (anchor.style.position === "relative") anchor.style.position = position;
    positionedAnchors.delete(anchor);
  }
}

function scheduleBadges(): void {
  if (scheduled !== null) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = null;
    try { updateInviteBadges(); }
    catch (err) { log.warn("badge update failed:", err); }
  });
}

function patchPermissionStore(): void {
  const PermissionStore = findStore("PermissionStore");
  if (!PermissionStore || typeof PermissionStore.canManageUser !== "function") {
    log.warn("PermissionStore.canManageUser unavailable");
    return;
  }

  after(OWNER, PermissionStore, "canManageUser", (args, ret) => {
    if (ret) return ret;
    if (!options.showTimeouts && !options.showModView) return ret;
    try { return BigInt(args[0]) === MODERATE_MEMBERS ? true : ret; }
    catch { return ret; }
  });
}

function mergeOptions(ctx: PluginContext): Options {
  return { ...DEFAULT_OPTIONS, ...(ctx.options as Partial<Options>) };
}

const plugin: DiscreatePlugin = {
  name: "Show Hidden Things",
  description: "Shows several moderator-only visual indicators, including timeout affordances and paused invites.",
  authors: ["Vencord contributors", "Discreate"],
  start(ctx) {
    options = mergeOptions(ctx);
    ensureStyles();
    patchPermissionStore();
    updateInviteBadges();
    observer = new MutationObserver(scheduleBadges);
    observer.observe(document.body, { childList: true, subtree: true });
    log.log("started");
  },
  stop() {
    if (scheduled !== null) cancelAnimationFrame(scheduled);
    scheduled = null;
    observer?.disconnect();
    observer = null;
    for (const badge of document.querySelectorAll(`.${BADGE_CLASS}`)) badge.remove();
    for (const [anchor, position] of positionedAnchors) {
      if (anchor.style.position === "relative") anchor.style.position = position;
    }
    positionedAnchors.clear();
    document.getElementById(STYLE_ID)?.remove();
    log.log("stopped");
  },
};

export default plugin;
