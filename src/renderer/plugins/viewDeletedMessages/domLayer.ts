// src/renderer/plugins/viewDeletedMessages/domLayer.ts
// Augments rendered Discord message rows without patching React: a
// MutationObserver re-applies styling/markers whenever the chat re-renders.
import { editHistory } from "./log.js";

const STYLE_ID = "discreate-ml-style";
const DELETED_CLASS = "discreate-ml-deleted";
const MARKER_CLASS = "discreate-ml-edit-marker";

// "{channelId}-{messageId}" of every kept deleted message.
const deletedIds = new Set<string>();

let observer: MutationObserver | null = null;
let onLocalDelete: ((channelId: string, messageId: string) => void) | null = null;

export function setLocalDeleteHandler(fn: (channelId: string, messageId: string) => void): void {
  onLocalDelete = fn;
}

export function markDeleted(channelId: string, messageId: string): void {
  deletedIds.add(`${channelId}-${messageId}`);
  scheduleAugment();
}

export function unmarkDeleted(channelId: string, messageId: string): void {
  deletedIds.delete(`${channelId}-${messageId}`);
  document.getElementById(`chat-messages-${channelId}-${messageId}`)
    ?.classList.remove(DELETED_CLASS);
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .${DELETED_CLASS} {
      background-color: hsl(0 85% 61% / 12%) !important;
      border-left: 3px solid var(--status-danger, #f04747) !important;
    }
    .${MARKER_CLASS} {
      color: var(--status-danger, #f04747);
      font-size: 10px; cursor: pointer; margin-left: 4px; user-select: none;
    }
    .discreate-ml-popover {
      position: fixed; z-index: 2147483647; max-width: 420px;
      background: #1e1f22; color: #dbdee1; border: 1px solid #2b2d31;
      border-radius: 6px; padding: 8px 10px; font: 13px/1.4 system-ui, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.5);
    }
    .discreate-ml-popover .ver { padding: 4px 0; border-bottom: 1px solid #2b2d31; }
    .discreate-ml-popover .ver:last-child { border-bottom: none; }
    .discreate-ml-popover .ts { color: #949ba4; font-size: 11px; }
    .discreate-ml-menu {
      position: fixed; z-index: 2147483647; background: #111214;
      border: 1px solid #2b2d31; border-radius: 4px; padding: 4px;
      font: 14px system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.5);
    }
    .discreate-ml-menu button {
      display: block; width: 100%; text-align: left; padding: 6px 10px;
      background: none; border: none; color: #f23f43; cursor: pointer;
      border-radius: 3px; font: inherit;
    }
    .discreate-ml-menu button:hover { background: #f23f43; color: #fff; }
  `;
  document.head.appendChild(s);
}

/** Parse "chat-messages-{channelId}-{messageId}" -> ids. */
function parseRowId(el: Element): { channelId: string; messageId: string } | null {
  const m = /^chat-messages-(\d+)-(\d+)$/.exec(el.id);
  return m ? { channelId: m[1], messageId: m[2] } : null;
}

function augmentRow(row: HTMLElement): void {
  const ids = parseRowId(row);
  if (!ids) return;

  if (deletedIds.has(`${ids.channelId}-${ids.messageId}`)) {
    row.classList.add(DELETED_CLASS);
  } else {
    row.classList.remove(DELETED_CLASS);
  }

  const history = editHistory.get(ids.messageId);
  const existingMarker = row.querySelector(`.${MARKER_CLASS}`);
  if (history?.length) {
    if (existingMarker) {
      existingMarker.textContent = `(edited ×${history.length})`;
    } else {
      const marker = document.createElement("span");
      marker.className = MARKER_CLASS;
      marker.textContent = `(edited ×${history.length})`;
      marker.addEventListener("click", (e) => showEditPopover(e, ids.messageId));
      // Append after the message content node if present, else to the row.
      (row.querySelector('[class*="messageContent"]') ?? row).appendChild(marker);
    }
  } else if (existingMarker) {
    existingMarker.remove();
  }
}

function augmentAll(): void {
  for (const row of document.querySelectorAll<HTMLElement>('[id^="chat-messages-"]')) {
    augmentRow(row);
  }
}

let augmentScheduled = false;
/** Coalesce mutation bursts into one augment pass per animation frame. */
function scheduleAugment(): void {
  if (augmentScheduled) return;
  augmentScheduled = true;
  requestAnimationFrame(() => {
    augmentScheduled = false;
    augmentAll();
  });
}

function showEditPopover(e: MouseEvent, messageId: string): void {
  e.stopPropagation();
  document.querySelector(".discreate-ml-popover")?.remove();
  const history = editHistory.get(messageId) ?? [];
  const pop = document.createElement("div");
  pop.className = "discreate-ml-popover";
  pop.innerHTML = history
    .map((h) => `<div class="ver"><div>${escapeHtml(h.content)}</div>` +
      `<div class="ts">${new Date(h.time).toLocaleString()}</div></div>`)
    .join("") || "<div class='ver'>No history</div>";
  pop.style.left = `${Math.min(e.clientX, window.innerWidth - 440)}px`;
  pop.style.top = `${Math.min(e.clientY + 8, window.innerHeight - 220)}px`;
  document.body.appendChild(pop);
  const close = (ev: MouseEvent) => {
    if (!pop.contains(ev.target as Node)) { pop.remove(); document.removeEventListener("click", close, true); }
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function showContextMenu(e: MouseEvent, channelId: string, messageId: string): void {
  e.preventDefault();
  e.stopPropagation();
  document.querySelector(".discreate-ml-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "discreate-ml-menu";
  const btn = document.createElement("button");
  btn.textContent = "Delete locally";
  btn.addEventListener("click", () => {
    menu.remove();
    onLocalDelete?.(channelId, messageId);
  });
  menu.appendChild(btn);
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 160)}px`;
  menu.style.top = `${e.clientY}px`;
  document.body.appendChild(menu);
  const close = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener("click", close, true); }
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
}

/** A single delegated contextmenu listener for all deleted rows. */
function onContextMenu(e: MouseEvent): void {
  const row = (e.target as Element)?.closest?.('[id^="chat-messages-"]') as HTMLElement | null;
  if (!row) return;
  const ids = parseRowId(row);
  if (!ids || !deletedIds.has(`${ids.channelId}-${ids.messageId}`)) return;
  showContextMenu(e, ids.channelId, ids.messageId);
}

export function startDomLayer(): void {
  if (observer) return;
  ensureStyles();
  augmentAll();
  observer = new MutationObserver(() => scheduleAugment());
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("contextmenu", onContextMenu, true);
}

export function stopDomLayer(): void {
  observer?.disconnect();
  observer = null;
  document.removeEventListener("contextmenu", onContextMenu, true);
  document.getElementById(STYLE_ID)?.remove();
  for (const row of document.querySelectorAll(`.${DELETED_CLASS}`)) row.classList.remove(DELETED_CLASS);
  for (const m of document.querySelectorAll(`.${MARKER_CLASS}`)) m.remove();
  deletedIds.clear();
}
