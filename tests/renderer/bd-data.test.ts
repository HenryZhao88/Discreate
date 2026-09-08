// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installBdApi } from "../../src/renderer/api/bd-api";

afterEach(() => { delete (window as any).DiscreateNative; delete (window as any).BdApi; });
describe("BetterDiscord saved data", () => {
  it.each(["null", "[]", "42", '"text"'])("recovers from a valid JSON value that is not a settings object: %s", (initial) => {
    let raw = initial;
    (window as any).DiscreateNative = { root: "/fixture", readText: () => raw, writeText: (_: string, value: string) => { raw = value; } };
    const { Data } = installBdApi();
    expect(Data.load("test", "missing")).toBeUndefined();
    Data.save("test", "enabled", true);
    expect(JSON.parse(raw)).toEqual({ enabled: true });
    Data.delete("test", "enabled");
    expect(JSON.parse(raw)).toEqual({});
  });
  it("treats prototype-like keys as ordinary data and persists them", () => {
    let raw: string | null = null;
    (window as any).DiscreateNative = { root: "/fixture", readText: () => raw, writeText: (_: string, value: string) => { raw = value; } };
    const { Data } = installBdApi();
    expect(Data.load("test", "toString")).toBeUndefined();
    Data.save("test", "__proto__", { enabled: true });
    expect(Object.hasOwn(JSON.parse(raw!), "__proto__")).toBe(true);
    expect(Data.load("test", "enabled")).toBeUndefined();
  });
});
