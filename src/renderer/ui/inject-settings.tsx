// src/renderer/ui/inject-settings.tsx
//
// Floating modal entrypoint for the Discreate settings UI.
//
// Why a modal instead of a real settings-sidebar section?
// In current Discord (>= 0.0.390) the section-list builder is heavily minified
// with no stable string keys, and the obvious `getUserSettingsSections`-named
// export is actually an i18n helper that never holds the live section array.
// Patching it succeeds but accomplishes nothing. A standalone overlay sidesteps
// the brittle hook entirely: it works on any Discord version because it only
// depends on Discord's React (which we already have on `Discreate.React`).
//
// The modal opens via:
//   1. A "🛠 Discreate" floating button in the bottom-right corner.
//   2. A global Cmd/Ctrl+Shift+D shortcut.
// Backdrop click and Escape close it.

import { Discreate } from "../api/index.js";
import { findByProps } from "../core/webpack.js";
import { makeLogger } from "../core/logger.js";
import { native } from "../core/paths.js";
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

// Tiny pub-sub so the keyboard listener can poke React state from outside the tree.
type Listener = (open: boolean | "toggle") => void;
const listeners = new Set<Listener>();
function publish(value: boolean | "toggle"): void {
  for (const fn of listeners) {
    try { fn(value); } catch (err) { log.warn("listener error", err); }
  }
}

export function injectSettings(deps: Deps): void {
  const React = Discreate.React;
  const ReactDOM = Discreate.ReactDOM;
  if (!React || !ReactDOM) {
    log.warn("React/ReactDOM not available; settings UI not mounted");
    return;
  }

  // Avoid double-mount on hot reloads.
  let host = document.getElementById("discreate-modal-root");
  if (host) {
    log.log("modal root already present; skipping mount");
    return;
  }
  host = document.createElement("div");
  host.id = "discreate-modal-root";
  document.body.appendChild(host);

  function App(): any {
    const [open, setOpen] = React.useState(false);

    React.useEffect(() => {
      const onMsg: Listener = (v) => setOpen((cur: boolean) => (v === "toggle" ? !cur : !!v));
      listeners.add(onMsg);
      return () => { listeners.delete(onMsg); };
    }, []);

    React.useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (open && e.key === "Escape") {
          e.preventDefault();
          setOpen(false);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    const button = React.createElement(
      "button",
      {
        onClick: () => setOpen(true),
        title: "Open Discreate settings (Cmd/Ctrl+Shift+D)",
        style: {
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 9999,
          padding: "8px 14px",
          background: "#2b2d31",
          color: "#fff",
          border: "1px solid #1e1f22",
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
        },
        onMouseEnter: (e: any) => { e.currentTarget.style.background = "#3a3c43"; },
        onMouseLeave: (e: any) => { e.currentTarget.style.background = "#2b2d31"; },
      },
      "🛠 Discreate",
    );

    if (!open) return button;

    const backdrop = React.createElement(
      "div",
      {
        onClick: () => setOpen(false),
        style: {
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          zIndex: 10000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
      },
      React.createElement(
        "div",
        {
          onClick: (e: any) => e.stopPropagation(),
          style: {
            width: "min(720px, 92vw)",
            maxHeight: "80vh",
            background: "#1e1f22",
            border: "1px solid #2b2d31",
            borderRadius: 8,
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              padding: "12px 16px",
              borderBottom: "1px solid #2b2d31",
            },
          },
          React.createElement(
            "div",
            { style: { flex: 1, fontWeight: 700, fontSize: 16 } },
            "🛠 Discreate",
          ),
          React.createElement(
            "button",
            {
              onClick: () => setOpen(false),
              "aria-label": "Close",
              style: {
                background: "#2b2d31",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                padding: "4px 10px",
              },
            },
            "✕",
          ),
        ),
        React.createElement(
          "div",
          { style: { flex: 1, overflow: "auto" } },
          React.createElement(SettingsPanel, deps),
        ),
      ),
    );

    return React.createElement(React.Fragment, null, button, backdrop);
  }

  // Render. Discord ships React 18, but the module exporting `createRoot` is
  // not always the same as the one that has both `render` and `createRoot`.
  // Probe several candidates and fall through on any failure.
  const candidates: any[] = [];
  if (ReactDOM) candidates.push(ReactDOM);
  for (const probe of [
    findByProps("createRoot", "hydrateRoot"),
    findByProps("createRoot", "flushSync"),
    findByProps("createPortal", "createRoot"),
    findByProps("render", "hydrate"),
    findByProps("render", "unmountComponentAtNode"),
  ]) {
    if (probe && !candidates.includes(probe)) candidates.push(probe);
  }

  const element = React.createElement(App, null);
  let rendered = false;
  for (const dom of candidates) {
    if (rendered) break;
    if (typeof dom.createRoot === "function") {
      try {
        const root = dom.createRoot(host);
        if (root && typeof root.render === "function") {
          root.render(element);
          rendered = true;
          break;
        }
      } catch (err) {
        log.warn("createRoot path failed", err);
      }
    }
    if (typeof dom.render === "function") {
      try {
        dom.render(element, host);
        rendered = true;
        break;
      } catch (err) {
        log.warn("render path failed", err);
      }
    }
  }
  if (!rendered) {
    log.warn("no working React renderer found among", candidates.length, "candidate(s)");
    host.remove();
    return;
  }

  // Global keyboard shortcut: Cmd/Ctrl+Shift+D.
  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      e.stopPropagation();
      publish("toggle");
    }
  };
  window.addEventListener("keydown", onKey, true);

  // On-disk marker so out-of-band verification can confirm we mounted.
  try {
    const n = native();
    if (n && typeof n.writeText === "function" && n.root) {
      n.writeText(`${n.root}/ui-mounted.txt`, new Date().toISOString() + "\n");
    }
  } catch (err) {
    log.warn("failed to write ui-mounted marker", err);
  }

  log.log("settings modal mounted (Cmd/Ctrl+Shift+D to toggle)");
}
