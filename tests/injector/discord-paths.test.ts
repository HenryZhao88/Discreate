import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCoreDir } from "../../src/injector/discord-paths";

function makeCore(base: string, version: string): string {
  const core = join(base, version, "modules", "discord_desktop_core");
  mkdirSync(core, { recursive: true });
  writeFileSync(join(core, "core.asar"), "x");
  writeFileSync(join(core, "index.js"), "module.exports = require('./core.asar');\n");
  return core;
}

describe("findCoreDir", () => {
  it("finds the discord_desktop_core dir for the newest version", () => {
    const base = mkdtempSync(join(tmpdir(), "ds-"));
    makeCore(base, "0.0.99");
    const newest = makeCore(base, "0.0.412");
    expect(findCoreDir(base)).toBe(newest);
  });

  it("returns null when the base dir does not exist", () => {
    expect(findCoreDir(join(tmpdir(), "does-not-exist-xyz"))).toBeNull();
  });

  it("returns null when no version dir has the core module", () => {
    const base = mkdtempSync(join(tmpdir(), "ds-"));
    mkdirSync(join(base, "0.0.1", "modules"), { recursive: true });
    expect(findCoreDir(base)).toBeNull();
  });
});
