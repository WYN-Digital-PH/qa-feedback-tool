/**
 * One answer to "whose name goes here".
 *
 * The same account appeared under three names at once: `developer@wyndigital.io`
 * on the dashboard, the canvas sidebar and the board; `Team` in the feedback
 * inbox; and `Briggs Pedrera` on thread replies and in the assignee picker.
 * Each surface had grown its own fallback chain, and they disagreed about both
 * the order to try things in and what to say when everything was missing.
 *
 * The deeper cause is that a team member's feedback is stamped with their email
 * at write time — `submit-internal-feedback` sets `guest_name: user.email` — so
 * any surface reading `guest_name` first shows an address, forever, no matter
 * what the person later calls themselves in Settings.
 *
 * The row also carries `created_by_user_id`, which is the durable identity: it
 * still resolves to the right person after they change their display name.
 * Everything here prefers that, and treats `guest_name` as what it is — a label
 * for someone with no account, or a stale copy for someone who has one.
 */

export type ProfileLike = {
  id: string;
  full_name?: string | null;
  email?: string | null;
};

/** Resolves a user id to a display name, or null when the id is unknown. */
export type ResolveName = (userId: string) => string | null;

function clean(v?: string | null): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
}

/**
 * A profile's name. Full name first, email only as a fallback — an address is
 * an identifier, not what a colleague is called.
 */
export function profileName(p?: ProfileLike | null): string | null {
  if (!p) return null;
  return clean(p.full_name) ?? clean(p.email);
}

/** Builds a resolver from a loaded profiles list. Safe to call with undefined. */
export function makeNameResolver(profiles?: ProfileLike[] | null): ResolveName {
  const byId = new Map<string, ProfileLike>();
  (profiles ?? []).forEach((p) => { if (p?.id) byId.set(p.id, p); });
  return (userId: string) => (userId ? profileName(byId.get(userId)) : null);
}

export interface PersonRef {
  /** The account that wrote it, when an account did. */
  userId?: string | null;
  /** The name a guest gave — or, on older team rows, their email. */
  guestName?: string | null;
  guestEmail?: string | null;
  /** "team" or "guest", where the row records it. */
  createdByType?: string | null;
}

/**
 * The name to show for whoever produced a row.
 *
 * Order matters and is the whole point of this living in one place:
 *
 *   1. the profile behind `userId` — current, and what Settings shows
 *   2. the name a guest supplied
 *   3. a guest's email, if that is all they left
 *   4. "Team member" when we know it was one but cannot name them
 *   5. "Guest"
 *
 * Step 4 exists so an unresolvable teammate never reads as an outside
 * reviewer — the two are not interchangeable on a client-facing canvas.
 */
export function personName(ref: PersonRef, resolve?: ResolveName): string {
  const userId = clean(ref.userId);
  if (userId && resolve) {
    const resolved = clean(resolve(userId));
    if (resolved) return resolved;
  }

  const guest = clean(ref.guestName);
  if (guest) return guest;

  const email = clean(ref.guestEmail);
  if (email) return email;

  if (userId || ref.createdByType === "team") return "Team member";
  return "Guest";
}

/** The author of a feedback item. Its account column is `created_by_user_id`. */
export function feedbackAuthor(
  item: {
    created_by_user_id?: string | null;
    created_by_type?: string | null;
    guest_name?: string | null;
    guest_email?: string | null;
  } | null | undefined,
  resolve?: ResolveName,
): string {
  if (!item) return "Guest";
  return personName(
    {
      userId: item.created_by_user_id,
      guestName: item.guest_name,
      guestEmail: item.guest_email,
      createdByType: item.created_by_type,
    },
    resolve,
  );
}

/** The author of a reply. Its account column is `user_id`. */
export function commentAuthor(
  comment: {
    user_id?: string | null;
    guest_name?: string | null;
    guest_email?: string | null;
    profiles?: ProfileLike | null;
  } | null | undefined,
  resolve?: ResolveName,
): string {
  if (!comment) return "Guest";
  // An embedded profile is already the answer when PostgREST returned one.
  const embedded = profileName(comment.profiles);
  if (embedded) return embedded;
  return personName(
    { userId: comment.user_id, guestName: comment.guest_name, guestEmail: comment.guest_email },
    resolve,
  );
}
