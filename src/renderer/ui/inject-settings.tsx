// src/renderer/ui/inject-settings.tsx
//
// Floating modal entrypoint for the Discreate settings UI.
//
// This used to render through Discord's React, but Discord ships multiple
// React-shaped modules and grabbing the wrong one made `root.render` no-op
// silently. The modal is now built with plain DOM so it works on any Discord
// version with zero dependencies on internal modules.
//
// Opens via:
//   1. A "🛠 Discreate" floating pill in the bottom-right corner.
//   2. Cmd/Ctrl+Shift+D anywhere inside Discord.
// Backdrop click and Escape close it.

import { makeLogger } from "../core/logger.js";
import { native } from "../core/paths.js";
import type { PluginManager } from "../core/plugins.js";
import type { ThemeManager } from "../core/themes.js";
import type { SettingsStore } from "../core/settings.js";

const log = makeLogger("settings-ui");

export const RISKY_PLUGINS = new Set<string>(["viewDeletedMessages", "showHiddenChannels"]);

export function describePlugin(id: string, description: string): string {
  return RISKY_PLUGINS.has(id)
    ? `${description}  ⚠ May draw attention to your account — use at your own risk.`
    : description;
}

interface Deps {
  plugins: PluginManager;
  themes: ThemeManager;
  settings: SettingsStore;
}

