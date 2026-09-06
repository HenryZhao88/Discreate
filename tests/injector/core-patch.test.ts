import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchCore, unpatchCore, isCorePatched, installRuntime } from "../../src/injector/core-patch";

function fakeCoreDir(): string {
  const core = mkdtempSync(join(tmpdir(), "core-"));
  writeFileSync(join(core, "core.asar"), "x");
  writeFileSync(join(core, "index.js"), "module.exports = require('./core.asar');\n");
  return core;
}

function fakeBuildDir(): string {
  const build = mkdtempSync(join(tmpdir(), "build-"));
  for (const f of ["loader.js", "preload.js", "renderer.js"]) {
    writeFileSync(join(build, f), `// ${f}`);
  }
  return build;
}

describe("core-patch", () => {
  it("does not overwrite an unpatched entry point, even when a stale backup exists", () => {
    const core = fakeCoreDir();
    writeFileSync(join(core, "index.js"), "// other loader\n");
    writeFileSync(join(core, "index.js.discreate-backup"), "// stale backup\n");
    unpatchCore(core);
    expect(readFileSync(join(core, "index.js"), "utf8")).toBe("// other loader\n");
  });
  it("patchCore rewrites index.js to load the loader and backs up the original", () => {
    const core = fakeCoreDir();
    const runtime = mkdtempSync(join(tmpdir(), "rt-"));
    patchCore(core, runtime);
    const idx = readFileSync(join(core, "index.js"), "utf8");
    expect(idx).toContain("discreate-patched");
    expect(idx).toContain("loader.js");
    expect(idx).toContain("require('./core.asar')");
    expect(isCorePatched(core)).toBe(true);
    expect(existsSync(join(core, "index.js.discreate-backup"))).toBe(true);
  });

  it("unpatchCore restores the original index.js and removes the backup", () => {
    const core = fakeCoreDir();
    const original = readFileSync(join(core, "index.js"), "utf8");
    patchCore(core, mkdtempSync(join(tmpdir(), "rt-")));
    unpatchCore(core);
    expect(readFileSync(join(core, "index.js"), "utf8")).toBe(original);
    expect(existsSync(join(core, "index.js.discreate-backup"))).toBe(false);
    expect(isCorePatched(core)).toBe(false);
  });

  it("patching twice does not corrupt the backup with a patched file", () => {
    const core = fakeCoreDir();
    const original = readFileSync(join(core, "index.js"), "utf8");
    const runtime = mkdtempSync(join(tmpdir(), "rt-"));
    patchCore(core, runtime);
    patchCore(core, runtime);
    expect(readFileSync(join(core, "index.js.discreate-backup"), "utf8")).toBe(original);
  });

  it("installRuntime copies the three bundles", () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-"));
    installRuntime(fakeBuildDir(), runtime);
    for (const f of ["loader.js", "preload.js", "renderer.js"]) {
      expect(existsSync(join(runtime, f))).toBe(true);
    }
  });
});
