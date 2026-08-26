# LexDiary Roadmap — Pending Killer Features & Launch Readiness

**Status as of 2026-08-22, with a 2026-08-26 staleness warning below.** This consolidates an
external roadmap review (K1–K12 Killer Feature sequence, Superadmin governance, security/launch
prep, and a recommended Phase-1 freeze) against what has *actually* been built and verified in
this codebase — including work that postdates the original review and isn't reflected in it.
Two existing docs (`docs/phase-1-freeze.md`, `docs/phase-1-product-baseline.md`) are now stale
in specific, listed ways (see "Corrections to existing docs" below) and should be updated
alongside this one, not read as current on their own.

> **2026-08-26 update — read before trusting K1–K4's "PASS" rows below.** Ten commits landed
> after this doc was written, decomposing the app into 7 independently deployed Cloudflare
> Worker microservices (`docs/microservices-decomposition-status.md` has the full record). Every
> "PASS" verdict below was earned against the pre-decomposition single-Worker codebase and has
> **not been re-verified** against the code that now actually runs. See "K1–K4 status after the
> microservices decomposition" immediately below the table for what specifically changed and
> why these should be treated as **provisional, not PASS**, until the deferred validation pass
> (also not yet run) completes.

**The core recommendation stands and this session already followed it in practice**: freeze
new Killer Feature work at K4, let real usage pick K5 vs. K7 vs. K8 vs. K10, and spend the
in-between time on hardening, security, and commercial launch prep. What actually got built
after K4 this session (WhatsApp/notifications infrastructure, e-Courts integration) was driven
by explicit user request for specific capabilities, not a resumption of blindly working down
the K5–K12 list — which is exactly the discipline this roadmap argues for.

---

## Killer Feature status (K1–K12, plus two unplanned additions)

| ID | Feature | Status | Notes |
| --- | --- | --- | --- |
| K1 | AI Court Morning Brief | 🟡 **PASS as of 2026-08-22, provisional since** | Live-verified pre-decomposition; underlying code rewritten 2026-08-26, not re-tested — see "K1–K4 status after the microservices decomposition" below |
| K2 | Cause List & Hearing Intelligence | 🟡 **PASS as of 2026-08-22, provisional since** | Deterministic matching/diffing, no AI in the pipeline itself; entire pipeline moved to a new service + new ingestion SQL function 2026-08-26, neither run against real data yet — see below |
| K3 | AI Matter Intelligence & Case Timeline | 🟡 **PASS as of 2026-08-22, provisional since** | Timeline computed on read, not stored; aggregator rewritten 2026-08-26 — see below |
| K4 | Ask My Case / AI Case-File Intelligence | 🟡 **PASS as of 2026-08-22, provisional since** | Live-verified this session (`ai_messages.sources` migration applied; the "PARTIAL" caveat in `phase-1-freeze.md` is now resolved — that doc should be updated); storage layer moved to a new service 2026-08-26, not re-tested — see below |
| — | **In-app notifications + WhatsApp digest** *(not in original roadmap)* | 🟡 **Built, not live for real users** | General-purpose `notifications` table + bell UI shipped and deployed. WhatsApp send path built (Gupshup-targeted) but the cron job is **unscheduled** pending real provider credentials and a decision on the `whatsapp_enabled` default. This is real infrastructure **K7 will build directly on** — not a distraction from it |
| — | **e-Courts integration Phase 1** *(not in original roadmap)* | ✅ **Built and live-verified** | CNR verify + auto-fill on matter creation, working end-to-end against a real eCourtsIndia.com account and a real CNR. Phase 2 (scheduled auto-refresh) and Phase 3 (auto-import orders as documents) are designed but not built — deliberately deferred pending Vakeel360 comparison |
| K5 | Deadline & Limitation Intelligence | ⏳ Pending | Rank #1 in the roadmap's pre-pilot priority list. Deterministic rules should drive dates; AI assists with extraction only |
| K6 | Client Intelligence / Client Portal | ⏳ Pending | No client-facing login exists at all today (`phase-1-product-baseline.md` §"User roles" — confirmed still true) |
| K7 | WhatsApp Intelligence | ⏳ Pending, **partially unblocked** | The notification system and WhatsApp send infrastructure this session built are exactly K7's prerequisites. What's missing is the *content* layer: AI-drafted client updates + an advocate-approval step before sending — the roadmap's stated safety rule ("AI drafts → advocate approves → message sent") is not yet built |
| K8 | Chamber / Junior / Clerk Command Center | ⏳ Pending | Requires new roles — only `owner/admin/member` exist today, confirmed in `phase-1-product-baseline.md`. No `junior`/`clerk`/`client` role or RLS policy exists anywhere |
| K9 | Case Health / Matter Health Score | ⏳ Pending | Natural layer over K3 (timeline) + K5 (deadlines) once K5 exists |
| K10 | AI Hearing Preparation | ⏳ Pending | Rank #2 in the roadmap's priority list. Should reuse `getMatterContext` (the frozen K3/K4 aggregation point), not re-query independently |
| K11 | Party / Case Monitoring | ⏳ Pending | Roadmap itself flags overlap with K2 — now *also* overlaps with the e-Courts Phase 2 design (scheduled polling + change detection). Define what K11 adds beyond both before building it |
| K12 | Practice Intelligence | ⏳ Pending | Later-stage; roadmap ranks it last |

