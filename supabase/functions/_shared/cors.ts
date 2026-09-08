// The Capacitor shell loads the deployed Worker over https, so its WebView
// origin is the same as the web app's — there's no separate capacitor://
// origin to allow here. localhost entries cover `vite dev`.
const ALLOWED_ORIGINS = new Set([
  // The custom domain is what the mobile app and users actually load. The
  // workers.dev address stays allowed so a direct visit there still works.
  "https://lexdiary.online",
  "https://lexdiary.dhanapalan-advocate.workers.dev",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
 * S19); the Edge Functions were never converted, and the extracted Workers
 * have a twin of this helper in services/*\/src/cors.ts.
 *
 * Logs the real error for operators and returns the caller's own hand-written
 * fallback sentence instead.
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
  // 42501 is also how this codebase's own guard triggers signal refusal
  // (enforce_tenant_writable, enforce_module_entitlement, the seat/limit
  // checks). Those RAISE hand-written, user-facing sentences on purpose, so
  // they pass through verbatim.
  if (cause?.code === "42501" && message) {
    return errorResponse(req, message, 403);
  }
  return errorResponse(req, fallback, 500);
}
