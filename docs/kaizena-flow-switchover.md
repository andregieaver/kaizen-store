# Switching to kaizenaflow.com (D240)

The code says Kaizena Flow and knows `kaizenaflow.com` (commit c877e8a). These are the settings outside the code that move the live site, in order.
Each is done by a person in the service's own dashboard; none is in the repository.

## 1. Vercel (project `kaizen-store`)

1. **Domains.** Make `kaizenaflow.com` serve the production deployment (today it redirects to `kaizenstore.cloud`), with `www.kaizenaflow.com`
   redirecting to it. Then make `kaizenstore.cloud` (and `www.`) redirect to `https://kaizenaflow.com` **path for path** (308).
2. **Keep the WordPress API on the old domain.** Connected WordPress sites call the address they saved (`https://kaizenstore.cloud/api/wordpress/v1/…`,
   including POSTs for the cart). Either leave `kaizenstore.cloud` serving the deployment rather than redirecting until those sites are reconnected,
   or check that the redirect is a 308 (which keeps the method and body) and that WordPress follows it for POST.
3. **Stores' own addresses**, if stores are on subdomains (`NEXT_PUBLIC_STORE_DOMAIN`): add `*.kaizenaflow.com` as a wildcard domain, set
   `NEXT_PUBLIC_STORE_DOMAIN=kaizenaflow.com` (and `NEXT_PUBLIC_STORE_HOSTS` if used), and redirect `*.{old domain}` to the same store on the new one.
   This changes every store's address: do it at a quiet time, and tell owners.
4. **The theme store's own host** (`docs/theme-phase-3.md` step 3): add `themes.kaizenaflow.com` to the project (a CNAME to Vercel, or covered by
   the wildcard of step 3 when stores are under `kaizenaflow.com`) and set `NEXT_PUBLIC_THEMES_HOST=themes.kaizenaflow.com`. Until it is set, the theme
   store stays at `https://kaizenaflow.com/themes`; once it is, those addresses move there (308) and the next deploy routes the host.
5. **Environment variables** (Production): `SITE_URL=https://kaizenaflow.com`; `EMAIL_FROM` to an address on the new domain once step 2.1 is done.
   Then redeploy (CI's *redeploy* workflow input, or a push).

## 2. Email (Resend)

1. Add and verify `kaizenaflow.com` (the DNS records Resend gives: SPF, DKIM, and a return path).
2. Change `EMAIL_FROM` (above) to an address on it.
3. Point the delivery webhook at `https://kaizenaflow.com/api/resend/webhook` (the secret `RESEND_WEBHOOK_SECRET` stays).

## 3. Supabase Auth (project `ybsozesfuxuitoacntfo`)

Site URL `https://kaizenaflow.com`; add `https://kaizenaflow.com/**` to the redirect allow list (keep the old one until no sign-in link sent before the
switch is still open: links last an hour). The magic-link and password-reset emails' wording is Supabase's templates: say Kaizena Flow there too.

## 4. Stripe (test and live)

1. Webhook endpoints: add the same endpoints on the new domain (`/api/stripe/connect/{mode}`, `/api/stripe/connect/{mode}/accounts`,
   `/api/stripe/billing/{mode}`, and any `/api/stripe/webhook/{storeId}`), each with the secret the app expects, then remove the old ones.
2. Connect settings: the platform's name and branding (Kaizena Flow), and the redirect and return addresses for onboarding.

## 5. Other connections

* **Slack app**: the OAuth redirect `https://kaizenaflow.com/api/integrations/slack/callback`, and the app's name.
* **Kaizen Life**: its OAuth client's redirect for "Sign in with Kaizen Life" (`/auth/callback?via=kaizen-life`) and the store MCP server's
  address it uses (`/api/mcp`), on the new domain.
* **The scheduler** that calls the cron routes (`/api/cron/*` with `CRON_SECRET`) is Supabase's `pg_cron`, set in migrations. The redirect of
  the old domain drops the Authorization header, so every scheduled call was refused (401) after the switch; migration `cron_host`
  (16 October 2026) points every job at `https://kaizenaflow.com`, and new jobs name it.
* **Search engines**: add `kaizenaflow.com` to Google Search Console and submit its sitemap; the old domain's 308s carry the rest.

## 6. In the admin (by a platform admin)

Kaizena Flow's own pages, header and footer (logo, name, business details) and the platform's chat agent's name are data you edit at
`/admin/platform/pages` and `/admin/platform/navigation`; the logo and icon are uploads. The migration did not touch them.
