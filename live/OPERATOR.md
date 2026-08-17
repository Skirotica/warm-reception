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

It does not hide the public queue HTML. It does not prove the clicker is Chad versus Courtney (shared code). It does not turn Hunter on.

## Step 5 (private store)

The run log, Exa extras, voice rules, and case results save to Cloudflare D1 (a private database on the Worker). They survive refresh and another laptop, as long as the partner access code is entered. Hunter stays off.

### Courtney: create the database, then deploy

From the `prod-api` folder:

```
npx wrangler d1 create warm-reception
```

Wrangler prints a `database_id` (a long id). Open `wrangler.toml` in this same folder. Uncomment the four D1 lines at the bottom of the secrets section and paste that id:

```
[[d1_databases]]
binding = "DB"
database_name = "warm-reception"
database_id = "paste-the-id-here"
```

Then:

```
npx wrangler d1 execute warm-reception --remote --file=./schema.sql
npx wrangler deploy
```

Do not set Hunter secrets.

### Chad / Courtney: prove the store

1. Hard-refresh Live. Save API and Save code.
2. Status should read **API, code, and store connected**. If it says store not set up yet, the D1 steps above are not finished.
3. Run a case. Approve or Escalate.
4. Refresh the page, Save code again, and check the run log. The action should still be there.

## Step 6 (Exa intake with human confirm)

You do **not** need a new product website (no warmreception.ai) for this step. Stay on GitHub Pages and the existing Worker. The domain that matters here is each **company’s** website, such as discern.com.

Refresh from Exa no longer dumps articles into the queue. It opens a confirm tray. Two articles about the same company (same name or same website) become **one row**. Confirm once. That company appears once in the queue. Extra articles stay as extra stories on that case, not a second DeepJudge. If the company is already queued, Confirm adds the stories to the existing card.

For each company, type or correct the name and its real domain, then Confirm or Skip. Confirm writes the company to the partner store. POC name and email stay blank. Run is blocked until that domain is confirmed. Hunter stays off.

Do not invent a `.com` from a slug. Do not invent a person. Do not type a real POC email into the public Live page.

Seed cases CE-L01 to CE-L05 stay as they are. They already have domains.

A custom product domain (and taking Live off public Pages) comes later, before Hunter and before more people than you and Chad.

## What not to paste on Live

- Anthropic API key
- Hunter keys
- Exa API key
- The partner access code into GitHub or this file
