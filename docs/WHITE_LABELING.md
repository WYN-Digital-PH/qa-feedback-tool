# White-labeling guide

Rebranding this tool for another agency touches three files. Nothing else in
`src/` hardcodes a brand name, logo or colour.

| What | Where |
| --- | --- |
| Name, company, description, logo, links | `.env` (`VITE_BRAND_*`) → `src/config/brand.ts` |
| Colours, fonts, corner radius | the **BRAND** block at the top of `src/index.css` |
| Pre-boot tab title and link-preview meta | `index.html` |

---

## 1. Identity — `.env`

```dotenv
VITE_BRAND_PRODUCT_NAME=Northlight Review
VITE_BRAND_COMPANY_NAME=Northlight Studio
VITE_BRAND_DESCRIPTION=Visual website feedback for Northlight clients.
VITE_BRAND_LOGO_URL=https://cdn.northlight.studio/logo.svg
VITE_BRAND_WEBSITE_URL=https://northlight.studio
```

Every variable is optional and falls back to the default in
`src/config/brand.ts`. Leave `VITE_BRAND_LOGO_URL` blank to use the bundled
`src/assets/logo.jpg` — replacing that file is the simplest option.

The name and byline render through one component, `<BrandMark />`, so the
sidebar, landing header, sign-in and sign-up screens all update together.

## 2. Palette and type — `src/index.css`

The BRAND block is the only part meant to be edited:

```css
--brand: 240 100% 23%;        /* primary accent */
--brand-foreground: 0 0% 100%; /* text on the accent */
--brand-glow: 240 100% 33%;    /* lighter step for hovers and dark surfaces */
--brand-neutral-hue: 220;      /* hue the greys are mixed from */
--brand-shade: 222 25% 12%;    /* darkest surface — the sidebar */

--font-sans: "Inter", ui-sans-serif, system-ui, …;
--font-mono: ui-monospace, SFMono-Regular, …;

--radius: 0.625rem;
```

Colours are **bare HSL channels**, not `hsl(…)` strings — that is what lets
Tailwind's opacity modifiers (`bg-primary/10`) work. Convert a hex brand colour
to HSL and drop the wrapper: `#000075` → `240 100% 23%`.

Everything below that block derives from it: `--primary`, `--ring`, the
`--sidebar-*` set and the review `--pin-*` colours all point back at the brand
tokens, so one edit repaints buttons, focus rings, the navigation, status
badges and review pins.

Changing the typeface means two edits: the `--font-sans` token and the font
`<link>` in `index.html`.

### Workflow status colours

The `--status-*` block sits just below the semantic tokens and is deliberately
**not** derived from `--brand`:

```css
--status-new: 38 92% 50%;
--status-in-review: 199 89% 48%;
--status-assigned: 262 83% 58%;
--status-in-progress: 217 91% 60%;
--status-ready-for-qa: 173 80% 36%;
--status-changes-needed: 0 75% 55%;
--status-resolved: 142 65% 38%;
--status-closed: 220 9% 46%;
```

These encode workflow meaning — waiting, in hand, needs attention, done — which
has to stay legible whatever accent an agency picks. Tinting them all towards a
single brand hue is what made "In review", "Assigned" and "In progress" read
identically before. Retune them if your board uses different language, but keep
them distinguishable from each other.

They are consumed only through the static maps in `src/lib/feedbackMeta.ts`
(`statusBadgeClass`, `statusSolidClass`, `statusEdgeClass`). **Never compose a
class as `bg-status-${status}`** — Tailwind scans source text for class names,
so a name built at runtime exists in the markup but not in the stylesheet, and
the colour silently goes missing. `src/test/designSystem.test.tsx` fails if a
status or a board column loses its colour.

## 3. Static shell — `index.html`

The title and meta description here are the fallbacks used before the app boots
and by link-preview crawlers; `src/main.tsx` overwrites both at runtime from the
brand config. Update them to match when you rebrand, and swap the Google Fonts
link if you changed the typeface.

---

## Design system conventions

Follow these so the UI stays uniform as it grows.

**Colour.** Never use a Tailwind palette colour (`bg-slate-900`, `text-blue-300`)
or a raw hex. Use the semantic tokens:

| Token | Use |
| --- | --- |
| `primary` | brand accent — primary buttons, active nav, links |
| `secondary` | quiet fills, page background (`bg-secondary/40`), chips |
| `muted-foreground` | secondary text |
| `border` | all hairlines and dividers |
| `success` / `warning` / `destructive` | state only, never decoration |
| `sidebar-*` | the dark navigation rail |
| `pin*` | review pin markers |

**Elevation.** Two levels: `.surface-card` for content sitting in the page,
`.surface-elevated` for things floating above it (auth panels, error cards).
`shadow-sm/md/lg` map to the same tokens.

**Type scale.**

| Element | Classes |
| --- | --- |
| Page title | `text-2xl font-semibold tracking-tight` (via `<PageHeader>`) |
| Card / section heading | `font-semibold` (via `<SectionHeading>`) |
| Body | inherited `text-sm` in dense UI |
| Secondary text | `text-sm text-muted-foreground` |
| Meta / captions | `text-xs text-muted-foreground` |

**Icons** — [lucide-react](https://lucide.dev), three sizes only:

| Size | Use |
| --- | --- |
| `w-3.5 h-3.5` | dense inline icons — chips, meta rows, small buttons |
| `w-4 h-4` | default — buttons, toolbars, table actions |
| `w-5 h-5` | navigation and feature icons |

Write width before height (`w-4 h-4`) so the classes stay greppable.

**Shared components** — reach for these instead of re-implementing a layout:

| Component | Purpose |
| --- | --- |
| `<Page>` / `<PageHeader>` / `<SectionHeading>` (`components/layout/Page`) | page padding, width, title block |
| `<EmptyState>` / `<InlineEmptyState>` | "nothing here yet" |
| `<LoadingState>` / `<ErrorState>` (`components/ui/states`) | spinner and failure cards |
| `<StatusBadge>` / `<PriorityBadge>` (`components/feedback/StatusBadge`) | feedback status and priority pills |
| `<BrandMark>` | logo + wordmark |

Feedback status and priority labels, tones and orderings live in
`src/lib/feedbackMeta.ts` — add new statuses there, not in a page.

**Review pins.** The overlay drawing pins runs inside the proxied site's iframe
and cannot read the app's CSS variables, so `src/lib/reviewTheme.ts` resolves
the `--pin-*` tokens and posts them to the iframe on load. Pins therefore
rebrand along with the palette. The edge function keeps its own fallback colours
for the moment before the theme message arrives.