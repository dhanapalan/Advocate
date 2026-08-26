import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MessageCircle, ReceiptIndianRupee } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable } from "@/components/app/primitives";

function rupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export const Route = createFileRoute("/_admin/admin/settings/integrations")({
  head: () => ({ meta: [{ title: "Integrations — Platform admin" }] }),
  component: AdminIntegrations,
});

type Integrations = {
  whatsapp_enabled?: boolean;
  ai_morning_brief_enabled?: boolean;
  cause_list_enabled?: boolean;
  ai_matter_intelligence_enabled?: boolean;
  ai_case_intelligence_enabled?: boolean;
  ai_drafting_enabled?: boolean;
  ai_assistant_enabled?: boolean;
  matter_intelligence_enabled?: boolean;
  matters_enabled?: boolean;
  clients_enabled?: boolean;
  diary_enabled?: boolean;
  documents_enabled?: boolean;
  billing_enabled?: boolean;
};

// Mirrors module_price_inr() in the database (supabase/migrations/
// 20260826100000_module_pricing.sql, 20260826110000_feature_area_modules.sql)
// — PLACEHOLDER pricing (Rs 499 across the board, flat per tenant regardless
// of seats), explicitly provisional per user decision: ship the calculation
// now, set real prices later. Update both together. OCR/Dictation retired
// into Documents/AI Drafting respectively (20260826 module-selling pivot) —
// no standalone rows for them any more.
const MODULES: { key: keyof Integrations; label: string; priceInr: number }[] = [
  { key: "matters_enabled", label: "Case/Matter Tracking", priceInr: 499 },
  { key: "clients_enabled", label: "Client Management", priceInr: 499 },
  { key: "diary_enabled", label: "Court Diary & Cause List", priceInr: 499 },
  { key: "documents_enabled", label: "Documents (incl. OCR)", priceInr: 499 },
  { key: "billing_enabled", label: "Time Tracking & Billing", priceInr: 499 },
  { key: "ai_drafting_enabled", label: "AI Drafting (incl. Dictation)", priceInr: 499 },
  { key: "ai_assistant_enabled", label: "AI Case Assistant", priceInr: 499 },
  { key: "matter_intelligence_enabled", label: "Matter Intelligence", priceInr: 499 },
];
type TenantIntegrations = {
  id: string;
  name: string;
  integrations: Integrations | null;
};

async function fetchTenantIntegrations(): Promise<TenantIntegrations[]> {
  const { data: tenants, error } = await supabase
    .from("tenants")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw error;

  const { data: licenses } = await supabase.from("licenses").select("tenant_id, integrations");
  const integrationsByTenant = new Map(
    (licenses ?? []).map((l) => [l.tenant_id, l.integrations as Integrations]),
  );

  return (tenants ?? []).map((t) => ({
    ...t,
    integrations: integrationsByTenant.get(t.id) ?? null,
  }));
}

