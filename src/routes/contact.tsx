import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitContactRequest } from "@/lib/contact.functions";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Request access — LexDiary" },
      {
        name: "description",
        content:
          "Tell us about your practice — court, bench and team size — and we will arrange onboarding for LexDiary.",
      },
      { property: "og:title", content: "Request access — LexDiary" },
      {
        property: "og:description",
        content: "Tell us about your practice and we will arrange onboarding for LexDiary.",
      },
    ],
  }),
  component: Contact,
});

function Contact() {
  const submit = useServerFn(submitContactRequest);
  const [form, setForm] = useState({
    fullName: "",
    enrolmentNo: "",
    email: "",
    phone: "",
    court: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submit({
        data: {
          fullName: form.fullName,
          enrolmentNo: form.enrolmentNo || undefined,
          email: form.email,
          phone: form.phone,
          court: form.court || undefined,
          note: form.note || undefined,
        },
      });
      toast.success("Request received", {
        description: "We'll confirm cause-list coverage for your bench and follow up by email.",
      });
      setForm({ fullName: "", enrolmentNo: "", email: "", phone: "", court: "", note: "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send that request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-5 py-16">
        <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-eyebrow text-accent">Onboarding</p>
            <h1 className="mt-4 text-3xl font-bold">Request access</h1>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              We onboard chambers court by court so cause-list coverage is verified before you rely
              on it. Tell us where you practise and we will confirm coverage for your bench.
            </p>
            <dl className="mt-9 space-y-4 text-sm">
              <div>
                <dt className="font-semibold">Email</dt>
                <dd className="text-muted-foreground">chambers@lexdiary.online</dd>
              </div>
              <div>
                <dt className="font-semibold">Phone — help and other enquiries</dt>
                <dd className="text-muted-foreground">+91 70100 61822</dd>
              </div>
              <div>
                <dt className="font-semibold">Support hours</dt>
                <dd className="text-muted-foreground">Mon–Sat, 9:00–20:00 IST</dd>
              </div>
            </dl>
          </div>

          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="surface-panel space-y-5 rounded p-8"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  required
                  placeholder="Adv. Priya Nair"
                  value={form.fullName}
                  onChange={(event) => setForm((f) => ({ ...f, fullName: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="enrolment">Bar Council enrolment no.</Label>
                <Input
                  id="enrolment"
                  placeholder="D/1234/2016"
                  value={form.enrolmentNo}
                  onChange={(event) => setForm((f) => ({ ...f, enrolmentNo: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="you@chambers.in"
                  value={form.email}
                  onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Mobile</Label>
                <Input
                  id="phone"
                  required
                  placeholder="+91 98xxx xxxxx"
                  value={form.phone}
                  onChange={(event) => setForm((f) => ({ ...f, phone: event.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="court">Primary court / bench</Label>
              <Input
                id="court"
                placeholder="Delhi High Court"
                value={form.court}
                onChange={(event) => setForm((f) => ({ ...f, court: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">Tell us about your practice</Label>
              <Textarea
                id="note"
                rows={4}
                placeholder="Team size, practice areas, how you keep your diary today."
                value={form.note}
                onChange={(event) => setForm((f) => ({ ...f, note: event.target.value }))}
              />
            </div>

            {error ? (
              <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-ink disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Send request
            </button>
          </form>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
