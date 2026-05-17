// src/renderer/plugins/viewDeletedMessages/index.ts
import { Discreate } from "../../api/index.js";
import type { DiscreatePlugin, PluginContext } from "../../api/index.js";
import { findByProps } from "../../core/webpack.js";
import { after, instead } from "../../core/patcher.js";
import { makeLogger } from "../../core/logger.js";
import { native } from "../../core/paths.js";

const log = makeLogger("ViewDeletedMessages");
const OWNER = "viewDeletedMessages";

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

const plugin: DiscreatePlugin = {
  name: "View Deleted Messages",
  description:
    "Keeps deleted messages visible with a red highlight, logs them, and lets you remove messages from your own view.",
  authors: ["Discreate"],

  start(ctx: PluginContext) {
    const opts = ctx.options as { redHighlight?: boolean; logging?: boolean; logCap?: number };
    const redHighlight = opts.redHighlight ?? true;
    const logging = opts.logging ?? true;
    const logCap = opts.logCap ?? 500;

    const Dispatcher = Discreate.FluxDispatcher;
    const MessageStore = findByProps("getMessage", "getMessages");

    // 1. Intercept delete actions: mark + keep instead of removing.
    instead(OWNER, Dispatcher, "dispatch", (args, originalDispatch) => {
      const action = args[0];
      if (action?.type === "MESSAGE_DELETE" && !action.__discreateLocal) {
        const msg = MessageStore?.getMessage(action.channelId, action.id);
        if (msg) {
          msg.deleted = true;
          if (logging) {
            appendLog({
              channelId: action.channelId, messageId: action.id,
              author: msg.author?.username ?? "unknown",
              content: msg.content ?? "", timestamp: Date.now(),
            }, logCap);
          }
          // Trigger a re-render without removing the message.
          return originalDispatch({ type: "MESSAGE_UPDATE", message: msg });
        }
      }
      if (action?.type === "MESSAGE_DELETE_BULK") {
        for (const id of action.ids ?? []) {
          const msg = MessageStore?.getMessage(action.channelId, id);
          if (msg) {
            msg.deleted = true;
            if (logging) {
              appendLog({
                channelId: action.channelId, messageId: id,
                author: msg.author?.username ?? "unknown",
                content: msg.content ?? "", timestamp: Date.now(),
              }, logCap);
            }
          }
        }
        return; // swallow the bulk removal entirely
      }
      return originalDispatch(action);
    });

    // 2. Red-highlight deleted messages in the rendered row.
    if (redHighlight) {
      const MessageRow = findByProps("MessageListItem");
      if (MessageRow) {
        after(OWNER, MessageRow, "default", (rowArgs, rowResult) => {
          const msg = rowArgs[0]?.message;
          if (msg?.deleted && rowResult?.props) {
            rowResult.props.style = {
              ...(rowResult.props.style ?? {}),
              backgroundColor: "rgba(240, 71, 71, 0.15)",
              borderLeft: "3px solid #f04747",
            };
          }
          return rowResult;
        });
      } else {
        log.warn("message row module not found; red highlight disabled this session");
      }
    }

    // 3. Manual client-side delete: expose a window helper used by the
    //    context-menu patch below to drop a message from the local store.
    (window as any).DiscreateLocalDelete = (channelId: string, messageId: string) => {
      Dispatcher.dispatch({ type: "MESSAGE_DELETE", channelId, id: messageId, __discreateLocal: true });
    };

    log.log("started");
  },

  stop() {
    delete (window as any).DiscreateLocalDelete;
    log.log("stopped");
  },
};

export default plugin;
