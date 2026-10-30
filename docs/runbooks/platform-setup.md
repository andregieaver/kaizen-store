# Setting up the platform

What an operator does once, outside the code, so that sign-in, pictures and payments work on a new deployment (moved here from
the README on 30 October 2026, PSI CODE-05). Each part names where in Supabase, Vercel or Stripe the setting is.

## Sign-in and the first platform admin

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

Staff sign in with their email and a password, or with an emailed sign-in
link. For the links to work (sign-in, password reset), Supabase must allow the
redirect back to the site: **Authentication → URL Configuration**, set the Site
URL to the production URL and add `<production URL>/**` (and
`http://localhost:3000/**` for local development) to the redirect URLs. The
wildcard is needed because a password reset returns to
`/auth/callback?next=/admin/account`.

So that links work in any browser (needed for invited store owners, who open
the link on their own device), point the emails at `/auth/confirm` with a token
hash. In **Authentication → Emails**, edit both the **Magic Link** and the
**Confirm signup** templates and use this link instead of
`{{ .ConfirmationURL }}`:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in to Kaizena Flow</a>
```

and in the **Reset Password** template:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/admin/account">Choose a new password</a>
```

Under **Authentication → Providers → Email**, keep the minimum password length
at 12 or less (Kaizena Flow asks for 12) and, on a paid plan, turn on leaked password
protection.

Supabase's built-in email service only delivers to members of your Supabase
organisation and sends a few emails an hour. Before inviting real store
owners, add your own SMTP provider under **Authentication → Emails → SMTP
Settings** (choose one that sends from the EU).

## Pictures

Product pictures are uploaded to the public `product-media` bucket in Supabase
Storage (created by a migration). Uploads need the project's secret key in the
server environment: in Supabase, **Project Settings → API Keys**, create a
secret key; in Vercel, add it as `SUPABASE_SECRET_KEY` (Production and
Preview, marked Sensitive) and redeploy. It bypasses all database rules, so it
must never reach the browser. Without it, the product editor asks for picture
addresses instead.

## Payments

Payments run on Stripe Connect (decision D17): each store sells through its
own Stripe account, which Kaizena Flow creates and the owner completes inside the
admin. To switch payments on for the platform:

1. In Kaizena Flow's own Stripe account, turn on **Connect** (Dashboard → Connect →
   Get started; choose a platform whose sellers have their own storefronts).
2. In Vercel, add Kaizena Flow's keys for the mode (Production and Preview; mark the
   secret key Sensitive): `STRIPE_SECRET_KEY_TEST` and
   `STRIPE_PUBLISHABLE_KEY_TEST`, later `STRIPE_SECRET_KEY_LIVE` and
   `STRIPE_PUBLISHABLE_KEY_LIVE`. A restricted key (`rk_…`) works if it may
   manage Connect accounts, account sessions, Checkout Sessions, webhook
   endpoints, event destinations, products, prices, tax rates, subscriptions
   and the billing portal. Redeploy.
3. On **Platform → Stripe** (`/admin/platform/stripe`), press **Connect
   webhooks** for the mode. Kaizena Flow creates its three webhooks in Stripe and
   keeps their secrets encrypted (`SETTINGS_ENCRYPTION_KEY` must be set).
4. Optionally set the default fee per sale on the same page (0 % by default).
5. Create plans under **Platform → Plans** (they are copied to Stripe), then
   start each store's plan under **Platform → Stores**. In Stripe, turn on
   emailing invoices to customers (Settings → Billing → Invoices) and add
   the company's organisation number and VAT number to the invoice template.

Stores take test payments from the start with nothing to set up: Kaizena Flow
creates each store's test Stripe account itself (decision D20). For real
payments, once Kaizena Flow has live keys, each owner opens **Payments**, presses
**Set up Stripe**, answers Stripe's questions, and switches checkout to live. Payment methods, receipts and payouts are managed in the store's
own Stripe Dashboard.

## Stores and secrets

Store owners ask for a store at `/sign-up`; platform admins approve requests at
`/admin/platform`, which creates the store as a copy of the demo template.

Secrets Kaizena Flow keeps in the database (its Stripe webhook secrets, and the
per-store keys from before Connect) are encrypted with
`SETTINGS_ENCRYPTION_KEY`, which must be set in the server environment. Changing it later: `docs/runbooks/key-rotation.md`.
