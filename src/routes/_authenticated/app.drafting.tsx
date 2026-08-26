import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Check, FileText, Loader2, Printer, Save, Sparkles, X } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Tag, type Tone } from "@/components/app/primitives";
import { listDrafts, saveDraft, updateDraftStatus } from "@/lib/ai.functions";
import { generateDraft } from "@/lib/edge-functions";
// Calls the Matters microservice (services/matters/) directly — not a
// TanStack server function, so no useServerFn wrapping.
import { listMatters } from "@/lib/matters-service";

export const Route = createFileRoute("/_authenticated/app/drafting")({
  head: () => ({
    meta: [
      { title: "AI drafting studio — LexDiary" },
      {
        name: "description",
        content:
          "Generate court-ready notices, applications, replies and client letters with AI, edit them inline and print from your chamber workspace.",
      },
      { property: "og:title", content: "AI drafting studio — LexDiary" },
      {
        property: "og:description",
        content:
          "AI-generated Indian legal drafts with numbered paragraphs, prayer and verification.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Drafting,
});

type Draft = {
  id: string;
  doc_type: string;
  matter_ref: string | null;
  instructions: string;
  content: string;
  status: string;
  created_at: string;
};

type MatterOption = { id: string; title: string };

const reviewLabel: Record<string, string> = {
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};
const reviewTone: Record<string, Tone> = {
  pending_review: "warning",
  approved: "success",
  rejected: "danger",
};

const DOC_TYPES = [
  "Legal notice",
  "Plaint",
  "Written statement",
  "Bail application",
  "Interim injunction application",
  "Reply to notice",
  "Vakalatnama covering letter",
  "Client advice letter",
] as const;

function Drafting() {
  const load = useServerFn(listDrafts);
  const persist = useServerFn(saveDraft);
  const loadMatters = listMatters;
  const setReviewStatus = useServerFn(updateDraftStatus);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [matters, setMatters] = useState<MatterOption[]>([]);
  const [active, setActive] = useState<Draft | null>(null);
  const [docType, setDocType] = useState<string>(DOC_TYPES[0]);
  // Arriving from "Draft from this" on a reviewed document (Documents page)
  // pre-fills the matter and a starting instruction, same ?query pattern
  // /auth?mode=signup already uses — no validateSearch on this route, so
  // this reads the raw URL rather than a typed search schema.
  const [matterRef, setMatterRef] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("matterRef") ?? "";
  });
  const [instructions, setInstructions] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("instructions") ?? "";
  });
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load()
      .then((rows) => setDrafts(rows as Draft[]))
      .catch(() => setDrafts([]));
    void loadMatters()
      .then((rows) =>
        setMatters(
          (rows as { id: string; title: string }[]).map((m) => ({ id: m.id, title: m.title })),
        ),
      )
      .catch(() => setMatters([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reviewDraft(status: "approved" | "rejected") {
    if (!active) return;
    setActive({ ...active, status });
    setDrafts((prev) => prev.map((d) => (d.id === active.id ? { ...d, status } : d)));
    try {
      await setReviewStatus({ data: { id: active.id, status } });
    } catch {
      void load()
        .then((rows) => setDrafts(rows as Draft[]))
        .catch(() => undefined);
    }
  }

  async function handleGenerate() {
    if (!instructions.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const draft = (await generateDraft({
        docType,
        matterRef: matterRef || undefined,
        instructions,
      })) as Draft;
      setActive(draft);
      setDrafts((prev) => [draft, ...prev]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The draft could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!active) return;
    setSaving(true);
    try {
      await persist({ data: { id: active.id, content: active.content } });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="AI drafting studio"
      subtitle="Generate a first draft, refine it in place, then print or save to the matter"
    >
      {error ? (
        <p className="mb-6 rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr] [&>*]:min-w-0">
        <section className="surface-panel h-fit rounded p-5">
          <h2 className="font-display text-base font-bold">Draft brief</h2>
          <div className="mt-4 space-y-4">
            <label className="block text-sm">
              <span className="text-eyebrow">Document type</span>
              <select
                value={docType}
                onChange={(event) => setDocType(event.target.value)}
                className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
              >
                {DOC_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-eyebrow">Matter</span>
              <select
                value={matterRef}
                onChange={(event) => setMatterRef(event.target.value)}
                className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Not linked</option>
                {matters.map((matter) => (
                  <option key={matter.id} value={matter.title}>
                    {matter.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-eyebrow">Facts &amp; instructions</span>
              <textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                rows={9}
                placeholder="Parties, dates, cause of action, relief sought, tone…"
                className="mt-1.5 w-full rounded border border-input bg-background p-3 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={busy || !instructions.trim()}
              className="flex w-full items-center justify-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Generate draft
            </button>
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <p className="text-eyebrow">Recent drafts</p>
            <div className="mt-3 space-y-1">
              {drafts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No drafts yet.</p>
              ) : (
                drafts.map((draft) => (
                  <button
                    key={draft.id}
                    type="button"
                    onClick={() => setActive(draft)}
                    className="flex w-full items-center gap-2 truncate rounded px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary"
                  >
                    <span className="truncate">
                      {draft.doc_type}
                      {draft.matter_ref ? ` · ${draft.matter_ref}` : ""}
                    </span>
                    <Tag tone={reviewTone[draft.status] ?? "neutral"}>
                      {reviewLabel[draft.status] ?? draft.status}
                    </Tag>
                  </button>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="surface-panel rounded p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold">Draft</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Replace every [bracketed] placeholder and verify all citations before filing.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {active ? (
                <Tag tone={reviewTone[active.status] ?? "neutral"}>
                  {reviewLabel[active.status] ?? active.status}
                </Tag>
              ) : null}
              {active && active.status === "pending_review" ? (
                <>
                  <button
                    type="button"
                    onClick={() => void reviewDraft("approved")}
                    className="flex items-center gap-1 rounded border border-success/40 px-2.5 py-2 text-xs font-medium text-success transition-colors hover:bg-success/10"
                  >
                    <Check className="size-3.5" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void reviewDraft("rejected")}
                    className="flex items-center gap-1 rounded border border-destructive/40 px-2.5 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <X className="size-3.5" />
                    Reject
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={handleSave}
                disabled={!active || saving}
                className="flex items-center gap-2 rounded border border-input px-3 py-2 text-sm font-semibold transition-colors hover:bg-secondary disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={!active}
                className="flex items-center gap-2 rounded border border-input px-3 py-2 text-sm font-semibold transition-colors hover:bg-secondary disabled:opacity-50"
              >
                <Printer className="size-4" />
                Print
              </button>
            </div>
          </div>

          {active ? (
            <article id="dictation-print" className="mt-4 rounded border border-border bg-card p-6">
              <textarea
                value={active.content}
                onChange={(event) => setActive({ ...active, content: event.target.value })}
                rows={24}
                className="w-full resize-y bg-transparent text-sm leading-7 whitespace-pre-wrap outline-none"
              />
            </article>
          ) : (
            <p className="mt-4 flex items-center gap-2 rounded border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
              <FileText className="size-4" />
              Fill the brief on the left and generate a draft to see it here.
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
