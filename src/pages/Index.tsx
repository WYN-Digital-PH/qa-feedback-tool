import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import BrandMark from "@/components/BrandMark";
import { brand } from "@/config/brand";

/**
 * The landing page.
 *
 * The hero shows a mock of the review canvas rather than a stock illustration:
 * pins sitting on a page with a thread open beside them *is* the product, and
 * it explains the idea faster than the paragraph next to it can.
 *
 * Everything here resolves to design tokens — the accent, the status hues, the
 * radius and the fonts — so a rebrand recolours this page along with the app.
 * Nothing is a fixed hex value and there are no external assets.
 */

/** A numbered review pin, as it appears on a canvas. */
function Pin({ n, className, muted }: { n: number; className?: string; muted?: boolean }) {
  return (
    <span
      className={`absolute grid place-items-center w-7 h-7 text-xs font-bold rounded-[999px_999px_999px_2px] border-2 border-pin-foreground shadow-lg ${
        muted ? "bg-pin-resolved text-pin-foreground" : "bg-pin text-pin-foreground"
      } ${className ?? ""}`}
    >
      {n}
    </span>
  );
}

/** The hero mock: a browser frame with pins on the page and a thread beside them. */
function CanvasMock() {
  return (
    <div className="relative">
      {/* Glow behind the frame, tinted with the brand accent. */}
      <div
        aria-hidden
        className="absolute -inset-6 rounded-[2rem] bg-primary/10 blur-2xl"
      />

      <div className="relative surface-elevated overflow-hidden">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-secondary/60">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-warning/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-success/60" />
          </div>
          <div className="flex-1 mx-2 h-6 rounded-md bg-background border border-border grid place-items-center">
            <span className="text-[10px] font-mono text-muted-foreground">clientsite.com/pricing</span>
          </div>
          <div className="hidden sm:flex gap-1 text-[10px] text-muted-foreground">
            <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Desktop</span>
            <span className="px-1.5 py-0.5 rounded">Tablet</span>
            <span className="px-1.5 py-0.5 rounded">Mobile</span>
          </div>
        </div>

        <div className="grid sm:grid-cols-[1fr_auto]">
          {/* The page being reviewed */}
          <div className="relative p-6 min-h-[300px]">
            <div className="h-6 w-2/3 rounded bg-foreground/80" />
            <div className="mt-2 h-3 w-full rounded bg-muted-foreground/25" />
            <div className="mt-1.5 h-3 w-4/5 rounded bg-muted-foreground/25" />

            <div className="mt-5 flex gap-2">
              <div className="h-8 w-24 rounded-md bg-primary" />
              <div className="h-8 w-20 rounded-md border border-border" />
            </div>

            <div className="mt-6 grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="h-2.5 w-10 rounded bg-muted-foreground/30" />
                  <div className="mt-2 h-5 w-14 rounded bg-foreground/70" />
                  <div className="mt-2 space-y-1">
                    <div className="h-1.5 w-full rounded bg-muted-foreground/20" />
                    <div className="h-1.5 w-3/4 rounded bg-muted-foreground/20" />
                  </div>
                </div>
              ))}
            </div>

            <Pin n={1} className="left-[58%] top-[38px]" />
            <Pin n={2} className="left-[26px] top-[152px]" />
            <Pin n={3} className="left-[70%] top-[232px]" muted />
          </div>

          {/* The thread */}
          <aside className="border-t sm:border-t-0 sm:border-l border-border bg-surface p-3 sm:w-[228px] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold">Comments</span>
              <span className="text-[10px] text-muted-foreground">3</span>
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="grid place-items-center w-4 h-4 rounded-full bg-pin text-pin-foreground text-[9px] font-bold">1</span>
                <span className="text-[11px] font-medium">Dana</span>
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-status-new/15 text-status-new font-medium">New</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
                This headline wraps onto three lines on my laptop — can we shorten it?
              </p>
            </div>

            <div className="rounded-lg border border-border p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="grid place-items-center w-4 h-4 rounded-full bg-pin text-pin-foreground text-[9px] font-bold">2</span>
                <span className="text-[11px] font-medium">Dana</span>
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-status-in-progress/15 text-status-in-progress font-medium">Assigned</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
                The CTA should be our brand navy, not blue.
              </p>
            </div>

            <div className="rounded-lg border border-border p-2.5 opacity-60">
              <div className="flex items-center gap-1.5">
                <span className="grid place-items-center w-4 h-4 rounded-full bg-pin-resolved text-pin-foreground text-[9px] font-bold">3</span>
                <span className="text-[11px] font-medium">Marcus</span>
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-status-resolved/15 text-status-resolved font-medium">Resolved</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">Third card is missing its price.</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default function Index() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <BrandMark size="sm" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild><Link to="/login">Sign in</Link></Button>
            <Button asChild><Link to="/signup">Create account</Link></Button>
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden flex-1">
        {/* A soft brand wash and a faint grid, so the page has a surface
            instead of sitting on flat white. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-primary/[0.07] via-background to-background"
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse 70% 55% at 50% 0%, #000 40%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 70% 55% at 50% 0%, #000 40%, transparent 100%)",
          }}
        />

        <div className="relative max-w-6xl mx-auto px-6 pt-16 pb-20 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-12 items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-status-resolved" />
              Built for agencies running client review rounds
            </span>

            <h1 className="mt-5 text-4xl md:text-5xl xl:text-6xl font-bold tracking-tight">
              The easiest way to review websites{" "}
              <span className="text-primary">with clients.</span>
            </h1>

            <p className="text-base md:text-lg text-muted-foreground mt-5 max-w-xl">
              Stop translating "the button on the left, a bit further down" into a ticket. Your client clicks the thing
              they mean, and your team gets it pinned, screenshotted and ready to assign.
            </p>

            <div className="flex flex-wrap gap-3 mt-8">
              <Button size="lg" asChild>
                <Link to="/signup">Get started <ArrowRight className="w-4 h-4 ml-1.5" /></Link>
              </Button>
              <Button size="lg" variant="outline" asChild><Link to="/login">Sign in</Link></Button>
            </div>

            <ul className="mt-8 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {[
                "No plugin on the client's site",
                "Clients never sign up",
                "Websites, images and PDFs",
                "Internal notes stay internal",
              ].map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-status-resolved mt-0.5 shrink-0" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <CanvasMock />
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} {brand.companyName}</span>
          <div className="flex items-center gap-5">
            {brand.websiteUrl && (
              <a href={brand.websiteUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                {brand.companyName}
              </a>
            )}
            <Link to="/login" className="hover:text-foreground transition-colors">Sign in</Link>
            <Link to="/signup" className="hover:text-foreground transition-colors">Create account</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
