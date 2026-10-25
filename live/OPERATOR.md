# Warm Reception Live — operator note

Class demo at the site root stays the frozen graded prototype.

**GitHub Live** (`https://skirotica.github.io/warm-reception/live/`) is a public synthetic shell: fake `.example` companies, no D1 extras, no Refresh from Exa, Hunter off. Real company and contact data is only on the Access-protected site (`https://warm-reception-live.pages.dev`).

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

Access is on. One-time PIN is the Chad / Nick / Courtney login. Hunter is **on** for private Pages only (`https://warm-reception-live.pages.dev`). GitHub Pages Live stays Hunter **off**.

Hunter stays **off** on `https://skirotica.github.io/warm-reception/live/`. That page is a public synthetic shell: no real companies in the queue, no store extras, no Exa refresh. The browser refuses Hunter, store, and Exa on any `github.io` host. The Worker also 403s those routes if Origin is github.io, even with `HUNTER_ENABLED=true`.

Class demo at the site root stays public and synthetic. Non-US companies (for example Jusfy Brazil, Aavalynx UK/EU) are no longer hard-blocked from Hunter on private Live. Chad accepted that extra legal load; the case shows a notice when location evidence is outside the US.

### Courtney: put Live on Cloudflare Pages

From the project folder (the one that contains the `live` folder):

```
npx wrangler pages deploy live --project-name warm-reception-live
```

Wrangler prints a URL like `https://warm-reception-live.pages.dev` (stable) and sometimes a hashed preview. Use the stable URL as Live. Do not pin a preview hostname in `ALLOWED_ORIGINS`. Preview hostnames change. Put the stable Pages URL on `ALLOWED_ORIGINS` along with GitHub Pages and localhost.

Open `prod-api/wrangler.toml`. Add that Pages URL to `ALLOWED_ORIGINS` (comma, no spaces unless you trim). Example:

```
ALLOWED_ORIGINS = "https://skirotica.github.io,https://warm-reception-live.pages.dev,http://localhost:8765,http://127.0.0.1:8765"
```

Then from `prod-api`:

```
npx wrangler deploy
```

### Courtney: lock the door (Cloudflare Access)

Access is already on. Keep this click path if you need to re-check the wall. You cannot finish Access from Wrangler.

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
5. Leave GitHub Pages Live public: https://skirotica.github.io/warm-reception/live/ still opens with no login. Queue is synthetic only. Hunter, store extras, and Exa stay off there.

Access passed (login wall + One-time PIN). Hunter is on for this private host.

## Existing clients (never outreach)

The real client book lives only in the private store (D1), behind Access. It is not in GitHub, not in the public HTML, and not on GitHub Live.

On `https://warm-reception-live.pages.dev`, after Save API and Save code, use **Existing clients (never outreach)**. Add the legal name and the real website domain. Run on a matching queue card should refuse immediately: No-go / Refused, no email drafts, no Hunter lookup. Approve cannot send. Do not paste that list into chat, GitHub, or this file.

GitHub Live does not show or load this list.

## Do not contact (stop requests)

Person-level. If someone says stop, a partner clicks **Do not contact this person** on that card, or adds the name under **Do not contact**. Future drafts to that person are blocked until a partner clicks Remove. Company-wide DNC is not in this step. The list lives only in the private store. GitHub Live does not load it. Do not paste real names or emails into chat, GitHub, or this file.

## Stop remaining emails / In conversation

On a Go card with a four-email sequence, private Live only. If they reply after email 1, 2, or 3, pick **Last email sent**, then **In conversation** or **Stop remaining emails**. Leftover sequence emails show as Cancelled. This does not add the person to do-not-contact. Use Do not contact only for stop / unsubscribe requests. The stamp lives in the private store. Run again clears it. Nothing is sent. Real mailbox stays locked.

### Courtney: prove sequence stop (this turn)

1. Open https://warm-reception-live.pages.dev. Save API and Save code.
2. Open a Go card with four drafts. Pick Last email sent = Email 1. Click **In conversation**. Emails 2, 3, and 4 should show Cancelled. The queue badge should read In conversation. Do not contact should still be empty for that person.
3. Refresh, Save code, reopen the card. The cancelled emails and In conversation stamp should still be there.
4. Real send must still be locked.

## Email quality (75% of emails approved without edit)

Private Live only. This is a **quality check on the emails the agent generated**. The score is **emails**, not companies. Each sequence has up to four emails.

Approve as written counts those emails as passes. Edit counts only the emails that actually changed as rewrites. Unchanged emails in an Edit still count as accepted as written. Escalates do not count. Re-running the same company keeps the latest review for that company.

The quality bar is met when **75% or more of emails** are approved without edit, and only after **at least 32 reviewed emails** (about 8 sequences). Below 75% means the agent’s drafts need work. Real mailbox send stays locked until the bar is met and Chad opens send. Meeting the bar does not turn on Outlook.

GitHub Live does not show this scoreboard.

### Chad / Courtney: prove email quality (this turn)

1. Open https://warm-reception-live.pages.dev (not GitHub Pages). After Access, Save API and Save code.
2. Look at **Email quality** in the Run log sidebar. It should talk about emails, not sequences.
3. Pick a company that is not on Existing clients and not on Do not contact. Run until you have a four-email draft. Click **Approve** (no Edit). That should add four emails accepted as written.
4. Run another. Click **Edit**, change only one email, save. That should add three accepted and one rewritten. The percent is emails approved without edit, not companies.
5. Real send must still be locked. Nothing leaves the mailbox from this step.

## Sequence Dispatch Bot (post-approve email only)

Private Live only. Approve still means **sandbox / In Sequence**. A Worker cron (`:15` every hour, plus after Exa ingest) is the Sequence Dispatch Bot. It does not invent outreach.

