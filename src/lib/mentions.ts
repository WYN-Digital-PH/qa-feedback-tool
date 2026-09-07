/**
 * Mentioning a teammate in an internal note.
 *
 * A mention is stored as `@[<user id>]`, never as the name that was typed.
 * This is the same reasoning as `displayName.ts`: the account is the durable
 * identity and the name is a label that changes. A note saying "@Briggs
 * Pedrera should look at this" would still say that after Briggs renamed
 * themselves, and would point at nobody in particular; a stored id re-renders
 * as whatever they are called today.
 *
 * The composer keeps a plain textarea — the token never appears while typing.
 * It tracks what it inserted (`PendingMention`) and swaps the labels for tokens
 * on submit, which is what `encodeMentions` does.
 */

import type { ResolveName } from "@/lib/displayName";

/**
 * `@[uuid]`. The brackets are what stop it colliding with ordinary prose, and
 * the full uuid shape -- rather than 36 loose characters -- is what keeps this
 * in step with the database trigger, where a match that is not castable to
 * `uuid` would raise and fail the insert.
 */
const MENTION_TOKEN =
  /@\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/g;

/** What the composer inserted: the account, and the exact text it wrote. */
export interface PendingMention {
  id: string;
  /** The label as typed into the textarea, without the leading "@". */
  label: string;
}

/** Someone who can be mentioned. */
export interface MentionCandidate {
  id: string;
  name: string;
  /** Shown in the picker to tell two identical names apart. */
  email?: string | null;
}

/** The user ids mentioned in a stored body, in order, without duplicates. */
export function extractMentionIds(body?: string | null): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const id = match[1].toLowerCase();
    if (!seen.has(id)) seen.add(id);
  }
  return [...seen];
}

/**
 * Swaps each inserted label for its token, ready to store.
 *
 * Longest label first, so "@Ana Beth" is not half-consumed by a "@Ana" who is
 * also on the team. A label the writer has since edited away simply isn't
 * found, and that mention quietly doesn't happen — which is the right outcome:
 * the text no longer names them.
 */
export function encodeMentions(text: string, pending: readonly PendingMention[]): string {
  let out = text;
  const byLength = [...pending].sort((a, b) => b.label.length - a.label.length);
  for (const { id, label } of byLength) {
    if (!label) continue;
    out = out.split(`@${label}`).join(`@[${id}]`);
  }
  return out;
}

export type MentionPart =
  | { type: "text"; value: string }
  | { type: "mention"; id: string; value: string };

/**
 * Splits a stored body into text and mention runs for rendering.
 *
 * An id nobody can resolve still renders as a mention — the note did address
 * someone, and blanking it out would silently rewrite what was written.
 */
export function splitMentions(body: string | null | undefined, resolve?: ResolveName): MentionPart[] {
  if (!body) return [];
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ type: "text", value: body.slice(last, start) });
    const id = match[1].toLowerCase();
    parts.push({ type: "mention", id, value: `@${resolve?.(id) ?? "someone"}` });
    last = start + match[0].length;
  }
  if (last < body.length) parts.push({ type: "text", value: body.slice(last) });
  return parts;
}

/** The body as prose — for previews, titles and anywhere without JSX. */
export function renderMentionsAsText(body: string | null | undefined, resolve?: ResolveName): string {
  return splitMentions(body, resolve).map((p) => p.value).join("");
}

/**
 * The `@query` being typed immediately before the caret, if any.
 *
 * Returns null unless the "@" starts a word — an email address in the middle of
 * a sentence should not open a people picker. The query stops at a newline, and
 * spans at most two words so "@Briggs Pedrera" can be matched by full name
 * without the picker following the writer into the next sentence.
 */
export function findMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;

  const before = at === 0 ? "" : upto[at - 1];
  if (before && !/\s/.test(before)) return null;

  const query = upto.slice(at + 1);
  if (/[\n\r]/.test(query)) return null;
  if (query.split(" ").length > 2) return null;

  return { query, start: at };
}

/** Candidates matching what has been typed so far, best-first, capped. */
export function matchCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  limit = 6,
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  const scored = candidates.filter((c) => {
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
  });
  // A name that starts with the query is a better answer than one that merely
  // contains it.
  scored.sort((a, b) => {
    const as = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bs = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    return as - bs || a.name.localeCompare(b.name);
  });
  return scored.slice(0, limit);
}

/**
 * A stored body turned back into something editable.
 *
 * The editor shows names, not tokens, so it needs both the readable text and
 * the mentions that produced it — otherwise re-encoding on save would lose
 * every mention the writer left untouched, or worse, leave a raw
 * `@[4b6b3f1e-...]` sitting in the box for them to delete by hand.
 */
export function decodeForEditing(
  body: string | null | undefined,
  resolve?: ResolveName,
): { text: string; pending: PendingMention[] } {
  const parts = splitMentions(body, resolve);
  const pending: PendingMention[] = [];
  for (const part of parts) {
    if (part.type !== "mention") continue;
    const label = part.value.slice(1);
    if (!pending.some((p) => p.id === part.id)) pending.push({ id: part.id, label });
  }
  return { text: parts.map((p) => p.value).join(""), pending };
}