**Priority ranking from the roadmap (pre-pilot, not a commitment)**: K5 → K10 → K7 → K8 → K6 →
K9 → K11 → K12. Worth noting K7 now has a head start no longer reflected in that ranking's
reasoning — the send-infrastructure cost that made K7 a bigger lift is already paid down.

---

## K1–K4 status after the microservices decomposition (2026-08-26)

Every Killer Feature above depends on code that moved or was rewritten during the
microservices pass. None of it has been live pen-tested — build/lint-clean is not the same bar
this doc's other "✅ Live-verified" claims were held to.

| Feature | What changed underneath it | Live-tested since the change? |
| --- | --- | --- |
| **K1** AI Court Morning Brief | `getMorningBrief` rewritten (Phase 7) to skip Matters/Documents/Billing queries per-tenant instead of joining unconditionally | ❌ No |
| **K2** Cause List & Hearing Intelligence | Entire ingestion/matching pipeline moved to `services/diary/` (Phase 3); the multi-table write was also rewritten into a brand-new `ingest_cause_list_row()` Postgres function that has never executed against a real cause-list paste | ❌ No — this is the biggest single risk on this list: a new SQL function, first real invocation still pending |
| **K3** AI Matter Intelligence & Case Timeline | `getMatterContext` rewritten (Phase 7) for the same per-module gating as K1; Matters itself moved to `services/matters/` (Phase 2) | ❌ No |
| **K4** Ask My Case | Conversation/message storage moved to `services/assistant/` (Phase 6); `AskMyCase.tsx` now calls that service instead of a local server function | ❌ No |

Beyond the four features directly: the practice-management CRUD all four sit on top of
(Matters, Diary, Documents, Billing, Drafting, AI Assistant) now runs as 7 separately deployed
Workers, each with its **own independently reimplemented** auth-trust and RLS-reliant query
code (`services/*/src/auth.ts` twins) — not shared code, copies. Only **Clients** (the Phase 1
pilot) was actually live-tested post-extraction: real throwaway tenant, cross-tenant isolation
sweep, module-gate 403↔200, zero-leftover-rows cleanup. The other six services' auth twins are
structurally identical to the tested one but have **never themselves been exercised against a
real signed-in session** — Category C's "Tenant A → Tenant B isolation: ✅ Live-verified across
8+ tables" below was true of the old architecture and is not yet re-confirmed for the new one.

**Practical read**: this isn't evidence anything is broken — the extractions were done
carefully, matching each function's original logic and column set exactly, and every phase
builds and lints clean. But "PASS" in this doc has always meant *live-verified*, and none of
this is, yet. Treat K1–K4 as provisional until the validation pass described in
`docs/microservices-decomposition-status.md` ("Next: the deferred validation pass") actually
runs — at minimum, exercising K1–K4 for real (a real Morning Brief, a real cause-list import,
a real matter timeline, a real Ask My Case conversation) belongs inside that pass, not just the
isolation/module-gate battery already planned for the extracted services.

---

## Category B — Product Completion Features

Validate before broad rollout, not necessarily before a pilot:

| Area | Status |
| --- | --- |
| Auth, onboarding, profile, settings | ✅ Implemented (Gate 1 baseline) |
| Notifications | ✅ **Now real** — was "decorative only" per the old baseline doc, no longer true |
| Search, global navigation | ✅ Implemented |
| Mobile responsiveness | ✅ Spot-checked this session (marketing pages), not exhaustively across the whole app |
| Matters: create/edit/archive/search/filter/history | 🟡 Create/edit/list exist; no dedicated archive action beyond the `status` enum; no per-field change history |
| Hearings: create/edit/reschedule/notes/status/calendar | ✅ Implemented, clash detection included |
| Documents: upload/preview/download/delete/permissions/validation | 🟡 Upload/analyze/approve exist; no explicit delete/archive action found; file-size/type validation not confirmed this session |
| Clients: create/edit/matter association/permissions | ✅ Implemented — advocate-side CRM only, **not** a client login (see K6) |
| Billing: invoice/payment/outstanding/history | ✅ Implemented, Razorpay link |
| Superadmin: tenant/user/feature governance/monitoring/audit | ✅ Implemented |

---

## Category C — Security / Trust Layer

**This is much further along than the roadmap assumes** — it was written without visibility
into this session's `docs/security-test-plan.md`, a real 4-pass live test program (not a
paper exercise) that already covers most of what's listed here:

