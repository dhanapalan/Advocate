import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, Sparkles } from "lucide-react";
import { askMyCase, type AskCaseSource } from "@/lib/edge-functions";
import { getMatterDocumentTexts, listMatterConversations } from "@/lib/matter-context.functions";
// Calls the AI Assistant microservice (services/assistant/) directly —
// not a TanStack server function, so no useServerFn wrapping.
import { listMessages } from "@/lib/assistant-service";
import type { MatterContext } from "@/lib/matter-context.functions";
import { todayIsoIST } from "@/lib/date-ist";

// K4 — Ask My Case. Grounded strictly in this matter's own MatterContext
// (matter/hearings/cause-list) plus its documents' extracted text, both
// already tenant/RLS-authorized by the time they reach this component —
// nothing here queries the database for anything beyond that. Reuses the
// existing ai_conversations/ai_messages tables (same ones /app/assistant
// uses) rather than a second conversation model.

const SUGGESTED_QUESTIONS = [
  "Summarize this case",
  "What happened at the previous hearing?",
  "What are the important dates?",
  "What changed since the previous hearing?",
];

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: AskCaseSource[];
};

const NEXT_HEARING_RE = /\bnext hearing\b|\bwhen is the next hearing\b|\bupcoming hearing\b/i;

function sourceLabel(source: AskCaseSource): string {
  return `${source.title}`;
}

export function AskMyCase({ context }: { context: MatterContext }) {
  const loadDocumentTexts = useServerFn(getMatterDocumentTexts);
  const loadConversations = useServerFn(listMatterConversations);
  const loadMessages = listMessages;

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!context.askCaseEnabled) return;
    let cancelled = false;
    void loadConversations({ data: { matterId: context.matter.id } })
      .then(async (rows) => {
        if (cancelled) return;
        const latest = (rows as { id: string }[])[0];
        if (!latest) return;
        setConversationId(latest.id);
        const rows2 = (await loadMessages({ conversationId: latest.id })) as {
          id: string;
          role: string;
          content: string;
          sources: AskCaseSource[] | null;
        }[];
        if (cancelled) return;
        setMessages(
          rows2.map((m) => ({
            id: m.id,
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
            sources: m.sources ?? [],
          })),
        );
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause.message : "Could not load this conversation's history.",
        );
      });
    return () => {
      cancelled = true;
    };
    // context.askCaseEnabled / matter.id don't change within a mounted page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const nextHearing = useMemo(() => {
    const today = todayIsoIST();
    return (
      context.hearings.find(
        (h) => h.hearingDate >= today && h.status !== "completed" && h.status !== "adjourned",
      ) ?? null
    );
  }, [context.hearings]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    // Deterministic shortcut — answered directly from already-loaded
    // context, no AI call, no quota spent. See K4 spec's cost-control
    // section: don't invoke the model for a question a reliable existing
    // service can already answer.
    if (NEXT_HEARING_RE.test(trimmed)) {
      const answer = nextHearing
        ? `The next hearing is on ${nextHearing.hearingDate}${nextHearing.hearingTime ? ` at ${nextHearing.hearingTime}` : ""}${nextHearing.purpose ? `, for ${nextHearing.purpose}` : ""}.`
        : "There's no upcoming hearing on record for this matter.";
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}-q`, role: "user", content: trimmed, sources: [] },
        {
          id: `local-${Date.now()}-a`,
          role: "assistant",
          content: answer,
          sources: nextHearing
            ? [
                {
                  sourceType: "hearing",
                  sourceId: nextHearing.id,
                  title: `Hearing scheduled — ${nextHearing.hearingDate}`,
                  date: nextHearing.hearingDate,
                  snippet: nextHearing.purpose,
                },
              ]
            : [],
        },
      ]);
      setQuestion("");
      return;
    }

    setBusy(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}-q`, role: "user", content: trimmed, sources: [] },
    ]);
    setQuestion("");
    try {
      const documents = (await loadDocumentTexts({ data: { matterId: context.matter.id } })) as {
        id: string;
        name: string;
        docKind: string | null;
        rawText: string;
        createdAt: string;
      }[];
      const result = await askMyCase({
        matterId: context.matter.id,
        conversationId,
        question: trimmed,
        today: todayIsoIST(),
        matter: {
          title: context.matter.title,
          caseNumber: context.matter.caseNumber,
          court: context.matter.court,
          status: context.matter.status,
          clientName: context.matter.clientName,
          opposingParty: context.matter.opposingParty,
          filedDate: context.matter.filedDate,
        },
        hearings: context.hearings.map((h) => ({
          id: h.id,
          hearingDate: h.hearingDate,
          hearingTime: h.hearingTime,
          court: h.court,
          purpose: h.purpose,
          status: h.status,
        })),
        causeListEvents: context.causeListEvents.map((c) => ({
          id: c.id,
          recordId: c.recordId,
          changeType: c.changeType,
          fieldName: c.fieldName,
          oldValue: c.oldValue,
          newValue: c.newValue,
          detectedAt: c.detectedAt,
          serialNumber: c.serialNumber,
          courtHall: c.courtHall,
          bench: c.bench,
          stage: c.stage,
        })),
        documents,
      });
      setConversationId(result.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-a`,
          role: "assistant",
          content: result.answer,
          sources: result.sources,
        },
      ]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "I couldn't generate an answer right now. Your case records are still available above.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!context.askCaseEnabled) {
    return (
      <section className="surface-panel rounded p-5">
        <h2 className="font-display text-lg font-bold">Ask My Case</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          AI Case Intelligence is currently unavailable for this chamber.
        </p>
      </section>
    );
  }

  return (
    <section className="surface-panel rounded p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-accent" />
        <h2 className="font-display text-lg font-bold">Ask My Case</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Grounded in this matter's own hearings, cause-list history and documents only — never
        external legal research or advice.
      </p>

      {messages.length === 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void ask(q)}
              className="rounded-full border border-input px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
            >
              {q}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 max-h-[28rem] space-y-4 overflow-y-auto">
          {messages.map((m) =>
            m.role === "user" ? (
              <p key={m.id} className="ml-auto max-w-[85%] rounded bg-secondary px-3 py-2 text-sm">
                {m.content}
              </p>
            ) : (
              <div
                key={m.id}
                className="max-w-[95%] rounded border border-border bg-card px-3 py-2.5"
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
                {m.sources.length > 0 ? (
                  <div className="mt-2 border-t border-border/60 pt-2">
                    <p className="text-eyebrow text-muted-foreground">Sources</p>
                    <ul className="mt-1 space-y-0.5">
                      {m.sources.map((s, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          {sourceLabel(s)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ),
          )}
          {busy ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      )}

      {error ? <p className="mt-3 text-sm text-muted-foreground">{error}</p> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask anything about this case…"
          disabled={busy}
          className="flex-1 rounded border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="flex items-center gap-1.5 rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink disabled:opacity-60"
        >
          <Send className="size-4" />
        </button>
      </form>
    </section>
  );
}
