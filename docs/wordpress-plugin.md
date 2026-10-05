# The WordPress plugin (D169, D170)

A plugin that shows products from a store owner's Kaizen stores on a WordPress site, as a grid or a carousel, with saved shortcodes. Asked for by
the owner; built apart from the parity waves. The plugin is in `wordpress-plugin/kaizen-store/` (PHP 7.4+, WordPress 6.0+, no build step, no
dependencies), its installable zip in `public/downloads/kaizen-store-wordpress.zip`, offered at `/admin/account/wordpress`.

## What it does

- **Connect.** The owner chooses *Connect to Kaizen* in WordPress, is sent to `/admin/account/wordpress/connect`, signs in there (so two-step works) and
  approves. The password never reaches WordPress. The site gets a token that can **read the public catalogue** of the stores the account belongs to
  (owner or staff, not ended, not closed, never the template) and nothing else: no order, customer or setting, and it changes nothing.
- **Views.** A *view* is a saved post of the private type `kaizen_view`: store, market (country, language, currency), the products (all, categories,
  tags, or picked by hand and kept in that order), order, count (1 to 48), grid or carousel, columns (1 to 6), what to show (price, short description,
  button, button words, new tab). It is edited on its own screen with a live preview, listed with its shortcode, and can be duplicated.
- **Shortcode.** `[kaizen_products id="123"]`; `layout`, `columns` and `limit` change one use of it. Any page, post or widget that takes shortcodes.
- **Drawn in WordPress**, by the plugin, from what Kaizen answers.
- **A product page on the site** (D170): a page holding `[kaizen_product]` (made on activation, chosen under Kaizen, Connection) shows any product of a store a
  saved view uses, from the address (`/{page}/{store}/{market}/{handle}/`, or `?kz_store=&kz_market=&kz_handle=` without pretty permalinks). It is drawn **on the
  server** (pictures, options as radio choices, price, stock, description) so search engines can read it, with the title, description, canonical address,
  Open Graph tags and `Product` structured data (an `Offer`, or an `AggregateOffer` when variants differ, with the price as the store shows it); an unknown
  product or a store no view uses is a real 404. The script chooses the variant (a value with no variant behind it is disabled), changes price, stock and
  picture, and adds to the cart.
- **A slide-out cart** (D170): *Add to cart* on a card (a product with one variant) and on the product page; a card of a product with options says *Choose options*
  and opens the product page. The cart is kept in the browser (`localStorage`, forgotten after a week) and shown in a dialog from the right (focus kept, Escape,
  a round button on every page once it holds something, `[kaizen_cart_button]` for a menu). Each line has the picture, options, a quantity stepper (up to the
  stock, at most 20) and remove; the prices, stock and words are Kaizen's, asked through the site's REST route; the subtotal is the sum of the lines.
  **Shipping, discounts, campaigns, VAT and payment are the store's**: *Checkout* makes the same cart in the store and sends the shopper to its checkout.
  A cart holds one store and market (another asks first). Only shipped goods and downloads go in the cart (`cartableReason()`): an appointment, stay or rental
  needs a time, a subscription a plan, a business-only product a business buyer, and their button opens the store's own page.

## The connection (the owner's approval, then a swap)

1. Plugin: makes a random `verifier` and `state`, keeps them ten minutes (a transient, for that user), and sends the browser to
   `{kaizen}/admin/account/wordpress/connect?site=…&name=…&return=…&state=…&challenge=…`, where `challenge` is base64url(SHA-256(verifier)),
   `site` the origin of the WordPress admin and `return` its Kaizen page.
