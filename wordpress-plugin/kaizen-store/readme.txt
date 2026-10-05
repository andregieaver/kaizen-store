=== Kaizen Store ===
Contributors: kaizenstore
Tags: ecommerce, products, shortcode, carousel, grid
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Show products from your Kaizen Store stores on WordPress, as a grid or a carousel, with shortcodes you make once and reuse.

== Description ==

Connect this site to your Kaizen Store account, choose a store, and make a *view*: which products (all, some categories, some tags, or products you pick by hand), in which of the store's markets, as a grid or a carousel, how many, and what to show. Each view gets a shortcode such as `[kaizen_products id="123"]` that you paste into any page, post or widget. Views are saved in WordPress, so you can reuse, change or duplicate them.

* Connect with an approval in Kaizen: your password never reaches WordPress, and you can disconnect from either side.
* Every store you belong to is offered, with its markets (country, language and currency).
* Prices, VAT labels, reductions and unit prices come from Kaizen exactly as the store shows them.
* Product lists are kept for ten minutes so your pages stay fast, and the last good list is shown if Kaizen cannot be reached.
* A product opens on the store, where the shopper buys it.

= What the site can read =

The products, prices, pictures, categories and tags your stores show shoppers, for the stores you belong to. It cannot read orders, customers or settings, and it cannot change anything.

= Shortcode =

`[kaizen_products id="123"]` shows the saved view 123. You can change a use of it with `layout="carousel"`, `columns="3"` or `limit="6"`.

== Installation ==

1. Upload the plugin's zip under Plugins, Add New Plugin, Upload Plugin, and activate it.
2. Open Kaizen in the menu, and choose Connect to Kaizen. Sign in on Kaizen and approve this site. The site must use https.
3. Under Kaizen, Views, choose Add view, set it up and save. Copy its shortcode into a page.

== Frequently Asked Questions ==

= Why does Kaizen say my site must use https? =

The connection hands a secret to this site, so Kaizen only connects sites that are served securely.

= A price changed in my store, but the page still shows the old one. =

Pages keep each list for ten minutes. Choose Clear saved product lists under Kaizen, Connection to show current products at once.

= Does the plugin add a cart or checkout? =

No. A product opens on the store, which handles the cart, delivery, VAT and payment.

= What happens to my views if I delete the plugin? =

The connection and saved lists are removed. The views themselves are your content and stay in the database.

== Changelog ==

= 1.0.0 =
* First release: connection, saved views, grid and carousel shortcode, products by hand.
