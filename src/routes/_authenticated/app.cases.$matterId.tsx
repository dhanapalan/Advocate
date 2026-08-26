import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Tag, type Tone } from "@/components/app/primitives";
import { MatterTimeline } from "@/components/app/MatterTimeline";
import { MatterAiSummary } from "@/components/app/MatterAiSummary";
import { AskMyCase } from "@/components/app/AskMyCase";
import { getMatterContext, type MatterContext } from "@/lib/matter-context.functions";
// Calls the Matters microservice (services/matters/) directly from the
// browser — not a TanStack server function, so no useServerFn wrapping.
import { updateMatter, deleteMatter } from "@/lib/matters-service";
import { getMyMembership } from "@/lib/team.functions";
import { buildMatterTimeline } from "@/lib/matter-timeline";
import { todayIsoIST } from "@/lib/date-ist";
import { confirmPermanentRemoval } from "@/lib/confirm";

export const Route = createFileRoute("/_authenticated/app/cases/$matterId")({
  head: () => ({
    meta: [
      { title: "Matter — LexDiary" },
      {
        name: "description",
        content: "Case timeline, hearings, cause-list history and documents for one matter.",
      },
    ],
  }),
  component: MatterDetail,
});

const statusTone: Record<string, Tone> = {
  active: "accent",
  closed: "success",
  archived: "neutral",
};

