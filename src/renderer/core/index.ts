// src/renderer/core/index.ts
import { initWebpack, findByProps, find, waitFor, byProps, byCode, forceLoadAllChunks } from "./webpack.js";
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

    // BD plugins assume every Discord module is reachable at boot. Force-load
    // all lazy chunks AND evaluate every factory so finders can see
    // MessageStore, ChannelStore, FluxDispatcher, etc. Without this, only the
    // entry-bundle modules (~100) are in the cache and almost every Flux store
    // looks "missing".
    forceLoadAllChunks().finally(() => {
      // ReactDOM 18 ships `createRoot` in `react-dom/client` and the legacy
      // `render` in `react-dom`; finders for the union miss. Pull both and
      // present a merged object.
      const rdomClient = findByProps("createRoot", "hydrateRoot");
      const rdomLegacy = findByProps("render", "unmountComponentAtNode");
      if (rdomClient || rdomLegacy) Discreate.ReactDOM = { ...rdomClient, ...rdomLegacy };

      // The real Flux dispatcher has a uniquely identifiable error message in
      // its source — "Cannot dispatch in the middle of a dispatch" is straight
      // from the Flux reference implementation and is present in every
      // version. This is far more reliable than prop-based finders.
      Discreate.FluxDispatcher = find(byCode("Cannot dispatch in the middle of a dispatch"));
      // Fall back to prop-based finders just in case the error text changed.
      if (!Discreate.FluxDispatcher) {
        Discreate.FluxDispatcher =
          findByProps("dispatch", "subscribe", "register") ??
          findByProps("dispatch", "subscribe", "_actionHandlers") ??
          findByProps("dispatch", "subscribe", "_subscriptions") ??
          findByProps("dispatch", "subscribe");
      }
      log.log(`bootstrap modules — FluxDispatcher: ${Discreate.FluxDispatcher ? "ok" : "MISSING"}, ReactDOM: ${Discreate.ReactDOM ? "ok" : "MISSING"}`);

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
  });
}

boot();
