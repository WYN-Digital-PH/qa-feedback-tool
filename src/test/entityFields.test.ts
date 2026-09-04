/**
 * Nothing on record should be unreachable.
 *
 * Several canvas settings — the feedback deadline, the proxy switch, the
 * widget fallback, the commenting master switch — existed in the schema and
 * were honoured by the edge functions from the first release, but no screen
 * ever wrote them, so they could only ever hold their defaults. These tests
 * make that failure loud: add a column, and the entity's editor has to either
 * expose it or say in the allowlist below why it doesn't.
 *
 * The column list comes from the generated Supabase types, so it tracks the
 * real schema rather than a copy of it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const TYPES = read("src/integrations/supabase/types.ts");

/** Column names on a table, read from the generated `Row` type. */
function columnsOf(table: string): string[] {
  const block = TYPES.match(new RegExp(`      ${table}: \\{\\n        Row: \\{\\n([\\s\\S]*?)\\n        \\}`));
  if (!block) throw new Error(`no Row type found for ${table}`);
  return [...block[1].matchAll(/^\s{10}(\w+)\??:/gm)].map((m) => m[1]);
}

interface Coverage {
  table: string;
  /** Files that together make the columns reachable. */
  surfaces: string[];
  /** Columns that are plumbing, with the reason each is exempt. */
  exempt: Record<string, string>;
}

const COVERAGE: Coverage[] = [
  {
    table: "canvases",
    surfaces: ["src/components/canvas/CanvasSettingsDialog.tsx", "src/pages/ProjectDetail.tsx"],
    exempt: {
      id: "primary key",
      project_id: "set at creation; the project owns the canvas",
      client_id: "derived from the project",
      created_by: "audit column, written once",
      file_url: "mirror of canvas_files.public_url, written by the upload function",
      allow_approval: "the guest sign-off flow was removed; the column is kept so the historical review_decisions rows still make sense, but nothing reads or writes it",
    },
  },
  {
    table: "clients",
    surfaces: ["src/pages/Clients.tsx"],
    exempt: {
      id: "primary key",
      created_by: "audit column, written once",
    },
  },
  {
    table: "projects",
    surfaces: ["src/pages/Projects.tsx", "src/pages/ProjectDetail.tsx"],
    exempt: {
      id: "primary key",
      created_by: "audit column, written once",
      updated_at: "maintained by a trigger; created_at is the one worth showing",
    },
  },
];

describe.each(COVERAGE)("$table", ({ table, surfaces, exempt }) => {
  const source = surfaces.map(read).join("\n");
  const columns = columnsOf(table);

  it("has columns to check", () => {
    expect(columns.length).toBeGreaterThan(3);
  });

  it("surfaces every column that isn't plumbing", () => {
    const missing = columns.filter((c) => !(c in exempt) && !source.includes(c));
    expect(
      missing,
      `${table}: ${missing.join(", ")} exist on the record but no screen reads or writes them. ` +
        "Add them to the editor, or list them in `exempt` with a reason.",
    ).toEqual([]);
  });

  it("does not exempt a column that no longer exists", () => {
    const stale = Object.keys(exempt).filter((c) => !columns.includes(c));
    expect(stale, `${table}: exemptions for columns that are gone: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("canvas settings", () => {
  const dialog = read("src/components/canvas/CanvasSettingsDialog.tsx");

  it("writes the flags the public review page actually reads", () => {
    // Each of these gates something a guest can do. They were unreachable
    // before this dialog existed.
    for (const flag of [
      "commenting_enabled",
      "feedback_deadline",
      "proxy_enabled",
      "widget_fallback_enabled",
      "capture_screenshot",
      "allow_guest_replies",
      "allow_public_comment_view",
      "require_guest_name",
      "require_guest_email",
    ]) {
      expect(dialog, `${flag} is not written by the settings dialog`).toContain(`${flag}:`);
    }
  });

  it("checks the write landed rather than trusting a blocked update", () => {
    // RLS reports a refusal as zero rows, not as an error.
    expect(dialog).toMatch(/\.select\("id"\)/);
    expect(dialog).toMatch(/error \|\| !data\?\.length/);
  });
});

describe("destructive actions", () => {
  const SOURCES = [
    "src/pages/Feedback.tsx",
    "src/pages/Clients.tsx",
    "src/pages/Projects.tsx",
    "src/pages/ProjectDetail.tsx",
    "src/pages/InternalCanvas.tsx",
    "src/components/review/ReviewSidebar.tsx",
    "src/components/settings/TeamMembers.tsx",
  ];

  it("never fall back to the native confirm dialog", () => {
    // window.confirm blocks the tab, cannot be branded, and is suppressed
    // outright in some contexts — which turns "are you sure?" into "yes".
    const offenders = SOURCES.filter((file) => /(?<![\w.])confirm\(["'`]/.test(read(file)));
    expect(offenders, `still calling window.confirm: ${offenders.join(", ")}`).toEqual([]);
  });

  it("ask through the shared dialog", () => {
    for (const file of ["src/pages/Feedback.tsx", "src/components/review/ReviewSidebar.tsx"]) {
      expect(read(file)).toContain("useConfirm");
    }
    for (const file of ["src/pages/Clients.tsx", "src/pages/Projects.tsx", "src/pages/ProjectDetail.tsx"]) {
      expect(read(file)).toContain("ConfirmDeleteDialog");
    }
  });
});

describe("desktop notifications", () => {
  const lib = read("src/lib/desktopNotifications.ts");

  it("only ask for permission from a user gesture", () => {
    // Asking on load is the fastest way to a permanent denial, and some
    // browsers reject the prompt outright when there has been no gesture.
    expect(read("src/components/NotificationBell.tsx")).toMatch(/onClick=\{toggleDesktop\}/);
    expect(lib).toContain("export async function requestDesktopPermission");
  });

  it("stay quiet when the window is already in front", () => {
    expect(lib).toMatch(/document\.visibilityState === "visible" && document\.hasFocus\(\)/);
  });

  it("never throw out of the realtime handler", () => {
    // Construction throws on platforms that require a service worker.
    expect(lib).toMatch(/try \{[\s\S]*new Notification\([\s\S]*\} catch/);
  });

  it("do not double up on sound", () => {
    // The app plays its own chime; Windows would otherwise add a second one.
    expect(lib).toMatch(/silent: true/);
  });
});
