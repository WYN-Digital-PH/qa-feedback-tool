# Software Development Plan

**Product:** WYN Review — a no-login website feedback and approval tool
**Status of this document:** living plan, revised as phases close
**Last revised:** 2026-09-04

This plan describes what the product is, what is actually built today, how the
team works on it, and what gets built next in what order. It is the document to
read before picking up work, and the one to update when a phase closes.

Two documents sit beneath it and are not repeated here:
[`DEPLOYMENT.md`](DEPLOYMENT.md) (what must be true before a release ships) and
[`ROLES_AND_PERMISSIONS.md`](ROLES_AND_PERMISSIONS.md) (the authorisation
model). [`WHITE_LABELING.md`](WHITE_LABELING.md) covers rebranding and the
design-system conventions.

---

## 1. What the product is

An agency sends a client a link. The client opens it — no account, no
password — and clicks anywhere on a live website, an image or a PDF to leave a
pinned comment. The agency triages those comments from an internal dashboard,
assigns them, fixes them, and sends the round back for approval.

The whole design rests on one asymmetry: **the client must never have to sign
in, and the team must never lose track of who said what.** Everything awkward
in the codebase — the guest token, the website proxy, the edge functions that
run without a JWT — exists to hold that line.

### The people it serves

| Who | How they arrive | What they can do |
| --- | --- | --- |
| **Client reviewer** | A share link, unauthenticated | Leave pins, reply, approve or request changes |
| **Consultant** | Signed in | Runs client work end to end |
| **Developer** | Signed in | Works assigned feedback, hands to QA |
| **QA** | Signed in | Verifies fixes, owns the final resolve |
| **Admin / Owner** | Signed in | Runs the workspace; the owner alone edits permissions |

### The core loop

```
Agency creates canvas ──► share link ──► client pins comments
      ▲                                          │
      │                                          ▼
 client re-reviews ◄── team marks round addressed ◄── triage → assign → fix → QA
      │
      └──► approves, or requests another round of changes
```

---

## 2. Where the product stands today

### Shipped and working

- **Three canvas types** — proxied website, image, PDF — with pins anchored to
  page elements rather than raw coordinates, so a pin survives a responsive
  reflow.
- **Guest review flow end to end**: pin, reply, edit and delete your own
  comments, approve or request changes, all without an account.
- **Internal dashboard**: agencies, projects, canvases, a feedback board with
  Kanban and list views, labels, assignment, and an activity timeline.
- **Customisable role permissions** — 20 permission keys across 6 roles,
  enforced by row-level security in Postgres, editable by the owner in
  Settings. The database is the authority; the UI mirrors it.
- **In-app and desktop notifications** for assignment.
- **White-label ready** — brand identity from `VITE_BRAND_*` env vars, palette
  and type from CSS custom properties. No brand name is hardcoded in `src/`.

### The shape of the system

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│  React 18 + Vite SPA     │        │  Supabase                     │
│  Tailwind + shadcn/ui    │───────►│  Postgres (RLS is the         │
│  TanStack Query          │  anon  │    authorisation boundary)    │
│  React Router            │  key   │  Auth · Storage · Realtime    │
└───────────┬──────────────┘        └───────────────┬───────────────┘
            │                                       │
            │ no JWT (verify_jwt = false)           │ service role
            ▼                                       ▼
    ┌──────────────────────────────────────────────────────┐
    │  11 Edge Functions (Deno)                            │
    │  proxy-website · capture-screenshot                  │
    │  submit-guest-feedback · submit-guest-reply          │
    │  guest-feedback-mutate · submit-review-decision      │
    │  get-public-canvas · …-comments · …-feedback-thread  │
    │  submit-internal-feedback · upload-canvas-file (JWT) │
    └──────────────────────────────────────────────────────┘
