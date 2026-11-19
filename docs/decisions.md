# Decisions

The Phase 0 decision record. Each entry says what was decided, when, and what it
changes. Background for every item is in [`plan.md`](plan.md), which was written
before some of these decisions and assumes an EU company; where they differ,
this file wins.

## Settled

Each decision's text is its own file in docs/decisions/; this table is written by node scripts/decisions.mjs write. A new decision: node scripts/decisions.mjs new "Title."

<!-- decisions:index -->
| # | Decision | Date | Text |
|---|---|---|---|
| D1 | **A Norwegian company shipping from Norway** | 2026-09-23 | [text](decisions/D1.md) |
| D2 | **Launch in Norway, Sweden and Denmark** | 2026-09-23 | [text](decisions/D2.md) |
| D3 | **Payments** | 2026-09-23 | [text](decisions/D3.md) |
| D4 | **Commerce core built from scratch** | 2026-09-23 | [text](decisions/D4.md) |
| D5 | **Changes go straight to main** | 2026-09-23 | [text](decisions/D5.md) |
| D6 | **Region** | 2026-09-23 | [text](decisions/D6.md) |
| D7 | **One Next.js app** | 2026-09-23 | [text](decisions/D7.md) |
| D8 | **Commerce data in a private commerce schema** | 2026-09-23 | [text](decisions/D8.md) |
| D9 | **Drizzle schema is the source of truth** | 2026-09-23 | [text](decisions/D9.md) |
| D10 | **Data residency** | 2026-09-23 | [text](decisions/D10.md) |
| D11 | **Build to WCAG 2.2 AA** | 2026-09-23 | [text](decisions/D11.md) |
| D12 | **Kaizen Store is a multi-purpose template** | 2026-09-23 | [text](decisions/D12.md) |
| D13 | **No extra monitoring or analytics accounts until there is a need** | 2026-09-23 | [text](decisions/D13.md) |
| D14 | **No non-essential cookies at launch** | 2026-09-23 | [text](decisions/D14.md) |
| D15 | **Payment settings belong to the store owner, in the store's admin** | 2026-09-24 | [text](decisions/D15.md) |
| D16 | **Checkout on Stripe's hosted page, with each store's own Stripe account** | 2026-09-24 | [text](decisions/D16.md) |
| D17 | **Stripe Connect** | 2026-09-24 | [text](decisions/D17.md) |
| D18 | **Kaizen's plans for stores are managed in Kaizen and billed with Stripe Billing** | 2026-09-24 | [text](decisions/D18.md) |
| D19 | **Owners choose their own plan, and can own several stores** | 2026-09-24 | [text](decisions/D19.md) |
| D20 | **Test payments need nothing from the store owner** | 2026-09-24 | [text](decisions/D20.md) |
| D21 | **Search and sharing are built in, for Kaizen and every store** | 2026-09-24 | [text](decisions/D21.md) |
| D22 | **Shoppers pay on Kaizen's own checkout page, with Stripe's payment form** | 2026-09-24 | [text](decisions/D22.md) |
| D23 | **Every store's Stripe account asks for cards, Klarna, Link and MobilePay** | 2026-09-24 | [text](decisions/D23.md) |
| D24 | **Every variant is either shipped or downloaded; a product sets the default** | 2026-09-24 | [text](decisions/D24.md) |
| D25 | **Subscriptions are purchase options on a product, charged by Stripe Billing on the store's own account** | 2026-09-24 | [text](decisions/D25.md) |
| D26 | **Kaizen sends shoppers' emails in the store's name, through Resend** | 2026-09-24 | [text](decisions/D26.md) |
| D27 | **Staff manage the whole order from its page** | 2026-09-24 | [text](decisions/D27.md) |
| D28 | **Shoppers get My account per store, signed in with an emailed code or a password they chose** | 2026-09-24 | [text](decisions/D28.md) |
| D29 | **Purchase options can have a free trial, a sign-up fee and a commitment; subscribers pause, skip and change their subscription themselve…** | 2026-09-24 | [text](decisions/D29.md) |
| D30 | **Every store has a header and footer its owner edits** | 2026-09-24 | [text](decisions/D30.md) |
| D31 | **Stores have discount codes for shoppers, and Kaizen has discount codes for stores' plans** | 2026-09-24 | [text](decisions/D31.md) |
| D32 | **Shoppers can create an account with a password, on My account or at checkout; an email the store already knows chooses a new password i…** | 2026-09-24 | [text](decisions/D32.md) |
| D33 | **Stores can email reminders about carts left at checkout, and Kaizen about plans left unpaid** | 2026-09-25 | [text](decisions/D33.md) |
| D34 | **Shoppers keep wishlists** | 2026-09-25 | [text](decisions/D34.md) |
| D35 | **Admins see their customers** | 2026-09-25 | [text](decisions/D35.md) |
| D36 | **Store owners see every shopper's wishlists, what is in each, and what went from a list to the cart and was bought** | 2026-09-25 | [text](decisions/D36.md) |
| D37 | **A function never leaves a database connection half-used** | 2026-09-25 | [text](decisions/D37.md) |
| D38 | **Discount codes can be applied right in the checkout, in stores and on the platform** | 2026-09-25 | [text](decisions/D38.md) |
| D39 | **A store's admin has a fixed header with its main sections, and a sidebar with its settings in groups** | 2026-09-25 | [text](decisions/D39.md) |
| D40 | **A store keeps who it is and where to find it on its Company page** | 2026-09-25 | [text](decisions/D40.md) |
| D41 | **A store connects Zapier or Make on its Integrations page, and Kaizen sends them its events by webhook** | 2026-09-25 | [text](decisions/D41.md) |
| D42 | **Kaizen has its own pages, built from blocks in the platform admin, and its own header and footer, built like a store's** | 2026-09-25 | [text](decisions/D42.md) |
| D43 | **A page is rows of columns of blocks, built by dragging** | 2026-09-25 | [text](decisions/D43.md) |
| D44 | **The page editor's canvas shows the page as the site will, and each part is edited from tools that appear on it** | 2026-09-25 | [text](decisions/D44.md) |
| D45 | **A column moves with everything in it, into any row; and a page shows only its rows** | 2026-09-25 | [text](decisions/D45.md) |
| D46 | **Rows, columns and components can be saved and used again** | 2026-09-25 | [text](decisions/D46.md) |
| D47 | **Pictures are a component, and every row, column and component has margin and padding** | 2026-09-25 | [text](decisions/D47.md) |
| D48 | **Rows, columns and components have settings of their own, in three tabs** | 2026-09-25 | [text](decisions/D48.md) |
| D49 | **Borders, corners and shadows on every part; heading and button components** | 2026-09-25 | [text](decisions/D49.md) |
| D50 | **Categories and tags, for each owner and kind of content** | 2026-09-25 | [text](decisions/D50.md) |
| D51 | **A content grid shows pages or a store's products as tiles** | 2026-09-25 | [text](decisions/D51.md) |
| D52 | **Categories and tags in menus, leading to filtered lists** | 2026-09-25 | [text](decisions/D52.md) |
| D53 | **Stores get the same page builder as Kaizen** | 2026-09-25 | [text](decisions/D53.md) |
| D54 | **Store pages on the storefront, in menus, and as the front page** | 2026-09-25 | [text](decisions/D54.md) |
| D55 | **One page, its texts in each of the store's languages** | 2026-09-25 | [text](decisions/D55.md) |
| D56 | **New stores start with the template's pages; Kaizen's saved parts are their starter library; store pages are in search files** | 2026-09-25 | [text](decisions/D56.md) |
| D57 | **Articles** | 2026-09-25 | [text](decisions/D57.md) |
| D58 | **Cookie consent per site, from what the site sets** | 2026-09-26 | [text](decisions/D58.md) |
| D59 | **Google Fonts, always self-hosted** | 2026-09-26 | [text](decisions/D59.md) |
| D60 | **Design themes for stores** | 2026-09-26 | [text](decisions/D60.md) |
| D61 | **A store's own code, only on its own host and only with consent** | 2026-09-26 | [text](decisions/D61.md) |
| D62 | **Sites' icons** | 2026-09-26 | [text](decisions/D62.md) |
| D63 | **Businesses see prices without VAT; VAT is charged unless the order is reverse charge** | 2026-09-26 | [text](decisions/D63.md) |
| D64 | **On phones the cart slides out over the page** | 2026-09-26 | [text](decisions/D64.md) |
| D65 | **Bookings are products of another kind, with one booking module a store switches on** | 2026-09-26 | [text](decisions/D65.md) |
| D66 | **Appointments are paid now, with a deposit, or at the venue, chosen per appointment; shoppers cancel and move within the appointment's r…** | 2026-09-27 | [text](decisions/D66.md) |
| D67 | **Stays and rentals are booked by whole nights or days over rooms and items; a cart line's quantity is the nights or days, so prices, dis…** | 2026-09-27 | [text](decisions/D67.md) |
| D68 | **Rooms, items and staff are closed by blocks** | 2026-09-27 | [text](decisions/D68.md) |
| D69 | **A rental's variants are each rented by whole days, half days or hours, and a resource is full only when its bookings at one moment reac…** | 2026-09-27 | [text](decisions/D69.md) |
| D70 | **Stays and rentals are priced night by night through seasons, with a fee per booking; the booking is one line at its whole price** | 2026-09-27 | [text](decisions/D70.md) |
| D71 | **A store can list stays and rentals for outside hosts** | 2026-09-27 | [text](decisions/D71.md) |
| D72 | **Phase 2** | 2026-09-27 | [text](decisions/D72.md) |
| D73 | **AI providers and models are settings, not code** | 2026-09-27 | [text](decisions/D73.md) |
| D74 | **Search by meaning** | 2026-09-27 | [text](decisions/D74.md) |
| D75 | **Query understanding** | 2026-09-27 | [text](decisions/D75.md) |
| D76 | **AI product texts** | 2026-09-27 | [text](decisions/D76.md) |
| D77 | **Search test** | 2026-09-27 | [text](decisions/D77.md) |
| D78 | **Sorting and filtering product listings** | 2026-09-27 | [text](decisions/D78.md) |
| D79 | **Product layouts** | 2026-09-27 | [text](decisions/D79.md) |
| D80 | **The site's header and footer are built in the page builder, from site components, for Kaizen and for each store; a header can lie over…** | 2026-09-27 | [text](decisions/D80.md) |
| D81 | **Kaizen and every store can have an AI chat agent on their pages, typed or spoken, that answers only about the site from its published p…** | 2026-09-28 | [text](decisions/D81.md) |
| D82 | **A variant can have a picture of its own, and shoppers choose variants from a dropdown drawn in the store's theme, with each variant's p…** | 2026-09-28 | [text](decisions/D82.md) |
| D83 | **A store's All products page, at /products, can be one of its own pages built in the page builder, as its front page can; a product grid…** | 2026-09-28 | [text](decisions/D83.md) |
| D84 | **The product page's gallery shows the chosen variant's picture** | 2026-09-28 | [text](decisions/D84.md) |
| D85 | **Menus are the owner's own named lists of links, edited on a Menus page modelled on WordPress's menu editor and shown wherever they are…** | 2026-09-28 | [text](decisions/D85.md) |
| D86 | **A row or column with no background or a colour can blur what lies behind it, and its colour can be see-through** | 2026-09-28 | [text](decisions/D86.md) |
| D87 | **A top link in a menu can be a mega menu** | 2026-09-28 | [text](decisions/D87.md) |
| D88 | **Each site has a media library of every picture and video it uploaded, anywhere in the admin, with where each is used** | 2026-09-28 | [text](decisions/D88.md) |
| D89 | **The media library's pictures have alt texts in each of the site's languages, written by staff or by the site's AI looking at the pictur…** | 2026-09-28 | [text](decisions/D89.md) |
| D90 | **The media library searches a file's name by name alone, finds pictures by their alt texts in every language, and always has English alt…** | 2026-09-28 | [text](decisions/D90.md) |
| D91 | **More page components, each added through one registry** | 2026-09-28 | [text](decisions/D91.md) |
| D92 | **The AI builds pages** | 2026-09-28 | [text](decisions/D92.md) |
| D93 | **Pages have an email form and a newsletter sign-up, which email what visitors send to addresses the owner chooses** | 2026-09-28 | [text](decisions/D93.md) |
| D94 | **Each store has an owner assistant in its admin, modelled on Kaizen Life's, working on its own** | 2026-09-28 | [text](decisions/D94.md) |
| D95 | **Kaizen Store and Kaizen Life sign each other's users in** | 2026-09-28 | [text](decisions/D95.md) |
| D96 | **Kaizen Life's assistant works with the owner's stores through the store's MCP server, and asks the store's own assistant; what it would…** | 2026-09-28 | [text](decisions/D96.md) |
| D97 | **Every profile has a picture** | 2026-09-28 | [text](decisions/D97.md) |
| D98 | **Saved rows, columns and components can be global** | 2026-09-28 | [text](decisions/D98.md) |
| D99 | **Light and dark are each person's to choose** | 2026-09-28 | [text](decisions/D99.md) |
| D100 | **Owners write their own CSS in the page builder** | 2026-09-28 | [text](decisions/D100.md) |
| D101 | **Stores connect Slack on their Integrations page, and get their events as messages in a channel** | 2026-09-28 | [text](decisions/D101.md) |
| D102 | **Subscription boxes** | 2026-09-29 | [text](decisions/D102.md) |
| D103 | **The owner assistant becomes the AI manager** | 2026-09-29 | [text](decisions/D103.md) |
| D104 | **The AI manager gets the skills its owners asked for** | 2026-09-29 | [text](decisions/D104.md) |
| D105 | **The AI manager talks over a full-duplex live voice model when the site has one, as Kaizen Life does** | 2026-09-29 | [text](decisions/D105.md) |
| D106 | **Every call to an AI model is recorded, and read back as usage for the platform and for each store owner** | 2026-09-29 | [text](decisions/D106.md) |
| D107 | **The admin's three levels** | 2026-09-29 | [text](decisions/D107.md) |
| D108 | **Customer groups with a fixed discount, and company accounts whose employees are invited by email** | 2026-09-29 | [text](decisions/D108.md) |
| D109 | **Language and currency are chosen apart** | 2026-09-29 | [text](decisions/D109.md) |
| D110 | **A whole store can be translated with AI in one go, and a person reads every text before it is saved** | 2026-09-29 | [text](decisions/D110.md) |
| D111 | **The platform chooses the languages stores can offer, and the interface text of new languages is translated by AI into data, read by a…** | 2026-09-29 | [text](decisions/D111.md) |
| D112 | **A store's blog, search page and 404 page are pages built in the page builder, like its front page and All products page** | 2026-09-29 | [text](decisions/D112.md) |
| D113 | **A store's working pages are page-builder pages too** | 2026-09-29 | [text](decisions/D113.md) |
| D114 | **Stores run campaigns** | 2026-09-29 | [text](decisions/D114.md) |
| D115 | **Campaigns are announced on product pages and cards without slowing them, can be limited to customer groups and to a number of orders,…** | 2026-09-29 | [text](decisions/D115.md) |
| D116 | **Campaigns can be limited per customer and to countries, a "buy N pay for M" can stack, and the chat agent shows their offers** | 2026-09-29 | [text](decisions/D116.md) |
| D117 | **The cart, checkout and order pages come apart in the page builder, as a product's page does** | 2026-09-29 | [text](decisions/D117.md) |
| D118 | **Owners define their own custom fields, as in WordPress's Advanced Custom Fields, and place them in product layouts and pages** | 2026-09-29 | [text](decisions/D118.md) |
| D119 | **Custom fields grow** | 2026-09-29 | [text](decisions/D119.md) |
| D120 | **Custom fields, phase 3** | 2026-09-29 | [text](decisions/D120.md) |
| D121 | **A row can be a modal** | 2026-09-29 | [text](decisions/D121.md) |
| D122 | **Work** | 2026-09-30 | [text](decisions/D122.md) |
| D123 | **Work lives at the store owner's level** |  | [text](decisions/D123.md) |
| D124 | **A Work client can be filled in from Brønnøysundregistrene's open Enhetsregisteret** |  | [text](decisions/D124.md) |
| D125 | **Saved rows, columns and components can be shared as templates** |  | [text](decisions/D125.md) |
| D126 | **A page can be duplicated** |  | [text](decisions/D126.md) |
| D127 | **Whole page layouts are templates too, and any template can be previewed before it is switched on or used** |  | [text](decisions/D127.md) |
| D128 | **Motion design** |  | [text](decisions/D128.md) |
| D129 | **An owner can duplicate one of their stores** |  | [text](decisions/D129.md) |
| D130 | **A bonus program** |  | [text](decisions/D130.md) |
| D131 | **An affiliate program on two levels** |  | [text](decisions/D131.md) |
| D132 | **A plan comparison** |  | [text](decisions/D132.md) |
| D133 | **Shipping carriers are prepared under Integrations** |  | [text](decisions/D133.md) |
| D134 | **Posten / Bring is connected** |  | [text](decisions/D134.md) |
| D135 | **Delivery options at checkout** |  | [text](decisions/D135.md) |
| D136 | **PostNord is connected** |  | [text](decisions/D136.md) |
| D137 | **Porterbuddy is connected** |  | [text](decisions/D137.md) |
| D138 | **Helthjem is connected** |  | [text](decisions/D138.md) |
| D139 | **Product recommendations** |  | [text](decisions/D139.md) |
| D140 | **Recommendations, finished** |  | [text](decisions/D140.md) |
| D141 | **Every store numbers its orders in one sequence, without gaps** |  | [text](decisions/D141.md) |
| D142 | **A Plans component for Kaizen's own pages** |  | [text](decisions/D142.md) |
| D143 | **Kaizen's own front page, blog and 404 page are chosen from its pages** |  | [text](decisions/D143.md) |
| D144 | **The platform admin is reorganised into sections** |  | [text](decisions/D144.md) |
| D145 | **AI usage shows what it costs** |  | [text](decisions/D145.md) |
| D146 | **Pictures, speech and live calls are priced too** |  | [text](decisions/D146.md) |
| D147 | **The store and the owner's level get the platform's navigation** |  | [text](decisions/D147.md) |
| D148 | **A/B testing for store owners and the platform is designed before it is built** |  | [text](decisions/D148.md) |
| D149 | **The admin's look** |  | [text](decisions/D149.md) |
| D150 | **The AI can copy another website's page into a store's page builder, and show its work** |  | [text](decisions/D150.md) |
| D151 | **A picture keeps its own size** | 2026-10-02 | [text](decisions/D151.md) |
| D152 | **A store analytics cockpit with drill-down** | 2026-10-02 | [text](decisions/D152.md) |
| D153 | **The EU withdrawal function and a returns flow for goods** | 2026-10-03 | [text](decisions/D153.md) |
| D154 | **The parity tracker** | 2026-10-03 | [text](decisions/D154.md) |
| D155 | **Custom grid items and a carousel with controls; the replicator makes grids and carousels from them** | 2026-10-03 | [text](decisions/D155.md) |
| D156 | **Wave 1 of the parity plan** |  | [text](decisions/D156.md) |
| D157 | **Tax profile and VAT engine** |  | [text](decisions/D157.md) |
| D158 | **Legal starters, terms at checkout, accessibility checks, a strict checkout policy, and staff security** |  | [text](decisions/D158.md) |
| D159 | **Invoices and credit notes for shop orders in the store's own gap-free series** |  | [text](decisions/D159.md) |
| D160 | **Unit price indication** | 2026-10-04 | [text](decisions/D160.md) |
| D161 | **VAT, OSS and IOSS reports read from invoices and credit notes** |  | [text](decisions/D161.md) |
| D162 | **GDPR export, erasure and a retention schedule** |  | [text](decisions/D162.md) |
| D163 | **A model that sees pictures, chosen and checked in the AI settings** | Decided | [text](decisions/D163.md) |
| D164 | **Rows of a copied page that still match badly are kept as the original's own picture, as a trial** | 2026-10-05 | [text](decisions/D164.md) |
| D165 | **Data in and out** | 2026-10-05 | [text](decisions/D165.md) |
| D166 | **Production is deployed by CI after the migration, and at once when there is none** | 2026-10-05 | [text](decisions/D166.md) |
| D167 | **Plain text fields of page blocks may hold a small set of inline tags** | 2026-10-05 | [text](decisions/D167.md) |
| D168 | **Redirects, a 404 report and SEO fields for categories and tags** | 2026-10-05 | [text](decisions/D168.md) |
| D169 | **A WordPress plugin shows an owner's products with saved shortcodes** | 2026-10-05 | [text](decisions/D169.md) |
| D170 | **The WordPress plugin gets product pages and a slide-out cart; the checkout stays in the store** | 2026-10-05 | [text](decisions/D170.md) |
| D171 | **A store can be closed, and suspended and reopened by the platform; nothing is deleted** |  | [text](decisions/D171.md) |
| D172 | **Inventory with locations, an adjustment history, backorders and low-stock notices** |  | [text](decisions/D172.md) |
| D173 | **Order search, filters, saved views and bulk actions; tags and archive; draft orders with pay links; gift messages** |  | [text](decisions/D173.md) |
| D174 | **Orders edited after purchase, sent in parts, closed units, packing slips per parcel and pick lists** |  | [text](decisions/D174.md) |
| D175 | **Store templates** | 2026-10-07 | [text](decisions/D175.md) |
| D176 | **Design profiles** | 2026-10-07 | [text](decisions/D176.md) |
| D177 | **Store templates and design profiles get a life** | 2026-10-07 | [text](decisions/D177.md) |
| D178 | **Store features** | 2026-10-07 | [text](decisions/D178.md) |
| D179 | **Responsive editing and visibility in the page builder, after Beaver Builder** | 2026-10-08 | [text](decisions/D179.md) |
| D180 | **Text colour and opacity in the page builder** | 2026-10-08 | [text](decisions/D180.md) |
| D181 | **Addresses without a country for a store that sells in one** | 2026-10-08 | [text](decisions/D181.md) |
| D182 | **Theme elements, content width and resizing in the page builder** | 2026-10-09 | [text](decisions/D182.md) |
| D183 | **Saved colours and gradients, text gradients, gradient overlay and pixel sliders in the page builder** | 2026-10-09 | [text](decisions/D183.md) |
| D184 | **Window rows and a footer revealed on scroll** | 2026-10-09 | [text](decisions/D184.md) |
| D185 | **Pages nest under other pages** | 2026-10-09 | [text](decisions/D185.md) |
| D186 | **An excerpt of its own on pages, articles and products** | 2026-10-09 | [text](decisions/D186.md) |
| D187 | **Several lines of columns in a row** | 2026-10-09 | [text](decisions/D187.md) |
| D188 | **A modal that is left out of the site says so in the builder** | 2026-10-09 | [text](decisions/D188.md) |
| D189 | **A column dropped between two columns goes between them** | 2026-10-10 | [text](decisions/D189.md) |
| D190 | **Row width in the theme's Row** | 2026-10-10 | [text](decisions/D190.md) |
| D191 | **A heading or text is edited where it stands in the page builder** | 2026-10-10 | [text](decisions/D191.md) |
| D192 | **Staff edit a page's words on the live site** | 2026-10-10 | [text](decisions/D192.md) |
| D193 | **Editing words on a store's own domain** | 2026-10-10 | [text](decisions/D193.md) |
| D194 | **A table component in the page builder** | 2026-10-10 | [text](decisions/D194.md) |
| D195 | **The Theme tab reaches the site as it does the canvas** | 2026-10-10 | [text](decisions/D195.md) |
| D196 | **A table's header shows from Medium up, and custom classes show on the builder's canvas** | 2026-10-10 | [text](decisions/D196.md) |
| D197 | **Table colours and section dividers; negative margins** | 2026-10-10 | [text](decisions/D197.md) |
| D198 | **Section colours; the admin's table styling stays out of the page canvas** | 2026-10-10 | [text](decisions/D198.md) |
| D199 | **An icon list's icons can take a gradient** | 2026-10-10 | [text](decisions/D199.md) |
| D200 | **Table rows are dragged into order** | 2026-10-10 | [text](decisions/D200.md) |
| D201 | **Icons in table cells** | 2026-10-10 | [text](decisions/D201.md) |
| D202 | **Dividers and rows are dragged separately** | 2026-10-10 | [text](decisions/D202.md) |
| D203 | **A long table scrolls inside itself, with its header and section titles kept in view** | 2026-10-11 | [text](decisions/D203.md) |
| D204 | **Brands** |  | [text](decisions/D204.md) |
| D205 | **Brands** |  | [text](decisions/D205.md) |
| D206 | **Hover takes time; buttons have hover effects; logos can take one colour** |  | [text](decisions/D206.md) |
| D207 | **Menu links answer the pointer with a line or a background, and show the page the visitor is on** |  | [text](decisions/D207.md) |
| D208 | **An FAQ's answers hold components** |  | [text](decisions/D208.md) |
| D209 | **A gallery of pictures and videos** |  | [text](decisions/D209.md) |
| D210 | **A gallery fades one tile into the next, and its hover zoom is the owner's** |  | [text](decisions/D210.md) |
| D211 | **What a visitor's page loads, kept small** |  | [text](decisions/D211.md) |
| D212 | **A visitor's browser gets only the interface text its client components read** |  | [text](decisions/D212.md) |
| D213 | **Pictures and videos compressed in the browser until they are as small as they can be while they look the same** |  | [text](decisions/D213.md) |
| D214 | **The page builder's palette follows the store's features, and the canvas draws what the site draws** |  | [text](decisions/D214.md) |
| D215 | **The page builder's columns scroll on their own, and every shop component has its picture** |  | [text](decisions/D215.md) |
| D216 | **Support** |  | [text](decisions/D216.md) |
| D217 | **The admin's colours are roles set by a scheme; meadow is the first** |  | [text](decisions/D217.md) |
| D218 | **The admin's components** |  | [text](decisions/D218.md) |
| D219 | **A store's admin is drawn in the rail layout** |  | [text](decisions/D219.md) |
| D220 | **The platform and the owner's level in the rail layout too** |  | [text](decisions/D220.md) |
| D221 | **A second colour scheme, indigo, and each person chooses theirs** |  | [text](decisions/D221.md) |
| D222 | **The scheme preview page** |  | [text](decisions/D222.md) |
| D223 | **The admin's pages move to the style's type, shapes and components, starting with what they share** |  | [text](decisions/D223.md) |
| D224 | **The admin's pages draw in the colour roles only** |  | [text](decisions/D224.md) |
| D225 | **Signed-in admin pages are titled by PageHeader, and section cards are Card** |  | [text](decisions/D225.md) |
| D226 | **Every admin card is Card or CARD_CLASS** |  | [text](decisions/D226.md) |
| D227 | **Tables that are lists of records are lists in a card** |  | [text](decisions/D227.md) |
| D228 | **The pages before a person is let in are drawn in the focus layout** |  | [text](decisions/D228.md) |
| D229 | **The setup wizard is drawn in the focus layout within the store's level** |  | [text](decisions/D229.md) |
| D230 | **Tools with columns of their own are drawn in the workspace layout** |  | [text](decisions/D230.md) |
| D231 | **The rest of the admin draws in the type scale and shapes** |  | [text](decisions/D231.md) |
| D232 | **White boxes on the canvas are cards** |  | [text](decisions/D232.md) |
| D233 | **The chat agent's picture frame** |  | [text](decisions/D233.md) |
| D234 | **Signed-in admin tests** |  | [text](decisions/D234.md) |
| D235 | **Kaizen's page builder gets a theme, as stores' have** |  | [text](decisions/D235.md) |
| D236 | **Kaizen's builder offers Kaizen's own templates** |  | [text](decisions/D236.md) |
| D237 | **Shipping methods, zones and profiles, local pickup and local delivery** | 2026-10-14 | [text](decisions/D237.md) |
| D238 | **Customer notifications, delivery tracking and staff alerts** | 2026-10-15 | [text](decisions/D238.md) |
| D239 | **Exchanges and return labels** | 2026-10-15 | [text](decisions/D239.md) |
| D240 | **The platform is Kaizena Flow** | 2026-10-15 | [text](decisions/D240.md) |
| D241 | **Themes as one thing** | 2026-10-15 | [text](decisions/D241.md) |
| D242 | **Seamless switching, step 1** | 2026-10-15 | [text](decisions/D242.md) |
| D243 | **Seamless switching, step 2** | 2026-10-15 | [text](decisions/D243.md) |
| D244 | **Seamless switching, step 3** | 2026-10-15 | [text](decisions/D244.md) |
| D245 | **Seamless switching, step 4** | 2026-10-15 | [text](decisions/D245.md) |
| D246 | **Seamless switching, step 5** | 2026-10-15 | [text](decisions/D246.md) |
| D247 | **The theme store, step 1** | 2026-10-15 | [text](decisions/D247.md) |
| D248 | **The theme store, step 2** | 2026-10-15 | [text](decisions/D248.md) |
| D249 | **The theme store, step 3** | 2026-10-15 | [text](decisions/D249.md) |
| D250 | **The theme store's pictures** | 2026-10-15 | [text](decisions/D250.md) |
| D251 | **Kaizena Flow's own site on themes, step 1** | 2026-10-15 | [text](decisions/D251.md) |
| D252 | **Kaizena Flow's own site on themes, step 2** | 2026-10-15 | [text](decisions/D252.md) |
| D253 | **Kaizena Flow's own site on themes, step 3** | 2026-10-15 | [text](decisions/D253.md) |
| D254 | **A platform admin in the signed-in tests, with the second step** | 2026-10-16 | [text](decisions/D254.md) |
| D255 | **The theme store's quick fixes** | 2026-10-16 | [text](decisions/D255.md) |
| D256 | **Theme presets** | 2026-10-16 | [text](decisions/D256.md) |
| D257 | **Content packs** | 2026-10-16 | [text](decisions/D257.md) |
| D258 | **Showcases** | 2026-10-16 | [text](decisions/D258.md) |
| D259 | **Starting a store from a preset** | 2026-10-16 | [text](decisions/D259.md) |
| D260 | **A new store's demo content, removable in one press** | 2026-10-16 | [text](decisions/D260.md) |
| D261 | **A demo store's home page for an existing store, with undo** | 2026-10-16 | [text](decisions/D261.md) |
| D262 | **Page builder maintenance** | 2026-10-16 | [text](decisions/D262.md) |
| D263 | **The scheduler calls Kaizena Flow's own domain** | 2026-10-16 | [text](decisions/D263.md) |
| D264 | **A theme's pictures are photographs Kaizena Flow takes after each Publish** | 2026-10-16 | [text](decisions/D264.md) |
| D265 | **Three highlight pictures per theme, composed from its photographs, with words a person writes or accepts** | 2026-10-16 | [text](decisions/D265.md) |
| D266 | **Any made picture of a theme can be swapped for the platform admin's own** |  | [text](decisions/D266.md) |
| D267 | **Signature themes** | 2026-10-16 | [text](decisions/D267.md) |
| D268 | **Two storefront fixes found while building Orbit** | 2026-10-16 | [text](decisions/D268.md) |
| D269 | **Three more signature themes** | 2026-10-17 | [text](decisions/D269.md) |
| D270 | **A signature theme's demo store is photographed, not drawn** | 2026-10-17 | [text](decisions/D270.md) |
| D271 | **A content pack's pictures are made by a job, not by the open page** | 2026-10-17 | [text](decisions/D271.md) |
| D272 | **A signature theme offers its own sections in the page builder while it is live** | 2026-10-17 | [text](decisions/D272.md) |
| D273 | **One concept** | 2026-10-17 | [text](decisions/D273.md) |
| D274 | **The theme store never shows the Standard store** | 2026-10-17 | [text](decisions/D274.md) |
| D275 | **A theme has its own content; demo stores become live stores** | 2026-10-18 | [text](decisions/D275.md) |
| D276 | **The theme's page sells the theme, and it has a full-screen preview** | 2026-10-18 | [text](decisions/D276.md) |
| D277 | **Demo stores** | 2026-10-18 | [text](decisions/D277.md) |
| D278 | **Theme photographs are taken one look at a time across the job's runs** | 2026-10-18 | [text](decisions/D278.md) |
| D279 | **A blank photograph of a theme is a failed try, never kept** | 2026-10-18 | [text](decisions/D279.md) |
| D280 | **A look's swatch is drawn in the colours it is shown in** | 2026-10-18 | [text](decisions/D280.md) |
| D281 | **Kinetic, a signature theme for a sports brand, with women and men athletes in its pictures** | 2026-10-18 | [text](decisions/D281.md) |
| D282 | **A pack photograph of people shows their faces, as invented models** | 2026-10-18 | [text](decisions/D282.md) |
| D283 | **Pictures made and made again by prompt, in the site's look** | 2026-10-19 | [text](decisions/D283.md) |
| D284 | **A theme's photographs are tried again by themselves until they are made** | 2026-10-19 | [text](decisions/D284.md) |
| D285 | **Themes is a section of its own, and the theme store's pages are built in the page builder** | 2026-10-19 | [text](decisions/D285.md) |
| D286 | **Premium themes** | 2026-10-19 | [text](decisions/D286.md) |
| D287 | **Meridian, a signature theme for a corporate consultancy, and the first premium theme** | 2026-10-19 | [text](decisions/D287.md) |
| D288 | **What a payment was, Stripe's risk and disputes** | 2026-10-19 | [text](decisions/D288.md) |
| D289 | **Authorise now, capture later** | 2026-10-19 | [text](decisions/D289.md) |
| D290 | **Payouts and real Stripe fees** | 2026-10-19 | [text](decisions/D290.md) |
| D291 | **Payment methods per country** | 2026-10-19 | [text](decisions/D291.md) |
| D292 | **The payment-provider adapter** | 2026-10-19 | [text](decisions/D292.md) |
| D293 | **Payment terms for company accounts** | 2026-10-20 | [text](decisions/D293.md) |
| D294 | **Nested columns, one level deep** | 2026-10-20 | [text](decisions/D294.md) |
| D295 | **The subscriber list** | 2026-10-20 | [text](decisions/D295.md) |
| D296 | **Segments and customer tags** | 2026-10-20 | [text](decisions/D296.md) |
| D297 | **Broadcasts** | 2026-10-20 | [text](decisions/D297.md) |
| D298 | **Email automations** | 2026-10-20 | [text](decisions/D298.md) |
| D299 | **Discounts in depth** | 2026-10-20 | [text](decisions/D299.md) |
| D300 | **Gift cards** | 2026-10-21 | [text](decisions/D300.md) |
| D301 | **Product reviews** | 2026-10-21 | [text](decisions/D301.md) |
| D302 | **Product feeds** | 2026-10-24 | [text](decisions/D302.md) |
| D303 | **Ad pixels, conversion events and campaigns** | 2026-10-24 | [text](decisions/D303.md) |
| D304 | **Accounts in depth** | 2026-10-24 | [text](decisions/D304.md) |
| D305 | **The page builder's undo and redo, and a page's versions** | 2026-10-21 | [text](decisions/D305.md) |
| D306 | **Custom CSS on the live site** | 2026-10-21 | [text](decisions/D306.md) |
| D307 | **Find and replace in the page builder** | 2026-10-21 | [text](decisions/D307.md) |
| D308 | **The AI manager makes and changes products** | 2026-10-22 | [text](decisions/D308.md) |
| D309 | **Goals, plans and the work loop** | 2026-10-25 | [text](decisions/D309.md) |
| D310 | **The agent looks at what it builds** | 2026-10-25 | [text](decisions/D310.md) |
| D311 | **Legal pages are written and kept current by the AI, without a person reviewing each text** | 2026-10-22 | [text](decisions/D311.md) |
| D312 | **Kaizena Flow's own site and the admin in more than one language, Norwegian first** | 2026-10-22 | [text](decisions/D312.md) |
| D313 | **A domain per language for stores, optional** | 2026-10-22 | [text](decisions/D313.md) |
| D314 | **Usage, limits, scaling and hosting levels** | 2026-10-23 | [text](decisions/D314.md) |
| D315 | **Domains** | 2026-10-23 | [text](decisions/D315.md) |
| D316 | **A font Kaizena Flow cannot serve is only the fallback font** | 2026-10-16 | [text](decisions/D316.md) |
| D317 | **Domains on their own** | 2026-10-23 | [text](decisions/D317.md) |
| D318 | **PSI follow-ups while building** |  | [text](decisions/D318.md) |
| D319 | **Collections in depth** | 2026-10-25 | [text](decisions/D319.md) |
| D320 | **Variants at scale** | 2026-10-25 | [text](decisions/D320.md) |
| D321 | **B2B in depth** | 2026-10-26 | [text](decisions/D321.md) |
| D322 | **Bundles** | 2026-10-26 | [text](decisions/D322.md) |
| D323 | **Quantity rules and price breaks** | 2026-10-26 | [text](decisions/D323.md) |
| D324 | **Search merchandising** | 2026-10-26 | [text](decisions/D324.md) |
| D325 | **Videos and 3D in the product gallery** | 2026-10-26 | [text](decisions/D325.md) |
| D326 | **Content types** | 2026-10-27 | [text](decisions/D326.md) |
| D327 | **A standard product taxonomy** | 2026-10-27 | [text](decisions/D327.md) |
| D328 | **The autopilot keeps going** | 2026-10-25 | [text](decisions/D328.md) |
| D329 | **Web research for the AI manager and the autopilot** | 2026-10-26 | [text](decisions/D329.md) |
| D330 | **Brand and look** | 2026-10-26 | [text](decisions/D330.md) |
| D331 | **Reacting to events** | 2026-10-26 | [text](decisions/D331.md) |
| D332 | **Email into the support desk** | 2026-10-26 | [text](decisions/D332.md) |
| D333 | **The AI manager sends at most 120 tools a round** | 2026-10-26 | [text](decisions/D333.md) |
| D334 | **The autopilot pays for everything it asks for, never broadcasts on its own, and sends customers only so many emails; AI answers by em…** | 2026-10-26 | [text](decisions/D334.md) |
| D335 | **Markets in depth** | 2026-10-27 | [text](decisions/D335.md) |
| D336 | **Speed** | 2026-10-27 | [text](decisions/D336.md) |
| D337 | **Checkout branding** | 2026-10-27 | [text](decisions/D337.md) |
| D338 | **Each country's own** | 2026-10-27 | [text](decisions/D338.md) |
| D339 | **Private mode** | 2026-10-27 | [text](decisions/D339.md) |
| D340 | **By the clock, and links to share** | 2026-10-27 | [text](decisions/D340.md) |
| D341 | **Blogs in depth** | 2026-10-27 | [text](decisions/D341.md) |
| D342 | **Producer responsibility** | 2026-10-27 | [text](decisions/D342.md) |
| D343 | **Customs and duties** | 2026-10-27 | [text](decisions/D343.md) |
| D344 | **Themes from outside** | 2026-10-27 | [text](decisions/D344.md) |
| D345 | **Reports from a closed catalogue** |  | [text](decisions/D345.md) |
| D346 | **Asking for figures in words** |  | [text](decisions/D346.md) |
| D347 | **Live view and revenue after a search** |  | [text](decisions/D347.md) |
| D348 | **Targets of every kind, alert emails and a briefing** | 2026-10-28 | [text](decisions/D348.md) |
| D349 | **Pictures made and edited by AI in the library and the product editor** |  | [text](decisions/D349.md) |
| D350 | **The AI manager tells and remembers** |  | [text](decisions/D350.md) |
| D351 | **AI in the builder and a store from one description** |  | [text](decisions/D351.md) |
| D352 | **Marketing email from the store's own facts** |  | [text](decisions/D352.md) |
| D353 | **Shopping agents** |  | [text](decisions/D353.md) |
| D354 | **Events to the owner's own endpoints, signed** |  | [text](decisions/D354.md) |
| D355 | **The Admin API with scoped tokens** |  | [text](decisions/D355.md) |
| D356 | **Workflows** |  | [text](decisions/D356.md) |
| D357 | **Checkout rules and questions** |  | [text](decisions/D357.md) |
| D358 | **Versions compared, and staging inside the store** |  | [text](decisions/D358.md) |
| D359 | **Self-serve sign-up** |  | [text](decisions/D359.md) |
| D360 | **The status page** |  | [text](decisions/D360.md) |
| D361 | **The installable admin and push** |  | [text](decisions/D361.md) |
| D362 | **The storefront API** |  | [text](decisions/D362.md) |
| D363 | **A custom app's tools for the AI manager** |  | [text](decisions/D363.md) |
| D364 | **Refund to store credit** |  | [text](decisions/D364.md) |
| D365 | **Customer accounts optional, required or off** |  | [text](decisions/D365.md) |
| D366 | **Customers in the admin** |  | [text](decisions/D366.md) |
| D367 | **Discount combinations between campaigns and codes** |  | [text](decisions/D367.md) |
| D368 | **Broadcast templates** |  | [text](decisions/D368.md) |
| D369 | **Sign-up with a password, and no live payments before a store opens** |  | [text](decisions/D369.md) |
| D370 | **Inventory** |  | [text](decisions/D370.md) |
| D371 | **Personal data** |  | [text](decisions/D371.md) |
| D372 | **Partial fulfilment with a carrier, and a second parcel of the same order booked straight after the first** | 2026-10-28 | [text](decisions/D372.md) |
| D373 | **Express checkout on the product page and in the cart, wallets per web address, Klarna's line** | 2026-10-28 | [text](decisions/D373.md) |
| D374 | **Labels for several orders in one action** | 2026-10-28 | [text](decisions/D374.md) |
| D375 | **Sign in with Google for customers** |  | [text](decisions/D375.md) |
| D376 | **Reduced VAT rates with their sources** |  | [text](decisions/D376.md) |
| D377 | **Leaving** |  | [text](decisions/D377.md) |
| D378 | **The build fits Vercel's 8 GB again** |  | [text](decisions/D378.md) |
| D379 | **The code's part of the must-have rows still partial** | 2026-10-28 | [text](decisions/D379.md) |
| D380 | **Segments everywhere** |  | [text](decisions/D380.md) |
| D381 | **Money held for customers** |  | [text](decisions/D381.md) |
| D382 | **Contact messages in the support inbox** |  | [text](decisions/D382.md) |
| D383 | **Stock transfers, purchase orders, cost history, locations kept out of online orders** |  | [text](decisions/D383.md) |
| D384 | **Moving in from another shop** |  | [text](decisions/D384.md) |
| D385 | **A staging copy, and versions of the site's own CSS** |  | [text](decisions/D385.md) |
| D386 | **Creators** |  | [text](decisions/D386.md) |
| D387 | **Payments** |  | [text](decisions/D387.md) |
| D388 | **Theme submissions with their own pages** |  | [text](decisions/D388.md) |
| D389 | **PSI** |  | [text](decisions/D389.md) |
| D390 | **PSI** |  | [text](decisions/D390.md) |
| D391 | **PSI** |  | [text](decisions/D391.md) |
| D392 | **The code's part of the weight-3 rows still partial** |  | [text](decisions/D392.md) |
| D393 | **Text styles** |  | [text](decisions/D393.md) |
| D394 | **A code editor for owners' own CSS** |  | [text](decisions/D394.md) |
| D395 | **Saved reports emailed on a schedule** |  | [text](decisions/D395.md) |
| D396 | **Pre-orders** |  | [text](decisions/D396.md) |
| D397 | **Stock per location in the product editor** |  | [text](decisions/D397.md) |
| D398 | **The storefront API's cart** |  | [text](decisions/D398.md) |
| D399 | **Checkout rules that reorder, and rules through the API** |  | [text](decisions/D399.md) |
| D400 | **The PSI's engineering follow-ups** |  | [text](decisions/D400.md) |
| D401 | **Loyalty rewards and a birthday credit** |  | [text](decisions/D401.md) |
| D402 | **Checkout rules that price a delivery option** |  | [text](decisions/D402.md) |
| D403 | **Invoices and credit notes as EN 16931 XML** |  | [text](decisions/D403.md) |
| D404 | **The analytics loaders' money reads, checked** |  | [text](decisions/D404.md) |
| D405 | **The owner's open decisions, settled on 29 October 2026** |  | [text](decisions/D405.md) |
| D406 | **Live drills** | 2026-10-29 | [text](decisions/D406.md) |
| D407 | **The right of withdrawal checked against the law** | 2026-10-29 | [text](decisions/D407.md) |
| D408 | **After the PSI re-score of 30 October** | 2026-10-30 | [text](decisions/D408.md) |
| D409 | **The Dream Factory** | 2026-10-30 | [text](decisions/D409.md) |
| D410 | **Rotating the settings key** | 2026-10-30 | [text](decisions/D410.md) |
| D411 | **Notices of illegal content on stores** | 2026-10-31 | [text](decisions/D411.md) |
| D412 | **Dual page** |  | [text](decisions/D412.md) |
| D413 | **Two additions to the page builder, asked for by the owner on 1 November 2026** |  | [text](decisions/D413.md) |
| D414 | **A Timeline component and descriptions on icon list lines, asked for by the owner on 1 November 2026** |  | [text](decisions/D414.md) |
| D415 | **Profit per order** | 2026-11-01 | [text](decisions/D415.md) |
| D416 | **The briefing's one-press actions** | 2026-11-01 | [text](decisions/D416.md) |
| D417 | **The chargeback assistant, and customers who return a lot** | 2026-11-01 | [text](decisions/D417.md) |
| D418 | **What the autopilot's changes moved, and the monthly *What the AI did*** | 2026-11-01 | [text](decisions/D418.md) |
| D419 | **Watching the Dream Factory build** | 2026-11-02 | [text](decisions/D419.md) |
| D420 | **A free trial for every Dream Factory store, its end, and drill stores the asking admin can open** | 2026-11-02 | [text](decisions/D420.md) |
| D421 | **Start over and discard a Dream Factory store** | 2026-11-02 | [text](decisions/D421.md) |
| D422 | **The Dream Factory in two stages** | 2026-11-02 | [text](decisions/D422.md) |
| D423 | **Leaving a page in Safari goes where the visitor asked** | 2026-11-02 | [text](decisions/D423.md) |
| D424 | **Two pages side by side, in more ways** | 2026-11-02 | [text](decisions/D424.md) |
| D425 | **A dual heading** | 2026-11-02 | [text](decisions/D425.md) |
| D426 | **A column goes with what it holds** | 2026-11-02 | [text](decisions/D426.md) |
| D427 | **Kaizena Flow's languages are a part the owner places; its pages meet the footer** | 2026-11-02 | [text](decisions/D427.md) |
| D428 | **The chat answers from everything the site publishes** | 2026-11-02 | [text](decisions/D428.md) |
| D429 | **Prices with or without decimals, and the owner's words around a product's price** | 2026-11-03 | [text](decisions/D429.md) |
| D430 | **Quantity with − and +** | 2026-11-03 | [text](decisions/D430.md) |
| D431 | **Request a quote, prices on request, and a product question** | 2026-11-03 | [text](decisions/D431.md) |
| D432 | **A part's schedule one step from its settings** | 2026-11-03 | [text](decisions/D432.md) |
| D433 | **A product priced on request in bundles** | 2026-11-03 | [text](decisions/D433.md) |
| D434 | **Price on request and the words around the price in the product file** | 2026-11-03 | [text](decisions/D434.md) |
| D435 | **A quote's pay page reads as a quote** | 2026-11-03 | [text](decisions/D435.md) |
| D436 | **New interface text reaches the machine-translated languages by itself** | 2026-11-03 | [text](decisions/D436.md) |
| D437 | **The AI manager's quotes, price on request and price display** | 2026-11-03 | [text](decisions/D437.md) |
| D438 | **Contracts** | 2026-11-03 | [text](decisions/D438.md) |
| D439 | **Kaizena Flow's OAuth 2.1 authorization server and the open owner MCP** | 2026-11-03 | [text](decisions/D439.md) |
| D440 | **The Admin API's breadth and more webhook topics** | 2026-11-03 | [text](decisions/D440.md) |
| D441 | **Apps for many stores** | 2026-11-04 | [text](decisions/D441.md) |
| D442 | **The docs portal, first step** | 2026-11-03 | [text](decisions/D442.md) |
| D443 | **The docs' search and filters** | 2026-11-03 | [text](decisions/D443.md) |
| D444 | **The docs guide** | 2026-11-04 | [text](decisions/D444.md) |
| D445 | **Moving from Shopify** |  | [text](decisions/D445.md) |
| D446 | **Moving from WooCommerce** |  | [text](decisions/D446.md) |
| D447 | **Moving from Wix** |  | [text](decisions/D447.md) |
| D448 | **Moving from Squarespace** |  | [text](decisions/D448.md) |
| D449 | **Moving from BigCommerce** |  | [text](decisions/D449.md) |
| D450 | **Moving from Shopware** |  | [text](decisions/D450.md) |
| D451 | **Moving from any other platform** |  | [text](decisions/D451.md) |
| D452 | **Product safety** |  | [text](decisions/D452.md) |
| D453 | **Tripletex** | 2026-11-04 | [text](decisions/D453.md) |
| D454 | **Basic and Advanced views, an icon beside every page, and the admin usability audit** |  | [text](decisions/D454.md) |
| D455 | **The phone browser's colour follows the header** |  | [text](decisions/D455.md) |
| D456 | **Sign-up one step at a time** | 2026-11-05 | [text](decisions/D456.md) |
| D457 | **The page builder sandbox** | 2026-11-05 | [text](decisions/D457.md) |
| D458 | **Instabox, DHL Express and UPS join the carriers** | 2026-11-05 | [text](decisions/D458.md) |
| D459 | **DHL Paket, nShift, PostNord's booking, and what the carriers do after the booking** | 2026-11-05 | [text](decisions/D459.md) |
| D460 | **Fiken** | 2026-11-05 | [text](decisions/D460.md) |
| D461 | **The phone's first paint, from PageSpeed** | 2026-11-05 | [text](decisions/D461.md) |
| D462 | **A customer's timeline** | 2026-11-06 | [text](decisions/D462.md) |
| D463 | **E-invoices through Peppol, the parts that need no vendor** | 2026-11-06 | [text](decisions/D463.md) |
| D464 | **Deals and pipelines** | 2026-11-06 | [text](decisions/D464.md) |
| D465 | **Kaizena Flow's own integrations, and whatever stores get the platform gets** | 2026-11-06 | [text](decisions/D465.md) |
| D466 | **Kaizena Flow runs on Kaizena Flow, step 1** | 2026-11-06 | [text](decisions/D466.md) |
| D467 | **Kaizena Flow runs on Kaizena Flow, step 2** | 2026-11-06 | [text](decisions/D467.md) |
| D468 | **Activities** | 2026-11-06 | [text](decisions/D468.md) |
| D469 | **Kaizena Flow runs on Kaizena Flow, steps 3 and 4** | 2026-11-06 | [text](decisions/D469.md) |
| D470 | **The console's plan analytics, C2 of the plan** | 2026-11-06 | [text](decisions/D470.md) |
| D471 | **The platform's team, C1 of the plan, first step** | 2026-11-06 | [text](decisions/D471.md) |
| D472 | **Kaizena Flow's site reads in dark mode again** | 2026-11-06 | [text](decisions/D472.md) |
| D473 | **Changing the business behind a store** | 2026-11-06 | [text](decisions/D473.md) |
| D474 | **Copying the site again keeps what was changed in Kaizena Flow's store** | 2026-11-06 | [text](decisions/D474.md) |
| D475 | **A leads inbox** | 2026-11-06 | [text](decisions/D475.md) |
| D476 | **Email on the timeline** | 2026-11-06 | [text](decisions/D476.md) |
| D477 | **Moving in from Pipedrive** | 2026-11-06 | [text](decisions/D477.md) |
| D478 | **Our own ledger, in shadow** | 2026-11-06 | [text](decisions/D478.md) |
| D479 | **The language a visitor sees first, the language switcher, and the currency with the language** | 2026-11-06 | [text](decisions/D479.md) |
| D480 | **My account in four tabs, for Homer first** | 2026-11-05 | [text](decisions/D480.md) |
| D481 | **The pricing table** | 2026-11-06 | [text](decisions/D481.md) |
| D482 | **Drop shipping** |  | [text](decisions/D482.md) |
| D483 | **Labels without a carrier agreement, through Sendcloud** |  | [text](decisions/D483.md) |
| D484 | **Kaizena Flow runs on Kaizena Flow, step 5** | 2026-11-06 | [text](decisions/D484.md) |
| D485 | **Kaizena Flow's own store keeps Kaizena Flow's own parts, and needs no plan** | 2026-11-07 | [text](decisions/D485.md) |
| D486 | **Bank statements in the books, by file** | 2026-11-07 | [text](decisions/D486.md) |
| D487 | **A client's payment on the bank statement pays the invoice it names, a Work invoice or a shop's order on terms** | 2026-11-07 | [text](decisions/D487.md) |
| D488 | **The bank's own fees and interest, posted from the statement with a press** | 2026-11-07 | [text](decisions/D488.md) |
| D489 | **kaizenaflow.com's menus restored after the switch** | 2026-11-07 | [text](decisions/D489.md) |
| D490 | **A purchase the bank's statement shows, posted with its receipt** | 2026-11-07 | [text](decisions/D490.md) |
| D491 | **The receipt read by the model into the purchase** | 2026-11-07 | [text](decisions/D491.md) |
| D492 | **Suppliers' invoices** | 2026-11-07 | [text](decisions/D492.md) |
| D493 | **A bill read by the model into the form** | 2026-11-08 | [text](decisions/D493.md) |
| D494 | **Invoices brought in from Tripletex into Work** | 2026-11-08 | [text](decisions/D494.md) |
| D495 | **An invoice brought in twice kept once, and old bank statements settling old invoices** | 2026-11-08 | [text](decisions/D495.md) |
| D496 | **The VAT return from our own books** | 2026-11-08 | [text](decisions/D496.md) |
| D497 | **SAF-T Financial from our own books** | 2026-11-08 | [text](decisions/D497.md) |
| D498 | **The books opened earlier, holding the whole year** | 2026-11-08 | [text](decisions/D498.md) |
| D499 | **An invoice issued elsewhere, recorded in Work** | 2026-11-08 | [text](decisions/D499.md) |
| D500 | **A lost invoice, written off** | 2026-11-08 | [text](decisions/D500.md) |
| D501 | **Invoices brought in from elsewhere** | 2026-11-08 | [text](decisions/D501.md) |
| D502 | **Services bought from abroad, booked with reverse charge** | 2026-11-08 | [text](decisions/D502.md) |
| D503 | **Subscriptions** | 2026-11-08 | [text](decisions/D503.md) |
| D504 | **Receipts by email** | 2026-11-08 | [text](decisions/D504.md) |
| D505 | **Budget against actual, and a forecast** | 2026-11-09 | [text](decisions/D505.md) |
| D506 | **The year-end** | 2026-11-09 | [text](decisions/D506.md) |
| D507 | **What Kaizena Flow itself sold, kept and counted** | 2026-11-09 | [text](decisions/D507.md) |
| D508 | **Kaizena Flow's own money in the books of the business behind it** | 2026-11-09 | [text](decisions/D508.md) |
| D509 | **Kaizena Flow's own payouts, and what each carried** | 2026-11-09 | [text](decisions/D509.md) |
| D510 | **Roles on the platform's team** | 2026-11-09 | [text](decisions/D510.md) |
| D511 | **Kaizen Life shows Work from Kaizena Flow, once the accounts are linked** | 2026-11-09 | [text](decisions/D511.md) |
| D512 | **Accountants** | 2026-11-09 | [text](decisions/D512.md) |
| D513 | **The platform home's figures, targets, alerts and morning briefing** | 2026-11-09 | [text](decisions/D513.md) |
| D514 | **The threshold watch** | 2026-11-09 | [text](decisions/D514.md) |
| D515 | **The platform's events to its own endpoints, and *Add to Slack*** | 2026-11-09 | [text](decisions/D515.md) |
| D516 | **Workflows on Kaizena Flow's own events** | 2026-11-09 | [text](decisions/D516.md) |
| D517 | **The assistants together over the account link** | 2026-11-09 | [text](decisions/D517.md) |
| D518 | **Kaizena Flow's own API** | 2026-11-09 | [text](decisions/D518.md) |
| D519 | **Tasks the assistants hand each other, with a report back** | 2026-11-09 | [text](decisions/D519.md) |
| D520 | **Sales reports** | 2026-11-09 | [text](decisions/D520.md) |
| D521 | **What the person sees of the assistants together** | 2026-11-09 | [text](decisions/D521.md) |
| D522 | **Where Kaizena Flow's owners come from and what they are worth** | 2026-11-09 | [text](decisions/D522.md) |
| D523 | **Kaizena Flow's sign-ups and paid plans as ad conversions** | 2026-11-09 | [text](decisions/D523.md) |
| D524 | **Timed plan prices** | 2026-11-09 | [text](decisions/D524.md) |
| D525 | **D96's OAuth bridge between the assistants is retired** | 2026-11-09 | [text](decisions/D525.md) |
| D526 | **A quick gate before every deploy, and a release waits for every suite** | 2026-11-09 | [text](decisions/D526.md) |
| D527 | **The Dream Factory changes stores that exist** | 2026-11-09 | [text](decisions/D527.md) |
| D528 | **Analyse existing** | 2026-11-10 | [text](decisions/D528.md) |
| D529 | **A webhook event is claimed before it is worked on** | 2026-11-10 | [text](decisions/D529.md) |
| D530 | **A deploy reads the migration ledger again against the head of main** | 2026-11-10 | [text](decisions/D530.md) |
| D531 | **Radial blur, a gradient that spreads from a point the owner places** | 2026-11-10 | [text](decisions/D531.md) |
| D532 | **Only the newest Drizzle snapshot is kept, and the unit tests build their database once** | 2026-11-10 | [text](decisions/D532.md) |
| D533 | **A header over the page has two stages, each with its own background, blur and text colour** | 2026-11-10 | [text](decisions/D533.md) |
| D534 | **Layers over a row's or column's background, ready-made backdrops, and one hue slider for the whole** | 2026-11-10 | [text](decisions/D534.md) |
| D535 | **A layer over a background can be blurred, for depth** | 2026-11-10 | [text](decisions/D535.md) |
| D536 | **A video can play once and rest on its last frame, shows the page through a see-through background, and its upload is sent twice before it fails** |  | [text](decisions/D536.md) |
| D537 | **A picture as a layer over a background** | 2026-11-10 | [text](decisions/D537.md) |
| D538 | **An Animation component, and a logo that is an animation** |  | [text](decisions/D538.md) |
| D539 | **The AI manager's turn has a deadline and a cost ceiling** |  | [text](decisions/D539.md) |
| D540 | **The admin's English is fetched per area, and a pressed admin link shows it is on its way** |  | [text](decisions/D540.md) |
| D550 | **Drop shipping, step 1** |  | [text](decisions/D550.md) |
| D551 | **Drop shipping, step 2** |  | [text](decisions/D551.md) |
| D552 | **Environmental claims on the live site are found and listed for the owner** |  | [text](decisions/D552.md) |
| D553 | **Drop shipping, steps 3 to 5** |  | [text](decisions/D553.md) |
| D554 | **Digital Product Passports** |  | [text](decisions/D554.md) |
| D555 | **eBay as a sales channel** |  | [text](decisions/D555.md) |
| D556 | **Drop shipping and eBay, the parts D553 and D555 left** |  | [text](decisions/D556.md) |
| D557 | **Stock left and Add to cart on product tiles** |  | [text](decisions/D557.md) |
| D558 | **Free shipping and *You saved* for the shop's templates** |  | [text](decisions/D558.md) |
| D559 | **Goes well with** |  | [text](decisions/D559.md) |
| D560 | **An Instagram feed with hashtag filtering** |  | [text](decisions/D560.md) |
| D561 | **A countdown timer and animated stats** |  | [text](decisions/D561.md) |
| D562 | **A drop-shipping supplier's return address in parts, and return labels to the return's own address** |  | [text](decisions/D562.md) |
| D563 | **A product passport's address with no published passport is a real 404** |  | [text](decisions/D563.md) |
| D564 | **Three tests that failed now and then, and the *Saved* message they found lost** |  | [text](decisions/D564.md) |
| D565 | **SMS marketing through the store's own 46elks account** |  | [text](decisions/D565.md) |
| D566 | **Combined listings** |  | [text](decisions/D566.md) |
| D567 | **Every query the app sends is bounded, and every payment webhook route** |  | [text](decisions/D567.md) |
| D568 | **The admin on a phone** |  | [text](decisions/D568.md) |
| D569 | **Migrations that keep the busiest tables writable** |  | [text](decisions/D569.md) |
| D570 | **The phone menu button's menu** |  | [text](decisions/D570.md) |
| D571 | **The slide-out cart takes the menu's settings** |  | [text](decisions/D571.md) |
| D572 | **Migrations squashed to a baseline** |  | [text](decisions/D572.md) |
| D573 | **The phone menu shows the header's menu, a button chooses its own, and sits left or right; the builder's bar folds on phones** |  | [text](decisions/D573.md) |
| D574 | **A daily reading of production's statistics** |  | [text](decisions/D574.md) |
| D575 | **The deploy job requests two pages, and Kaizena Flow's own store is prerendered** |  | [text](decisions/D575.md) |
| D576 | **The schema is not loaded at run time, and light routes import helpers from the files that define them** |  | [text](decisions/D576.md) |
| D577 | **A site's header and footer are checked when they are set, not again when the other changes** |  | [text](decisions/D577.md) |
| D578 | **Heavy server packages and the AI manager's engine load on first use** |  | [text](decisions/D578.md) |
| D579 | **Every dialog in the page builder moves and resizes as the settings panel does** |  | [text](decisions/D579.md) |
| D580 | **The import cycle of src/server is cut** |  | [text](decisions/D580.md) |
| D581 | **Code outside the admin reads admin words through per-area modules** |  | [text](decisions/D581.md) |
| D582 | **Chat widgets on the owner's own websites, each with its own look, on one tag per widget** |  | [text](decisions/D582.md) |
| D583 | **Chat widgets read their own websites' pages** |  | [text](decisions/D583.md) |
| D584 | **A new layer over a background starts at a depth** | 2026-11-13 | [text](decisions/D584.md) |
| D585 | **The AI spends money only through what the owner connected, and first moves ad budgets inside the owner's own ad account** | 2026-11-13 | [text](decisions/D585.md) |
| D586 | **AI-translated interface text costs what it uses** |  | [text](decisions/D586.md) |
| D587 | **The signed-in frame's first scripts carry no Supabase client, zod, builder English or sign-in English** |  | [text](decisions/D587.md) |
| D588 | **Admin screens load an editor only where they draw one** |  | [text](decisions/D588.md) |
| D589 | **The Work invoice's words and the AI manager's tool definitions leave client scripts** |  | [text](decisions/D589.md) |
| D590 | **Links a press cannot use are not prefetched** |  | [text](decisions/D590.md) |
| D591 | **The admin's links are fetched on intent** |  | [text](decisions/D591.md) |
| D592 | **The router's two settings are written down** |  | [text](decisions/D592.md) |
| D593 | **A store page makes no call of its own after load for a visitor with nothing to fetch** |  | [text](decisions/D593.md) |
| D594 | **Contact details at checkout** | 2026-11-14 | [text](decisions/D594.md) |
| D595 | **The admin redesigned, round 1** | 2026-11-14 | [text](decisions/D595.md) |
| D596 | **A checkout question can be half width** | 2026-11-14 | [text](decisions/D596.md) |
| D597 | **The admin redesigned, round 2** | 2026-11-14 | [text](decisions/D597.md) |
| D598 | **A checkout question can be a tick list, with the EU's 14 allergens ready-made and an explicit consent for sensitive answers** | 2026-11-14 | [text](decisions/D598.md) |
| D599 | **The AI wallet** | 2026-11-14 | [text](decisions/D599.md) |
| D600 | **A store page's first scripts hold only what the page draws** |  | [text](decisions/D600.md) |
| D601 | **A checkout question can be a dropdown, a choice of one or longer text** | 2026-11-14 | [text](decisions/D601.md) |
| D602 | **The admin's menu, its progress polls and the notice badge cost less** |  | [text](decisions/D602.md) |
| D603 | **The admin redesigned, round 3** | 2026-11-14 | [text](decisions/D603.md) |
| D604 | **Challenge mode** | 2026-11-14 | [text](decisions/D604.md) |
| D605 | **The margin floor** | 2026-11-14 | [text](decisions/D605.md) |
| D606 | **Goals of profit, and the autopilot sees money** | 2026-11-14 | [text](decisions/D606.md) |
| D607 | **The AI answers emails about the sender's own orders** | 2026-11-14 | [text](decisions/D607.md) |
| D608 | **The challenge's people** | 2026-11-14 | [text](decisions/D608.md) |
| D609 | **The Meta ad account's spend goes into the books by itself** | 2026-11-14 | [text](decisions/D609.md) |
| D610 | **Fallback text models, and the autopilot's work side by side** | 2026-11-14 | [text](decisions/D610.md) |
| D611 | **A save in the admin draws its route once** |  | [text](decisions/D611.md) |
| D612 | **The admin redesigned, round 4** | 2026-11-14 | [text](decisions/D612.md) |
| D613 | **A checkout question can be a number, a date, an email address or a phone number** | 2026-11-14 | [text](decisions/D613.md) |
| D614 | **The 100-day challenge's console** |  | [text](decisions/D614.md) |
| D615 | **The admin redesigned, round 5** | 2026-11-15 | [text](decisions/D615.md) |
| D616 | **A store's slug by its id comes from one cached helper, and the store domains are parsed once** |  | [text](decisions/D616.md) |
| D617 | **The AI connection is read only to call a model, and a visitor's search reaches the model only within a ceiling** |  | [text](decisions/D617.md) |
| D618 | **A checkout question can be asked only for some baskets** | 2026-11-15 | [text](decisions/D618.md) |
| D619 | **A cart or checkout render works the basket out once, and asks nothing of a feature that is off** |  | [text](decisions/D619.md) |
| D620 | **The admin redesigned, round 6** | 2026-11-15 | [text](decisions/D620.md) |
| D621 | **The challenge's order and stock tools and order events** |  | [text](decisions/D621.md) |
| D622 | **A store's rows are filtered the way its index can serve** |  | [text](decisions/D622.md) |
| D623 | **One contribution profit, revenue per visitor that is measured, and the challenge's scoreboard** |  | [text](decisions/D623.md) |
| D624 | **The admin redesigned, round 7** | 2026-11-15 | [text](decisions/D624.md) |
| D625 | **Challenge stores protected from deploys** |  | [text](decisions/D625.md) |
| D626 | **The admin redesigned, round 8** | 2026-11-15 | [text](decisions/D626.md) |
| D627 | **One field for a discount code or a gift card; the checkout's preview shows the store's questions; the phone's product bar above every…** | 2026-11-15 | [text](decisions/D627.md) |
| D628 | **Watch and roll back the autopilot's changes** |  | [text](decisions/D628.md) |
| D629 | **Read one page, not all of them** |  | [text](decisions/D629.md) |
| D630 | **The admin redesigned, round 9** |  | [text](decisions/D630.md) |
| D631 | **The page builder's settings panels, one structure for every part; their tab and scroll kept from one part to the next; Copy style and…** | 2026-11-15 | [text](decisions/D631.md) |
| D632 | **Retention the AI writes, step 1** |  | [text](decisions/D632.md) |
| D633 | **The admin redesigned, round 10** |  | [text](decisions/D633.md) |
| D634 | **The admin redesigned, round 11** |  | [text](decisions/D634.md) |
| D635 | **A late order's and a parcel's customer told in the store's own words** |  | [text](decisions/D635.md) |
| D636 | **What to reorder is a demand forecast** |  | [text](decisions/D636.md) |
| D637 | **The admin redesigned, round 12** |  | [text](decisions/D637.md) |
| D638 | **A product that may run out is an event the autopilot answers** |  | [text](decisions/D638.md) |
| D639 | **The admin redesigned, round 13** |  | [text](decisions/D639.md) |
| D640 | **A customer's address change and cancellation carried out by code** |  | [text](decisions/D640.md) |
| D641 | **The admin redesigned, round 14** |  | [text](decisions/D641.md) |
| D642 | **pg_cron's own run log is kept to seven days** |  | [text](decisions/D642.md) |
| D643 | **Thirteen duplicate indexes dropped, and a test that stops the next one** |  | [text](decisions/D643.md) |
| D644 | **Prunes run daily or hourly, not every five minutes or every minute** |  | [text](decisions/D644.md) |
| D645 | **Pictures served as stored, and files with a fixed address kept long** |  | [text](decisions/D645.md) |
| D646 | **Return labels and handling in contribution profit** |  | [text](decisions/D646.md) |
| D647 | **Admin redesign round 15** |  | [text](decisions/D647.md) |
| D648 | **The challenge's baseline, frozen before Day 1** |  | [text](decisions/D648.md) |
| D649 | **The knowledge job reads no document when nothing was published** |  | [text](decisions/D649.md) |
| D650 | **Admin redesign round 16** |  | [text](decisions/D650.md) |
| D651 | **A page the autopilot published is rolled back after a clear fall** |  | [text](decisions/D651.md) |
| D652 | **Admin redesign round 17** |  | [text](decisions/D652.md) |
| D653 | **Flows of several emails, cross-sell and restock** |  | [text](decisions/D653.md) |
| D654 | **Picture, alt-text and product upkeep cost one statement when nothing changed** |  | [text](decisions/D654.md) |
| D655 | **The listings' check reads only new or reworded listings, and an unusable answer waits a day** |  | [text](decisions/D655.md) |
| D656 | **Heatmaps and recordings, step 1** |  | [text](decisions/D656.md) |
| D657 | **Admin redesign round 18** |  | [text](decisions/D657.md) |
| D658 | **The paperwork for an AI that acts on its own** |  | [text](decisions/D658.md) |
| D659 | **A/B tests made plain, step 1** | 2026-11-16 | [text](decisions/D659.md) |
| D660 | **A/B tests made plain, step 2** | 2026-11-16 | [text](decisions/D660.md) |
| D661 | **Admin redesign round 19** |  | [text](decisions/D661.md) |
| D662 | **A/B tests made plain, step 3** | 2026-11-16 | [text](decisions/D662.md) |
| D663 | **Visitors who meet an error page, watched hourly** |  | [text](decisions/D663.md) |
| D664 | **The invoice job asks only stores it can issue for** |  | [text](decisions/D664.md) |
| D665 | **Every picture keeps an 800 px copy, and a grid tile says its real width** |  | [text](decisions/D665.md) |
| D666 | **The admin's colour roles follow the site's colours outside the admin** |  | [text](decisions/D666.md) |
| D667 | **Tailwind reads the code under src only** |  | [text](decisions/D667.md) |
| D668 | **CLAUDE.md's core is held at its size** |  | [text](decisions/D668.md) |
| D669 | **Server errors per hour in the autopilot's watch** |  | [text](decisions/D669.md) |
| D670 | **A/B tests made plain, step 3b part 1** | 2026-11-16 | [text](decisions/D670.md) |
| D671 | **Admin redesign round 20** |  | [text](decisions/D671.md) |
| D672 | **Paging and an outside heartbeat** |  | [text](decisions/D672.md) |
| D673 | **A/B tests made plain, step 3b part 2** | 2026-11-16 | [text](decisions/D673.md) |
| D674 | **The dispatcher runs four jobs at a time** |  | [text](decisions/D674.md) |
| D675 | **The autopilot processes a confirmed exchange** |  | [text](decisions/D675.md) |
| D676 | **Living docs are wrapped, and history stays out of default searches** |  | [text](decisions/D676.md) |
| D677 | **A/B tests made plain, step 4a** | 2026-11-16 | [text](decisions/D677.md) |
| D678 | **A/B tests made plain, step 4b** | 2026-11-16 | [text](decisions/D678.md) |
| D679 | **A lost parcel's goods sent again, as an order at 0** | 2026-11-16 | [text](decisions/D679.md) |
| D680 | **A/B tests made plain, step 4c** | 2026-11-16 | [text](decisions/D680.md) |
| D681 | **Admin redesign round 21** |  | [text](decisions/D681.md) |
| D682 | **Each check runs once in CI, and a tests-only push does not deploy** |  | [text](decisions/D682.md) |
| D683 | **Rules say what is so, and a decision's number is claimed on main** |  | [text](decisions/D683.md) |
| D684 | **A/B tests made plain, step 2b** | 2026-11-16 | [text](decisions/D684.md) |
| D685 | **A customer's request by email carried out once they confirm it from the order's address** | 2026-11-16 | [text](decisions/D685.md) |
| D686 | **A/B tests** | 2026-11-16 | [text](decisions/D686.md) |
| D687 | **Admin redesign round 22** | 2026-11-16 | [text](decisions/D687.md) |
| D688 | **Admin redesign round 23** | 2026-11-16 | [text](decisions/D688.md) |
| D689 | **Delete what nothing uses** |  | [text](decisions/D689.md) |
| D690 | **A test loads only what it uses** |  | [text](decisions/D690.md) |
| D691 | **Browse abandonment** | 2026-11-16 | [text](decisions/D691.md) |
| D692 | **Admin redesign round 24** | 2026-11-16 | [text](decisions/D692.md) |
| D693 | **Admin redesign round 25** | 2026-11-17 | [text](decisions/D693.md) |
| D694 | **D1 step 1** | 2026-11-16 | [text](decisions/D694.md) |
| D695 | **Contracts for deals, signed on our own signing page** | 2026-11-16 | [text](decisions/D695.md) |
| D696 | **Old admin redirects and the bookings and boxes twin switch removed** |  | [text](decisions/D696.md) |
| D697 | **Pictures in page content get the 800 px copy** |  | [text](decisions/D697.md) |
| D698 | **Themes, packs and the seed write today's page shape** |  | [text](decisions/D698.md) |
| D699 | **Admin redesign round 26** | 2026-11-16 | [text](decisions/D699.md) |
| D700 | **Admin redesign round 27** | 2026-11-16 | [text](decisions/D700.md) |
| D701 | **Admin redesign round 28** | 2026-11-16 | [text](decisions/D701.md) |
| D702 | **Admin redesign round 29** | 2026-11-16 | [text](decisions/D702.md) |
| D703 | **Admin redesign round 30** | 2026-11-17 | [text](decisions/D703.md) |
| D704 | **Admin redesign round 31** | 2026-11-17 | [text](decisions/D704.md) |
| D705 | **Forms as their own records** | 2026-11-17 | [text](decisions/D705.md) |
| D706 | **Admin redesign round 32** | 2026-11-17 | [text](decisions/D706.md) |
| D707 | **Admin redesign round 33** | 2026-11-17 | [text](decisions/D707.md) |
| D708 | **Admin redesign round 34** | 2026-11-17 | [text](decisions/D708.md) |
| D709 | **The build without source maps on Vercel** | 2026-11-17 | [text](decisions/D709.md) |
| D710 | **A run whose commit is no longer the head leaves the deploy to the newer run** | 2026-11-17 | [text](decisions/D710.md) |
| D711 | **Ecosystem plan phase 1** | 2026-11-17 | [text](decisions/D711.md) |
| D712 | **A/B guardrails as designed, and a sign-up goal for Kaizena Flow's store** | 2026-11-17 | [text](decisions/D712.md) |
| D713 | **Ecosystem plan phase 2** | 2026-11-17 | [text](decisions/D713.md) |
| D714 | **Admin redesign round 35** | 2026-11-17 | [text](decisions/D714.md) |
| D715 | **A/B tests, phase 20** | 2026-11-17 | [text](decisions/D715.md) |
| D716 | **A store page's first scripts are held by name** |  | [text](decisions/D716.md) |
| D717 | **The admin's words handed are counted against the words named** |  | [text](decisions/D717.md) |
| D718 | **Ecosystem plan phase 3** | 2026-11-17 | [text](decisions/D718.md) |
| D719 | **Every budget has one home, and the written rules have a budget** |  | [text](decisions/D719.md) |
| D720 | **Email and SMS flows to ActiveCampaign's level, ahead on ease, inside the ecosystem, and legal B2B prospecting** | 2026-11-17 | [text](decisions/D720.md) |
| D721 | **A/B tests as a plan's feature** | 2026-11-17 | [text](decisions/D721.md) |
| D722 | **The morning briefing says when an admin screen is slow** |  | [text](decisions/D722.md) |
| D723 | **What a session loads is measured, and source file size is held** |  | [text](decisions/D723.md) |
| D724 | **Admin redesign round 36** | 2026-11-17 | [text](decisions/D724.md) |
| D725 | **Admin redesign round 37** | 2026-11-17 | [text](decisions/D725.md) |
| D726 | **The admin's client modules are under an import walk, and its words held where they go** |  | [text](decisions/D726.md) |
| D727 | **A sending domain per store, through Resend's EU region, with its records written where we keep the DNS** | 2026-11-17 | [text](decisions/D727.md) |
| D728 | **Admin redesign round 38** | 2026-11-17 | [text](decisions/D728.md) |
| D729 | **Ecosystem plan phase 4** | 2026-11-17 | [text](decisions/D729.md) |
| D730 | **A guard on each store's sending** | 2026-11-17 | [text](decisions/D730.md) |
| D731 | **Admin redesign round 39** | 2026-11-17 | [text](decisions/D731.md) |
| D732 | **Email events on the event log** | 2026-11-17 | [text](decisions/D732.md) |
| D733 | **Every route's first scripts are held against a baseline** |  | [text](decisions/D733.md) |
| D734 | **Next.js 16.4.6 for GHSA-mfr8-8qww-v76h** |  | [text](decisions/D734.md) |
| D735 | **Admin redesign round 40** | 2026-11-17 | [text](decisions/D735.md) |
| D736 | **Statements are counted, and the admin's five screens held** |  | [text](decisions/D736.md) |
| D737 | **Admin redesign round 41** | 2026-11-17 | [text](decisions/D737.md) |
| D738 | **Forms F6** | 2026-11-17 | [text](decisions/D738.md) |
| D739 | **Admin redesign round 42** | 2026-11-17 | [text](decisions/D739.md) |
| D740 | **Admin redesign round 43** | 2026-11-17 | [text](decisions/D740.md) |
| D741 | **CI deploys a passed commit when the newer run it waited for fails** | 2026-11-17 | [text](decisions/D741.md) |
| D742 | **Admin redesign round 44** | 2026-11-17 | [text](decisions/D742.md) |
| D743 | **Admin redesign round 45** | 2026-11-17 | [text](decisions/D743.md) |
| D744 | **Database flags over two daily readings** |  | [text](decisions/D744.md) |
| D745 | **Tag refreshes and store page draws are counted in production** |  | [text](decisions/D745.md) |
| D746 | **Scheduled work and cold frames are counted** |  | [text](decisions/D746.md) |
| D747 | **The storefront's server side is held** |  | [text](decisions/D747.md) |
| D748 | **Paid extensions, account plans and standalone products** | 2026-11-17 | [text](decisions/D748.md) |
| D749 | **The surface budget** |  | [text](decisions/D749.md) |
| D750 | **Admin redesign round 46** | 2026-11-18 | [text](decisions/D750.md) |
| D751 | **Unused code, copies and the admin's repeats are held** |  | [text](decisions/D751.md) |
| D752 | **Visitor budgets on real store pages** |  | [text](decisions/D752.md) |
| D753 | **A shop-only store's journey and one order's writes are held** |  | [text](decisions/D753.md) |
| D754 | **Clicks kept per person in broadcasts** | 2026-11-18 | [text](decisions/D754.md) |
| D755 | **Admin redesign round 47** | 2026-11-18 | [text](decisions/D755.md) |
| D756 | **Admin redesign round 48** | 2026-11-18 | [text](decisions/D756.md) |
| D757 | **Ecosystem plan phase 5** | 2026-11-18 | [text](decisions/D757.md) |
| D758 | **A store on a launch theme is in the measured set** |  | [text](decisions/D758.md) |
| D759 | **A cart with products and the checkout's payment step are measured** |  | [text](decisions/D759.md) |
| D760 | **Every agent's round is held, and tokens per call are shown** |  | [text](decisions/D760.md) |
| D761 | **Orders after a message by one rule** | 2026-11-18 | [text](decisions/D761.md) |
| D762 | **Admin redesign round 49** | 2026-11-18 | [text](decisions/D762.md) |
| D763 | **Data protection officer per account, with a store's own override** | 2026-11-18 | [text](decisions/D763.md) |
| D764 | **One contact policy across email and texts** | 2026-11-18 | [text](decisions/D764.md) |
| D765 | **Admin redesign round 50** | 2026-11-18 | [text](decisions/D765.md) |
| D766 | **What a server entry loads and carries is held** |  | [text](decisions/D766.md) |
| D767 | **Flows** | 2026-11-18 | [text](decisions/D767.md) |
| D768 | **What a signed-in screen is handed is held, in English and in Norwegian** |  | [text](decisions/D768.md) |
| D769 | **Every check's seconds and the build's peak memory are recorded** |  | [text](decisions/D769.md) |
| D770 | **Whose classes the stylesheet holds, and the style text owners write** |  | [text](decisions/D770.md) |
| D771 | **Cold starts are a production figure** |  | [text](decisions/D771.md) |
| D772 | **Every production build reports its memory, and the free switches are not enough** |  | [text](decisions/D772.md) |
| D773 | **The production build in CI, tried as a prebuilt preview first** |  | [text](decisions/D773.md) |
| D774 | **CLAUDE.md is a core with a map, and the how-to loads by path** |  | [text](decisions/D774.md) |
| D775 | **A page's title and flags are kept in columns** |  | [text](decisions/D775.md) |
| D776 | **A store page sends its layout once** |  | [text](decisions/D776.md) |
| D777 | **Each fixed stylesheet is drawn once per document** |  | [text](decisions/D777.md) |
| D778 | **Page lists, pickers and grids open no document** |  | [text](decisions/D778.md) |
| D779 | **A product view asks the database for stock only** |  | [text](decisions/D779.md) |
| D780 | **A cold store page's frame is read in one wave** |  | [text](decisions/D780.md) |
| D781 | **The second-factor mirror is kept right at every sign-in** |  | [text](decisions/D781.md) |
| D782 | **A placed order has its ceilings** |  | [text](decisions/D782.md) |
| D783 | **An untouched admin tab asks for notices less often** |  | [text](decisions/D783.md) |
| D784 | **Admin redesign round 51** | 2026-11-19 | [text](decisions/D784.md) |
| D785 | **E3 rest** | 2026-11-19 | [text](decisions/D785.md) |
| D786 | **Dates in the store's own time zone** | 2026-11-19 | [text](decisions/D786.md) |
| D787 | **Unsaved work survives** | 2026-11-19 | [text](decisions/D787.md) |
| D788 | **Admin redesign round 52** | 2026-11-19 | [text](decisions/D788.md) |
| D789 | **Database tests share a worker; component tests keep a fresh one** | 2026-11-19 | [text](decisions/D789.md) |
| D790 | **One file per decision, with a generated index** | 2026-11-19 | [text](decisions/D790.md) |
| D791 | **The migrations ledger is the record** | 2026-11-19 | [text](decisions/D791.md) |
| D792 | **Mail to reserved test domains is logged, never sent** | 2026-11-19 | [text](decisions/D792.md) |
| D793 | **A stale eval recording or a long wait never holds back a release that passed** | 2026-11-19 | [text](decisions/D793.md) |
| D794 | **Tests for how owners get paid** | 2026-11-19 | [text](decisions/D794.md) |
| D795 | **Contracts' upkeep runs in the five-minute dispatcher, and it calls the PDF route only when a signed contract waits for its seal** | 2026-11-19 | [text](decisions/D795.md) |
| D796 | **Dates shoppers see in the store's own time zone** | 2026-11-19 | [text](decisions/D796.md) |
| D797 | **The AI answers a store's form messages (100-day B2)** | 2026-11-19 | [text](decisions/D797.md) |
| D798 | **Admin redesign round 53: live, stock locations and authors on a phone** | 2026-11-19 | [text](decisions/D798.md) |
| D799 | **No English catalogue in the admin's client code** | 2026-11-19 | [text](decisions/D799.md) |
| D800 | **The builder paints before the rich text editor and a store language** | 2026-11-19 | [text](decisions/D800.md) |
| D801 | **The session is kept by Supabase's auth client alone** | 2026-11-19 | [text](decisions/D801.md) |
| D802 | **Admin redesign round 54: export stock, speed and heatmaps on a phone** | 2026-11-19 | [text](decisions/D802.md) |
| D803 | **When main is red: CI keeps a ci-red issue naming the failing tests and the sessions since the last green run** | 2026-11-19 | [text](decisions/D803.md) |
| D804 | **In the challenge a money-free order change and a market price rule run by themselves (100-day A2)** | 2026-11-19 | [text](decisions/D804.md) |
| D805 | **Store pages with nothing per visitor are static files** | 2026-11-19 | [text](decisions/D805.md) |
| D806 | **Admin redesign round 55: product feeds, order history import and redirect export on a phone** | 2026-11-19 | [text](decisions/D806.md) |
| D807 | **Invoices' and credit notes' PDFs are made ahead: the dispatcher asks the PDF route when a document waits** | 2026-11-19 | [text](decisions/D807.md) |
| D808 | **A/B tests: the platform's page leads to Kaizena Flow's own site's tests** | 2026-11-19 | [text](decisions/D808.md) |
| D809 | **Admin redesign round 56: new segment, Google reviews and wishlists on a phone** | 2026-11-19 | [text](decisions/D809.md) |
| D810 | **Contracts in the Admin API: read-only, the webhooks' fields and drafts, under customers:read** | 2026-11-19 | [text](decisions/D810.md) |
| D811 | **Tests for the shopper's payment session, the Stripe payment provider and billing (code review 1.9's next, FH9)** | 2026-11-19 | [text](decisions/D811.md) |
| D812 | **The dates left after D796: A/B results, the platform activity filter and the admin's zoneless dates** | 2026-11-19 | [text](decisions/D812.md) |
| D813 | **Admin redesign round 57: customer import, old shop's links and a new gift card on a phone** | 2026-11-19 | [text](decisions/D813.md) |
| D814 | **Admin redesign round 58: new text message, close store and change your store on a phone** | 2026-11-19 | [text](decisions/D814.md) |
| D815 | **Kaizena Flow's Stripe webhooks are replaced new first: the old ones go only after the new secrets are saved** | 2026-11-19 | [text](decisions/D815.md) |
| D816 | **The proxy imports leaf readers only** | 2026-11-19 | [text](decisions/D816.md) |
| D817 | **Contracts sent a month on Usage and limits: a count, and a soft limit nobody sets yet** |  | [text](decisions/D817.md) |
| D818 | **The admin kit: Field, TextInput, Select, EmptyState, ConfirmButton, Pager and ListSearch in the admin's ui (code review** | 2026-11-19 | [text](decisions/D818.md) |
| D819 | **Admin redesign round 59: add a customer, bring a domain here and recordings on a phone** | 2026-11-19 | [text](decisions/D819.md) |
| D820 | **Admin redesign round 60: move a domain, footers and draft orders on a phone** | 2026-11-19 | [text](decisions/D820.md) |
| D821 | **Each admin page hands cuts of the word areas its parts read** | 2026-11-19 | [text](decisions/D821.md) |
| D822 | **Admin redesign round 61: website chat, new draft order and privacy requests on a phone** | 2026-11-19 | [text](decisions/D822.md) |
| D823 | **Admin redesign round 62: Kaizena Flow's VAT rates, accounts and data retention on a phone** | 2026-11-19 | [text](decisions/D823.md) |
<!-- /decisions:index -->

