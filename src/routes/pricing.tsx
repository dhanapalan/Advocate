import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — LexDiary" },
      {
        name: "description",
        content:
          "Start with a 15-day free trial — no card required. Solo plans from ₹2999 a month, Chamber from ₹7999 for two users with extra seats at ₹1999.",
      },
      { property: "og:title", content: "Pricing — LexDiary" },
      {
        property: "og:description",
        content:
          "Solo from ₹2999/month, Solo Pro at ₹3999 with OCR and WhatsApp, Chamber from ₹7999 for two users.",
      },
    ],
  }),
  component: Pricing,
});

// Prices here mirror plan_price_inr() in the database — the licence layer is
// what actually enforces the limits, this page just describes them.
const plans = [
  {
    name: "Solo Basic",
    price: "₹2999",
    cadence: "per month",
    summary: "For a solo advocate who wants the whole practice in one place.",
    features: [
      "One advocate",
      "Up to 50 matters and 50 clients",
      "Court diary with hearing reminders",
      "Time tracking and GST invoicing",
      "AI drafting assistant — 40 requests a day",
      "1 GB document storage",
    ],
  },
  {
    name: "Solo Pro",
    price: "₹3999",
    cadence: "per month",
    summary: "The same practice, with document intake and client messaging automated.",
    features: [
      "Everything in Solo Basic",
      "Indic OCR intake with review and approval",
      "WhatsApp licensed for your chamber (automated sending on the roadmap)",
      "Up to 200 matters and 200 clients",
      "AI drafting assistant — 150 requests a day",
      "5 GB document storage",
    ],
    featured: true,
  },
  {
    name: "Chamber",
    price: "₹7999",
    cadence: "per month, 2 users included",
    summary: "For a chamber with more than one advocate. Extra seats at ₹1999 per user, per month.",
    features: [
      "Everything in Solo Pro",
      "Two users included, add seats at ₹1999 each",
      "Owner, admin and member roles per user",
      "Invite teammates and manage seats yourself",
      "Chamber-wide audit log",
      "Unlimited matters and clients",
      "AI drafting assistant — 400 requests a day",
      "25 GB document storage",
    ],
  },
];

function Pricing() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-16">
        <p className="text-eyebrow text-accent">Subscriptions</p>
        <h1 className="mt-4 text-4xl font-bold">Priced for how Indian advocates actually work</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Every plan starts with a{" "}
          <strong className="font-semibold text-foreground">
            15-day free trial — no card required
          </strong>
          . Two plans for a solo practice, and a Chamber plan that starts at two users and grows a
          seat at a time. Every plan includes GST-compliant invoicing, Indian data residency and
          daily backups. Annual billing carries two months free.
        </p>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={
                plan.featured
                  ? "rounded border-2 border-primary bg-card p-8 shadow-lift"
                  : "surface-panel rounded p-8"
              }
            >
              <h2 className="font-display text-xl font-bold">{plan.name}</h2>
              <p className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-3xl font-bold">{plan.price}</span>
                <span className="text-xs text-muted-foreground">{plan.cadence}</span>
              </p>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{plan.summary}</p>
              <ul className="mt-7 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className={
                  plan.featured
                    ? "mt-8 block rounded bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink"
                    : "mt-8 block rounded border border-input px-4 py-2.5 text-center text-sm font-semibold transition-colors hover:bg-secondary"
                }
              >
                Start free trial
              </Link>
              <Link
                to="/contact"
                className="mt-2 block text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                or talk to us first
              </Link>
            </article>
          ))}
        </div>

        <div className="surface-panel mt-12 rounded p-7">
          <h2 className="font-display text-lg font-bold">How Chamber seats are counted</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            A Chamber subscription starts at ₹7999 a month and covers two users. Each additional
            teammate is ₹1999 a month, added or removed from the Team screen by an owner or admin —
            a chamber of four works out to ₹11,997 a month. Every seat is a full login with its own
            role; pending invites hold a seat until they are accepted or revoked.
          </p>
        </div>

        <div className="surface-panel mt-6 rounded p-7">
          <h2 className="font-display text-lg font-bold">The 15-day trial</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Sign up and the trial starts immediately — no card, no payment details, nothing to
            cancel. It includes Indic OCR and WhatsApp so both can be evaluated properly, and runs
            for 15 days. When it ends your chamber stays readable and exportable; you simply cannot
            add new records until you pick a plan, so nothing you entered during the trial is ever
            lost.
          </p>
          <Link
            to="/auth"
            search={{ mode: "signup" }}
            className="mt-5 inline-flex items-center gap-2 rounded bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink"
          >
            Start your 15-day free trial
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
