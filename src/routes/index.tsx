import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Scale,
  CalendarClock,
  FileSearch,
  PenLine,
  Mic,
  Sparkles,
  Users,
  ReceiptIndianRupee,
  WifiOff,
  ArrowRight,
} from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";
import heroImage from "@/assets/hero-advocate.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LexDiary — Practice Management for Indian Advocates" },
      {
        name: "description",
        content:
          "The practice management platform built for Indian advocates. Case and matter tracking, a hearing diary with automatic cause-list matching, Indic OCR with AI document review, an AI case assistant and drafting studio, a client portal and GST-compliant billing — in one secure workspace.",
      },
      {
        property: "og:title",
        content: "LexDiary — Practice Management for Indian Advocates",
      },
      {
        property: "og:description",
        content:
          "Case tracking, hearing diary, cause-list intelligence, an AI case assistant and drafting studio, document vault, client portal and GST billing — the complete practice management platform for Indian legal professionals.",
      },
    ],
  }),
  component: Landing,
});

const capabilities = [
  {
    icon: Scale,
    title: "Case & matter management",
    body: "Replaces the paper case diary or spreadsheet. Case number, court, stage, party details and notes stay in one file, current the moment anything changes.",
    tone: "sapphire",
  },
  {
    icon: CalendarClock,
    title: "Court diary with cause-list intelligence",
    body: "Replaces cross-checking a cause list by hand. Import the day's list and every listing is matched to your matters automatically — a conflict or an unmatched listing is flagged before you leave chambers.",
    tone: "amber",
  },
  {
    icon: FileSearch,
    title: "Documents with Indic OCR & AI review",
    body: "Replaces re-reading a whole file to find one clause. Camera scan, OCR across six Indian languages, then AI extracts a summary, parties and key dates for you to approve.",
    tone: "teal",
  },
  {
    icon: PenLine,
    title: "AI case assistant & drafting studio",
    body: "Replaces starting from a blank page or hunting through old notes for precedent. Ask a question grounded in the matter's own documents and diary, then generate and refine a first draft in the same place.",
    tone: "rose",
  },
  {
    icon: Mic,
    title: "Voice dictation",
    body: "Replaces typing up notes from memory after a hearing. Dictate in the corridor — transcribed, reviewable and ready to print or file, without touching a keyboard.",
    tone: "emerald",
  },
  {
    icon: Sparkles,
    title: "Diary & risk insights",
    body: "Replaces scrolling back through the diary yourself to remember what's overdue. A daily AI briefing built from your chamber's real matters — what needs attention, and why.",
    tone: "violet",
  },
  {
    icon: Users,
    title: "Clients and secure portal",
    body: "Replaces the status-update phone call. Clients see their case status and approved documents themselves, and message you securely when it matters.",
    tone: "sapphire",
  },
  {
    icon: ReceiptIndianRupee,
    title: "Time tracking and GST billing",
    body: "Replaces reconstructing hours at month-end. Time logged as you work, GST invoices generated automatically, UPI and Razorpay collection built in.",
    tone: "amber",
  },
  {
    icon: WifiOff,
    title: "Built for court corridors",
    body: "A fast-loading app shell built for patchy court-corridor signal, with data actions quick enough to finish before your item is called. Full offline data sync is on the roadmap.",
    tone: "teal",
  },
] as const;

// Tailwind needs literal class names to scan for, so each tone's classes are
// spelled out here rather than template-built from the `tone` string.
const toneClasses: Record<(typeof capabilities)[number]["tone"], { chip: string; rule: string }> = {
  sapphire: {
    chip: "bg-docket-sapphire text-docket-sapphire-foreground",
    rule: "bg-docket-sapphire",
  },
  amber: { chip: "bg-docket-amber text-docket-amber-foreground", rule: "bg-docket-amber" },
  teal: { chip: "bg-docket-teal text-docket-teal-foreground", rule: "bg-docket-teal" },
  rose: { chip: "bg-docket-rose text-docket-rose-foreground", rule: "bg-docket-rose" },
  emerald: { chip: "bg-docket-emerald text-docket-emerald-foreground", rule: "bg-docket-emerald" },
  violet: { chip: "bg-docket-violet text-docket-violet-foreground", rule: "bg-docket-violet" },
};

const stats = [
  { value: "3,700+", label: "District & subordinate court complexes" },
  { value: "25", label: "High Courts and benches covered" },
  { value: "9", label: "Modules covering the full matter lifecycle" },
];

