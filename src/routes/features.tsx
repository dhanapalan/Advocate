import { createFileRoute, Link } from "@tanstack/react-router";
import {
  UserPlus,
  Scale,
  FileSearch,
  PenLine,
  Bot,
  CalendarClock,
  Mic,
  Users,
  ReceiptIndianRupee,
  Sparkles,
  ShieldCheck,
  Lock,
  ArrowRight,
} from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: "Features — LexDiary" },
      {
        name: "description",
        content:
          "What each part of LexDiary replaces: the paper register, the blank-page first draft, the WhatsApp status update, the month-end billing scramble. See the manual work it removes, module by module.",
      },
      { property: "og:title", content: "Features — LexDiary" },
      {
        property: "og:description",
        content:
          "Case & matter management, cause-list intelligence, an AI case assistant and drafting studio, Indic OCR with AI document review, client portal, GST billing and audit logs — and the manual work each one removes.",
      },
    ],
  }),
  component: Features,
});

const modules = [
  {
    icon: UserPlus,
    name: "Getting your chamber set up",
    manual:
      "Everyone shares one login, or you're tracking who has access in a WhatsApp message you'll never find again.",
    automatic:
      "Each teammate gets their own login and a role — Advocate, Junior, Clerk or Client — with a Bar Council enrolment number on the profile. Step-up verification kicks in for sensitive actions.",
    tone: "sapphire",
  },
  {
    icon: Scale,
    name: "Tracking a matter",
    manual: "A paper case diary or a spreadsheet, updated whenever someone remembers to.",
    automatic:
      "Case number, court, stage, party details, opposing counsel and case notes stay in one file, current the moment anything changes. e-Courts (CNR) linking is on the roadmap.",
    tone: "amber",
  },
  {
    icon: FileSearch,
    name: "Filing and finding documents",
    manual:
      'Scanning to a folder named "final_v2", then re-reading the whole thing later to find one clause.',
    automatic:
      "Camera scanning with auto-crop, OCR across six Indian languages, and full-text search across everything stored — so a clause is a search, not a re-read. AI extracts a summary, parties, key dates and drafting risks for you to approve or reject before anything is saved. Redact privileged content before you share.",
    tone: "teal",
  },
  {
    icon: PenLine,
    name: "Getting a first draft done",
    manual: "Starting from a blank page, or digging out an old precedent and adapting it by hand.",
    automatic:
      "Generate a first draft grounded in the matter's own documents, refine it in place in the drafting studio, then print or save it straight to the matter.",
    tone: "rose",
  },
  {
    icon: Bot,
    name: "Answering a case question fast",
    manual: "Re-reading your own notes and old orders under time pressure, or phoning a colleague.",
    automatic:
      "Ask the AI case assistant — procedure, limitation, strategy, next steps — answered from this matter's own documents and diary, not the open internet.",
    tone: "emerald",
  },
  {
    icon: CalendarClock,
    name: "Keeping the diary",
    manual: "Cross-checking a cause list by hand to make sure you haven't double-booked a hearing.",
    automatic:
      "Import the day's published cause list and every listing is matched to your matters automatically — what's changed since it was last published, and anything unmatched, is flagged before you leave chambers. WhatsApp reminders are licensed on Solo Pro and Chamber; automated sending is on the roadmap.",
    tone: "violet",
  },
  {
    icon: Mic,
    name: "Capturing notes without typing",
    manual:
      "Typing up notes from memory after a hearing or client call, or not getting to it at all.",
    automatic:
      "Dictate on the way out of court — transcribed, reviewable and ready to print or save to the matter, without touching a keyboard.",
    tone: "sapphire",
  },
  {
    icon: Users,
    name: 'Answering "what\'s the status of my case?"',
    manual:
      "A phone call or a WhatsApp message, every time — often more than once a week, per client.",
    automatic:
      "Clients check status and approved documents themselves in a permission-controlled portal, and message you securely when they actually need to.",
    tone: "amber",
  },
  {
    icon: ReceiptIndianRupee,
    name: "Billing a client",
    manual:
      "Reconstructing hours from memory at month-end, then working out the CGST/SGST split by hand.",
    automatic:
      "Time logs by timer or manual entry against a matter, expenses attached automatically, and a GST-compliant invoice generated with UPI and Razorpay collection built in.",
    tone: "teal",
  },
  {
    icon: Sparkles,
    name: "Staying ahead of the week",
    manual:
      "Scrolling back through the diary and case notes yourself to remember what's overdue or at risk.",
    automatic:
      "A daily AI briefing built from your chamber's real matters and diary — what's overdue, what's coming up, and where the actual risk sits.",
    tone: "rose",
  },
  {
    icon: ShieldCheck,
    name: "Knowing who touched what",
    manual:
      "No real record — if a document goes missing or a hearing outcome changes, it's someone's word.",
    automatic:
      "Every access, download and change is logged to an in-app audit log any owner or admin can search, backed by a structured internal security review covering authentication, tenant isolation, RBAC and AI cross-tenant leakage.",
    tone: "emerald",
  },
  {
    icon: Lock,
    name: "Handling a data-rights request",
    manual:
      "Manually pulling someone's data together across systems whenever they ask — and hoping you got all of it.",
    automatic:
      "Self-service access, correction and erasure for the person asking, consent capture and withdrawal logged automatically, and a documented breach-notification commitment under the DPDP Act.",
    tone: "violet",
  },
] as const;

