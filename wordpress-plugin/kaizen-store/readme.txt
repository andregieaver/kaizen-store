=== Kaizen Store ===
Contributors: kaizenstore
Tags: ecommerce, products, shortcode, carousel, grid
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Show products from your Kaizen Store stores on WordPress, as a grid or a carousel, with shortcodes you make once and reuse.

== Description ==

Connect this site to your Kaizen Store account, choose a store, and make a *view*: which products (all, some categories, some tags, or products you pick by hand), in which of the store's markets, as a grid or a carousel, how many, and what to show. Each view gets a shortcode such as `[kaizen_products id="123"]` that you paste into any page, post or widget. Views are saved in WordPress, so you can reuse, change or duplicate them.

* Connect with an approval in Kaizen: your password never reaches WordPress, and you can disconnect from either side.
* Every store you belong to is offered, with its markets (country, language and currency).
* Prices, VAT labels, reductions and unit prices come from Kaizen exactly as the store shows them.
* Product lists are kept for ten minutes so your pages stay fast, and the last good list is shown if Kaizen cannot be reached.
* Products open on a page of your site, with their options, price and stock, and go into a slide-out cart. Checkout takes the shopper to the store, where shipping, discounts, VAT and payment are handled.

= What the site can read =

The products, prices, pictures, categories and tags your stores show shoppers, for the stores you belong to; and it can make a shopping cart in a store for a shopper who presses Checkout. It cannot read orders, customers or settings, and it cannot change a product, price, order or setting.

= Shortcode =

`[kaizen_products id="123"]` shows the saved view 123. You can change a use of it with `layout="carousel"`, `columns="3"` or `limit="6"`.

`[kaizen_product]` is the product page (the plugin makes a page for it). `[kaizen_cart_button]` is a button that opens the cart.

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

A cart, yes: a slide-out cart on your site. Not a checkout: pressing Checkout makes the same cart in the store and takes the shopper there, where delivery, discounts, VAT and payment are handled. Only products that are shipped or downloaded go in the cart; an appointment, a stay, a rental or a subscription is chosen on the store's own page.

= What happens to my views if I delete the plugin? =

The connection and saved lists are removed. The views themselves are your content and stay in the database.

== Changelog ==

= 1.1.0 =
* A product page on your site (a page holding [kaizen_product]) with the product's pictures, options, price and stock, made on the server so search engines can read it, with structured data.
* Add to cart on product cards and the product page, and a slide-out cart that looks like the store's. Checkout takes the shopper to the store with the cart already filled; shipping, discounts, VAT and payment stay there.
* [kaizen_cart_button] for a menu or header, an optional round cart button on every page, and shop settings under Kaizen, Connection.
* A view can link to the site's product page or to the store, and can leave out the cart button.

= 1.0.0 =
* First release: connection, saved views, grid and carousel shortcode, products by hand.
