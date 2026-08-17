# Warm Reception Live — operator note (step 3)

Class demo at the site root stays the frozen graded prototype. Chad can still paste an Anthropic key in Settings there. This note is only for **Live** (`/live/` or https://skirotica.github.io/warm-reception/live/).

## What changed

Provider keys no longer live in the Live page. Anthropic and Exa run through one Cloudflare Worker (`prod-api/`). The worker never returns those keys.

Hunter stays **off** on public GitHub Pages (privacy review). Partners can still type a POC email in the human gate (Approve / Edit / Escalate) to move a No-go to Go. Turning Hunter on is a later step, after the tool is private.

Origin allowlist on the worker is friction, not a lock. Anyone who can open the GitHub Pages site can present that origin. Do not put a shared gate secret in the Live page. It would be visible in View Source. Real lock is Cloudflare Access or partner sign-in (step 4).

## Cloudflare secrets to set

From the `prod-api/` folder, after you are logged into Wrangler:

```
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put EXA_API_KEY
```

Paste Chad’s Anthropic key and the Exa key when prompted. Never paste those keys into Live Settings, into `index.html`, or into chat.

Do **not** set Hunter secrets on this worker while the Live page is public. `HUNTER_ENABLED` stays `false` in `prod-api/wrangler.toml`.

## Existing Hunter and Exa workers

Redeploy so they stop echoing any Origin:

```
npx wrangler deploy
```

in `exa-proxy/` (Pages origin allowed, so Live refresh can still use the old Exa URL until you switch).

```
npx wrangler deploy
```

in `hunter-proxy/` (GitHub Pages origin is **not** allowed. Localhost only, until the tool is private).

## What Chad should paste in Live Settings

Only the production API base URL. Example:

`https://warm-reception-prod-api.<your-account>.workers.dev`

No trailing slash. Save API. He should **not** paste Anthropic, Hunter, or Exa keys on Live.

Refresh from Exa and Run both use that same URL (`/search` and `/v1/messages`).

## What Chad should not paste

- Anthropic API key (Live)
- Hunter Email Finder or Domain Search key
- Exa API key
- Any production secret into the class demo page either, except the graded demo still uses an Anthropic key in Settings by design

## Follow-on (do not do in this step)

Step 4: Chad sign-in, or put Live behind Cloudflare Access so it is no longer a public anonymous tool.

Step 5 (only after private): set Hunter secrets, set `HUNTER_ENABLED = "true"`, redeploy `prod-api`, then turn Hunter calls back on in Live. Until then, leave Hunter off.
