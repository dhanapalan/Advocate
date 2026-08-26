import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, History, Loader2, Plus, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { StatCard, Tag, type Tone } from "@/components/app/primitives";
// Calls the Matters/Diary microservices (services/matters/,
// services/diary/) directly — not TanStack server functions, so no
// useServerFn wrapping.
import { listMatters } from "@/lib/matters-service";
import { todayIsoIST } from "@/lib/date-ist";
import {
  createCauseListSource,
  getCauseListFeatureEnabled,
  ingestCauseList,
  listCauseListChangeHistory,
  listCauseListEntries,
  listCauseListSources,
  matchMatterManually,
  rejectCauseListMatch,
  setCauseListSourceEnabled,
} from "@/lib/diary-service";

export const Route = createFileRoute("/_authenticated/app/cause-list")({
  head: () => ({
    meta: [
      { title: "Cause list intelligence — LexDiary" },
      {
        name: "description",
        content:
          "Import a cause list, see what's new or changed since yesterday, and match listings to your matters.",
      },
      { property: "og:title", content: "Cause list intelligence — LexDiary" },
      {
        property: "og:description",
        content: "New and changed cause-list listings, matched to your matters.",
      },
    ],
  }),
  component: CauseListIntelligence,
});

type Source = {
  id: string;
  court: string;
  bench: string | null;
  list_type: string;
  source_type: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_attempt_at: string | null;
  sync_status: string;
  error_message: string | null;
  created_at: string;
};

type Entry = Awaited<ReturnType<typeof listCauseListEntries>>["entries"][number];
type MatterOption = { id: string; title: string };

const syncStatusTone: Record<string, Tone> = {
  never_run: "neutral",
  success: "success",
  failed: "danger",
  partial: "warning",
};

const matchStatusLabel: Record<string, string> = {
  matched: "Matched",
  needs_review: "Needs review",
  unmatched: "Unmatched",
  rejected: "Rejected",
};
const matchStatusTone: Record<string, Tone> = {
  matched: "success",
  needs_review: "warning",
  unmatched: "neutral",
  rejected: "danger",
};

function todayIso() {
  return todayIsoIST();
}

