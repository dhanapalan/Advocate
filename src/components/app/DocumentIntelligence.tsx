import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Brain, Camera, Check, Loader2, PenLine, Upload, X } from "lucide-react";
import { Tag, type Tone } from "@/components/app/primitives";
import { listDocumentAnalyses, updateDocumentAnalysisStatus } from "@/lib/ai.functions";
import { analyzeDocument, ocrExtract } from "@/lib/edge-functions";
// Calls the Matters microservice (services/matters/) directly — not a
// TanStack server function, so no useServerFn wrapping.
import { listMatters } from "@/lib/matters-service";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type Analysis = {
  id: string;
  name: string;
  matter_ref: string | null;
  doc_kind: string | null;
  summary: string | null;
  parties: unknown;
  key_dates: unknown;
  tags: unknown;
  risk_notes: string | null;
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

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asKeyDates(value: unknown): { date?: string; what?: string }[] {
  return Array.isArray(value)
    ? (value.filter((item) => item && typeof item === "object") as {
        date?: string;
        what?: string;
      }[])
    : [];
}

export function DocumentIntelligence() {
  const load = useServerFn(listDocumentAnalyses);
  const loadMatters = listMatters;
  const setReviewStatus = useServerFn(updateDocumentAnalysisStatus);

  const [items, setItems] = useState<Analysis[]>([]);
  const [matters, setMatters] = useState<MatterOption[]>([]);
  const [name, setName] = useState("");
  const [matterRef, setMatterRef] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load()
      .then((rows) => setItems(rows as Analysis[]))
      .catch(() => setItems([]));
    void loadMatters()
      .then((rows) =>
        setMatters(
          (rows as { id: string; title: string }[]).map((m) => ({ id: m.id, title: m.title })),
        ),
      )
      .catch(() => setMatters([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reviewItem(id: string, status: "approved" | "rejected") {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
    try {
      await setReviewStatus({ data: { id, status } });
    } catch {
      void load()
        .then((rows) => setItems(rows as Analysis[]))
        .catch(() => undefined);
    }
  }

  async function handleFile(file: File) {
    setName(file.name);
    setText(await file.text());
  }

  async function handleScan(file: File) {
    setScanning(true);
    setError(null);
    try {
      const imageBase64 = await fileToBase64(file);
      const { text: scanned } = await ocrExtract({
        imageBase64,
        mimeType: file.type || "image/jpeg",
      });
      if (!scanned) {
        setError(
          "No legible text found in that photo — try again with better lighting or framing.",
        );
        return;
      }
      setText((prev) => (prev ? `${prev}\n\n${scanned}` : scanned));
      if (!name) setName(file.name.replace(/\.[^.]+$/, "") || "Scanned document");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The scan could not be processed.");
    } finally {
      setScanning(false);
    }
  }

  async function handleAnalyze() {
    if (text.trim().length < 20) {
      setError("Paste or upload at least a paragraph of document text to analyse.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = (await analyzeDocument({
        name: name || "Untitled document",
        matterRef: matterRef || undefined,
        text,
      })) as Analysis;
      setItems((prev) => [result, ...prev]);
      setText("");
      setName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The document could not be analysed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-panel mb-6 rounded p-5">
      <div className="flex items-center gap-2">
        <Brain className="size-4 text-accent" />
        <h2 className="font-display text-base font-bold">Document intelligence</h2>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Scan a document with your camera (English, Hindi, Tamil, Telugu, Kannada or Malayalam),
        upload a text extract, or paste document text — AI returns a summary, parties, key dates,
        tags and drafting risks, saved to your account.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr] [&>*]:min-w-0">
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-eyebrow">Document name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="GST Show Cause Notice"
              className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            />
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
          <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary">
            <Upload className="size-4" />
            Upload .txt extract
            <input
              type="file"
              accept=".txt,.md,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary">
            {scanning ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            {scanning ? "Reading scan…" : "Scan document (camera)"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={scanning}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleScan(file);
              }}
            />
          </label>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Brain className="size-4" />}
            Analyse document
          </button>
        </div>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={9}
          placeholder="Paste the document text or OCR output here…"
          className="w-full rounded border border-input bg-background p-3 font-mono text-sm"
        />
      </div>

      {error ? (
        <p className="mt-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="mt-6 space-y-4 border-t border-border pt-4">
          {items.map((item) => (
            <article key={item.id} className="rounded border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{item.name}</h3>
                {item.doc_kind ? <Tag tone="accent">{item.doc_kind}</Tag> : null}
                <Tag tone={reviewTone[item.status] ?? "neutral"}>
                  {reviewLabel[item.status] ?? item.status}
                </Tag>
                {item.matter_ref ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {item.matter_ref.split(" — ")[0]}
                  </span>
                ) : null}
                <div className="ml-auto flex gap-1.5">
                  <Link
                    to="/app/drafting"
                    search={{
                      matterRef: item.matter_ref ?? undefined,
                      instructions: `Draft based on "${item.name}"${item.summary ? `: ${item.summary}` : ""}`,
                    }}
                    className="flex items-center gap-1 rounded border border-input px-2 py-1 text-xs font-medium transition-colors hover:bg-secondary"
                  >
                    <PenLine className="size-3.5" />
                    Draft from this
                  </Link>
                  {item.status === "pending_review" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void reviewItem(item.id, "approved")}
                        className="flex items-center gap-1 rounded border border-success/40 px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success/10"
                      >
                        <Check className="size-3.5" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void reviewItem(item.id, "rejected")}
                        className="flex items-center gap-1 rounded border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                      >
                        <X className="size-3.5" />
                        Reject
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              {item.summary ? <p className="mt-2 text-sm leading-relaxed">{item.summary}</p> : null}

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {asStrings(item.parties).length > 0 ? (
                  <div className="text-sm">
                    <p className="text-eyebrow">Parties</p>
                    <ul className="mt-1 list-inside list-disc text-muted-foreground">
                      {asStrings(item.parties).map((party) => (
                        <li key={party}>{party}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {asKeyDates(item.key_dates).length > 0 ? (
                  <div className="text-sm">
                    <p className="text-eyebrow">Key dates</p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {asKeyDates(item.key_dates).map((entry, index) => (
                        <li key={`${entry.date ?? index}`}>
                          <span className="font-medium text-foreground">{entry.date ?? "—"}</span>{" "}
                          {entry.what ?? ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              {asStrings(item.tags).length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {asStrings(item.tags).map((tag) => (
                    <Tag key={tag} tone="neutral">
                      {tag}
                    </Tag>
                  ))}
                </div>
              ) : null}

              {item.risk_notes ? (
                <p className="mt-3 rounded bg-secondary/60 px-3 py-2 text-sm">
                  <span className="font-semibold">Risks: </span>
                  {item.risk_notes}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
