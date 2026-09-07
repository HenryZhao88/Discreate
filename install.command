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

# 1. Keep a stable copy at ~/.discreate/install.command so the in-app "Update"
#    button can re-run it. When run from a real file, copy it; when run via
#    `curl ... | bash` (no real file), fetch a fresh copy from GitHub.
SELF="${BASH_SOURCE[0]:-}"
TARGET="$ROOT/install.command"
if [ -f "$SELF" ]; then
  if [ "$(cd "$(dirname "$SELF")" && pwd)/$(basename "$SELF")" != "$TARGET" ]; then
    cp "$SELF" "$TARGET" && chmod +x "$TARGET"
  fi
else
  curl -fsSL "https://raw.githubusercontent.com/$REPO/$BRANCH/install.command" -o "$TARGET" 2>/dev/null && chmod +x "$TARGET" || true
fi

# 2. Close any running Discord so we can patch it, and remember which to
#    relaunch. (The in-app "Update" button launches this while Discord is open,
#    so the installer must close it itself rather than refuse.)
RELAUNCH=""
for app in "Discord" "Discord PTB" "Discord Canary"; do
  if pgrep -x "$app" >/dev/null 2>&1; then
    say "Closing $app to apply the update…"
    pkill -x "$app" >/dev/null 2>&1 || true
    RELAUNCH="$RELAUNCH$app|"
  fi
done
# Wait up to ~15s for them to exit.
for _ in $(seq 1 30); do
  still=""
  for app in "Discord" "Discord PTB" "Discord Canary"; do
    pgrep -x "$app" >/dev/null 2>&1 && still="yes" || true
  done
  [ -z "$still" ] && break
  sleep 0.5
done
for app in "Discord" "Discord PTB" "Discord Canary"; do
  pgrep -x "$app" >/dev/null 2>&1 && die "$app wouldn't close. Quit it fully (Cmd+Q) and run the installer again." || true
done

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

# 8. Relaunch whatever we closed, so the user lands back in the updated app.
if [ -n "$RELAUNCH" ]; then
  OLDIFS=$IFS; IFS='|'
  for app in $RELAUNCH; do
    [ -n "$app" ] && open -a "$app" >/dev/null 2>&1 || true
  done
  IFS=$OLDIFS
  say "Done — Discreate updated. Discord is relaunching."
else
  say "Done. Launch Discord — Discreate is installed."
fi
