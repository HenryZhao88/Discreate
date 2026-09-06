#!/usr/bin/env bash
set -euo pipefail

# Discreate installer — downloads the latest source, builds it locally, and
# injects into Discord. Re-run it (or use the in-app Update button) to update.
# User data in ~/.discreate (settings, logs, plugins, themes) is preserved.

REPO="HenryZhao88/Discreate"
BRANCH="main"
NODE_VERSION="20.18.1"
ROOT="$HOME/.discreate"
TOOLCHAIN="$ROOT/toolchain"
BUILD="$ROOT/build"

say() { printf "\n\033[1;36m==>\033[0m %s\n" "$1"; }
die() { printf "\n\033[1;31mERROR:\033[0m %s\n" "$1" >&2; exit 1; }

mkdir -p "$ROOT"

# 1. Self-copy so the in-app "Update" has a stable path to re-run.
SELF="${BASH_SOURCE[0]}"
if [ "$(cd "$(dirname "$SELF")" && pwd)/$(basename "$SELF")" != "$ROOT/install.command" ]; then
  cp "$SELF" "$ROOT/install.command"
  chmod +x "$ROOT/install.command"
fi

# 2. Quit-check Discord (inject cannot patch a running client).
if pgrep -x "Discord" >/dev/null || pgrep -x "Discord PTB" >/dev/null || pgrep -x "Discord Canary" >/dev/null; then
  die "Discord is running. Quit it fully (Cmd+Q) and run this again."
fi

# 3. Ensure Node (>= 18). Use system node if present; else download standalone.
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$MAJOR" -ge 18 ] 2>/dev/null; then NODE_BIN="$(command -v node)"; fi
fi
if [ -z "$NODE_BIN" ]; then
  case "$(uname -m)" in
    arm64) NARCH="darwin-arm64" ;;
    x86_64) NARCH="darwin-x64" ;;
    *) die "Unsupported CPU: $(uname -m)" ;;
  esac
  PKG="node-v${NODE_VERSION}-${NARCH}"
  DEST="$TOOLCHAIN/$PKG/bin/node"
  if [ ! -x "$DEST" ]; then
    say "Downloading Node ${NODE_VERSION} (${NARCH})…"
    mkdir -p "$TOOLCHAIN"
    curl -fL --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/${PKG}.tar.gz" -o "$TOOLCHAIN/node.tar.gz" \
      || die "Failed to download Node."
    tar -xzf "$TOOLCHAIN/node.tar.gz" -C "$TOOLCHAIN"
    rm -f "$TOOLCHAIN/node.tar.gz"
  fi
  NODE_BIN="$DEST"
fi
NODE_DIR="$(dirname "$NODE_BIN")"
export PATH="$NODE_DIR:$PATH"
NPM_BIN="$NODE_DIR/npm"
say "Using Node $("$NODE_BIN" -v)"

# 4. Resolve the latest commit sha and download that source tarball.
say "Fetching latest Discreate source…"
SHA="$("$NODE_BIN" -e '
  const https=require("https");
  https.get("https://api.github.com/repos/'"$REPO"'/commits/'"$BRANCH"'",
    {headers:{"User-Agent":"Discreate-Installer"}},res=>{
      let d="";res.on("data",c=>d+=c);res.on("end",()=>{
        try{process.stdout.write(JSON.parse(d).sha||"")}catch{process.stdout.write("")}
      });
    }).on("error",()=>process.stdout.write(""));
')"
[ -n "$SHA" ] || die "Could not reach GitHub to find the latest version."
rm -rf "$BUILD"
mkdir -p "$BUILD"
curl -fL --retry 3 "https://codeload.github.com/${REPO}/tar.gz/${SHA}" -o "$BUILD/src.tar.gz" \
  || die "Failed to download source."
tar -xzf "$BUILD/src.tar.gz" -C "$BUILD" --strip-components=1
rm -f "$BUILD/src.tar.gz"

# 5. Build (needs only esbuild; version comes from the source's package.json).
cd "$BUILD"
ESBUILD_VER="$("$NODE_BIN" -e 'process.stdout.write(require("./package.json").devDependencies.esbuild.replace(/[^0-9.]/g,""))')"
# Strip the dependency lists from the build copy of package.json so that
# `npm install esbuild` doesn't also reify the whole devDependency tree
# (Electron et al.) — npm install <pkg> reifies existing deps too.
"$NODE_BIN" -e '
  const fs=require("fs"),p="package.json",j=JSON.parse(fs.readFileSync(p,"utf8"));
  delete j.dependencies; delete j.devDependencies; delete j.peerDependencies;
  fs.writeFileSync(p,JSON.stringify(j,null,2));
'
say "Building (esbuild ${ESBUILD_VER})…"
"$NPM_BIN" install --no-audit --no-fund --loglevel=error "esbuild@${ESBUILD_VER}" >/dev/null 2>&1 \
  || die "Failed to install build tools."
"$NODE_BIN" build.mjs || die "Build failed."

# 6. Inject via the freshly built CLI.
say "Injecting into Discord…"
"$NODE_BIN" dist/injector/cli.js inject || die "Injection failed."

# 7. Record the installed commit as the update baseline.
"$NODE_BIN" -e '
  const fs=require("fs"),p=process.env.HOME+"/.discreate/installed.json";
  fs.writeFileSync(p,JSON.stringify({commit:"'"$SHA"'",branch:"'"$BRANCH"'",installedAt:new Date().toISOString()},null,2));
'

say "Done. Launch Discord — Discreate is installed."
