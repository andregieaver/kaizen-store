# Card payments: PCI, the pay routes and the Content-Security-Policy

Wave 1, unit 1e (`docs/wave-1-trust.md`, section 4.4). Written 2026-10-03. Nothing here is a PCI attestation or legal
advice: **the SAQ A attestation is the company's own**, made each year by the business that takes the payments, and a
person with the authority to do it signs it. This file says what the code does so that the answers to that questionnaire
are true, and what is left for people.

## What the code guarantees

- **Card details go only to Stripe's own form.** The checkout draws Stripe's Payment Element (`CheckoutForm`,
  `@stripe/react-stripe-js`), served from `js.stripe.com`. No Kaizen route receives, logs or stores a card number, expiry
  or code, and no Kaizen page has an input for one: `src/lib/no-card-fields.test.ts` scans `src/app` and `src/components`
  for card inputs (`cc-number`, `cc-csc`, `cc-exp`, `name="card…"`) and for routes that read such fields.
- **Direct charges on the store's connected account** (D16, D17): every Stripe call carries `{ stripeAccount }`
  (`checkout-stripe.int.test.ts`).
- **A strict policy on the pay routes** (below), **no other site's script on them** (below), and **every entry by a full page
  load**.

## The revised SAQ A, as read

Read 2026-10-03 at the PCI Security Standards Council's blog, "Important Updates Announced for Merchants Validating to
Self-Assessment Questionnaire A" (30 January 2025): the revised SAQ A (effective 31 March 2025) removed requirements 6.4.3 and
11.6.1 from the questionnaire and added an eligibility criterion that the merchant **confirm their site is not susceptible
to attacks from scripts that could affect the merchant's e-commerce system(s)**. The council says the underlying PCI DSS
requirements themselves remain in effect. Stripe's integration security guide (https://docs.stripe.com/security/guide, read
the same day) says a low-risk integration, where card data goes from the browser to Stripe and not through the merchant's
servers, avoids most controls, that "including JavaScript from other sites makes your security dependent on theirs", and that
each business attests annually.

So the aim of the pay routes is narrow and checkable: **no script from any origin but ours and Stripe's can run on the page
where the card is typed.**

## The pay routes

`/cart`, `/checkout` and `/order` of every store, on both shapes of address: `/s/{store}/{market}/…` and, on a store's own
host, `/{market}/…`, for any market token including an A/B test's (`no~3fa9c1d2b`). Defined once in `src/lib/pay-routes.ts`
(`PAY_SOURCES`, `isPayPath()`), sent by `headers()` in `next.config.ts`, tested in `src/lib/next-config-headers.test.ts`.

### The policy (`src/lib/csp.ts`, `checkoutCsp()`)

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | everything not named below is ours only |
| `script-src` | `'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com https://maps.googleapis.com` | Stripe.js and Checkout; the prerendered shell has inline bootstrap scripts that cannot carry a nonce (below) |
| `style-src` | `'self' 'unsafe-inline'` | the theme's variables and React's `style=` attributes |
| `img-src` | `'self' data: blob: https://*.stripe.com https://*.link.com {storage host}` | Stripe's card-brand images and Link; the storage host (the host of `NEXT_PUBLIC_SUPABASE_URL`) serves pictures and logos |
| `font-src` | `'self'` | fonts are self-hosted (D59) |
| `connect-src` | `'self' https://api.stripe.com https://checkout.stripe.com https://link.com https://*.link.com https://maps.googleapis.com` | Stripe's API from Stripe.js, and the app's own `/api` and server actions |
| `frame-src` | `https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://link.com https://*.link.com` | the payment form, 3-D Secure and redirect methods (`hooks.stripe.com`), Link |
| `media-src` | `'self' {storage host}` | uploaded videos |
| `object-src` | `'none'` | |
| `base-uri` | `'self'` | |
| `form-action` | `'self'` | |
| `frame-ancestors` | `'none'` | the pay routes are never framed |
| `upgrade-insecure-requests` | only where `VERCEL` is set | it would break `http://localhost`, the end-to-end server |

`'unsafe-eval'` is never present. The Stripe origins are the ones Stripe's documentation lists for Stripe.js (`connect-src
https://api.stripe.com`; `frame-src` and `script-src` on `https://*.js.stripe.com` and `https://js.stripe.com`;
`frame-src https://hooks.stripe.com`), Checkout (`https://checkout.stripe.com`, `img-src https://*.stripe.com`) and Link
(`https://link.com`, `https://*.link.com`), read 2026-10-03. **Never add a script origin without writing the reason here.**

**Address autocomplete (`https://maps.googleapis.com`, added after review).** Stripe's security guide (read 2026-10-03) lists
`https://maps.googleapis.com` in `connect-src` and `script-src` among the Stripe.js directives, and says to include it when the Address Element
is used. The checkout mounts `ShippingAddressElement` (`src/components/checkout-form.tsx`), so the origin is in `script-src` and `connect-src`
only (a test holds it out of every other directive). It is the one script origin on the pay routes that is neither ours nor Stripe's: Google
Maps' script runs on the payment page, which a SAQ A assessor may ask about. **Not verified against a live Stripe session** (CI has none):
the manual test-mode payment must check, with the console open, that the address field offers suggestions and no `securitypolicyviolation`
appears. If the owner prefers the stricter page, remove `ADDRESS_AUTOCOMPLETE` from `src/lib/csp.ts` and accept manual address entry; the
test names the one place.
Extra headers on the same routes: `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`.

