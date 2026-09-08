import { errorResponse } from "./cors";

// Per-IP request throttle, using Cloudflare's native Rate Limiting binding
// (configured as [[ratelimits]] in this service's wrangler.toml — no KV,
// Durable Object or external dependency involved).
//
// Closes half of Pass 5's P5-3: before this, nothing anywhere in the stack
// limited request volume. The other half — login and password-reset
// brute-force — cannot be fixed from this repo at all, because the browser
// calls Supabase Auth directly and those requests never pass through any
// Worker we control; that needs Supabase Auth's own CAPTCHA/rate limits.
//
// Applied before authentication on purpose. A request with no valid bearer
// token is already cheap to reject (authedClient() returns null without a
// network call), but every request still costs a Worker invocation, and one
// that *does* carry a valid token costs a JWKS verification plus two Supabase
// round-trips for the module gate before any real work happens. The cheapest
// place to shed load is the front door.
//
// The limit (200/minute per IP, set in wrangler.toml) is deliberately
// generous — an anti-abuse floor, not a quota. A chamber behind one office NAT
// is several people sharing an IP, and a normal session is a few requests a
// minute, so this leaves real use untouched while still stopping a script.

export interface RateLimitEnv {
  // Optional: `wrangler dev` without the binding, and any environment where it
  // hasn't been provisioned, simply skip the check rather than fail.
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

/**
 * Returns a 429 Response when the caller has exceeded the limit, or null to
 * let the request proceed.
 *
 * Fails OPEN when the binding is absent or throws. That is deliberate: a rate
 * limiter is an availability control, and a missing binding must never take
 * the whole service down. Cloudflare's limiter is also best-effort and
 * per-colo, so treat it as a flood damper rather than exact accounting.
 */
export async function rateLimitResponse(
  req: Request,
  env: RateLimitEnv | undefined,
): Promise<Response | null> {
  const limiter = env?.RATE_LIMITER;
  if (!limiter) return null;

  // cf-connecting-ip is set by Cloudflare's edge and cannot be spoofed by the
  // client, unlike x-forwarded-for.
  const key = req.headers.get("cf-connecting-ip") ?? "unknown";

  let success = true;
  try {
    ({ success } = await limiter.limit({ key }));
  } catch {
    return null;
  }
  if (success) return null;

  const response = errorResponse(
    req,
    "Too many requests — please slow down and try again in a minute.",
    429,
  );
  response.headers.set("Retry-After", "60");
  return response;
}
