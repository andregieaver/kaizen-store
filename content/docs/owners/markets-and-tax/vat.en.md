---
title: VAT
summary: Record your VAT registration and number, put each product in the right VAT category, and see how VAT is charged at home, abroad and to businesses.
track: owners
section: markets-and-tax
kind: how-to
areas: [tax, settings, products]
features: []
plans: []
admin: /admin/{store}/settings/tax
order: 20
checked: 2026-11-04
sources: [D157, D65, D63, D178]
---

## How VAT works in your store

- **Prices include VAT.** The price you type for a country is what a shopper there pays. The VAT inside it is worked out at that
  country's rate.
- **Each sale is charged the VAT of the country it goes to**, on every sale to a consumer.
- **Shipping** is charged at the destination country's standard rate, unless Kaizena Flow has checked another rule for that country.

> [!IMPORTANT]
> Kaizena Flow charges VAT as described here. It is not tax advice. The Tax page ends with **Read this with your accountant**: read
> it with yours before you sell abroad.

## Record your VAT registration

Open **Settings** in the menu and choose [Tax](/admin/{store}/settings/tax), under Selling. Only an owner can open it.

1. Tick **The store is registered for VAT**.
2. Type your **VAT number**. It must be a number of your store's own country: in Norway, the nine-digit organisation number followed
   by MVA; elsewhere, starting with the country code.
3. Under **Goods are sent from**, leave the field empty if you send from your store's country. Otherwise type the two letters of the
   country, such as NO or CN.
4. Press **Save the tax settings**.
5. Under **Check the VAT number**, press **Check now**. A Norwegian number is checked in the register of business enterprises
   (Brønnøysundregistrene), any other in VIES, the EU's register. The page shows what the register found, with the registered name
   and address, so you can see that they are your company's.

Once you are registered, your VAT number is shown on the store's documents. Saving a different number clears its check: press
**Check now** again.

### What is on

The top of the Tax page, **What is on**, has one line each for **VAT registration**, **Reverse charge**, **OSS** and **IOSS**. Each
says *On* or *Off*, and what it still needs.

## Put each product in a VAT category

Most products take the standard rate, which is where a new product starts. For a product with another rate, open its editor and
choose its **VAT category** under **Tax, returns and recycling**.

| VAT category | For |
|---|---|
| **Standard rate** | Most goods and services. |
| **Accommodation** | Hotel rooms, holiday homes and camping: a reduced rate where the country has one. Offered only for stays and rentals. |
| **Exempt from VAT** | No VAT, such as health care. Check with your accountant that it applies to you. |

The list also holds the categories Kaizena Flow keeps for reduced rates, such as *Food and drink*, *Books* and *Children's goods*.

Under the field, each of your countries shows the rate the product takes there now. Where it says *no reduced rate known here: the
standard rate applies*, Kaizena Flow has no reduced rate for that category in that country, and the standard rate is charged.

## Selling to businesses

A store can sell to consumers, to businesses or to both. Switch on **Sell to businesses** under Settings,
[Features](/admin/{store}/settings/features), then choose under **The store sells to** on [Company](/admin/{store}/settings/company).

- Prices are always kept and charged with VAT. Businesses see them without VAT.
- A store that sells only to businesses enters and shows its prices without VAT.
- Businesses give their company's name and organisation number at checkout.

See [Companies and B2B](/docs/owners/customers/companies-and-b2b) for company accounts and products for businesses only.

### Reverse charge

A business in another EU country can buy without VAT when it gives a valid VAT number. The buyer then accounts for the VAT in their own
country (reverse charge). Kaizena Flow uses reverse charge only when all of these hold:

- your store is established in an EU member state, registered for VAT, and its own number has been checked valid with **Check now**;
- the buyer types a VAT number in the cart and checks it, and the EU's register says it is valid for the country the goods go to;
- goods are sent from an EU country other than the buyer's (downloads are not sent, so they do not depend on it);
- the basket holds no booking and no subscription.

Otherwise VAT is charged. If the register cannot answer, VAT is charged and the sale goes on. A store outside the EU, such as a store
in Norway, never uses reverse charge.

On a reverse-charge order the shopper's order page and confirmation say *Reverse charge*, with both VAT numbers. On the order in your
admin, the *VAT treatment* panel shows how VAT was handled and why, with what the register said.

> [!WARNING]
> A valid answer from the register says that a number is registered. It does not say that the sale is exempt: you remain responsible.

## More options: OSS and IOSS

The Tax page also records the EU's One Stop Shop registrations. Kaizena Flow files nothing: it uses them to mark orders and to make
the return data in [VAT, OSS and IOSS reports](/docs/owners/markets-and-tax/oss-and-ioss).

**One Stop Shop (OSS).** Choose your **Scheme**: **Not registered for OSS**, **Union scheme** (a store in the EU) or **Non-Union
scheme** (a store outside the EU selling services to private buyers in the EU). Then give the **Member state of registration**, the
day under **Registered on**, and for the non-Union scheme its **Non-Union OSS number**. Destination VAT is charged as before.

**Import One Stop Shop (IOSS).** For a store that sends goods from outside the EU to private buyers in the EU. Give the **IOSS
number**, any **Intermediary**, the day under **Registered on**, and tick the **Markets IOSS applies to**. A consignment of at most
150 EUR to those markets is charged the destination's VAT at checkout and marked with your IOSS number. Above 150 EUR the order is not
an IOSS sale, and the buyer may pay import VAT at the border: see [Duties and import VAT](/docs/owners/markets-and-tax/customs-and-duties).

Press **Save the tax settings** when you are done.
