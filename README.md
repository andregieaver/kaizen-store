# Kaizen Store

An AI-native online store selling EU-wide, built from scratch on Next.js,
Supabase and Vercel.

The research behind it, and the phased plan for getting to production, are in
[`docs/plan.md`](docs/plan.md). This repository is at the start of Phase 0: the
skeleton is in place, and the store itself has not been built yet.

## What is here

- A Next.js 16 app with Cache Components enabled and a placeholder home page.
- Supabase clients for server and browser code (`src/lib/supabase/`).
- `GET /api/health`, which reports the serving region, the commit, and whether
  Supabase is reachable. It returns 503 when Supabase is unreachable or not
  configured.
- Unit tests (Vitest), browser smoke tests (Playwright), and CI that runs lint,
  type-check, tests, build and the smoke tests on every push and pull request.

## Getting started

Requires Node 22+ and pnpm 10.

```bash
pnpm install
cp .env.example .env.local   # then fill in the publishable key
pnpm dev
```

The Supabase URL and publishable key are both safe to expose in the browser.
Secret keys never go in `NEXT_PUBLIC_` variables or in the repository.

## Deployment

Vercel builds every push; `main` is production. Functions run in `dub1`
(Dublin), next to the Supabase database in eu-west-1.

## Admin

The admin lives at `/admin`. People sign in with a one-time link sent to their
email; only accounts that belong to a store (or run the platform) get one. The
first platform admin, who owns the demo template store, is added directly in
the database:

```sql
with a as (
  insert into commerce.accounts (email, platform_admin)
  values ('you@example.com', true) returning id
)
insert into commerce.store_members (store_id, account_id, role)
select s.id, a.id, 'owner' from commerce.stores s, a where s.is_template;
```

After that, owners invite everyone else from **Admin → Staff** in their store.

For sign-in links to work, Supabase must allow the redirect back to the site:
**Authentication → URL Configuration**, set the Site URL to the production URL
and add `<production URL>/auth/callback` (and `http://localhost:3000/auth/callback`
for local development) to the redirect URLs.

Payment keys and which payment methods are offered in each country are set in
**Admin → Payments**. They are stored encrypted with `SETTINGS_ENCRYPTION_KEY`,
which must be set in the server environment.