function Landing() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main>
        <section className="overflow-hidden border-b border-border bg-brief text-primary-foreground">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-docket-amber px-3 py-1 text-eyebrow text-docket-amber-foreground">
                Practice management · India
              </span>
              <h1 className="mt-6 text-4xl leading-[1.1] font-bold sm:text-5xl">
                A disciplined practice, run from a single workspace.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-primary-foreground/80">
                LexDiary brings matters, your hearing diary, documents, AI-assisted drafting,
                clients and billing together in one platform, purpose-built for how litigation is
                practised in Indian courts — accessible from your phone, wherever the day takes you.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <Link
                  to="/auth"
                  search={{ mode: "signup" }}
                  className="inline-flex items-center gap-2 rounded border border-primary-foreground/25 bg-background px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
                >
                  Start 15-day free trial
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  to="/features"
                  className="inline-flex items-center gap-2 rounded border border-primary-foreground/25 px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10"
                >
                  See all features
                </Link>
              </div>

              <p className="mt-4 text-xs text-primary-foreground/70">
                All features included. No card required.
              </p>

              <dl className="mt-14 grid gap-6 border-t border-primary-foreground/15 pt-8 sm:grid-cols-3">
                {stats.map((stat) => (
                  <div key={stat.label}>
                    <dt className="font-display text-2xl font-bold">{stat.value}</dt>
                    <dd className="mt-1 text-xs leading-snug text-primary-foreground/70">
                      {stat.label}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="relative">
              <div className="absolute -top-8 -right-8 size-40 rounded-full bg-docket-amber/70 blur-3xl" />
              <div className="absolute -bottom-10 -left-10 size-48 rounded-full bg-docket-teal/60 blur-3xl" />
              <img
                src={heroImage}
                alt="Advocate in court robes checking case details on a phone in a high court corridor"
                width={1408}
                height={1008}
                className="relative w-full rounded shadow-lift"
              />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="max-w-2xl">
            <p className="text-eyebrow text-accent">What it replaces</p>
            <h2 className="mt-4 text-3xl font-bold">The manual work, taken off your plate</h2>
            <p className="mt-4 text-muted-foreground">
              Modules designed around the working day of a solo advocate or a small firm — not a
              generic CRM adapted for legal use.{" "}
              <Link
                to="/features"
                className="font-medium text-accent underline-offset-4 hover:underline"
              >
                See what each one replaces
              </Link>
              .
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((item) => {
              const tone = toneClasses[item.tone];
              return (
                <article
                  key={item.title}
                  className="surface-panel overflow-hidden rounded transition-shadow hover:shadow-lift"
                >
                  <div className={`h-1.5 ${tone.rule}`} />
                  <div className="p-7">
                    <span
                      className={`flex size-11 items-center justify-center rounded-lg ${tone.chip}`}
                    >
                      <item.icon className="size-5" />
                    </span>
                    <h3 className="mt-5 font-display text-lg font-bold">{item.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="border-y border-border bg-secondary/60">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="text-eyebrow text-accent">Compliance by design</p>
                <h2 className="mt-4 text-3xl font-bold">Privileged data, treated as privileged</h2>
                <Link
                  to="/security"
                  className="mt-4 inline-flex items-center text-sm font-medium text-accent underline-offset-4 hover:underline"
                >
                  Read the full security page →
                </Link>
              </div>
              <ul className="space-y-6">
                {[
                  {
                    head: "DPDP Act, 2023 aligned",
                    body: "Consent recorded and withdrawable, self-service data access, and account deletion that erases your chamber's records for good.",
                  },
                  {
                    head: "Firm-level isolation",
                    body: "Every query is scoped to your chamber at the database level, enforced independently of the app — so one firm's data is never reachable from another's login.",
                  },
                  {
                    head: "Audit trail on every record",
                    body: "Who opened a matter, who downloaded a document, who changed a hearing outcome — retained and searchable.",
                  },
                  {
                    head: "Bar Council ethics respected",
                    body: "No client solicitation features, no public advertising of results, and confidentiality controls on client-facing sharing.",
                  },
                  {
                    head: "Encrypted, India-hosted",
                    body: "Data is stored in India (Mumbai region). All connections are encrypted in transit, and passwords are never stored in plain text.",
                  },
                  {
                    head: "Security-tested, zero open critical findings",
                    body: "A structured internal security review, live-tested against a running instance across authentication, tenant isolation, IDOR/RBAC, AI cross-tenant leakage, secrets handling and more — every release-blocking category currently clean.",
                  },
                ].map((item) => (
                  <li key={item.head} className="border-l-2 border-accent pl-5">
                    <h3 className="font-display text-base font-bold">{item.head}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="surface-panel relative flex flex-col gap-6 overflow-hidden rounded p-10 sm:flex-row sm:items-center sm:justify-between">
            <div className="absolute inset-x-0 top-0 flex h-1.5">
              <span className="flex-1 bg-docket-sapphire" />
              <span className="flex-1 bg-docket-amber" />
              <span className="flex-1 bg-docket-teal" />
              <span className="flex-1 bg-docket-rose" />
              <span className="flex-1 bg-docket-emerald" />
              <span className="flex-1 bg-docket-violet" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">See the workspace with sample matters</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Explore the dashboard, diary, case file, documents and billing screens with sample
                data — no setup required.
              </p>
            </div>
            <Link
              to="/app"
              className="inline-flex shrink-0 items-center gap-2 rounded bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink"
            >
              Open the workspace
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
