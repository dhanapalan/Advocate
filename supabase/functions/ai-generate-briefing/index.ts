import { handleOptions, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authedClient, requireUserId } from "../_shared/auth.ts";
import { chatComplete, enforceUsageQuota, LEGAL_SYSTEM_PROMPT } from "../_shared/ai.ts";
import { requireModule } from "../_shared/modules.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const auth = authedClient(req);
  if (!auth) return errorResponse(req, "Unauthorized", 401);
  const userId = await requireUserId(auth.supabase);
  if (!userId) return errorResponse(req, "Unauthorized", 401);

  try {
    await requireModule(auth.supabase, userId, "matter_intelligence");
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Module check failed.", 403);
  }

  try {
    await enforceUsageQuota(auth.supabase);
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Quota check failed.", 429);
  }

  let body: { context: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.context || body.context.length < 10) {
    return errorResponse(req, "context (min 10 chars) is required");
  }

  try {
    const briefing = await chatComplete([
      { role: "system", content: LEGAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Prepare a chamber briefing for the advocate from the workload below. Use these markdown sections:\n\n## Hearing readiness\n## Limitation & deadline risk\n## Conflict and workload watch\n## Priority actions today\n\nBe specific, reference the matter codes given, and never invent matters or dates that are not listed.\n\n${body.context}`,
      },
    ]);
    return jsonResponse(req, { briefing });
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "AI request failed.", 502);
  }
});
