import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const SALT = "discreate-telemetry-v1";

export function hashHwid(hwid: string): string {
  return createHmac("sha256", SALT).update(hwid).digest("hex").slice(0, 16);
}

export function resolveHwid(runner: () => string | null = defaultRunner): string | null {
  let out: string | null;
  try { out = runner(); } catch { return null; }
  if (!out) return null;
  const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out);
  return m ? m[1] : null;
}

function defaultRunner(): string | null {
  try {
    return execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
  } catch {
    return null;
  }
}

interface DeviceIdDeps {
  runner?: () => string | null;
  readFile?: (p: string) => string | null;
  writeFile?: (p: string, d: string) => void;
  idFilePath?: string;
}

export function getDeviceId(deps: DeviceIdDeps = {}): string {
  const hwid = resolveHwid(deps.runner ?? defaultRunner);
  if (hwid) return hashHwid(hwid);

  const idFile = deps.idFilePath ?? join(homedir(), ".discreate", "install-id");
  const read = deps.readFile ?? ((p) => (existsSync(p) ? readFileSync(p, "utf8") : null));
  const write = deps.writeFile ?? ((p, d) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, d);
  });

  let stored = read(idFile);
  if (!stored) {
    stored = randomUUID();
    try { write(idFile, stored); } catch { /* ignore; still return a stable-per-process id */ }
  }
  return hashHwid(stored);
}
