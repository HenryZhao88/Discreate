import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sendReport } from "./report.js";
import { getDeviceId } from "./device-id.js";

let fired = false;

export function readVersion(readFile: (p: string) => string = defaultReadPackage): string {
  try {
    const parsed = JSON.parse(readFile(""));
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function defaultReadPackage(): string {
  // dist/build/loader.js -> repo root package.json is not bundled; the version
  // is injected at build time via esbuild `define` (see Task 4). Fall back to
  // reading a sibling package.json only if present.
  return readFileSync(join(__dirname, "..", "..", "package.json"), "utf8");
}

export function sendTelemetry(deps: {
  report?: () => Promise<void>;
} = {}): void {
  if (fired) return;
  fired = true;
  const report = deps.report ?? (() => sendReport({ deviceId: getDeviceId(), version: DISCREATE_VERSION }));
  Promise.resolve().then(report).catch(() => { /* never throw */ });
}

// Injected by esbuild define at build time; falls back for tests/dev.
declare const DISCREATE_VERSION: string;
