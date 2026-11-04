---
title: Payment methods
summary: See which payment methods your checkout offers, switch one off for a country, and let shoppers pay with a wallet from the product page or the cart.
track: owners
section: payments
kind: how-to
areas: [payments, markets, customers]
features: []
plans: []
admin: /admin/{store}/settings/payments
order: 20
checked: 2026-11-04
sources: [D291, D293, D357, D373, D387]
---

## What shoppers can pay with

Stripe shows each shopper the methods that suit their country and currency, among those that are on for their country. Kaizena Flow
asks Stripe for these methods on your account, and they all start switched on:

| Method | Where |
|---|---|
| Cards, Apple Pay and Google Pay | Everywhere, always on |
| Klarna | Most of Europe |
| Link | Everywhere |
| MobilePay | Denmark and Finland |
| iDEAL | The Netherlands, in euro |
| Bancontact | Belgium, in euro |
| EPS | Austria, in euro |
| Przelewy24 | Poland |
| BLIK | Poland, in złoty |
| SEPA Direct Debit | Euro countries |

A method Stripe has not made active on your account is never shown to shoppers, whatever is ticked. Stripe's other methods are managed in
your Stripe Dashboard, linked from the same card.

## Switch a method off for a country

1. Open **Settings** in the menu and choose [Payments](/admin/{store}/settings/payments), under Selling.
2. Under **Payment methods**, the table has a column for each country you sell to. Untick a method in a country's column to leave it out
   of that country's checkout.
3. Press **Save**. New checkouts offer the methods that are ticked.

Cards cannot be switched off: their row says *Always*. Only owners can change the table.

### What Stripe says of each method

The **At Stripe** column shows each method's state on your account: *Active*, *Stripe is checking*, *Requested*, *Not available* or *Not
read yet*. *Not available* comes with Stripe's reason, such as *Stripe does not offer it in your country*. The table reads your live
account once you have one, and your test account before that.

### Payments that take days

With SEPA Direct Debit the money arrives a few days after the order. The order waits with its stock held, for up to 21 days, until Stripe
says the money has come; the order is then paid. If the payment fails, the order is cancelled and its stock released. The order in your
admin and the shopper's order page both say it is waiting.

### Subscriptions and subscription boxes

Subscriptions take only the methods Stripe allows for repeat payments, such as cards and SEPA Direct Debit. Subscription boxes take cards.

### MobilePay

MobilePay is offered to shoppers in Denmark and Finland once Stripe has made it active on your account. Switch it off for a country as
any other method. A MobilePay payment is named as such on the order, and a refund goes back through Stripe like any other.

## Wallets and express checkout

Apple Pay, Google Pay, Link and Klarna show only on web addresses registered on your Stripe account. Kaizena Flow registers each address
your shoppers pay on. The **Wallets and express checkout** card on Payments shows each wallet's state on your account and on each
address: *Active*, *Not active*, *Switched off*, *Not registered* or *Not read yet*.

If a wallet is not active on an address, press **Check again**: it registers any address that is missing and reads Stripe's answer
again. Only owners can press it.

### The express button

Shoppers see **Express checkout** on product pages and in the cart, with a **Pay with a wallet** button for the wallets their device
offers. On a product page, the button puts the chosen product in the cart and pays for the whole cart; it says so when the cart holds
more. The order goes through your checkout as any other, so the price, VAT, delivery, discounts and your terms are the same.

It is offered for goods sent by post, bought once and in stock. It is not offered:

- for downloads, subscriptions, bookings, gift cards and hosts' listings, which need answers a wallet cannot give;
- to shoppers buying for a business;
- to shoppers who are not signed in, when your store requires an account;
- when your checkout asks questions of its own (checkout rules);
- when your store takes payments through Mollie.

### Klarna's line under prices

Where Klarna is active on your Stripe account and on for the country, product pages and the cart show Stripe's line about paying with
Klarna under the price, in the countries and currencies Stripe's line supports. To remove it for a country, untick Klarna there.

## More options

### Leave a method out for some baskets

A [checkout rule](/admin/{store}/settings/checkout) can **Leave payment methods out** when the basket matches what you choose: its
country, value or weight, its products, categories or tags, or the customer's group. Cards are always offered. Open **Settings** and
choose **Checkout rules**, under Selling.

### Pay by invoice for companies

With **Sell to businesses** switched on under Settings, Features, a company in **Customers**, **Companies** can have **Payment terms**
of 15, 30 or 60 days and an optional **Credit limit**: what it may owe at once. Its accounts then see *Pay by invoice* at checkout,
beside paying now, for goods bought once.

The order is confirmed at once, and its invoice is due after those days. It counts as a sale only when it is paid. The customer pays from
their order page, or you record money paid outside Kaizena Flow on the order, all at once or in parts. Reminders go three days before the
due day and the day after. [Companies and B2B](/docs/owners/customers/companies-and-b2b) has the rest.
