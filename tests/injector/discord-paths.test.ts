import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findDiscordInstalls, resourcesDir } from "../../src/injector/discord-paths";

describe("findDiscordInstalls", () => {
  it("detects a Discord.app bundle in a search dir", () => {
    const root = mkdtempSync(join(tmpdir(), "disc-"));
    const res = join(root, "Discord.app", "Contents", "Resources");
    mkdirSync(res, { recursive: true });
    writeFileSync(join(res, "app.asar"), "x");
    const installs = findDiscordInstalls([root]);
    expect(installs).toHaveLength(1);
    expect(installs[0].branch).toBe("stable");
    expect(installs[0].resources).toBe(res);
  });

  it("ignores app bundles without app.asar", () => {
    const root = mkdtempSync(join(tmpdir(), "disc-"));
    mkdirSync(join(root, "Discord.app", "Contents", "Resources"), { recursive: true });
    expect(findDiscordInstalls([root])).toHaveLength(0);
  });

  it("derives the resources dir from an app bundle path", () => {
    expect(resourcesDir("/X/Discord.app")).toBe("/X/Discord.app/Contents/Resources");
  });
});
