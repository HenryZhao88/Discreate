// src/renderer/core/index.ts
import { initWebpack, findByProps, waitFor, byProps } from "./webpack.js";
import { SettingsStore, nativeBackend } from "./settings.js";
import { ThemeManager } from "./themes.js";
import { PluginManager, loadUserPlugins } from "./plugins.js";
import { makeLogger } from "./logger.js";
import { Discreate } from "../api/index.js";
import { installBdApi, setPluginManagerRef } from "../api/bd-api.js";
import { injectSettings } from "../ui/inject-settings.js";
import viewDeletedMessages from "../plugins/viewDeletedMessages/index.js";

const log = makeLogger("core");

function boot(): void {
  log.log("booting");
  initWebpack();

  const settings = new SettingsStore(nativeBackend());
  const themes = new ThemeManager(settings);
  const plugins = new PluginManager(settings);

  plugins.register("viewDeletedMessages", viewDeletedMessages, "builtin");

  // Wait for Discord's React and FluxDispatcher before installing BdApi,
  // loading user plugins (BD plugins need window.BdApi during evaluation),
  // and starting things up.
  waitFor(byProps("createElement", "useState"), (React) => {
    Discreate.React = React;
    Discreate.ReactDOM = findByProps("render", "createRoot");
    Discreate.FluxDispatcher = findByProps("dispatch", "subscribe");

    setPluginManagerRef(plugins);
    try { installBdApi(); log.log("BdApi installed"); }
    catch (err) { log.error("installBdApi failed:", err); }

    try { loadUserPlugins(plugins); }
    catch (err) { log.error("loadUserPlugins failed:", err); }

    themes.start();
    plugins.startEnabled();
    injectSettings({ plugins, themes, settings });
    log.log("ready");
  });
}

boot();
