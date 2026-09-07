/**
 * Mentions store an account id, not the name that was typed.
 *
 * The rest of the app already learned this lesson once — see `displayName.ts`,
 * where a name copied at write time went stale and showed the wrong thing
 * forever. These tests hold the same line for mentions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
  decodeForEditing,
  encodeMentions,
  extractMentionIds,
  findMentionQuery,
  matchCandidates,
  renderMentionsAsText,
  splitMentions,
} from "@/lib/mentions";

const BRIGGS = "4b6b3f1e-ca77-44da-b2e0-47d10afa0a9b";
const ANA = "0b1f6a2c-1111-4d3e-9c8a-2f4b6d8e0a11";
const names: Record<string, string> = { [BRIGGS]: "Briggs Pedrera", [ANA]: "Ana Beth" };
const resolve = (id: string) => names[id] ?? null;

describe("storing a mention", () => {
  it("swaps the typed label for the account id", () => {
    const body = encodeMentions("@Briggs Pedrera can you look?", [{ id: BRIGGS, label: "Briggs Pedrera" }]);
    expect(body).toBe(`@[${BRIGGS}] can you look?`);
  });

  it("does not let a shorter name eat a longer one", () => {
    // "Ana" is also on the team; "@Ana Beth" must not become "@[ana] Beth".
    const body = encodeMentions("@Ana Beth and @Ana", [
      { id: ANA, label: "Ana Beth" },
      { id: BRIGGS, label: "Ana" },
    ]);
    expect(body).toBe(`@[${ANA}] and @[${BRIGGS}]`);
  });

  it("drops a mention whose text the writer edited away", () => {
    // They picked Briggs, then rewrote the sentence. The note no longer names
    // them, so it should not notify them either.
    const body = encodeMentions("actually never mind", [{ id: BRIGGS, label: "Briggs Pedrera" }]);
    expect(body).toBe("actually never mind");
    expect(extractMentionIds(body)).toEqual([]);
  });

  it("reports each mentioned account once, however often they are named", () => {
    const body = `@[${BRIGGS}] and again @[${BRIGGS}] and @[${ANA}]`;
    expect(extractMentionIds(body)).toEqual([BRIGGS, ANA]);
  });

  it("finds nothing in ordinary prose", () => {
    expect(extractMentionIds("email me at a@b.test about [this]")).toEqual([]);
    expect(extractMentionIds(null)).toEqual([]);
  });
});

describe("rendering a mention", () => {
  it("shows what the person is called now, not when it was written", () => {
    const body = `@[${BRIGGS}] please review`;
    expect(renderMentionsAsText(body, resolve)).toBe("@Briggs Pedrera please review");

    const renamed = (id: string) => (id === BRIGGS ? "B. Pedrera" : null);
    expect(renderMentionsAsText(body, renamed)).toBe("@B. Pedrera please review");
  });

  it("still renders a mention whose account cannot be resolved", () => {
    // Blanking it would silently rewrite what the note said.
    expect(renderMentionsAsText(`@[${BRIGGS}] hi`, () => null)).toBe("@someone hi");
  });

  it("splits the body so the mention can be styled apart from the prose", () => {
    expect(splitMentions(`hey @[${BRIGGS}], see this`, resolve)).toEqual([
      { type: "text", value: "hey " },
      { type: "mention", id: BRIGGS, value: "@Briggs Pedrera" },
      { type: "text", value: ", see this" },
    ]);
  });

  it("leaves a body with no mentions as one run of text", () => {
    expect(splitMentions("nothing to see", resolve)).toEqual([{ type: "text", value: "nothing to see" }]);
  });
});

describe("typing a mention", () => {
  it("opens on an @ that starts a word", () => {
    expect(findMentionQuery("hey @bri", 8)).toEqual({ query: "bri", start: 4 });
    expect(findMentionQuery("@", 1)).toEqual({ query: "", start: 0 });
  });

  it("stays shut inside an email address", () => {
    expect(findMentionQuery("write to ana@wyn.io", 19)).toBeNull();
  });

  it("stops at a line break and after two words", () => {
    expect(findMentionQuery("@bri\nnext line", 14)).toBeNull();
    expect(findMentionQuery("@Ana Beth Carter and", 20)).toBeNull();
  });

  it("allows a two-word name, so full names can be matched", () => {
    expect(findMentionQuery("@Ana Bet", 8)).toEqual({ query: "Ana Bet", start: 0 });
  });
});

describe("choosing who to mention", () => {
  const team = [
    { id: BRIGGS, name: "Briggs Pedrera", email: "briggs@wyn.io" },
    { id: ANA, name: "Ana Beth", email: "ana@wyn.io" },
  ];

  it("prefers a name that starts with what was typed", () => {
    const hit = matchCandidates([...team, { id: "x", name: "Joana", email: null }], "ana");
    expect(hit[0].name).toBe("Ana Beth");
  });

  it("matches on email too, for two people with the same name", () => {
    expect(matchCandidates(team, "briggs@").map((c) => c.id)).toEqual([BRIGGS]);
  });

  it("offers everyone before anything is typed", () => {
    expect(matchCandidates(team, "")).toHaveLength(2);
  });
});

describe("the token pattern the database also has to agree with", () => {
  const migration = readFileSync(
    resolvePath(process.cwd(), "supabase/migrations/20260908130000_internal_note_mentions.sql"),
    "utf8",
  );

  /**
   * A loose `[0-9a-fA-F-]{36}` matches 36 dashes, which is not a uuid. The
   * trigger casts what it matches, so such a body would raise on `::uuid` and
   * fail the insert of the note itself — not merely the notification.
   */
  it("ignores something uuid-shaped only by length", () => {
    expect(extractMentionIds(`@[${"-".repeat(36)}] hi`)).toEqual([]);
    expect(extractMentionIds("@[not-a-uuid] hi")).toEqual([]);
  });

  it("uses the same full uuid shape in SQL as in TypeScript", () => {
    expect(migration).not.toMatch(/\[0-9a-fA-F-\]\{36\}/);
    expect(migration).toContain("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
  });

  it("only ever notifies on an internal note", () => {
    expect(migration).toContain("IF NOT NEW.is_internal THEN");
  });

  it("does not notify the author, a non-teammate, or a mention that was already there", () => {
    expect(migration).toContain("mentioned = actor");
    expect(migration).toContain("NOT public.is_team_member(mentioned)");
    expect(migration).toContain("mentioned = ANY(already)");
  });

  it("keeps notifications trigger-written, with no INSERT policy of their own", () => {
    // The rule set by 20260825180000: nobody can put words in someone else's bell.
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]*?FOR INSERT[\s\S]*?ON public\.notifications/);
  });
});

