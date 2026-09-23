# Campaign Routing

Map company size and contact type to Black Gavel persona sheets.

## Personas
- New Hire
- Hiring Manager (finance / legal leadership only)
- CRO / CEO / Founder (includes COO)
- Talent Acquisition
- Head of Talent and HR

## Qualified POC titles (Hunter / Approve packaging)
Keep only contacts whose title matches a persona above. Examples: CEO, COO, CRO, Founder, Head of Talent / People / HR, Recruiter / TA, Hiring Manager, CFO / Controller / General Counsel / finance or legal leadership, and named executive hires for the New Hire sheet.

## Never package as POC (IC / tech)
QA, Quality Assurance, Product Manager / Product Management, Software Engineer / Developer, Engineering (non-people), IT, IS, Information Systems, DevOps, Data Scientist (unless clearly a people/talent executive). Generic "Manager" or "Director" alone is not enough.

## Default routing
- POC is the named executive in an executive_hire event → New Hire
- **funding_round or IPO** → normal POC persona sheet; console auto-fills **Fund Raising** 13-step copy (congrats on round + post-funding hiring priorities). Not an open-req search.
- New CRO / VP Sales / revenue leadership hire at the company, but POC is someone else → CRO / CEO / Founder (company event)
- VP Talent / Head of Talent hire → Head of Talent and HR
- TA team present (1–2) and hiring surge → Talent Acquisition
- Broad company event with unclear contact → Hiring Manager as fallback after human review if needed (finance/legal leadership only)

## Sector notes
- Legaltech: emphasize matter velocity, specialized hiring, and practice-aligned recruiting.