// Tailwind needs literal class names to scan for, so each tone's classes are
// spelled out here rather than template-built from the `tone` string.
const toneClasses: Record<(typeof modules)[number]["tone"], { chip: string; panel: string }> = {
  sapphire: {
    chip: "bg-docket-sapphire text-docket-sapphire-foreground",
    panel: "bg-docket-sapphire/8",
  },
  amber: { chip: "bg-docket-amber text-docket-amber-foreground", panel: "bg-docket-amber/10" },
  teal: { chip: "bg-docket-teal text-docket-teal-foreground", panel: "bg-docket-teal/8" },
  rose: { chip: "bg-docket-rose text-docket-rose-foreground", panel: "bg-docket-rose/8" },
  emerald: {
    chip: "bg-docket-emerald text-docket-emerald-foreground",
    panel: "bg-docket-emerald/8",
  },
  violet: { chip: "bg-docket-violet text-docket-violet-foreground", panel: "bg-docket-violet/8" },
};

function Features() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-5 py-16">
        <span className="inline-flex items-center gap-2 rounded-full bg-docket-teal px-3 py-1 text-eyebrow text-docket-teal-foreground">
          What it replaces
        </span>
        <h1 className="mt-5 text-4xl font-bold">The manual work LexDiary takes off your plate</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Every module below follows the same shape: what you're doing by hand today, and what
          happens instead once it's in LexDiary. Full e-filing submission, large-firm litigation
          analytics and full accounting sit outside this scope.
        </p>

        <div className="mt-14 space-y-5">
          {modules.map((mod) => {
            const tone = toneClasses[mod.tone];
            return (
              <section key={mod.name} className="surface-panel overflow-hidden rounded">
                <div className="flex items-center gap-3 border-b border-border px-6 py-4 sm:px-8">
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone.chip}`}
                  >
                    <mod.icon className="size-4.5" />
                  </span>
                  <h2 className="font-display text-lg font-bold">{mod.name}</h2>
                </div>
                <div className="grid sm:grid-cols-2">
                  <div className="border-b border-border p-6 sm:border-r sm:border-b-0 sm:p-8">
                    <p className="text-eyebrow text-muted-foreground">Today, by hand</p>
                    <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                      {mod.manual}
                    </p>
                  </div>
                  <div className={`p-6 sm:p-8 ${tone.panel}`}>
                    <p className="text-eyebrow text-foreground">With LexDiary</p>
                    <p className="mt-2.5 text-sm leading-relaxed text-foreground">
                      {mod.automatic}
                    </p>
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <div className="surface-panel relative mt-14 flex flex-col gap-6 overflow-hidden rounded p-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="absolute inset-x-0 top-0 flex h-1.5">
            <span className="flex-1 bg-docket-sapphire" />
            <span className="flex-1 bg-docket-amber" />
            <span className="flex-1 bg-docket-teal" />
            <span className="flex-1 bg-docket-rose" />
            <span className="flex-1 bg-docket-emerald" />
            <span className="flex-1 bg-docket-violet" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">See it against your own week</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Every feature above is unlocked for 15 days, no card required — the fastest way to
              know is to run one real matter through it.
            </p>
          </div>
          <Link
            to="/auth"
            search={{ mode: "signup" }}
            className="inline-flex shrink-0 items-center gap-2 rounded bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink"
          >
            Start free trial
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
