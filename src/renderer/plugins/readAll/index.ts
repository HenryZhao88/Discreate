// src/renderer/plugins/readAll/index.ts
// First-party "Read All" button — marks every unread server channel read.

import type { DiscreatePlugin } from "../../api/index.js";
import { Discreate } from "../../api/index.js";
import { findStore } from "../../core/webpack.js";
import { makeLogger } from "../../core/logger.js";

export interface AckChannel {
  channelId: string;
  messageId: string;
  readStateType: number;
}

export interface ReadAllStores {
  GuildStore: { getGuilds(): Record<string, { id: string }> };
  GuildChannelStore: {
    getChannels(guildId: string): { SELECTABLE?: any[]; VOCAL?: any[] };
  };
  ActiveJoinedThreadsStore: {
    getActiveJoinedThreadsForGuild(guildId: string): Record<string, any>;
  };
  ReadStateStore: {
    hasUnread(channelId: string): boolean;
    lastMessageId(channelId: string): string;
    /** Flux stores keep the live dispatcher they are registered with here. */
    _dispatcher?: { dispatch(action: unknown): void };
  };
}

/**
 * Build the `channels` array for a BULK_ACK dispatch: every selectable, voice,
 * or active-thread channel across all guilds that currently has unread
 * messages. Mirrors Vencord's readAllNotificationsButton logic.
 */
export function collectUnreadChannels(stores: ReadAllStores): AckChannel[] {
  const { GuildStore, GuildChannelStore, ActiveJoinedThreadsStore, ReadStateStore } = stores;
  const out: AckChannel[] = [];

  for (const guild of Object.values(GuildStore.getGuilds())) {
    const channels = GuildChannelStore.getChannels(guild.id) ?? {};
    const threads = Object.values(
      ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guild.id) ?? {},
    ).flatMap((t) => Object.values(t as Record<string, any>));

    for (const entry of [...(channels.SELECTABLE ?? []), ...(channels.VOCAL ?? []), ...threads]) {
      const id = entry?.channel?.id;
      if (!id || !ReadStateStore.hasUnread(id)) continue;
      out.push({ channelId: id, messageId: ReadStateStore.lastMessageId(id), readStateType: 0 });
    }
  }
  return out;
}

/**
 * Dispatch the same action Discord uses for its native "mark all read" flow.
 * Keeping this separate makes the runtime boundary testable and lets callers
 * use the dispatcher belonging to the authoritative Flux store.
 */
export function dispatchReadAll(
  stores: ReadAllStores,
  dispatcher?: { dispatch(action: unknown): void },
): number {
  const channels = collectUnreadChannels(stores);
  const liveDispatcher = stores.ReadStateStore._dispatcher ?? dispatcher;
  if (!liveDispatcher || typeof liveDispatcher.dispatch !== "function") {
    throw new Error("Read All: the live Flux dispatcher is unavailable");
  }
  liveDispatcher.dispatch({ type: "BULK_ACK", context: "APP", channels });
  return channels.length;
}

const log = makeLogger("ReadAll");
const BUTTON_ID = "discreate-readall-btn";
const STYLE_ID = "discreate-readall-style";

function resolveStores(): ReadAllStores | null {
  const GuildStore = findStore("GuildStore");
  const GuildChannelStore = findStore("GuildChannelStore");
  const ActiveJoinedThreadsStore = findStore("ActiveJoinedThreadsStore");
  const ReadStateStore = findStore("ReadStateStore");
  if (!GuildStore || !GuildChannelStore || !ActiveJoinedThreadsStore || !ReadStateStore) {
    log.error("Read All: a required store is missing");
    return null;
  }
  return { GuildStore, GuildChannelStore, ActiveJoinedThreadsStore, ReadStateStore } as ReadAllStores;
}

function readAll(): void {
  const stores = resolveStores();
  if (!stores) return;
  try {
    // Use the current store's dispatcher; bootstrap may refer to an older runtime.
    const count = dispatchReadAll(stores, Discreate.FluxDispatcher);
    log.log(`Read All — acked ${count} channel(s)`);
  } catch (err) {
    log.error("Read All: dispatch failed", err);
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    #${BUTTON_ID} {
      width: 48px; margin: 4px auto 0; padding: 4px 0;
      font: 600 11px system-ui, sans-serif; cursor: pointer;
      color: var(--interactive-icon-default, #b5bac1);
      background: var(--background-secondary, #2b2d31);
      border: none; border-radius: 8px;
    }
    #${BUTTON_ID}:hover {
      color: #fff; background: var(--brand-experiment, #5865F2);
    }
  `;
  document.head.appendChild(s);
}

/** Find the guild sidebar's scroll container so we can prepend the button. */
function guildListContainer(): Element | null {
  return (
    document.querySelector('[class*="guilds_"]') ??
    document.querySelector('nav[aria-label][class*="guilds"]') ??
    document.querySelector('[class*="itemsContainer"]')
  );
}

function injectButton(): void {
  if (document.getElementById(BUTTON_ID)) return;
  const container = guildListContainer();
  if (!container) return;
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.textContent = "Read All";
  btn.addEventListener("click", readAll);
  container.insertBefore(btn, container.firstChild);
}

let observer: MutationObserver | null = null;

const plugin: DiscreatePlugin = {
  name: "Read All",
  description: "Adds a button above the server list that marks every server's notifications as read.",
  authors: ["Discreate"],
  start() {
    ensureStyles();
    injectButton();
    // Discord re-renders the guild sidebar; re-inject the button if it vanishes.
    observer = new MutationObserver(() => injectButton());
    observer.observe(document.body, { childList: true, subtree: true });
    log.log("started");
  },
  stop() {
    observer?.disconnect();
    observer = null;
    document.getElementById(BUTTON_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    log.log("stopped");
  },
};

export default plugin;