2. Kaizen (`readApproval()`): `site` must be `https` (plain `http` only on `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, `*.local`, `*.test`), with
   no credentials; `return` must be on the **same origin**; `state` and `challenge` must have their shape. The page names the site and what it may
   read; someone not signed in goes to sign in and back (`next` is kept). *Approve* (`answerApprovalAction()`, a server action that reads the
   request again with the same rules) writes `commerce.wordpress_connections` with the **hash** of a one-time code (`kzwc_…`, 256 bits, five minutes)
   and the challenge, and sends the browser to `return` with `kaizen_state` and `kaizen_code` (or `kaizen_error=denied`).
3. Plugin: checks the state is one it made for this user (and uses it once), then `POST /api/wordpress/v1/token` `{ code, verifier, site }`, server to
   server. Kaizen swaps the code, **once** (`UPDATE … WHERE token_hash IS NULL`), only for that site and the holder of the verifier (`verifierMatches()`),
   for a token `kzwp_…` (256 bits) kept only as a hash; every refusal is the same `400 invalid_grant`. A code stolen from the address bar is useless
   without the verifier, and a verifier without the code is too.
4. The token is kept in the option `kaizen_store_connection` (autoload off). It is shown nowhere. *Disconnect* in WordPress calls
   `DELETE /api/wordpress/v1/connection` and forgets it; the owner can also disconnect each site under Account, WordPress. Either ends it at once.

## The API (`/api/wordpress/v1`, `src/app/api/wordpress/v1`, `src/server/wordpress.ts`, `wordpress-route.ts`)

`Authorization: Bearer kzwp_…` on everything but `/token`; every answer is `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

| Route | Answer |
|---|---|
| `POST /token` | `{ token, account: { email, name } }` |
| `GET /connection`, `DELETE /connection` | who the token is and how many stores it reaches; ends this connection |
| `GET /stores` | `{ stores: [{ slug, name, role, open, url, markets: [{ slug, country, name, currency, language }] }] }` |
| `GET /stores/{slug}/terms` | `{ categories: [{ id, name, depth }], tags: [{ id, name }] }` |
| `GET /stores/{slug}/products?q=&limit=` | products to pick by hand: `{ id, handle, title, image }` |
| `GET /stores/{slug}/view?market&source&categories&tags&ids&sort&limit` | `{ store, market, open, shop_url, labels, products: [{ id, handle, title, excerpt, url, image, price, cart }] }`; `cart` is `{ cartable, reason, variant_id, variant_count, sold_out }` |
| `GET /stores/{slug}/product?handle&market` | the product page's data: pictures, `options`, `variants` (each with `price`, `image`, `stock`), `cartable`, `labels` (D170) |
| `POST /stores/{slug}/cart/quote` | `{ market, lines: [{ variant_id, quantity }] }` to each line's live price, stock and picture, a subtotal and the words (D170) |
| `POST /stores/{slug}/cart/handoff` | the same plus `to: "cart" \| "checkout"` to `{ url, lines }`: the cart made in the store and the one-time address that opens it (D170) |

- Every call looks the account up again: its membership of the store (`storeFor()`), not ended, not disabled. A store that is not the account's is a
  `404 no_such_store` that says nothing of whether it exists.
- **Rules** (`src/lib/wordpress.ts`, one place): `viewQuery` (source, sort, 1 to 48, UUID lists, market slug); a category or tag view with none chosen,
  or a hand-picked one with no products, shows **nothing**, never everything; a category that is gone shows nothing; hand-picked products keep their
  order (`sort=given`) and only this store's active ones with a price in the market are returned.
- **Products** come from the same read as a content grid (`listGridProducts()`, D51, with `gridScope()`), so a price in the market, a reduction and a unit
  price are the storefront's own. `wordpressPrice()` (`src/lib/wordpress-view.ts`) writes the price out in the market's language and currency exactly as
  `<Price>` does (VAT as the store shows it: `incl`, `excl`, a store selling to both shows with VAT; the 30-day reference **only** for a genuine
  reduction; `unitPriceShown()` for the price per kg or litre; "from" when variants differ). The plugin never works out a price, a rate or a label.
  Addresses are absolute (`storeSiteUrl()` and the market's path).
- **Limits.** 1,500 calls an hour per connection and 120 code swaps an hour in all (`commerce.chat_usage`, buckets `wp:{connection}` and
  `wp:exchange`); `429 rate_limited`. A connection's `last_used_at` is written at most every ten minutes.
- **Data.** `commerce.wordpress_connections` (account, site origin and name, code hash and challenge until swapped, token hash, dates, `revoked_at`);
  RLS on, no policy; in `PERSONAL_DATA` as the owner's own; not store-owned, so not in `COPY_RULES`. Approvals nobody collected are deleted a day after
  they run out. Audit: `account.wordpress_approved`, `account.wordpress_revoked`.

## The cart handed to the store (D170: `src/server/cart-handoff.ts`, `src/server/wordpress-shop.ts`, `src/lib/wordpress-cart.ts`)

- **Quote** (`quoteCart()`): the live price of each variant in the market (`wordpressPrice()`, so VAT, the language and the currency are the storefront's), stock
  (`getAvailability()`; downloads never run out), the picture and address. A line that cannot be bought (gone, not goods, no stock, not this store's) is
  `unavailable` and left out of the subtotal; a quantity above the stock is counted at the stock (`insufficient`). It is a **subtotal**: no shipping,
  discount or campaign, which the store works out at checkout with the address. `wordpress.int.test.ts` holds it to the store: the cart a shopper lands on has
  the same lines and `Σ unit price × quantity` equals the quote's subtotal.
- **Hand-over** (`createHandoffCart()`): makes a real cart (`commerce.carts`, `cart_lines`) checked line by line as if the shopper had added it in the store
  (`sellableQuantity()`: an active variant with a price in the market, goods only, never subscription-only or business-only, stock for the quantity; a quantity above
  the stock is cut to it). **No cart is made when nothing can be bought** (422, the transaction is undone). The cart is no one's and holds no stock until its
  link is opened: `carts.handoff_hash` (SHA-256 of a 256-bit secret `kzwh_…`), `handoff_expires_at` (15 minutes; the cart itself runs out then) and
  `handoff_to` (`cart` or `checkout`). A connection may make 60 an hour.
- **Open** (`/s/{store}/{market}/cart/resume?t=`, a route in the store's own tree so the cookie is set on the store's host): claims the secret once
  (`UPDATE … WHERE handoff_hash = …`), makes the cart this browser's (`setCartCookie()`, the same cookie a cart always has), extends it to the usual 30 days and
  redirects (303) to the checkout or the cart; a wrong, used, expired or other-store link goes to the cart as it is, saying nothing why. Never cached or indexed,
  no referrer sent. The shopper's earlier cart in that store is left where it is (not deleted), only no longer the one the cookie names.
- The WordPress side clears its own cart when the hand-over succeeds (the cart now lives in the store) and shows nothing of it again; an abandoned checkout is
  the store's cart (it has its own abandoned-cart reminder), not the site's.

## In WordPress

- **Cache.** A view's answer is kept ten minutes (`kaizen_store_cache_seconds` filter), so a page makes no call to Kaizen for most visits; the last
  good answer is kept a week and shown **only while Kaizen cannot be reached** (a network failure or a 5xx). A refusal (a disconnected site, a store that
  is no longer the account's) shows nothing and drops the kept answers. *Clear saved product lists* on the connection page, and saving a view, clear them.
- **Visitors see products or nothing.** A problem (not connected, no products, a store not open) is a note only people who can manage the site see.
- **Assets.** `frontend.css` is loaded only on pages that use the shortcode; `frontend.js` only for a carousel (previous and next buttons on top of a row that
  scrolls by touch, wheel and keyboard without it; no autoplay; reduced motion respected). Output is escaped (`esc_html`, `esc_url`, `esc_attr`).
- **Rights.** Everything is `manage_options` (the views' post type maps all its capabilities to it); every form has a nonce; the editor's calls check
  one too. Uninstall removes the connection, the address setting and the saved lists, and keeps the views (the owner's content).
- **Words.** English with the text domain `kaizen-store`; the button's default words follow the market's language (nb, nn, da, sv, de, fi, else English)
  and can be set per view. Prices and VAT words come from Kaizen.

## Testing and shipping

- `src/lib/wordpress.test.ts`, `wordpress-view.test.ts` (rules and the price's words), `src/server/wordpress.int.test.ts` (the whole API against a real database:
  swap, token, stores, a view, a store that is not theirs, limits, revoke, a member leaving a store), `src/lib/wordpress-plugin.test.ts` (the zip is the
  plugin as it is, one version everywhere, PHP and JavaScript parse, the plugin asks for routes Kaizen has and speaks the approval's words).
- Checked by hand on a real WordPress 6.8 (SQLite) against a running Kaizen: connect, approve, swap, save a view in the editor, a page with the
  shortcode as a grid and a carousel, hand-picked order, a phone width, and a revoke. The script is not kept in the repository: it needs a WordPress.
- **After changing the plugin:** raise the version in `kaizen-store.php`, `readme.txt` and `src/lib/wordpress-plugin.ts` if it is a release, and run
  `node scripts/build-wordpress-plugin.mjs`; commit the zip. The zip is built to the same bytes every time (fixed dates and order).

## Not done, and why

- No block for the block editor (asked for later, if at all); no WooCommerce. The cart is the plugin's own and the checkout is the store's.
- A product that needs a time (appointment, stay, rental) or a plan (subscription), or is for businesses only, is not put in the site's cart; it opens on the store's page.
- The site's cart does not know when the order is paid (it is cleared when the shopper goes to the checkout), and campaigns, discount codes, shipping and VAT only show at the store's checkout.
- Plain-text token in the WordPress database, as every API key a plugin keeps is; the token can only read public product data, and is revoked
  from Kaizen with one click.
- The approval page is not covered by an end-to-end test (the repository has no signed-in admin fixture, D158); its rules (`readApproval()`) and the
  swap are tested, and the page was checked by reading.
- Not published to wordpress.org: the zip is installed by upload.
