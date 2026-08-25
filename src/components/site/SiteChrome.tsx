import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Scale } from "lucide-react";
import { GROUP_TONE, groupedDestinations } from "@/lib/navigation";

const nav = [
  { to: "/security", label: "Security" },
  { to: "/pricing", label: "Pricing" },
  { to: "/contact", label: "Contact" },
] as const;

const groupToneClasses: Record<(typeof GROUP_TONE)[keyof typeof GROUP_TONE], string> = {
  sapphire: "bg-docket-sapphire text-docket-sapphire-foreground",
  amber: "bg-docket-amber text-docket-amber-foreground",
  teal: "bg-docket-teal text-docket-teal-foreground",
  rose: "bg-docket-rose text-docket-rose-foreground",
};

// Reads from the same APP_DESTINATIONS list the signed-in sidebar renders
// (src/lib/navigation.ts), so this menu can never drift out of date with
// what the app actually ships — no separate marketing copy of the feature
// list to keep in sync by hand.
function FeaturesMenu() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function openNow() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function closeSoon() {
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const groups = groupedDestinations();

  return (
    <div ref={containerRef} className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        Features
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute top-full left-1/2 z-50 mt-3 w-[38rem] -translate-x-1/2 rounded border border-border bg-background p-5 text-left shadow-lift">
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            {groups.map(({ group, items }) => (
              <div key={group}>
                <p
                  className={`text-eyebrow inline-flex items-center rounded-full px-2 py-0.5 ${groupToneClasses[GROUP_TONE[group]]}`}
                >
                  {group}
                </p>
                <ul className="mt-2 space-y-1">
                  {items.map((item) => (
                    <li key={item.to}>
                      <Link
                        to="/features"
                        className="group -mx-2 flex items-start gap-2.5 rounded px-2 py-1.5 transition-colors hover:bg-secondary"
                        onClick={() => setOpen(false)}
                      >
                        <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                        <span>
                          <span className="block text-sm font-medium">{item.label}</span>
                          <span className="block text-xs text-muted-foreground">{item.blurb}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <Link
              to="/features"
              className="text-sm font-medium text-accent hover:underline"
              onClick={() => setOpen(false)}
            >
              See all features →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded bg-primary text-primary-foreground">
            <Scale className="size-4" />
          </span>
          <span className="font-display text-base font-bold tracking-tight">LexDiary</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          <FeaturesMenu />
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          to="/app"
          className="rounded border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-ink"
        >
          Open the workspace
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-secondary/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} LexDiary — practice management for Indian advocates.</p>
        <p className="flex items-center gap-4">
          <span>Data hosted in Mumbai, India</span>
          <Link to="/security" className="underline-offset-4 hover:underline">
            Security
          </Link>
          <Link to="/privacy" className="underline-offset-4 hover:underline">
            Privacy notice
          </Link>
        </p>
      </div>
    </footer>
  );
}
