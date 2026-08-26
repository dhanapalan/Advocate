import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decryptField, encryptField } from "@/lib/field-encryption";
import { requireModule } from "@/lib/require-module";

// Extracted from matters.functions.ts (20260826 module-selling pivot) —
// clients and matters became separately-sold modules, and this is the pilot
// extraction ahead of moving Clients into its own deployed service (see
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md). Deliberately
// still a same-Worker TanStack server-function file at this step — the code
// split happens first, deployment topology second, so a regression here is
// caught before compounding with a service-boundary change.

export const listClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireModule(context.supabase, context.userId, "clients");
    const { data, error } = await context.supabase
      .from("clients")
      .select("id, name, phone, email, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return Promise.all(
      (data ?? []).map(async (client) => ({ ...client, notes: await decryptField(client.notes) })),
    );
  });

// Same fix as matters.functions.ts's updateMatter/deleteMatter, same reason:
// RLS already allowed UPDATE for any tenant member and DELETE for tenant
// admins only — only the server function and UI were missing.
export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        name: z.string().min(2),
        phone: z.string().optional(),
        email: z.string().email().optional().or(z.literal("")),
        notes: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "clients");
    const { data: saved, error } = await context.supabase
      .from("clients")
      .update({
        name: data.name,
        phone: data.phone ?? null,
        email: data.email || null,
        notes: await encryptField(data.notes),
      })
      .eq("id", data.clientId)
      .select("id, name, phone, email, notes, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { ...saved, notes: data.notes ?? null };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ clientId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "clients");
    const { error, count } = await context.supabase
      .from("clients")
      .delete({ count: "exact" })
      .eq("id", data.clientId);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Client not found, or you don't have permission to delete it.");
    return { ok: true };
  });

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        name: z.string().min(2),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        notes: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "clients");
    const { data: saved, error } = await context.supabase
      .from("clients")
      .insert({
        name: data.name,
        phone: data.phone ?? null,
        email: data.email ?? null,
        notes: await encryptField(data.notes),
        created_by: context.userId,
      })
      .select("id, name, phone, email, notes, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { ...saved, notes: data.notes ?? null };
  });
