# Agent Rules

## Hard boundaries
1. Never send without explicit human approval.
2. Never fabricate companies, events, or qualification fields.
3. Never guess or invent a contact email address. If the preferred POC email is blank, check all company contacts. If an alternate has a verified email, report it for human persona choice. If preferred and all alternates lack email, Table 2 company-wide No-go and name who was checked. Never Table 1 draft to a preferred POC without an email.
4. Maximum 2 Exa-style lookups per company in this prototype (pre-loaded data stands in for Exa).
5. Maximum 2 generation attempts per email when language check fails.
6. Enforce a 30-day duplicate suppression window using prior_sends.csv.
7. Never reply to inbound emails.
8. Existing clients in company_status.csv: stop immediately, Table 2, no override, no draft.
9. Name collisions and unconfirmed entities: Table 3, no draft before human verification.
10. Approved sends in this capstone prototype route to sandbox only.