```

**16 tables**, the important ones being `canvases`, `feedback_items`,
`feedback_comments`, `review_decisions`, `permissions` / `role_permissions`,
and `activity_logs`. **21 migrations**, applied in filename order.

### Quality baseline, measured

| Signal | Today |
| --- | --- |
| Test suite | **113 tests, 8 files, all passing** (~38s) |
| What is covered | Permissions, assignment rules, entity fields, record lifecycle, pin anchoring, finish-review, design-system conventions |
| What is not covered | **Every edge function. No integration test crosses the network boundary.** |
| CI | **None.** No `.github/workflows`. Tests run only when someone remembers |
| Lint | ESLint configured, run manually |
| Type safety | Strict TypeScript; Supabase types generated |

The coverage gap is the honest headline: the logic most exposed to the public
internet — eleven functions that accept unauthenticated writes — is the logic
with no automated test at all.

### In flight on `increment`

Uncommitted work, roughly 480 lines added across 13 files, doing one coherent
thing: **closing a round of requested changes.** A client who once clicked
"Request changes" used to leave a permanent warning on the project page;
resolving every comment they raised changed nothing, because a resolved comment
and an open change request were unrelated records. The migration
`20260901120000_close_change_request_rounds.sql` adds an acknowledgement
(`addressed_at` / `addressed_by` / `addressed_note`) to `review_decisions`,
freezes the rest of the record against update with a trigger, and stamps the
actor server-side so a round cannot be backdated or misattributed.

Alongside it: `src/lib/guestToken.ts`, which fixes a real data-loss bug — a
guest token generated outside a secure context was not a UUID, so every
edge function silently stored `NULL` and the reviewer quietly lost the right to
edit their own pins.

**This branch ships first.** Nothing else in this plan starts until it is
committed, migrated on staging, and merged.

---

## 3. How we work

### Branching

`main` is deployable. Work happens on `increment` and merges by pull request.
The three `backup-*` branches are historical and should be deleted once nothing
references them.

### The bar for a change

1. Types pass (`npx tsc --noEmit`) and lint is clean.
2. `npm test` is green.
3. Any behaviour reachable by a guest has a test.
4. A schema change ships as a **new** migration file, never an edit to an
   applied one, and is run on staging before production.
5. Anything that changes authorisation is verified against RLS, not just the
   UI. A hidden button is not a permission.

### Conventions that already hold, and should keep holding

- **The database is the authority on access.** `src/lib/permissions.ts` exists
  so a typo in a `can()` call is a compile error — not so the client can decide.
- **Comments explain why, not what.** The existing migrations and libraries are
  written this way; match them.
- **No brand strings in components.** Identity comes from `brand.ts` and CSS
  tokens.
- **Shared layout and state components** (`components/layout/Page.tsx`,
  `components/ui/states.tsx`) are how new pages are built.

---

## 4. Roadmap

Four phases, ordered by risk retired per unit of work rather than by
visibility. Each phase is independently shippable.

---

### Phase 0 — Land what is in flight

**Goal:** the working tree is empty and `main` is deployable.

| # | Work | Done when |
| --- | --- | --- |
| 0.1 | Commit the change-request-round work in coherent commits | History reads as intent, not "fixed errors(3)" |
| 0.2 | Run `20260901120000` on staging, exercise the round close | Trigger rejects an attempt to rewrite `decision`; stamp is server-side |
| 0.3 | Verify the guest-token fix on a plain-http origin | A phone on the LAN keeps its pins across a reload |
| 0.4 | Merge to `main`, tag, deploy | Review link works from a fresh incognito window |
| 0.5 | Delete the three stale `backup-*` branches | `git branch` lists only live work |

---

### Phase 1 — Make the risk visible

**Goal:** stop shipping blind. This is the highest-value phase and the least
glamorous.

| # | Work | Why it matters | Done when |
| --- | --- | --- | --- |
| 1.1 | **CI on every push and PR** — install, typecheck, lint, test, build | Nothing else in this plan is trustworthy without it | A red build blocks a merge |
| 1.2 | **Edge function test harness** — Deno tests for the eleven functions, covering the guest-token path, share-token validation, and archived/deleted canvas rejection | The public write surface is currently untested | Each function has at least a rejection test and a happy path |
| 1.3 | **One end-to-end review journey** — create canvas, open share link as a guest, pin, reply, approve | The core promise of the product, verified once per build | Runs headless in CI |
| 1.4 | **Purge screenshots with their feedback item** | Storage grows forever today; only the URL is tracked | Deleting an item removes its object, or a scheduled sweep does |
| 1.5 | **Surface `activity_logs` in the UI** | Written on every action, displayed nowhere — an audit trail nobody can read | A project shows its history, filtered by permission |

**Exit criterion:** a pull request that breaks the guest review flow fails
before a human looks at it.

---

### Phase 2 — Close the gaps clients notice

**Goal:** the product stops depending on someone having the tab open.

| # | Work | Notes |
| --- | --- | --- |
| 2.1 | **Email notifications** | The single largest functional gap. Assignment, a new client comment, an approval, a change request. Needs SMTP configured (see `DEPLOYMENT.md` §2) and a per-user preference, or it becomes noise |
| 2.2 | **Web Push** | Desktop notifications need the app open today. Service worker + VAPID keys + a stored subscription per device + a send function |
| 2.3 | **Deadline reminders** | `canvases.feedback_deadline` exists and nothing acts on it. A scheduled function that nudges before it lapses |
| 2.4 | **Account deletion** | Removing a role revokes access but leaves the auth user. Needed for any GDPR-shaped request |
| 2.5 | **Push permission changes to open sessions** | A display lag today, not a hole — the database still refuses. Realtime subscription on `role_permissions` |

---

### Phase 3 — Harden the proxy

**Goal:** the riskiest component stops being the least understood.

`supabase/functions/proxy-website/index.ts` is 743 lines and rewrites arbitrary
third-party HTML so it can be pinned inside an iframe. It is the component most
likely to break on a site nobody tested, and the one most exposed to hostile
input.

| # | Work |
| --- | --- |
| 3.1 | Fixture-based test suite: a set of captured real-world pages, asserting that rewriting is stable across a change |
| 3.2 | A documented fallback when proxying fails — `widget_fallback_enabled` exists in the schema; make the failure legible to the client rather than a blank frame |
| 3.3 | SSRF review: what can a `website_url` be pointed at, and what does the function refuse |
| 3.4 | Response caching, so a client scrolling a heavy page does not re-fetch it |

---

### Phase 4 — Scale past one agency

**Goal:** the tool serves more than the team that built it.

Deliberately last. Everything above makes the current product trustworthy;
this changes what the product is, and should not start until it is asked for.

| # | Work |
| --- | --- |
| 4.1 | Multi-workspace tenancy — today one deployment is one agency, and `user_roles` is global |
| 4.2 | Per-workspace branding, replacing build-time `VITE_BRAND_*` inlining |
| 4.3 | Billing and plan limits |
| 4.4 | A public API or webhooks for the feedback stream |

---

## 5. Testing strategy

Four layers, and the plan is to fill them bottom-up.

| Layer | Tool | Covers | State |
| --- | --- | --- | --- |
| **Unit** | Vitest | Permission resolution, assignment rules, lifecycle, entity fields | Good — 113 tests |
| **Component** | Vitest + Testing Library + jsdom | Page rendering, design-system conventions, confirm dialogs | Thin but real |
| **Function** | Deno test | The eleven edge functions | **Absent — Phase 1.2** |
| **End to end** | Playwright (proposed) | The guest review journey | **Absent — Phase 1.3** |

Two rules worth stating because they are easy to violate:

- **A permission test that only checks the UI is not a permission test.**
  Authorisation lives in RLS; assert against the database.
- **Anything a guest can reach gets a rejection test**, not just a happy path.
  The interesting failure is a valid-looking request that should be refused.

---

## 6. Release process

1. Merge to `main` through a green pull request.
2. `supabase db push` against **staging**; run the affected flow by hand.
3. `supabase functions deploy`.
4. Build with production `VITE_*` values — Vite inlines them, so a changed
   value means a rebuild, not a restart.
5. Deploy; confirm the SPA rewrite by pasting a review link into a fresh
   incognito window.
6. Repeat 2–5 against production.

The full pre-flight list, including the blockers that fail silently, is in
[`DEPLOYMENT.md`](DEPLOYMENT.md). Do not re-derive it here.

---

## 7. Risks

| Risk | Likelihood | Impact | What we do about it |
| --- | --- | --- | --- |
| An untested edge function regresses and a client's comment is silently dropped | Medium | **High** — the failure is invisible until the client complains | Phase 1.2, and the rejection-test rule |
| The website proxy breaks on a real client site | Medium | High | Phase 3.1, plus a legible fallback in 3.2 |
| A migration that rewrites RLS locks a team out | Low | **High** | Staging run first; `20260825140000` is the precedent — it narrowed access for three roles |
| No CI means a broken `main` | High today | Medium | Phase 1.1 — the first thing to fix |
| Storage grows without bound | High | Low, then sudden | Phase 1.4 |
| Supabase is a single point of failure across auth, data, storage and compute | Low | High | Accepted. The coupling is deliberate; revisit only if it bites |
| Guest identity rests on `localStorage` | Certain | Medium | Accepted and understood — see `src/lib/guestToken.ts`. Clearing storage loses edit rights, not the comments |

---

## 8. Definition of done

A piece of work is done when:

- [ ] It does what was asked, including the parts that were tedious.
- [ ] Types and lint pass; `npm test` is green.
- [ ] New guest-reachable behaviour has both a happy path and a rejection test.
- [ ] Schema changes are a new migration, run on staging.
- [ ] Authorisation changes are verified against RLS.
- [ ] Docs that are now wrong are corrected in the same change.
- [ ] No brand string, colour, or spacing value is hardcoded where a token exists.

---

## 9. Open questions

These need a decision from the owner before the phase that depends on them.

1. **Is multi-tenancy actually wanted?** Phase 4 is speculative. If this stays
   a single-agency tool, deleting that phase simplifies everything above it.
2. **Which email provider?** Phase 2.1 is blocked on SMTP being configured.
3. **How long should screenshots be retained?** Phase 1.4 needs a number.
4. **Is Playwright the right e2e tool here?** It is the default assumption in
   1.3, not a decision.
