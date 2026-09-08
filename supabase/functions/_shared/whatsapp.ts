// Thin client for one WhatsApp Business Solution Provider (Gupshup), mirroring
// how _shared/ai.ts wraps its own provider: a single function, provider
// credentials read from Deno.env, a clear thrown error if unconfigured.
//
// NOT YET LIVE-USABLE without two things outside this codebase's control:
// 1. A real Gupshup account + API key (GUPSHUP_API_KEY, GUPSHUP_SOURCE_NUMBER).
// 2. A WhatsApp message TEMPLATE pre-approved by Meta (GUPSHUP_TEMPLATE_ID) —
//    a business-initiated WhatsApp conversation cannot use free-form text;
//    Meta requires the exact template shape to be submitted and approved in
//    advance, which is a multi-day process independent of this code. Until
//    that's done, calls here will fail with a real provider error — that's
//    expected, not a bug in this function.

export type WhatsAppSendResult = { providerMessageId: string };

/**
 * Sends one WhatsApp message via Gupshup's template-message API. Templates
 * are how WhatsApp Business API supports business-initiated messages —
 * `params` fills the template's placeholder slots in order (here: the
 * hearing count and today's date, in that order — matches the template
 * submitted for approval under GUPSHUP_TEMPLATE_ID).
 */
export async function sendWhatsAppDigest(params: {
  toPhoneE164: string;
  hearingCount: number;
  hearingDateIso: string;
}): Promise<WhatsAppSendResult> {
  const apiKey = Deno.env.get("GUPSHUP_API_KEY");
  const source = Deno.env.get("GUPSHUP_SOURCE_NUMBER");
  const appName = Deno.env.get("GUPSHUP_APP_NAME");
  const templateId = Deno.env.get("GUPSHUP_TEMPLATE_ID");
  if (!apiKey || !source || !appName || !templateId) {
    throw new Error("WhatsApp sending is not configured (missing Gupshup credentials).");
  }

  // Gupshup's number to. Strip the leading "+" — their API takes bare digits.
  const destination = params.toPhoneE164.replace(/^\+/, "");

  const body = new URLSearchParams({
    channel: "whatsapp",
    source,
    destination,
    "src.name": appName,
    template: JSON.stringify({
      id: templateId,
      params: [String(params.hearingCount), params.hearingDateIso],
    }),
  });

  const response = await fetch("https://api.gupshup.io/wa/api/v1/template/msg", {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" ? JSON.stringify(payload) : response.statusText;
    throw new Error(`Gupshup send failed (${response.status}): ${detail}`);
  }

  const providerMessageId = payload?.messageId;
  if (!providerMessageId || typeof providerMessageId !== "string") {
    throw new Error("Gupshup accepted the request but returned no messageId.");
  }
  return { providerMessageId };
}