### Selling from Norway to Sweden and Denmark

Norway is in the EEA but outside the EU's customs and VAT union, so a Norwegian
company shipping from Norway sells to Swedish and Danish customers as an
exporter. In practice:

- **Norwegian VAT (MVA).** Register once sales in Norway pass NOK 50,000 in 12
  months, and charge Norwegian VAT on Norwegian orders.
- **EU VAT on low-value parcels.** For orders worth up to €150, the store can
  register for the EU's Import One-Stop Shop (IOSS) and charge Swedish or
  Danish VAT (25% for standard goods) at checkout. Parcels then clear customs
  without the customer paying anything on delivery. To confirm with an
  accountant: Norway's VAT cooperation agreement with the EU is understood to let
  Norwegian companies register for IOSS without an EU intermediary.
- **Without IOSS**, the carrier collects VAT plus a handling fee from the
  customer on delivery. That is legal but a known reason for refused parcels
  and lost repeat customers.
- **EU customs duty.** Since 1 July 2026 the EU charges a flat €3 duty per item
  category on low-value parcels, which IOSS does not collect. Orders over €150
  pay normal duty and import VAT. The store should show these costs at checkout
  or ship duties-paid.
- **Customs declarations.** Every parcel needs a Norwegian export and an EU
  import declaration, normally filed by the carrier (Posten/Bring, PostNord)
  from the tariff code and country of origin now stored per variant.
