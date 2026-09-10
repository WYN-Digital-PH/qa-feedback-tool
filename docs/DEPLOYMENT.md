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
| `20260911120000_edge_function_rate_limits.sql` | Adds `rate_limits` and the `rate_limit_hit` counter the public functions call. Additive. Nothing enforces a limit until the functions are redeployed. |
| `20260911130000_screenshot_capture_caps.sql` | Adds `screenshot_usage`, `screenshot_quota_consume` and the 80% notice. Additive. Existing canvases start from zero, so their first 500 captures are still allowed. |

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

### Continuous integration

`.github/workflows/ci.yml` runs on every push and every pull request:
typecheck, lint, test, build — in that order, cheapest first, so an obvious
break reports in seconds rather than after the build.

```bash
npm run verify     # the same four steps, locally
```

Two things about it are deliberate:

- **`npm ci`, not `npm install`.** It installs exactly what the lockfile says
  and fails if `package.json` and the lockfile disagree. A CI that quietly
  resolves different versions is not checking what will be deployed.
- **Lint is budgeted, not zero.** `npm run lint` reports 147 problems today,
  nearly all `no-explicit-any` in code that predates the check.
  `scripts/lintBudget.mjs` freezes that number: a change that adds one fails,
  a change that fixes some prints the new lower figure to adopt. Gating on
  zero would have made CI red from its first run, and a permanently red build
  teaches everyone to ignore it. Run `node scripts/lintBudget.mjs --report`
  for the breakdown by rule.

The build step uses placeholder `VITE_*` values. CI proves the bundle
compiles, not that it can reach a real project — no secret is needed and none
is set.

A second job, `prove`, runs the rate-limit and screenshot-cap harnesses
against a live database. It only runs from **Actions → Run workflow**, because
it needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as repository secrets
and must never run on a pull request from a fork.

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

Shared code lives in `supabase/functions/_shared/` and is imported relatively
(`../_shared/rateLimit.ts`). The CLI uploads it alongside whichever function
imports it — you do not deploy `_shared` on its own.

### Rate limits

Every one of the nine public functions counts each request against two buckets
before it does any work:

| Bucket | What it stops |
| --- | --- |
| `ip:<address>:<function>` | one caller exhausting the service |
| `token:<share token>:<function>` | one leaked review link doing the same, however many addresses it is used from |

Per minute, per bucket:

| Function | per IP | per share token |
| --- | --- | --- |
| `get-public-canvas` | 120 | 600 |
| `get-public-canvas-comments` | 120 | 600 |
| `get-public-feedback-thread` | 120 | 600 |
| `submit-guest-feedback` | 20 | 100 |
| `submit-guest-reply` | 20 | 100 |
| `guest-feedback-mutate` | 30 | 150 |
| `submit-review-decision` | 10 | 30 |
| `proxy-website` | 60 | 240 |
| `capture-screenshot` | 10 | — |

Reads are generous because a review page issues several on load. Per-token
allowances are higher than per-IP because one link is expected to be opened by
a whole team at once. `capture-screenshot` has no share token — it is gated on
the service key instead — so it is limited by address only.

A blocked caller gets **429** with a `Retry-After` header and
`{"error":"rate_limited"}`. The check runs *before* the share token is looked
up, so a refused request costs one counter increment and nothing else.

**The counter is in Postgres** (`rate_limit_hit`), not in the function. Edge
isolates are ephemeral and concurrent: an in-process counter would reset on
every cold start and see only its own slice of the traffic, which is no limit
at all. The check is a single `INSERT … ON CONFLICT DO UPDATE`, so two requests
arriving together cannot both read "9 hits" and both write "10".

**It fails open.** If the database cannot be reached the request is allowed and
the reason logged (`[rate-limit] check failed, allowing`). A limiter that takes
the whole service down when its own storage hiccups is worse than the abuse it
prevents. Contrast the screenshot caps below, which deliberately do the
opposite.

To change a limit, edit `RATE_LIMITS` in
`supabase/functions/_shared/rateLimitRules.ts` and redeploy the functions. The
numbers are not read from the database, so nothing changes until you deploy.

### Screenshot capture caps

Rate limiting bounds how *fast* captures can be asked for. It does nothing
about the total — a slow loop running for a week never trips a per-minute limit
and still spends real money at browserless. Two ceilings, both checked before
the provider is called:

#### The limits as set

| Ceiling | Counts | Limit | Alerts at | Resets | Override |
| --- | --- | --- | --- | --- | --- |
| **Per canvas** | every capture that canvas has ever produced | **500** | **400** | never — it is a lifetime total | `SCREENSHOT_CANVAS_CAP` |
| **Per month** | every capture in the whole workspace, calendar month, UTC | **5000** | **4000** | 1st of each month, 00:00 UTC | `SCREENSHOT_MONTHLY_CAP` |

Set the overrides with `supabase secrets set` and redeploy `capture-screenshot`
— they are read from the function's environment, not the database, so nothing
changes until it is deployed. A value that is not a positive integer is ignored
in favour of the default: reading `SCREENSHOT_CANVAS_CAP=0` literally would
switch captures off everywhere, silently.

