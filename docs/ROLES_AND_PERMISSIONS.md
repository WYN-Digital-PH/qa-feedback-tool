# Roles and permissions

Everyone signed in to the workspace holds exactly one **role**. A role is just a
named bundle of **permissions**, and the owner decides which permissions each
bundle contains.

Two things follow from that:

- **The database enforces it, not the screen.** Every permission is checked by a
  row-level security policy in Postgres. Hiding a button is a convenience; the
  rule holds even if someone calls the API directly.
- **Changes take effect immediately.** Ticking a box in Settings rewrites what
  the database itself allows. There is no deploy step.

---

## Part 1 — The roles

| Role | Intended for | In short |
| --- | --- | --- |
| **Owner** | Whoever owns the workspace | Everything, always. Cannot be restricted. |
| **Admin** | Operations lead | Runs the workspace day to day — everything except editing this matrix. |
| **Consultant** | Client-facing delivery lead | Runs client work end to end, but cannot delete records. |
| **Developer** | Whoever implements fixes | Works assigned feedback and hands it to QA. Cannot sign work off. |
| **QA** | Whoever verifies fixes | Works feedback and owns the final resolve or close. |
| **Viewer** | Stakeholders, clients internally | Read-only. |

**No access** is also a state: a user with no role at all can sign in but sees
nothing. New sign-ups land here unless they used an invite link — the first
account ever created becomes the owner.

### Two rules that are not configurable

These are enforced in the database and deliberately cannot be turned off:

1. **The owner always holds every permission.** Their rows in the matrix are
   locked. This is what stops a workspace from locking itself out of its own
   settings.
2. **Only an owner can create another owner**, or change this matrix — no
   matter who else holds *Manage team*. Otherwise anyone able to manage members
   could promote themselves.

---

## Part 2 — The permissions

Twenty permissions, grouped the way they appear in Settings. The key in
`monospace` is what appears in the database and in the code.

### Agencies

| Permission | Key | What it allows |
| --- | --- | --- |
| View agencies | `clients.view` | See the agency list and agency details. Turning this off hides the Agencies section for that role. |
| Create agencies | `clients.create` | Add a new agency. |
| Edit agencies | `clients.update` | Change contact details, website and notes, and **archive or restore** the agency. |
| Delete agencies | `clients.delete` | Permanently remove an agency **and every project, canvas, uploaded file and piece of feedback filed under it**. Irreversible — archiving is `clients.update`. |

### Projects

| Permission | Key | What it allows |
| --- | --- | --- |
| View projects | `projects.view` | See the project list and project details. |
| Create projects | `projects.create` | Start a new project for an agency. |
| Edit projects | `projects.update` | Rename a project, and **archive or restore** it. |
| Delete projects | `projects.delete` | Permanently remove a project **and its canvases, their uploaded files and all their feedback**. Irreversible — archiving is `projects.update`. |

### Canvases

| Permission | Key | What it allows |
| --- | --- | --- |
| View canvases | `canvases.view` | Open review canvases and see their share links. |
| Create canvases | `canvases.create` | Add a website, image or PDF canvas, generate its review link, and upload canvas files. |
| Edit canvases | `canvases.update` | Rename a canvas, change its settings, pause or resume client commenting, and **archive or restore** it. Archiving closes the public review link without discarding anything. |
| Delete canvases | `canvases.delete` | Permanently remove a canvas **along with its uploaded file, feedback, replies and approval decisions**. The shared review link stops working immediately. Irreversible — archiving is `canvases.update`. |

### Feedback

| Permission | Key | What it allows |
| --- | --- | --- |
| View feedback | `feedback.view` | Read client feedback, replies and internal notes. Also needed to see labels and approval decisions. |
| Comment and pin | `feedback.comment` | Reply to feedback, add internal notes, and drop team pins on a canvas. Also allows editing your **own** comments. |
| Triage feedback | `feedback.triage` | Change status, priority, category and labels on an item. Excludes resolving — see below. |
| Assign feedback | `feedback.assign` | Assign an item to a team member. The assignee is notified in the app, and an item still sitting on **New** or **In review** moves to **Assigned**. |
| Resolve and close | `feedback.resolve` | Move an item to **Resolved** or **Closed** — the final sign-off. Also marks a client's round of requested changes as addressed. |
| Delete feedback | `feedback.delete` | Delete feedback items and replies, and edit **other people's** comments. This is the moderation permission. |

