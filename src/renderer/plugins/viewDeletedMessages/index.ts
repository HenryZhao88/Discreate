// src/renderer/plugins/viewDeletedMessages/index.ts
import { Discreate } from "../../api/index.js";
import type { DiscreatePlugin, PluginContext } from "../../api/index.js";
import { findByProps, findByPropsLazy, findStore } from "../../core/webpack.js";
import { instead } from "../../core/patcher.js";
import { makeLogger } from "../../core/logger.js";
import { native } from "../../core/paths.js";
import { recordDeleted, recordEdit, removeDeleted, editHistory, makeEditEntry as makeEditEntryFromStore } from "./log.js";
import { startDomLayer, stopDomLayer, markDeleted, unmarkDeleted, setLocalDeleteHandler } from "./domLayer.js";
import type { EditEntry } from "./log.js";

const log = makeLogger("ViewDeletedMessages");
const OWNER = "viewDeletedMessages";

/** Resolve Discord's MessageStore lazily — it loads on first channel open. */
let messageStoreCache: any = null;
function messageStore(): any {
  if (messageStoreCache?.getName?.() === "MessageStore") return messageStoreCache;
  // Match the real Flux store by name first — a bare `getMessage`/`getMessages`
  // prop match picks up unrelated helpers that hold no message data.
  messageStoreCache =
    findStore("MessageStore") ??
    findByProps("getMessage", "getMessages") ??
    findByPropsLazy("getMessage", "getMessages");
  return messageStoreCache;
}

/** Retrieve a message by id, trying every shape modern MessageStore exposes. */
function retrieveMessage(store: any, channelId: string, messageId: string): { msg: any; via: string } {
  if (!store) return { msg: undefined, via: "no-store" };
  try {
    const direct = store.getMessage?.(channelId, messageId);
    if (direct) return { msg: direct, via: "getMessage" };
  } catch { /* fall through */ }
  try {
    const coll = store.getMessages?.(channelId);
    // MessageCollection exposes `.get(id)`; older shapes back onto `._array`.
    const fromColl = coll?.get?.(messageId) ?? coll?._array?.find?.((m: any) => m?.id === messageId);
    if (fromColl) return { msg: fromColl, via: "getMessages" };
  } catch { /* fall through */ }
  return { msg: undefined, via: "not-found" };
}

// --- buffered diagnostic logging -------------------------------------------
// Synchronous file I/O on Discord's renderer thread is dangerous: on a hot
// path it freezes the renderer, which Discord then reloads as "unresponsive".
// We buffer log lines in memory and flush them on a timer instead.
const logBuffer: string[] = [];
function activity(line: string): void {
  logBuffer.push(new Date().toISOString() + " " + line);
}
function flushActivity(): void {
  if (logBuffer.length === 0) return;
  const lines = logBuffer.splice(0, logBuffer.length);
  try {
    const n = native();
    const p = `${n.root}/vdm-activity.log`;
    n.writeText(p, (n.readText(p) ?? "") + lines.join("\n") + "\n");
  } catch { /* ignore */ }
}

// Timers / listeners we own, cleared on stop().
let diagTimers: ReturnType<typeof setInterval>[] = [];
let unloadHandler: (() => void) | null = null;