const STYLE_ID = "discreate-modal-styles";
const ROOT_ID = "discreate-modal-root";
const PILL_ID = "discreate-pill";
const OVERLAY_ID = "discreate-overlay";
let removeShortcut: (() => void) | undefined;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    #${PILL_ID} {
      position: fixed; bottom: 16px; right: 16px; z-index: 2147483646;
      padding: 8px 14px; background: #2b2d31; color: #fff;
      border: 1px solid #1e1f22; border-radius: 999px; cursor: pointer;
      font: 600 13px/1 var(--font-primary, system-ui, sans-serif);
      box-shadow: 0 2px 10px rgba(0,0,0,0.4); user-select: none;
    }
    #${PILL_ID}:hover { background: #3a3c43; }
    #${OVERLAY_ID} {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      z-index: 2147483647; display: flex; align-items: center; justify-content: center;
      font: 14px/1.4 var(--font-primary, system-ui, sans-serif); color: #fff;
    }
    #${OVERLAY_ID}[hidden] { display: none; }
    .dc-card {
      width: min(720px, 92vw); max-height: 80vh; background: #1e1f22;
      border: 1px solid #2b2d31; border-radius: 8px;
      display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,0.6);
    }
    .dc-header {
      display: flex; align-items: center; padding: 12px 16px;
      border-bottom: 1px solid #2b2d31;
    }
    .dc-title { flex: 1; font-weight: 700; font-size: 16px; }
    .dc-tabs { display: flex; gap: 6px; padding: 10px 16px 0; }
    .dc-tab {
      padding: 6px 12px; background: #2b2d31; color: #fff;
      border: none; border-radius: 4px; cursor: pointer; font: 600 13px/1 inherit;
    }
    .dc-tab.active { background: #5865F2; }
    .dc-body { flex: 1; overflow: auto; padding: 16px; }
    .dc-toolbar { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .dc-btn {
      padding: 6px 10px; background: #2b2d31; color: #fff;
      border: 1px solid #1e1f22; border-radius: 4px; cursor: pointer;
      font: 600 12px/1 inherit;
    }
    .dc-btn:hover { background: #3a3c43; }
    .dc-btn.danger { background: #4a2b2d; border-color: #5a3033; }
    .dc-btn.danger:hover { background: #5a3034; }
    .dc-btn.primary { background: #5865F2; border-color: #4752c4; }
    .dc-btn.primary:hover { background: #4752c4; }
    .dc-row {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 0; border-bottom: 1px solid #2b2d31;
    }
    .dc-row:last-child { border-bottom: none; }
    .dc-row-main { flex: 1; }
    .dc-row-label { font-weight: 600; }
    .dc-row-desc { color: #b5bac1; font-size: 13px; }
    .dc-empty { color: #b5bac1; font-style: italic; padding: 10px 0; }
    .dc-close {
      background: #2b2d31; color: #fff; border: none; border-radius: 4px;
      cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 10px;
    }
    .dc-close:hover { background: #3a3c43; }
    .dc-switch { width: 20px; height: 20px; cursor: pointer; }
    .dc-about { color: #b5bac1; line-height: 1.6; }
    .dc-about code { background: #2b2d31; padding: 2px 6px; border-radius: 3px; color: #fff; }
  `;
  document.head.appendChild(s);
}

type Tab = "plugins" | "themes" | "messagelog" | "about";

export function injectSettings(deps: Deps): void {
  removeShortcut?.();
  ensureStyles();

  // Remove any previous mount (e.g. on hot-reload).
  document.getElementById(PILL_ID)?.remove();
  document.getElementById(OVERLAY_ID)?.remove();
  document.getElementById(ROOT_ID)?.remove();

  const root = document.createElement("div");
  root.id = ROOT_ID;
  document.body.appendChild(root);

  // No visible pill — the panel opens via Cmd/Ctrl+Shift+D only.

  // ---------- modal overlay ----------
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.hidden = true;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  const card = document.createElement("div");
  card.className = "dc-card";
  overlay.appendChild(card);

  const header = document.createElement("div");
  header.className = "dc-header";
  card.appendChild(header);
  const title = document.createElement("div");
  title.className = "dc-title";
  title.textContent = "🛠 Discreate";
  const closeBtn = document.createElement("button");
  closeBtn.className = "dc-close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => closeModal());
  header.append(title, closeBtn);

  const tabs = document.createElement("div");
  tabs.className = "dc-tabs";
  card.appendChild(tabs);

  const body = document.createElement("div");
  body.className = "dc-body";
  card.appendChild(body);

  root.appendChild(overlay);

  let currentTab: Tab = "plugins";

  function setTab(tab: Tab): void {
    currentTab = tab;
    for (const child of Array.from(tabs.children) as HTMLElement[]) {
      child.classList.toggle("active", child.dataset.tab === tab);
    }
    renderBody();
  }

  function mkTab(tab: Tab, label: string): void {
    const b = document.createElement("button");
    b.className = "dc-tab";
    b.dataset.tab = tab;
    b.textContent = label;
    b.addEventListener("click", () => setTab(tab));
    tabs.appendChild(b);
  }
  mkTab("plugins", "Plugins");
  mkTab("themes", "Themes");
  mkTab("messagelog", "Message Log");
  mkTab("about", "About");

  // ---------- body renderers ----------
  function row(
    label: string,
    desc: string,
    enabled: boolean,
    onToggle: () => void,
    extra?: HTMLElement[],
  ): HTMLElement {
    const r = document.createElement("div");
    r.className = "dc-row";
    const main = document.createElement("div");
    main.className = "dc-row-main";
    const l = document.createElement("div");
    l.className = "dc-row-label";
    l.textContent = label;
    const d = document.createElement("div");
    d.className = "dc-row-desc";
    d.textContent = desc;
    main.append(l, d);
    const sw = document.createElement("input");
    sw.type = "checkbox";
    sw.className = "dc-switch";
    sw.checked = enabled;
    sw.addEventListener("change", () => { onToggle(); renderBody(); });
    r.appendChild(main);
    for (const e of extra ?? []) r.appendChild(e);
    r.appendChild(sw);
    return r;
  }

  function mkBtn(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `dc-btn ${cls}`.trim();
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function renderPlugins(): void {
    const toolbar = document.createElement("div");
    toolbar.className = "dc-toolbar";
    toolbar.append(
      mkBtn("Refresh", () => renderBody()),
      mkBtn("Open folder", () => {
        try { native().openFolder(native().pluginsDir); }
        catch (e) { log.warn("openFolder failed", e); }
      }),
      mkBtn("Install from URL…", async () => {
        const url = window.prompt("Plugin URL (.js or .plugin.js):");
        if (!url) return;
        try {
          const saved = await native().downloadToFolder(url, native().pluginsDir);
          alert(`Installed ${saved}. Restart Discord to load it.`);
        } catch (e: any) {
          alert("Download failed: " + (e?.message ?? e));
        }
      }, "primary"),
    );
    body.replaceChildren(toolbar);

    const all = deps.plugins.all();
    if (all.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dc-empty";
      empty.textContent = "No plugins. Drop *.plugin.js into ~/.discreate/plugins and Refresh.";
      body.appendChild(empty);
      return;
    }
    for (const entry of all) {
      const extra: HTMLElement[] = [];
      if (entry.source === "user" && entry.path) {
        extra.push(
          mkBtn("Delete", () => {
            if (!confirm(`Delete plugin "${entry.plugin.name}"? This removes the file.`)) return;
            try {
              deps.plugins.setEnabled(entry.id, false);
              native().deleteFile(entry.path!);
              deps.plugins.unregister(entry.id);
              alert("Deleted. Restart Discord to fully unload it.");
              renderBody();
            } catch (e: any) {
              alert("Delete failed: " + (e?.message ?? e));
            }
          }, "danger"),
        );
      }
      body.appendChild(
        row(
          entry.plugin.name,
          describePlugin(entry.id, entry.plugin.description),
          deps.plugins.isEnabled(entry.id),
          () => deps.plugins.setEnabled(entry.id, !deps.plugins.isEnabled(entry.id)),
          extra,
        ),
      );
    }
  }

  function renderThemes(): void {
    const toolbar = document.createElement("div");
    toolbar.className = "dc-toolbar";
    toolbar.append(
      mkBtn("Refresh", () => renderBody()),
      mkBtn("Open folder", () => {
        try { native().openFolder(native().themesDir); }
        catch (e) { log.warn("openFolder failed", e); }
      }),
      mkBtn("Install from URL…", async () => {
        const url = window.prompt("Theme URL (.css):");
        if (!url) return;
        try {
          const saved = await native().downloadToFolder(url, native().themesDir);
          alert(`Installed ${saved}. Enable it in the list.`);
          renderBody();
        } catch (e: any) {
          alert("Download failed: " + (e?.message ?? e));
        }
      }, "primary"),
    );
    body.replaceChildren(toolbar);

    const list = deps.themes.list();
    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dc-empty";
      empty.textContent = "No themes. Drop *.css into ~/.discreate/themes and Refresh.";
      body.appendChild(empty);
      return;
    }
    const enabled = new Set(deps.settings.getEnabledThemes());
    for (const file of list) {
      const extra: HTMLElement[] = [
        mkBtn("Delete", () => {
          if (!confirm(`Delete theme "${file}"? This removes the file.`)) return;
          try {
            deps.themes.setEnabled(file, false);
            native().deleteFile(`${native().themesDir}/${file}`);
            renderBody();
          } catch (e: any) {
            alert("Delete failed: " + (e?.message ?? e));
          }
        }, "danger"),
      ];
      body.appendChild(
        row(
          file,
          "CSS theme",
          enabled.has(file),
          () => deps.themes.setEnabled(file, !enabled.has(file)),
          extra,
        ),
      );
    }
  }

  function renderMessageLog(): void {
    const toolbar = document.createElement("div");
    toolbar.className = "dc-toolbar";
    toolbar.append(
      mkBtn("Refresh", () => renderBody()),
      mkBtn("Clear log", () => {
        if (!confirm("Clear the entire message log?")) return;
        import("../plugins/viewDeletedMessages/log.js").then((m) => { m.clearLog(); renderBody(); });
      }, "danger"),
    );
    body.replaceChildren(toolbar);

    void import("../plugins/viewDeletedMessages/log.js").then((m) => {
      // A tab switch or a newer refresh may have replaced this render while importing.
      if (toolbar.parentElement !== body) return;
      const logFile = m.readLog();
      const entries = [
        ...logFile.deleted.map((d) => ({ kind: "deleted" as const, ...d })),
        ...logFile.edits.map((e) => ({ kind: "edited" as const, ...e })),
      ].sort((a, b) => b.timestamp - a.timestamp);

      if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "dc-empty";
        empty.textContent = "No logged messages yet.";
        body.appendChild(empty);
        return;
      }
      for (const e of entries) {
        const r = document.createElement("div");
        r.className = "dc-row";
        const main = document.createElement("div");
        main.className = "dc-row-main";
        const label = document.createElement("div");
        label.className = "dc-row-label";
        label.textContent = `${e.kind === "deleted" ? "🗑" : "✏️"} ${e.author} · ${new Date(e.timestamp).toLocaleString()}`;
        const desc = document.createElement("div");
        desc.className = "dc-row-desc";
        desc.textContent = e.kind === "deleted"
          ? e.content
          : e.history.map((h: { content: string }) => h.content).join("  →  ");
        main.append(label, desc);
        const delBtn = mkBtn("Delete", () => {
          void import("../plugins/viewDeletedMessages/log.js").then((mod) => {
            if (e.kind === "deleted") mod.removeDeleted(e.messageId);
            else mod.removeEdit(e.messageId);
            renderBody();
          });
        }, "danger");
        r.append(main, delBtn);
        body.appendChild(r);
      }
    });
  }

  function renderAbout(): void {
    body.replaceChildren();
    const about = document.createElement("div");
    about.className = "dc-about";
    about.innerHTML = `
      <p><b>Discreate 0.1.0</b> — a Discord client mod for macOS.</p>
      <p>Settings live in <code>~/.discreate/</code> and survive Discord reinstalls.
         When Discord updates its modules, click <b>Reinject</b> below.</p>
      <p>Shortcut: <code>Cmd/Ctrl+Shift+D</code> to toggle this panel.</p>
    `;
    body.appendChild(about);

    const reinject = mkBtn("Reinject all installs", async () => {
      reinject.textContent = "Reinjecting…";
      try {
        const res = await native().reinject();
        alert("Reinjected " + (res?.patched?.length ?? 0) + " install(s). Restart Discord.");
      } catch (e: any) {
        alert("Reinject failed: " + (e?.message ?? e));
      } finally {
        reinject.textContent = "Reinject all installs";
      }
    }, "primary");
    body.appendChild(reinject);
  }

  function renderBody(): void {
    if (currentTab === "plugins") renderPlugins();
    else if (currentTab === "themes") renderThemes();
    else if (currentTab === "messagelog") renderMessageLog();
    else renderAbout();
  }

  function openModal(): void {
    overlay.hidden = false;
    renderBody();
  }
  function closeModal(): void {
    overlay.hidden = true;
  }
  function toggleModal(): void {
    if (overlay.hidden) openModal();
    else closeModal();
  }

  // Initialize active tab styling.
  setTab(currentTab);

  // Global shortcut. `isTrusted` filters out synthetic events — Discord (or one
  // of its modules) synthetically dispatches a stream of Cmd+Shift+D events at
  // startup, and without this check our toggle fires for each of them, leaving
  // the modal in a random state by the time the user presses the real key.
  const onKeydown = (e: KeyboardEvent) => {
      if (!e.isTrusted) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && (e.key === "d" || e.key === "D" || e.code === "KeyD")) {
        e.preventDefault();
        e.stopPropagation();
        toggleModal();
      } else if (!overlay.hidden && e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    };
  window.addEventListener("keydown", onKeydown, true);
  removeShortcut = () => window.removeEventListener("keydown", onKeydown, true);

  // On-disk marker for out-of-band verification.
  try {
    const n = native();
    if (n?.writeText && n?.root) {
      n.writeText(`${n.root}/ui-mounted.txt`, new Date().toISOString() + "\n");
    }
  } catch (err) {
    log.warn("failed to write ui-mounted marker", err);
  }

  log.log("settings modal mounted (Cmd/Ctrl+Shift+D to toggle)");
}
