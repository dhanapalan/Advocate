import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { DataTable, Tag, type Tone } from "@/components/app/primitives";
// Calls the Matters microservice (services/matters/) directly from the
// browser — not a TanStack server function, so no useServerFn wrapping.
import { createMatter, listMatters } from "@/lib/matters-service";
import { friendlyErrorMessage } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/app/cases/")({
  head: () => ({
    meta: [
      { title: "Cases & matters — LexDiary" },
      {
        name: "description",
        content: "Every matter for your chamber, with client, court and status.",
      },
      { property: "og:title", content: "Cases & matters — LexDiary" },
      {
        property: "og:description",
        content: "Every matter for your chamber, with client, court and status.",
      },
    ],
  }),
  component: Cases,
});

type Matter = {
  id: string;
  title: string;
  client_name: string | null;
  case_number: string | null;
  court: string | null;
  status: string;
  opposing_party: string | null;
  filed_date: string | null;
  created_at: string;
};

const statusTone: Record<string, Tone> = {
  active: "accent",
  closed: "success",
  archived: "neutral",
};

function Cases() {
  const loadMatters = listMatters;
  const addMatter = createMatter;

  const [matters, setMatters] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("q") || "",
  );
  const [form, setForm] = useState({
    title: "",
    clientName: "",
    caseNumber: "",
    court: "",
    opposingParty: "",
    filedDate: "",
  });

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setMatters((await loadMatters()) as Matter[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load matters.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // reload is re-created every render; listing it here would re-fetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await addMatter({
        title: form.title.trim(),
        clientName: form.clientName.trim() || undefined,
        caseNumber: form.caseNumber.trim() || undefined,
        court: form.court.trim() || undefined,
        opposingParty: form.opposingParty.trim() || undefined,
        filedDate: form.filedDate || undefined,
      });
      setForm({
        title: "",
        clientName: "",
        caseNumber: "",
        court: "",
        opposingParty: "",
        filedDate: "",
      });
      await reload();
    } catch (cause) {
      setError(friendlyErrorMessage(cause, "Failed to create matter."));
    } finally {
      setCreating(false);
    }
  }

  const needle = filterText.trim().toLowerCase();
  const filteredMatters = needle
    ? matters.filter((m) =>
        [m.title, m.case_number, m.client_name, m.opposing_party, m.court]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(needle)),
      )
    : matters;

  return (
    <AppShell
      title="Cases & matters"
      subtitle={
        loading
          ? "Loading…"
          : `${matters.length} matter${matters.length === 1 ? "" : "s"} in your chamber`
      }
    >
      <form
        onSubmit={handleCreate}
        className="surface-panel mb-6 grid gap-3 rounded p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="text-sm sm:col-span-2 lg:col-span-1">
          <span className="text-eyebrow">Matter title</span>
          <input
            value={form.title}
            onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
            placeholder="Malhotra v. Sunrise Developers"
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-eyebrow">Client</span>
          <input
            value={form.clientName}
            onChange={(event) => setForm((f) => ({ ...f, clientName: event.target.value }))}
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-eyebrow">Case number</span>
          <input
            value={form.caseNumber}
            onChange={(event) => setForm((f) => ({ ...f, caseNumber: event.target.value }))}
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-eyebrow">Court</span>
          <input
            value={form.court}
            onChange={(event) => setForm((f) => ({ ...f, court: event.target.value }))}
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-eyebrow">Opposing party</span>
          <input
            value={form.opposingParty}
            onChange={(event) => setForm((f) => ({ ...f, opposingParty: event.target.value }))}
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-eyebrow">Filed date</span>
          <input
            type="date"
            value={form.filedDate}
            onChange={(event) => setForm((f) => ({ ...f, filedDate: event.target.value }))}
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <div className="flex items-end sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            disabled={creating || !form.title.trim()}
            className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-ink disabled:opacity-60"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add matter
          </button>
        </div>
      </form>

      {error ? (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!loading && matters.length > 0 ? (
        <input
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          placeholder="Filter by matter, case number, client or opposing party"
          className="mb-4 w-full max-w-md rounded border border-input bg-background px-3 py-2 text-sm"
        />
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading matters…</p>
      ) : matters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matters yet — add your first one above.</p>
      ) : filteredMatters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matters match "{filterText.trim()}".</p>
      ) : (
        <DataTable headers={["Matter", "Case number", "Court", "Status", "Filed"]}>
          {filteredMatters.map((matter) => (
            <tr key={matter.id} className="hover:bg-secondary/40">
              <td className="px-4 py-3">
                <Link to="/app/cases/$matterId" params={{ matterId: matter.id }} className="block">
                  <p className="font-medium text-accent hover:underline">{matter.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {matter.client_name ? `Client ${matter.client_name}` : "No client set"}
                    {matter.opposing_party ? ` · Opposite ${matter.opposing_party}` : ""}
                  </p>
                </Link>
              </td>
              <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                {matter.case_number ?? "—"}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{matter.court ?? "—"}</td>
              <td className="px-4 py-3">
                <Tag tone={statusTone[matter.status] ?? "neutral"}>{matter.status}</Tag>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{matter.filed_date ?? "—"}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </AppShell>
  );
}
