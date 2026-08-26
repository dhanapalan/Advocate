# Microservices Decomposition — Phase Status

**Status as of 2026-08-26.** Tracks progress against the architecture plan for moving LexDiary
from a single-Worker app with per-tenant entitlement gates to real, independently deployed
Cloudflare Worker services sold as separate modules. The full architecture (target service
list, transport design, capability-token model, rationale for every decision) lives in the
approved plan file — not committed to this repo, so summarized here for anyone without access
to it: `C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md`.

**Validation is deliberately deferred to a single pass after every planned phase below is
built**, per explicit instruction this session — phases 0–7, the complete planned scope, are now
build/lint-clean and deployed, but not yet live pen-tested the way Phase 1 originally was. Do not
treat "done" below as "verified live" until that final validation pass runs.

---

## Why this exists

The business wants every feature area sellable independently — including Matters/case-tracking
itself — rather than deepening the single-app entitlement-gate pattern already built (Phase 0).
The explicit decision was **real microservices**: separate deployed Cloudflare Workers calling
Supabase directly under the end user's own JWT (RLS still does tenant isolation), not feature
flags inside one Worker. Two structural calls made early and not up for re-litigation:

- **Dictation absorbed into Drafting** as one sellable module (`ai_drafting`).
- **OCR absorbed into Documents** as one sellable module (`documents`).

---

## Phase status

| Phase | Scope | Status | Notes |
| --- | --- | --- | --- |
| 0 | Entitlement foundation — `requireModule()` wired into every feature-area server function, `licenses.integrations` extended with 5 new module keys | ✅ **Done, deployed** | Fixed a real bug found along the way: `saveDictatedDraft` had zero entitlement check |
| 1 | Clients extracted → `services/clients/` (`lexdiary-clients`) | ✅ **Done, deployed, live-tested** | Only phase with full live pen-test this pass (throwaway-tenant CRUD, module-gate 403↔200, cross-tenant isolation, zero-leftover-rows cleanup) — the pattern was proven here before repeating it |
| — | Atomic cause-list ingestion bug fix | ✅ **Done, deployed** | `ingestCauseList` did up to 5 unwrapped sequential writes per row with no transaction; now one `SECURITY INVOKER` Postgres function (`ingest_cause_list_row`). Fixed ahead of Phase 3 per the plan's explicit instruction, independent of the extraction itself |
| 2 | Matters extracted → `services/matters/` (`lexdiary-matters`) | ✅ **Done, deployed** | Widest blast radius so far — 9 call sites across 8 files (Cases, Document Intelligence, and every matter-picker dropdown app-wide). `getMatter` not ported (dead code, confirmed by grep) |
| 3 | Diary & Cause-list extracted → `services/diary/` (`lexdiary-diary`) | ✅ **Done, deployed** | Bundled as one service/module (`diary`) — `reconcileHearing` couples the two too tightly to split, per the plan. `listMatterHearings` and `listMatterCauseListHistory` not ported (both dead code) |
| 4 | Documents (incl. OCR) extracted → `services/documents/` (`lexdiary-documents`) | ✅ **Done, deployed** | Scoping question from the previous entry resolved: extracted the `ai_documents` reviewed-document CRUD only (`listDocumentAnalyses`/`updateDocumentAnalysisStatus`), same shape as phases 1–3. `ocr-extract`/`ai-analyze-document` stay on Supabase Edge Functions with their own `AI_GATEWAY_API_KEY` — moving AI-Gateway-calling logic into a Cloudflare Worker had no isolation benefit and would've meant re-implementing it in a different runtime. No `FIELD_ENCRYPTION_KEY` needed — neither extracted function touches `ai_documents.raw_text` (the one encrypted column), which stays a main-app-only read via `getMatterContext` |
| 5 | Billing extracted → `services/billing/` (`lexdiary-billing`) | ✅ **Done, deployed** | Owns `time_entries`, `invoices` — no `FIELD_ENCRYPTION_KEY` needed, neither table has an encrypted free-text column |
| 6 | Drafting (incl. Dictation) extracted → `services/drafting/` (`lexdiary-drafting`); AI Assistant extracted → `services/assistant/` (`lexdiary-assistant`) | ✅ **Done, deployed** | Scoping question resolved the same way as Phase 4: CRUD only moved (`ai_drafts` for Drafting; `ai_conversations`/`ai_messages` for Assistant). AI-calling edge functions (`ai-generate-draft`, `dictation-transcribe`, `dictation-format`, `ai-assistant`, `ai-ask-case`) stay on Supabase Edge Functions with their own `AI_GATEWAY_API_KEY` and their own `requireModule` gate from Phase 0. Drafting needed its own `FIELD_ENCRYPTION_KEY` (`ai_drafts.content` is encrypted); Assistant needed none. **Matter Intelligence has no CRUD table of its own** — it's purely `ai-morning-brief`/`ai-matter-summary`/`ai-generate-briefing` edge functions, already gated on `matter_intelligence` from Phase 0, so there is no separate service to extract for it |
| 7 | Aggregator cleanup — extend `getMorningBrief`/`getMatterContext` feature-detection to every module key they touch | ✅ **Done, deployed** | Added `getEnabledModules()` to `require-module.ts` — a non-throwing, batched sibling of `requireModule()` that returns `{[moduleKey]: boolean}` for a list of keys in one profile+license lookup, trial-bypass and `{module}_enabled` semantics unchanged. `getMorningBrief` now skips the Matters/Documents/Billing queries a tenant hasn't purchased (falling back to `{data: [], error: null}`, same pattern the file already used for its `matterIds.length ?` conditionals) instead of joining them unconditionally; primary Diary gate is unchanged, since no hearings means no brief regardless. `getMatterContext` does the same for Diary (hearings + cause-list matches) and Documents; primary Matters gate unchanged. Both aggregators' existing "empty array/null renders as omitted" UI behavior needed no changes — the queries were the only thing gating on purchase status, not the rendering |

