---
title: Shipping rates
summary: Set a flat shipping price for each country, make it free above a basket value, and add shipping methods priced by weight or basket value, with zones and profiles.
track: owners
section: shipping
kind: how-to
areas: [shipping, markets]
features: []
plans: []
admin: /admin/{store}/settings/shipping
order: 10
checked: 2026-11-04
sources: [D237, D402]
---

## Start with a flat rate

Open **Settings** in the menu and choose [Shipping](/admin/{store}/settings/shipping), under Selling. Under **Flat rate per country**,
each country you sell to has a row:

1. Type the **Shipping price**, VAT included.
2. To make shipping free from a certain basket value, type it under **Free from basket value**. Leave it empty for *Never free*.
3. Press **Save flat rates**.

That is all many stores need. The flat rate is the default price, and what is charged when none of your shipping methods fits the
basket. Subscriptions, subscription boxes and draft orders always pay it.

> [!IMPORTANT]
> A country with no flat rate has no shipping of its own: a basket that no method prices there cannot be bought. Keep a flat rate for
> every country, even when you add methods.

Every price on Shipping includes VAT, in the country's currency.

## Add shipping methods

Methods are named ways of shipping in one country, such as Standard and Express, each with its own price.

1. Under **Methods**, press the country. [Shipping methods](/admin/{store}/settings/shipping/methods) opens for it.
2. Press **Add a method**.
3. Under **The method**, write the **Name, as shoppers see it**, and if you like a transit time in days and a **Free above** value.
4. Under **Rates**, choose how it is priced: **Flat**, **By weight** or **By basket value**.
5. Keep **Offered at checkout** ticked and press **Add method**.

Shoppers see the methods that price their basket, cheapest first, with the transit time when you gave one. When no method prices the
basket, the flat rate is charged. When two methods cost the same, the one higher in your list is shown first: use **Up** and **Down** to
change the order.

### Prices by weight or basket value

A method priced **By weight** or **By basket value** has tiers. Each tier counts from its **From** up to, but not including, its **Up
to**; leave the last tier's **Up to** empty for *and above*. Tiers follow each other with no gap. Weights are in kilograms, like 2 or
0,5. Press **Add a tier** for another.

**Free above** compares the basket's value as shown, before discounts.

Goods without a weight of their own count the **Default weight** per unit, 500 g until you change it at the bottom of Shipping. The
hub warns when variants have no weight.

## Zones: other prices for parts of a country

A zone is a group of postal codes inside a country, so a method can cost more to some places than to others.

1. Open Shipping and press **Zones**, then choose the country.
2. Under **Add a zone**, write a **Name** and the **Postal codes and prefixes**: codes like 0150, or prefixes like 01* for every code
   starting with 01, separated by commas, spaces or lines. A range is written as prefixes: 015* to 019* for 0150 to 0199.
3. Press **Add zone**.
4. Open each method and give the zone a rate. A method with no rate for a zone is not offered there.

Codes in no zone are *Rest of country*. A code belongs to the zone with the most specific pattern. **Check a postal code** shows which zone
a code falls in and which methods have a rate there.

At checkout, shoppers in a country with zones give their postal code before they pay, and the cart shows *From* a price until they do.
If the delivery address turns out to have another postal code than the one priced, the order says so, so you can check the delivery
before sending; the charge is never changed. In the Orders list, **Fulfilment** in the filters finds these orders with *Postal code
differs from the address*.

## Profiles: own rates for some products

A profile groups products that ship differently, such as bulky or fragile goods, so they get their own rates on each method.

1. Open Shipping and press **Profiles**.
2. Under **Add a profile**, write a **Name** and press **Add profile**.
3. Choose its products, by searching, and press **Save profile**. You can also choose a product's profile in the product editor.
4. Open each method and give the profile a rate.

Every other product is *General*. A basket with products from several profiles is offered a method only when each of them has a rate on
it, and pays the sum of their rates.

## More options

### Change delivery prices with checkout rules

A [checkout rule](/admin/{store}/settings/checkout) can **Price delivery options** when the basket matches what you choose: its country,
value or weight, its products, categories or tags, or the customer's group. The options it names become **Free**, or cost **A percentage
more or less** (from −100 to 300) or **An amount more or less**, written in each currency your store shows.

- A negative number lowers the price. A delivery never costs less than nothing, and one that is free above a basket value stays free.
- Other rules can hide a delivery option, rename one or show some first.
- New rules are saved off: switch one on when it is right. The cart and the checkout then charge the same, and the order keeps the rule.

Open **Settings** and choose **Checkout rules**, under Selling.

### Needs a look

The top of Shipping lists what needs your attention under **Needs a look**: a country with methods but no flat rate, zones that no
method prices for *Rest of country*, subscriptions without a flat rate to pay, and variants without a weight.

### Pickup, local delivery and carriers

- [Pickup and local delivery](/docs/owners/shipping/pickup-and-local-delivery): let customers collect, or deliver nearby yourself.
- [Shipping carriers](/docs/owners/shipping/carriers): offer Posten / Bring, PostNord, Porterbuddy or Helthjem at checkout.
