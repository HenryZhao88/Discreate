<!-- server/README.md -->
# Discreate telemetry server

A Cloudflare Worker that counts unique devices. It stores **only** `deviceId -> lastSeenDate`. No IP, no country, no user-agent, no other data is retained.

## Endpoints
- `POST /` — body `{ id, v, os, osv, arch }`; writes `id -> today`. Returns 204.
- `GET /count` — returns `{ total, active30d }`.

## Deploy
1. `npm install`
2. Create a KV namespace: `npx wrangler kv namespace create COUNTS` and paste the id into `wrangler.toml`.
3. `npx wrangler deploy`
4. Copy the deployed URL into `TELEMETRY_ENDPOINT` in `src/telemetry/report.ts`.