What it does:

1. Reads authorized Go packages from the private store (human Approve already required).
2. For each **Email** step that is approved or edited: checks cadence day offset from `authorized_at`, recipient email present, not DNC, not existing client, not already sent, sequence not stopped.
3. **Out-of-sequence gate:** never skip ahead. A later Email is stopped until earlier Email steps are `sent`. Also stops unapproved steps, missing recipient, empty subject/body. Status `out_of_sequence` with a clear `report` string. Does **not** send.
4. LinkedIn / phone / SMS: never auto-sent (manual only). Reported as **Out of sequence** (“email bot will not send”).
5. If a later Email would skip ahead of an earlier unsent Email: **stops** and reports (example: “Step 3 email attempted before Step 1 was sent”).
6. On schedule match without Microsoft Graph secrets: marks **Held for mail server** (dry-run). Does **not** use Resend for prospects.
7. Live Graph send only when all of these are true: quality bar met, `LIVE_SEND_UNLOCK=true`, and Graph secrets set.

Partners see status under **Email quality → Sequence dispatch** (summary + stopped list), on each step badge, and a case notice when a step was blocked out of sequence.

### Chad: Graph secrets (Exchange 365) before true live delivery

From `prod-api` (same Worker Live already uses):

```
npx wrangler secret put MS_TENANT_ID
npx wrangler secret put MS_CLIENT_ID
npx wrangler secret put MS_CLIENT_SECRET
npx wrangler secret put MS_SEND_AS
```

`MS_SEND_AS` is Chad’s mailbox UPN (the From address Graph sends as). App registration needs **Mail.Send** application permission, admin consented.

Then Chad unlock (fail-closed without this; value must be exactly `true`):

```
npx wrangler secret put LIVE_SEND_UNLOCK
```

Manual dry-run check (partner code header required on private origins):

`POST /v1/sequence-dispatch` or `GET /v1/sequence-dispatch` for last status.

Until Graph secrets and unlock are set, the bot only verifies schedule and holds. Nothing leaves Outlook.

### Courtney: prove sequence dispatch (this turn)

1. Open private Live. Save API and Save code.
2. Approve a Go sequence (sandbox). Open **Run log → Sequence dispatch**. After the next hourly pass (or POST `/v1/sequence-dispatch`), Email steps should show Sandbox authorized or Held for mail server, not Sent.
3. If a later Email would skip ahead of an unsent earlier Email, the badge and the dispatch list show **Out of sequence: …** and nothing sends.
4. Real mailbox must still stay locked.

### Courtney: Hunter on (this turn)

`HUNTER_ENABLED` is `"true"` in `prod-api/wrangler.toml`. GitHub Pages Live stays Hunter-off in the browser and on Hunter Worker routes.

If Hunter secrets are not set yet, still in `prod-api`:

```
npx wrangler secret put HUNTER_API_KEY
```

If Hunter gave you a separate Domain Search key:

```
npx wrangler secret put HUNTER_DOMAIN_SEARCH_KEY
```

Then:

```
npx wrangler deploy
```

Do not use the public GitHub Pages Live URL as the working Live for email lookup.

### Chad / Courtney: prove Access (already done)

1. Incognito: https://warm-reception-live.pages.dev shows a login wall, not the queue.
2. After login: Live looks as before. Save API and Save code still work. Run still needs Approve / Edit / Escalate. No mailbox send.
3. GitHub Pages Live still has no login wall, a synthetic queue, and no Hunter / store / Exa.

### Chad / Courtney: prove Hunter (this turn)

A fresh session forgets API URL and partner code. After Access login:

1. Open https://warm-reception-live.pages.dev (not GitHub Pages).
2. Paste `https://warm-reception-prod-api.cryandean.workers.dev` and click **Save API**.
3. Type the partner access code and click **Save code**.
4. Pick Discern, Wordsmith AI, Entegrata, or Jusfy. Jusfy should show a non-US notice and still allow Hunter when size/sector allow. Aavalynx may stay Hunter-skipped for ICP size (headcount), not for legal load.
5. Click Run. You should see Hunter try (Domain Search / company contacts). Confirm never invents a person, an email, or a `.com` from a company name. Approve / Edit / Escalate still required. No mailbox send.
6. On https://skirotica.github.io/warm-reception/live/ the queue must be synthetic (no Discern / Wordsmith / Jusfy / Entegrata / Aavalynx). Hunter must still refuse. Refresh from Exa must stay off.

## Rerun research (wrong Hunter / wrong domain)

On private Live (`blackgavel.geetm.ai` or `warm-reception-live.pages.dev`), open any Review Queue card that already has a decision (Ambiguous, Pending Review, Go, or No-go). Under **Human review**, click **Rerun research**. That clears Hunter contacts pulled for the wrong website, re-checks the company domain, runs Hunter Domain Search again on the correct site, re-scores the case, and **writes the new result to the durable Live store** (survives refresh; status shows Saved). When the case qualifies (real company domain + persona-fit POC email + no hard disqualifier), Rerun **promotes to Go waiting approval** automatically. It does not Approve or send. Use this when Hunter returned the wrong company (for example monday.com people on a Chamelio card). If a leftover news-publisher husk still shows after a hard refresh, open it and click **Confirm No-Go** to archive it off the queue.

**Persona-only POCs:** Approve packages keep Email Template personas only (CEO/COO/CRO/Founder, Head of Talent/HR, TA/Recruiter, finance/legal Hiring Manager, New Hire). IC/tech titles (QA, Product Management, Software Engineering, IT/IS, DevOps, Data Scientist) are dropped on load and on Rerun research.

## What not to paste on Live

- Anthropic API key
- Hunter keys
- Exa API key
- The partner access code into GitHub or this file
