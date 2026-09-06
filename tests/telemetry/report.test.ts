import { describe, it, expect, vi } from "vitest";
import { buildPayload, postJson, sendReport, TELEMETRY_ENDPOINT } from "../../src/telemetry/report.js";

describe("buildPayload", () => {
  it("contains exactly id, v, os, osv, arch", () => {
    const p = buildPayload("abc123", "0.2.0", { platform: "darwin", release: "25.6.0", arch: "arm64" });
    expect(p).toEqual({ id: "abc123", v: "0.2.0", os: "darwin", osv: "25.6.0", arch: "arm64" });
    expect(Object.keys(p).sort()).toEqual(["arch", "id", "os", "osv", "v"]);
  });
});

describe("postJson", () => {
  it("resolves without throwing when the request errors", async () => {
    const fakeRequest = (() => {
      const req: any = { on: (ev: string, cb: any) => { if (ev === "error") setTimeout(() => cb(new Error("net")), 0); return req; }, setTimeout: () => req, write: () => {}, end: () => {}, destroy: () => {} };
      return req;
    }) as any;
    await expect(postJson("https://x", "{}", { request: fakeRequest })).resolves.toBeUndefined();
  });
});

describe("sendReport", () => {
  it("posts the built payload to the endpoint and never throws", async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    await sendReport({ deviceId: "id16", version: "9.9.9", post });
    expect(post).toHaveBeenCalledOnce();
    const [url, body] = post.mock.calls[0];
    expect(url).toBe(TELEMETRY_ENDPOINT);
    expect(JSON.parse(body).id).toBe("id16");
    expect(JSON.parse(body).v).toBe("9.9.9");
  });
  it("swallows a throwing post", async () => {
    const post = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(sendReport({ deviceId: "id16", version: "9.9.9", post })).resolves.toBeUndefined();
  });
});
