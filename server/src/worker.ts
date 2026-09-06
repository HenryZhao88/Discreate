export interface Env { COUNTS: KVNamespace; }

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isValidPayload(p: any): p is { id: string } {
  return p && typeof p.id === "string" && /^[0-9a-f]{16}$/.test(p.id)
    && typeof p.v === "string" && typeof p.os === "string";
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/") {
    let body: any;
    try { body = await request.json(); } catch { return new Response("bad json", { status: 400 }); }
    if (!isValidPayload(body)) return new Response("bad payload", { status: 400 });
    await env.COUNTS.put(body.id, today()); // id -> date ONLY. No IP, no country.
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET" && url.pathname === "/count") {
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    let total = 0, active30d = 0, cursor: string | undefined;
    do {
      const page: any = await env.COUNTS.list({ cursor });
      for (const k of page.keys) {
        total++;
        const seen = await env.COUNTS.get(k.name);
        if (seen && seen >= cutoff) active30d++;
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return new Response(JSON.stringify({ total, active30d }), { headers: { "Content-Type": "application/json" } });
  }

  return new Response("not found", { status: 404 });
}

export default { fetch: handle };
