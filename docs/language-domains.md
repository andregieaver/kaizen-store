# A domain per language (D313)

A store may give any of its languages a domain of its own, as an option: `nordic.com` for the store, and `nordic-en.com`
for English. Nothing changes for a store that does not.

## What the owner does

Settings → Domains. A domain is added and proved as any other (P8: the TXT record, pointing at Vercel). Under it,
*Use for one language* chooses the language; *Every language* (the default) keeps it leading to the store's address.
Only an owner chooses. The languages offered are the store's kept languages but its own country's own, which is the
store's address (`domainLanguages()` in `src/lib/custom-domains.ts`). A language has at most one domain, and the store's
address (its primary) is always for every language: the database refuses otherwise
(`store_domains.language`, `store_domains_language_idx`, `store_domains_primary_language`). Routing is built into each
deployment (P8), so a change deploys again, as `setDomainLanguage()` (`src/server/domains.ts`) asks.

## How addresses work there

On a language's own domain a market without a language is in that language, so its addresses never name it:

| Store | On `nordic.com` | On `nordic-en.com` (English) |
| --- | --- | --- |
| One country (D181) | `/home` in Norwegian | `/home` in English (`no-en`) |
| | `/en/home` → moves to `nordic-en.com/home` | `/eur/home` English in euro (`no-en-eur`) |
| Several countries | `/se/x` Sweden in Swedish | `/se/x` Sweden in English (`se-en`) |
| | `/se-en/x` → moves to `nordic-en.com/se/x` | `/no-en/x`, `/en/x` → move to the short one |

A request for a market whose language lives on another origin moves there (308, GET and HEAD only): English on the
store's address to its domain, another language or the store's main one on a language's domain to the store's address.

- **Routing.** `storeHostRoutes()` (`src/lib/store-hosts.ts`) rewrites a language's domain to the store as it does the
  primary, and never moves it to the primary as it does the store's other domains. The domains reach the code as
  `NEXT_PUBLIC_STORE_HOSTS` (`StoreHosts[slug].languages`, read at build by `readStoreHosts()`).
- **The proxy** (`storeRequestAnswer()`, `src/server/redirect-resolve.ts`) knows the host asked and asks
  `languageHostDecision()` (`src/lib/store-address.ts`, pure) first; anything it leaves (`undefined`) goes to D181's
  `addressDecision()` as before. A country's own language comes from `StoreAddress.owns`.
- **Links.** `marketPath()` writes a market on its language's domain without the language; `marketOrigin()` is the
  market's origin and `marketUrl()` a full address on it. **Never build a full address as `storeSiteUrl() + marketPath()`**:
  emails, Stripe's return addresses, the sitemap and structured data use `marketUrl()`; canonical, `hreflang` and share tags use `marketMetaPath()`, a path under the page's `metadataBase` as before for a store without language domains and the full address for one with them. A link
  from one market to another (the language and currency choice) is `marketLink()`: a path on the same origin, a full
  address across, which the menu opens as a full page load. The market layout's `metadataBase` is the market's origin.
- **Moves made by the routes** (`marketMoved()`, manual redirects through `locationIn()`) are full addresses when the store
  has language domains, since the request may be on another origin.

## What it does not do

- A cart, a shopper's sign-in, cookie choices and the browser's storage are per site, as browsers keep them: a shopper who
  changes language to another domain starts a new cart there. The panel says so.
- Kaizena Flow's own address for a store (`/s/{store}/…`) has no language domains; it moves to the store's host as before.
- The store's sitemap lists every language's addresses on their own origins, from whichever host it is fetched; search
  engines accept a sitemap that names other hosts only when both are verified to the same owner.
- *Edit text* on the live site (D192, D193) is offered only in the store's main language, so it never runs on a
  language's domain.

## Tests

`src/lib/language-domains.test.ts` (requests both ways, links, routing, the languages offered), the PGlite checks in
`src/db/commerce.test.ts`, `src/server/domains.int.test.ts` (choosing a language, refusals, routed as saved),
`e2e/store-hosts.spec.ts` with `e2e/hosts-seed.mjs` (English on `english.kari.localhost`).
