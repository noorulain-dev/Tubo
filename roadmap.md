# Roadmap

## Missing Context Resolution (human-in-the-loop) — done

Backend
- [x] `accounts/context-resolution.ts` — gap detection, candidate building, resolution validation
- [x] `accounts/context-resolution-repository.ts` — append-only `context_resolutions` audit table
- [x] `accounts/context-resolution-service.ts` — real candidate reads + reconciliation orchestration
- [x] schema-bootstrap + `db/migrations/0006_context_resolutions.sql`
- [x] `state-builder.ts` — human-supplied provenance, deadline-waived, identity linkage
- [x] `command-center.ts` — `needsContextCount` on AccountRow
- [x] routes: GET/POST `/accounts/:id/context-gaps` and `/accounts/:id/context-resolutions`

Frontend
- [x] types + api client + `useContextGaps`
- [x] `ContextResolution.tsx` — inline "Needs context" card + compact right-side sheet
- [x] Command Center filters: All / Needs review / Needs context / Ready for approval / Blocked
- [x] Account detail: context under the affected commitment + "Resolved by … " audit section
- [x] styles in `redesign.css`

Verification
- [x] vitest (144 passed, 16 files)
- [x] typecheck (api + web)
- [x] production build

## Still unsupported (deliberately)
- Commercial/billing truth: not human-assertable; configuration CTA only
- Contact resolution when the CRM cannot be read: no candidates, no manual entry
- Multi-deal candidate lists: CRM provider exposes only `getOpenDeal`, so at most one deal candidate
- Workspace owner directory: only the signed-in user + owners already present in account data

## Luis Mussa case study — done
- [x] Reframe the case study around Luis Mussa, Customer Success Manager
- [x] Add his two verbatim feedback screenshots
- [x] Replace system evaluation figures with clearly labeled illustrative Day 1–Day 5 workflow metrics
- [x] Verify the redesigned public page
