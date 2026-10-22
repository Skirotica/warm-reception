# exa-proxy

A small Cloudflare Worker that searches Exa for the browser without putting the Exa key in the page.

Live no longer needs this worker. The partner app calls the search route on [prod-api/](../prod-api/). Keep this folder for the older Exa-only URL until that Settings field is fully switched.

## What is here

| File | Role |
|---|---|
| `worker.js` | `GET /search`. Returns title, url, date, and text. Refuses any origin not on the allowlist. Never returns the key. |
| `wrangler.toml` | Worker name `warm-reception-exa-proxy` and the allowed origins. |

## Secret

Set the key in Wrangler. Do not commit it.

```text
npx wrangler secret put EXA_API_KEY
```
