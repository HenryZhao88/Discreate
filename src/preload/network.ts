import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";

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
