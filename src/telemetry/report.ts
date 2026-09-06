import { request as httpsRequest } from "node:https";
import { release, arch as osArch } from "node:os";
import { getDeviceId } from "./device-id.js";

// Replace with your deployed Worker URL after `wrangler deploy`.
export const TELEMETRY_ENDPOINT = "https://discreate-telemetry.workers.dev";

export interface TelemetryPayload {
  id: string; v: string; os: string; osv: string; arch: string;
}

export function buildPayload(
  deviceId: string,
  version: string,
  info: { platform?: string; release?: string; arch?: string } = {},
): TelemetryPayload {
  return {
    id: deviceId,
    v: version,
    os: info.platform ?? process.platform,
    osv: info.release ?? release(),
    arch: info.arch ?? osArch(),
  };
}

export function postJson(
  url: string,
  body: string,
  deps: { request?: typeof httpsRequest; timeoutMs?: number } = {},
): Promise<void> {
  const request = deps.request ?? httpsRequest;
  const timeoutMs = deps.timeoutMs ?? 5000;
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      const req = request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
        res.resume();
        finish();
      });
      req.on("error", finish);
      req.setTimeout(timeoutMs, () => { req.destroy(); finish(); });
      req.write(body);
      req.end();
    } catch { finish(); }
  });
}

export async function sendReport(deps: {
  deviceId?: string;
  version?: string;
  post?: (url: string, body: string) => Promise<void>;
} = {}): Promise<void> {
  try {
    const deviceId = deps.deviceId ?? getDeviceId();
    const version = deps.version ?? "0.0.0";
    const payload = buildPayload(deviceId, version);
    const post = deps.post ?? ((url, body) => postJson(url, body));
    await post(TELEMETRY_ENDPOINT, JSON.stringify(payload));
  } catch { /* telemetry must never throw */ }
}
