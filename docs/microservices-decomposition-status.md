# Microservices Decomposition — Phase Status

**Status as of 2026-08-26.** Tracks progress against the architecture plan for moving LexDiary
from a single-Worker app with per-tenant entitlement gates to real, independently deployed
Cloudflare Worker services sold as separate modules. The full architecture (target service
list, transport design, capability-token model, rationale for every decision) lives in the
approved plan file — not committed to this repo, so summarized here for anyone without access
to it: `C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md`.

**Validation is deliberately deferred to a single pass after every planned phase below is
built**, per explicit instruction this session — phases 0–3 are build/lint-clean and deployed,
but not yet live pen-tested the way Phase 1 originally was. Do not treat "done" below as
"verified live" until that final validation pass runs.

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
| 4 | Documents (incl. OCR) → `services/documents/` | ⏳ **Pending** | Owns `ai_documents`, OCR intake (`ocr-extract` edge function), AI document review (`ai-analyze-document` edge function) — first phase touching a Deno edge function's AI-calling path, not just CRUD |
| 5 | Billing → `services/billing/` | ⏳ **Pending** | Owns `time_entries`, `invoices` |
| 6 | Drafting (incl. Dictation), AI Assistant, Matter Intelligence | ⏳ **Pending** | Different shape from phases 1–3: these own AI-calling edge functions (`ai-generate-draft`, `dictation-transcribe`, `dictation-format`, `ai-assistant`, `ai-ask-case`, `ai-morning-brief`, `ai-matter-summary`, `ai-generate-briefing`) and the `AI_GATEWAY_API_KEY` secret, not just Postgres CRUD — needs its own scoping pass before starting |
| 7 | Aggregator cleanup — extend `getMorningBrief`/`getMatterContext` feature-detection to every new module key, so a tenant missing Billing/Documents/Diary gets that section omitted rather than an error | ⏳ **Pending** | Deliberately deferred per the plan — phases 0–3 only did *primary-module* gating on these two aggregators, not full per-section feature-detection. Needs live-testing across each module's on/off state independently, not the full combinatorial matrix |

---

## What's already live (Cloudflare Workers)

| Worker | URL | Owns |
| --- | --- | --- |
| `lexdiary` (main app) | `https://lexdiary.dhanapalan-advocate.workers.dev` | Everything not yet extracted, plus the admin console, auth, licensing |
| `lexdiary-clients` | `https://lexdiary-clients.dhanapalan-advocate.workers.dev` | `clients` table |
| `lexdiary-matters` | `https://lexdiary-matters.dhanapalan-advocate.workers.dev` | `matters` table |
| `lexdiary-diary` | `https://lexdiary-diary.dhanapalan-advocate.workers.dev` | `hearings`, `cause_list_sources/records/matches/changes` |

Each extracted service: no `SUPABASE_SERVICE_ROLE_KEY` (ever), its own independent
`FIELD_ENCRYPTION_KEY` secret (verified zero pre-existing ciphertext before each extraction, so
no compatibility reason to share the main app's key), called directly from the browser with the
user's own Supabase access token — the same trust model the app already used for Edge Functions
— rather than through a Cloudflare service binding, since the main app's request handler is
deliberately platform-agnostic today (`src/lib/server-handler.ts`) and adding Workers-specific
env/binding plumbing wasn't judged worth it for this pass.

---

## Before starting Phase 4

Phase 4 is the first phase that isn't pure CRUD extraction — it touches a Deno edge function's
AI-calling logic (`ocr-extract`, `ai-analyze-document`), which today runs on Supabase Edge
Functions, not Cloudflare Workers, and shares secrets (`AI_GATEWAY_API_KEY`,
`FIELD_ENCRYPTION_KEY`) with the rest of the AI pipeline. Worth a short scoping pass before
starting: does "extracting Documents" mean moving the Postgres CRUD only (`ai_documents` table,
mirroring phases 1–3) while leaving the AI-calling edge functions where they are, or does it
mean also relocating the edge functions themselves onto the new service? The plan's Phase 4
line item doesn't disambiguate this explicitly.