The month key is UTC (`to_char(now() at time zone 'utc', 'YYYY-MM')`), so the
month rolls over at 00:00 UTC regardless of where anyone is sitting.

Both are consumed in one call (`screenshot_quota_consume`), so a capture cannot
pass the canvas check, fail the monthly one, and still have burnt a canvas
slot. **A refused capture consumes nothing**, or a caller that kept retrying
would push the number ever further past the cap. When both would block, the
canvas ceiling is the one reported.

Over the cap, the item is marked `screenshot_status = 'skipped'` with the
ceiling and the numbers in `screenshot_error`, and the function logs
`[capture-screenshot] over cap, skipping`. The response is **200** with a
reason — a skip is a decision, not a failure.

**These fail closed.** If the quota check itself errors, the capture is skipped
(`503`, `quota_unavailable`) rather than attempted. Failing open here spends
money, and a capture deferred is recoverable in a way an unbounded bill is not.

Usage is readable without consuming any: `screenshot_quota_status(canvas_id)`,
or `SELECT * FROM screenshot_usage` (team-readable, service-role writable).

#### How the 80% alert works

The alert is raised inside the database, in the same transaction that consumes
the capture. That is deliberate: it cannot fire for a capture that was refused,
and it cannot be missed if the function crashes immediately afterwards.

1. **The threshold is `CEIL(limit × 0.8)`** — 400 of 500, 4000 of 5000. Rounded
   up, so a ceiling is never announced later than four fifths of the way
   through. On small caps it is deliberately blunt: a cap of 3 alerts at 3.
2. **It fires on the capture that crosses the line**, not the one after. The
   400th capture on a canvas is the one that raises it.
3. **`screenshot_usage.warned_at` is stamped at the same moment**, and the
   alert is guarded on it being null — so it goes out *once per counter*, not
   on every capture from 400 to 500. A canvas alerts once in its life; the
   monthly counter alerts at most once a month, because a fresh month is a
   fresh row with a null `warned_at`.
4. **It goes to every owner and admin** — one `notifications` row each, kind
   `screenshot_quota`, written by `notify_screenshot_quota()`. They are the
   people who can raise a cap or go looking at the traffic.
5. **It appears in the bell** the app already polls, with its own gauge icon in
   the warning colour, alongside assignments and mentions. Realtime delivers it
   without a refresh. There is no email — see the gaps in
   `SOFTWARE_DEVELOPMENT_PLAN.md` §4.
6. **The function logs it too** (`[capture-screenshot] capture quota at 80%`),
   so it is visible in the edge logs even to someone who never opens the app.

The text reads *"This canvas has used 400 of its 500 screenshot captures"*, or
for the workspace *"The workspace has used 4000 of its 5000 screenshot captures
for 2026-09"*.

The alert is informational. Nothing throttles at 80% — captures continue at
full speed until the ceiling itself is reached.

> **Raising a cap does not re-arm the alert.** `warned_at` is already stamped,
> so a canvas that alerted at 400/500 and was then raised to 2000 will pass
> 1600 in silence. Clear the stamp when you raise a ceiling:
>
> ```sql
> update screenshot_usage set warned_at = null
>  where scope = 'canvas' and key = '<canvas id>';
> ```
>
> The monthly counter re-arms on its own at the start of each month.

### Proving both

Neither is worth much unproven. Two harnesses exercise the real database, and
the rate-limit one will also hammer the deployed endpoints:

```bash
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
node scripts/proveRateLimit.mjs --http    # 13 checks
node scripts/proveScreenshotCaps.mjs      # 18 checks
```

Both cover the case a per-isolate counter cannot get right: a simultaneous
burst getting *exactly* the limit through, not one more. Both clean up after
themselves — the screenshot harness snapshots and restores the shared monthly
counter and deletes any notification it raised, and asserts that it did.

Unit tests that need no database are in `src/test/rateLimit.test.ts` and
`src/test/screenshotCaps.test.ts`.

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
- **`rate_limits` is never swept.** `prune_rate_limits(seconds)` exists and
  deletes rows older than its argument, but nothing calls it — the table grows
  by one row per distinct address per function. It is small (a bucket key, a
  timestamp and a count) and harmless for a long while, but schedule it if this
  runs unattended: `pg_cron` hourly, or any job that calls
  `select prune_rate_limits(3600);`.
- **Screenshot usage is never shown.** The caps are enforced and the 80% notice
  reaches owners and admins, but nothing in the UI displays remaining budget.
  `screenshot_quota_status(canvas_id)` returns it without consuming any.
- **Neither limit is configurable at runtime.** Rate limits are a constant in
  the function bundle; caps come from edge-function secrets. Changing either
  means a redeploy, not a settings toggle.
- **No soft delete for agencies, projects or canvases.** Archive is reversible;
  delete is not, and it cascades. That is why deleting an agency or project
  makes you type its name.
- **Permission changes are not pushed to open sessions.** Someone mid-session
  keeps the permissions their app last loaded until they navigate or refresh.
  The database rejects anything they are no longer allowed to do regardless, so
  this is a display lag, not a hole.
