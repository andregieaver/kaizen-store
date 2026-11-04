---
title: Variants and options
summary: Sell a product in sizes, colours or other options, give each variant its own SKU, price, stock and weight, and switch off the ones you do not sell.
track: owners
section: products
kind: how-to
areas: [products, stock]
features: []
plans: []
admin: /admin/{store}/products/{id}
order: 10
checked: 2026-11-04
sources: [D320, D82, D84, D79]
---

## Options and variants

An **option** is what a shopper chooses, such as *Colour* or *Size*. Each option has **values**, such as *White, Black* or *S, M, L*.
A **variant** is one combination of values, such as *White, M*: the thing you actually stock and send. A product can have up to three
options.

A product without options has one variant, so it still has a SKU, a price and stock.

## Add options to a product

1. Open the product (**Products**, then the product) and go to **Price and stock**.
2. Tick **This product comes in options, such as sizes or colours**.
3. Under **Options**, give the **Option name**, such as *Colour*, and its **Values**, separated by commas: *White, Black*.
4. Press **Add another option** for a second or third option, such as *Size* with *S, M, L*.

Every combination of the values becomes a row in the variants table below: two colours and three sizes make six variants. A new
combination starts with the first variant's prices, so you do not have to type every price again.

## Fill in each variant

Each row of the table has:

- **Variant**: its values, with its picture.
- **SKU**: your own code for it. Every variant needs one, and no two variants in your store can share one.
- **Stock**: how many you have.
- **A price for each country** you sell in, with VAT included. See [Prices](/docs/owners/products/prices).
- **For sale**: ticked while you sell it.

Press **Save** when you are done. If something is missing, such as a SKU, nothing is saved and the editor lists what to fix.

### A picture for each variant

Press the small square beside a variant's name (a **+** until it has a picture). Choose one of the product's pictures, or
**Upload a picture** for that variant alone.
When a shopper chooses the variant, the product page's gallery shows its picture.

### More about a variant

Under each row are three lines you can open:

- **Stock rules for …**: keep selling when sold out, and a warning when stock is low. See
  [Stock and locations](/docs/owners/stock/stock-and-locations) and [Pre-orders and backorders](/docs/owners/stock/pre-orders-and-backorders).
- **How many at a time for …**: a minimum, a maximum and packs. See
  [Quantity rules and price breaks](/docs/owners/products/quantity-rules-and-price-breaks).
- **Barcode, cost, weight, content and customs for …**: **Barcode (GTIN/EAN)**, **Cost per unit** (without VAT), **Weight in grams**,
  **Customs tariff (HS) code**, **Country of origin**, and the content for a price per kg or litre.

## Stop selling a variant

Untick **For sale** on its row and save. Shoppers no longer see it, and its stock and prices are kept for when you tick it again. A
product needs at least one variant for sale before it can be published.

A variant is never deleted. If you remove a value or an option, the variants that had it are switched off when you save: your orders and
the price history still refer to them.

> [!TIP]
> Not every combination exists? Untick **For sale** on the ones you do not make, such as a large size in one colour. Shoppers can then
> only choose combinations that are for sale.

## What shoppers see

- **On product cards** the lowest price is shown, with *From* in front when the variants' prices differ.
- **With fewer than 12 variants**, the product page has one list, *Choose a variant*, showing each variant's picture, stock and price.
  A variant that cannot be bought now cannot be chosen.
- **With 12 variants or more**, each option has a list of its own: first the colour, then the size. A value that cannot be bought with
  the values already chosen is marked *Not available*, and choosing a value moves to the nearest variant that can be bought.

A variant can be bought when it is in stock, sold on backorder, or a download. A variant that is switched off, has no price in the
shopper's country or is not sold there is not shown at all.

## More options

### Large products

A product can have up to 2,048 variants for sale. Variants that are switched off do not count. With 13 variants or more, the editor shows
**Show the variants with** above the table: choose a value of an option, such as *Black*, to see only those variants. The line beside it
says how many are shown, such as *Showing 48 of 240 variants*.

### Set many variants at once

With two variants or more, press **Set for all shown**. It changes every variant the table shows (all of them, or the ones your filter
leaves):

- a **Price in** each country,
- **Stock** and **Weight (g)**,
- **For sale**: *As they are*, *Yes* or *No*,
- a **SKU pattern**: words in braces are filled in for each variant, in capitals. `{handle}` is the product's web address, `{n}` its
  place in the list, and an option's name its value. `{handle}-{Colour}-{Size}` gives SKUs such as *T-SHIRT-BLACK-M*.

Only the fields you fill in are set, and stock and weight only on variants you ship. Press **Set**, then **Save** the product to keep
the change. If two variants would get the same SKU, or a word in braces is not an option's name, the editor says so before anything is
set.

### Variants delivered differently

Under **How is it delivered?**, tick **Variants are delivered differently (for example a hardcover and an e-book)**. The table then has a
**Delivery** column, so each variant is *Physical* or *Digital*. Digital variants have no stock.

### When the lists change on the product page

The number of variants from which each option gets its own list is 12 unless you change it. You change it on a product layout: open the
**Buy** part under [Product layouts](/admin/{store}/product-layouts) and set **Each option its own list from**. See
[The page builder](/docs/owners/website/the-page-builder).

### Many products at once

To change SKUs, prices and stock across several products in one table, tick them under [Products](/admin/{store}/products) and press
**Edit in a grid**. To work in a spreadsheet, see [Import and export](/docs/owners/products/import-and-export).
