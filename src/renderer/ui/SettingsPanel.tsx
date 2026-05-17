// src/renderer/ui/SettingsPanel.tsx
import { Discreate } from "../api/index.js";
import type { PluginManager } from "../core/plugins.js";
import type { ThemeManager } from "../core/themes.js";
import type { SettingsStore } from "../core/settings.js";

declare const window: any;

interface Props {
  plugins: PluginManager;
  themes: ThemeManager;
  settings: SettingsStore;
}

export function SettingsPanel({ plugins, themes, settings }: Props) {
  const React = Discreate.React;
  const [tab, setTab] = React.useState<"plugins" | "themes" | "about">("plugins");
  const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0);

  const tabBtn = (id: typeof tab, label: string) =>
    React.createElement(
      "button",
      {
        onClick: () => setTab(id),
        style: {
          padding: "6px 12px", marginRight: 8, cursor: "pointer",
          background: tab === id ? "#5865F2" : "#2b2d31",
          color: "#fff", border: "none", borderRadius: 4,
        },
      },
      label,
    );

  const row = (label: string, desc: string, enabled: boolean, onToggle: () => void) =>
    React.createElement(
      "div",
      { style: { display: "flex", padding: "10px 0", borderBottom: "1px solid #2b2d31" } },
      React.createElement(
        "div", { style: { flex: 1 } },
        React.createElement("div", { style: { color: "#fff", fontWeight: 600 } }, label),
        React.createElement("div", { style: { color: "#b5bac1", fontSize: 13 } }, desc),
      ),
      React.createElement(
        "input",
        { type: "checkbox", checked: enabled, onChange: () => { onToggle(); forceUpdate(); } },
      ),
    );

  let body;
  if (tab === "plugins") {
    body = plugins.all().map((entry) =>
      row(entry.plugin.name, entry.plugin.description, plugins.isEnabled(entry.id),
        () => plugins.setEnabled(entry.id, !plugins.isEnabled(entry.id))));
  } else if (tab === "themes") {
    const enabled = new Set(settings.getEnabledThemes());
    body = themes.list().map((file) =>
      row(file, "CSS theme", enabled.has(file),
        () => themes.setEnabled(file, !enabled.has(file))));
    if (themes.list().length === 0) {
      body = React.createElement("div", { style: { color: "#b5bac1" } },
        "No themes. Drop .css files into ~/.discreate/themes");
    }
  } else {
    body = React.createElement("div", { style: { color: "#b5bac1" } },
      "Discreate 0.1.0 — a Discord client mod. Data lives in ~/.discreate");
  }

  return React.createElement(
    "div", { style: { padding: 16, color: "#fff" } },
    React.createElement("h2", { style: { color: "#fff" } }, "Discreate"),
    React.createElement("div", { style: { margin: "12px 0" } },
      tabBtn("plugins", "Plugins"), tabBtn("themes", "Themes"), tabBtn("about", "About")),
    React.createElement("div", null, body),
  );
}
