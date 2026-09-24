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

So that links work in any browser (needed for invited store owners, who open
the link on their own device), point the emails at `/auth/confirm` with a token
hash. In **Authentication → Emails**, edit both the **Magic Link** and the
**Confirm signup** templates and use this link instead of
`{{ .ConfirmationURL }}`:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in to Kaizen</a>
```

Supabase's built-in email service only delivers to members of your Supabase
organisation and sends a few emails an hour. Before inviting real store
owners, add your own SMTP provider under **Authentication → Emails → SMTP
Settings** (choose one that sends from the EU).

Product pictures are uploaded to the public `product-media` bucket in Supabase
Storage (created by a migration). Uploads need the project's secret key in the
server environment: in Supabase, **Project Settings → API Keys**, create a
secret key; in Vercel, add it as `SUPABASE_SECRET_KEY` (Production and
Preview, marked Sensitive) and redeploy. It bypasses all database rules, so it
must never reach the browser. Without it, the product editor asks for picture
addresses instead.

To take payments, a store owner saves their Stripe keys under **Payments**.
Saving the secret key also creates Kaizen's webhook in their Stripe account
(pointing at `/api/stripe/webhook/{store id}`), so payments are confirmed
without copying a signing secret. Then they set shipping prices under
**Shipping** and switch Stripe on. Shoppers get Stripe's receipt email once the
owner turns it on in Stripe (Settings → Customer emails).

Store owners ask for a store at `/sign-up`; platform admins approve requests at
`/admin/platform`, which creates the store as a copy of the demo template.

Payment keys and which payment methods are offered in each country are set in
**Admin → Payments**. They are stored encrypted with `SETTINGS_ENCRYPTION_KEY`,
which must be set in the server environment.
