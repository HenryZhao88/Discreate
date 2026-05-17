// src/injector/cli.ts
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findDiscordInstalls } from "./discord-paths.js";
import { injectFolder, removeFolder, isInjected } from "./app-folder.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/injector/cli.js -> build output dir is dist/build
const BUILD_DIR = join(here, "..", "build");

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
    console.log("No Discord installs found.");
    return;
  }
  for (const i of installs) {
    console.log(`${i.branch.padEnd(7)} ${isInjected(i.resources) ? "injected" : "vanilla"}  ${i.appPath}`);
  }
}

function cmdInject(): void {
  requireDiscordQuit();
  const installs = findDiscordInstalls();
  if (installs.length === 0) return console.error("No Discord installs found.");
  for (const i of installs) {
    injectFolder(i.resources, BUILD_DIR);
    console.log(`Injected Discreate into ${i.branch} (${i.appPath})`);
  }
  console.log("Done. Launch Discord.");
}

function cmdUninject(): void {
  requireDiscordQuit();
  for (const i of findDiscordInstalls()) {
    removeFolder(i.resources);
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
