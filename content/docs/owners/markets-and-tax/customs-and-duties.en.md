---
title: Duties and import VAT
summary: For each country outside your customs area, choose whether your customer pays duties and import VAT to the carrier on delivery, or with the order at checkout.
track: owners
section: markets-and-tax
kind: how-to
areas: [tax, shipping, settings]
features: []
plans: []
admin: /admin/{store}/settings/customs
order: 40
checked: 2026-11-04
sources: [D343, D157]
---

## When it applies

Goods that cross a customs border may owe duties and import VAT in the country they arrive in: for example goods sent from Norway to an
EU country. Goods sent within one country, or between two EU countries, cross no customs border, and nothing here applies to them.

Kaizena Flow works out which of your countries are across a border from where your goods are sent from: **Goods are sent from** on
[Tax](/admin/{store}/settings/tax), or else your store's country. See [VAT](/docs/owners/markets-and-tax/vat).

> [!IMPORTANT]
> Every amount here is an estimate from Kaizena Flow's rates table, each rate with its source. Customs decides what is due. This is not
> customs advice.

## Choose who pays

Open **Settings** in the menu and choose [Duties and import VAT](/admin/{store}/settings/customs), under Selling. It lists each of your
countries that your goods cross a border into. For each, choose under **Who pays duties and import VAT** and press **Save**:

- **Your customer pays the carrier on delivery (DAP)**: the default. Nothing extra is charged at checkout. The cart and the order show
  an estimate of what the carrier may collect, before the carrier's own fees, or say that it cannot be estimated.
- **Collected at checkout with the order (DDP)**: your customer pays an estimate of the duties and import VAT with the order, and you
  settle with customs. The carrier should not ask for them on delivery.

If none of your countries is across a border, the page says there is nothing to choose.

## What shoppers see

- **With DAP**, the cart, the order page and the confirmation email say that any duties and import taxes are paid to the carrier on
  delivery, with our estimate where there is one.
- **With DDP**, the cart has a row *Duties and import taxes*, marked as an estimate, and the order page and the confirmation email say
  what was paid at checkout.

## Before you choose DDP

DDP needs an estimate for everything in the cart. Where there is none, the order cannot be paid:

- **Every product sent there needs its HS code.** In the product's editor, open **Barcode, cost, weight, content and customs** on each
  variant and fill in **Customs tariff (HS) code** and **Country of origin**. While a country is on DDP, the page says how many products
  have no HS code. A shopper with such a product in the cart is asked to remove it.
- **The rates table must cover the country.** Where it does not yet, the page says so under the country, and a checkout with duties
  collected cannot be paid.
- **The rates table must have a rate for your goods.** The table is still small, so many goods have no rate yet. The shopper is then
  told that duties cannot be worked out and to contact you.

> [!TIP]
> Before you switch a country to DDP, put your products in a cart for that country. If the cart can estimate what the carrier may
> collect, checkout can collect it.

## How the money works with DDP

- The duties are charged beside the order's total, as a line of their own at payment. They are not on the invoice, and not in your VAT
  reports or sales figures.
- Kaizena Flow takes no fee on them, and a gift card never pays them.
- Subscriptions, stays and rentals listed by outside hosts, a part paid at the venue, and orders on payment terms always stay DAP,
  whatever you choose. Draft orders and exchanges never collect duties.

## More options

### Collecting the country's VAT at checkout

For a country outside the EU, tick **I am registered to collect this country's VAT at checkout (such as VOEC in Norway)** if you are.
The estimate then follows that scheme's rules. For EU countries, your IOSS registration on the Tax page decides it instead.

### Booking parcels across a border

A carrier booking across a customs border carries the customs lines of what is in it (HS code, origin, value, weight). Without them,
Kaizena Flow refuses the booking before the carrier is asked. With Bring, the lines are sent to Bring's customs service. See
[Carriers](/docs/owners/shipping/carriers).
