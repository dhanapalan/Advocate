import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Ban,
  Loader2,
  Mail,
  Phone,
  Plus,
  PlayCircle,
  ReceiptIndianRupee,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { confirmDestructive, confirmPermanentRemoval } from "@/lib/confirm";
import { DataTable, Tag, type Tone } from "@/components/app/primitives";
import { activateSubscription } from "@/lib/subscription-invoice";
import { listTenantOwners } from "@/lib/admin-tenants.functions";
import type { Database } from "@/integrations/supabase/types";

type TenantOwner = { fullName: string | null; phone: string | null; email: string | null };

// Cosmetic variety for the tenant-name avatar chip — cycles through the same
// docket-* jewel tones used on the marketing pages, picked deterministically
// from the tenant id so a given tenant's color never changes between loads.
const AVATAR_TONES = ["sapphire", "amber", "teal", "rose", "emerald", "violet"] as const;
const avatarToneClasses: Record<(typeof AVATAR_TONES)[number], string> = {
  sapphire: "bg-docket-sapphire text-docket-sapphire-foreground",
  amber: "bg-docket-amber text-docket-amber-foreground",
  teal: "bg-docket-teal text-docket-teal-foreground",
  rose: "bg-docket-rose text-docket-rose-foreground",
  emerald: "bg-docket-emerald text-docket-emerald-foreground",
  violet: "bg-docket-violet text-docket-violet-foreground",
};
function avatarTone(id: string): (typeof AVATAR_TONES)[number] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length]!;
}

const SUBSCRIPTION_GRACE_DAYS = 3;
const PAYABLE_PLANS = ["solo_basic", "solo_pro", "chamber"] as const;
type PayablePlan = (typeof PAYABLE_PLANS)[number];

function subscriptionState(
  license: License,
): "trial" | "cancelled" | "active" | "grace" | "lapsed" {
  if (license.plan === "trial") return "trial";
  if (license.status === "cancelled") return "cancelled";
  if (!license.current_period_end) return "active";
  const graceEnd = new Date(license.current_period_end);
  graceEnd.setDate(graceEnd.getDate() + SUBSCRIPTION_GRACE_DAYS);
  const now = new Date();
  if (new Date(license.current_period_end) > now) return "active";
  return graceEnd > now ? "grace" : "lapsed";
}

const subscriptionStateTone: Record<ReturnType<typeof subscriptionState>, Tone> = {
  trial: "accent",
  cancelled: "danger",
  active: "success",
  grace: "warning",
  lapsed: "danger",
};

export const Route = createFileRoute("/_admin/admin/")({
  head: () => ({ meta: [{ title: "Tenants — Platform admin" }] }),
  component: AdminTenants,
});

type Tenant = Database["public"]["Tables"]["tenants"]["Row"];
type License = Database["public"]["Tables"]["licenses"]["Row"];
type TenantWithLicense = Tenant & { license: License | null };

const statusTone: Record<string, Tone> = {
  active: "success",
  suspended: "warning",
  cancelled: "danger",
  trialing: "accent",
  past_due: "warning",
};

async function fetchTenants(): Promise<TenantWithLicense[]> {
  const { data: tenants, error } = await supabase
    .from("tenants")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const { data: licenses } = await supabase.from("licenses").select("*");
  const licenseByTenant = new Map((licenses ?? []).map((license) => [license.tenant_id, license]));

  return (tenants ?? []).map((tenant) => ({
    ...tenant,
    license: licenseByTenant.get(tenant.id) ?? null,
  }));
}

