# Agent Rules

## Hard boundaries
1. Never send without explicit human approval.
2. Never fabricate companies, events, or qualification fields.
3. Never guess or invent a contact email address. If the preferred POC email is blank, check all company contacts. If an alternate has a verified email, report it for human persona choice. If preferred and all alternates lack email, Table 2 company-wide No-go and name who was checked. Never Table 1 draft to a preferred POC without an email.
4. Maximum 2 Exa.ai lookups per company (pre-loaded Exa.ai responses stand in for the live API in this prototype).
5. Maximum 2 generation attempts per email when language check fails.
6. Enforce a 30-day duplicate suppression window using prior_sends.csv.
7. Never reply to inbound emails.
8. Existing clients in company_status.csv: stop immediately, Table 2, no override, no draft.
9. Name collisions and unconfirmed entities: Table 3, no draft before human verification.
10. Approved sends in this capstone prototype route to sandbox only.
11. Pre-qualified whitelist (`prequalified_whitelist.csv` / prequalified-whitelist.md): if the company is on the partner-vetted list, skip ICP re-qualification and go straight to event + POC + draft. Still enforce client stop, missing email, entity collision, and disqualifying current-event signals. Cite the whitelist in citations; say bypass in plain language in Why.
12. Draft CTAs: end every Go email with one approved human CTA from black_gavel_outreach_sequence.md. Never use "Let me know if a brief call makes sense", "Worth 15 minutes?", or close variants. Resolve {{tomorrow_day_of_week}} and {{two_working_days}} as business days only. Evening CTA only before 2pm recipient local time (default Eastern).
13. Never output em dashes (— or –) in draft subjects or bodies. Use commas, periods, or restructure. Prefer Black Gavel templates over freeform prose.
14. Do not scrape LinkedIn or invent LinkedIn profile URLs. Treat `hunter_io` / contact email and linkedin_url as Hunter.io lookup results. The console shows LinkedIn from Hunter.io when present, otherwise a people-search fallback. In partner-facing Why, say Hunter.io found or did not find the email or LinkedIn URL. Never say "on file," "in our database," or "from ICP contacts."
15. Partner-facing Why (Table 2 and Table 3): write `why` and `reason_or_ambiguity` in plain language a recruiting partner can act on. Never name internal files (agent-rules.md, icp-criteria.md, confidence-rubric.md, etc.), never cite rule numbers or table numbers, and never use unexplained jargon (entity sourcing, confidence tier, ambiguous tier). Put record IDs and policy file names only in `citations`. Name Exa.ai for event/article research and Hunter.io for email/LinkedIn. End Why with a clear next action.

