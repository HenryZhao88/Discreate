import type { DiscreatePlugin } from "../../api/index.js";
import { createAutoTranslate } from "./implementation.js";

let instance: any;

const plugin: DiscreatePlugin & { getDiagnostics(): any } = {
  name: "AutoTranslate",
  description: "Automatically translates visible chat messages. Right-click a translated message to show the original. Sends message text to Google; DMs are off by default.",
  authors: ["Snues", "Discreate"],
  getDiagnostics() {
    return instance ? {
      active: instance.active, patched: !!instance.patched, modulesReady: !!instance.modules,
      target: instance.targetLang, seen: instance.settings.seen,
      visible: instance.visible?.size ?? 0, subscribed: instance.subs.size,
      cached: instance.cache.size, skipped: instance.skipped.size, pending: instance.pending.size,
      queued: instance.queue.length, paused: instance.paused, busy: instance.busy,
    } : { active: false };
  },
  start() {
    const BdApi = (window as any).BdApi;
    if (!BdApi?.React) throw new Error("AutoTranslate requires BdApi and Discord React");
    const AutoTranslate = createAutoTranslate(BdApi);
    instance = new AutoTranslate({ name: "AutoTranslate" });
    instance.start();
  },
  stop() {
    instance?.stop();
    instance = undefined;
  },
  getSettingsPanel() {
    if (!instance) throw new Error("Enable AutoTranslate before opening its settings");
    return instance.getSettingsPanel();
  },
};

export default plugin;
