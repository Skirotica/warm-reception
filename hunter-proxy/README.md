# hunter-proxy

A Cloudflare Worker that looks up work emails and company rosters through Hunter.io without putting the Hunter key in the page.

Live no longer needs this worker. The partner app calls Hunter through [prod-api/](../prod-api/), and only from a private host. Public GitHub Pages must not call Hunter. This folder stays as the older standalone proxy.

## What is here

| File | Role |
|---|---|
| `worker.js` | `GET /email-finder` and `GET /domain-search`. Rejects a browser-supplied key. |
| `wrangler.toml` | Worker name `warm-reception-hunter`. Localhost is allowed. GitHub Pages is not. |

## Secrets

Set these in Wrangler. Do not commit them.

```text
npx wrangler secret put HUNTER_EMAIL_FINDER_KEY
npx wrangler secret put HUNTER_DOMAIN_SEARCH_KEY
```

`HUNTER_API_KEY` is a fallback if a product-specific secret is missing.
