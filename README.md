# Discreate

A client mod for the Discord desktop app on **macOS**. Has enough BetterDiscord compatibility to run many `.plugin.js` files unchanged.

> **Use at your own risk.** Client mods violate Discord's Terms of Service and
> can get your account actioned. Everything ships disabled; you turn on what you want.

## Install

Quit Discord and run:

```
curl -fsSL https://raw.githubusercontent.com/HenryZhao88/Discreate/main/install.command | bash
```

Rather not touch the Terminal? Download `Discreate-Installer.zip` from the
[latest release](https://github.com/HenryZhao88/Discreate/releases/latest),
unzip it, and run `install.command`

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

## License

GPL-3.0 — see [`LICENSE`](LICENSE). Most bundled plugins and themes are adapted
from [Vencord](https://github.com/Vendicated/Vencord) and the BetterDiscord
community and were not written by me.
