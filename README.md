# Discreate

A client modification for the Discord desktop app (macOS). Injects a plugin
and theme runtime, with a small set of built-in plugins and BetterDiscord
plugin compatibility.

> ⚠️ **Use at your own risk.** Client mods violate Discord's Terms of Service
> and can, in principle, lead to account action. Plugins that reveal hidden
> content (e.g. deleted messages, hidden channels) carry the most risk. All
> plugins ship **disabled** — enable only what you understand.

## Platform

macOS only. The injector targets `~/Library/Application Support` and uses
macOS commands. Windows/Linux are not supported.

## Install (macOS)

**Easiest — paste one line.** Quit Discord completely first (Cmd+Q), then open
Terminal (Applications → Utilities → Terminal) and paste:

```
curl -fsSL https://raw.githubusercontent.com/HenryZhao88/Discreate/main/install.command | bash
```

It downloads Discreate, builds it, and injects it — no other software needed.
Then launch Discord and open Settings to find the Discreate panel.

**Prefer not to use Terminal?** Download **`Discreate-Installer.zip`** from the
[latest release](https://github.com/HenryZhao88/Discreate/releases/latest),
double-click to unpack it, then **right-click `install.command` → Open → Open**
(macOS blocks unsigned files the first time; you only do this once). Quit Discord
first. If double-click reports "you do not have appropriate access privileges,"
use the one-line command above instead.

The installer keeps your data (settings, logs, plugins, themes) in `~/.discreate`.

## Updating

Discreate checks for updates on launch. When a new version is available, the
Discreate settings panel shows an **Update** button — click it (quit Discord
when asked) and it reinstalls the latest version, keeping your data. You can
also just run `install.command` again anytime.

## Building from source (developers)

```bash
pnpm install
pnpm build
node dist/injector/cli.js inject
```

## Uninstall

```bash
node dist/injector/cli.js uninject
```

## Telemetry

Discreate sends one anonymous ping per launch so the project can count how many
devices use it. It contains a hashed device id (derived from your hardware id,
one-way, not reversible), the Discreate version, and your OS name/version/arch —
nothing else. No Discord account, message, server, or channel data is ever
sent, and your IP address is never stored. The server keeps only
`deviceId -> date`. The server source is in `server/`.

## License

GPL-3.0. See `LICENSE`. Most plugins and themes are adapted from
Vencord and the BetterDiscord community and were not created by me.
