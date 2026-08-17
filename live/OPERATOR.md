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

Refresh from Exa no longer dumps articles into the queue. It opens a confirm tray. Two articles about the same company (same name or same website) become **one row**. Confirm once. That company appears once in the queue. Extra articles stay as extra stories on that case, not a second DeepJudge. Refresh skips companies already in the queue even when the article URL is new; those stories attach to the existing card, so you should not get a second Discern or Wordsmith row. Status should say no new companies, not open a confirm tray of duplicates. If Confirm still sees a company already queued, it adds the stories to that card.

For each company, type or correct the name and its real domain, then Confirm or Skip. Confirm writes the company to the partner store. POC name and email stay blank. Run is blocked until that domain is confirmed. Hunter stays off.

Do not invent a `.com` from a slug. Do not invent a person. Do not type a real POC email into the public Live page.

Seed cases CE-L01 to CE-L05 stay as they are. They already have domains.

A custom product domain (and taking Live off public Pages) is step 7, before Hunter.

## Step 6 (done)

Human confirm, company-website links, and same-company de-duplication are on GitHub Pages. One company is one queue card.

## Step 7 (private Live, then Hunter)

Two parts. Access first. Hunter later. Do not mix them.

Hunter stays **off** on `https://skirotica.github.io/warm-reception/live/`. That page is still public HTML. The browser also refuses Hunter on any `github.io` host even if someone later sets `HUNTER_ENABLED=true` on the Worker.

This turn is the login wall on private Live: `https://warm-reception-live.pages.dev`. Leave `HUNTER_ENABLED` as `false`. Do not run the Hunter commands below until Courtney confirms Access passed (incognito hits a login wall).

Class demo at the site root stays public and synthetic. Jusfy (Brazil) and Aavalynx (UK/EU) stay out of the real-email path until Chad accepts that extra legal load.

### Courtney: put Live on Cloudflare Pages

From the project folder (the one that contains the `live` folder):

```
npx wrangler pages deploy live --project-name warm-reception-live
```

Wrangler prints a URL like `https://warm-reception-live.pages.dev` (stable) and sometimes a hashed preview such as `https://5fe9b356.warm-reception-live.pages.dev`. Use the stable URL as Live. Put both on `ALLOWED_ORIGINS` along with GitHub Pages and localhost.

Open `prod-api/wrangler.toml`. Add that Pages URL to `ALLOWED_ORIGINS` (comma, no spaces unless you trim). Example:

```
ALLOWED_ORIGINS = "https://skirotica.github.io,https://warm-reception-live.pages.dev,http://localhost:8765,http://127.0.0.1:8765"
```

Then from `prod-api`:

```
npx wrangler deploy
```

### Courtney: lock the door (Cloudflare Access)

Do this in the Cloudflare dashboard. You cannot finish this from Wrangler. Do not turn Hunter on yet.

GitHub Pages Live stays public on purpose. Do not put Access on `skirotica.github.io`. The private copy is `https://warm-reception-live.pages.dev`.

Cloudflare's shared `pages.dev` host needs Access started from the Pages project. A blank Zero Trust "self-hosted" app pointed at `pages.dev` often does nothing.

**1. Turn on Access for this Pages project**

1. Open https://dash.cloudflare.com and sign in.
2. If Cloudflare asks you to create a Zero Trust / Cloudflare One team, finish that once (pick any team name you will remember).
3. Left nav: **Workers & Pages**.
4. Open the project named **warm-reception-live**.
5. **Settings** → **General**.
6. Select **Preview access** (older docs call this **Enable access policy**). Turn it on.

That only locks hashed preview URLs (`something.warm-reception-live.pages.dev`). It does not lock the stable Live URL. Preview access is not step 7 done.

**2. Cover the stable Live URL**

1. On the Preview access row, select **Manage**.
2. You land in Zero Trust → Access → Applications (labels may say Access controls → Applications).
3. Open the application for this project. Select **Configure**.
4. Under **Public hostname**, in **Subdomain**, delete the `*` wildcard so the host is `warm-reception-live.pages.dev` (not `*.warm-reception-live.pages.dev`).
5. Save.

Then go back to Workers & Pages → **warm-reception-live** → Settings → General and turn **Preview access** on again so hashed preview hosts stay locked too. You should see two applications: one for `warm-reception-live.pages.dev` and one for `*.warm-reception-live.pages.dev`. Do not add a blank Zero Trust self-hosted app for `pages.dev` first. Cloudflare does not treat `pages.dev` as a zone you own, so that path often does nothing.

**3. Allow only Courtney, Chad, and Nick**

The default policy may only let people on your Cloudflare account through. Change it so the three partners can log in with the emails you already have. Do not invent emails. Do not allow a whole domain such as `@gmail.com`.

1. Zero Trust → Access → Applications → open each Warm Reception Live application.
2. Edit the **Allow** policy.
3. Include → **Emails** → add Courtney's email, Chad's email, and Nick's email.
4. Save.

If Cloudflare asks for a login method, add **One-time PIN**: Zero Trust → Integrations → Identity providers → Add new → **One-time PIN**. Partners type their email and get a short code. No Google Workspace required.

**4. Prove the wall (do this before Hunter)**

1. Open a private / incognito window so you are not already logged into Cloudflare.
2. Go to https://warm-reception-live.pages.dev
3. You should see a Cloudflare login wall, not the Live queue.
4. Sign in with your allowed email. After the code, you should see Live as before (queue, Save API, Save code, Run).
5. Leave GitHub Pages Live public: https://skirotica.github.io/warm-reception/live/ still opens with no login, and Hunter stays off there.

**Stop here.** Reply that Access passed. Do not set `HUNTER_ENABLED=true` until that reply.

### Courtney: turn Hunter on (later turn only)

Skip this whole block until Access passed. `HUNTER_ENABLED` is currently `"false"` in `prod-api/wrangler.toml`. Leave it.

Still in `prod-api` (next turn, after Access):

```
npx wrangler secret put HUNTER_API_KEY
```

If Hunter gave you a separate Domain Search key:

```
npx wrangler secret put HUNTER_DOMAIN_SEARCH_KEY
```

In `wrangler.toml` set `HUNTER_ENABLED = "true"`, then:

```
npx wrangler deploy
```

Do not set `HUNTER_ENABLED` while partners still use the public GitHub Pages Live URL as the working Live. GitHub Pages Live stays Hunter-off in the browser even after this Worker flag is on.

### Chad / Courtney: prove Access (this turn)

1. Incognito: https://warm-reception-live.pages.dev shows a login wall, not the queue.
2. After login: Live looks as before. Save API and Save code still work. Run still needs Approve / Edit / Escalate. No mailbox send.
3. GitHub Pages Live still has no login wall and no Hunter.

### Chad / Courtney: prove Hunter (later turn only)

After Access passed and Hunter is on: open the Pages Live URL (not GitHub Pages), confirm one Exa company, click Run. Email lookup may run at that domain. Skip Jusfy and Aavalynx until Chad accepts extra legal load. Approve / Edit / Escalate still required. No mailbox send.

## What not to paste on Live

- Anthropic API key
- Hunter keys
- Exa API key
- The partner access code into GitHub or this file
