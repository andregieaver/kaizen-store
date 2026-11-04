=== Kaizena Flow ===
Contributors: kaizenstore
Tags: ecommerce, products, shortcode, carousel, grid
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.3.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Show products from your Kaizena Flow stores on WordPress, as a grid or a carousel, with shortcodes you make once and reuse.

== Description ==

Connect this site to your Kaizena Flow account, choose a store, and make a *view*: which products (all, some categories, some tags, or products you pick by hand), in which of the store's markets, as a grid or a carousel, how many, and what to show. Each view gets a shortcode such as `[kaizen_products id="123"]` that you paste into any page, post or widget. Views are saved in WordPress, so you can reuse, change or duplicate them.

* Connect with an approval in Kaizena Flow: your password never reaches WordPress, and you can disconnect from either side.
* Every store you belong to is offered, with its markets (country, language and currency).
* Prices, VAT labels, reductions and unit prices come from Kaizena Flow exactly as the store shows them.
* Product lists are kept for ten minutes so your pages stay fast, and the last good list is shown if Kaizena Flow cannot be reached.
* Products open on a page of your site, with their options, price and stock, and go into a slide-out cart. Checkout takes the shopper to the store, where shipping, discounts, VAT and payment are handled.

= What the site can read =

The products, prices, pictures, categories and tags your stores show shoppers, for the stores you belong to; and it can make a shopping cart in a store for a shopper who presses Checkout. It cannot read orders, customers or settings, and it cannot change a product, price, order or setting.

= Moving a WooCommerce shop to Kaizena Flow =

When you move your WooCommerce shop to Kaizena Flow, this plugin can read what WooCommerce's own key cannot: which plugins your shop uses, the redirects of Redirection, Yoast SEO Premium and Rank Math, every Yoast SEO and Rank Math field of your products and product categories (titles and descriptions as shoppers see them, focus keywords, canonical addresses, robots, social titles, descriptions and pictures, breadcrumb titles and primary categories), MailPoet's subscribed subscribers with when they subscribed, your pages, posts and menus (shortcodes are taken out, never run), and the gift cards of WooCommerce Gift Cards, PW Gift Cards and YITH Gift Cards with money left (their balance, expiry and holder, and only the last four characters of a code: Kaizena Flow gives each card a new code). It reads only after you press Allow under Kaizena Flow, Move to Kaizena Flow, and only for calls signed with a secret this site made and sent to Kaizena Flow alone. It never changes anything on this site by itself. Stop Kaizena Flow reading forgets the secret.

If you keep WordPress for your pages and blog, Move to Kaizena Flow has two switches for move day, each yours to press: Pause buying (Add to cart hidden and a short notice that you are moving), and Send shoppers to the new shop (each product, category, the shop, the cart and the checkout lead there; your other pages stay).

= Shortcode =

`[kaizen_products id="123"]` shows the saved view 123. You can change a use of it with `layout="carousel"`, `columns="3"` or `limit="6"`.

`[kaizen_product]` is the product page (the plugin makes a page for it). `[kaizen_cart_button]` is a button that opens the cart.

== Installation ==

1. Upload the plugin's zip under Plugins, Add New Plugin, Upload Plugin, and activate it.
2. Open Kaizena Flow in the menu, and choose Connect to Kaizena Flow. Sign in on Kaizena Flow and approve this site. The site must use https.
3. Under Kaizena Flow, Views, choose Add view, set it up and save. Copy its shortcode into a page.

== Frequently Asked Questions ==

= Why does Kaizena Flow say my site must use https? =

The connection hands a secret to this site, so Kaizena Flow only connects sites that are served securely.

= A price changed in my store, but the page still shows the old one. =

Pages keep each list for ten minutes. Choose Clear saved product lists under Kaizena Flow, Connection to show current products at once.

= Does the plugin add a cart or checkout? =

A cart, yes: a slide-out cart on your site. Not a checkout: pressing Checkout makes the same cart in the store and takes the shopper there, where delivery, discounts, VAT and payment are handled. Only products that are shipped or downloaded go in the cart; an appointment, a stay, a rental or a subscription is chosen on the store's own page.

= What happens to my views if I delete the plugin? =

The connection and saved lists are removed. The views themselves are your content and stay in the database.

== Changelog ==

= 1.3.4 =
* Move to Kaizena Flow: two switches for move day when you keep WordPress for your pages and blog. Pause buying, and Send shoppers to the new shop (products, categories, the shop, cart and checkout lead there; your other pages stay).

= 1.3.3 =
* Moving to Kaizena Flow reads your pages and posts (drafts too, every shortcode taken out and named, never run) and your menus, so a whole site can move.

= 1.3.2 =
* Moving to Kaizena Flow reads the gift cards of WooCommerce Gift Cards, PW Gift Cards and YITH Gift Cards that have money left: their balance, expiry and holder, never a card's code (only its last four characters).

= 1.3.1 =
* Moving to Kaizena Flow reads every Yoast SEO and Rank Math field of products and product categories, not only their titles and descriptions, and gives titles and descriptions written with the plugin's variables as the plugin shows them.

= 1.3.0 =
* Moving a WooCommerce shop to Kaizena Flow: Move to Kaizena Flow lets Kaizena Flow read, after you allow it, the plugins you use, your redirects, your products' SEO titles and descriptions, and MailPoet's subscribed subscribers. It only reads, and every call is signed.

= 1.2.1 =
* A product sold in larger amounts (24 at a time, say, up to 9,999 on a line) can be priced and taken to checkout: the site's cart no longer refuses a line of more than 20. The product page's quantity field starts at the first variant's own minimum and step before the script runs.

= 1.2.0 =
* Products sold so many at a time (a minimum, a maximum or in multiples): the quantity field and the cart's steps follow the store's rule, and the cart says it.

= 1.1.0 =
* A product page on your site (a page holding [kaizen_product]) with the product's pictures, options, price and stock, made on the server so search engines can read it, with structured data.
* Add to cart on product cards and the product page, and a slide-out cart that looks like the store's. Checkout takes the shopper to the store with the cart already filled; shipping, discounts, VAT and payment stay there.
* [kaizen_cart_button] for a menu or header, an optional round cart button on every page, and shop settings under Kaizena Flow, Connection.
* A view can link to the site's product page or to the store, and can leave out the cart button.

= 1.0.0 =
* First release: connection, saved views, grid and carousel shortcode, products by hand.
