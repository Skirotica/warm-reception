# Black Gavel Outreach Sequence (Emails 1–4)

Synthetic voice reference. Tokens: {{first_name}}, {{company}}, {{CV1}}, {{CV2}}, {{CV3}}, {{event_notice}}, {{cta}}.
Console fills this file’s sentences; do not invent alternate openers. Subjects may use {{CV1}} ("CRO hire"). New Hire body copy uses "your recent move" / "your move to {{company}}" because that persona sheet is written to the person who was hired.

## Cadence
- Email 1: trigger day (congratulate / open). Sign-off: full Chad signature
- Email 2: ~3 days later (value / proof). Sign-off: full Chad signature
- Email 3: ~7 days later (soft bump). Sign-off: full Chad signature
- Email 4: ~14 days later (polite close). Sign-off: full Chad signature

## Human gate and sequence sends
Approve (or Edit then save) means the partner is approving the **full four-email Black Gavel sequence** as the planned outreach package for that case, not email 1 alone. In this prototype, that approval routes the package to **sandbox only**. It does not start an unsupervised live drip.

Emails 2–4 are **conditionally authorized**. Before any remaining send goes out (in a real send path), the system must cancel or hold the rest of the sequence if any of these happen after approval:

1. **Reply** from the prospect (or a clear engagement that the partner marks as “in conversation”). Stop remaining automated sequence emails. Partner handles the thread manually.
2. **Bounce** (hard bounce / undeliverable). Stop remaining sends. Mark contact email bad. Do not keep the cadence.
3. **Opt-out** / unsubscribe / “do not contact.” Stop remaining sends immediately. Record prior opt-out so future cases No-go.
4. **Partner cancel or pause.** Partner can kill or freeze the rest of the sequence from the console. No further emails leave.

If none of those stop signals fire, emails follow the cadence above with CTAs resolved for each send day. Duplicate outreach stays blocked by the 30-day prior-sends rule. The agent never auto-replies to inbound mail.

Capstone boundary: Develop proves draft + one Approve of the four-email package + these stop rules as policy. It does not require a live delayed-send engine.

## Style rules (mandatory)
1. Prefer this template file over freeform agent prose. The console fills tokens from case records.
2. Greeting on email steps: {{first_name}}, only. No Hi or Hey on email steps.
3. Never use em dashes in subject or body.
4. Structure every email: greeting, body paragraphs, one CTA, then Chad's full signature as the closing block.
5. CTA appears once, immediately before the signature. Never after the signature.
6. Signature block (exact):

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners


## Approved CTAs
Resolve CTAs from each email's **send day**, not from today for the whole sequence.
Cadence: Email 1 = trigger day; Email 2 ≈ +3 calendar days; Email 3 ≈ +7; Email 4 ≈ +14. If a send day lands on Sat/Sun, roll forward to Monday before choosing the CTA.

When the next calendar day after that email's send day is a weekday:
1. Can I call you tomorrow or {{two_working_days}}?
2. Are you available tomorrow afternoon, {{tomorrow_day_of_week}}?

When the next calendar day after that email's send day is Saturday or Sunday (do not say "tomorrow"):
1. Can I call you {{next_working_day}} or {{two_working_days}}?
2. Are you available {{next_working_day}} afternoon?

3. Are you around this evening for 10 minutes?

Evening CTA (option 3) is eligible only for Email 1, only before 2:00pm recipient local time (default Eastern), and only Monday–Thursday. Never use evening CTA on Friday (weekend starts) or on Emails 2–4.

Business days only (skip Sat/Sun). Friday send: Monday or Tuesday (never "tomorrow", never evening). Monday send: tomorrow / Tuesday wording is correct. Thursday: Friday or Monday.

## Custom variables

- **{{CV1}}** — short event label (CRO hire, Series B raise, strategic partnership).
- **{{CV2}}** — recency sentence (This just landed this week.).
- **{{CV3}}** — **Fund Raising milestone only.** Not a search. Congrats on the round plus typical post-funding hiring needs. Empty for non-funding events. Example: "Congrats on a Series B raise. Teams at your stage often need one or two critical revenue or leadership hires within 60-90 days after a round like this."
- **{{event_notice}}** — Email 1 opener. For funding: {{CV3}} + {{CV2}}. For other events: "Noting the {{CV1}} at {{company}}. {{CV2}}"
- **{{post_funding_priority}}** — Funding only. Typical post-round hiring priorities (revenue leadership, AEs, RevOps in the first 60-90 days).

