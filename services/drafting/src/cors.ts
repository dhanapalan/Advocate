// Twin of supabase/functions/_shared/cors.ts and src/lib/server-handler.ts's
// security-header pattern — same allowed origins as the main app, since this
// service is called directly from the same browser/Capacitor clients.
const ALLOWED_ORIGINS = new Set([
  "https://lexdiary.online",
  "https://lexdiary.dhanapalan-advocate.workers.dev",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    Vary: "Origin",
  };

  // A disallowed origin gets no Access-Control-Allow-Origin header at all.
  // This used to send the literal string "null", which is not a rejection:
  // `null` is a real origin value that sandboxed iframes and data:/file:
  // documents send, so ACAO: null actively *grants* access to those contexts.
  // Omitting the header is the only correct "no".
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
  return null;
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

export function errorResponse(req: Request, message: string, status = 400): Response {
  return jsonResponse(req, { error: message }, status);
}

/**
 * Response for a failed Supabase/Postgres call.
 *
 * Never hand a raw PostgrestError message to the browser: those name internal
 * tables and policies ("permission denied for table ai_documents", "new row
 * violates row-level security policy for table \"clients\""), which is
 * information disclosure with nothing actionable in it for the user. The main
 * app fixed exactly this in PR #74 (friendlyErrorMessage, Security Test Plan
 * S19); the extracted services must not reintroduce it.
 *
 * Mirrors friendlyErrorMessage()'s mapping for the two shapes that matter
 * server-side, logs the real error for operators, and otherwise returns the
 * caller's own hand-written fallback sentence.
 */
export function dbError(
  req: Request,
  cause: { message?: string; code?: string } | null,
  fallback: string,
): Response {
  const message = cause?.message ?? "";
  console.error(`[db] ${cause?.code ?? "unknown"}: ${message}`);

  if (
    message.includes("row-level security policy") ||
    message.startsWith("permission denied for")
  ) {
    return errorResponse(req, "You don't have permission to do that.", 403);
  }
  if (message.includes("numeric field overflow")) {
    return errorResponse(req, "That number is too large — please enter a smaller value.", 400);
  }
  // 42501 is also how this codebase's own guard triggers signal refusal
  // (enforce_tenant_writable, enforce_module_entitlement, the seat/limit
  // checks). Those RAISE hand-written, user-facing sentences on purpose, so
  // they pass through verbatim.
  if (cause?.code === "42501" && message) {
    return errorResponse(req, message, 403);
  }
  return errorResponse(req, fallback, 400);
}
