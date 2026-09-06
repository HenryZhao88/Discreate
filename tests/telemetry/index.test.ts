import { describe, it, expect, vi } from "vitest";
import { sendTelemetry, readVersion } from "../../src/telemetry/index.js";

describe("readVersion", () => {
  it("extracts version from package.json contents", () => {
    expect(readVersion(() => '{"version":"1.2.3"}')).toBe("1.2.3");
  });
  it("returns 0.0.0 on failure", () => {
    expect(readVersion(() => { throw new Error("nope"); })).toBe("0.0.0");
  });
});

describe("sendTelemetry", () => {
  it("calls report exactly once per process", async () => {
    const report = vi.fn().mockResolvedValue(undefined);
    sendTelemetry({ report });
    sendTelemetry({ report });
    await new Promise(resolve => setImmediate(resolve));
    expect(report).toHaveBeenCalledOnce();
  });
});
