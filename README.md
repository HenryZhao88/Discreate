# Discreate

A client mod for the Discord desktop app on **macOS**. It injects a plugin and
theme runtime into Discord — a handful of built-in plugins, custom CSS themes,
and enough BetterDiscord compatibility to run many `.plugin.js` files unchanged.

> **Use at your own risk.** Client mods violate Discord's Terms of Service and
> can get your account actioned — especially plugins that surface hidden content.
> Everything ships disabled; you turn on what you want.

## Install

Quit Discord (⌘Q), then run:

```
curl -fsSL https://raw.githubusercontent.com/HenryZhao88/Discreate/main/install.command | bash
```

It fetches the latest source, builds it, and injects — no Node or toolchain
needed on your end. Relaunch Discord and press **⌘⇧D** to open the panel.

Rather not touch the Terminal? Download `Discreate-Installer.zip` from the
[latest release](https://github.com/HenryZhao88/Discreate/releases/latest),
unzip it, and right-click `install.command` → **Open** (unsigned apps need this
once). If macOS complains about permissions, use the command above instead.

Your config, plugins, themes, and logs live in `~/.discreate`.

## Updating

Discreate checks on launch and drops an **Update** button in the panel when
you're behind — or just re-run the installer. Either way your data is kept.

## Plugins

Open **⌘⇧D → Plugins** to toggle them (all off by default):

| Plugin | What it does |
| --- | --- |
| **View Deleted Messages** | Keeps deleted messages visible, tracks edit history, adds a message-log panel. |
| **Show Hidden Channels** | Reveals channels locked by `VIEW_CHANNEL`, with a lock screen in place of message access. |
| **Show Hidden Things** | Surfaces moderator-only indicators — timeout affordances, paused invites, and more. |
| **Read All** | Adds a button above the server list to mark every server as read. |
| **Member Count** | Shows online, total, and voice counts above the member list. |
| **Relationship Notifier** | Tells you when a friend, group, or server removes you. |
| **Force Owner Crown** | Restores the owner crown next to owners when Discord hides it. |

Drop your own BetterDiscord `.plugin.js` files into `~/.discreate/plugins`.

## Themes

Put `.css` themes in `~/.discreate/themes` and enable them under **Themes**.
Remote `@import`s are inlined for you (Discord's CSP blocks them otherwise).
Themes built on Discord's CSS variables age well; ones that target Discord's
randomized class names tend to break on updates — not a Discreate limitation,
just how those themes are written.

## Uninstall

```
node dist/injector/cli.js uninject
```

## Build from source

```
pnpm install
pnpm build
node dist/injector/cli.js inject
```

## Telemetry

One anonymous ping per launch, so the project can count devices. It sends a
one-way hash of your machine id, the Discreate version, and your OS name/version/
architecture — nothing else. No account, message, server, or channel data is
touched, and your IP is never stored; the server records only `deviceId → date`.
The server is open in [`server/`](server/). To opt out, point
`TELEMETRY_ENDPOINT` in `src/telemetry/report.ts` elsewhere and rebuild.

## License

GPL-3.0 — see [`LICENSE`](LICENSE). Most bundled plugins and themes are adapted
from [Vencord](https://github.com/Vendicated/Vencord) and the BetterDiscord
community and were not written by me.
