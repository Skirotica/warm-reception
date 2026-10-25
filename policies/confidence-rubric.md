# Confidence Rubric

## Signals scored
1. Signal quality (event clarity and freshness)
2. Qualification fit (ICP match)
3. Entity certainty (correct legal entity confirmed)

## Tiers
- High: all three signals strong
- Medium: one signal weak, others strong; still eligible for Go draft
- Low: two signals weak or one missing; Table 1 with mandatory individual review; not batch eligible
- Ambiguous: entity certainty unconfirmed, ICP fields still insufficient to judge after lookups, or overall unclear; Table 3; no draft before human verification
- Out of ICP: hard disqualify with known facts (confirmed out of ICP size/revenue/sector/backing, bankruptcy, non-qualifying event) → Table 2 No-go. Do **not** use Out of ICP / No-go merely because data is missing. (Legacy stored label: Below Threshold is still treated as No-go.)

## Routing
- Medium or higher + entity confirmed + ICP met → Table 1 Go
- Ambiguous entity OR not enough information to judge ICP/event/entity → Table 3 Ambiguous (not No-go)
- Known hard disqualify (existing client, confirmed out of ICP, bankruptcy, duplicate/opt-out) → Table 2
- Missing / sparse Hunter verified POC email when company+event would otherwise fit (`fit_if_email_secured: Would-go`) → Table 3 Ambiguous (partner secures email / Move to Go). Capstone demo CE-08 without live Hunter may still expect Table 2 for blank preferred+alternate.