const plugin: DiscreatePlugin = {
  name: "Message Logger",
  description: "Keeps deleted messages, logs edits with history, and adds a message log panel.",
  authors: ["Discreate"],

  start(ctx: PluginContext) {
    const opts = ctx.options as { logging?: boolean; logCap?: number };
    const logging = opts.logging ?? true;
    const logCap = opts.logCap ?? 500;

    const Dispatcher = Discreate.FluxDispatcher;
    if (!Dispatcher || typeof Dispatcher.dispatch !== "function") {
      log.error("FluxDispatcher unavailable — plugin cannot start");
      return;
    }

    /**
     * Capture a single deletion. Returns true if the message was found and
     * kept (so the dispatch can be swallowed), false if we couldn't handle it
     * (so the normal delete should proceed).
     */
    function keep(channelId: string, messageId: string): boolean {
      try {
        const store = messageStore();
        const { msg, via } = retrieveMessage(store, channelId, messageId);
        if (!msg) {
          const tag = (() => {
            try { return store?.getName?.() ?? Object.prototype.toString.call(store); }
            catch { return "?"; }
          })();
          activity(
            `  keep FAIL: store=${tag} ` +
            `getMessage=${typeof store?.getMessage} getMessages=${typeof store?.getMessages} via=${via}`,
          );
          log.warn(`delete ${messageId}: not in store (store=${tag}, via=${via})`);
          return false;
        }
        activity(`  retrieved message via ${via}`);
        try { msg.deleted = true; } catch { /* immutable record */ }

        markDeleted(channelId, messageId);

        if (logging) {
          recordDeleted({
            channelId,
            messageId,
            author: msg.author?.username ?? msg.author?.globalName ?? "unknown",
            content: msg.content ?? "",
            timestamp: Date.now(),
          }, logCap);
        }
        log.log(`kept deleted message from ${msg.author?.username ?? "?"}: ${(msg.content ?? "").slice(0, 80)}`);
        return true;
      } catch (err) {
        log.error("keep failed:", err);
        return false;
      }
    }

    activity("plugin start — dispatch patch installed");

    // Flush the buffered log periodically; a crash loses at most ~1.5s of it.
    diagTimers.push(setInterval(flushActivity, 1500));

    // Freeze detector: a 500ms interval that should fire on time. If more than
    // 1.5s elapsed between firings, the renderer's main thread was blocked —
    // that gap pinpoints exactly when (and roughly how long) it froze.
    let lastBeat = Date.now();
    diagTimers.push(setInterval(() => {
      const now = Date.now();
      const gap = now - lastBeat;
      if (gap > 1500) activity(`FREEZE: renderer main thread blocked ~${gap}ms`);
      lastBeat = now;
    }, 500));

    let dispatchCount = 0;
    // After a kept delete, briefly log every action type so we can see what
    // Discord does next. Buffered, so it costs nothing on the hot path.
    let traceUntil = 0;

    /**
     * Replace a delete action with an inert renamed copy and dispatch THAT.
     *
     * We must never skip the real dispatcher: `dispatch()` returns a Promise
     * that Discord's own code awaits, and bypassing the pipeline leaves it
     * inconsistent (observed: the renderer reloads a few seconds later). Every
     * Flux store keys its handlers on `action.type`, so an unknown type is a
     * harmless no-op — the message is never removed, yet `dispatch()` behaves
     * exactly as callers expect.
     */
    function dispatchInert(originalDispatch: (a: any) => any, action: any): any {
      return originalDispatch({ ...action, type: "DISCREATE_KEPT_DELETE" });
    }

    // Intercept the Flux dispatch. On a delete we capture+keep the message and
    // neutralise the action so Discord never removes it from the store/UI.
    instead(OWNER, Dispatcher, "dispatch", (args, originalDispatch) => {
      const action = args[0];
      dispatchCount++;
      if (dispatchCount === 1) activity("first dispatch intercepted — patch is live");

      if (traceUntil && Date.now() < traceUntil && action?.type
          && action.type !== "DISCREATE_KEPT_DELETE") {
        activity(`  trace: ${action.type}`);
      }

      if (action?.type === "MESSAGE_DELETE") {
        if (action.discreateLocalDelete) {
          activity(`local delete passthrough ${action.id}`);
          return originalDispatch(action);
        }
        activity(`MESSAGE_DELETE seen: channel=${action.channelId} id=${action.id}`);
        if (keep(action.channelId, action.id)) {
          activity("  -> kept; dispatching neutralized action");
          traceUntil = Date.now() + 10000;
          return dispatchInert(originalDispatch, action);
        }
        activity("  -> could not keep; normal delete");
        return originalDispatch(action);
      }

      if (action?.type === "MESSAGE_DELETE_BULK") {
        activity(`MESSAGE_DELETE_BULK seen: channel=${action.channelId} count=${(action.ids ?? []).length}`);
        let keptAny = false;
        for (const id of action.ids ?? []) {
          if (keep(action.channelId, id)) keptAny = true;
        }
        if (keptAny) {
          activity("  -> kept bulk; dispatching neutralized action");
          traceUntil = Date.now() + 10000;
          return dispatchInert(originalDispatch, action);
        }
        return originalDispatch(action);
      }

      if (action?.type === "MESSAGE_UPDATE" && action.message) {
        try {
          const updated = action.message;
          const store = messageStore();
          const old = store?.getMessage?.(updated.channel_id, updated.id);
          const entry: EditEntry | null = old ? makeEditEntryFromStore(old, updated) : null;
          if (entry) {
            const list = editHistory.get(updated.id) ?? [];
            list.push(entry);
            editHistory.set(updated.id, list);
            if (logging) {
              recordEdit({
                channelId: updated.channel_id,
                messageId: updated.id,
                author: updated.author?.username ?? old?.author?.username ?? "unknown",
                history: list,
                timestamp: Date.now(),
              }, logCap);
            }
            activity(`MESSAGE_UPDATE edit recorded for ${updated.id} (${list.length} versions)`);
          }
        } catch (err) {
          log.error("edit capture failed:", err);
        }
        // Edits are NOT swallowed — let the message update normally.
        return originalDispatch(action);
      }

      return originalDispatch(action);
    });

    startDomLayer();

    setLocalDeleteHandler((channelId, messageId) => {
      try {
        unmarkDeleted(channelId, messageId);
        editHistory.delete(messageId);
        removeDeleted(messageId);
        // Dispatch a genuine MESSAGE_DELETE so Discord's stores drop the message.
        // `discreateLocalDelete` lets our own interceptor recognise and pass it.
        Dispatcher.dispatch({ type: "MESSAGE_DELETE", channelId, id: messageId, discreateLocalDelete: true });
        activity(`local delete ${messageId}`);
      } catch (err) {
        log.error("local delete failed:", err);
      }
    });

    // Flush the buffered log when the renderer unloads, so a reload never
    // hides the action stream that led up to it.
    unloadHandler = () => { activity("renderer beforeunload"); flushActivity(); };
    window.addEventListener("beforeunload", unloadHandler);

    log.log("started — intercepting MESSAGE_DELETE / MESSAGE_DELETE_BULK");
  },

  stop() {
    for (const t of diagTimers) clearInterval(t);
    diagTimers = [];
    if (unloadHandler) {
      window.removeEventListener("beforeunload", unloadHandler);
      unloadHandler = null;
    }
    activity("plugin stop");
    flushActivity();
    stopDomLayer();
    log.log("stopped");
  },
};

export default plugin;
