# exa-proxy

A small Cloudflare Worker that searches Exa for the browser without putting the Exa key in the page.

Live no longer calls this worker. The partner app uses the search route on prod-api, and it clears any saved Exa proxy URL. This folder remains only so an old deploy can be deleted from Cloudflare. Do not point a new Settings field here.

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
