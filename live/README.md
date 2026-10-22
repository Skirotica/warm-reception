# live

The partner screen for Warm Reception. `index.html` is the whole app: the queue, the decision, the draft, and the Approve / Edit / Escalate gate.

Two hosts serve this file, and they are not the same product:

| Host | What a partner gets |
|---|---|
| Public GitHub Pages | A synthetic shell. Fake companies. No Exa refresh. Hunter stays off. |
| Private Cloudflare Pages (`warm-reception-live.pages.dev`, and `blackgavel.geetm.ai`) | The real queue, backed by the Worker in [prod-api/](../prod-api/). |

The class prototype at the repository root stays frozen. Changes for partners belong in this folder.

## Files

| File | Role |
|---|---|
| `index.html` | The Live console. |
| `OPERATOR.md` | How to deploy the gate, save the partner code, and use the private store. |
| `PRIVACY_REVIEW.md` | Why real names, emails, and the client book stay off the public page. |
| `favicon.png` | Warm Reception icon. |
| `geetm-favicon.png` | GeeTM icon used when that brand is on. |

## Queue rule

An unconfirmed No-go stays on the queue until a partner clicks Confirm No-Go. A magazine or news page that is not a real company can still be removed. Move to Go on a known out-of-ICP No-go asks for an override contact email instead of re-running the same No-go.

The browser stores the Worker URL and the partner code. It does not store provider API keys.
