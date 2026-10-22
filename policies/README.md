# policies

The written rules the agent is coached with. The console turns these into the instructions on each run. If the agent misbehaves, change the rule here before changing the screen.

These files describe synthetic practice cases and the Black Gavel voice. They are not a place to paste a real client list or real email threads.

| File | What it decides |
|---|---|
| `agent-rules.md` | Hard stops: no send without approval, no invented emails, client stop, entity collisions, CTA and persona rules. |
| `icp-criteria.md` | Who is in range: legaltech, 50 to 350 people, $15M to $50M, VC or PE backed, small talent team. Missing facts stay Ambiguous. Known disqualifiers are No-go. |
| `signal-taxonomy.md` | Which news counts (hire, funding, partnership, merger, acquisition, IPO) and which news stops the case. |
| `confidence-rubric.md` | High, Medium, Low, Ambiguous, and Out of ICP, and which table each one maps to. |
| `campaign-routing.md` | Which persona sheet matches the contact's title and the event. |
| `prequalified-whitelist.md` | When a vetted company skips a fresh ICP score. The list itself is in `data/prequalified_whitelist.csv`. |
| `black_gavel_outreach_sequence.md` | The four-email cadence, the persona sheets, and the allowed calls to action. |
| `approved_email_examples_partnerC.md` | Approved voice examples for one partner. |
| `approved_email_examples_partnerN.md` | Approved voice examples for the other partner. |
| `summary_table_example.md` | What a Go, No-go, and Ambiguous summary should look like on screen. |

Go is Table 1. No-go is Table 2. Ambiguous is Table 3. A partner still approves, edits, or escalates before anything is treated as sent.