function CauseListIntelligence() {
  const loadSources = listCauseListSources;
  const addSource = createCauseListSource;
  const toggleSource = setCauseListSourceEnabled;
  const loadEntries = listCauseListEntries;
  const loadMatters = listMatters;
  const runIngest = ingestCauseList;
  const doMatch = matchMatterManually;
  const doReject = rejectCauseListMatch;
  const loadHistory = listCauseListChangeHistory;
  const loadFeatureStatus = getCauseListFeatureEnabled;

  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [sources, setSources] = useState<Source[]>([]);
  const [matters, setMatters] = useState<MatterOption[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    newOrChanged: 0,
    removed: 0,
    matched: 0,
    needsReview: 0,
    conflicts: 0,
  });
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [listDate, setListDate] = useState(todayIso());
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "matched" | "needs_review" | "unmatched"
  >("all");

  const [showAddSource, setShowAddSource] = useState(false);
  const [newSource, setNewSource] = useState({ court: "", bench: "", listType: "daily" as const });
  const [creatingSource, setCreatingSource] = useState(false);

  const [importSourceId, setImportSourceId] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [importing, setImporting] = useState(false);

  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<
    Awaited<ReturnType<typeof listCauseListChangeHistory>>
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [matterPickerFor, setMatterPickerFor] = useState<string | null>(null);
  const [matterChoice, setMatterChoice] = useState("");
  const [matching, setMatching] = useState(false);

  async function reloadSources() {
    try {
      const rows = (await loadSources()) as Source[];
      setSources(rows);
      if (!importSourceId && rows.length > 0) setImportSourceId(rows[0]!.id);
    } catch {
      setSources([]);
    }
  }

  async function reloadEntries() {
    setLoadingEntries(true);
    setError(null);
    try {
      const result = await loadEntries({ date: listDate });
      setEntries(result.entries as Entry[]);
      setSummary(result.summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load the cause list.");
    } finally {
      setLoadingEntries(false);
    }
  }

  useEffect(() => {
    void loadFeatureStatus()
      .then((result) => setFeatureEnabled(result.enabled))
      .catch(() => setFeatureEnabled(true));
    void reloadSources();
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
    void reloadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listDate]);

  async function handleAddSource(event: React.FormEvent) {
    event.preventDefault();
    if (!newSource.court.trim()) return;
    setCreatingSource(true);
    try {
      await addSource({
        court: newSource.court.trim(),
        bench: newSource.bench.trim() || undefined,
        listType: newSource.listType,
      });
      setNewSource({ court: "", bench: "", listType: "daily" });
      setShowAddSource(false);
      await reloadSources();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to add source.");
    } finally {
      setCreatingSource(false);
    }
  }

  async function handleToggleSource(id: string, enabled: boolean) {
    try {
      await toggleSource({ id, enabled });
      await reloadSources();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to update the source.");
    }
  }

  async function handleImport() {
    if (!importSourceId || !pastedText.trim()) return;
    setImporting(true);
    try {
      const result = await runIngest({ sourceId: importSourceId, listDate, pastedText });
      const bits = [
        `${result.newCount} new`,
        `${result.changedCount} changed`,
        `${result.removedCount} removed`,
        `${result.matchedCount} matched`,
        `${result.needsReviewCount} need review`,
      ];
      toast.success(`Imported ${result.totalRows} listings — ${bits.join(", ")}.`);
      if (result.parseErrors.length > 0) {
        toast.warning(`${result.parseErrors.length} row(s) could not be parsed and were skipped.`);
      }
      setPastedText("");
      await Promise.all([reloadSources(), reloadEntries()]);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function openHistory(entry: Entry) {
    setHistoryFor(entry.recordId);
    setHistoryLoading(true);
    try {
      const rows = await loadHistory({
        sourceId: entry.sourceId,
        sourceReference: entry.sourceReference,
      });
      setHistoryRows(rows);
    } catch {
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function confirmMatch(entry: Entry) {
    if (!entry.match || !matterChoice) return;
    setMatching(true);
    try {
      await doMatch({ matchId: entry.match.id, matterId: matterChoice });
      toast.success("Matched to matter.");
      setMatterPickerFor(null);
      setMatterChoice("");
      await reloadEntries();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not match this listing.");
    } finally {
      setMatching(false);
    }
  }

  async function handleReject(entry: Entry) {
    if (!entry.match) return;
    try {
      await doReject({ matchId: entry.match.id });
      await reloadEntries();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not update this listing.");
    }
  }

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (scope === "mine" && e.match?.status !== "matched") return false;
      if (statusFilter !== "all" && (e.match?.status ?? "unmatched") !== statusFilter) return false;
      return true;
    });
  }, [entries, scope, statusFilter]);

  return (
    <AppShell
      title="Cause list intelligence"
      subtitle="Import a cause list, see what changed since it was last published, and match listings to your matters"
    >
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Listings" value={String(summary.total)} />
        <StatCard label="New / changed" value={String(summary.newOrChanged)} />
        <StatCard label="Removed" value={String(summary.removed)} />
        <StatCard label="Matched" value={String(summary.matched)} />
        <StatCard label="Needs review" value={String(summary.needsReview)} />
        <StatCard label="Conflicts" value={String(summary.conflicts)} />
      </div>

      {!featureEnabled ? (
        <p className="surface-panel mb-6 rounded p-4 text-sm text-muted-foreground">
          Cause List Intelligence is turned off for this chamber by your workspace administrator.
          Listings already imported and matched below stay visible.
        </p>
      ) : (
        <>
          <section className="surface-panel mb-6 rounded p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-base font-bold">Sources</h2>
              <button
                type="button"
                onClick={() => setShowAddSource((v) => !v)}
                className="flex items-center gap-1.5 rounded border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
              >
                <Plus className="size-3.5" />
                Add source
              </button>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              A source is one court/bench you track a cause list for. No live court integration is
              connected — every import here is a list you paste in yourself, from whatever you
              already have (a court PDF, a clerk's list, a spreadsheet).
            </p>

            {showAddSource ? (
              <form
                onSubmit={handleAddSource}
                className="mt-4 grid gap-3 rounded border border-dashed border-border p-3 sm:grid-cols-3"
              >
                <label className="text-sm">
                  <span className="text-eyebrow">Court</span>
                  <input
                    value={newSource.court}
                    onChange={(e) => setNewSource((s) => ({ ...s, court: e.target.value }))}
                    placeholder="Delhi High Court"
                    className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-eyebrow">Bench (optional)</span>
                  <input
                    value={newSource.bench}
                    onChange={(e) => setNewSource((s) => ({ ...s, bench: e.target.value }))}
                    placeholder="Court 4, Justice Sharma"
                    className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={creatingSource || !newSource.court.trim()}
                    className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-ink disabled:opacity-60"
                  >
                    {creatingSource ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    Save
                  </button>
                </div>
              </form>
            ) : null}

            {sources.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No sources yet — add the court/bench you want to track above.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {sources.map((source) => (
                  <li
                    key={source.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        {source.court}
                        {source.bench ? ` · ${source.bench}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {source.last_sync_at
                          ? `Last successful import: ${new Date(source.last_sync_at).toLocaleString("en-IN")}`
                          : "Never imported"}
                        {source.error_message ? ` · ${source.error_message}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Tag tone={syncStatusTone[source.sync_status] ?? "neutral"}>
                        {source.sync_status.replace("_", " ")}
                      </Tag>
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={source.enabled}
                          onChange={(e) => void handleToggleSource(source.id, e.target.checked)}
                          className="size-3.5 rounded border-input"
                        />
                        Enabled
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface-panel mb-6 rounded p-5">
            <h2 className="font-display text-base font-bold">Import a cause list</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              One listing per line, columns separated by a tab or <code>|</code>: serial number,
              case number, CNR, petitioner, respondent, advocates, stage, court hall. Trailing
              columns are optional.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                <span className="text-eyebrow">Source</span>
                <select
                  value={importSourceId}
                  onChange={(e) => setImportSourceId(e.target.value)}
                  className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                >
                  {sources.length === 0 ? <option value="">Add a source first</option> : null}
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.court}
                      {s.bench ? ` · ${s.bench}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-eyebrow">List date</span>
                <input
                  type="date"
                  value={listDate}
                  onChange={(e) => setListDate(e.target.value)}
                  className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
            </div>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              rows={6}
              placeholder="1	WP(C) 1234/2024	DLHC010012342024	Ramesh Kumar	State of Delhi	Adv. Priya Nair	Arguments	Hall 4"
              className="mt-3 w-full rounded border border-input bg-background p-3 font-mono text-xs"
            />
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || !importSourceId || !pastedText.trim()}
              className="mt-3 flex items-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink disabled:opacity-50"
            >
              {importing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Import list
            </button>
          </section>
        </>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={listDate}
            onChange={(e) => setListDate(e.target.value)}
            className="rounded border border-input bg-background px-3 py-1.5 text-sm"
          />
          <div className="flex rounded border border-input p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`rounded px-3 py-1 ${scope === "all" ? "bg-primary text-primary-foreground" : ""}`}
            >
              All listings
            </button>
            <button
              type="button"
              onClick={() => setScope("mine")}
              className={`rounded px-3 py-1 ${scope === "mine" ? "bg-primary text-primary-foreground" : ""}`}
            >
              My matters
            </button>
          </div>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="matched">Matched</option>
          <option value="needs_review">Needs review</option>
          <option value="unmatched">Unmatched</option>
        </select>
      </div>

      {error ? (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loadingEntries ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filteredEntries.length === 0 ? (
        <p className="surface-panel rounded p-5 text-sm text-muted-foreground">
          No listings for {new Date(listDate + "T00:00:00").toLocaleDateString("en-IN")} yet —
          import a cause list above.
        </p>
      ) : (
        <ul className="space-y-3">
          {filteredEntries.map((entry) => (
            <li
              key={entry.recordId}
              className={`surface-panel rounded p-4 ${entry.isRemoved ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {entry.serialNumber ? (
                      <span className="text-xs font-medium text-muted-foreground">
                        #{entry.serialNumber}
                      </span>
                    ) : null}
                    <p className="text-sm font-semibold">
                      {entry.petitioner ?? "—"}
                      {entry.respondent ? ` vs ${entry.respondent}` : ""}
                    </p>
                    {entry.isRemoved ? (
                      <Tag tone="neutral">Removed from list</Tag>
                    ) : entry.hasChangedToday ? (
                      <Tag tone="accent">Changed</Tag>
                    ) : null}
                    {entry.hasConflict ? (
                      <Tag tone="danger">
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="size-3" />
                          Potential conflict
                        </span>
                      </Tag>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.caseNumber ?? "No case number"}
                    {entry.cnr ? ` · CNR ${entry.cnr}` : ""}
                    {entry.courtHall ? ` · ${entry.courtHall}` : ""}
                    {entry.stage ? ` · ${entry.stage}` : ""}
                  </p>
                  {entry.match?.matterTitle ? (
                    <p className="mt-1 text-xs font-medium text-accent">
                      Matched to {entry.match.matterTitle}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Tag tone={matchStatusTone[entry.match?.status ?? "unmatched"]}>
                    {matchStatusLabel[entry.match?.status ?? "unmatched"]}
                  </Tag>
                  {entry.match?.method && entry.match.status !== "unmatched" ? (
                    <span className="text-[11px] text-muted-foreground">
                      via {entry.match.method}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {entry.match?.matterTitle ? (
                  <Link
                    to="/app/cases"
                    search={{ q: entry.match.matterTitle }}
                    className="rounded border border-input px-2 py-1 font-medium transition-colors hover:bg-secondary"
                  >
                    Open matter
                  </Link>
                ) : null}
                {entry.hearingId ? (
                  <Link
                    to="/app/diary"
                    className="rounded border border-input px-2 py-1 font-medium transition-colors hover:bg-secondary"
                  >
                    View hearing
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => void openHistory(entry)}
                  className="flex items-center gap-1 rounded border border-input px-2 py-1 font-medium transition-colors hover:bg-secondary"
                >
                  <History className="size-3.5" />
                  Change history
                  <ChevronDown className="size-3" />
                </button>
                {entry.match?.status !== "matched" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setMatterPickerFor(
                          matterPickerFor === entry.recordId ? null : entry.recordId,
                        );
                        setMatterChoice("");
                      }}
                      className="flex items-center gap-1 rounded border border-input px-2 py-1 font-medium transition-colors hover:bg-secondary"
                    >
                      <Check className="size-3.5" />
                      Match matter
                    </button>
                    {entry.match?.status === "needs_review" ? (
                      <button
                        type="button"
                        onClick={() => void handleReject(entry)}
                        className="flex items-center gap-1 rounded border border-destructive/40 px-2 py-1 font-medium text-destructive transition-colors hover:bg-destructive/10"
                      >
                        <X className="size-3.5" />
                        Not a match
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>

              {matterPickerFor === entry.recordId ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-dashed border-border p-2.5">
                  <select
                    value={matterChoice}
                    onChange={(e) => setMatterChoice(e.target.value)}
                    className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Choose a matter…</option>
                    {matters.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!matterChoice || matching}
                    onClick={() => void confirmMatch(entry)}
                    className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {matching ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Confirm match
                  </button>
                </div>
              ) : null}

              {historyFor === entry.recordId ? (
                <div className="mt-3 rounded border border-border bg-secondary/40 p-3 text-xs">
                  {historyLoading ? (
                    <p className="text-muted-foreground">Loading history…</p>
                  ) : historyRows.length === 0 ? (
                    <p className="text-muted-foreground">No change history recorded yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {historyRows.map((h) => (
                        <li key={h.id}>
                          <span className="font-medium">{h.change_type.replace("_", " ")}</span>
                          {h.field_name ? (
                            <>
                              {" — "}
                              {h.old_value ?? "—"} → {h.new_value ?? "—"}
                            </>
                          ) : null}
                          <span className="ml-2 text-muted-foreground">
                            {new Date(h.detected_at).toLocaleString("en-IN")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
