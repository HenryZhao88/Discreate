// tests/loader/telemetry-wiring.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("loader telemetry wiring", () => {
  const src = readFileSync(new URL("../../src/loader/index.ts", import.meta.url), "utf8");
  it("imports and calls sendTelemetry", () => {
    expect(src).toMatch(/import\s*\{\s*sendTelemetry\s*\}\s*from\s*["']\.\.\/telemetry\/index\.js["']/);
    expect(src).toMatch(/sendTelemetry\s*\(/);
  });
  it("guards telemetry in try/catch so it cannot break boot", () => {
    // sendTelemetry appears inside a try block
    expect(src).toMatch(/try\s*\{[\s\S]*sendTelemetry\s*\([\s\S]*?\}\s*catch/);
  });
});