- **Later option: stock in the EU.** With a warehouse in Sweden, EU sales
  become domestic and intra-EU: no customs per parcel, but a Swedish VAT
  registration and the EU One-Stop Shop. Worth reconsidering as EU volume grows.
- **Consumer law.** Norwegian customers are covered by angrerettloven and
  forbrukerkjøpsloven (complaints up to five years for goods meant to last).
  Swedish and Danish customers are covered by EU consumer law, including the
  withdrawal button and the 30-day prior-price rule. The store follows the
  stricter rule wherever the two differ.
- **Product safety.** Products sold to Swedish and Danish consumers fall under
  the EU General Product Safety Regulation, which needs an EU-based responsible
  person when the manufacturer is not in the EU. Norway is not in the EU for
  this purpose unless the regulation has been taken into the EEA Agreement
  (unverified).
- **To verify with Stripe:** that Stripe Tax covers Norwegian VAT and IOSS, and
  that Vipps MobilePay is available.

Migration versions: [decisions/migration-versions.md](decisions/migration-versions.md).

## Open

### Required before the first sale

These come with selling online in these countries, whatever the platform:
WooCommerce and Shopify need them too.

| # | Item | Owner | Notes |
|---|---|---|---|
| R1 | Norwegian VAT (MVA) registration | You | Once Norwegian sales pass NOK 50,000 in 12 months. |
| R2 | Decide how EU VAT is collected: register for IOSS, or let the carrier collect from customers on delivery | You (+ accountant) | IOSS is the better customer experience. See above. |
| R3 | Terms of sale, withdrawal information and privacy policy in Norwegian, Swedish and Danish | Claude drafts, you review | Built into Phase 1. |
| R4 | Packaging producer responsibility in each market | You | Check whether your volumes trigger registration in Norway, Sweden and Denmark; record numbers in `commerce.producer_registrations` (per store). |
| R5 | Product-safety contact details per manufacturer, and an EU responsible person where needed | You | The database will not activate a product without them. |
| R6 | Check the standard VAT rates in `commerce.countries` and decide on Stripe Tax for reduced rates (food, books, children's clothing) | You (+ accountant) | Orders show VAT at the standard rate of the shopper's country until then. |
| R7 | Turn on customer receipts in Stripe (Settings → Customer emails → Successful payments) | Each store owner | Optional since D26: Kaizen sends its own order confirmation once Resend is set up; Stripe's receipt is a second copy. |

### Not needed now

| Item | When it becomes relevant |
|---|---|
| Sentry, PostHog, GrowthBook accounts | Optional. Add one when Vercel's built-in tools stop being enough (D13). |
| Cookie-consent review per country | Only if non-essential cookies or pixels are added (D14). |
| Data protection impact assessment | Before the AI assistant launches (Phase 3). |
| Accountant review of the VAT setup | Recommended before launch, not legally required. |
| Data processing agreements with Vercel and Supabase | Account-level; if your team and organisation already have them, this project is covered. |
