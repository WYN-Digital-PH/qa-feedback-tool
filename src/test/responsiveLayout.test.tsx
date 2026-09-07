/**
 * The layout rules that a narrow viewport depends on.
 *
 * jsdom does no layout, so these assert the structural choices that produce the
 * behaviour rather than measuring pixels: a wide list must be able to scroll
 * inside its own card, and a page must be allowed to shrink at all.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Page, PageHeader } from "@/components/layout/Page";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("wide lists scroll instead of clipping", () => {
  /**
   * Both list tables used to sit in `surface-card overflow-hidden`, which
   * rounds the card's corners but *clips* anything too wide to fit — the far
   * columns were unreachable at any viewport narrower than the table.
   */
  it.each([
    ["src/pages/Feedback.tsx", "the feedback list"],
    ["src/pages/Clients.tsx", "the agency list"],
  ])("%s scrolls horizontally", (path) => {
    const text = source(path);
    const card = text.match(/<div className="surface-card[^"]*">\s*<table className="([^"]*)"/);
    expect(card, `${path} should render a table directly inside a surface card`).not.toBeNull();

    // The card scrolls rather than hides what overflows...
    expect(text).toContain('<div className="surface-card overflow-x-auto">');
    expect(text).not.toContain('<div className="surface-card overflow-hidden">\n          <table');
    // ...and the table keeps a floor width, so columns scroll out of view
    // rather than compressing into unreadable slivers first.
    expect(card![1]).toMatch(/min-w-\[\d+rem\]/);
  });

  it("keeps the kanban board scrollable with fixed-width columns", () => {
    const text = source("src/components/feedback/KanbanBoard.tsx");
    expect(text).toContain("overflow-x-auto");
    expect(text).toMatch(/min-w-\[\d+px\]/);
  });

  it("keeps the permission matrix scrollable", () => {
    expect(source("src/components/settings/RolePermissions.tsx")).toContain('<div className="overflow-x-auto">');
  });
});

describe("the page shell can shrink", () => {
  it("lets the page narrow inside the flex row beside the sidebar", () => {
    const { container } = render(<Page><p>Body</p></Page>);
    // Without `min-w-0` a flex child refuses to go below its content width, so
    // a wide table pushes the whole layout sideways instead of scrolling.
    expect(container.firstElementChild).toHaveClass("min-w-0");
  });

  it("scales page padding down on small screens", () => {
    const { container } = render(<Page><p>Body</p></Page>);
    expect(container.firstElementChild?.className).toMatch(/(^|\s)p-4(\s|$)/);
    expect(container.firstElementChild).toHaveClass("sm:p-6", "lg:p-8");
  });

  it("drops header actions below the title rather than squeezing it", () => {
    render(<PageHeader title="Projects" actions={<button>New</button>} />);
    const row = screen.getByRole("heading", { level: 1 }).parentElement?.parentElement;
    expect(row).toHaveClass("flex-col", "sm:flex-row");
  });

  it("wraps a long title instead of letting it overflow", () => {
    render(<PageHeader title="A project name long enough to need wrapping" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("break-words");
  });
});

describe("navigation is reachable on a phone", () => {
  /**
   * The sidebar was a permanent 16rem column at every width, leaving a 375px
   * screen barely 7rem to read the page in.
   */
  it("makes the sidebar an off-canvas drawer below lg", () => {
    const text = source("src/components/DashboardLayout.tsx");
    expect(text).toContain("-translate-x-full");
    expect(text).toContain("lg:static lg:translate-x-0");
    // ...with a way to open it, and two ways out.
    expect(text).toContain("Open navigation");
    expect(text).toContain("Close navigation");
    expect(text).toContain('e.key === "Escape"');
  });

  it("collapses to an icon rail only where that is the desktop layout", () => {
    // `collapsed` drives what renders, not just widths, so it has to be gated
    // on the viewport too -- otherwise the drawer opens as a labelless rail.
    expect(source("src/components/DashboardLayout.tsx")).toContain("const railed = collapsed && isDesktop");
  });

  it("gives the internal canvas a way to reach feedback without the column", () => {
    const text = source("src/pages/InternalCanvas.tsx");
    expect(text).toContain('<aside className="hidden lg:flex');
    expect(text).toContain('<SheetContent side="bottom"');
  });
});

describe("dialogs fit a small screen", () => {
  it("leaves a gutter and scrolls a long form", () => {
    const text = source("src/components/ui/dialog.tsx");
    expect(text).toContain("w-[calc(100%-2rem)]");
    expect(text).toContain("max-h-[calc(100dvh-2rem)]");
    expect(text).toContain("overflow-y-auto");
  });
});

describe("list columns adapt to the viewport", () => {
  /** The responsive visibility classes on a tag, normalised for comparison. */
  const breakpoints = (tag: string) => {
    const m = tag.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
    const cls = (m?.[1] ?? m?.[2] ?? "").split(/\s+/);
    return cls
      .filter((t) => t === "hidden" || /^(sm|md|lg|xl):(table-cell|hidden)$/.test(t))
      .sort()
      .join(" ");
  };

  const table = (path: string) => {
    const src = source(path);
    const head = src.slice(src.indexOf("<thead"), src.indexOf("</thead>"));
    const body = src.slice(src.indexOf("<tbody"), src.lastIndexOf("</tbody>"));
    return {
      head: (head.match(/<th\b[^>]*>/g) ?? []).map(breakpoints),
      body: (body.match(/<td\b[^>]*>/g) ?? []).map(breakpoints),
    };
  };

  /**
   * A header and its cells must appear and disappear together. If they drift,
   * every column to the right of the mismatch renders under the wrong heading —
   * which looks like data corruption rather than a layout bug.
   */
  it.each([
    ["src/pages/Feedback.tsx", 9],
    ["src/pages/Clients.tsx", 6],
  ])("%s keeps headers and cells on the same breakpoints", (path, columns) => {
    const { head, body } = table(path);
    expect(head).toHaveLength(columns);
    expect(body).toHaveLength(columns);
    expect(body).toEqual(head);
  });

  it("always shows the columns a row is identified by", () => {
    // Whatever else goes, the feedback list must still show what was said and
    // where it stands; the agency list must still name the agency.
    const feedback = table("src/pages/Feedback.tsx").head;
    expect(feedback[2], "the comment column must never be hidden").toBe("");
    expect(feedback[6], "the status column must never be hidden").toBe("");
    expect(table("src/pages/Clients.tsx").head[0], "the agency column must never be hidden").toBe("");
  });

  it("raises the scroll floor as more columns appear", () => {
    // A single wide floor forced a scrollbar even where the reduced set fits.
    for (const path of ["src/pages/Feedback.tsx", "src/pages/Clients.tsx"]) {
      const cls = source(path).match(/<table className="([^"]*)"/)?.[1] ?? "";
      expect(cls, `${path} should scale its min-width`).toMatch(/min-w-\[\d+rem\]/);
      expect(cls, `${path} should raise the floor at a larger breakpoint`)
        .toMatch(/(sm|md|lg|xl):min-w-\[\d+rem\]/);
    }
  });

  it("keeps what a hidden column held visible in the row", () => {
    // Dropping a column must not drop the information with it.
    const src = source("src/pages/Feedback.tsx");
    expect(src).toContain('className="md:hidden"');
    expect(src).toMatch(/lg:hidden[\s\S]{0,400}assigneeName\(it\.assigned_to\)/);
    expect(source("src/pages/Clients.tsx")).toMatch(/truncate md:hidden">\{c\.email\}/);
  });
});