| Roadmap item | Actual status |
| --- | --- |
| Tenant A → Tenant B isolation | ✅ Live-verified across 8+ tables, all CRUD operations |
| Advocate → unauthorized matter | ✅ Covered by the same tenant-isolation sweep |
| Junior/Clerk → restricted matter | N/A — those roles don't exist (see K8) |
| Client → internal data | N/A — no client role/portal exists (see K6) |
| Normal user → Superadmin API | ✅ Live-verified, 5 distinct tests |
| K4 → another matter / another tenant | ✅ Live-verified with real secret-marker test data across two tenants |
| Document → unauthorized download | ✅ N/A by architecture — no file storage exists (confirmed, not assumed) |
| Disabled AI → direct API bypass | ✅ Live-verified for K2/K3/K4 |
| RLS verification | ✅ Exhaustive, Pass 1 |
| RBAC + IDOR/BOLA | ✅ Exhaustive, Pass 1 |
| AI security (prompt injection, cross-tenant leakage) | ✅ Covered, Pass 3 |
| Dependency/SCA scan | ✅ `bun audit` run, all findings dev-only |
| Secret scanning | ✅ Full git-history audit (185 commits), clean |
| Vulnerability register / remediation evidence | 🟡 Exists as narrative in `security-test-plan.md`, not a formal tracked register |
| Formal OWASP ASVS 5.0 scored assessment | ❌ Not done — substantively covered, not formally scored |
| OWASP WSTG test plan / OWASP ZAP DAST | ❌ Not done — no automated scanner run |
| Manual third-party penetration test | ❌ Not done — this session's testing was thorough but self-administered, not independent |
| Re-testing / security release sign-off | 🟡 Sign-off criteria exist in `security-test-plan.md`; formal external sign-off not obtained |

**Net assessment**: the *substance* behind nearly every named release-blocker is done and
passed. What's genuinely missing is the *formal certification* layer (a scored ASVS
assessment, an automated DAST run, an independent pentest) — worth doing before an enterprise
sale or a compliance-sensitive customer asks for it, but not blocking an early pilot with
individual advocates.

---

## Category D — Commercial Launch Layer

| Item | Status |
| --- | --- |
| 1. Homepage | ✅ Done this session — repositioned around the built AI capabilities, not a generic feature list |
| 2. Features page | ✅ Done this session — clear K1–K4 story (assistant, drafting, cause-list intelligence, diary insights), plus the practice-management basics |
| 3. Pricing | ✅ Exists (`/pricing` — Solo Basic/Solo Pro/Chamber, 15-day trial). Roadmap suggested a 4-tier structure (adding Enterprise); worth revisiting once real pilot pricing feedback exists, not before |
| 4. Demo environment | ❓ **Needs verification** — home page copy promises "sample matters, no setup required" linking to `/app`; whether this is a real seeded demo tenant or just points at normal signup was not confirmed this session |
| 5. Demo document (PDF) | ❌ Not started |
| 6. Demo script | ❌ Not started |
| 7. Business use cases (10 workflows) | 🟡 Individually exercised during Gate 1 QA; not compiled as a standalone sales artifact |
| 8. QA validation | ✅ Done — `docs/gate-1-qa-validation-plan.md` |
| 9. Security verification | 🟡 Substance done, formal certification pending — see Category C above |
| 10. Marketing (LinkedIn/YouTube/Instagram/Facebook/WhatsApp Business/SEO/Ads) | ❌ Not started — explicitly the user's own next focus, outside this session's scope |

---

## Corrections to existing docs (found while writing this one)

- `docs/phase-1-freeze.md`'s K4 row says "PARTIAL: live verification pending" — this is
  resolved; the migration is applied and K4 passed live verification. Update to PASS.
- `docs/phase-1-freeze.md` §10 (AI service architecture) and its governance-key list don't
  mention `ecourts_enabled` or the new `ecourts-lookup` function — both follow the exact
  frozen patterns described there (JSONB governance key, user-JWT edge function), so no
  architectural correction is needed, just an inventory update.
- `docs/phase-1-product-baseline.md`'s notifications section states the bell icon is
  "decorative only... nothing behind it yet" — **no longer true**. A real `notifications`
  table, unread count, and mark-as-read flow exist and are live.
- `docs/phase-1-product-baseline.md`'s `matters` column list doesn't include `cnr` (added this
  session for e-Courts Phase 1).
- Both docs' AI-governance key lists are missing `ecourts_enabled`.

---

## Recommendation (unchanged from the original review)

Don't resume K5–K12 on roadmap-assumed priority. The sequence that gives the strongest signal:

```
Harden K1–K4 + what's already built (WhatsApp digest, e-Courts Phase 1)
  → Verify the demo-environment claim / build one if it doesn't exist
  → Pilot with real advocates
  → Let their actual complaint pick K5 vs. K7 vs. K8 vs. K10
```

The one already-in-motion exception: e-Courts Phase 2/3 and the WhatsApp digest's real-vendor
activation are natural finishing touches on work already started, not new roadmap items — it's
reasonable to complete those (once Gupshup/Vakeel360 credentials land) before the pilot,
since abandoning them half-built serves no one.