> **Why triage and resolve are separate.** The status flow includes *Ready for
> QA*. A developer with `feedback.triage` but not `feedback.resolve` can move
> work all the way to Ready for QA and no further; QA closes it. If you don't
> want that separation, grant both to everyone who triages.

### Workspace

| Permission | Key | What it allows |
| --- | --- | --- |
| Manage labels | `labels.manage` | Create, rename, recolour and delete the shared label set. Applying an existing label to an item is `feedback.triage`, not this. |
| Manage team | `team.manage` | Invite people, revoke invites, and change member roles. Cannot grant the owner role — that stays owner-only. |

---

## Part 3 — Default matrix

What each role starts with, and what **Reset to defaults** restores.

| Permission | Owner | Admin | Consultant | Developer | QA | Viewer |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `clients.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `clients.create` | ✅ | ✅ | ✅ | — | — | — |
| `clients.update` | ✅ | ✅ | ✅ | — | — | — |
| `clients.delete` | ✅ | ✅ | — | — | — | — |
| `projects.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `projects.create` | ✅ | ✅ | ✅ | — | — | — |
| `projects.update` | ✅ | ✅ | ✅ | — | — | — |
| `projects.delete` | ✅ | ✅ | — | — | — | — |
| `canvases.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `canvases.create` | ✅ | ✅ | ✅ | — | — | — |
| `canvases.update` | ✅ | ✅ | ✅ | — | — | — |
| `canvases.delete` | ✅ | ✅ | — | — | — | — |
| `feedback.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `feedback.comment` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `feedback.triage` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `feedback.assign` | ✅ | ✅ | ✅ | — | ✅ | — |
| `feedback.resolve` | ✅ | ✅ | ✅ | — | ✅ | — |
| `feedback.delete` | ✅ | ✅ | — | — | — | — |
| `labels.manage` | ✅ | ✅ | ✅ | — | ✅ | — |
| `team.manage` | ✅ | ✅ | — | — | — | — |

### What changed from the previous behaviour

If you ran this tool before permissions became configurable, three things are
now different — all of them tightening genuine gaps:

- **Viewer is finally read-only.** It could previously create agencies,
  projects and canvases, and write feedback and replies, because an early
  migration opened those writes to every signed-in member.
- **Developer and QA now mean something.** Both used to resolve to exactly the
  same rights as Viewer. They now carry their own grants, and only QA signs
  work off by default.
- **Consultant no longer deletes.** It kept edit rights but lost delete rights,
  which it never had by design anyway.

If any of this is stricter than your team needs, change it — that is the point.

---

## Part 4 — Owner's manual: customising permissions

> Only the workspace owner can change permissions, and only owners and admins
> can see this screen at all — it is a map of the whole workspace's access
> model. Everyone else sees their own role under **Settings → Account**.

### Where it lives

**Settings → Roles & permissions**, for owners and admins. An admin sees the
matrix read-only; only an owner can change it.

The grid has one row per permission and one column per role. A tick means that
role is allowed. The **Owner** column is always ticked and always disabled.

### Changing a permission

1. Go to **Settings → Roles & permissions**.
2. Find the row for the permission and the column for the role.
3. Tick or untick the box.

That is the whole flow — there is no Save button. Each box saves on click, and
the change is live for everyone the moment it saves. People already signed in
pick it up on their next page load or navigation; ask them to refresh if you
need it to apply instantly.

If a change is rejected you'll see *"Only the workspace owner can change
permissions"* and the box will flip back. That means you are not signed in as
an owner.

### Starting over

**Reset to defaults** returns every role to the matrix in Part 3. It asks for
confirmation first, and it does **not** change anyone's assigned role — only
what each role is allowed to do.

### Changing what someone can do

There are two different levers, and picking the wrong one is the most common
mistake:

| You want to… | Do this |
| --- | --- |
| Change what **one person** can do | **Settings → Team → Members** — give them a different role |
| Change what **everyone with a role** can do | **Settings → Roles & permissions** — edit that role's column |

