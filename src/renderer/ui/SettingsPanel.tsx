// src/renderer/ui/SettingsPanel.tsx
import { Discreate } from "../api/index.js";
import { native } from "../core/paths.js";
import { makeLogger } from "../core/logger.js";
import type { PluginManager } from "../core/plugins.js";
import type { ThemeManager } from "../core/themes.js";
import type { SettingsStore } from "../core/settings.js";

declare const window: any;

const log = makeLogger("settings-ui");

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

  const smallBtn = (label: string, onClick: () => void, color = "#4e5058") =>
    React.createElement(
      "button",
      {
        onClick,
        style: {
          padding: "4px 10px", marginLeft: 6, cursor: "pointer",
          background: color, color: "#fff", border: "none", borderRadius: 4,
          fontSize: 13,
        },
      },
      label,
    );

  const headerRow = (...children: any[]) =>
    React.createElement(
      "div",
      { style: { display: "flex", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #2b2d31" } },
      ...children,
    );

  const row = (label: string, desc: string, enabled: boolean, onToggle: () => void, extra?: any) =>
    React.createElement(
      "div",
      { style: { display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #2b2d31" } },
      React.createElement(
        "div", { style: { flex: 1 } },
        React.createElement("div", { style: { color: "#fff", fontWeight: 600 } }, label),
        React.createElement("div", { style: { color: "#b5bac1", fontSize: 13 } }, desc),
      ),
      extra,
      React.createElement(
        "input",
        {
          type: "checkbox", checked: enabled,
          style: { marginLeft: 10 },
          onChange: () => { onToggle(); forceUpdate(); },
        },
      ),
    );

  const installFromUrl = async (folder: string, kind: "theme" | "plugin") => {
    const url = window.prompt(`Install ${kind} from URL:`);
    if (!url) return;
    try {
      const saved = await native().downloadToFolder(url, folder);
      log.log(`installed ${kind} ${saved}`);
      forceUpdate();
      window.alert(`Installed ${saved}. Reload Discord (Cmd+R) to load it.`);
    } catch (err) {
      window.alert(`Install failed: ${(err as Error).message}`);
    }
  };

  const reinject = async () => {
    try {
      const res = await native().reinject();
      window.alert(`Reinjected ${res.patched.length} install(s). Restart Discord to apply.`);
    } catch (err) {
      window.alert(`Reinject failed: ${(err as Error).message}`);
    }
  };

  let body: any;
  if (tab === "plugins") {
    const header = headerRow(
      React.createElement("div", { style: { flex: 1, color: "#b5bac1", fontSize: 13 } },
        `${plugins.all().length} plugin(s) loaded`),
      smallBtn("Refresh", () => forceUpdate()),
      smallBtn("Open folder", () => native().openFolder(native().pluginsDir)),
      smallBtn("Install from URL…", () => installFromUrl(native().pluginsDir, "plugin")),
    );
    const items = plugins.all().map((entry) => {
      const isUser = entry.source === "user";
      const deleteBtn = isUser && entry.path
        ? smallBtn("Delete", () => {
            if (!window.confirm(`Delete plugin ${entry.id}?`)) return;
            try {
              plugins.setEnabled(entry.id, false);
              native().deleteFile(entry.path!);
              plugins.unregister(entry.id);
              forceUpdate();
            } catch (err) {
              window.alert(`Delete failed: ${(err as Error).message}`);
            }
          }, "#d83c3e")
        : null;
      return row(
        entry.plugin.name + (isUser ? "" : "  (built-in)"),
        entry.plugin.description,
        plugins.isEnabled(entry.id),
        () => plugins.setEnabled(entry.id, !plugins.isEnabled(entry.id)),
        deleteBtn,
      );
    });
    body = React.createElement(React.Fragment, null, header, ...items);
  } else if (tab === "themes") {
    const enabled = new Set(settings.getEnabledThemes());
    const list = themes.list();
    const header = headerRow(
      React.createElement("div", { style: { flex: 1, color: "#b5bac1", fontSize: 13 } },
        `${list.length} theme(s) in ${native().themesDir}`),
      smallBtn("Refresh", () => forceUpdate()),
      smallBtn("Open folder", () => native().openFolder(native().themesDir)),
      smallBtn("Install from URL…", () => installFromUrl(native().themesDir, "theme")),
    );
    const items = list.length === 0
      ? [React.createElement("div", { style: { color: "#b5bac1", padding: 10 } },
          "No themes. Drop .css files into ~/.discreate/themes")]
      : list.map((file) =>
          row(file, "CSS theme", enabled.has(file),
            () => themes.setEnabled(file, !enabled.has(file)),
            smallBtn("Delete", () => {
              if (!window.confirm(`Delete theme ${file}?`)) return;
              try {
                if (enabled.has(file)) themes.setEnabled(file, false);
                native().deleteFile(`${native().themesDir}/${file}`);
                forceUpdate();
              } catch (err) {
                window.alert(`Delete failed: ${(err as Error).message}`);
              }
            }, "#d83c3e"),
          ));
    body = React.createElement(React.Fragment, null, header, ...items);
  } else {
    body = React.createElement("div", null,
      React.createElement("div", { style: { color: "#b5bac1", marginBottom: 12 } },
        "Discreate 0.1.0 — a Discord client mod. Data lives in ~/.discreate"),
      smallBtn("Reinject Discreate", reinject, "#5865F2"),
    );
  }

  return React.createElement(
    "div", { style: { padding: 16, color: "#fff" } },
    React.createElement("div", { style: { marginBottom: 12 } },
      tabBtn("plugins", "Plugins"), tabBtn("themes", "Themes"), tabBtn("about", "About")),
    React.createElement("div", null, body),
  );
}
