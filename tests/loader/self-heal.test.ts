import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selfHealSiblings } from "../../src/loader/self-heal";

const VANILLA = "module.exports = require('./core.asar');\n";

function makeAppSupport(): string {
  return mkdtempSync(join(tmpdir(), "appsup-"));
}

function makeVersionDir(appSupport: string, version: string, opts: { patched?: boolean; missingCore?: boolean; missingIdx?: boolean } = {}): string {
  const core = join(appSupport, version, "modules", "discord_desktop_core");
  mkdirSync(core, { recursive: true });
  if (!opts.missingCore) writeFileSync(join(core, "core.asar"), "x");
  if (!opts.missingIdx) {
    const content = opts.patched
      ? `// discreate-patched\nrequire("/loader.js");\nmodule.exports = require('./core.asar');\n`
      : VANILLA;
    writeFileSync(join(core, "index.js"), content);
  }
  return core;
}

describe("selfHealSiblings", () => {
  it("isolates an unreadable sibling so boot and other repairs can continue", () => {
    const appSup = makeAppSupport();
    const current = makeVersionDir(appSup, "0.0.390", { patched: true });
    const broken = makeVersionDir(appSup, "0.0.400");
    rmSync(join(broken, "index.js"));
    mkdirSync(join(broken, "index.js"));
    const valid = makeVersionDir(appSup, "0.0.412");
    expect(selfHealSiblings(current, "/abs/loader.js")).toEqual([valid]);
    expect(readFileSync(join(valid, "index.js"), "utf8")).toContain("discreate-patched");
  });
  it("patches an unpatched sibling version dir", () => {
    const appSup = makeAppSupport();
    const current = makeVersionDir(appSup, "0.0.390", { patched: true });
    const sibling = makeVersionDir(appSup, "0.0.412");
    const patched = selfHealSiblings(current, "/abs/loader.js");
    expect(patched).toEqual([sibling]);
    const idx = readFileSync(join(sibling, "index.js"), "utf8");
    expect(idx).toContain("discreate-patched");
    expect(idx).toContain("/abs/loader.js");
    expect(idx).toContain("require('./core.asar')");
  });

  it("backs up the original before patching", () => {
    const appSup = makeAppSupport();
    const current = makeVersionDir(appSup, "0.0.390", { patched: true });
    const sibling = makeVersionDir(appSup, "0.0.412");
    selfHealSiblings(current, "/abs/loader.js");
    const backup = join(sibling, "index.js.discreate-backup");
    expect(existsSync(backup)).toBe(true);
    expect(readFileSync(backup, "utf8")).toBe(VANILLA);
  });

  it("leaves an already-patched sibling alone", () => {
    const appSup = makeAppSupport();
    const current = makeVersionDir(appSup, "0.0.390", { patched: true });
    const sibling = makeVersionDir(appSup, "0.0.412", { patched: true });
    const before = readFileSync(join(sibling, "index.js"), "utf8");
    const patched = selfHealSiblings(current, "/abs/loader.js");
    expect(patched).toEqual([]);
    expect(readFileSync(join(sibling, "index.js"), "utf8")).toBe(before);
  });

  it("ignores non-version directories", () => {
    const appSup = makeAppSupport();
    const current = makeVersionDir(appSup, "0.0.390", { patched: true });
    mkdirSync(join(appSup, "Cache"), { recursive: true });
    mkdirSync(join(appSup, "0.0.x", "modules", "discord_desktop_core"), { recursive: true });
    const patched = selfHealSiblings(current, "/abs/loader.js");
    expect(patched).toEqual([]);
  });

  it("skips siblings missing core.asar or index.js", () => {
    const appSup = makeAppSupport();
    const current = makeVersionDir(appSup, "0.0.390", { patched: true });
    makeVersionDir(appSup, "0.0.412", { missingCore: true });
    makeVersionDir(appSup, "0.0.413", { missingIdx: true });
    const patched = selfHealSiblings(current, "/abs/loader.js");
    expect(patched).toEqual([]);
  });

  it("returns [] when app support dir does not exist", () => {
    const fake = join(tmpdir(), "nope-" + Date.now(), "0.0.1", "modules", "discord_desktop_core");
    expect(selfHealSiblings(fake, "/abs/loader.js")).toEqual([]);
  });
});
