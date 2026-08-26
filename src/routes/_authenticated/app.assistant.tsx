import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Plus, Send, Trash2, User } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { confirmPermanentRemoval } from "@/lib/confirm";
import { Markdown } from "@/components/app/Markdown";
import { deleteConversation, listConversations, listMessages } from "@/lib/ai.functions";
import { askAssistant } from "@/lib/edge-functions";
// Calls the Matters microservice (services/matters/) directly — not a
// TanStack server function, so no useServerFn wrapping.
import { listMatters } from "@/lib/matters-service";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/assistant")({
  head: () => ({
    meta: [
      { title: "AI case assistant — LexDiary" },
      {
        name: "description",
        content:
          "Ask an AI legal associate about your matters, procedure, limitation and next steps, with every conversation saved to your chamber account.",
      },
      { property: "og:title", content: "AI case assistant — LexDiary" },
      {
        property: "og:description",
        content:
          "An AI associate for Indian advocates: matter questions, procedure and next steps.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Assistant,
});

type Thread = { id: string; title: string; matter_ref: string | null; updated_at: string };
type Message = { id: string; role: string; content: string };
type MatterOption = { id: string; title: string };

const SUGGESTIONS = [
  "What must I file before the next hearing in this matter?",
  "Summarise the limitation position for a first appeal from a decree.",
  "Draft the points for arguments on an interim injunction.",
  "What documents should I collect from the client for a bail application?",
];

function Assistant() {
  const loadThreads = useServerFn(listConversations);
  const loadMessages = useServerFn(listMessages);
  const removeThread = useServerFn(deleteConversation);
  const loadMatters = listMatters;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [matterRef, setMatterRef] = useState("");
  const [matters, setMatters] = useState<MatterOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void loadThreads()
      .then(setThreads)
      .catch(() => setThreads([]));
    void loadMatters()
      .then((rows) =>
        setMatters(
          (rows as { id: string; title: string }[]).map((m) => ({ id: m.id, title: m.title })),
        ),
      )
      .catch(() => setMatters([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    void loadMessages({ data: { conversationId: activeId } })
      .then((rows) => setMessages(rows as Message[]))
      .catch(() => setMessages([]));
  }, [activeId, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user", content: question },
    ]);
    try {
      const result = await askAssistant({
        conversationId: activeId,
        question,
        matterRef: matterRef || undefined,
      });
      setActiveId(result.conversationId);
      setMessages((prev) => [
        ...prev,
        { id: `local-a-${Date.now()}`, role: "assistant", content: result.answer },
      ]);
      setThreads(await loadThreads());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The assistant could not answer.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, title: string) {
    if (
      !confirmPermanentRemoval(`the conversation "${title}"`, "Its messages are deleted with it.")
    )
      return;
    await removeThread({ data: { conversationId: id } });
    if (activeId === id) setActiveId(null);
    setThreads(await loadThreads());
  }

  return (
    <AppShell
      title="AI case assistant"
      subtitle="Ask about procedure, limitation, strategy and next steps — grounded in your matter context"
      action={
        <button
          type="button"
          onClick={() => {
            setActiveId(null);
            setMessages([]);
          }}
          className="flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink"
        >
          <Plus className="size-4" />
          New chat
        </button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[260px_1fr] [&>*]:min-w-0">
        <aside className="surface-panel h-fit rounded p-4">
          <p className="text-eyebrow">Conversations</p>
          <div className="mt-3 space-y-1">
            {threads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No conversations yet.</p>
            ) : (
              threads.map((thread) => (
                <div key={thread.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveId(thread.id)}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary",
                      activeId === thread.id && "bg-secondary font-medium",
                    )}
                  >
                    {thread.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(thread.id, thread.title ?? "Untitled")}
                    aria-label={`Delete ${thread.title}`}
                    className="rounded p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          <label className="mt-5 block text-sm">
            <span className="text-eyebrow">Matter context</span>
            <select
              value={matterRef}
              onChange={(event) => setMatterRef(event.target.value)}
              className="mt-1.5 w-full rounded border border-input bg-background px-2.5 py-2 text-sm"
            >
              <option value="">No specific matter</option>
              {matters.map((matter) => (
                <option key={matter.id} value={matter.title}>
                  {matter.title}
                </option>
              ))}
            </select>
          </label>
        </aside>

        <section className="surface-panel flex min-h-[560px] flex-col rounded p-5">
          <div className="flex-1 space-y-5 overflow-y-auto">
            {messages.length === 0 ? (
              <div>
                <h2 className="font-display text-base font-bold">How can I help in chambers?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick a matter on the left for context, then ask anything. Always verify citations
                  before filing.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="rounded border border-border px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <article key={message.id} className="flex gap-3">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      message.role === "assistant"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-foreground",
                    )}
                  >
                    {message.role === "assistant" ? (
                      <Bot className="size-4" />
                    ) : (
                      <User className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    {message.role === "assistant" ? (
                      <Markdown content={message.content} />
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {message.content}
                      </p>
                    )}
                  </div>
                </article>
              ))
            )}
            {busy ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Thinking through the position…
              </p>
            ) : null}
            <div ref={endRef} />
          </div>

          {error ? (
            <p className="mt-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
            className="mt-5 flex items-end gap-2 border-t border-border pt-4"
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              rows={2}
              placeholder="Ask about this matter, procedure or drafting…"
              className="min-w-0 flex-1 resize-none rounded border border-input bg-background p-3 text-sm"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex items-center gap-2 rounded bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink disabled:opacity-50"
            >
              <Send className="size-4" />
              Ask
            </button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