function AdminIntegrations() {
  const [rows, setRows] = useState<TenantIntegrations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchTenantIntegrations());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load integrations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  // integrations is one JSONB column holding several toggles — an update
  // must merge onto the row's current value, not replace it wholesale, or
  // flipping one toggle would silently reset every other one on that
  // tenant back to its default.
  async function setIntegration(tenantId: string, key: keyof Integrations, value: boolean) {
    setError(null);
    const current = rows.find((r) => r.id === tenantId)?.integrations ?? {};
    const { error: updateError } = await supabase
      .from("licenses")
      .update({ integrations: { ...current, [key]: value } })
      .eq("tenant_id", tenantId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await reload();
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <MessageCircle className="size-5 text-primary" />
        <h1 className="font-display text-xl font-bold">Integrations</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Per-tenant integration and AI-feature entitlements. Toggling WhatsApp on here gates the
        WhatsApp section in that chamber's app — it does not connect a real WhatsApp Business API
        provider. No message can actually be sent until a provider (Meta Cloud API, Twilio, Gupshup,
        etc.) and its credentials are wired in separately.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        AI Morning Brief governs whether that chamber's dashboard can call the AI prep-notes layer
        at all — checked here first, and enforced again server-side in the edge function itself, so
        turning it off here actually stops the AI call, not just the button. The deterministic
        Morning Brief (hearings, conflicts, documents) keeps working either way.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Cause List Intelligence governs whether that chamber can import cause lists at all — checked
        here first, and enforced again server-side in the import itself. Listings already imported
        and matched stay visible either way; turning it off only blocks new imports.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        AI Matter Intelligence governs whether a matter's AI summary can be generated at all —
        checked here first, and enforced again server-side in the ai-matter-summary edge function
        itself. The Matter Timeline, hearings, cause-list history and documents keep working either
        way; turning it off only hides the AI summary.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        AI Case Intelligence governs whether "Ask My Case" can answer questions about a matter at
        all — checked here first, and enforced again server-side in the ai-ask-case edge function
        itself, so calling it directly still gets refused. The Matter Timeline, hearings, cause-list
        history and documents keep working either way; turning it off only hides Ask My Case.
      </p>

      {error ? (
        <p className="mt-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tenants yet.</p>
        ) : (
          <DataTable
            headers={[
              "Tenant",
              "WhatsApp API",
              "AI Morning Brief",
              "Cause List Intelligence",
              "AI Matter Intelligence",
              "AI Case Intelligence",
            ]}
          >
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-secondary/40">
                <td className="px-4 py-3 font-medium">{row.name}</td>
                <td className="px-4 py-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.integrations?.whatsapp_enabled ?? false}
                      onChange={(event) =>
                        void setIntegration(row.id, "whatsapp_enabled", event.target.checked)
                      }
                      className="size-4 rounded border-input"
                    />
                    {row.integrations?.whatsapp_enabled ? "Enabled" : "Disabled"}
                  </label>
                </td>
                <td className="px-4 py-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.integrations?.ai_morning_brief_enabled ?? true}
                      onChange={(event) =>
                        void setIntegration(
                          row.id,
                          "ai_morning_brief_enabled",
                          event.target.checked,
                        )
                      }
                      className="size-4 rounded border-input"
                    />
                    {(row.integrations?.ai_morning_brief_enabled ?? true) ? "Enabled" : "Disabled"}
                  </label>
                </td>
                <td className="px-4 py-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.integrations?.cause_list_enabled ?? true}
                      onChange={(event) =>
                        void setIntegration(row.id, "cause_list_enabled", event.target.checked)
                      }
                      className="size-4 rounded border-input"
                    />
                    {(row.integrations?.cause_list_enabled ?? true) ? "Enabled" : "Disabled"}
                  </label>
                </td>
                <td className="px-4 py-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.integrations?.ai_matter_intelligence_enabled ?? true}
                      onChange={(event) =>
                        void setIntegration(
                          row.id,
                          "ai_matter_intelligence_enabled",
                          event.target.checked,
                        )
                      }
                      className="size-4 rounded border-input"
                    />
                    {(row.integrations?.ai_matter_intelligence_enabled ?? true)
                      ? "Enabled"
                      : "Disabled"}
                  </label>
                </td>
                <td className="px-4 py-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.integrations?.ai_case_intelligence_enabled ?? true}
                      onChange={(event) =>
                        void setIntegration(
                          row.id,
                          "ai_case_intelligence_enabled",
                          event.target.checked,
                        )
                      }
                      className="size-4 rounded border-input"
                    />
                    {(row.integrations?.ai_case_intelligence_enabled ?? true)
                      ? "Enabled"
                      : "Disabled"}
                  </label>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      <div className="mt-10 flex items-center gap-2">
        <ReceiptIndianRupee className="size-5 text-primary" />
        <h2 className="font-display text-lg font-bold">Purchased modules</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Opposite default from the toggles above: these are OFF unless a chamber has actually bought
        the module (a trial tenant gets every module unlocked to evaluate, so this table only
        matters once a chamber is on a paid plan). Enforced server-side in each module's edge
        functions via requireModule() — flipping a switch off here refuses the underlying AI call
        directly, not just the UI button.
      </p>
      <p className="mt-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
        Prices shown (₹499/month each) are placeholders, not final pricing — the calculation
        mechanism is real and live (it drives the chamber's actual Billing summary and any invoice
        generated from the Tenants page), but update these numbers before relying on them for real
        billing.
      </p>

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tenants yet.</p>
        ) : (
          <DataTable headers={["Tenant", ...MODULES.map((m) => m.label), "Modules total"]}>
            {rows.map((row) => {
              const purchasedModules = MODULES.filter((module) => row.integrations?.[module.key]);
              const modulesTotal = purchasedModules.reduce((sum, m) => sum + m.priceInr, 0);
              return (
                <tr key={row.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  {MODULES.map((module) => {
                    const enabled = row.integrations?.[module.key] ?? false;
                    return (
                      <td key={module.key} className="px-4 py-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(event) =>
                              void setIntegration(row.id, module.key, event.target.checked)
                            }
                            className="size-4 rounded border-input"
                          />
                          <span className={enabled ? "" : "text-muted-foreground"}>
                            {enabled ? "Purchased" : "Not purchased"}
                          </span>
                        </label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {rupees(module.priceInr)}/mo
                        </p>
                      </td>
                    );
                  })}
                  <td className="px-4 py-3">
                    <span className="font-display font-bold">{rupees(modulesTotal)}</span>
                    <p className="text-xs text-muted-foreground">/month, added to base plan</p>
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
