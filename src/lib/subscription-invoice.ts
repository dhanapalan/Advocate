import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Mirrors plan_price_inr() in the database — see supabase/migrations/
// 20260820010000_pricing_plans_and_firm_features.sql. Duplicated here rather
// than queried at send-time because an invoice must show what was actually
// charged, not whatever the price happens to be when this runs.
type PayablePlan = "solo_basic" | "solo_pro" | "chamber";
const PLAN_NAMES: Record<PayablePlan, string> = {
  solo_basic: "Solo Basic",
  solo_pro: "Solo Pro",
  chamber: "Chamber",
};
const PLAN_BASE_PRICE: Record<PayablePlan, number> = {
  solo_basic: 2999,
  solo_pro: 3999,
  chamber: 7999,
};
const CHAMBER_INCLUDED_SEATS = 2;
const CHAMBER_EXTRA_SEAT_PRICE = 1999;
// Mirrors module_price_inr() in the database (supabase/migrations/
// 20260826100000_module_pricing.sql) — PLACEHOLDER pricing (Rs 499 across
// the board), flat per tenant regardless of seats. Update both together.
const MODULE_NAMES: Record<string, string> = {
  ai_drafting_enabled: "AI Drafting",
  ai_assistant_enabled: "AI Case Assistant",
  matter_intelligence_enabled: "Matter Intelligence",
  ocr_enabled: "OCR Document Intake",
  dictation_enabled: "Dictation",
};
const MODULE_PRICE_INR: Record<string, number> = {
  ai_drafting_enabled: 499,
  ai_assistant_enabled: 499,
  matter_intelligence_enabled: 499,
  ocr_enabled: 499,
  dictation_enabled: 499,
};
const GST_RATE = 0.18;
// Annual bills for 10 months' worth — 2 months free relative to paying monthly.
const ANNUAL_MONTHS_CHARGED = 10;

function rupees(value: number): string {
  return `Rs ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function invoiceHtml(input: {
  invoiceNumber: string;
  date: string;
  chamberName: string;
  planName: string;
  cadence: "monthly" | "annual";
  basePrice: number;
  seatCost: number;
  extraSeats: number;
  extraSeatPrice: number;
  moduleLines: { name: string; cost: number }[];
  gst: number;
  total: number;
  periodEnd: string;
}): string {
  const seatRow =
    input.extraSeats > 0
      ? `<tr><td style="padding:6px 0;color:#5B5F72">${input.extraSeats} extra seat${input.extraSeats === 1 ? "" : "s"} &times; ${rupees(input.extraSeatPrice)}${input.cadence === "annual" ? ` &times; ${ANNUAL_MONTHS_CHARGED} months` : ""}</td><td style="padding:6px 0;text-align:right">${rupees(input.seatCost)}</td></tr>`
      : "";
  const moduleRows = input.moduleLines
    .map(
      (m) =>
        `<tr><td style="padding:6px 0;color:#5B5F72">${m.name}${input.cadence === "annual" ? ` &times; ${ANNUAL_MONTHS_CHARGED} months` : ""}</td><td style="padding:6px 0;text-align:right">${rupees(m.cost)}</td></tr>`,
    )
    .join("");
  const planRow =
    input.cadence === "annual"
      ? `${input.planName} plan &mdash; annual (${ANNUAL_MONTHS_CHARGED} months, 2 free)`
      : `${input.planName} plan &mdash; monthly`;
  return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1A1D2B">
      <h2 style="margin:0 0 4px">LexDiary</h2>
      <p style="margin:0 0 24px;color:#5B5F72;font-size:13px">Invoice ${input.invoiceNumber} &middot; ${input.date}</p>
      <p style="margin:0 0 4px"><strong>${input.chamberName}</strong></p>
      <p style="margin:0 0 24px;color:#5B5F72">${planRow}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#5B5F72">${input.planName} plan</td><td style="padding:6px 0;text-align:right">${rupees(input.basePrice)}</td></tr>
        ${seatRow}
        ${moduleRows}
        <tr><td style="padding:6px 0;color:#5B5F72">GST (18%)</td><td style="padding:6px 0;text-align:right">${rupees(input.gst)}</td></tr>
        <tr style="border-top:1px solid #E2E1DC"><td style="padding:10px 0;font-weight:bold">Total paid</td><td style="padding:10px 0;text-align:right;font-weight:bold">${rupees(input.total)}</td></tr>
      </table>
      <p style="margin:20px 0 0;color:#5B5F72;font-size:12px">Covers your subscription through ${input.periodEnd}.</p>
      <p style="margin:8px 0 0;color:#5B5F72;font-size:12px">Payment received via Razorpay. Questions about this invoice? Reply to this email or write to chambers@lexdiary.online.</p>
    </div>
  `;
}

