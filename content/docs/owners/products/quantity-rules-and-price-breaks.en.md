---
title: Quantity rules and price breaks
summary: Sell a variant from a minimum, up to a maximum or in packs, give a lower price each from a number of units, and choose how shoppers pick a quantity.
track: owners
section: products
kind: how-to
areas: [products, customers]
features: []
plans: []
admin: /admin/{store}/products/{id}
order: 30
checked: 2026-11-04
sources: [D323, D430, D321]
---

## Sell in packs, or from a minimum

Open the product and go to **Price and stock**. Under the variant's row, open **How many at a time for …**:

- **Sold in multiples of**: 1 sells any number. With 6, shoppers buy 6, 12, 18 and so on.
- **At least**: the smallest number in one order line.
- **At most**: the largest. Leave it empty for no limit of your own.

Press **Use for every variant** to give all the product's variants the same rule, then **Save**.

When you change **Sold in multiples of**, the minimum and the maximum move to whole multiples of it. Every number is at most 9,999.

> [!NOTE]
> Without a maximum, one order line holds up to twenty multiples from the minimum: the field shows the number, such as *No limit (20 a
> line)*.

### What shoppers see

- **The product page** states the rule under the stock, such as *At least 12*, *In multiples of 6* or *At most 48*.
- **The quantity** starts at the minimum and goes up in whole multiples, on the product page and in the cart.
- **The cart** refuses a quantity the rule does not allow. If you change a rule after a shopper added the product, their cart says
  *Change the quantity: …*, and they cannot check out until they do.

The rules hold for what shoppers buy themselves. Draft orders, order changes and exchanges that you make are not held to them.

## Lower the price for buying more

Price breaks give a lower price each from a number of units in one order line. Open the product, then **Advanced**, and find
**Price by quantity**:

1. Press **Add a price by quantity**.
2. With several variants, choose the **Variant**: **Every variant**, or one.
3. **From units**: from how many the lower price starts, 2 to 9,999.
4. **Lower price as**: **Percentage off** (1 to 99 %), or **Price each, with VAT** typed for each country (without VAT in a store that
   sells only to businesses).
5. Press **Save**.

A product can have up to 10 price breaks. A price each you type applies only in the countries you give it for. Bundles can have price
breaks too.

### What shoppers see

- **The product page** shows a table, *Price by quantity*, with the price each from each number, such as *1 or more* and *10 or more*.
  A step that would not be cheaper than the one before is left out.
- **The cart** charges that price and says *Price for 10 or more* on the line.
- **A price break is never shown as a reduction**: no struck price and no 30-day price beside it. It is simply the price at that
  quantity.
- Product cards, lists and feeds show the price of one.

Discounts still work on top: a customer group's percentage, campaigns and discount codes come off a line a price break priced.

> [!NOTE]
> Prices by quantity are for buying once, not for subscriptions. A product with purchase options shows no table.

## How shoppers choose a quantity

Open **Settings** and choose [Prices and quantity](/admin/{store}/settings/prices). Under **Quantity on product pages**, choose:

- **− and + beside the number** (the usual choice): shoppers tap to choose how many, or type the number.
- **A number box**: shoppers type how many.
- **Hidden**: Add to cart puts in one, or the smallest quantity the product is sold in. Shoppers change it in the cart.

Press **Save**. The cart always has − and +. The buttons follow the rule: + goes up by the multiple, and a number the rule does not allow
becomes the nearest one it does.

Appointments, stays, rentals, gift cards and items sold one at a time never show a quantity.

### On one product layout

A product layout's **Buy** part can choose otherwise under **How many to buy**: for example, a box on a wholesale layout. Open it under
[Product layouts](/admin/{store}/product-layouts); see [The page builder](/docs/owners/website/the-page-builder).

## Rules and prices for customer groups and companies

A price list can give its own buyers their own price breaks and quantity rules. Open [Price lists](/admin/{store}/price-lists) under
Customers, then a list:

- **Price by quantity for these buyers**: from a number of units, a percentage off the market price or a price with VAT in a currency.
  The lowest price a buyer can get wins.
- **How many at a time for these buyers**: **At least**, **At most** and **In multiples of**, used for the list's buyers in place of the
  variant's own rule. Leave a row empty to use the variant's own.

See [Companies and B2B](/docs/owners/customers/companies-and-b2b).