---

## What's already live (Cloudflare Workers)

| Worker | URL | Owns |
| --- | --- | --- |
| `lexdiary` (main app) | `https://lexdiary.dhanapalan-advocate.workers.dev` | Everything not yet extracted, plus the admin console, auth, licensing |
| `lexdiary-clients` | `https://lexdiary-clients.dhanapalan-advocate.workers.dev` | `clients` table |
| `lexdiary-matters` | `https://lexdiary-matters.dhanapalan-advocate.workers.dev` | `matters` table |
| `lexdiary-diary` | `https://lexdiary-diary.dhanapalan-advocate.workers.dev` | `hearings`, `cause_list_sources/records/matches/changes` |
| `lexdiary-documents` | `https://lexdiary-documents.dhanapalan-advocate.workers.dev` | `ai_documents` (list/status CRUD only) |
| `lexdiary-billing` | `https://lexdiary-billing.dhanapalan-advocate.workers.dev` | `time_entries`, `invoices` |
| `lexdiary-drafting` | `https://lexdiary-drafting.dhanapalan-advocate.workers.dev` | `ai_drafts` (incl. dictated drafts) |
| `lexdiary-assistant` | `https://lexdiary-assistant.dhanapalan-advocate.workers.dev` | `ai_conversations`, `ai_messages` |

Each extracted service: no `SUPABASE_SERVICE_ROLE_KEY` (ever); its own independent
`FIELD_ENCRYPTION_KEY` secret where it actually touches an encrypted column (verified zero
pre-existing ciphertext before each extraction, so no compatibility reason to share the main
app's key) — Documents and Assistant have no such secret, since neither owns an encrypted
column; called directly from the browser with the user's own Supabase access token — the same
trust model the app already used for Edge Functions — rather than through a Cloudflare service
binding, since the main app's request handler is deliberately platform-agnostic today
(`src/lib/server-handler.ts`) and adding Workers-specific env/binding plumbing wasn't judged
worth it for this pass.

The "CRUD-only, edge functions stay put" split from Phase 4 turned out to generalize cleanly to
every AI-calling module: `ai-generate-draft`, `dictation-transcribe`, `dictation-format`,
`ai-assistant`, `ai-ask-case`, `ai-morning-brief`, `ai-matter-summary` and `ai-generate-briefing`
all stay on Supabase Edge Functions with `AI_GATEWAY_API_KEY`, unchanged across every phase —
none of the eight sellable modules needed the AI-calling logic itself to move.

---

## All planned phases are now built

Phases 0–7 are complete: every sellable module either has its own deployed Cloudflare Worker
(Clients, Matters, Diary & Cause-list, Documents, Billing, Drafting, AI Assistant) or — for
Matter Intelligence, which owns no table of its own — its existing Phase-0 edge-function gate
was confirmed sufficient. Both cross-feature aggregators now feature-detect every module they
touch instead of erroring on a missing one.

**Next: the deferred validation pass**, per the plan's verification section and this session's
explicit instruction to validate once at the end rather than after each phase. At minimum this
should repeat, for every extracted service, the battery Phase 1 (Clients) ran live: a real
throwaway tenant, CRUD through the service, the module-gate 403↔200 transition, the cross-tenant
isolation sweep (unfiltered list, cross-tenant UPDATE/DELETE), and cleanup with a
zero-leftover-rows check — plus, new for Phase 7, exercising `getMorningBrief`/`getMatterContext`
with each of Diary/Documents/Billing/Matters toggled off independently (not the full 2^n
combinatorial matrix, per the plan's own scoping guidance) to confirm sections omit cleanly
rather than error.
