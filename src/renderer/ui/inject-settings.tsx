// src/renderer/ui/inject-settings.tsx
import { Discreate } from "../api/index.js";
import { findByProps } from "../core/webpack.js";
import { after } from "../core/patcher.js";
import { makeLogger } from "../core/logger.js";
import { SettingsPanel } from "./SettingsPanel.js";
import type { PluginManager } from "../core/plugins.js";
import type { ThemeManager } from "../core/themes.js";
import type { SettingsStore } from "../core/settings.js";

const log = makeLogger("settings-ui");

interface Deps {
  plugins: PluginManager;
  themes: ThemeManager;
  settings: SettingsStore;
}

/**
 * Patches Discord's settings section generator to add a "Discreate" entry.
 * Discord builds the settings sidebar from an array of section descriptors;
 * the module exposing `getUserSettingsSections` (or similar) is patched so an
 * extra section rendering <SettingsPanel/> is appended.
 */
export function injectSettings(deps: Deps): void {
  const React = Discreate.React;

  // The settings sections module exports a function returning the section list.
  const sectionsMod = findByProps("getUserSettingsSections");
  if (!sectionsMod) {
    log.warn("settings sections module not found; settings UI not injected");
    return;
  }

  after("discreate-settings", sectionsMod, "getUserSettingsSections", (_args, sections) => {
    if (!Array.isArray(sections)) return sections;
    sections.push({
      section: "DISCREATE",
      label: "Discreate",
      element: () => React.createElement(SettingsPanel, deps),
    });
    return sections;
  });
  log.log("settings panel injected");
}
