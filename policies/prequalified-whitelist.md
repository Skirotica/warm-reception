# Pre-qualified company whitelist

## Purpose
Partners maintain a short list of companies already vetted as outreach-worthy. When a candidate event maps to a company on this list, Warm Reception **skips ICP re-qualification** (sector size revenue backing TA checks against icp-criteria.md) and proceeds to **event monitoring + POC + draft** work only.

## Source
`data/prequalified_whitelist.csv` (embedded as `PREQUALIFIED_WHITELIST` in the prototype).

## What whitelist bypasses
- Re-running full ICP field scoring when the company is already partner-vetted.

## What whitelist does NOT bypass
1. Existing-client hard stop (company_status client).
2. Missing verified email (preferred + company_contacts check).
3. Entity collision / ambiguous entity (Table 3).
4. Disqualifying opposite signals on the **current event** (e.g. bankruptcy as the trigger event).
5. Human Approve before sandbox route.
6. Fabricating emails or company facts.

## Expected path when whitelisted
- Confirm company_id / domain match on the whitelist.
- Confirm a qualifying hiring-relevant event (signal-taxonomy.md).
- Confirm verified POC email.
- Table 1 Go (typically High/Medium) with full 4-email sequence when event + email clear.
- In reason_or_ambiguity and citations: state **whitelist bypass** and cite `prequalified-whitelist.md` plus the whitelist row (company_id).
- Do **not** No-go solely for failing classic ICP size/revenue/backing when whitelist matched.
