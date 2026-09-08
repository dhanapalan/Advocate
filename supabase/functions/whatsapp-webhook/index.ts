import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleOptions, jsonResponse, errorResponse, dbError } from "../_shared/cors.ts";
import { secretMatches } from "../_shared/timing-safe.ts";

// Receives delivery-status callbacks from the WhatsApp provider (Gupshup) and
// updates the matching whatsapp_messages row. A synchronous send only ever
// confirms *acceptance* (see whatsapp-diary-digest) — this is how a message
// actually becomes 'delivered'/'read', or turns out to have 'failed' after
// the fact.
//
// verify_jwt = false, same as whatsapp-diary-digest — the caller is Gupshup's
// servers, not a LexDiary user, so there is no JWT to check. This endpoint
// therefore authenticates with a shared secret, exactly as whatsapp-diary-digest
// does, and FAILS CLOSED if that secret isn't configured: an unauthenticated
// endpoint holding a service-role client is not something to leave open on the
// strength of a TODO comment.
//
// Gupshup's dashboard lets a callback URL carry a query string but not always a
// custom header, so both are accepted. When their per-app HMAC scheme is
// finalized for this account, add the signature check alongside this one rather
// than in place of it — a shared secret in a URL is weaker than a signature
// (it can leak via provider-side logs), so it is the floor, not the ceiling.

const GUPSHUP_STATUS_MAP: Record<string, "sent" | "delivered" | "failed" | "read"> = {
  submitted: "sent",
  enqueued: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, "Method not allowed", 405);

  // Fail closed: with no secret configured there is no way to tell Gupshup
  // apart from anyone else who found the URL, and this handler goes on to use
  // a service-role client.
  const secret = Deno.env.get("WHATSAPP_WEBHOOK_SECRET");
  if (!secret) return errorResponse(req, "Webhook is not configured", 503);

  const provided =
    req.headers.get("x-webhook-secret") ?? new URL(req.url).searchParams.get("token");
  if (!secretMatches(provided, secret)) return errorResponse(req, "Unauthorized", 401);

  let payload: {
    messageId?: string;
    type?: string;
    status?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }

  const providerMessageId = payload.messageId;
  const rawStatus = payload.status ?? payload.type;
  if (!providerMessageId || !rawStatus) {
    return errorResponse(req, "messageId and status are required");
  }

  const mappedStatus = GUPSHUP_STATUS_MAP[rawStatus];
  if (!mappedStatus) {
    // Unrecognized event type (e.g. a provider-side event with no bearing on
    // delivery status) — acknowledge without erroring so the provider
    // doesn't retry indefinitely.
    return jsonResponse(req, { ok: true, ignored: rawStatus });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false },
    },
  );

  const update: Record<string, unknown> = { status: mappedStatus };
  if (mappedStatus === "delivered") update.delivered_at = new Date().toISOString();

  const { error } = await admin
    .from("whatsapp_messages")
    .update(update)
    .eq("provider_message_id", providerMessageId);

  if (error) return dbError(req, error, "Could not update the delivery status.");
  return jsonResponse(req, { ok: true });
});
