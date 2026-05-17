import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectFolder, removeFolder, isInjected } from "../../src/injector/app-folder";

function fakeResources() {
  const res = mkdtempSync(join(tmpdir(), "res-"));
  writeFileSync(join(res, "app.asar"), "original");
  const build = mkdtempSync(join(tmpdir(), "build-"));
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, "index.js"), "// loader");
  writeFileSync(join(build, "preload.js"), "// preload");
  writeFileSync(join(build, "renderer.js"), "// renderer");
  return { res, build };
}

describe("app-folder", () => {
  it("injects an app/ folder with package.json and loader files", () => {
    const { res, build } = fakeResources();
    injectFolder(res, build);
    expect(existsSync(join(res, "app", "package.json"))).toBe(true);
    expect(existsSync(join(res, "app", "index.js"))).toBe(true);
    expect(existsSync(join(res, "app", "_discreate", "renderer.js"))).toBe(true);
    expect(isInjected(res)).toBe(true);
    const pkg = JSON.parse(readFileSync(join(res, "app", "package.json"), "utf8"));
    expect(pkg.main).toBe("index.js");
  });

  it("removeFolder restores vanilla Discord", () => {
    const { res, build } = fakeResources();
    injectFolder(res, build);
    removeFolder(res);
    expect(existsSync(join(res, "app"))).toBe(false);
    expect(isInjected(res)).toBe(false);
  });

  it("isInjected is false for an unrelated app/ folder", () => {
    const { res } = fakeResources();
    mkdirSync(join(res, "app"));
    expect(isInjected(res)).toBe(false);
  });
});
