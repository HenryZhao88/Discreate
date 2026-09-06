import { describe, it, expect, vi } from "vitest";
import { parseInstalledCommit, parseLatestCommit, checkForUpdate, LATEST_COMMIT_URL } from "../../src/renderer/core/updates.js";

describe("parse helpers", () => {
  it("reads installed commit", () => {
    expect(parseInstalledCommit('{"commit":"abc","branch":"main"}')).toBe("abc");
    expect(parseInstalledCommit(null)).toBeNull();
    expect(parseInstalledCommit("not json")).toBeNull();
  });
  it("reads latest sha from the commits API body", () => {
    expect(parseLatestCommit('{"sha":"def","commit":{}}')).toBe("def");
    expect(parseLatestCommit("nope")).toBeNull();
  });
});

describe("checkForUpdate", () => {
  it("flags an update when shas differ", async () => {
    const r = await checkForUpdate({
      readInstalled: () => '{"commit":"aaa"}',
      fetchText: async () => '{"sha":"bbb"}',
    });
    expect(r).toEqual({ installed: "aaa", latest: "bbb", updateAvailable: true });
  });
  it("no update when shas match", async () => {
    const r = await checkForUpdate({
      readInstalled: () => '{"commit":"same"}',
      fetchText: async () => '{"sha":"same"}',
    });
    expect(r.updateAvailable).toBe(false);
  });
  it("never throws and reports no update on fetch failure", async () => {
    const r = await checkForUpdate({
      readInstalled: () => '{"commit":"aaa"}',
      fetchText: async () => { throw new Error("offline"); },
    });
    expect(r).toEqual({ installed: "aaa", latest: null, updateAvailable: false });
  });
  it("uses the main branch commits endpoint", () => {
    expect(LATEST_COMMIT_URL).toBe("https://api.github.com/repos/HenryZhao88/Discreate/commits/main");
  });
});
