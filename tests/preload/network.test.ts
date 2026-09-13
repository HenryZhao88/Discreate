import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadFile, fetchText, fetchResponse, cancelRequest } from "../../src/preload/network";

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/echo") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ method: req.method, header: req.headers["x-test"], body: Buffer.concat(chunks).toString() })); });
      return;
    }
    if (req.url === "/limited") { res.writeHead(429, { "retry-after": "15" }); res.end("limited"); return; }
    if (req.url === "/slow") return;
    if (req.url === "/redirect") { res.writeHead(302, { location: "/ok" }); res.end(); }
    else if (req.url === "/bad-redirect") { res.writeHead(302, { location: "http://[" }); res.end(); }
    else if (req.url === "/abort") {
      res.writeHead(200, { "content-length": "10000" });
      res.write("partial");
      setImmediate(() => res.destroy());
    } else res.end("complete content");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));

describe("native downloads", () => {
  it("preserves POST bodies, headers, and rate-limit responses for plugin requests", async () => {
    const response = await fetchResponse("echo", base + "/echo", { method: "POST", headers: { "x-test": "value" }, body: "q=bonjour" });
    expect(JSON.parse(Buffer.from(response.body).toString())).toEqual({ method: "POST", header: "value", body: "q=bonjour" });
    const limited = await fetchResponse("limited", base + "/limited");
    expect(limited.status).toBe(429);
    expect(limited.headers).toContainEqual(["retry-after", "15"]);
  });
  it("cancels requests and enforces a timeout", async () => {
    const request = fetchResponse("cancel", base + "/slow");
    cancelRequest("cancel");
    await expect(request).rejects.toThrow();
    await expect(fetchResponse("timeout", base + "/slow", { timeout: 20 })).rejects.toThrow();
  });
  it("follows redirects and rejects malformed redirects", async () => {
    expect(await fetchText(base + "/redirect")).toBe("complete content");
    await expect(fetchText(base + "/bad-redirect")).rejects.toThrow();
  });
  it("rejects interrupted responses", async () => {
    await expect(fetchText(base + "/abort")).rejects.toThrow();
  });
  it("preserves the old file after a failed download and atomically replaces it on success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "discreate-download-"));
    const dest = join(dir, "theme.css");
    try {
      writeFileSync(dest, "original");
      await expect(downloadFile(base + "/abort", dest)).rejects.toThrow();
      expect(readFileSync(dest, "utf8")).toBe("original");
      expect(readdirSync(dir)).toEqual(["theme.css"]);
      await downloadFile(base + "/ok", dest);
      expect(readFileSync(dest, "utf8")).toBe("complete content");
      expect(readdirSync(dir)).toEqual(["theme.css"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
