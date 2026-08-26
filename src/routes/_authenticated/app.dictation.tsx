import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  Loader2,
  FileSignature,
  Printer,
  Sparkles,
  RotateCcw,
  Check,
  Save,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Tag, type Tone } from "@/components/app/primitives";
import { formatDictation, transcribeDictation } from "@/lib/edge-functions";
// Calls the Matters/Drafting microservices (services/matters/,
// services/drafting/) directly — not TanStack server functions, so no
// useServerFn wrapping.
import { listMatters } from "@/lib/matters-service";
import { listDrafts, saveDictatedDraft } from "@/lib/drafting-service";
import { blobToBase64, startRecording, type Recorder } from "@/lib/wav-recorder";
import { cn } from "@/lib/utils";

type DictatedDraft = {
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

export const Route = createFileRoute("/_authenticated/app/dictation")({
  head: () => ({
    meta: [
      { title: "Voice dictation — LexDiary" },
      {
        name: "description",
        content:
          "Dictate notes, drafts and case briefs by voice, convert speech to text, review the formatted draft and print it from your chamber workspace.",
      },
      { property: "og:title", content: "Voice dictation — LexDiary" },
      {
        property: "og:description",
        content:
          "Record, transcribe, format and print legal drafts using voice dictation built for Indian advocates.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dictation,
});

const STEPS = [
  { key: "record", label: "Listen", hint: "Dictate into the mic" },
  { key: "transcribe", label: "Convert to text", hint: "Speech recognised" },
  { key: "review", label: "Review & format", hint: "Clean up the draft" },
  { key: "print", label: "Ready to print", hint: "Export the final copy" },
] as const;

const DOC_TYPES = [
  "Case note",
  "Legal notice",
  "Written statement",
  "Bail application",
  "Client advice letter",
  "Hearing minutes",
] as const;

const LANGUAGES = [
  { value: "auto", label: "Auto detect" },
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "mr", label: "Marathi" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "kn", label: "Kannada" },
  { value: "ml", label: "Malayalam" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

function Dictation() {
  const loadMatters = listMatters;
  const loadDrafts = listDrafts;
  const persistDictation = saveDictatedDraft;

  const [step, setStep] = useState<StepKey>("record");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState<"transcribe" | "format" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState("");
  const [docType, setDocType] = useState<string>(DOC_TYPES[0]);
  const [language, setLanguage] = useState<string>("auto");
  const [matter, setMatter] = useState("");
  const [matters, setMatters] = useState<MatterOption[]>([]);
  const [recentDictations, setRecentDictations] = useState<DictatedDraft[]>([]);

  const recorderRef = useRef<Recorder | null>(null);

  useEffect(() => {
    void loadMatters()
      .then((rows) =>
        setMatters(
          (rows as { id: string; title: string }[]).map((m) => ({ id: m.id, title: m.title })),
        ),
      )
      .catch(() => setMatters([]));
    void refreshRecentDictations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshRecentDictations() {
    try {
      const rows = (await loadDrafts()) as DictatedDraft[];
      setRecentDictations(rows.filter((row) => row.instructions === "(Dictated)"));
    } catch {
      setRecentDictations([]);
    }
  }

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setSeconds((s) => s + 1);
      setLevel(recorderRef.current?.level() ?? 0);
    }, 500);
    return () => window.clearInterval(timer);
  }, [recording]);

  async function handleStart() {
    setError(null);
    try {
      recorderRef.current = await startRecording();
      setSeconds(0);
      setRecording(true);
      setStep("record");
    } catch {
      setError("Microphone access is needed to dictate. Allow it in your browser and try again.");
    }
  }

  async function handleStop() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setRecording(false);
    recorderRef.current = null;
    setBusy("transcribe");
    setStep("transcribe");
    try {
      const blob = await recorder.stop();
      const audioBase64 = await blobToBase64(blob);
      const result = await transcribeDictation({ audioBase64, language });
      if (!result.text) {
        setError("Nothing was recognised in that recording. Please dictate again.");
        setStep("record");
        return;
      }
      setTranscript(result.text);
      setStep("review");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transcription failed.");
      setStep("record");
    } finally {
      setBusy(null);
    }
  }

  async function handleFormat() {
    if (!transcript.trim()) return;
    setBusy("format");
    setError(null);
    setSaved(false);
    try {
      const result = await formatDictation({
        transcript,
        style: docType,
        matter: matter || undefined,
      });
      setDraft(result.text);
      setStep("print");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Formatting failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveDictation() {
    if (!draft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await persistDictation({ docType, matterRef: matter || undefined, content: draft });
      setSaved(true);
      await refreshRecentDictations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the dictation.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setTranscript("");
    setDraft("");
    setSeconds(0);
    setError(null);
    setSaved(false);
    setStep("record");
  }

  function loadRecentDictation(item: DictatedDraft) {
    setDraft(item.content);
    setDocType(item.doc_type);
    setMatter(item.matter_ref ?? "");
    setStep("print");
    setSaved(true);
  }

  const activeIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <AppShell
      title="Voice dictation"
      subtitle="Dictate, transcribe, review and print — without touching the keyboard"
      action={
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-2 rounded border border-input px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
        >
          <RotateCcw className="size-4" />
          New dictation
        </button>
      }
    >
      <ol className="surface-panel mb-6 grid gap-3 rounded p-4 sm:grid-cols-4">
        {STEPS.map((item, index) => (
          <li key={item.key} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                index < activeIndex && "bg-success/15 text-success",
                index === activeIndex && "bg-primary text-primary-foreground",
                index > activeIndex && "bg-secondary text-muted-foreground",
              )}
            >
              {index < activeIndex ? <Check className="size-3.5" /> : index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.hint}</p>
            </div>
          </li>
        ))}
      </ol>

      {error ? (
        <p className="mb-6 rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr] [&>*]:min-w-0">
        <section className="surface-panel rounded p-5">
          <h2 className="font-display text-base font-bold">1 · Listen</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Say “new paragraph”, “comma” or “full stop” as you dictate — they are applied while
            formatting.
          </p>

          <div className="mt-5 flex flex-col items-center gap-3 rounded bg-secondary/50 p-5">
            <button
              type="button"
              onClick={recording ? handleStop : handleStart}
              disabled={busy !== null}
              className={cn(
                "flex size-16 items-center justify-center rounded-full text-primary-foreground transition-transform disabled:opacity-60",
                recording ? "bg-destructive" : "bg-primary hover:bg-ink",
              )}
              style={
                recording ? { transform: `scale(${1 + Math.min(level, 1) * 0.18})` } : undefined
              }
              aria-label={recording ? "Stop dictation" : "Start dictation"}
            >
              {recording ? <Square className="size-5" /> : <Mic className="size-6" />}
            </button>
            <p className="font-mono text-sm">
              {String(Math.floor(seconds / 120)).padStart(2, "0")}:
              {String(Math.floor(seconds / 2) % 60).padStart(2, "0")}
            </p>
            <Tag tone={recording ? "danger" : busy === "transcribe" ? "warning" : "neutral"}>
              {recording ? "Listening" : busy === "transcribe" ? "Converting to text" : "Idle"}
            </Tag>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block text-sm">
              <span className="text-eyebrow">Dictation language</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
              >
                {LANGUAGES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
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
              <span className="text-eyebrow">Link to matter (optional)</span>
              <select
                value={matter}
                onChange={(event) => setMatter(event.target.value)}
                className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Not linked</option>
                {matters.map((m) => (
                  <option key={m.id} value={m.title}>
                    {m.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <p className="text-eyebrow">Recent dictations</p>
            <div className="mt-3 space-y-1">
              {recentDictations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No saved dictations yet.</p>
              ) : (
                recentDictations.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => loadRecentDictation(item)}
                    className="flex w-full items-center gap-2 truncate rounded px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary"
                  >
                    <span className="truncate">
                      {item.doc_type}
                      {item.matter_ref ? ` · ${item.matter_ref}` : ""}
                    </span>
                    <Tag tone={reviewTone[item.status] ?? "neutral"}>
                      {reviewLabel[item.status] ?? item.status}
                    </Tag>
                  </button>
                ))
              )}
            </div>
          </div>
        </section>

        <div className="space-y-6">
          <section className="surface-panel rounded p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold">2 · Review the transcript</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Correct names, sections and citations before formatting.
                </p>
              </div>
              <button
                type="button"
                onClick={handleFormat}
                disabled={!transcript.trim() || busy !== null}
                className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink disabled:opacity-50"
              >
                {busy === "format" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Format draft
              </button>
            </div>
            <textarea
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              rows={8}
              placeholder="Your dictation appears here once transcribed…"
              className="mt-4 w-full rounded border border-input bg-background p-3 font-mono text-sm leading-relaxed"
            />
          </section>

          <section className="surface-panel rounded p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold">3 · Ready for printing</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Formatted as a {docType.toLowerCase()} — edit freely, then print.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveDictation}
                  disabled={!draft.trim() || saving}
                  className="flex items-center gap-2 rounded border border-input px-4 py-2 text-sm font-semibold transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  {saved ? "Saved" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={!draft.trim()}
                  className="flex items-center gap-2 rounded border border-input px-4 py-2 text-sm font-semibold transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  <Printer className="size-4" />
                  Print
                </button>
              </div>
            </div>

            {draft.trim() ? (
              <article
                id="dictation-print"
                className="mt-4 rounded border border-border bg-card p-6"
              >
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={16}
                  className="w-full resize-y bg-transparent text-sm leading-7 whitespace-pre-wrap outline-none"
                />
              </article>
            ) : (
              <p className="mt-4 flex items-center gap-2 rounded border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                <FileSignature className="size-4" />
                The print-ready draft will appear here after formatting.
              </p>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