### What strength it has, said plainly

With `'unsafe-inline'` in `script-src` the policy stops **any script from another origin** (tag managers, chat widgets, an
owner's own script, the thing the revised SAQ A is worried about) but **does not stop an injected inline script**. A nonce
would, but Next.js's own guide (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`) says nonces need
dynamic rendering and are incompatible with a static shell, and the pay routes' shell is prerendered (`cacheComponents`).
What stands against an injected inline script instead is that these routes draw **no owner code and no owner HTML** (below),
that React escapes text, and that `frame-ancestors`, `form-action` and `base-uri` are shut.

**The stricter form was not tried.** The frame asked for `experimental.sri` first (the build puts an integrity hash on every
script, and `'unsafe-inline'` can go from `script-src`: `checkoutCsp({ sri: true })` makes that policy). Trying it needs a
production build and the end-to-end load of `/s/demo/no/cart` with the violation listener (`e2e/csp.spec.ts`); it was left
for the gates, because the change that takes the consent manager off the pay routes (`OffPayRoutes`) has to be in first.
Whoever tries it keeps the strictest form that loads with no `securitypolicyviolation` event, and changes this paragraph to say
which was chosen and why.

### The one-line fallback

`CSP_ENFORCE` in `src/lib/csp.ts` is `true`. Set to `false`, the same policy is sent as `Content-Security-Policy-Report-Only`:
nothing is blocked, and the browser's console names what would have been. Use it if a live Stripe session needs something the
documentation did not list; a broken checkout is worse than a loose policy for a day.

**What a broken form looks like:** the payment element does not appear (a missing `frame-src` or `script-src` origin), a
payment method that redirects shows a blank page (`hooks.stripe.com`), or the card brand pictures are missing (`img-src`). The
browser's console says `Refused to … because it violates the following Content Security Policy directive`.

## What is and is not drawn on a pay route

Not drawn (the market layout draws them inside `OffPayRoutes`, `src/components/off-pay-routes.tsx`, which draws nothing on these routes; the components are imported only by `src/app/s/[store]/[market]/extras.tsx`): the
consent banner and the consent manager (so no tracking tool loads), the owner's own code (`liveCustomCode()`), the chat widget,
a friend's referral capture and the business popup. Still drawn, because they are the app's own bundle and no other origin:
the header and footer, the visit counter (its checkout-reached count feeds the analytics funnel), the A/B test machinery and
marker (a test of the checkout page, D148), the link back to the admin, the cart drawer.

`src/lib/pay-routes.graph.test.ts` fails if the market layout or a pay route imports a module in `FORBIDDEN_ON_PAY_ROUTES` or uses a name that draws one.

**Every entry into a pay route is a full page load**, because a script that the consent manager or the chat widget added to the
document on an earlier page stays there after a client-side navigation. The cart's checkout button, the drawer's, and any
redirect that ends on `/checkout` use a full navigation (the cart's action hands back where to go, `window.location.assign`), and
`PayRouteGuard` on the cart, checkout and order pages reloads the document once if it has been on any other page of the store: the
market layout's `PayDocumentWatcher` notes that in a module variable (nothing is stored, a reload starts clean, so it cannot loop).
The cart's slide-out on phones is not a pay page and is left alone. A scan test fails on a `<Link>` to `/checkout`.

**The checkout page may not hold an `html` block or a video that embeds another site** (the policy would block them, and they
are exactly the owner-script risk): `savePage()` refuses to save one on the page chosen for the checkout, and `setPageRole()`
refuses to choose a page that holds one. An uploaded video is allowed.

## Runbook

| Symptom | Likely cause | What to do |
|---|---|---|
| The payment form does not load on a store | a Stripe origin missing from the policy, or the policy broke the shell | set `CSP_ENFORCE = false`, deploy, read the console, fix the list, restore |
| Redirect payment methods (iDEAL, Bancontact, …) end on a blank page | `https://hooks.stripe.com` missing from `frame-src`, or `form-action` too strict for the redirect | as above |
| Pictures or logos missing on the cart | the storage host is not in `img-src` (is `NEXT_PUBLIC_SUPABASE_URL` set in the build?) | check the variable; the host is read when the deployment is built |
| A store owner's tracking tool or chat does not run on the checkout | by design (above) | tell them; it is the point |
| A platform admin is locked out of the admin | not about payments: see `docs/wave-1-trust.md` 2.6 | `ADMIN_TWO_STEP=off` in Vercel as the break-glass |

## What the company must do

1. Make and sign the SAQ A each year for the business that takes payments, answering the eligibility criteria from what is
   written here and from a real test-mode payment.
2. Before the first release with the policy enforced: **a test-mode payment on a Vercel preview, through to the order page**,
   with an axe run on the checkout page; record the result here (below). If something Stripe needs is missing, use the fallback.
3. Decide whether Kaizen, as the platform, has PCI obligations of its own beyond each store's (a question of service-provider
   status: not read in this run).

### Manual check (to be filled in by whoever runs it)

| Date | By | Preview address | Payment through to the order page | Violations in the console | Axe on the checkout page |
|---|---|---|---|---|---|
| | | | | | |
