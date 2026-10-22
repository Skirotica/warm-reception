# prod-api

The production API for Warm Reception Live. It is a Cloudflare Worker. The browser in [live/](../live/) calls this worker. The worker holds the Anthropic, Exa, and Hunter keys and never sends them back.

Public GitHub Pages may call the health check and the Anthropic route. Exa, the private store, and Hunter refuse a `github.io` origin so the public page stays synthetic.

## Files

| File | Role |
|---|---|
| `worker.js` | Routes, queue cleanup, ICP fact fill, and the sequence dispatch cron. |
| `wrangler.toml` | Worker name `warm-reception-prod-api`, allowed origins, cron, and the D1 database binding. |
| `schema.sql` | D1 tables: a key-value store and an audit log. |

## Routes

| Route | What it does |
|---|---|
| `GET /` | Health check. Open, no partner code. |
| `POST /v1/messages` | Anthropic proxy. Needs the partner code. |
| `GET /search` | Exa search. Needs the partner code. Refuses GitHub Pages. |
| `GET /domain-search` and `GET /email-finder` | Hunter. On only when `HUNTER_ENABLED` is true, and never from GitHub Pages. |
| `GET` or `POST /v1/sequence-dispatch` | Sends approved sequence email only. Dry-run until mailbox secrets and the live-send unlock are set. |
| Store routes | Private queue, results, and extras in D1. |

## Schedule

Defined in `wrangler.toml`:

- Exa ingest at 9:00 and 20:00 Eastern.
- Sequence dispatch hourly at :15 UTC. Email only, after a partner has approved. Without the Graph secrets it stays a dry run.

## Secrets

Set these with Wrangler after deploy. Do not commit them.

```text
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put EXA_API_KEY
npx wrangler secret put PARTNER_ACCESS_CODE
npx wrangler secret put HUNTER_API_KEY
npx wrangler secret put HUNTER_DOMAIN_SEARCH_KEY
```

Mailbox send, still off until Chad unlocks it:

```text
npx wrangler secret put MS_TENANT_ID
npx wrangler secret put MS_CLIENT_ID
npx wrangler secret put MS_CLIENT_SECRET
npx wrangler secret put MS_SEND_AS
npx wrangler secret put LIVE_SEND_UNLOCK
```

`LIVE_SEND_UNLOCK` must be the value `true`. Without it, live mailbox send stays closed.

## Queue behavior

Unconfirmed No-go rows stay in the store until a partner confirms No-go. A news publisher page that is not a company can still be removed. Confirmed archives stay archived.
