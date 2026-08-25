import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Lock, Database, FileSearch, KeyRound, Users } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security — LexDiary" },
      {
        name: "description",
        content:
          "How LexDiary protects privileged case data: firm-level isolation, encryption in transit, India data residency, DPDP Act alignment, and a structured internal security review across every release-blocking category.",
      },
      { property: "og:title", content: "Security — LexDiary" },
      {
        property: "og:description",
        content:
          "Firm-level isolation, encryption in transit, India data residency, and a structured internal security review — how LexDiary protects privileged case data.",
      },
    ],
  }),
  component: Security,
});

const pillars = [
  {
    icon: Database,
    title: "Firm-level isolation",
    body: "Every query is scoped to your chamber at the database level, enforced independently of the app itself — not just hidden in the UI. One firm's data is never reachable from another firm's login, even by a direct API call bypassing the interface entirely.",
  },
  {
    icon: Lock,
    title: "Encrypted, India-hosted",
    body: "Data is stored in India (Mumbai region). All connections are encrypted in transit, and passwords are never stored in plain text.",
  },
  {
    icon: ShieldCheck,
    title: "Security-tested, zero open critical findings",
    body: "A structured internal security review, live-tested against a running instance — authentication, session management, tenant isolation, object-level authorization (IDOR/RBAC), SQL injection, XSS, AI cross-tenant leakage, Superadmin boundaries, secrets exposure, and more. Every release-blocking category is currently clean.",
  },
  {
    icon: FileSearch,
    title: "No persistent document storage",
    body: "Scanned documents and dictation audio are processed transiently at the point of intake — only the extracted text is ever stored, under the same tenant-isolation guarantees as the rest of your data. There's no file, no URL, nothing to guess.",
  },
  {
    icon: Users,
    title: "Role-based access within your chamber",
    body: "Owner, admin and member roles gate who can invite teammates, change billing, or remove access. Escalation paths — self-promotion, tampering with your own plan — are blocked at the database level, not just the UI.",
  },
  {
    icon: KeyRound,
    title: "DPDP Act, 2023 aligned",
    body: "Consent is recorded and withdrawable, you get self-service access, correction and erasure, and account deletion is a real, permanent deletion — not a deactivation. A documented breach-notification commitment sits behind all of it.",
  },
] as const;

function Security() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="border-b border-border bg-brief text-primary-foreground">
          <div className="mx-auto max-w-3xl px-5 py-16">
            <span className="inline-flex items-center gap-2 rounded-full bg-docket-amber px-3 py-1 text-eyebrow text-docket-amber-foreground">
              Security
            </span>
            <h1 className="mt-6 text-4xl leading-[1.1] font-bold sm:text-5xl">
              Privileged data, treated as privileged.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-primary-foreground/80">
              LexDiary holds case files, client details and privileged notes for advocates across
              India. Here's exactly how that data is protected — no vague assurances, only what's
              actually built and actually tested.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {pillars.map((item) => (
              <article key={item.title} className="surface-panel rounded p-7">
                <span className="flex size-11 items-center justify-center rounded-lg bg-docket-sapphire text-docket-sapphire-foreground">
                  <item.icon className="size-5" />
                </span>
                <h2 className="mt-5 font-display text-lg font-bold">{item.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-secondary/60">
          <div className="mx-auto max-w-3xl px-5 py-16">
            <h2 className="text-2xl font-bold">Where we're still being honest about the gaps</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Our internal review is thorough and live-tested against a running instance — but it's
              internal, not a third-party audit. We haven't yet commissioned an independent
              penetration test, and we'd rather say that plainly than let the word "audited" do more
              work than it's earned. It's on our roadmap as the platform grows. Two low-severity,
              non-blocking items are also tracked openly: no automated login lockout after repeated
              failed attempts yet, and an actual backup-restore drill is still pending a scheduled
              maintenance window.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Questions about a specific control, or need something in writing for your own client
              due diligence?{" "}
              <Link
                to="/contact"
                className="font-medium text-accent underline-offset-4 hover:underline"
              >
                Talk to us
              </Link>
              , or read the full{" "}
              <Link
                to="/privacy"
                className="font-medium text-accent underline-offset-4 hover:underline"
              >
                privacy notice
              </Link>
              .
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