function AdminTenants() {
  const activate = useServerFn(activateSubscription);
  const loadOwners = useServerFn(listTenantOwners);
  const [tenants, setTenants] = useState<TenantWithLicense[]>([]);
  const [owners, setOwners] = useState<Map<string, TenantOwner>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [tenantRows, ownerRows] = await Promise.all([fetchTenants(), loadOwners()]);
      setTenants(tenantRows);
      setOwners(new Map(ownerRows.map((owner) => [owner.tenantId, owner])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load tenants.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // reload is re-created every render (it closes over the useServerFn
    // results); listing it here would re-fetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const slug =
        newName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-") +
        "-" +
        Math.random().toString(36).slice(2, 8);
      const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .insert({ name: newName.trim(), slug })
        .select()
        .single();
      if (tenantError) throw tenantError;
      const { error: licenseError } = await supabase
        .from("licenses")
        .insert({ tenant_id: tenant.id, plan: "trial", status: "trialing" });
      if (licenseError) throw licenseError;
      setNewName("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create tenant.");
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(tenantId: string, status: Tenant["status"]) {
    setError(null);
    const { error: updateError } = await supabase
      .from("tenants")
      .update({ status })
      .eq("id", tenantId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await reload();
  }

  // Reverting a chamber to trial (a correction, not a payment) skips billing
  // entirely — this only ever runs for an actual paid-plan pick.
  async function handleRevertToTrial(licenseId: string) {
    setError(null);
    const { error: updateError } = await supabase
      .from("licenses")
      .update({ plan: "trial" })
      .eq("id", licenseId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await reload();
  }

  // The one action that both charges and unlocks a chamber: confirming a
  // payment already received (via the Razorpay link + emailed reference)
  // extends the billing period and emails the invoice in the same step, so
  // the two can't drift — see activateSubscription's own comment.
  async function handleActivate(
    tenantId: string,
    plan: PayablePlan,
    cadence: "monthly" | "annual",
  ) {
    setError(null);
    try {
      const result = await activate({ data: { tenantId, plan, cadence } });
      toast.success(
        `Invoice ${result.invoiceNumber} emailed — active through ${new Date(result.periodEnd).toLocaleDateString("en-IN")}`,
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to activate the subscription.");
    }
  }

  // The control that actually locks a chamber out: enforce_tenant_writable()
  // blocks writes once licenses.status = 'cancelled'. tenants.status (the
  // "Status" dropdown above) isn't read by any RLS policy or trigger — it's
  // informational only — so this, not that, is the real "cancel license".
  async function handleCancelLicense(licenseId: string, tenantName: string) {
    if (
      !confirmDestructive(
        `Cancel ${tenantName}'s subscription? Their chamber goes read-only immediately — matters, diary and documents stay readable, but nothing new can be added until reactivated.`,
      )
    )
      return;
    setError(null);
    const { error: updateError } = await supabase
      .from("licenses")
      .update({ status: "cancelled" })
      .eq("id", licenseId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await reload();
  }

  async function handleReactivateLicense(licenseId: string) {
    setError(null);
    const { error: updateError } = await supabase
      .from("licenses")
      .update({ status: "active" })
      .eq("id", licenseId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await reload();
  }

  async function handleDelete(tenantId: string) {
    if (
      !confirmPermanentRemoval(
        "this tenant",
        "Its licence, matters, clients and every other record are deleted with it.",
      )
    )
      return;
    setError(null);
    const { error: deleteError } = await supabase.from("tenants").delete().eq("id", tenantId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await reload();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold">Tenants</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and manage chambers/firms, their license plan and status.
          </p>
        </div>
      </div>

      <form onSubmit={handleCreate} className="surface-panel mt-6 flex items-end gap-3 rounded p-4">
        <label className="flex-1 text-sm">
          <span className="text-eyebrow">New tenant name</span>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Nair & Associates"
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-ink disabled:opacity-60"
        >
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create tenant
        </button>
      </form>

      {error ? (
        <p className="mt-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading tenants…</p>
        ) : tenants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tenants yet.</p>
        ) : (
          <DataTable headers={["Tenant", "Contact", "Status", "Plan", "Subscription", "Actions"]}>
            {tenants.map((tenant) => {
              const owner = owners.get(tenant.id);
              const tone = avatarTone(tenant.id);
              return (
                <tr key={tenant.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarToneClasses[tone]}`}
                      >
                        {tenant.name.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                      <div>
                        <p className="font-medium">{tenant.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Since {new Date(tenant.created_at).toLocaleDateString("en-IN")}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {owner ? (
                      <div className="space-y-1">
                        <p className="flex items-center gap-1.5 text-xs">
                          <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                          {owner.email ?? <span className="text-muted-foreground">—</span>}
                        </p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="size-3.5 shrink-0" />
                          {owner.phone ?? "—"}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No owner yet</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={tenant.status}
                      onChange={(event) =>
                        handleStatusChange(tenant.id, event.target.value as Tenant["status"])
                      }
                      className="rounded border border-input bg-background px-2 py-1 text-xs"
                    >
                      <option value="active">active</option>
                      <option value="suspended">suspended</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {tenant.license ? (
                      <div className="flex items-center gap-2">
                        <Tag tone="neutral">{tenant.license.plan}</Tag>
                        {tenant.license.plan !== "trial" ? (
                          <button
                            type="button"
                            title="Revert to trial"
                            onClick={() => handleRevertToTrial(tenant.license!.id)}
                            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            <RotateCcw className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">no license</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {tenant.license ? (
                      <div className="space-y-1">
                        <Tag tone={subscriptionStateTone[subscriptionState(tenant.license)]}>
                          {subscriptionState(tenant.license)}
                        </Tag>
                        {tenant.license.current_period_end ? (
                          <p className="text-xs text-muted-foreground">
                            {tenant.license.billing_cadence} · through{" "}
                            {new Date(tenant.license.current_period_end).toLocaleDateString(
                              "en-IN",
                            )}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {tenant.license ? (
                        <BillingActivation
                          currentPlan={tenant.license.plan}
                          onActivate={(plan, cadence) => handleActivate(tenant.id, plan, cadence)}
                        />
                      ) : null}
                      {tenant.license && tenant.license.plan !== "trial" ? (
                        tenant.license.status === "cancelled" ? (
                          <button
                            type="button"
                            title="Reactivate license"
                            onClick={() => handleReactivateLicense(tenant.license!.id)}
                            className="flex size-7 items-center justify-center rounded border border-accent/30 text-accent hover:bg-accent/10"
                          >
                            <PlayCircle className="size-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Cancel license"
                            onClick={() => handleCancelLicense(tenant.license!.id, tenant.name)}
                            className="flex size-7 items-center justify-center rounded border border-warning/40 text-warning-foreground hover:bg-warning/10"
                          >
                            <Ban className="size-3.5" />
                          </button>
                        )
                      ) : null}
                      <button
                        type="button"
                        title="Delete tenant"
                        onClick={() => handleDelete(tenant.id)}
                        className="flex size-7 items-center justify-center rounded border border-destructive/30 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </div>
    </div>
  );
}

// Pending plan/cadence choice for one tenant row, applied only when
// "Activate" is pressed — a stray dropdown click should never fire a billing
// event and an invoice email on its own.
function BillingActivation({
  currentPlan,
  onActivate,
}: {
  currentPlan: string;
  onActivate: (plan: PayablePlan, cadence: "monthly" | "annual") => Promise<void>;
}) {
  const [plan, setPlan] = useState<PayablePlan>(
    PAYABLE_PLANS.includes(currentPlan as PayablePlan)
      ? (currentPlan as PayablePlan)
      : "solo_basic",
  );
  const [cadence, setCadence] = useState<"monthly" | "annual">("monthly");
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={plan}
        onChange={(event) => setPlan(event.target.value as PayablePlan)}
        className="rounded border border-input bg-background px-2 py-1 text-xs"
      >
        <option value="solo_basic">solo_basic</option>
        <option value="solo_pro">solo_pro</option>
        <option value="chamber">chamber</option>
      </select>
      <select
        value={cadence}
        onChange={(event) => setCadence(event.target.value as "monthly" | "annual")}
        className="rounded border border-input bg-background px-2 py-1 text-xs"
      >
        <option value="monthly">monthly</option>
        <option value="annual">annual (2 free)</option>
      </select>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onActivate(plan, cadence);
          } finally {
            setBusy(false);
          }
        }}
        className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground hover:bg-ink disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <ReceiptIndianRupee className="size-3" />
        )}
        {currentPlan === "trial" ? "Activate" : "Renew"}
      </button>
    </div>
  );
}
