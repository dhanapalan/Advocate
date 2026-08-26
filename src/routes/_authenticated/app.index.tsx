import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { CourtMorningBrief } from "@/components/app/CourtMorningBrief";
import { DataTable, StatCard, Tag, type Tone } from "@/components/app/primitives";
// Calls the Diary microservice (services/diary/) directly — not a
// TanStack server function, so no useServerFn wrapping.
import { listHearings } from "@/lib/diary-service";
// Calls the Matters microservice (services/matters/) directly — not a
// TanStack server function, so no useServerFn wrapping.
import { listMatters } from "@/lib/matters-service";
// Calls the Billing microservice (services/billing/) directly — not a
// TanStack server function, so no useServerFn wrapping.
import { listInvoices, listTimeEntries } from "@/lib/billing-service";
import { addDaysIso, isoWeekday, todayIsoIST } from "@/lib/date-ist";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({
    meta: [
      { title: "Dashboard — LexDiary" },
      {
        name: "description",
        content: "Today's hearings, billable hours and workload for your chamber, at a glance.",
      },
      { property: "og:title", content: "Dashboard — LexDiary" },
      {
        property: "og:description",
        content: "Today's hearings and billable hours for your chamber, at a glance.",
      },
    ],
  }),
  component: Dashboard,
});

type Matter = { id: string; title: string; status: string };
type Hearing = {
  id: string;
  matter_title: string;
  court: string | null;
  hearing_date: string;
  hearing_time: string | null;
  purpose: string | null;
  status: string;
};
type TimeEntry = {
  id: string;
  matter_title: string;
  entry_date: string;
  task: string;
  hours: number;
  rate: number;
  billed: boolean;
};
type Invoice = { id: string; status: string; amount: number; gst_amount: number };

const statusTone: Record<string, Tone> = {
  confirmed: "success",
  cause_list_awaited: "warning",
  adjourned: "neutral",
  completed: "accent",
};

const statusLabel: Record<string, string> = {
  confirmed: "Confirmed",
  cause_list_awaited: "Cause list awaited",
  adjourned: "Adjourned",
  completed: "Completed",
};

function todayIso() {
  return todayIsoIST();
}

function startOfWeekIso() {
  const today = todayIsoIST();
  const day = isoWeekday(today); // 0 = Sunday
  const diff = (day + 6) % 7; // days since Monday
  return addDaysIso(today, -diff);
}

function endOfWeekIso() {
  return addDaysIso(startOfWeekIso(), 6);
}

function rupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function Dashboard() {
  const loadMatters = listMatters;
  const loadHearings = listHearings;
  const loadTimeEntries = listTimeEntries;
  const loadInvoices = listInvoices;

  const [matters, setMatters] = useState<Matter[]>([]);
  const [hearings, setHearings] = useState<Hearing[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [m, h, t, i] = await Promise.all([
          loadMatters(),
          loadHearings(),
          loadTimeEntries(),
          loadInvoices(),
        ]);
        setMatters(m as Matter[]);
        setHearings(h as Hearing[]);
        setTimeEntries(t as TimeEntry[]);
        setInvoices(i as Invoice[]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to load dashboard data.");
      } finally {
        setLoading(false);
      }
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = todayIso();
  const weekStart = startOfWeekIso();
  const weekEnd = endOfWeekIso();

  const todaysHearings = useMemo(
    () => hearings.filter((h) => h.hearing_date === today),
    [hearings, today],
  );
  const hearingsThisWeek = useMemo(
    () => hearings.filter((h) => h.hearing_date >= weekStart && h.hearing_date <= weekEnd),
    [hearings, weekStart, weekEnd],
  );
  const activeMatters = useMemo(() => matters.filter((m) => m.status === "active"), [matters]);
  const unbilled = useMemo(() => timeEntries.filter((e) => !e.billed), [timeEntries]);
  const unbilledHours = unbilled.reduce((sum, e) => sum + e.hours, 0);
  const unbilledValue = unbilled.reduce((sum, e) => sum + e.hours * e.rate, 0);
  const outstandingInvoices = useMemo(
    () => invoices.filter((inv) => inv.status === "sent" || inv.status === "overdue"),
    [invoices],
  );
  const outstandingValue = outstandingInvoices.reduce(
    (sum, inv) => sum + inv.amount + inv.gst_amount,
    0,
  );
  const overdueCount = invoices.filter((inv) => inv.status === "overdue").length;
  const recentTimeEntries = timeEntries.slice(0, 8);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const iso = addDaysIso(weekStart, i);
      const billed = timeEntries
        .filter((e) => e.entry_date === iso)
        .reduce((sum, e) => sum + e.hours, 0);
      const hearingCount = hearings.filter((h) => h.hearing_date === iso).length;
      return {
        // UTC-anchored: iso is a pure calendar date, so the weekday name
        // must be read from the same UTC-midnight instant, not the
        // viewer's local zone, or it could print the wrong day name.
        day: new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
          weekday: "short",
          timeZone: "UTC",
        }),
        iso,
        billed,
        hearingCount,
      };
    });
  }, [weekStart, timeEntries, hearings]);
  const maxLoad = Math.max(1, ...weekDays.map((d) => d.billed));

  return (
    <AppShell
      title={new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })}
      subtitle={
        loading
          ? "Loading…"
          : `${todaysHearings.length} hearings today · ${activeMatters.length} active matters`
      }
    >
      {error ? (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mb-6">
        <CourtMorningBrief />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
        <StatCard
          label="Active matters"
          value={loading ? "—" : String(activeMatters.length)}
          note={`${matters.length} total`}
          tone="sapphire"
        />
        <StatCard
          label="Hearings this week"
          value={loading ? "—" : String(hearingsThisWeek.length)}
          note={`${todaysHearings.length} today`}
          tone="amber"
        />
        <StatCard
          label="Unbilled hours"
          value={loading ? "—" : unbilledHours.toFixed(1)}
          note={`≈ ${rupees(unbilledValue)} in WIP`}
          tone="teal"
        />
        <StatCard
          label="Outstanding"
          value={loading ? "—" : rupees(outstandingValue)}
          note={`${overdueCount} invoice${overdueCount === 1 ? "" : "s"} overdue`}
          tone="rose"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Today's diary</h2>
            <Link to="/app/diary" className="text-sm text-accent hover:underline">
              Full diary
            </Link>
          </div>
          {loading ? (
            <p className="text-sm text-foreground/70 sm:text-muted-foreground">Loading…</p>
          ) : todaysHearings.length === 0 ? (
            <p className="text-sm text-foreground/70 sm:text-muted-foreground">
              No hearings listed for today.
            </p>
          ) : (
            <DataTable headers={["Time", "Court", "Matter", "Purpose", "Status"]}>
              {todaysHearings.map((hearing) => (
                <tr key={hearing.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    {hearing.hearing_time ?? "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{hearing.court ?? "—"}</td>
                  <td className="px-4 py-3">{hearing.matter_title}</td>
                  <td className="px-4 py-3 text-foreground/70 sm:text-muted-foreground">
                    {hearing.purpose ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Tag tone={statusTone[hearing.status] ?? "neutral"}>
                      {statusLabel[hearing.status] ?? hearing.status}
                    </Tag>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}

          <h2 className="mt-8 mb-3 font-display text-lg font-bold">Recent time entries</h2>
          {loading ? (
            <p className="text-sm text-foreground/70 sm:text-muted-foreground">Loading…</p>
          ) : recentTimeEntries.length === 0 ? (
            <p className="text-sm text-foreground/70 sm:text-muted-foreground">
              No time entries logged yet.
            </p>
          ) : (
            <DataTable headers={["Date", "Matter", "Task", "Hours", "Value"]}>
              {recentTimeEntries.map((entry) => (
                <tr key={entry.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3 whitespace-nowrap">{entry.entry_date}</td>
                  <td className="px-4 py-3 font-mono text-xs">{entry.matter_title}</td>
                  <td className="px-4 py-3">{entry.task}</td>
                  <td className="px-4 py-3">{entry.hours}</td>
                  <td className="px-4 py-3 font-medium">{rupees(entry.hours * entry.rate)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </section>

        <div className="space-y-6">
          <section className="surface-panel rounded p-5">
            <h2 className="font-display text-lg font-bold">This week</h2>
            <p className="mt-1 text-xs text-foreground/70 sm:text-muted-foreground">
              Billable hours recorded per day
            </p>
            {loading ? (
              <p className="mt-5 text-sm text-foreground/70 sm:text-muted-foreground">Loading…</p>
            ) : (
              <ul className="mt-5 space-y-3">
                {weekDays.map((day) => (
                  <li key={day.iso} className="flex items-center gap-3 text-sm">
                    <span className="w-9 text-foreground/70 sm:text-muted-foreground">
                      {day.day}
                    </span>
                    <span className="h-2 flex-1 rounded-full bg-secondary">
                      <span
                        className="block h-2 rounded-full bg-accent"
                        style={{ width: `${(day.billed / maxLoad) * 100}%` }}
                      />
                    </span>
                    <span className="w-14 text-right tabular-nums">{day.billed.toFixed(1)} h</span>
                    <span className="w-16 text-right text-xs text-foreground/70 sm:text-muted-foreground">
                      {day.hearingCount} hrgs
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
