# hunter-proxy

A Cloudflare Worker that looks up work emails and company rosters through Hunter.io without putting the Hunter key in the page.

Live no longer calls this worker. The partner app calls Hunter through prod-api, and it clears any saved Hunter proxy URL. Public GitHub Pages must not call Hunter. This folder remains only so an old deploy can be deleted from Cloudflare. The class prototype at the repository root can still save a proxy URL for its own demo.

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
