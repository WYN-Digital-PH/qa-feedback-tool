/**
 * Smoke tests for the shared design-system pieces.
 *
 * These guard the two properties the UI depends on staying uniform:
 * every page renders through the same primitives, and nothing hardcodes the
 * brand — so a white-label rebrand only has to touch the brand config.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import BrandMark from "@/components/BrandMark";
import { Page, PageHeader, SectionHeading } from "@/components/layout/Page";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PriorityBadge, StatusBadge } from "@/components/feedback/StatusBadge";
import Index from "@/pages/Index";
import NotFound from "@/pages/NotFound";
import { brand, brandByline, pageTitle } from "@/config/brand";
import {
  FEEDBACK_STATUSES,
  humanize,
  statusBadgeClass,
  statusSolidClass,
  statusTone,
  toneClasses,
} from "@/lib/feedbackMeta";
import { KANBAN_COLUMNS } from "@/components/feedback/KanbanBoard";

const withRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("brand configuration", () => {
  it("drives the wordmark and byline", () => {
    render(<BrandMark />);
    expect(screen.getByText(brand.productName)).toBeInTheDocument();
    expect(screen.getByText(brandByline)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", brand.logoSrc);
  });

  it("hides the wordmark when collapsed but keeps the logo labelled", () => {
    render(<BrandMark logoOnly />);
    expect(screen.queryByText(brand.productName)).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(`${brand.productName} logo`);
  });

  it("builds section-scoped document titles", () => {
    expect(pageTitle("Projects")).toBe(`Projects · ${brand.productName}`);
    expect(pageTitle()).toBe(brand.productName);
  });
});

describe("page primitives", () => {
  it("renders one page title with the shared type scale", () => {
    render(
      <Page>
        <PageHeader title="Projects" description="Each project holds canvases." actions={<button>New</button>} />
        <SectionHeading>Canvases</SectionHeading>
      </Page>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Projects" });
    expect(heading).toHaveClass("text-2xl", "font-semibold", "tracking-tight");
    expect(screen.getByText("Each project holds canvases.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Canvases" })).toBeInTheDocument();
  });

  it("renders the shared empty, loading and error states", () => {
    const { rerender } = render(<EmptyState message="No projects yet." />);
    expect(screen.getByText("No projects yet.")).toBeInTheDocument();

    rerender(<LoadingState label="Loading review…" fullScreen />);
    expect(screen.getByText("Loading review…")).toBeInTheDocument();

    rerender(<ErrorState title="Canvas unavailable" description="It was removed." />);
    expect(screen.getByRole("heading", { name: "Canvas unavailable" })).toBeInTheDocument();
    expect(screen.getByText("It was removed.")).toBeInTheDocument();
  });
});

describe("feedback vocabulary", () => {
  it("labels statuses the same way everywhere", () => {
    expect(humanize("in_progress")).toBe("In progress");
    expect(humanize("ready_for_qa")).toBe("Ready for QA");
    expect(humanize(null)).toBe("—");
  });

  it("maps statuses to theme tokens rather than palette colours", () => {
    render(<StatusBadge status="resolved" />);
    expect(screen.getByText("Resolved").className).toContain("bg-status-resolved/15");
    expect(statusTone("changes_needed")).toBe("danger");

    // Everything resolves to semantic tokens, never a Tailwind palette colour —
    // a palette colour would survive a rebrand unchanged.
    const PALETTE = /\b(slate|gray|zinc|red|orange|amber|yellow|green|emerald|teal|blue|indigo|violet|purple|pink|rose)-\d/;
    for (const tone of ["neutral", "info", "success", "warning", "danger"] as const) {
      expect(toneClasses(tone)).not.toMatch(PALETTE);
    }
    for (const status of FEEDBACK_STATUSES) {
      expect(statusBadgeClass(status)).not.toMatch(PALETTE);
      expect(statusSolidClass(status)).not.toMatch(PALETTE);
    }
  });

  it("gives every status its own colour", () => {
    // "In review", "Assigned" and "In progress" used to render identically,
    // which made a full board impossible to scan.
    const distinct = new Set(FEEDBACK_STATUSES.map((s) => statusSolidClass(s)));
    expect(distinct.size).toBe(FEEDBACK_STATUSES.length);
  });

  it("colours every board column", () => {
    // A column with no token of its own falls back to grey, silently.
    for (const column of KANBAN_COLUMNS) {
      expect(statusSolidClass(column.key), `${column.key} has no colour`).not.toBe("bg-muted-foreground");
    }
  });

  it("renders priorities through the same pill", () => {
    render(<PriorityBadge priority="urgent" />);
    expect(screen.getByText("Urgent")).toHaveClass("bg-destructive/10");
  });
});

describe("standalone pages render", () => {
  it("shows the landing page with the brand mark and calls to action", () => {
    withRouter(<Index />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The easiest way to review websites");
    expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0);
    expect(screen.getByText(brand.productName)).toBeInTheDocument();
  });

  it("shows a not-found page that links home", () => {
    withRouter(<NotFound />);
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute("href", "/");
  });
});
