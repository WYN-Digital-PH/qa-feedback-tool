/**
 * The permission vocabulary, mirrored from the `permissions` table.
 *
 * The database is the authority — every rule is enforced by RLS — but the app
 * needs the same keys to decide what to show, and typing them here means a
 * typo in a `can()` call is a compile error rather than a silently hidden
 * button. `docs/ROLES_AND_PERMISSIONS.md` documents what each one covers.
 */

export const PERMISSION_KEYS = [
  "clients.view",
  "clients.create",
  "clients.update",
  "clients.delete",
  "projects.view",
  "projects.create",
  "projects.update",
  "projects.delete",
  "canvases.view",
  "canvases.create",
  "canvases.update",
  "canvases.delete",
  "feedback.view",
  "feedback.comment",
  "feedback.triage",
  "feedback.assign",
  "feedback.resolve",
  "feedback.delete",
  "labels.manage",
  "team.manage",
] as const;

export type Permission = (typeof PERMISSION_KEYS)[number];

export const ROLES = ["owner", "admin", "consultant", "developer", "qa", "viewer"] as const;

export type Role = (typeof ROLES)[number];

/** Short description of what each role is for, shown in Settings. */
export const ROLE_SUMMARY: Record<Role, string> = {
  owner: "Full control, including these permission settings. Cannot be restricted.",
  admin: "Runs the workspace day to day — everything except editing permissions.",
  consultant: "Delivers client work end to end, but cannot delete records.",
  developer: "Works assigned feedback and hands it to QA. Cannot sign work off.",
  qa: "Verifies fixes and owns the final resolve or close.",
  viewer: "Read-only access for stakeholders.",
};

/** Roles whose grants an owner may edit — `owner` is always all-access. */
export const EDITABLE_ROLES: Role[] = ROLES.filter((r) => r !== "owner");

/**
 * A resolved permission set for the signed-in user.
 * `has` is the only way the app should ask "may I?".
 */
export interface PermissionSet {
  has: (permission: Permission) => boolean;
  keys: ReadonlySet<string>;
}

export function makePermissionSet(keys: Iterable<string>): PermissionSet {
  const set = new Set(keys);
  return { has: (permission) => set.has(permission), keys: set };
}

export const EMPTY_PERMISSIONS: PermissionSet = makePermissionSet([]);
