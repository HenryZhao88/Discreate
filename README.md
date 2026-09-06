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

1. Download **`install.command`** from this repository (the file at the top level — click it, then the download/raw button).
2. Because it isn't code-signed, macOS blocks it the first time: **right-click the file → Open → Open**. (You only do this once.)
3. Quit Discord completely first (Cmd+Q). Then follow the Terminal window the installer opens — it downloads Discreate, builds it, and injects it. No other software needed.
4. Launch Discord. Open Settings to find the Discreate panel.

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
`deviceId -> date`. The server source is in `server/`. See `PRIVACY.md`.

## License

GPL-3.0. See `LICENSE` and `NOTICE`. Most plugins and themes are adapted from
Vencord and the BetterDiscord community and were not created by me.
