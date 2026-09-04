# Deployment checklist

Everything that has to be true before this is safe to put in front of a client.
Items marked **blocker** will break the product outright if skipped — most of
them fail silently, which is why they are written down.

---

## 1. Database migrations

Apply every file in `supabase/migrations/` in filename order:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

The recent ones change live behaviour and deserve a staging run first:

| Migration | What it changes |
| --- | --- |
| `20260825120000_feedback_element_anchors.sql` | Adds anchor columns to `feedback_items`. Additive, safe. |
| `20260825140000_customizable_role_permissions.sql` | **Rewrites ~30 RLS policies.** Tightens access for `viewer`, `developer` and `qa`. |
| `20260825160000_record_lifecycle.sql` | Re-points `client_id` foreign keys to `ON DELETE CASCADE`, adds the missing `feedback_labels` foreign keys, constrains `projects.status`. |
| `20260825170000_owner_safety.sql` | Adds the trigger that refuses to remove the last owner. |
| `20260825180000_assignment_notifications.sql` | Adds the `notifications` table, notifies an assignee, and moves a newly assigned item off **New**. Backfills existing assigned-but-`new` items. |
| `20260905090000_four_feedback_statuses.sql` | **Rewrites the `feedback_status` enum from eight values to four.** Remaps `in_review`/`assigned`/`changes_needed` to `new` and `closed` to `resolved`, drops the trigger that turned assignment into a status, and recreates the sign-off permission gate. |

> **blocker** — `20260905090000` swaps the column onto a new enum type and
> drops the old one. It is not reversible by re-running an earlier migration:
> once `in_review`, `assigned`, `changes_needed` and `closed` are gone, the
> rows that held them cannot be told apart from rows that were always `new`.
> Take a backup, and run it on staging first — the remap is the point, but it
> is a one-way door.

> **blocker** — `20260825160000` deletes orphaned `feedback_labels` rows before
> it can add the foreign keys. That is the point (they reference records that no
> longer exist), but take a backup first so the count is recoverable if you want
> to audit it.

After `20260825140000`, anyone currently on `viewer`, `developer` or `qa` loses
create rights they had in practice. Either move them to `consultant` or grant
the permission back under **Settings → Roles & permissions**.

---

## 2. Auth configuration (Supabase dashboard)

### Redirect URLs — **blocker**

**Authentication → URL Configuration**

| Setting | Value |
| --- | --- |
| Site URL | `https://your-domain.com` |
| Redirect URLs | `https://your-domain.com/reset-password`<br>`https://your-domain.com/dashboard` |

Supabase silently rewrites any `redirectTo` that is not on this allowlist back
to the Site URL. The symptom is not an error: the password-reset email arrives,
the link works, and the user lands on the dashboard or the login page with no
way to set a password — and the recovery token is spent. Add a localhost entry
too if you develop against the same project.

### Email delivery — **blocker for anything beyond a pilot**

**Project Settings → Authentication → SMTP Settings**

The built-in email service is rate limited to a handful of messages per hour
across the whole project and is explicitly not for production. Once it is
exhausted, signup confirmations and password resets stop arriving, with
`over_email_send_rate_limit` surfacing to the user as "too many emails sent
recently". Configure your own SMTP provider before onboarding a real team.

### Email templates

The default **Reset Password** template is fine. If you customise it, keep
`{{ .ConfirmationURL }}` — that is what carries the recovery token.

### Signup

Leave **Confirm email** on. A new account with no invite receives *no role* and
sees nothing until an owner assigns one, so open signup is not an exposure — but
email confirmation is still what stops someone claiming an address they do not
control, and invites are matched on email.

---

## 3. Hosting

### SPA rewrite — **blocker**

Every unknown path must serve `index.html`. Without it, `/review/<token>` — the
link you send clients — returns 404 whenever it is opened fresh rather than
navigated to in-app. So does `/reset-password` from an email.

Two configs ship in the repo:

