import { get as httpGet, request as httpRequest, type IncomingMessage } from "node:http";
import { get as httpsGet, request as httpsRequest } from "node:https";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

const activeRequests = new Map<string, AbortController>();

export function cancelRequest(id: string): void { activeRequests.get(id)?.abort(); }

/** Buffered HTTP response for BdApi.Net.fetch, outside the page's CSP. */
export async function fetchResponse(id: string, url: string, options: RequestOptions = {}) {
  if (activeRequests.has(id)) throw new Error("Duplicate request ID");
  const controller = new AbortController();
  activeRequests.set(id, controller);
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 10_000);
  async function send(address: string, redirects = 5): Promise<any> {
    const parsed = new URL(address);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported protocol: " + parsed.protocol);
    const request = parsed.protocol === "https:" ? httpsRequest : httpRequest;
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(parsed, { method: options.method ?? "GET", headers: options.headers, signal: controller.signal }, resolve);
      req.on("error", reject);
      req.end(options.body);
    });
    const status = res.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
      res.resume();
      if (!redirects) throw new Error("Too many redirects");
      const next = new URL(res.headers.location, address);
      if (next.origin !== parsed.origin) {
        options = { ...options, headers: Object.fromEntries(Object.entries(options.headers ?? {})
          .filter(([name]) => !["authorization", "cookie", "proxy-authorization"].includes(name.toLowerCase()))) };
      }
      if (status === 303 || ([301, 302].includes(status) && options.method?.toUpperCase() === "POST")) {
        options = { ...options, method: "GET", body: undefined };
      }
      return send(next.href, redirects - 1);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of res) chunks.push(Buffer.from(chunk));
    return {
      status, statusText: res.statusMessage ?? "", url: address,
      headers: res.rawHeaders.reduce<[string, string][]>((all, value, i) => {
        if (i % 2 === 0) all.push([value, res.rawHeaders[i + 1]]);
        return all;
      }, []),
      body: Array.from(Buffer.concat(chunks)),
    };
  }
  try { return await send(url); }
  finally { clearTimeout(timeout); activeRequests.delete(id); }
}

function response(url: string, redirects = 5): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported protocol: " + parsed.protocol);
    const get = parsed.protocol === "http:" ? httpGet : httpsGet;
    const request = get(parsed, { headers: { "User-Agent": "Discreate/0.1" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        try { resolve(response(new URL(res.headers.location, url).href, redirects - 1)); }
        catch (error) { reject(error); }
      } else if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      } else resolve(res);
    });
    request.setTimeout(30_000, () => request.destroy(new Error(`Request timed out: ${url}`)));
    request.on("error", reject);
  });
}

export async function fetchText(url: string): Promise<string> {
  const res = await response(url);
  const chunks: Buffer[] = [];
  for await (const chunk of res) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** Publish only complete downloads; a network failure must preserve an existing plugin/theme. */
export async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await response(url);
  const temporary = `${dest}.${randomUUID()}.tmp`;
  try {
    await pipeline(res, createWriteStream(temporary, { flags: "wx" }));
    await rename(temporary, dest);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}
