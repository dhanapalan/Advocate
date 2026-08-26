import { handleOptions, errorResponse } from "./cors";
import { authedClient, requireUserId } from "./auth";
import { requireDiaryModule } from "./require-module";
import { listHearings, createHearing, updateHearingStatus } from "./hearings";
import {
  getCauseListFeatureEnabled,
  listCauseListSources,
  createCauseListSource,
  setCauseListSourceEnabled,
  ingestCauseList,
  listCauseListEntries,
  matchMatterManually,
  rejectCauseListMatch,
  listCauseListChangeHistory,
} from "./cause-list";

// LexDiary Diary & Cause-list service — Phase 3 of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Bundled as one
// service (and one sellable module, "diary") because reconcileHearing
// writes directly into hearings from the cause-list ingestion path — too
// tightly coupled to split, per the plan. Same no-service-role-key,
// browser-calls-directly pattern as services/clients/ and services/matters/.
//
// See hearings.ts and cause-list.ts for what was and wasn't ported —
// listMatterHearings and listMatterCauseListHistory were both dead code,
// confirmed by grep before this extraction.

export default {
  async fetch(req: Request): Promise<Response> {
    const preflight = handleOptions(req);
    if (preflight) return preflight;

    const auth = authedClient(req);
    if (!auth) return errorResponse(req, "Unauthorized", 401);
    const userId = await requireUserId(auth.supabase, auth.token);
    if (!userId) return errorResponse(req, "Unauthorized", 401);

    const url = new URL(req.url);
    const path = url.pathname;
    const { supabase } = auth;

    // getCauseListFeatureEnabled is a client-side governance hint (lets the
    // UI hide the import panel), not itself gated on the "diary" purchase —
    // same as the original cause-list.functions.ts, which never called
    // requireModule() for it either.
    if (req.method === "GET" && path === "/api/v1/cause-list/feature-enabled") {
      return getCauseListFeatureEnabled(req, supabase, userId);
    }

    try {
      await requireDiaryModule(supabase, userId);
    } catch (cause) {
      return errorResponse(
        req,
        cause instanceof Error ? cause.message : "Module check failed.",
        403,
      );
    }

    if (req.method === "GET" && path === "/api/v1/hearings") {
      return listHearings(req, supabase);
    }
    if (req.method === "POST" && path === "/api/v1/hearings") {
      return createHearing(req, supabase, userId);
    }
    const hearingStatusMatch = path.match(/^\/api\/v1\/hearings\/([0-9a-fA-F-]+)\/status$/);
    if (req.method === "PATCH" && hearingStatusMatch) {
      return updateHearingStatus(req, supabase, hearingStatusMatch[1]!);
    }

    if (req.method === "GET" && path === "/api/v1/cause-list/sources") {
      return listCauseListSources(req, supabase);
    }
    if (req.method === "POST" && path === "/api/v1/cause-list/sources") {
      return createCauseListSource(req, supabase, userId);
    }
    const sourceEnabledMatch = path.match(/^\/api\/v1\/cause-list\/sources\/([0-9a-fA-F-]+)$/);
    if (req.method === "PATCH" && sourceEnabledMatch) {
      return setCauseListSourceEnabled(req, supabase, sourceEnabledMatch[1]!);
    }

    if (req.method === "POST" && path === "/api/v1/cause-list/ingest") {
      return ingestCauseList(req, supabase, userId);
    }

    if (req.method === "GET" && path === "/api/v1/cause-list/entries") {
      const date = url.searchParams.get("date") ?? "";
      return listCauseListEntries(req, supabase, date);
    }

    const matchIdMatch = path.match(/^\/api\/v1\/cause-list\/matches\/([0-9a-fA-F-]+)\/match$/);
    if (req.method === "POST" && matchIdMatch) {
      return matchMatterManually(req, supabase, userId, matchIdMatch[1]!);
    }
    const rejectIdMatch = path.match(/^\/api\/v1\/cause-list\/matches\/([0-9a-fA-F-]+)\/reject$/);
    if (req.method === "POST" && rejectIdMatch) {
      return rejectCauseListMatch(req, supabase, userId, rejectIdMatch[1]!);
    }

    if (req.method === "GET" && path === "/api/v1/cause-list/history") {
      const sourceId = url.searchParams.get("sourceId") ?? "";
      const sourceReference = url.searchParams.get("sourceReference") ?? "";
      return listCauseListChangeHistory(req, supabase, sourceId, sourceReference);
    }

    return errorResponse(req, "Not found", 404);
  },
};
