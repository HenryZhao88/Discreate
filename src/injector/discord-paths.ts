// src/injector/discord-paths.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type Branch = "stable" | "ptb" | "canary";

export interface DiscordInstall {
  branch: Branch;
  appPath: string;
  resources: string;
}

const BRANCHES: Record<string, Branch> = {
  "Discord.app": "stable",
  "Discord PTB.app": "ptb",
  "Discord Canary.app": "canary",
};

export function resourcesDir(appPath: string): string {
  return join(appPath, "Contents", "Resources");
}

export function defaultSearchDirs(): string[] {
  return ["/Applications", join(homedir(), "Applications")];
}

export function findDiscordInstalls(searchDirs = defaultSearchDirs()): DiscordInstall[] {
  const installs: DiscordInstall[] = [];
  for (const dir of searchDirs) {
    for (const [bundle, branch] of Object.entries(BRANCHES)) {
      const appPath = join(dir, bundle);
      const resources = resourcesDir(appPath);
      if (existsSync(join(resources, "app.asar"))) {
        installs.push({ branch, appPath, resources });
      }
    }
  }
  return installs;
}
