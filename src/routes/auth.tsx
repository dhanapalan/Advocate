import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Scale, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logAuthEvent } from "@/lib/edge-functions";
import { cn } from "@/lib/utils";
import heroSignIn from "@/assets/hero-signin-courthouse.jpg";
import heroSignUp from "@/assets/hero-signup-signing.jpg";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — LexDiary" },
      {
        name: "description",
        content:
          "Sign in to your chamber workspace to manage matters, court diary, documents and AI drafting for your practice.",
      },
      { property: "og:title", content: "Sign in — LexDiary" },
      {
        property: "og:description",
        content: "Secure sign-in for Indian advocates using LexDiary.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

// Indian mobiles are the norm here, so a bare 10-digit number is accepted and
// assumed +91 — that is what people actually type. An explicit +<country code>
// is passed through untouched so an advocate practising on an overseas number
// is not locked out. Returns null when the input cannot be made into a
// plausible E.164 number, which is what the DB CHECK constraint expects.
function toE164(raw: string): string | null {
  const trimmed = raw.replace(/[\s()-]/g, "");
  if (/^[6-9]\d{9}$/.test(trimmed)) return `+91${trimmed}`;
  if (/^0[6-9]\d{9}$/.test(trimmed)) return `+91${trimmed.slice(1)}`;
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;
  return null;
}

function AuthPage() {
  const navigate = useNavigate();
  // ?mode=signup lets the pricing and landing CTAs open registration directly
  // rather than dropping people on the sign-in form.
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">(() => {
    if (typeof window === "undefined") return "signin";
    return new URLSearchParams(window.location.search).get("mode") === "signup"
      ? "signup"
      : "signin";
  });
  const heroCopy =
    mode === "signup"
      ? {
          image: heroSignUp,
          alt: "Close-up of a hand signing a document with a fountain pen",
          heading: "A disciplined practice, run from a single workspace.",
          body: "Matters, hearing diary, documents, clients and billing — brought together for how litigation is practised in Indian courts.",
        }
      : mode === "forgot"
        ? {
            image: heroSignIn,
            alt: "Colonnade inside a courthouse, columns receding toward a lit doorway",
            heading: "Back into your chamber in a moment.",
            body: "We'll email a reset link to the address on file so you're back to your matters and diary quickly.",
          }
        : {
            image: heroSignIn,
            alt: "Colonnade inside a courthouse, columns receding toward a lit doorway",
            heading: "Welcome back to your chamber.",
            body: "Sign in to pick up your matters, hearing diary, documents and billing right where you left off.",
          };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [phone, setPhone] = useState("");
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) void navigate({ to: "/app" });
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "signup" && !agreedToPrivacy) {
      setError("Please confirm you have read the privacy notice before creating an account.");
      return;
    }
    if (mode === "signup" && !toE164(phone)) {
      setError(
        "Enter a valid mobile number — 10 digits for an Indian number, or +<country code> for an overseas one.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "forgot") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) throw resetError;
        setNotice("If that email has an account, a reset link is on its way. Check your inbox.");
        return;
      }
      if (mode === "signup") {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/app`,
            data: { full_name: fullName, firm_name: firmName, phone: toE164(phone) },
          },
        });
        if (signUpError) throw signUpError;
        void logAuthEvent({ event: "signup", email, userId: signUpData.user?.id });
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          void navigate({ to: "/app" });
          return;
        }
        setNotice("Check your inbox to confirm the email address, then sign in.");
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      void navigate({ to: "/app" });
    } catch (cause) {
      if (mode === "signin") void logAuthEvent({ event: "login_failed", email });
      setError(cause instanceof Error ? cause.message : "Could not complete that request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid h-screen overflow-hidden lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-brief text-primary-foreground lg:flex lg:flex-col lg:p-8">
        <div className="absolute -top-16 -right-16 size-72 rounded-full bg-docket-amber/60 blur-3xl" />
        <div className="absolute -bottom-20 -left-16 size-80 rounded-full bg-docket-teal/50 blur-3xl" />

        <Link to="/" className="relative z-10 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded bg-primary-foreground/10 text-primary-foreground ring-1 ring-primary-foreground/20">
            <Scale className="size-4" />
          </span>
          <span className="font-display text-base font-bold">LexDiary</span>
        </Link>

        <div className="relative z-10 mt-6 flex min-h-0 flex-1 flex-col">
          <span className="text-eyebrow inline-flex items-center self-start rounded-full bg-docket-amber px-3 py-1 text-docket-amber-foreground">
            Practice management · India
          </span>
          <h2 className="mt-4 max-w-sm font-display text-3xl leading-tight font-bold">
            {heroCopy.heading}
          </h2>
          <p className="mt-3 max-w-sm text-sm text-primary-foreground/75">{heroCopy.body}</p>
          <img
            src={heroCopy.image}
            alt={heroCopy.alt}
            className="mt-4 w-full min-h-0 flex-1 rounded object-cover object-top shadow-lift"
          />
        </div>
      </div>

      <div className="flex h-screen items-center justify-center overflow-y-auto bg-secondary/40 px-4 py-2">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-2 flex items-center justify-center gap-2.5 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded bg-primary text-primary-foreground">
              <Scale className="size-4" />
            </span>
            <span className="font-display text-base font-bold">LexDiary</span>
          </Link>

          <div className="surface-panel relative overflow-hidden rounded p-4">
            <div className="absolute inset-x-0 top-0 flex h-1.5">
              <span className="flex-1 bg-docket-sapphire" />
              <span className="flex-1 bg-docket-amber" />
              <span className="flex-1 bg-docket-teal" />
              <span className="flex-1 bg-docket-rose" />
              <span className="flex-1 bg-docket-emerald" />
              <span className="flex-1 bg-docket-violet" />
            </div>
            <span
              className={cn(
                "text-eyebrow mt-2 inline-flex items-center rounded-full px-3 py-1",
                mode === "signin"
                  ? "bg-docket-sapphire text-docket-sapphire-foreground"
                  : mode === "signup"
                    ? "bg-docket-amber text-docket-amber-foreground"
                    : "bg-docket-teal text-docket-teal-foreground",
              )}
            >
              {mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "15-day free trial"
                  : "Reset password"}
            </span>
            <h1 className="mt-2 font-display text-xl font-bold">
              {mode === "signin"
                ? "Sign in to your chamber"
                : mode === "signup"
                  ? "Start your 15-day free trial"
                  : "Reset your password"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "signin"
                ? "Your matters, diary, documents and AI drafts stay private to your login."
                : mode === "signup"
                  ? "Every feature included — OCR, WhatsApp, drafting and a 3-seat chamber. No card required."
                  : "Enter the email on your account and we'll send you a link to set a new password."}
            </p>

            {mode === "signup" ? (
              <ul className="mt-2 space-y-0.5 rounded border border-accent/30 bg-accent/10 p-2 text-sm">
                {[
                  "All features unlocked for 15 days",
                  "No card, no payment details, nothing to cancel",
                  "Invite up to 2 teammates and try roles and seats",
                  "When it ends your data stays readable and exportable",
                ].map((line) => (
                  <li key={line} className="flex gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-3 space-y-2.5">
              {mode === "signup" ? (
                <>
                  <label className="block text-sm">
                    <span className="text-eyebrow">Advocate name</span>
                    <input
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      required
                      className="mt-1 w-full rounded border border-input bg-background px-3 py-1.5 text-sm"
                      placeholder="Your full name"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-eyebrow">Chamber / firm</span>
                    <input
                      value={firmName}
                      onChange={(event) => setFirmName(event.target.value)}
                      className="mt-1 w-full rounded border border-input bg-background px-3 py-1.5 text-sm"
                      placeholder="Your chamber or firm name"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-eyebrow">Mobile number</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      required
                      className="mt-1 w-full rounded border border-input bg-background px-3 py-1.5 text-sm"
                      placeholder="10-digit mobile number"
                    />
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      For hearing reminders. 10 digits, or +&lt;country code&gt; if outside India.
                    </span>
                  </label>
                </>
              ) : null}
              <label className="block text-sm">
                <span className="text-eyebrow">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="mt-1 w-full rounded border border-input bg-background px-3 py-1.5 text-sm"
                />
              </label>
              {mode !== "forgot" ? (
                <label className="block text-sm">
                  <span className="text-eyebrow">Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={6}
                    className="mt-1 w-full rounded border border-input bg-background px-3 py-1.5 text-sm"
                  />
                </label>
              ) : null}

              {mode === "signin" ? (
                <p className="-mt-2 text-right text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setMode("forgot");
                    }}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    Forgot password?
                  </button>
                </p>
              ) : null}

              {mode === "signup" ? (
                <label className="flex items-start gap-2.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={agreedToPrivacy}
                    onChange={(event) => setAgreedToPrivacy(event.target.checked)}
                    required
                    className="mt-0.5 size-3.5 shrink-0"
                  />
                  <span>
                    I have read and agree to the{" "}
                    <a
                      href="/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline"
                    >
                      privacy notice
                    </a>
                    , including how my account data is used and my rights under the DPDP Act.
                  </span>
                </label>
              ) : null}

              {error ? (
                <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p className="rounded border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
                  {notice}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy || (mode === "signup" && !agreedToPrivacy)}
                className="flex w-full items-center justify-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Send reset link"}
              </button>
            </form>

            <p className="mt-2 text-center text-sm text-muted-foreground">
              {mode === "forgot" ? (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setMode("signin");
                  }}
                  className="font-semibold text-primary underline-offset-4 hover:underline"
                >
                  Back to sign in
                </button>
              ) : (
                <>
                  {mode === "signin" ? "New to LexDiary?" : "Already have an account?"}{" "}
                  <button
                    type="button"
                    onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    {mode === "signin" ? "Create an account" : "Sign in"}
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
