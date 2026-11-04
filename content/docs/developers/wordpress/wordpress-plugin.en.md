---
title: Show a store's products on WordPress
summary: Install the Kaizena Flow plugin, connect it to your stores, and place product lists, a product page and a cart on WordPress pages with shortcodes.
track: developers
section: wordpress
kind: how-to
areas: [integrations, products, website]
features: []
plans: []
admin: /admin/account/wordpress
order: 10
checked: 2026-11-04
sources: [D169, D170, D323]
---

The Kaizena Flow plugin shows products from your stores on a WordPress site, as a grid or a carousel. Products can open on a page of your
site and go into a cart there. The shopper pays at the store: *Checkout* takes the same cart to the store's own checkout.

## What you need

| | |
|---|---|
| WordPress | 6.0 or later (tested up to 6.8) |
| PHP | 7.4 or later |
| The site's address | `https`. Plain `http` works only on a developer's own machine: `localhost`, `127.0.0.1`, `[::1]` and names ending in `.localhost`, `.local` or `.test` |
| In WordPress | An administrator: every page of the plugin needs the `manage_options` capability |
| In Kaizena Flow | An account that is an owner or staff member of the store, with the store's online shop on |

The plugin is version 1.3.3. It is installed by upload, not from wordpress.org. It offers shortcodes, not blocks for the block editor, and it
does not use WooCommerce.

## Install the plugin

