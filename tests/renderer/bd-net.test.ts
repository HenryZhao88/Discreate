// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installBdApi } from "../../src/renderer/api/bd-api";

vi.mock("../../src/renderer/core/webpack", () => ({ findByProps: () => undefined }));
afterEach(() => { delete (window as any).DiscreateNative; delete (window as any).BdApi; vi.restoreAllMocks(); });

describe("BdApi.Net.fetch", () => {
  it("returns a Response with HTTP status, headers, JSON, and binary data from the native bridge", async () => {
    const fetchResponse = vi.fn().mockResolvedValue({ status: 429, statusText: "Too Many Requests", url: "https://example.test", headers: [["retry-after", "10"]], body: Array.from(new TextEncoder().encode('{"error":"limited"}')) });
    (window as any).DiscreateNative = { fetchResponse };
    const fetch = installBdApi().Net.fetch;
    const response = await fetch("https://example.test", { method: "POST", body: "q=bonjour", headers: { "x-test": "value" }, timeout: 123 });
    expect(response.ok).toBe(false);
    expect(response.headers.get("retry-after")).toBe("10");
    expect(await response.json()).toEqual({ error: "limited" });
    expect(fetchResponse.mock.calls[0].slice(1)).toEqual(["https://example.test", { method: "POST", body: "q=bonjour", headers: { "x-test": "value" }, timeout: 123 }]);
    fetchResponse.mockResolvedValue({ status: 200, statusText: "OK", url: "https://example.test", headers: [], body: [0, 128, 255] });
    expect(Array.from(new Uint8Array(await (await fetch("https://example.test")).arrayBuffer()))).toEqual([0, 128, 255]);
  });
  it("forwards aborts and immediately rejects without waiting for the bridge", async () => {
    const fetchResponse = vi.fn((_id: string, _url: string, _opts: any) => new Promise(() => {}));
    const cancelRequest = vi.fn();
    (window as any).DiscreateNative = { fetchResponse, cancelRequest };
    const controller = new AbortController();
    const request = installBdApi().Net.fetch("https://example.test", { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelRequest).toHaveBeenCalledWith(fetchResponse.mock.calls[0][0]);
  });
});
