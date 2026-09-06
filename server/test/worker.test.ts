// server/test/worker.test.ts
import { describe, it, expect } from "vitest";
import { handle } from "../src/worker";

function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    put: async (k: string, v: string) => { store.set(k, v); },
    list: async () => ({ keys: [...store.keys()].map((name) => ({ name })) }),
    get: async (k: string) => store.get(k) ?? null,
  };
}

describe("worker POST /", () => {
  it("stores id -> date and nothing else", async () => {
    const kv = fakeKV();
    const body = JSON.stringify({ id: "abcdef0123456789", v: "0.2.0", os: "darwin", osv: "25", arch: "arm64" });
    const res = await handle(new Request("https://x/", { method: "POST", body }), { COUNTS: kv } as any);
    expect(res.status).toBe(204);
    expect(kv.store.has("abcdef0123456789")).toBe(true);
    expect(kv.store.get("abcdef0123456789")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("rejects a malformed payload", async () => {
    const kv = fakeKV();
    const res = await handle(new Request("https://x/", { method: "POST", body: "{}" }), { COUNTS: kv } as any);
    expect(res.status).toBe(400);
    expect(kv.store.size).toBe(0);
  });
  it("rejects an id with the wrong length/format", async () => {
    const kv = fakeKV();
    const body = JSON.stringify({ id: "abc123", v: "0.2.0", os: "darwin", osv: "25", arch: "arm64" });
    const res = await handle(new Request("https://x/", { method: "POST", body }), { COUNTS: kv } as any);
    expect(res.status).toBe(400);
    expect(kv.store.size).toBe(0);
  });
});

describe("worker GET /count", () => {
  it("returns total device count", async () => {
    const kv = fakeKV();
    kv.store.set("a", "2026-09-06");
    kv.store.set("b", "2026-09-06");
    const res = await handle(new Request("https://x/count"), { COUNTS: kv } as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(2);
  });

  it("computes active30d from only recently-seen devices", async () => {
    const kv = fakeKV();
    const todayStr = new Date().toISOString().slice(0, 10);
    kv.store.set("recent", todayStr);
    kv.store.set("stale", "2000-01-01");
    const res = await handle(new Request("https://x/count"), { COUNTS: kv } as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(2);
    expect(json.active30d).toBe(1);
  });
});
