import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// The admin tenant list needs each tenant's owner email/phone to show real
// contact info instead of a bare slug — but `profiles` RLS only lets a
// caller see their own row (or a colleague's, within their own tenant), and
// email lives in auth.users, unreachable to the RLS-scoped client at all.
// Both need the service-role client, so this is its own server function
// rather than something the admin page's existing client-side Supabase calls
// could do directly.
export const listTenantOwners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: adminRow } = await context.supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!adminRow) throw new Error("Not authorized to list tenant owners.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: owners, error: ownersError } = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id, full_name, phone")
      .eq("tenant_role", "owner");
    if (ownersError) throw new Error(ownersError.message);

    const ownerIds = new Set((owners ?? []).map((owner) => owner.id));

    // listUsers() is paginated and not filterable by id — page through until
    // every owner id has been matched or a page comes back short (the last
    // page), rather than assuming a fixed number of pages.
    const emailById = new Map<string, string>();
    const perPage = 200;
    for (let page = 1; emailById.size < ownerIds.size; page++) {
      const { data, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (usersError) throw new Error(usersError.message);
      for (const user of data.users) {
        if (ownerIds.has(user.id) && user.email) emailById.set(user.id, user.email);
      }
      if (data.users.length < perPage) break;
    }

    return (owners ?? [])
      .filter((owner): owner is typeof owner & { tenant_id: string } => owner.tenant_id !== null)
      .map((owner) => ({
        tenantId: owner.tenant_id,
        fullName: owner.full_name,
        phone: owner.phone,
        email: emailById.get(owner.id) ?? null,
      }));
  });