1. In Kaizena Flow's admin, open [Account, WordPress](/admin/account/wordpress) and download the plugin. The file is
   `https://kaizenaflow.com/downloads/kaizen-store-wordpress.zip`. Every version, the earlier ones too, is on
   [WordPress plugin](/docs/developers/wordpress#download-the-plugin).
2. In WordPress, go to **Plugins**, **Add New Plugin**, **Upload Plugin**, choose the zip and activate it.

Activating it makes a page called *Product* that holds `[kaizen_product]`: the page your site's products open on.

## Connect it to your stores

1. In WordPress, open **Kaizena Flow** in the menu and choose **Connect to Kaizena Flow**.
2. Sign in on Kaizena Flow. The approval page names your site and what it may read.
3. Press **Approve**. You come back to WordPress, connected.

There is no token to copy. The approval gives the site a token of its own, made for this site only, kept in WordPress and shown nowhere.
It is not a storefront API token. Your password never reaches WordPress.

What the connection may do:

- Read the products, prices, pictures, categories and tags that shoppers see, for every store your account belongs to as owner or staff.
- Make a cart in a store for a shopper who presses *Checkout*.
- Nothing else: it reads no orders, customers or settings, and changes no product, price, order or setting.

To end it, press **Disconnect from Kaizena Flow** on the plugin's *Connection* page, or disconnect the site under
[Account, WordPress](/admin/account/wordpress). Either ends it at once.

> [!NOTE]
> The plugin talks to `https://kaizenaflow.com`. Leave that as it is unless you were told otherwise. To change it, use *Advanced* on the
> *Connection* page before you connect, or define `KAIZEN_STORE_API_URL` in `wp-config.php`, which wins over the setting.

## Make a view

A *view* is a saved product list: which store, which products, and how they look. Each view gets its own shortcode. Go to **Kaizena
Flow**, **Views**, **Add view**, give it a name and fill in:

| Field | What it sets |
|---|---|
| Store | One of the stores your account belongs to |
| Market | The country, language and currency of the prices. Empty: the store's first market |
| Products | *All products*, *Products in categories*, *Products with tags*, or *Products I pick* (found by name, kept in the order you pick them) |
| Order | Newest first, Oldest first, By name, Cheapest first or Most expensive first. Picked products keep your order |
| Number of products | 1 to 48 (12 when you do not say) |
| Layout | Grid or Carousel |
| Columns | Products side by side, 1 to 6 (4 when you do not say) |
| Show | Price, Short description, Button, Add to cart button, Open products in a new tab |
| Products open on | This site's product page, or the store |
| Button words | Up to 40 characters. Empty: the market's language (Norwegian, Danish, Swedish, German or Finnish words, else English) |

*Refresh preview* shows the view as it will look. Save it to get its shortcode. A view of categories or tags with none chosen, or of picked
products with none picked, shows nothing, never everything. The list of views can duplicate one.

## Shortcodes

| Shortcode | Attributes | What it shows |
|---|---|---|
| `[kaizen_products id="123"]` | `id`: the view. `layout`: `grid` or `carousel`. `columns`: 1 to 6. `limit`: 1 to 48 | A saved view. The other attributes change this one use of it |
| `[kaizen_product]` | `store`, `market` and `handle`: one fixed product. `title="show"`: print the product's name too | The product page: the product named by the page's address |
| `[kaizen_cart_button]` | `label`: the button's words (*Cart* when you do not say) | A button that opens the cart, with the number of units in it |

Put them in any page, post or widget that takes shortcodes:

```text
[kaizen_products id="123" layout="carousel" columns="3" limit="6"]
```

Change a view later, and every place that uses it follows.

## The product page

A product opens on the page that holds `[kaizen_product]`, at `/{page}/{store}/{market}/{handle}/` (or `?page_id=…&kz_store=…&kz_market=…&kz_handle=…`
without pretty permalinks). The plugin draws it on the server, so search engines can read it: pictures, options, price, stock and
description, with the page's title, description, canonical address, Open Graph tags and `Product` structured data. The shopper's choice of
variant, its price, stock and picture, and *Add to cart* are the plugin's script.

It shows products only of stores that a saved view uses. Any other product, or a product that is not there, is a real 404.

Choose the page under **Kaizena Flow**, **Connection**, *Shop: product pages and the cart*, or tick *Make a new product page*. With
*None*, products open on the store.

## Buying: the cart and the checkout

- **Add to cart** is on a card of a product with one variant, and on the product page. A card of a product with options says *Choose
  options* and opens the product page.
- **The cart** is kept in the shopper's browser for a week and opens from the right. It holds one store and market: adding from another
  asks first. Each line has its picture, options, a quantity stepper and *Remove*. Prices, stock and words come from Kaizena Flow, asked
  through your site.
- **Checkout** makes the same cart in the store and sends the shopper to the store's own checkout. Shipping, discounts, campaigns, VAT and
  payment are worked out there, so the site's cart shows a subtotal only.
- **Only goods** that are shipped or downloaded go in the cart. An appointment, a stay, a rental, a subscription or a product for businesses
  only is chosen on the store's own page, and its button opens it there.

On the same *Shop* card, two boxes are ticked at first. Untick *Show products on this site and use the cart* to switch the product page
and the cart off: products then open on the store. Untick *Show a round cart button on every page once something is in the cart* to drop
the floating button, and use `[kaizen_cart_button]` in a menu or header instead.

## Products sold so many at a time

A variant may have a quantity rule in the store: a minimum, a maximum and a step (sold in sixes, say). Since version 1.2.0 the plugin follows
it. The product page's quantity field starts at the minimum, moves by the step and stops at what the rule and the stock allow. The cart's
stepper moves by the same step, and the cart shows the rule's words. Kaizena Flow fits each line to the rule and the stock when it prices the
cart and when it hands it to checkout, so the shopper lands on the same quantities.

The site's own cart route takes at most 30 lines, each of 1 to 9,999 units, the most a quantity rule allows. Version 1.2.0 refused a line
of more than 20 there, so update to 1.2.1 if you sell in larger amounts.

## Prices

Prices, VAT words, reductions and unit prices come from Kaizena Flow written out, exactly as the store shows them: VAT included or not as the
store shows it, the lowest price in the last 30 days only for a genuine reduction, and the price per kg or litre where the product has one.
The plugin never works out a price or a label of its own.

## Caching

| What | Kept | Change it |
|---|---|---|
| A view's products | 10 minutes | The `kaizen_store_cache_seconds` filter |
| A product page's product | 2 minutes | The `kaizen_store_product_cache_seconds` filter |
| A cart's prices | 15 seconds | Not changeable |

So a changed price or a new product shows in a list within ten minutes. **Clear saved product lists** on the *Connection* page, or saving a
view, shows current lists at once. A filter returning 0 asks Kaizena Flow every time:

```php
add_filter( 'kaizen_store_cache_seconds', function () {
	return 5 * MINUTE_IN_SECONDS;
} );
```

The last good list of each view is also kept for a week. It is shown only while Kaizena Flow cannot be reached or cannot answer, or the
connection's calls are used up. A refusal, such as a disconnected site or a store that is no longer yours, shows nothing and drops the kept
lists.

## When something is wrong

Visitors see products or nothing. A problem, such as a view with no store, a store not open yet, or a view that matches no products, is a
note that only administrators see on the page. The *Connection* page lists each store with its markets and whether it is open.

## Limits

- A connection may make 1,500 calls to Kaizena Flow an hour, and hand 60 carts to checkout an hour.
- The shopper's browser asks your site, never Kaizena Flow, for a cart's prices and its checkout: the REST routes `kaizen/v1/cart/quote`
  and `kaizen/v1/cart/checkout` (under `/wp-json/` on most sites). Your site asks Kaizena Flow with the connection's token, which the browser
  never sees. The routes take only stores a saved view uses, at most 30 lines with each variant once, and each visitor's address may ask 90
  prices and 12 checkouts a minute.

## Removing the plugin

Deleting the plugin removes the connection, the address setting, the shop settings and the kept lists. Your views are your content and stay in
the database.
