# Warm Reception — privacy review (production step 2)

**Date:** 17 Aug 2026  
**Verdict:** **No-go** for production PII on the current live URL (`https://skirotica.github.io/warm-reception/live/`).  
**Owner:** Chad decides. Courtney operates.  
**Partner answers (17 Aug 2026):** production item 2 is recorded in section 11. Those answers are the current product rules for public vs private, existing clients, and do-not-contact.  
**PII** means names, titles, and emails of real people.

Faculty and this review agree: do not put more real-people data into today’s public GitHub Pages live tool. That includes real POC emails, Chad’s client book, real prior-sends, and any do-not-contact list. Combining a real person with a work title, an email, and an outreach draft is a targeted contact file. A public page with no sign-in is not a safe place for that file.

## 1. Opt-out / do-not-contact

If a person or company says stop, unsubscribe, or do not contact, remaining sends in that sequence stop immediately. The refusal is recorded so future cases for that contact or company are No-go. That list is confidential. It lives only in a private signed-in store. It is never pasted into GitHub Pages, the public HTML, or a public live queue. Until that private store exists, honor opt-outs by not adding real people to the public tool at all.

## 2. Existing clients stay confidential

Client names are confidential even when company news is public. The real Black Gavel client book never goes on Pages. The class demo’s fake ENARRESS row is practice only. It does not protect a real client. Live companies must be checked against Chad’s real book in a private store before a draft is allowed.

## 3. Public versus private

**May stay on the public class demo** (`https://skirotica.github.io/warm-reception/`): the frozen synthetic set (CE-01 through CE-20), fake emails, and the graded evidence. That URL stays fake data on purpose.

**Must wait for a private signed-in tool:** real POC emails, Hunter lookups, Chad’s client list, prior sends, opt-outs, partner-vetted whitelist of real companies, Approve / Edit / Escalate tied to a named person, and Anthropic processing of prospect PII.

The live URL already mixes public company news with real people. It may stay as a class-adjacent demo of public headlines only. It is not production.

## 4. Hunter stays off on public Pages

Hunter Domain Search can load a company email roster, not only the intended POC. Those addresses would appear on a public page and then travel to the model. Hunter stays **off** on GitHub Pages until the tool is private.

## 5. Names already on Pages: freeze

Discern, Wordsmith AI, Jusfy, Entegrata, Aavalynx, and named people already in the public files (including Tim Dorris and other announcement names) are frozen as public news. Do not add emails. Do not add more people. Do not use Refresh from Exa to grow the public queue. Stripping names this week is optional if Chad wants a cleaner freeze. Leaving public headlines in place is not permission to collect emails.

## 6. Anthropic as a later processor only

Anthropic may process prospect PII later, as a vendor inside a private tool, only after three things are true: secrets are off the browser, Chad is signed in, and cases live in a private store. Not on today’s public page.

## 7. Worker URLs are exposed until signed-in

Treat current helper and production API addresses as known. Anyone who saw the URL can try to use it until the live product requires a signed-in user. Do not treat origin checks or a shared code as proof the clicker is Chad.

## 8. Hard stops before production PII

Chad must accept each, or block going further.

1. No real POC emails on GitHub Pages, in the public HTML, or in a public live queue. Hunter stays off on Pages.
2. No real client list, prior-sends, opt-outs, or partner-vetted whitelist of real companies on a public site.
3. No Anthropic, Hunter, or Exa keys in the browser for production. No open helpers that spend those keys.
4. No treating every visitor as Chad. Approve, Edit, and Escalate belong to a signed-in person.
5. No treating the fake ENARRESS row as production client protection.
6. No adding more real people to the public files, including via Refresh from Exa, until the live product is private.
7. Jusfy (Brazil) and Aavalynx (UK/EU founder) stay out of any real-email path until Chad accepts that extra legal load. Public news is already on the page. Email lookup would make it worse.

## 9. Chad’s recommended defaults this week

- Keep the class demo public and frozen. Yes. CE-01 through CE-20 only as the graded evidence set.
- Hunter on the public live page. Off.
- Names already on Pages. Freeze. No emails. No more people.
- Existing clients confidential. Yes. They never go on Pages.
- Anthropic as a later processor after secrets, sign-in, and a private store. Yes. Not on today’s public page.
- Treat current worker URLs as exposed until signed-in. Yes.

## 10. Verdict

**No-go** for production PII on the current live URL. Keep the synthetic class demo public. Move live work to a private signed-in tool before any real emails, clients, or opt-out list enter the product. Do not connect a real mailbox, and do not turn Hunter on for production, until steps 3 through 5 are true (secrets off the browser, sign-in, private store).

## 11. Courtney answers (17 Aug 2026)

Production security / privacy item 2. These are product rules. The do-not-contact button is not built this turn.

**Public versus private data.** Once sign-in works, real company and contact data must not stay visible outside login. Everything needs to be behind the login.

**Gap vs GitHub Live (not wiped this turn).** `https://skirotica.github.io/warm-reception/live/` is still public HTML with no login. Page source still includes the seed companies Discern, Wordsmith, Jusfy, Entegrata, and Aavalynx. OPERATOR currently keeps GitHub Pages Live public on purpose. Section 5 of this review froze those names as public news and treated stripping as optional. That freeze no longer matches Courtney’s “everything behind login” rule. Next step (not this turn): make GitHub Live synthetic-only, or take Live off github.io, and keep real company data only on Access-protected pages.dev. Do not treat this gap as permission to add more real data to Pages.

**Existing clients.** Never draft outreach to a company already on the client list. Never send to a client, ever.

**How to protect that list (coaching note).** Courtney’s product answer is the never-outreach rule above. The second half of the question was about *where the list lives* if the page or store is stolen, not whether to contact clients. Do not put the client list in the public page, in GitHub, or in the browser page source. Keep it in the private store behind login (Worker / D1). If someone steals that store they could still see who the clients are, so the list should live only there, not also in HTML anyone can download. Courtney did not need to design the theft case; Chad owns that later.

**Opt-out / do-not-contact.** Respect stop requests. A human adds the person to a do-not-contact list via a button (not built this turn). Block future sends to that person. Person-level DNC from “do not contact me” replies. Company-wide DNC is still undecided; use person-level until Chad says otherwise. Duration: hold until a partner removes them (indefinite). She did not specify a time limit.
