// src/renderer/core/index.ts
import { initWebpack, findByProps, waitFor, byProps } from "./webpack.js";
import { SettingsStore, nativeBackend } from "./settings.js";
import { ThemeManager } from "./themes.js";
import { PluginManager } from "./plugins.js";
import { makeLogger } from "./logger.js";
import { Discreate } from "../api/index.js";
import { injectSettings } from "../ui/inject-settings.js";
import viewDeletedMessages from "../plugins/viewDeletedMessages/index.js";

const log = makeLogger("core");

function boot(): void {
  log.log("booting");
  initWebpack();

  const settings = new SettingsStore(nativeBackend());
  const themes = new ThemeManager(settings);
  const plugins = new PluginManager(settings);

  plugins.register("viewDeletedMessages", viewDeletedMessages);

  // Wait for Discord's React and FluxDispatcher before starting plugins/UI.
  waitFor(byProps("createElement", "useState"), (React) => {
    Discreate.React = React;
    Discreate.ReactDOM = findByProps("render", "createRoot");
    Discreate.FluxDispatcher = findByProps("dispatch", "subscribe");

    themes.start();
    plugins.startEnabled();
    injectSettings({ plugins, themes, settings });
    log.log("ready");
  });
}

boot();
