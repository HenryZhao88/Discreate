import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadFile, fetchText } from "../../src/preload/network";

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
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