describe("mentions stay on the team's side of the wall", () => {
  const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), "utf8");

  it("encodes tokens only for an internal note", () => {
    // A public reply is stored exactly as typed, so a client never receives a
    // token and nobody is notified for a message addressed to them.
    expect(read("src/pages/Feedback.tsx")).toContain("isInternal ? encodeMentions(");
    expect(read("src/components/review/ReviewSidebar.tsx")).toContain("mentionsOn ? encodeMentions(");
  });

  it("offers the picker only on the internal composer", () => {
    expect(read("src/pages/Feedback.tsx")).toContain('noteKind === "internal" ? mentionCandidates : undefined');
    expect(read("src/components/review/ReviewSidebar.tsx"))
      .toContain('const mentionsOn = mode === "internal" && internal?.replyKind === "internal"');
  });
});

describe("editing a note that mentions someone", () => {
  it("shows names in the box and puts the ids back on save", () => {
    const stored = `@[${BRIGGS}] and @[${ANA}] please look`;
    const { text, pending } = decodeForEditing(stored, resolve);

    // No raw token is ever put in front of the writer...
    expect(text).toBe("@Briggs Pedrera and @Ana Beth please look");
    expect(text).not.toContain("@[");

    // ...and saving it untouched round-trips to exactly what was stored.
    expect(encodeMentions(text, pending)).toBe(stored);
  });

  it("keeps a mention the writer left alone while they edit the rest", () => {
    const { text, pending } = decodeForEditing(`@[${BRIGGS}] please look`, resolve);
    expect(encodeMentions(text.replace("please look", "any thoughts?"), pending))
      .toBe(`@[${BRIGGS}] any thoughts?`);
  });

  it("drops a mention the writer deleted", () => {
    const { pending } = decodeForEditing(`@[${BRIGGS}] please look`, resolve);
    expect(extractMentionIds(encodeMentions("please look", pending))).toEqual([]);
  });
});

describe("no surface shows a raw token", () => {
  const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), "utf8");

  /**
   * The bug this guards: the feedback list rendered the stored body straight
   * into the row, so the latest-reply preview read
   * "↳ [internal] Admin: @[4b6b3f1e-…] you…".
   */
  it("resolves mentions in the inbox list preview", () => {
    expect(read("src/pages/Feedback.tsx"))
      .toContain("renderMentionsAsText(latestReplyMap[it.id].body, resolveName)");
  });

  it("opens the reply editor on names, not ids", () => {
    const sidebar = read("src/components/review/ReviewSidebar.tsx");
    expect(sidebar).toContain("decodeForEditing(r.body, resolveMention)");
    expect(sidebar).not.toContain("setEditingReply({ id: r.id, value: r.body })");
  });

  it("renders every thread body through the shared component", () => {
    for (const file of ["src/pages/Feedback.tsx", "src/components/review/ReviewSidebar.tsx"]) {
      expect(read(file), `${file} prints a comment body unresolved`)
        .not.toMatch(/whitespace-pre-wrap">\{(c|r)\.body\}/);
    }
  });
});

describe("a mention notifies the person named, and only them", () => {
  const migration = readFileSync(
    resolvePath(process.cwd(), "supabase/migrations/20260908130000_internal_note_mentions.sql"),
    "utf8",
  );

  it("addresses the notification to the mentioned account", () => {
    // One row per person named — never a broadcast to the team.
    expect(migration).toMatch(/INSERT INTO public\.notifications[\s\S]*?VALUES\s*\(\s*mentioned,/);
    expect(migration).toContain("'comment_mention'");
    expect(migration).toContain("' mentioned you in a note'");
  });

  it("keeps internal notes out of the feed every teammate sees", () => {
    // The bell's shared activity is guest-authored public replies only, so an
    // internal note reaches exactly the people it names and nobody else.
    const bell = readFileSync(resolvePath(process.cwd(), "src/components/NotificationBell.tsx"), "utf8");
    expect(bell).toContain('.eq("is_internal", false)');
    expect(bell).toContain("filter: `user_id=eq.${user.id}`");
  });

  it("gives a mention its own kind and icon rather than borrowing assignment's", () => {
    const bell = readFileSync(resolvePath(process.cwd(), "src/components/NotificationBell.tsx"), "utf8");
    expect(bell).toContain('n.kind === "comment_mention" ? "mention" : "assigned"');
    expect(bell).toContain("mention: AtSign");
  });
});