## Persona: Fund Raising (13-step)

Use when the trigger is **funding_round** or **IPO**. This is a milestone, not a job search.

The console auto-routes to a funding-specific 13-step sheet based on POC role (CRO/CEO, Hiring Manager, TA, Head of Talent). Agent still sets `persona_used` to the normal POC sheet; the console swaps in Fund Raising copy.

**Priorities in the sequence:**
1. Congratulate on the round ({{CV3}} / {{event_notice}}).
2. Reference the 60-90 day post-funding hiring wave: revenue leadership, quota carriers, RevOps, TA overflow.
3. Offer quiet, scoped search help. Never open-req or "your {{CV1}} search" language.

**Tokens:** {{funding_round_label}}, {{CV3}}, {{event_notice}}, {{post_event_hire_line}}, {{post_funding_priority}}

## Persona: New Hire

Use **only when the recipient is the executive named in an executive_hire event** (they joined or were appointed). Body copy may say "your recent move" / "your move to {{company}}".

If the trigger is another person's hire, or the event is funding/partnership/IPO, use **Persona: CRO / CEO / Founder (company event)** or the sheet that matches the POC role. Never congratulate the wrong person on a move they did not make.

### Email 1 (move — recipient is the hire)
Subject: Congrats on the {{CV1}}, quick note from Black Gavel
Sign-off: full Chad signature
Body:
{{first_name}},

Congrats on your recent move to {{company}}.

If you are building out key seats behind that move, we help growth-stage legaltech teams like yours hire revenue and leadership talent without the usual noise.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 2
Subject: {{company}}, how peers fill seats after your move
Sign-off: full Chad signature
Body:
{{first_name}},

Following up on your move to {{company}}. Teams in your stage often need one or two critical hires within 60-90 days after your move.

We run scoped searches so you stay focused on the business, not inbox noise.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 3
Subject: Quick bump, {{company}} hiring after your move
Sign-off: full Chad signature
Body:
{{first_name}},

Short bump in case the timing was off. Happy to share a one-pager on how we staff revenue and leadership roles after your move.

No pitch deck required. Just a short conversation if useful.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 4
Subject: Closing the loop on {{company}}
Sign-off: full Chad signature
Body:
{{first_name}},

I will close the loop on outreach about your move to {{company}}. If hiring becomes urgent later, we are easy to reopen.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

## Persona: CRO / CEO / Founder

Use when the POC is CRO/CEO/Founder/VP Sales and the **trigger is not their personal hire** (someone else was hired, or funding/partnership/IPO). References the event at {{company}}; no "your move" language.

For the named executive hire, use **Persona: New Hire** instead.

### Email 1
Subject: The {{CV1}} at {{company}}, quick note from Black Gavel
Sign-off: full Chad signature
Body:
{{first_name}},

Noting the {{CV1}} at {{company}}. {{CV2}}

When leadership teams add a senior hire on news like that, they often need one or two critical revenue or leadership seats filled quickly. We help growth-stage legaltech companies do that without the usual noise.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 2
Subject: {{company}}, how peers fill seats after the {{CV1}}
Sign-off: full Chad signature
Body:
{{first_name}},

Following up on the {{CV1}} at {{company}}. Teams in your stage often need one or two critical hires within 60-90 days after news like that.

We run scoped searches so you stay focused on the business, not inbox noise.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 3
Subject: Quick bump, {{company}} hiring after the {{CV1}}
Sign-off: full Chad signature
Body:
{{first_name}},

Short bump in case the timing was off. Happy to share a one-pager on how we staff revenue and leadership roles after the {{CV1}}.

No pitch deck required. Just a short conversation if useful.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 4
Subject: Closing the loop on {{company}}
Sign-off: full Chad signature
Body:
{{first_name}},

I will close the loop on outreach about the {{CV1}} at {{company}}. If hiring becomes urgent later, we are easy to reopen.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

## Persona: CRO / CEO / Founder (company event)

Use when the POC is CRO/CEO/Founder/VP Sales but the **trigger event is not their personal hire** (someone else was hired, or funding/partnership/IPO). References the event at {{company}}; no "your move" language.

