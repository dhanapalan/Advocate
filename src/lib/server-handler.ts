// The app's request handling, kept separate from the Cloudflare Workers entry
// that wraps it (src/server.ts). Deliberately Web-standard Request -> Response
// with no env/ctx params: configured values are read from process.env (via
// wrangler.toml's [vars], which nodejs_compat exposes), so nothing
// platform-specific is threaded through here and this stays portable.
import { consumeLastCapturedError } from "./error-capture";
import { renderErrorPage } from "./error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return catastrophicResponse(request);
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function isServerFnRequest(request: Request): boolean {
  return new URL(request.url).pathname.startsWith("/_serverFn/");
}

// A page navigation that hits this gets the decorative HTML error page. A
// server function call (TanStack's client reads the response body straight
// into its thrown Error's .message) must never get that page — every screen
// that calls a server function displays cause.message directly, so an HTML
// document ends up dumped verbatim into the UI as if it were an error
// string. Server function callers get a short, plain-text message instead.
function catastrophicResponse(request: Request): Response {
  // X-Error-Kind is a deliberately permanent diagnostic: it names which of
  // the two branches below served this specific error, straight from the
  // deployed code — the fastest way to confirm what's actually live without
  // needing platform log access, on any host.
  if (isServerFnRequest(request)) {
    return new Response("Something went wrong loading that data. Please try again.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "x-error-kind": "server-fn" },
    });
  }
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8", "x-error-kind": "page" },
  });
}

// Baseline hardening headers on every response. CSP is scoped to what this
// app actually calls: Supabase (auth/db/functions) and the OpenAI-compatible
// AI gateway for OCR/dictation/assistant requests made from the browser via
// supabase.functions.invoke.
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    // supabase-js's Realtime client keeps its heartbeat accurate in
    // backgrounded tabs via a same-origin blob: Worker — without worker-src,
    // that falls back to script-src, which doesn't permit blob: and the
    // worker gets silently blocked.
    "worker-src 'self' blob:",
    // wss:// alongside https:// for the same host: Realtime's socket
    // connection needs the WebSocket scheme explicitly: connect-src doesn't
    // treat https:// as also covering wss:// on the same origin.
    // lexdiary-clients.* / lexdiary-matters.* / lexdiary-diary.* /
    // lexdiary-documents.* / lexdiary-billing.* / lexdiary-drafting.* /
    // lexdiary-assistant.* are the microservices (services/clients/,
    // services/matters/, services/diary/, services/documents/,
    // services/billing/, services/drafting/, services/assistant/) —
    // called directly from the browser, see src/lib/clients-service.ts,
    // src/lib/matters-service.ts, src/lib/diary-service.ts,
    // src/lib/documents-service.ts, src/lib/billing-service.ts,
    // src/lib/drafting-service.ts and src/lib/assistant-service.ts.
    "connect-src 'self' https://cjcjfdwdlsdgyvshuncn.supabase.co wss://cjcjfdwdlsdgyvshuncn.supabase.co https://api.openai.com https://lexdiary-clients.dhanapalan-advocate.workers.dev https://lexdiary-matters.dhanapalan-advocate.workers.dev https://lexdiary-diary.dhanapalan-advocate.workers.dev https://lexdiary-documents.dhanapalan-advocate.workers.dev https://lexdiary-billing.dhanapalan-advocate.workers.dev https://lexdiary-drafting.dhanapalan-advocate.workers.dev https://lexdiary-assistant.dhanapalan-advocate.workers.dev",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

function withSecurityHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(key)) response.headers.set(key, value);
  }
  return response;
}

export async function handleRequest(request: Request): Promise<Response> {
  try {
    const handler = await getServerEntry();
    const response = await handler.fetch(request, undefined, undefined);
    return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response, request));
  } catch (error) {
    console.error(error);
    return withSecurityHeaders(catastrophicResponse(request));
  }
}