- `public/_redirects` — Netlify, Cloudflare Pages
- `vercel.json` — Vercel

For anything else (nginx, S3 + CloudFront, Amplify), configure the equivalent
fallback yourself. **Test it by pasting a review link into a fresh incognito
window**, not by clicking through the app.

### Build

```bash
npm ci
npm run build      # outputs to dist/
```

Environment variables must be present **at build time** — Vite inlines them.
Changing a `VITE_*` value means rebuilding, not restarting.

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | The anon/publishable key. Safe in the bundle. |
| `VITE_SUPABASE_PROJECT_ID` | yes | |
| `VITE_BRAND_*` | no | See `docs/WHITE_LABELING.md`. |

Never put the service role key in a `VITE_*` variable — it would ship to every
browser. It belongs only in edge function secrets.

---

## 4. Edge functions

```bash
supabase functions deploy
```

`supabase/config.toml` sets `verify_jwt = false` for the nine functions the
public review page calls without a session. `upload-canvas-file` is deliberately
absent from that list — it requires a signed-in caller and checks
`canvases.create` itself, because the service role bypasses RLS.

Secrets each function needs (`supabase secrets set`): `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically; anything else the
screenshot function uses must be set explicitly.

---

## 5. Storage

Two public buckets, both created by migrations:

| Bucket | Contents |
| --- | --- |
| `canvas-files` | Uploaded images and PDFs for non-website canvases |
| `screenshots` | Captured screenshots attached to feedback |

Deleting an agency, project or canvas removes its `canvas-files` objects — the
app does that explicitly, because no database cascade can reach storage. If a
purge fails the toast says so; the record is still deleted, so re-run a bucket
cleanup if you see that warning.

**Screenshots are not purged with their feedback item.** They are written by the
service role from an edge function and only their URL is stored. If storage cost
matters, schedule a sweep for objects with no matching `feedback_items.screenshot_url`.

---

## 6. Before the first client link goes out

- [ ] Sign up the first account — it becomes the **owner** automatically.
- [ ] Invite the rest of the team under **Settings → Team → Invites**. An invite
      grants its role on signup; signing up without one grants nothing.
- [ ] Review **Settings → Roles & permissions** against how your team works.
- [ ] Create an agency, a project and a canvas, then open the review link in a
      **private window** and leave a comment as a guest.
- [ ] Trigger a password reset for yourself and complete it end to end. This is
      the single most common thing to be broken by a missing redirect URL.
- [ ] Confirm archiving a canvas closes its public link, and that a deleted
      canvas's review link 404s.
- [ ] Replace the `og:image` meta in `index.html` — the original pointed at a
      Lovable-hosted screenshot and was removed rather than rebranded.

---

## Known gaps

Not blockers, but worth knowing before you promise them to anyone:

- **Desktop notifications need the app open.** Assignment notifications reach
  the Windows Action Center and the macOS Notification Center whenever the app
  is open — including when its tab is in the background or the window is behind
  something else — via the Notification API. They do **not** arrive with the
  browser closed: that needs Web Push, which means a service worker, a VAPID key
  pair, a stored subscription per device and an edge function to send from. Each
  person turns them on from the bell; the browser only allows the prompt from a
  click, and a denial sticks until they change it in site settings.
- **No email notifications.** Everything is in-app. If someone needs telling
  while they are not in the tool at all, that is the gap to close next.
- **No account deletion.** Removing someone's role revokes their access, but the
  auth user remains. Delete it from the Supabase dashboard if you need to.
- **No audit trail in the UI.** `activity_logs` is written but never displayed.
- **No soft delete for agencies, projects or canvases.** Archive is reversible;
  delete is not, and it cascades. That is why deleting an agency or project
  makes you type its name.
- **Permission changes are not pushed to open sessions.** Someone mid-session
  keeps the permissions their app last loaded until they navigate or refresh.
  The database rejects anything they are no longer allowed to do regardless, so
  this is a display lag, not a hole.
