/**
 * The review sidebar's list affordances: stepping between threads, the reply
 * indicator, and the filter-reset escape hatch.
 *
 * The reply count is also a disclosure rule, not just a badge — the guest
 * canvas must never count internal notes — so that half is asserted against
 * the edge function that produces it, which is the only place it can be
 * enforced.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ReviewSidebar, { type ReviewSidebarProps } from "@/components/review/ReviewSidebar";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const items = [
  { id: "a", pin_number: 1, comment: "First", created_at: "2026-09-01T00:00:00Z", status: "new", reply_count: 0 },
  { id: "b", pin_number: 2, comment: "Second", created_at: "2026-09-01T00:00:00Z", status: "new", reply_count: 3 },
  { id: "c", pin_number: 3, comment: "Third", created_at: "2026-09-01T00:00:00Z", status: "new", reply_count: 1 },
];

function renderSidebar(over: Partial<ReviewSidebarProps> = {}) {
  const onSelect = vi.fn();
  const props: ReviewSidebarProps = {
    mode: "public",
    items: items as any,
    totalCount: items.length,
    search: "",
    setSearch: vi.fn(),
    filterValue: "all",
    setFilterValue: vi.fn(),
    filterOptions: [{ value: "all", label: "All" }],
    selectedId: null,
    selectedItem: null,
    replies: [],
    onSelect,
    onBack: vi.fn(),
    canReply: false,
    replyText: "",
    setReplyText: vi.fn(),
    onSubmitReply: vi.fn(),
    ...over,
  };
  return { onSelect, ...render(<ReviewSidebar {...props} />) };
}

describe("stepping between threads", () => {
  it("moves to the next item without going back to the list", () => {
    const { onSelect } = renderSidebar({ selectedId: "a", selectedItem: items[0] as any });
    fireEvent.click(screen.getByLabelText("Next comment"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("moves to the previous item", () => {
    const { onSelect } = renderSidebar({ selectedId: "b", selectedItem: items[1] as any });
    fireEvent.click(screen.getByLabelText("Previous comment"));
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("shows the position in the list", () => {
    renderSidebar({ selectedId: "b", selectedItem: items[1] as any });
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("disables the arrows at each end", () => {
    const first = renderSidebar({ selectedId: "a", selectedItem: items[0] as any });
    expect(first.getByLabelText("Previous comment")).toBeDisabled();
    expect(first.getByLabelText("Next comment")).not.toBeDisabled();
    first.unmount();

    const last = renderSidebar({ selectedId: "c", selectedItem: items[2] as any });
    expect(last.getByLabelText("Next comment")).toBeDisabled();
  });

  it("offers no navigation when the open item is filtered out of the list", () => {
    // Selection survives a filter change, so the open thread can be absent from
    // the list it would otherwise step through.
    renderSidebar({ selectedId: "zz", selectedItem: { ...items[0], id: "zz" } as any });
    expect(screen.queryByLabelText("Next comment")).toBeNull();
  });
});

describe("reply indicator", () => {
  it("marks items that have replies, and leaves the rest bare", () => {
    renderSidebar();
    expect(screen.getByTitle("3 replies")).toBeInTheDocument();
    expect(screen.getByTitle("1 reply")).toBeInTheDocument();
    expect(screen.queryByTitle("0 replies")).toBeNull();
  });
});

describe("hidden-by-filter reset", () => {
  it("says how many are hidden and clears the filters", () => {
    const onClearFilters = vi.fn();
    renderSidebar({ items: [items[0]] as any, totalCount: 3, onClearFilters });
    const reset = screen.getByText(/2 hidden by filters/);
    fireEvent.click(reset);
    expect(onClearFilters).toHaveBeenCalled();
  });

  it("stays quiet when nothing is hidden", () => {
    renderSidebar({ onClearFilters: vi.fn() });
    expect(screen.queryByText(/hidden by filters/)).toBeNull();
  });
});

describe("the guest canvas never counts internal notes", () => {
  const FN = read("supabase/functions/get-public-canvas-comments/index.ts");

  it("filters is_internal out of the reply count server-side", () => {
    const countBlock = FN.slice(FN.indexOf("replyCounts"));
    expect(countBlock).toContain('.eq("is_internal", false)');
    expect(countBlock).toContain('.is("deleted_at", null)');
  });
});

describe("the internal canvas shows the whole canvas by default", () => {
  const PAGE = read("src/pages/InternalCanvas.tsx");

  it("does not scope the list to the current page until asked", () => {
    expect(PAGE).toContain("const [currentPageOnly, setCurrentPageOnly] = useState(false)");
  });
});
