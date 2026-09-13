import type { DiscreatePlugin } from "../../api/index.js";
import { createAutoTranslate } from "./implementation.js";

let instance: any;

const plugin: DiscreatePlugin = {
  name: "AutoTranslate",
  description: "Automatically translates visible chat messages. Hover to read the original. Sends message text to Google; DMs are off by default.",
  authors: ["Snues", "Discreate"],
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
