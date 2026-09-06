import { describe, it, expect } from "vitest";
import { hashHwid, resolveHwid, getDeviceId } from "../../src/telemetry/device-id.js";

describe("hashHwid", () => {
  it("is deterministic and 16 lowercase hex chars", () => {
    const a = hashHwid("ABC-123");
    const b = hashHwid("ABC-123");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  it("differs for different input", () => {
    expect(hashHwid("one")).not.toBe(hashHwid("two"));
  });
});

describe("resolveHwid", () => {
  it("parses IOPlatformUUID from ioreg output", () => {
    const out = '    "IOPlatformUUID" = "11111111-2222-3333-4444-555555555555"';
    expect(resolveHwid(() => out)).toBe("11111111-2222-3333-4444-555555555555");
  });
  it("returns null when the runner throws", () => {
    expect(resolveHwid(() => { throw new Error("no ioreg"); })).toBeNull();
  });
  it("returns null when UUID absent", () => {
    expect(resolveHwid(() => "no uuid here")).toBeNull();
  });
});

describe("getDeviceId", () => {
  it("hashes the resolved hwid", () => {
    const id = getDeviceId({ runner: () => '"IOPlatformUUID" = "AAAA-BBBB"' });
    expect(id).toBe(hashHwid("AAAA-BBBB"));
  });
  it("falls back to a persisted random id when hwid is unavailable", () => {
    const store: Record<string, string> = {};
    const deps = {
      runner: () => null,
      readFile: (p: string) => store[p] ?? null,
      writeFile: (p: string, d: string) => { store[p] = d; },
      idFilePath: "/fake/install-id",
    };
    const first = getDeviceId(deps);
    const second = getDeviceId(deps);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(second).toBe(first); // persisted, stable across calls
  });
});
