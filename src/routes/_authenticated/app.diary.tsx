import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Tag, type Tone } from "@/components/app/primitives";
// Calls the Diary microservice (services/diary/) directly from the
// browser — not a TanStack server function, so no useServerFn wrapping.
import { createHearing, listHearings, updateHearingStatus } from "@/lib/diary-service";
import { findClashKeys, isClashing } from "@/lib/hearing-conflicts";
import { todayIsoIST } from "@/lib/date-ist";

export const Route = createFileRoute("/_authenticated/app/diary")({
  head: () => ({
    meta: [
      { title: "Court diary — LexDiary" },
      { name: "description", content: "Hearings for your chamber, grouped by date." },
      { property: "og:title", content: "Court diary — LexDiary" },
      { property: "og:description", content: "Hearings for your chamber, grouped by date." },
    ],
  }),
  component: Diary,
});

type Hearing = {
  id: string;
  matter_title: string;
  court: string | null;
  hearing_date: string;
  hearing_time: string | null;
  purpose: string | null;
  status: string;
  created_at: string;
};

const statusLabel: Record<string, string> = {
  confirmed: "Confirmed",
  cause_list_awaited: "Cause list awaited",
  adjourned: "Adjourned",
  completed: "Completed",
};

const statusTone: Record<string, Tone> = {
  confirmed: "success",
  cause_list_awaited: "warning",
  adjourned: "neutral",
  completed: "accent",
};

function todayIso() {
  return todayIsoIST();
}

function Diary() {
  const loadHearings = listHearings;
  const addHearing = createHearing;
  const setStatus = updateHearingStatus;

  const [hearings, setHearings] = useState<Hearing[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    matterTitle: "",
    court: "",
    hearingDate: todayIso(),
    hearingTime: "",
    purpose: "",
  });

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setHearings((await loadHearings()) as Hearing[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load hearings.");
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
    if (!form.matterTitle.trim() || !form.hearingDate) return;
    setCreating(true);
    setError(null);
    try {
      await addHearing({
        matterTitle: form.matterTitle.trim(),
        court: form.court.trim() || undefined,
        hearingDate: form.hearingDate,
        hearingTime: form.hearingTime || undefined,
        purpose: form.purpose.trim() || undefined,
      });
      setForm({
        matterTitle: "",
        court: "",
        hearingDate: todayIso(),
        hearingTime: "",
        purpose: "",
      });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add hearing.");
    } finally {
      setCreating(false);
    }
  }

  async function markStatus(id: string, status: Hearing["status"]) {
    setError(null);
    try {
      await setStatus({
        id,
        status: status as "confirmed" | "cause_list_awaited" | "adjourned" | "completed",
      });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update hearing.");
    }
  }

  const grouped = useMemo(() => {
    const byDate = new Map<string, Hearing[]>();
    for (const h of hearings) {
      const list = byDate.get(h.hearing_date) ?? [];
      list.push(h);
      byDate.set(h.hearing_date, list);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [hearings]);

  const clashKeys = useMemo(() => findClashKeys(hearings), [hearings]);

  const today = todayIso();
  const conflictCount = clashKeys.size;

  return (
    <AppShell
      title="Court diary"
      subtitle={
        loading
          ? "Loading…"
          : `${hearings.length} hearing${hearings.length === 1 ? "" : "s"} on record${conflictCount > 0 ? ` · ${conflictCount} listing conflict${conflictCount > 1 ? "s" : ""} detected` : ""}`
      }
    >
      <form
        onSubmit={handleCreate}
        className="surface-panel mb-6 grid gap-3 rounded p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="text-sm sm:col-span-2 lg:col-span-1">
          <span className="text-eyebrow">Matter</span>
          <input
            value={form.matterTitle}
            onChange={(event) => setForm((f) => ({ ...f, matterTitle: event.target.value }))}
            placeholder="Malhotra v. Sunrise Developers"
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
          <span className="text-eyebrow">Date</span>
          <input
            type="date"
            value={form.hearingDate}
            onChange={(event) => setForm((f) => ({ ...f, hearingDate: event.target.value }))}
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-eyebrow">Time</span>
          <input
            type="time"
            value={form.hearingTime}
            onChange={(event) => setForm((f) => ({ ...f, hearingTime: event.target.value }))}
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-eyebrow">Purpose</span>
          <input
            value={form.purpose}
            onChange={(event) => setForm((f) => ({ ...f, purpose: event.target.value }))}
            className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <div className="flex items-end sm:col-span-2 lg:col-span-5">
          <button
            type="submit"
            disabled={creating || !form.matterTitle.trim() || !form.hearingDate}
            className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-ink disabled:opacity-60"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add hearing
          </button>
        </div>
      </form>

      {error ? (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading hearings…</p>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hearings yet — add your first one above.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([date, items]) => (
            <section key={date} className="surface-panel rounded p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-base font-bold">
                  {new Date(date + "T00:00:00").toLocaleDateString("en-IN", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </h2>
                {date === today ? <Tag tone="accent">Today</Tag> : null}
              </div>
              <ul className="mt-4 space-y-3">
                {items.map((hearing) => {
                  const isClash = isClashing(hearing, clashKeys);
                  return (
                    <li
                      key={hearing.id}
                      className={
                        isClash
                          ? "rounded border-l-2 border-destructive bg-destructive/5 p-3"
                          : "rounded border-l-2 border-accent bg-secondary/50 p-3"
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{hearing.matter_title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {hearing.hearing_time ?? "No time set"} ·{" "}
                            {hearing.court ?? "Court not set"}
                            {hearing.purpose ? ` · ${hearing.purpose}` : ""}
                          </p>
                          {isClash ? (
                            <p className="mt-1 text-xs font-medium text-destructive">
                              Clashes with another hearing at the same time
                            </p>
                          ) : null}
                        </div>
                        <Tag tone={statusTone[hearing.status] ?? "neutral"}>
                          {statusLabel[hearing.status] ?? hearing.status}
                        </Tag>
                      </div>
                      <div className="mt-2 flex gap-2">
                        {(["confirmed", "adjourned", "completed"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => markStatus(hearing.id, s)}
                            className="rounded border border-input px-2.5 py-1 text-xs transition-colors hover:bg-secondary"
                          >
                            {statusLabel[s]}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
