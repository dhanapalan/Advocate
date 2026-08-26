import { handleOptions, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authedClient, requireUserId } from "../_shared/auth.ts";
import { enforceUsageQuota, extractTextFromImage } from "../_shared/ai.ts";
import { requireModule } from "../_shared/modules.ts";

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const auth = authedClient(req);
  if (!auth) return errorResponse(req, "Unauthorized", 401);
  const userId = await requireUserId(auth.supabase);
  if (!userId) return errorResponse(req, "Unauthorized", 401);

  // OCR is now its own purchasable module rather than tied to a plan tier
  // (was gated via assert_feature('ocr')/plan_feature — superseded). Gate
  // it here, not only in the UI: this endpoint is directly callable with
  // any valid user token.
  try {
    await requireModule(auth.supabase, userId, "documents");
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Module check failed.", 403);
  }

  try {
    await enforceUsageQuota(auth.supabase);
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Quota check failed.", 429);
  }

  let body: { imageBase64: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.imageBase64) return errorResponse(req, "imageBase64 is required");

  const bytes = decodeBase64(body.imageBase64);
  if (bytes.byteLength < 1024) {
    return errorResponse(req, "That scan was empty — please retake the photo.");
  }
  if (bytes.byteLength > 10 * 1024 * 1024) {
    return errorResponse(req, "That photo is too large (max 10MB) — please retake it.", 413);
  }

  try {
    const result = await extractTextFromImage(bytes, body.mimeType || "image/jpeg");
    return jsonResponse(req, result);
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "OCR failed.", 502);
  }
});
