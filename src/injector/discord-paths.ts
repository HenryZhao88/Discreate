import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type Branch = "stable" | "ptb" | "canary";

export interface DiscordInstall {
  branch: Branch;
  coreDir: string; // .../modules/.../discord_desktop_core (has index.js + core.asar)
}

const BRANCH_DIRS: Record<Branch, string> = {
  stable: "discord",
  ptb: "discordptb",
  canary: "discordcanary",
};

export function appSupportDir(branch: Branch): string {
  return join(homedir(), "Library", "Application Support", BRANCH_DIRS[branch]);
}

/** Strip the optional `app-` prefix used by newer Discord layouts. */
function versionOf(name: string): string | null {
  const m = /^(?:app-)?(\d+\.\d+\.\d+)$/.exec(name);
  return m ? m[1] : null;
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function hasCoreFiles(dir: string): boolean {
  return existsSync(join(dir, "core.asar")) && existsSync(join(dir, "index.js"));
}

/**
 * Locate the `discord_desktop_core` directory under a version's `modules/`.
 *
 * Two layouts are supported:
 * - Legacy: `<modules>/discord_desktop_core/`
 * - Current (2024+): `<modules>/discord_desktop_core-<n>/discord_desktop_core/`
 *   When multiple `-<n>` siblings exist, pick the highest `n`.
 */
export function resolveCoreUnderModules(modulesDir: string): string | null {
  if (!existsSync(modulesDir)) return null;

  const legacy = join(modulesDir, "discord_desktop_core");
  if (hasCoreFiles(legacy)) return legacy;

  let bestIdx = -1;
  let bestCore: string | null = null;
  let entries: string[];
  try { entries = readdirSync(modulesDir); } catch { return null; }
  for (const entry of entries) {
    const m = /^discord_desktop_core-(\d+)$/.exec(entry);
    if (!m) continue;
    const idx = Number(m[1]);
    const inner = join(modulesDir, entry, "discord_desktop_core");
    if (!hasCoreFiles(inner)) continue;
    if (idx > bestIdx) { bestIdx = idx; bestCore = inner; }
  }
  return bestCore;
}

/** Find the discord_desktop_core dir under an app-support base, newest version first. */
export function findCoreDir(base: string): string | null {
  if (!existsSync(base)) return null;
  let entries: string[];
  try { entries = readdirSync(base); } catch { return null; }

  const versions: { name: string; version: string }[] = [];
  for (const name of entries) {
    const v = versionOf(name);
    if (!v) continue;
    try { if (!statSync(join(base, name)).isDirectory()) continue; } catch { continue; }
    versions.push({ name, version: v });
  }
  versions.sort((a, b) => cmpVersion(a.version, b.version));

  for (let i = versions.length - 1; i >= 0; i--) {
    const core = resolveCoreUnderModules(join(base, versions[i].name, "modules"));
    if (core) return core;
  }
  return null;
}

export function findDiscordInstalls(): DiscordInstall[] {
  const installs: DiscordInstall[] = [];
  for (const branch of ["stable", "ptb", "canary"] as Branch[]) {
    const coreDir = findCoreDir(appSupportDir(branch));
    if (coreDir) installs.push({ branch, coreDir });
  }
  return installs;
}
