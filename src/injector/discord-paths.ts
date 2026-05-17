import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type Branch = "stable" | "ptb" | "canary";

export interface DiscordInstall {
  branch: Branch;
  coreDir: string; // .../modules/discord_desktop_core (has index.js + core.asar)
}

const BRANCH_DIRS: Record<Branch, string> = {
  stable: "discord",
  ptb: "discordptb",
  canary: "discordcanary",
};

export function appSupportDir(branch: Branch): string {
  return join(homedir(), "Library", "Application Support", BRANCH_DIRS[branch]);
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** Find the discord_desktop_core dir under an app-support base, newest version first. */
export function findCoreDir(base: string): string | null {
  if (!existsSync(base)) return null;
  const versions = readdirSync(base)
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    .sort(cmpVersion);
  for (let i = versions.length - 1; i >= 0; i--) {
    const coreDir = join(base, versions[i], "modules", "discord_desktop_core");
    if (existsSync(join(coreDir, "core.asar")) && existsSync(join(coreDir, "index.js"))) {
      return coreDir;
    }
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
