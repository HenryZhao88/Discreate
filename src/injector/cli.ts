import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { findDiscordInstalls } from "./discord-paths.js";
import { patchCore, unpatchCore, isCorePatched, installRuntime } from "./core-patch.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/injector/cli.js -> bundles are in dist/build
const BUILD_DIR = join(here, "..", "build");
const RUNTIME_DIR = join(homedir(), ".discreate", "runtime");

function discordRunning(): boolean {
  try {
    execSync("pgrep -x Discord", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function requireDiscordQuit(): void {
  if (discordRunning()) {
    console.error("Discord is running. Quit Discord fully (Cmd+Q) and re-run.");
    process.exit(1);
  }
}

function cmdStatus(): void {
  const installs = findDiscordInstalls();
  if (installs.length === 0) {
    console.log("No Discord installs found. Launch Discord once so it downloads its modules.");
    return;
  }
  for (const i of installs) {
    console.log(`${i.branch.padEnd(7)} ${isCorePatched(i.coreDir) ? "injected" : "vanilla"}  ${i.coreDir}`);
  }
}

function cmdInject(): void {
  requireDiscordQuit();
  const installs = findDiscordInstalls();
  if (installs.length === 0) {
    console.error("No Discord installs found. Launch Discord once so it downloads its modules.");
    process.exit(1);
  }
  installRuntime(BUILD_DIR, RUNTIME_DIR);
  for (const i of installs) {
    patchCore(i.coreDir, RUNTIME_DIR);
    console.log(`Injected Discreate into ${i.branch} (${i.coreDir})`);
  }
  console.log("Done. Launch Discord.");
}

function cmdUninject(): void {
  requireDiscordQuit();
  for (const i of findDiscordInstalls()) {
    unpatchCore(i.coreDir);
    console.log(`Removed Discreate from ${i.branch}`);
  }
}

const cmd = process.argv[2];
if (cmd === "inject") cmdInject();
else if (cmd === "uninject") cmdUninject();
else if (cmd === "status") cmdStatus();
else {
  console.log("Usage: discreate <inject|uninject|status>");
  process.exit(1);
}
