---
title: Prices
summary: Give a product a price in each country, lower it for a sale, stop selling it in one country, price it on request, and choose how shoppers see prices.
track: owners
section: products
kind: how-to
areas: [products, markets, tax, quotes]
features: []
plans: []
admin: /admin/{store}/products/{id}
order: 20
checked: 2026-11-04
sources: [D335, D429, D431, D63]
---

## Give a product its prices

Open the product and go to **Price and stock**. The variants table has a column for each country you sell in, headed with its currency
and *incl. VAT*. Type a price for each variant in each country and press **Save**.

- **Prices include VAT.** What you type is what shoppers pay. The VAT in it is worked out from the product's VAT category and the country;
  see [VAT](/docs/owners/markets-and-tax/vat).
- **Each country has its own price, in its own currency.** Nothing is converted when you type it.
- **A country left empty does not sell the product.** It is not shown to shoppers there.

For sizes and colours, each variant has its own price: see [Variants and options](/docs/owners/products/variants-and-options).

## Lower a price for a sale

Type the lower price and save. Kaizena Flow keeps every price's history, so shoppers see the new price with the *Lowest price in the last
30 days* beside it, as EU law requires. That line appears only when the new price is lower than the lowest price of the 30 days before
it, so raising a price shows no reduction.

There is no separate "was" price to type: a reduction is always measured against the price history. A compare-at price in an imported
file is never used.

- **Many products at once:** tick them under [Products](/admin/{store}/products) and press **Change price**, by a percentage or an
  amount. **Review** shows the first new prices before anything changes. By default only your main country's prices change.
- **An offer without changing the price**, such as 20 % off a category for a weekend or a code: see
  [Discount codes and campaigns](/docs/owners/marketing/discount-codes-and-campaigns).
- **A lower price for buying more:** see [Quantity rules and price breaks](/docs/owners/products/quantity-rules-and-price-breaks).

## Stop selling in one country

When you sell in several countries, **Sold in** under the variants table has a tick for each. Untick a country to stop selling the
product there. Its price is kept for when you tick it again.

For many products, tick them under [Products](/admin/{store}/products) and press **Stop selling in** or **Sell in**. A country without a
price stays unsold until it has one.

> [!NOTE]
> The editor stops a whole product in a country. To stop only one variant there, use the `not_sold_in` column of the product file
> ([Import and export](/docs/owners/products/import-and-export)) or ask the AI manager. **Sold in** then lists the variants that are not
> sold everywhere.

## Price on request

For goods whose price depends on the order, tick **Price on request** at the top of **Price and stock**. Shoppers then see *Price on
request* instead of a price, and press *Request a quote* instead of *Add to cart*. The product is never put in a cart, and it is left out
of product feeds.

The prices you typed stay as your guide when you price a quote. They are never shown. Requests arrive as draft orders: see
[Draft orders and quotes](/docs/owners/orders/draft-orders-and-quotes).

Price on request is for goods bought once. It is not offered on a product sold by subscription. A product priced on request can still be
part of a bundle with a price of its own: see [Bundles](/docs/owners/products/bundles).

## How shoppers see prices

Open **Settings** and choose [Prices and quantity](/admin/{store}/settings/prices), under Selling.

- **Decimals.** **Always show the decimals**, or **Leave ,00 off whole amounts**: then 499,00 kr is shown as 499 kr, and 499,50 kr keeps
  its decimals. Nothing is ever rounded. Every price shoppers see follows it, also in the cart, at checkout and in your emails to them.
  Invoices, credit notes, reports and the admin keep their decimals.
- **Words around a product's price.** Short words **Before the price** and **After the price**, such as *Only* or */pc*. **Shoppers see**
  shows the result. The words appear wherever a product's price is shown, never beside the cart's lines or totals, on invoices or in
  feeds.

Press **Save**. The shop shows prices the new way at once.

> [!IMPORTANT]
> Each word is at most 24 characters of plain text. Percentages and words that could mislead shoppers, such as a best price, urgency or a
> stock level, are refused: a reduction is shown by the store itself, against the lowest price of the last 30 days.

### More options

- **Decimals per country**, under **Advanced**: a country can differ from the store's choice, such as no decimals in Norway and decimals in
  Germany.
- **Words in your other languages**, under **Advanced**: tick **Own words in …** for a language. A language without its own uses the main
  language's words.
- **One product's own words**: in the product's editor, open **Advanced** and choose under **Words around the price**: **The store's
  words**, **None** or **Its own words**.

## Prices for businesses

In a store that sells to both private shoppers and businesses, a shopper buying for a business sees the same prices without VAT, marked
*excl. VAT*; VAT is still charged. A store that sells only to businesses types its prices without VAT in the editor, and the columns say
*excl. VAT*. See
[Companies and B2B](/docs/owners/customers/companies-and-b2b).

## Work out a country's prices from another

With **Several countries** switched on (Settings, Features) and more than one country, open **Settings** and choose
[Countries](/admin/{store}/settings/countries). Under **Prices in each country**, each country after the first is **Set by hand**, or
**Worked out from** another country:

- **Change, in %**: such as 10 or -5; 0 keeps the same price.
- **VAT**: **Keep the price before VAT the same** or **Keep the price with VAT the same**, for countries with different VAT rates.
- **Round to** and **Price ending (optional)**, such as 9 or 0.90: prices end so, rounded up.

Press **Show five prices** to see what five products would cost, then **Save**. When a price in the base country changes, the prices the rule
made follow it. Between two currencies, both need an exchange rate under Languages and currencies.

In the product editor, a price the rule worked out says *By the country's price rule* under it. A price you type there yourself is yours:
the rule leaves it alone. **Set by hand again** ends the rule and keeps the prices it made. See
[Countries, languages and currencies](/docs/owners/markets-and-tax/countries-languages-currencies).