function MatterDetail() {
  const { matterId } = Route.useParams();
  const navigate = useNavigate();
  const loadContext = useServerFn(getMatterContext);
  const saveMatter = updateMatter;
  const removeMatter = deleteMatter;
  const loadMembership = useServerFn(getMyMembership);

  const [context, setContext] = useState<MatterContext | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    clientName: "",
    caseNumber: "",
    court: "",
    opposingParty: "",
    filedDate: "",
    status: "active" as "active" | "closed" | "archived",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContext(undefined);
    setError(null);
    void loadContext({ data: { matterId } })
      .then((result) => {
        if (!cancelled) setContext(result as MatterContext | null);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Failed to load this matter.");
      });
    void loadMembership().then((membership) => {
      if (!cancelled)
        setIsAdmin(membership?.tenant_role === "owner" || membership?.tenant_role === "admin");
    });
    return () => {
      cancelled = true;
    };
  }, [matterId, loadContext, loadMembership]);

  function startEditing() {
    if (!context) return;
    setEditForm({
      title: context.matter.title,
      clientName: context.matter.clientName ?? "",
      caseNumber: context.matter.caseNumber ?? "",
      court: context.matter.court ?? "",
      opposingParty: context.matter.opposingParty ?? "",
      filedDate: context.matter.filedDate ?? "",
      status: context.matter.status as "active" | "closed" | "archived",
      notes: context.matter.notes ?? "",
    });
    setFormError(null);
    setEditing(true);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!editForm.title.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const saved = await saveMatter({
        matterId,
        title: editForm.title.trim(),
        clientName: editForm.clientName.trim() || undefined,
        caseNumber: editForm.caseNumber.trim() || undefined,
        court: editForm.court.trim() || undefined,
        opposingParty: editForm.opposingParty.trim() || undefined,
        filedDate: editForm.filedDate || undefined,
        status: editForm.status,
        notes: editForm.notes.trim() || undefined,
      });
      setContext((prev) =>
        prev
          ? {
              ...prev,
              matter: {
                ...prev.matter,
                title: saved.title,
                clientName: saved.client_name,
                caseNumber: saved.case_number,
                court: saved.court,
                opposingParty: saved.opposing_party,
                filedDate: saved.filed_date,
                status: saved.status,
                notes: saved.notes,
              },
            }
          : prev,
      );
      setEditing(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Failed to save this matter.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!context) return;
    if (
      !confirmPermanentRemoval(
        `"${context.matter.title}"`,
        "Its hearings, cause-list matches and documents stay on record but lose this matter link.",
      )
    )
      return;
    setDeleting(true);
    setFormError(null);
    try {
      await removeMatter({ matterId });
      void navigate({ to: "/app/cases" });
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Failed to delete this matter.");
      setDeleting(false);
    }
  }

  const timeline = useMemo(() => (context ? buildMatterTimeline(context) : []), [context]);

  const nextHearing = useMemo(() => {
    if (!context) return null;
    const today = todayIsoIST();
    return (
      context.hearings.find(
        (h) => h.hearingDate >= today && h.status !== "completed" && h.status !== "adjourned",
      ) ?? null
    );
  }, [context]);

  const recentEvents = useMemo(() => [...timeline].reverse().slice(0, 3), [timeline]);

  if (context === undefined && !error) {
    return (
      <AppShell title="Matter" subtitle="Loading…">
        <p className="text-sm text-muted-foreground">Loading matter…</p>
      </AppShell>
    );
  }

  if (error || !context) {
    return (
      <AppShell title="Matter" subtitle="Not found">
        <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? "This matter doesn't exist, or isn't part of your chamber."}
        </p>
        <Link to="/app/cases" className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent">
          <ArrowLeft className="size-4" /> Back to Cases & matters
        </Link>
      </AppShell>
    );
  }

  const { matter } = context;

  return (
    <AppShell
      title={matter.title}
      subtitle={
        [matter.caseNumber, matter.court].filter(Boolean).join(" · ") || "No details on record"
      }
      action={
        <div className="flex flex-wrap items-center gap-2">
          {!editing ? (
            <button
              type="button"
              onClick={startEditing}
              className="flex items-center gap-1.5 rounded border border-input px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              <Pencil className="size-4" /> Edit
            </button>
          ) : null}
          {isAdmin && !editing ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete
            </button>
          ) : null}
          <Link
            to="/app/cases"
            className="flex items-center gap-1.5 rounded border border-input px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
          >
            <ArrowLeft className="size-4" /> Cases
          </Link>
        </div>
      }
    >
      {formError ? (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      {editing ? (
        <form
          onSubmit={handleSave}
          className="surface-panel mb-6 grid gap-3 rounded p-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="text-sm sm:col-span-2 lg:col-span-1">
            <span className="text-eyebrow">Matter title</span>
            <input
              value={editForm.title}
              onChange={(event) => setEditForm((f) => ({ ...f, title: event.target.value }))}
              className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-eyebrow">Client</span>
            <input
              value={editForm.clientName}
              onChange={(event) => setEditForm((f) => ({ ...f, clientName: event.target.value }))}
              className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-eyebrow">Case number</span>
            <input
              value={editForm.caseNumber}
              onChange={(event) => setEditForm((f) => ({ ...f, caseNumber: event.target.value }))}
              className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-eyebrow">Court</span>
            <input
              value={editForm.court}
              onChange={(event) => setEditForm((f) => ({ ...f, court: event.target.value }))}
              className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-eyebrow">Opposing party</span>
            <input
              value={editForm.opposingParty}
              onChange={(event) =>
                setEditForm((f) => ({ ...f, opposingParty: event.target.value }))
              }
              className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-eyebrow">Filed date</span>
            <input
              type="date"
              value={editForm.filedDate}
              onChange={(event) => setEditForm((f) => ({ ...f, filedDate: event.target.value }))}
              className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-eyebrow">Status</span>
            <select
              value={editForm.status}
              onChange={(event) =>
                setEditForm((f) => ({
                  ...f,
                  status: event.target.value as "active" | "closed" | "archived",
                }))
              }
              className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="active">active</option>
              <option value="closed">closed</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label className="text-sm sm:col-span-2 lg:col-span-4">
            <span className="text-eyebrow">Notes</span>
            <textarea
              value={editForm.notes}
              onChange={(event) => setEditForm((f) => ({ ...f, notes: event.target.value }))}
              rows={3}
              className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              disabled={saving || !editForm.title.trim()}
              className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-ink disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save changes
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <section className="surface-panel mb-6 rounded p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={statusTone[matter.status] ?? "neutral"}>{matter.status}</Tag>
            {matter.caseNumber ? (
              <span className="font-mono text-xs text-muted-foreground">{matter.caseNumber}</span>
            ) : null}
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-eyebrow text-muted-foreground">Court</dt>
              <dd className="mt-1 text-sm">{matter.court ?? "Not on record"}</dd>
            </div>
            <div>
              <dt className="text-eyebrow text-muted-foreground">Client</dt>
              <dd className="mt-1 text-sm">{matter.clientName ?? "Not on record"}</dd>
            </div>
            <div>
              <dt className="text-eyebrow text-muted-foreground">Opposing party</dt>
              <dd className="mt-1 text-sm">{matter.opposingParty ?? "Not on record"}</dd>
            </div>
            <div>
              <dt className="text-eyebrow text-muted-foreground">Next hearing</dt>
              <dd className="mt-1 text-sm">
                {nextHearing
                  ? `${nextHearing.hearingDate}${nextHearing.hearingTime ? `, ${nextHearing.hearingTime}` : ""}`
                  : "None scheduled"}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <div className="mb-6">
        <MatterAiSummary context={context} />
      </div>

      <div className="mb-6">
        <AskMyCase context={context} />
      </div>

      <div className="mb-6">
        <h2 className="mb-3 font-display text-lg font-bold">Recent activity</h2>
        {recentEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet for this matter.</p>
        ) : (
          <ul className="space-y-1.5">
            {recentEvents.map((event) => (
              <li key={event.id} className="text-sm">
                <span className="text-muted-foreground">{event.eventAt.slice(0, 10)}</span>{" "}
                <span className="font-medium">{event.title}</span>
                {event.description ? (
                  <span className="text-muted-foreground"> — {event.description}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold">Case timeline</h2>
        <MatterTimeline events={timeline} />
      </section>
    </AppShell>
  );
}
