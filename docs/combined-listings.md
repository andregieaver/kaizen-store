# Combined listings (D566)

Separate products shown as one listing, chosen between by a shared option such as colour: the parity row
`catalogue.combined-listings` (Shopify Plus's Combined Listings app). Built on 11 November 2026 as the next step the owner chose.

## Model

- `product_groups`: a store's listing, with the shared option's name by language (`{ "nb-NO": "Farge" }`).
- On `products`: `group_id` (one listing at most), `group_value` (its own value by language), `group_swatch` (an optional `#rrggbb`
  colour dot) and `group_position` (the order, the first product first).
- Written only by `src/server/product-groups.ts` (`products:write`, audited as `products.group_*`). The words are kept in the store's
  main language; a listing with fewer than two products is dissolved.

## What shoppers see

- **The product page**: above the buy part, the option's name and this product's value, then every product of the listing that is
  offered here (active, and offered by `OFFERED`), as round colour dots or value pills, each a link to its own page; this one is
  marked `aria-current="page"`. Each product keeps its own page, address, canonical, price, stock, variants and reviews; the cart holds
  the product chosen.
- **A product card** in the listings (All products, categories, search): up to six dots or values linking to the other products, above the
  card's own link, and `+N` for more.
- Search, feeds and sitemaps list each product once, at its own address, as before.

## In the admin

A product's page links to *Show with other products* (`/admin/{store}/products/{id}/listing`): start a listing with what tells the
products apart and this product's value, then add others (any product in no listing, not archived) with their own values and an optional
colour, change a value or colour, rename the option, or take a product out.

## Not yet

The option and values in other languages (the main language's words are shown in every language); the listing in the product CSV and in
content grids' own tiles; one card for the whole listing instead of one per product.
