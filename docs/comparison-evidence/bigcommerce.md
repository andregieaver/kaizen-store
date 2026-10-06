# BigCommerce facts (research agent, read 2026-10-06; model summaries of pages: re-read before quoting; USD only)
1 invoices: native printable invoice templates (docs.bigcommerce.com/docs/store-operations/orders/invoice-templates; detailed one "supported by UK, France, and Poland"); page silent on credit notes, sequential numbering, PDF. App Sufio Invoices $7/mo after 14-day trial lists credit notes, bulk PDF, VAT validation (vendor claim). https://www.bigcommerce.com/apps/sufio-automatic-invoices/
2 Omnibus: app. "Omnibus Pricing" (Sniffie) EUR 349.90/month incl. 30k products/variants. https://www.bigcommerce.com/apps/omnibus-pricing
3 withdrawal: BigCommerce's own blog post dated 01/07/2026 (1 July 2026): "doesn't offer a native withdrawal function yet, so this is something to set up at the store level for now"; says nothing on exclusions/digital waiver. https://www.bigcommerce.co.uk/blog/eu-right-of-withdrawal-requirement/ (re-check before publishing)
4 GPSR: unverified. 5 DAC7: unverified.
6 VAT: manual tax zones/rates or third-party provider; Avalara AvaTax calculates VAT/GST for EU states; OSS/IOSS, built-in EU rates, checkout VAT-number validation unverified. https://support.bigcommerce.com/articles/Public/Tax-Overview
7 bookings: unverified (marketplace category exists, listings did not render).
8 multi-vendor: app. Webkul "Multi Vendor Marketplace" $10/mo after 10-day trial; MarketCube.io $399/mo (page last updated Nov 2022). https://www.bigcommerce.com/apps/multi-vendor-marketplace-by-webkul/
9 several stores: native multi-storefront, add-on fee per extra storefront: $30/mo (max 3) Core, $50 (max 5) Growth, $100 (max 8) Scale. https://www.bigcommerce.com/pricing/
10 loyalty: app (Yotpo Loyalty and Referrals "starting at $0/month"). 11 referral: app (same). https://www.bigcommerce.com/apps/yotpo-loyalty-rewards/
12 wishlists: native (Catalyst docs; Stencil similar); Swym Wishlist Plus $59.99/mo adds features.
13 reviews: NATIVE ("product ratings and reviews" included on all plans). https://www.bigcommerce.com/pricing/
14 back-in-stock: app. Help article says no built-in feature; Swym Back in Stock $59.99/mo. https://support.bigcommerce.com/articles/en_US/Knowledge/Product-Availability
15 pre-orders: NATIVE ("coming soon but I want to take pre-orders", release date). same article.
16 tiered/volume: NATIVE bulk pricing. https://support.bigcommerce.com/articles/en_US/Knowledge/Possible-Discounts-Offer
17 scheduled reports: unverified.
18 AI: NATIVE "BigCommerce Companion" in control panel, no extra cost; updates order statuses and issues store credits with approval. https://www.bigcommerce.com/product/companion/
19 Vipps: via Adyen (NOK, Optimized One-Page Checkout, Norwegian address); MobilePay via Adyen (DKK/EUR) or Stripe OCS for DK/FI shoppers. https://support.bigcommerce.com/articles/Learning/Vipps
20 Nordic carriers: unverified (real-time quote list names USPS, FedEx, UPS, Canada Post, Royal Mail, Australia Post, Zoom2u; no Nordic carrier verified).
21 hosting: Google Cloud Platform; PCI DSS 4.0 Level 1; 99.99% uptime claim; trust centre ISO 27001/27017/27018/27701, SOC 2 Type II, GDPR, EU-US DPF; no data location stated; EU residency unverified. https://security.bigcommerce.com/
22 pricing (USD): Core $29/mo annual ($39 monthly), Growth $79 ($105), Scale $299 ($399), Performance custom from $1,499/mo. Auto-upgrade by trailing 12-month GMV (Core to $30K, Growth to $100K). "Open Payment Provider Fee" 2.0% Core, 1.0% Growth, 0.6% Scale on orders through non-embedded providers; none on 21 Embedded Payment Providers (Adyen, Klarna, Stripe, PayPal, Worldpay, Checkout.com...). https://www.bigcommerce.com/pricing/ ; https://www.bigcommerce.com/payments/embedded-payment-providers/
23 migration: native free Data Migration app (up to 500,000 records of products, customers, orders from Shopify etc.; reviews and coupons); CSV export of products, customers, orders. https://www.bigcommerce.com/migration/
24 strengths: headless Catalyst (MIT, Next.js/React/GraphQL); multi-storefront from cheapest plan; B2B claimed built in (conflicting: Price Lists Performance only; B2B Edition = Enterprise, custom price; avoid B2B specifics); no BigCommerce fee on embedded providers; native pre-orders, bulk pricing, reviews, multi-currency; free migration tool and included AI assistant.
Cautions: USD only, do not convert; plan auto-upgrades by sales; "not native" != impossible: say "listed at ... on date"; withdrawal: only the 1 July 2026 post, re-check; unverified topics = "not verified" not "not available"; do not claim or deny EU data residency; BigCommerce trust centre branded "Commerce.com" (unverified rebrand), use "BigCommerce"; Vipps/MobilePay depend on gateway; printable invoice is no evidence of EU-legal numbering.
