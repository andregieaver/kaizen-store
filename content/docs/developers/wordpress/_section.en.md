---
title: WordPress plugin
order: 50
summary: Show a store's products on a WordPress site.
---

## Download the plugin

The plugin is installed by upload: download its zip, then in WordPress go to **Plugins**, **Add New Plugin**, **Upload Plugin**, choose
the zip and activate it. Install the newest version. The earlier ones are kept for a site that has to go back to one.

| Version | Released | What changed | Download |
|---|---|---|---|
| **1.3.4** (newest) | 4 November 2026 | *Move to Kaizena Flow* has two switches for move day when you keep WordPress: *Pause buying*, and *Send shoppers to the new shop*. | [kaizen-store-wordpress-1.3.4.zip](/downloads/wordpress/kaizen-store-wordpress-1.3.4.zip) |
| 1.3.3 | 4 November 2026 | *Move to Kaizena Flow* reads your pages, posts and menus, so a whole site can move; shortcodes are taken out and named, never run. | [kaizen-store-wordpress-1.3.3.zip](/downloads/wordpress/kaizen-store-wordpress-1.3.3.zip) |
| 1.3.2 | 4 November 2026 | *Move to Kaizena Flow* reads the gift card plugins' cards with money left: balance, expiry and holder, never a card's code. | [kaizen-store-wordpress-1.3.2.zip](/downloads/wordpress/kaizen-store-wordpress-1.3.2.zip) |
| 1.3.1 | 4 November 2026 | *Move to Kaizena Flow* reads every Yoast SEO and Rank Math field of products and categories, and titles written with the plugin's variables as the plugin shows them. | [kaizen-store-wordpress-1.3.1.zip](/downloads/wordpress/kaizen-store-wordpress-1.3.1.zip) |
| 1.3.0 | 4 November 2026 | *Move to Kaizena Flow*: when you move a WooCommerce shop, Kaizena Flow can read, after you allow it, your plugins, redirects, products' SEO texts and MailPoet's subscribers. It only reads, and every call is signed. | [kaizen-store-wordpress-1.3.0.zip](/downloads/wordpress/kaizen-store-wordpress-1.3.0.zip) |
| 1.2.1 | 4 November 2026 | A cart line holds more than 20 units, up to what the product's quantity rule allows. The quantity field starts at the variant's own minimum. | [kaizen-store-wordpress-1.2.1.zip](/downloads/wordpress/kaizen-store-wordpress-1.2.1.zip) |
| 1.2.0 | 26 October 2026 | Products sold so many at a time: the quantity field and the cart's steps follow the store's rule, and the cart says it. | [kaizen-store-wordpress-1.2.0.zip](/downloads/wordpress/kaizen-store-wordpress-1.2.0.zip) |
| 1.1.0 | 5 October 2026 | A product page on your site, *Add to cart*, a slide-out cart and checkout in the store, `[kaizen_cart_button]`. | [kaizen-store-wordpress-1.1.0.zip](/downloads/wordpress/kaizen-store-wordpress-1.1.0.zip) |
| 1.0.0 | 5 October 2026 | The first release: the connection, saved views, and grid and carousel shortcodes. | [kaizen-store-wordpress-1.0.0.zip](/downloads/wordpress/kaizen-store-wordpress-1.0.0.zip) |

Installing a version over another keeps the connection and the saved views. The newest is also at
`https://kaizenaflow.com/downloads/kaizen-store-wordpress.zip`, the address [Account, WordPress](/admin/account/wordpress) links.

> [!NOTE]
> Version 1.0.0 was made before the platform had its present address, and connects to the old one by default. To use it, add
> `define( 'KAIZEN_STORE_API_URL', 'https://kaizenaflow.com' );` to the site's `wp-config.php` before you connect.
