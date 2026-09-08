import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { handleOptions, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { todayIsoIST } from "../_shared/date-ist.ts";
import { sendWhatsAppDigest } from "../_shared/whatsapp.ts";
import { secretMatches } from "../_shared/timing-safe.ts";

// Cron-triggered daily digest: for every tenant that has WhatsApp switched on
// and an active/trialing license, find today's hearings (computed in
// Asia/Kolkata, never the runtime's own UTC clock — see _shared/date-ist.ts),
// write an in-app notification to every team member unconditionally, and
// send a WhatsApp message to whichever team members have both a phone number
// on file AND an active 'whatsapp_notifications' consent.
//
// Invoked only by pg_cron -> pg_net (see the migration that schedules it) —
// never by a real user, so this function has `verify_jwt = false` in
// config.toml and checks its own shared secret instead (below). It is the
// only function in this codebase that builds a service-role client — kept
// deliberately narrow: it only ever touches the eight tables named in the
// query below, never used as a general admin escape hatch.

const RECIPIENT_HEARING_STATUSES = ["confirmed", "cause_list_awaited"];
const ACTIVE_LICENSE_STATUSES = ["active", "trialing"];

type TenantRow = { tenant_id: string; plan: string };
type HearingRow = { id: string; hearing_date: string };
type ProfileRow = { id: string; phone: string | null };
type ConsentRow = { user_id: string };

async function processTenant(
  admin: SupabaseClient,
  tenant: TenantRow,
  todayIso: string,
): Promise<{ notified: number; sent: number; failed: number; skipped: number }> {
  const result = { notified: 0, sent: 0, failed: 0, skipped: 0 };

  const { data: hearings } = await admin
    .from("hearings")
    .select("id, hearing_date")
    .eq("tenant_id", tenant.tenant_id)
    .eq("hearing_date", todayIso)
    .in("status", RECIPIENT_HEARING_STATUSES)
    .returns<HearingRow[]>();

  const hearingCount = hearings?.length ?? 0;
  if (hearingCount === 0) return result; // no digest for an empty day

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, phone")
    .eq("tenant_id", tenant.tenant_id)
    .returns<ProfileRow[]>();
  if (!profiles || profiles.length === 0) return result;

  const { data: consents } = await admin
    .from("consents")
    .select("user_id")
    .eq("tenant_id", tenant.tenant_id)
    .eq("purpose", "whatsapp_notifications")
    .is("withdrawn_at", null)
    .returns<ConsentRow[]>();
  const consentedUserIds = new Set((consents ?? []).map((c) => c.user_id));

  const title = `${hearingCount} hearing${hearingCount === 1 ? "" : "s"} today`;
  const notificationRows = profiles.map((p) => ({
    tenant_id: tenant.tenant_id,
    user_id: p.id,
    type: "diary_digest",
    title,
    body: `You have ${hearingCount} hearing${hearingCount === 1 ? "" : "s"} listed for today.`,
    link: "/app/diary",
    metadata: { hearing_date: todayIso, hearing_count: hearingCount },
  }));
  const { error: notifyError } = await admin.from("notifications").insert(notificationRows);
  if (!notifyError) result.notified = notificationRows.length;

  for (const profile of profiles) {
    if (!profile.phone || !consentedUserIds.has(profile.id)) {
      result.skipped++;
      continue;
    }

    let providerMessageId: string | null = null;
    let status: "sent" | "failed" = "sent";
    let statusDetail: string | null = null;

    try {
      const { error: quotaError } = await admin.rpc("increment_whatsapp_usage", {
        p_tenant_id: tenant.tenant_id,
        p_ist_date: todayIso,
        p_count: 1,
      });
      if (quotaError) throw new Error(quotaError.message);

      const sendResult = await sendWhatsAppDigest({
        toPhoneE164: profile.phone,
        hearingCount,
        hearingDateIso: todayIso,
      });
      providerMessageId = sendResult.providerMessageId;
      result.sent++;
    } catch (cause) {
      status = "failed";
      statusDetail = cause instanceof Error ? cause.message : "Unknown error";
      result.failed++;
    }

    await admin.from("whatsapp_messages").insert({
      tenant_id: tenant.tenant_id,
      recipient_profile_id: profile.id,
      phone: profile.phone,
      hearing_date: todayIso,
      hearing_count: hearingCount,
      provider: "gupshup",
      provider_message_id: providerMessageId,
      status,
      status_detail: statusDetail,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    });
  }

  await admin.from("audit_log").insert({
    tenant_id: tenant.tenant_id,
    actor_user_id: null,
    actor_email: "system:whatsapp-diary-digest",
    action: "diary_digest_sent",
    resource_type: "whatsapp_messages",
    metadata: {
      hearing_date: todayIso,
      hearing_count: hearingCount,
      notified: result.notified,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
    },
  });

  return result;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const secret = Deno.env.get("CRON_SHARED_SECRET");
  if (!secret || !secretMatches(req.headers.get("x-cron-secret"), secret)) {
    return errorResponse(req, "Unauthorized", 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false },
    },
  );

  const todayIso = todayIsoIST();

  const { data: licenses, error: licensesError } = await admin
    .from("licenses")
    .select("tenant_id, plan, status, integrations")
    .in("status", ACTIVE_LICENSE_STATUSES)
    .returns<Array<TenantRow & { status: string; integrations: Record<string, unknown> }>>();

  if (licensesError) {
    return errorResponse(req, `Could not list tenants: ${licensesError.message}`, 500);
  }

  const eligibleTenants = (licenses ?? []).filter((l) => l.integrations?.whatsapp_enabled === true);

  let tenantsProcessed = 0;
  let notified = 0;
  let whatsappSent = 0;
  let whatsappFailed = 0;
  let skipped = 0;

  for (const tenant of eligibleTenants) {
    try {
      const result = await processTenant(admin, tenant, todayIso);
      if (result.notified > 0 || result.sent > 0 || result.failed > 0) tenantsProcessed++;
      notified += result.notified;
      whatsappSent += result.sent;
      whatsappFailed += result.failed;
      skipped += result.skipped;
    } catch (cause) {
      // One tenant's failure (bad data, quota exception, provider outage)
      // must never abort the run for every other tenant.
      console.error(`Tenant ${tenant.tenant_id} digest failed:`, cause);
    }
  }

  return jsonResponse(req, {
    tenantsProcessed,
    notified,
    whatsappSent,
    whatsappFailed,
    skipped,
  });
});
