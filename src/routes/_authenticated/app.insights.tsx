import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Markdown } from "@/components/app/Markdown";
import { generateBriefing } from "@/lib/edge-functions";
// Calls the Diary microservice (services/diary/) directly — not a
// TanStack server function, so no useServerFn wrapping.
import { listHearings } from "@/lib/diary-service";
// Calls the Matters microservice (services/matters/) directly — not a
// TanStack server function, so no useServerFn wrapping.
import { listMatters } from "@/lib/matters-service";
import { todayIsoIST } from "@/lib/date-ist";

export const Route = createFileRoute("/_authenticated/app/insights")({
  head: () => ({
    meta: [
      { title: "Diary & risk insights — LexDiary" },
      {
        name: "description",
        content:
          "AI briefing on hearing readiness and today's priorities, generated from your chamber's real matters and diary.",
      },
      { property: "og:title", content: "Diary & risk insights — LexDiary" },
      {
        property: "og:description",
        content: "Daily AI briefing generated from your chamber's real matters and diary.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Insights,
});

type Hearing = {
  id: string;
  matter_title: string;
  court: string | null;
  hearing_date: string;
  hearing_time: string | null;
  purpose: string | null;
  status: string;
};

type Matter = {
  id: string;
  title: string;
  client_name: string | null;
  case_number: string | null;
  court: string | null;
  status: string;
  opposing_party: string | null;
  filed_date: string | null;
};

function todayIso() {
  return todayIsoIST();
}

function buildContext(matters: Matter[], hearings: Hearing[]) {
  const today = todayIso();
  const todaysHearings = hearings.filter((h) => h.hearing_date === today);

  if (matters.length === 0 && hearings.length === 0) {
    return "This chamber has no matters or hearings on record yet. Say so plainly and suggest adding the first matter and hearing.";
  }

  return [
    "Today's hearings:",
    ...(todaysHearings.length
      ? todaysHearings.map(
          (h) =>
            `- ${h.hearing_time ?? "time not set"} · ${h.court ?? "court not set"} · ${h.matter_title} · ${h.purpose ?? "no purpose noted"} · status ${h.status}`,
        )
      : ["- None listed for today."]),
    "",
    "Upcoming hearings (next 14 days):",
    ...hearings
      .filter((h) => h.hearing_date > today)
      .slice(0, 20)
      .map(
        (h) => `- ${h.hearing_date} ${h.hearing_time ?? ""} · ${h.matter_title} · ${h.court ?? ""}`,
      ),
    "",
    "Active matters:",
    ...matters.map(
      (m) =>
        `- ${m.title}${m.case_number ? ` (${m.case_number})` : ""} · ${m.court ?? "court not set"} · status ${m.status}${m.opposing_party ? ` · opposing ${m.opposing_party}` : ""}${m.filed_date ? ` · filed ${m.filed_date}` : ""}`,
    ),
  ].join("\n");
}

function Insights() {
  const loadMatters = listMatters;
  const loadHearings = listHearings;
  const [matters, setMatters] = useState<Matter[]>([]);
  const [hearings, setHearings] = useState<Hearing[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [briefing, setBriefing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const [matterRows, hearingRows] = await Promise.all([loadMatters(), loadHearings()]);
      const m = matterRows as Matter[];
      const h = hearingRows as Hearing[];
      setMatters(m);
      setHearings(h);
      setDataLoaded(true);
      const result = await generateBriefing({ context: buildContext(m, h) });
      setBriefing(result.briefing);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The briefing could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = todayIso();
  const todaysHearings = hearings.filter((h) => h.hearing_date === today);

  return (
    <AppShell
      title="Diary &amp; risk insights"
      subtitle="An AI briefing generated from your chamber's real matters and diary"
      action={
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh briefing
        </button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_300px] [&>*]:min-w-0">
        <section className="surface-panel rounded p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="font-display text-base font-bold">Today's chamber briefing</h2>
          </div>

          {error ? (
            <p className="mt-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {busy && !briefing ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Reviewing your diary and matters…
            </p>
          ) : (
            <Markdown content={briefing} className="mt-4" />
          )}
        </section>

        <aside className="space-y-6">
          <section className="surface-panel rounded p-5">
            <h2 className="font-display text-sm font-bold">Today in court</h2>
            {!dataLoaded ? (
              <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
            ) : todaysHearings.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No hearings listed for today.</p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm">
                {todaysHearings.map((hearing) => (
                  <li key={hearing.id}>
                    <p className="font-semibold">
                      {hearing.hearing_time ?? "Time not set"} · {hearing.matter_title}
                    </p>
                    <p className="text-muted-foreground">
                      {hearing.court ?? "Court not set"}
                      {hearing.purpose ? ` · ${hearing.purpose}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface-panel rounded p-5">
            <h2 className="font-display text-sm font-bold">Chamber snapshot</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {dataLoaded
                ? `${matters.length} matters · ${hearings.length} hearings on record`
                : "Loading…"}
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
