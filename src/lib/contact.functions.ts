import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Public, unauthenticated — a prospective customer submitting "Request
// access" has no account yet. Writes via the service-role client rather
// than an anon-role RLS policy, so contact_requests can stay closed to
// anon/authenticated writes entirely; see that migration's comment.
const inputSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  enrolmentNo: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(1).max(30),
  court: z.string().trim().max(200).optional(),
  note: z.string().trim().max(4000).optional(),
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Best-effort — a failed notification email should never lose a request
// that's already safely in contact_requests; the table (visible on
// /admin/contact-requests) is the source of truth, this is just paging
// whoever's on point sooner than a next admin-panel check would.
async function notifyChambers(data: z.infer<typeof inputSchema>): Promise<void> {
  const RESEND_API_KEY = process.env["RESEND_API_KEY"];
  if (!RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "LexDiary Onboarding <onboarding@lexdiary.online>",
        to: ["chambers@lexdiary.online"],
        subject: `New access request — ${data.fullName}`,
        html: `
          <p><strong>${escapeHtml(data.fullName)}</strong>${data.enrolmentNo ? ` (${escapeHtml(data.enrolmentNo)})` : ""} requested access.</p>
          <p>Email: ${escapeHtml(data.email)}<br>Phone: ${escapeHtml(data.phone)}${data.court ? `<br>Court/bench: ${escapeHtml(data.court)}` : ""}</p>
          ${data.note ? `<p>${escapeHtml(data.note).replace(/\n/g, "<br>")}</p>` : ""}
        `,
      }),
    });
  } catch {
    // Swallowed deliberately — see the comment above this function.
  }
}

// This endpoint is unauthenticated, writes with the service-role client, and
// sends an email per submission — so without a cap it is both a way to fill
// the admin table with junk and a way to burn the Resend quota. Three requests
// per email per hour is far above any real use (a prospective client submits
// once, maybe twice if they mistype something) and well below useful spam
// volume.
//
// This is deliberately per-email rather than global: a global hourly cap would
// let one script lock out every genuine visitor for the rest of the hour.
// Volumetric abuse from a single source is Cloudflare's job — add a Rate
// Limiting rule on /_serverFn/* to go with this.
const MAX_REQUESTS_PER_EMAIL_PER_HOUR = 3;

export const submitContactRequest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recent } = await supabaseAdmin
      .from("contact_requests")
      .select("id", { count: "exact", head: true })
      .ilike("email", data.email)
      .gte("created_at", oneHourAgo);
    if ((recent ?? 0) >= MAX_REQUESTS_PER_EMAIL_PER_HOUR) {
      // Their own address, so saying so discloses nothing they don't know.
      throw new Error(
        "We've already got your request — someone will be in touch shortly. Please don't resend.",
      );
    }

    const { error } = await supabaseAdmin.from("contact_requests").insert({
      full_name: data.fullName,
      enrolment_no: data.enrolmentNo || null,
      email: data.email,
      phone: data.phone,
      court: data.court || null,
      note: data.note || null,
    });
    if (error) throw new Error(error.message);
    await notifyChambers(data);
    return { ok: true };
  });
