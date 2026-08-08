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
- Below Threshold: hard disqualify with known facts (confirmed out of ICP size/revenue/sector/backing, bankruptcy, non-qualifying event) → Table 2 No-go. Do **not** use Below Threshold / No-go merely because data is missing.

## Routing
- Medium or higher + entity confirmed + ICP met → Table 1 Go
- Ambiguous entity OR not enough information to judge ICP/event/entity → Table 3 Ambiguous (not No-go)
- Known hard disqualify (existing client, confirmed out of ICP, bankruptcy, duplicate/opt-out) → Table 2
- Missing verified POC email when company+event would otherwise fit → Table 2 No-go with fit_if_email_secured (operational block, not “unknown ICP”)