### Email 1
Subject: The {{CV1}} at {{company}}, quick note from Black Gavel
Sign-off: full Chad signature
Body:
{{first_name}},

Noting the {{CV1}} at {{company}}. {{CV2}}

When leadership teams add a senior hire on news like that, they often need one or two critical revenue or leadership seats filled quickly. We help growth-stage legaltech companies do that without the usual noise.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 2
Subject: {{company}}, how peers fill seats after the {{CV1}}
Sign-off: full Chad signature
Body:
{{first_name}},

Following up on the {{CV1}} at {{company}}. Teams in your stage often need one or two critical hires within 60-90 days after news like that.

We run scoped searches so you stay focused on the business, not inbox noise.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 3
Subject: Quick bump, {{company}} hiring after the {{CV1}}
Sign-off: full Chad signature
Body:
{{first_name}},

Short bump in case the timing was off. Happy to share a one-pager on how we staff revenue and leadership roles after the {{CV1}}.

No pitch deck required. Just a short conversation if useful.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 4
Subject: Closing the loop on {{company}}
Sign-off: full Chad signature
Body:
{{first_name}},

I will close the loop on outreach about the {{CV1}} at {{company}}. If hiring becomes urgent later, we are easy to reopen.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

## Persona: Head of Talent and HR

### Email 1
Subject: The {{CV1}} at {{company}}
Sign-off: full Chad signature
Body:
{{first_name}},

Saw the {{CV1}} at {{company}}. {{CV2}}

We partner with talent leaders at 50-350 person companies to fill critical roles quickly when the business just shifted.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 2
Subject: Capacity after the {{CV1}} at {{company}}
Sign-off: full Chad signature
Body:
{{first_name}},

After the {{CV1}}, TA bandwidth often gets pulled into urgent reqs. We can take a scoped search so your team stays on core priorities.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 3
Subject: Bump, support for {{company}} hiring
Sign-off: full Chad signature
Body:
{{first_name}},

Quick bump on help after the {{CV1}}. If you already have coverage, all good. Otherwise I can send a short approach note.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 4
Subject: Closing the loop, {{company}}
Sign-off: full Chad signature
Body:
{{first_name}},

Closing the loop on {{company}}. Reach out anytime if a critical seat opens and you want quiet help.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

## Persona: Talent Acquisition

### Email 1
Subject: Support for {{company}} after the {{CV1}}
Sign-off: full Chad signature
Body:
{{first_name}},

Noting the {{CV1}} at {{company}}. {{CV2}}

If bandwidth is tight, we can take a scoped search so your team stays focused on core reqs.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 2
Subject: Scoped search option for {{company}}
Sign-off: full Chad signature
Body:
{{first_name}},

Following up on the {{CV1}}. A common pattern is one hard-to-fill role plus overflow from the event. We can own that seat end to end.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 3
Subject: Bump, {{company}} TA support
Sign-off: full Chad signature
Body:
{{first_name}},

Short bump in case req load spiked after the {{CV1}}. I can send a one-page intake if useful.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 4
Subject: Closing the loop, {{company}} TA
Sign-off: full Chad signature
Body:
{{first_name}},

Closing the loop for now. Easy to restart if a priority req lands.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

## Persona: Hiring Manager

### Email 1
Subject: {{company}}, the {{CV1}}
Sign-off: full Chad signature
Body:
{{first_name}},

Congrats on the recent {{CV1}} news at {{company}}. {{CV2}}

If hiring is on your plate because of it, we can help quietly and quickly.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 2
Subject: Roles opening after the {{CV1}} at {{company}}
Sign-off: full Chad signature
Body:
{{first_name}},

Often one announcement like the {{CV1}} creates two or three downstream seats. We can help you fill without a loud process.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 3
Subject: Bump, hiring after the {{CV1}}
Sign-off: full Chad signature
Body:
{{first_name}},

Quick bump. If timing is better now for {{company}}, I am happy to share how we run a quiet search.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners

### Email 4
Subject: Closing the loop, {{company}}
Sign-off: full Chad signature
Body:
{{first_name}},

Closing the loop on the {{CV1}} outreach. Ping anytime if a hire becomes urgent.

{{cta}}

Chadrin Dean | Managing Partner

direct 480.460.4424 | cell 602.421.9942

Black Gavel Growth Partners
