# Review Tool

A no-login website feedback and approval tool. Clients click anywhere on a
proxied website, image or PDF to leave pinned comments; the team triages them
from an internal dashboard.

## Getting started

```sh
npm install
cp .env.example .env   # fill in the Supabase values
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm test` | Vitest suite |
| `npm run lint` | ESLint |

## Stack

React + TypeScript + Vite, Tailwind with shadcn/ui components, Supabase
(Postgres, auth, storage, edge functions) as the backend.

## Development plan

Where the product stands, how we work on it, and what gets built next in what
order — plus the testing strategy, release process and risk register.

See **[docs/SOFTWARE_DEVELOPMENT_PLAN.md](docs/SOFTWARE_DEVELOPMENT_PLAN.md)**.

## Roles and permissions

Every signed-in user holds one role, and each role is a bundle of permissions
the **owner** can edit under Settings → Roles & permissions. The rules are
enforced by row-level security in Postgres, not just in the UI.

See **[docs/ROLES_AND_PERMISSIONS.md](docs/ROLES_AND_PERMISSIONS.md)** for the
role reference, the default matrix, and the owner's manual for customising it.

## Rebranding

The UI is white-label ready: identity comes from `VITE_BRAND_*` env vars via
`src/config/brand.ts`, and the palette, fonts and radius come from the BRAND
block at the top of `src/index.css`. Nothing else hardcodes a brand name, logo
or colour.

See **[docs/WHITE_LABELING.md](docs/WHITE_LABELING.md)** for the full guide and
the design-system conventions (colour tokens, type scale, icon sizes, and the
shared layout/state components to build new pages with).
