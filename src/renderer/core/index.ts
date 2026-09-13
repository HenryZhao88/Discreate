// src/renderer/core/index.ts
import { initWebpack, waitFor, byProps, forceLoadAllChunks, findFluxDispatcher, waitForMainWebpack } from "./webpack.js";
import { resolveReactDOM } from "./react-dom.js";
import { SettingsStore, nativeBackend } from "./settings.js";
import { ThemeManager } from "./themes.js";
import { PluginManager, loadUserPlugins } from "./plugins.js";
import { makeLogger } from "./logger.js";
import { Discreate } from "../api/index.js";
import { installBdApi, setPluginManagerRef } from "../api/bd-api.js";
import { injectSettings } from "../ui/inject-settings.js";
import viewDeletedMessages from "../plugins/viewDeletedMessages/index.js";
import readAll from "../plugins/readAll/index.js";
import forceOwnerCrown from "../plugins/forceOwnerCrown/index.js";
import memberCount from "../plugins/memberCount/index.js";
import relationshipNotifier from "../plugins/relationshipNotifier/index.js";
import showHiddenChannels from "../plugins/showHiddenChannels/index.js";
import showHiddenThings from "../plugins/showHiddenThings/index.js";
import autoTranslate from "../plugins/autoTranslate/index.js";

const log = makeLogger("core");

async function boot(): Promise<void> {
  log.log("booting");
  initWebpack();
  await waitForMainWebpack();

  const settings = new SettingsStore(nativeBackend());
  const themes = new ThemeManager(settings);
  const plugins = new PluginManager(settings);

  plugins.register("viewDeletedMessages", viewDeletedMessages, "builtin");
  plugins.register("readAll", readAll, "builtin");
  plugins.register("forceOwnerCrown", forceOwnerCrown, "builtin");
  plugins.register("memberCount", memberCount, "builtin");
  plugins.register("relationshipNotifier", relationshipNotifier, "builtin");
  plugins.register("showHiddenChannels", showHiddenChannels, "builtin");
  plugins.register("showHiddenThings", showHiddenThings, "builtin");
  plugins.register("autoTranslate", autoTranslate, "builtin");

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
    forceLoadAllChunks().catch((err) => log.warn("chunk loading failed:", err)).then(() => {
      // Discord's React 19 client exports only createRoot. Property-only
      // lookups can also select localization objects or compatibility proxies.
      Discreate.ReactDOM = undefined;
      try { Discreate.ReactDOM = resolveReactDOM(React.version); }
      catch (error) { log.error("ReactDOM discovery failed:", error); }
      log.log("ReactDOM provider", JSON.stringify({
        reactVersion: React.version,
        createRoot: typeof Discreate.ReactDOM?.createRoot,
        render: typeof Discreate.ReactDOM?.render,
      }));

      // Locate the live FluxDispatcher *instance* via a Flux store's
      // `_dispatcher` back-reference.
      Discreate.FluxDispatcher = findFluxDispatcher();
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
    }).catch((err) => log.error("bootstrap failed:", err));
  });
}

void boot().catch((err) => log.error("boot failed:", err));