Editing a role's column affects every current and future holder of that role.
If you only want to make an exception for one person, move them to a different
role instead.

### Worked examples

**"Our developers should close their own tickets."**
Tick `feedback.resolve` for Developer. They can now move items to Resolved and
Closed without waiting for QA.

**"Consultants keep deleting canvases by accident."**
They can't by default. If you granted `canvases.delete` earlier, untick it —
they keep edit and pause rights.

**"A client stakeholder needs to leave notes, but must not change anything."**
Give them the Viewer role, then tick `feedback.comment` for Viewer. They can
reply but still can't triage, assign, resolve or create anything.
⚠️ Remember this applies to *every* viewer, not just that one person. If other
viewers must stay silent, put the stakeholder on a different role instead.

**"Our QA lead should manage the team as well."**
Tick `team.manage` for QA. They can then invite people and change roles — but
still cannot grant the owner role, or edit this matrix.

**"I want a second owner."**
Owners are not created here. Go to **Settings → Team → Members** and set that
person's role to Owner. Only an existing owner sees that option.

### Safety notes

- **You cannot lock yourself out.** Owner permissions are immutable, and a
  database trigger refuses to remove or demote the last owner — not just the
  Settings screen, so a direct API call can't do it either. Hand the owner role
  to someone else first if you need to step down.
- **Turning off a `*.view` permission hides that whole area** for the role. If
  someone reports an empty Projects page, check `projects.view` first.
- **Deletes cascade, and archiving does not.** `clients.delete` removes
  everything under an agency and `projects.delete` removes a project's canvases,
  uploaded files included. Grant them sparingly — the defaults limit both to
  Owner and Admin. Archiving lives under the matching `*.update` permission and
  is always reversible, so most teams want `update` widely and `delete` narrow.
- **Existing sessions are not force-refreshed.** Someone mid-session keeps the
  permissions their app last loaded until they navigate or refresh. The
  database rejects anything they are no longer allowed to do regardless, so
  this is a display lag, never a security hole.

---

## Part 5 — For developers

### Where each piece lives

| Concern | Location |
| --- | --- |
| Catalogue of permissions | `permissions` table, seeded in `supabase/migrations/20260825140000_customizable_role_permissions.sql` |
| Per-role grants | `role_permissions` table |
| Recommended defaults | `public.default_role_permissions()` |
| The check RLS uses | `public.has_permission(uid, key)` |
| The check the app uses | `public.my_permissions()` → `useAuth().can(key)` |
| The check edge functions use | `public.user_has_permission(uid, key)` (service role only) |
| Typed keys for the frontend | `src/lib/permissions.ts` |
| Settings UI | `src/components/settings/RolePermissions.tsx` |

### Gating something in the UI

```tsx
const { can } = useAuth();

{can("projects.create") && <Button onClick={createProject}>New project</Button>}
```

`can()` is typed against `Permission`, so a mistyped key fails the build rather
than silently hiding a button. UI gating is only ever cosmetic — always add the
matching RLS policy.

### Adding a new permission

1. Insert a row into `permissions` in a new migration (key, category, label,
   description, sort order).
2. Add it to the relevant role arrays in `default_role_permissions()`, and
   backfill `role_permissions` for existing workspaces.
3. Add the key to `PERMISSION_KEYS` in `src/lib/permissions.ts`.
4. Write the policy that enforces it: `USING (public.has_permission(auth.uid(),
   'your.key'))`.
5. Document it in Part 2 and add a column entry in Part 3.

The Settings matrix is generated from the `permissions` table, so it picks up
the new row with no UI change.

### Column-level rules

`feedback.assign`, `feedback.resolve` and `feedback.delete` restrict *which
columns* an update may touch, which a row policy cannot express — `WITH CHECK`
sees the new row but never what changed. These are enforced by the trigger
`enforce_feedback_update_permissions()`, which compares `OLD` to `NEW`.

That trigger returns early when `auth.uid()` is `NULL`, which is how guest
submissions and screenshot callbacks running under the service role continue to
work. Service-role callers bypass RLS by design, so any edge function acting on
behalf of a signed-in user must check `user_has_permission()` itself — see
`submit-internal-feedback` and `upload-canvas-file` for the pattern.
