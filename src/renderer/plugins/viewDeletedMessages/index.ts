// src/renderer/plugins/viewDeletedMessages/index.ts
import { Discreate } from "../../api/index.js";
import type { DiscreatePlugin, PluginContext } from "../../api/index.js";
import { findByProps, findByPropsLazy } from "../../core/webpack.js";
import { instead } from "../../core/patcher.js";
import { makeLogger } from "../../core/logger.js";
import { native } from "../../core/paths.js";

const log = makeLogger("ViewDeletedMessages");
const OWNER = "viewDeletedMessages";
const STYLE_ID = "discreate-vdm-style";

interface DeletedRecord {
  channelId: string;
  messageId: string;
  author: string;
  content: string;
  timestamp: number;
}

function loadLog(): DeletedRecord[] {
  const raw = native().readDeletedLog();
  if (!raw) return [];
  try {
    return JSON.parse(raw) as DeletedRecord[];
  } catch {
    return [];
  }
}

function appendLog(record: DeletedRecord, cap: number): void {
  const records = loadLog();
  records.push(record);
  while (records.length > cap) records.shift();
  native().writeDeletedLog(JSON.stringify(records, null, 2));
}

/** Resolve Discord's MessageStore lazily — it loads on first channel open. */
let messageStoreCache: any = null;
function messageStore(): any {
  if (messageStoreCache?.getMessage) return messageStoreCache;
  messageStoreCache =
    findByProps("getMessage", "getMessages") ??
    findByPropsLazy("getMessage", "getMessages");
  return messageStoreCache;
}

// IDs of messages we've kept after deletion. Discord renders each message in
// an element `id="chat-messages-{channelId}-{messageId}"`, so we highlight
// purely with CSS — no fragile React component patching.
const deletedIds = new Set<string>();

function refreshStyle(): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  const rules = [...deletedIds]
    .map(
      (id) =>
        `#chat-messages-${id} {\n` +
        `  background-color: rgba(240, 71, 71, 0.10) !important;\n` +
        `  border-left: 3px solid #f04747 !important;\n` +
        `}`,
    )
    .join("\n");
  el.textContent = rules;
}

const plugin: DiscreatePlugin = {
  name: "View Deleted Messages",
  description:
    "Keeps deleted messages visible with a red highlight and logs every deletion.",
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
        const msg = store?.getMessage?.(channelId, messageId);
        if (!msg) {
          log.warn(`delete ${messageId}: not in store (store found=${!!store?.getMessage})`);
          return false;
        }
        try { msg.deleted = true; } catch { /* immutable record */ }

        deletedIds.add(`${channelId}-${messageId}`);
        refreshStyle();

        if (logging) {
          appendLog({
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

    // Diagnostic file log so we can verify interception without DevTools.
    let dispatchCount = 0;
    function activity(line: string): void {
      try {
        const n = native();
        const p = `${n.root}/vdm-activity.log`;
        n.writeText(p, (n.readText(p) ?? "") + new Date().toISOString() + " " + line + "\n");
      } catch { /* ignore */ }
    }
    activity("plugin start — dispatch patch installed");

    // Intercept the Flux dispatch. On a delete we capture+keep the message and
    // swallow the action so Discord never removes it from the store/UI.
    instead(OWNER, Dispatcher, "dispatch", (args, originalDispatch) => {
      const action = args[0];
      dispatchCount++;
      if (dispatchCount === 1) activity("first dispatch intercepted — patch is live");

      if (action?.type === "MESSAGE_DELETE") {
        activity(`MESSAGE_DELETE seen: channel=${action.channelId} id=${action.id}`);
        if (keep(action.channelId, action.id)) {
          activity("  -> kept + swallowed");
          return undefined; // swallow
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
        if (keptAny) return undefined; // swallow the bulk removal
        return originalDispatch(action);
      }

      return originalDispatch(action);
    });

    log.log("started — intercepting MESSAGE_DELETE / MESSAGE_DELETE_BULK");
  },

  stop() {
    deletedIds.clear();
    document.getElementById(STYLE_ID)?.remove();
    log.log("stopped");
  },
};

export default plugin;
