# Warm Reception Live — operator note

Class demo at the site root stays the frozen graded prototype. This note is only for **Live** (`https://skirotica.github.io/warm-reception/live/`).

## Step 3 (done)

Provider keys live on the Cloudflare Worker (`prod-api`). Live Settings only stores the Worker URL. Hunter stays **off** on public GitHub Pages.

Secrets already set:

```
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put EXA_API_KEY
```

Live Production API URL:

`https://warm-reception-prod-api.cryandean.workers.dev`

## Step 4 (partner access)

Run and Refresh from Exa require a **partner access code**. That code is a Worker secret. It is not in the HTML. Partners type it in Live and click Save code. Closing the tab clears it (session only).

Hunter stays off. The Live HTML is still a public GitHub page (queue names are visible). The code only locks **Run / Exa / Anthropic**. Cloudflare Access on a private host is the stronger follow-on.

### Courtney: deploy the gate

From the `prod-api` folder:

```
npx wrangler deploy
npx wrangler secret put PARTNER_ACCESS_CODE
```

Pick a long phrase only you and Chad know. Do not paste it into GitHub, chat, or the HTML file.

If Wrangler asks about Cloudflare skills (Y/n), press Ctrl+C. The deploy is already done.

### Chad / Courtney: use Live

1. Hard-refresh https://skirotica.github.io/warm-reception/live/
2. Production API URL should still be saved. If not, paste `https://warm-reception-prod-api.cryandean.workers.dev` and click **Save API**.
3. In **Partner access code**, type the same phrase you put in Wrangler. Click **Save code**. The box should clear. Status should read **API and partner code saved**.
4. Click Run on one case.

Without the code, Run should say partner access required. Do not paste Anthropic keys.

### What this does not do

It does not hide the public queue HTML. It does not prove the clicker is Chad versus Courtney (shared code). It does not turn Hunter on. Step 5 (private store + Hunter) waits until Live is no longer a public anonymous page.

## What not to paste on Live

- Anthropic API key
- Hunter keys
- Exa API key
- The partner access code into GitHub or this file
