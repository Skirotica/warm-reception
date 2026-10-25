# data

Synthetic records the class prototype reads. Company names, domains, and emails here are fake (`.example`). Do not replace these files with a real client book, real contacts, or a real do-not-contact list. Private Live keeps real records in the Cloudflare store, not in this folder.

| File | What it holds |
|---|---|
| `candidate_events.csv` | The news events the agent scores: hire, funding, partnership, and the rest. |
| `company_profiles.csv` | Sector, size, revenue, backing, and talent-team size used for ICP. |
| `company_status.csv` | Existing-client stop. A client is never cold-outreached. |
| `icp_contacts.csv` | Synthetic points of contact and whether employment was confirmed. |
| `prequalified_whitelist.csv` | Companies a partner already vetted, so ICP is not scored again. |
| `prior_sends.csv` | Recent sends used for the 30-day duplicate window. |
| `denial_log.csv` | Past partner refusals, kept so the same miss is not repeated blindly. |
| `employment_check.json` | Employment confirmation used when a contact's role is in doubt. |
| `user_preferences.json` | Partner voice and drafting preferences for the prototype. |
| `eval_cases.csv` | The scoreboard: expected decision versus what the agent actually did. |

The matching written rules are in [policies/](../policies/).
