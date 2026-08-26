import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { DataTable } from "@/components/app/primitives";
// Calls the Clients microservice (services/clients/) directly from the
// browser — not a TanStack server function, so no useServerFn wrapping.
// See src/lib/clients-service.ts for why.
import { createClient, deleteClient, listClients, updateClient } from "@/lib/clients-service";
import { getMyMembership } from "@/lib/team.functions";
import { confirmPermanentRemoval } from "@/lib/confirm";

export const Route = createFileRoute("/_authenticated/app/clients")({
  head: () => ({
    meta: [
      { title: "Clients — LexDiary" },
      { name: "description", content: "Client register for your chamber." },
      { property: "og:title", content: "Clients — LexDiary" },
      { property: "og:description", content: "Client register for your chamber." },
    ],
  }),
  component: Clients,
});

type ClientRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
};

function Clients() {
  // listClients/createClient/updateClient/deleteClient are plain fetch()
  // calls to the Clients service, not TanStack server functions — no
  // useServerFn wrapping for those. getMyMembership still is one.
  const loadClients = listClients;
  const addClient = createClient;
  const saveClient = updateClient;
  const removeClient = deleteClient;
  const loadMembership = useServerFn(getMyMembership);

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [filterText, setFilterText] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("q") || "",
  );
  const [isAdmin, setIsAdmin] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setClients((await loadClients()) as ClientRow[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load clients.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    void loadMembership().then((membership) => {
      setIsAdmin(membership?.tenant_role === "owner" || membership?.tenant_role === "admin");
    });
    // reload/loadMembership are re-created every render; listing them here
    // would re-fetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEditing(client: ClientRow) {
    setEditingId(client.id);
    setEditForm({
      name: client.name,
      phone: client.phone ?? "",
      email: client.email ?? "",
      notes: client.notes ?? "",
    });
    setError(null);
  }

  async function handleSaveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingId || !editForm.name.trim()) return;
    setSavingEdit(true);
    setError(null);
    try {
      await saveClient({
        clientId: editingId,
        name: editForm.name.trim(),
        phone: editForm.phone.trim() || undefined,
        email: editForm.email.trim() || undefined,
        notes: editForm.notes.trim() || undefined,
      });
      setEditingId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save this client.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteClient(client: ClientRow) {
    if (!confirmPermanentRemoval(`"${client.name}"`)) return;
    setError(null);
    try {
      await removeClient({ clientId: client.id });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete this client.");
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await addClient({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setForm({ name: "", phone: "", email: "", notes: "" });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create client.");
    } finally {
      setCreating(false);
    }
  }

  const needle = filterText.trim().toLowerCase();
  const filteredClients = needle
    ? clients.filter((c) =>
        [c.name, c.phone, c.email]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(needle)),
      )
    : clients;

  return (
    <AppShell
      title="Clients"
      subtitle={
        loading
          ? "Loading…"
          : `${clients.length} client${clients.length === 1 ? "" : "s"} in your chamber`
      }
    >
      <form
        onSubmit={handleCreate}
        className="surface-panel mb-6 grid gap-3 rounded p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="text-sm">
          <span className="text-eyebrow">Name</span>
          <input
            value={form.name}
            onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
            placeholder="Rakesh Malhotra"
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-eyebrow">Phone</span>
          <input
            value={form.phone}
            onChange={(event) => setForm((f) => ({ ...f, phone: event.target.value }))}
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-eyebrow">Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-eyebrow">Notes</span>
          <input
            value={form.notes}
            onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))}
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <div className="flex items-end sm:col-span-2 lg:col-span-4">
          <button
            type="submit"
            disabled={creating || !form.name.trim()}
            className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-ink disabled:opacity-60"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add client
          </button>
        </div>
      </form>

      {error ? (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!loading && clients.length > 0 ? (
        <input
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          placeholder="Filter by name, phone or email"
          className="mb-4 w-full max-w-md rounded border border-input bg-background px-3 py-2 text-sm"
        />
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading clients…</p>
      ) : clients.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clients yet — add your first one above.</p>
      ) : filteredClients.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clients match "{filterText.trim()}".</p>
      ) : (
        <DataTable headers={["Client", "Phone", "Email", "Notes", ""]}>
          {filteredClients.map((client) =>
            editingId === client.id ? (
              <tr key={client.id}>
                <td colSpan={5} className="px-4 py-3">
                  <form
                    onSubmit={handleSaveEdit}
                    className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                  >
                    <label className="text-sm">
                      <span className="text-eyebrow">Name</span>
                      <input
                        value={editForm.name}
                        onChange={(event) =>
                          setEditForm((f) => ({ ...f, name: event.target.value }))
                        }
                        className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-eyebrow">Phone</span>
                      <input
                        value={editForm.phone}
                        onChange={(event) =>
                          setEditForm((f) => ({ ...f, phone: event.target.value }))
                        }
                        className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-eyebrow">Email</span>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(event) =>
                          setEditForm((f) => ({ ...f, email: event.target.value }))
                        }
                        className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-eyebrow">Notes</span>
                      <input
                        value={editForm.notes}
                        onChange={(event) =>
                          setEditForm((f) => ({ ...f, notes: event.target.value }))
                        }
                        className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
                      <button
                        type="submit"
                        disabled={savingEdit || !editForm.name.trim()}
                        className="flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-ink disabled:opacity-60"
                      >
                        {savingEdit ? <Loader2 className="size-3.5 animate-spin" /> : null}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={savingEdit}
                        className="rounded border border-input px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={client.id} className="hover:bg-secondary/40">
                <td className="px-4 py-3 font-medium">{client.name}</td>
                <td className="px-4 py-3 whitespace-nowrap">{client.phone ?? "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{client.email ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{client.notes ?? "—"}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => startEditing(client)}
                    title="Edit"
                    aria-label="Edit"
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Pencil className="size-4" />
                  </button>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => void handleDeleteClient(client)}
                      title="Delete"
                      aria-label="Delete"
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ),
          )}
        </DataTable>
      )}
    </AppShell>
  );
}