// The one write path for turning a chamber into a paying (or renewed) tenant.
// Called from /admin once a payment has been manually confirmed (the chamber
// pays via a Razorpay payment link and emails the reference — there is no
// webhook). In one action this extends the licence's billing period and
// emails the invoice, so the two can never drift apart the way two separate
// admin actions could.
export const activateSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        tenantId: z.string().uuid(),
        plan: z.enum(["solo_basic", "solo_pro", "chamber"]),
        cadence: z.enum(["monthly", "annual"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: adminRow } = await context.supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!adminRow) throw new Error("Not authorized to activate subscriptions.");

    const { data: tenant, error: tenantError } = await context.supabase
      .from("tenants")
      .select("id, name")
      .eq("id", data.tenantId)
      .single();
    if (tenantError || !tenant) throw new Error("Tenant not found.");

    const { data: existingLicense, error: existingLicenseError } = await context.supabase
      .from("licenses")
      .select(
        "plan, seats, current_period_end, legacy_base_price_inr, legacy_extra_seat_price_inr, integrations",
      )
      .eq("tenant_id", data.tenantId)
      .single();
    if (existingLicenseError || !existingLicense) throw new Error("License not found.");

    const planName = PLAN_NAMES[data.plan];
    // A grandfathered price only applies while renewing the SAME plan it was
    // locked to — moving this tenant to a different plan tier is an explicit
    // renegotiation, not a renewal, so it falls back to the standard price
    // for that tier even though the license row's override columns are
    // still set. (Clear those columns directly if the tenant is moved off
    // Chamber for good.)
    const stayingOnSamePlan = existingLicense.plan === data.plan;
    const basePrice =
      (stayingOnSamePlan ? existingLicense.legacy_base_price_inr : null) ??
      PLAN_BASE_PRICE[data.plan];
    const extraSeatPrice =
      (stayingOnSamePlan ? existingLicense.legacy_extra_seat_price_inr : null) ??
      CHAMBER_EXTRA_SEAT_PRICE;

    const extraSeats =
      data.plan === "chamber"
        ? Math.max((existingLicense.seats ?? 0) - CHAMBER_INCLUDED_SEATS, 0)
        : 0;
    const periodMonths = data.cadence === "annual" ? ANNUAL_MONTHS_CHARGED : 1;
    const seatCost = extraSeats * extraSeatPrice * periodMonths;

    // Purchased modules are billed flat per tenant (not per seat), same as
    // the price they show in /admin/settings/integrations. Only counts
    // flags actually set true on this license — never inferred from plan.
    const integrations = (existingLicense.integrations ?? {}) as Record<string, boolean>;
    const moduleLines = Object.entries(MODULE_NAMES)
      .filter(([key]) => integrations[key] === true)
      .map(([key, name]) => ({ name, cost: MODULE_PRICE_INR[key]! * periodMonths }));
    const modulesTotal = moduleLines.reduce((sum, m) => sum + m.cost, 0);

    const subtotal =
      basePrice * (data.cadence === "annual" ? ANNUAL_MONTHS_CHARGED : 1) + seatCost + modulesTotal;
    const gst = Math.round(subtotal * GST_RATE);
    const total = subtotal + gst;

    // Extends from the current period end if it's still in the future
    // (a renewal paid before expiry), otherwise from now (a lapsed or new
    // subscription) — never lets an early renewal shorten what's left.
    const existingEnd = existingLicense.current_period_end
      ? new Date(existingLicense.current_period_end)
      : null;
    const startFrom = existingEnd && existingEnd > new Date() ? existingEnd : new Date();
    const periodEnd = new Date(startFrom);
    periodEnd.setMonth(periodEnd.getMonth() + (data.cadence === "annual" ? 12 : 1));

    const { error: updateError } = await context.supabase
      .from("licenses")
      .update({
        plan: data.plan,
        billing_cadence: data.cadence,
        current_period_end: periodEnd.toISOString(),
      })
      .eq("tenant_id", data.tenantId);
    if (updateError) throw new Error(updateError.message);

    const { data: owner, error: ownerError } = await context.supabase
      .from("profiles")
      .select("id")
      .eq("tenant_id", data.tenantId)
      .eq("tenant_role", "owner")
      .maybeSingle();
    if (ownerError || !owner) throw new Error("Could not find the chamber owner.");

    // auth.users isn't reachable through the RLS-scoped client above — the
    // service-role client is the only way to resolve an id to an email.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authUser, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(
      owner.id,
    );
    const ownerEmail = authUser?.user?.email;
    if (authUserError || !ownerEmail)
      throw new Error("Could not resolve the chamber owner's email.");

    const invoiceNumber = `LD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${tenant.id.slice(0, 8).toUpperCase()}`;

    const RESEND_API_KEY = process.env["RESEND_API_KEY"];
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "LexDiary Billing <billing@lexdiary.online>",
        to: [ownerEmail],
        subject: `Invoice ${invoiceNumber} — LexDiary ${planName} plan`,
        html: invoiceHtml({
          invoiceNumber,
          date: new Date().toLocaleDateString("en-IN", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          chamberName: tenant.name,
          planName,
          cadence: data.cadence,
          basePrice: basePrice * (data.cadence === "annual" ? ANNUAL_MONTHS_CHARGED : 1),
          seatCost,
          extraSeats,
          extraSeatPrice,
          moduleLines,
          gst,
          total,
          periodEnd: periodEnd.toLocaleDateString("en-IN", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
        }),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Plan updated, but the invoice email failed to send: ${body}`);
    }

    return { ok: true, invoiceNumber, total, periodEnd: periodEnd.toISOString() };
  });
