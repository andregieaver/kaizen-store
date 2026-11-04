---
title: Discount codes and campaigns
summary: Give money off with a code shoppers type, or with a campaign that needs no code, and choose who gets it, when, and how the two work together.
track: owners
section: marketing
kind: how-to
areas: [marketing]
features: []
plans: []
admin: /admin/{store}/discounts
order: 10
checked: 2026-11-04
sources: [D31, D114, D115, D116, D299, D367, D380, D392]
---

## A code or a campaign?

- **A coupon** is a code shoppers type in the cart or at checkout. Only people who have the code get the discount, so it suits a
  newsletter, a partner or one loyal customer.
- **A campaign** needs no code. It runs for a time, starts and stops by itself, and your product pages announce it.

Both take their money off in the cart. Neither changes a product's price: the product page shows the price as it is, with a running
campaign's offer beside it. A struck-through earlier price appears only when you lower the price itself, and it is always the lowest
price of the last 30 days (see [Prices](/docs/owners/products/prices)).

## Make a coupon

1. Open **Marketing** in the menu and choose [Coupons](/admin/{store}/discounts). Press **New coupon**.
2. Type the **Code shoppers type**: 3 to 40 letters, digits, - or _. Shoppers can type it in capitals or not.
3. Under **What it gives**, choose **A percentage off**, **An amount off** or **Free shipping**. An amount is given in each country's
   currency; leave a country empty and the code does not work there. A code never takes off more than the items cost.
4. Under **What it applies to**, keep **Everything in the store**, or choose **Only some products, categories or tags**. A category
   takes in the products in its subcategories.
5. Press **Save code**.

The list shows how often each code was used, what it has given, and whether it is *Active*, *Starts later*, *Ended*, *Used up* or
*Switched off*.

### Limits on a code

You can set any of these, or none:

- **Minimum number of items (optional)**: of what the code applies to, bought once (not subscriptions).
- **Minimum order (optional)**: what the items must come to before shipping, in each country's currency.
- **Starts (optional)** and **Ends (optional)**, in Norwegian time. Without dates, the code works while **Switched on** is ticked.
- **Uses in all (optional)**: every order that got the code counts unless it is cancelled, so a cancelled checkout gives its use back.
- **Once per customer**: shoppers must sign in to My account to use it, so the store knows who they are.

A percentage code on a subscription lowers only the first payment, unless you tick **Keep the discount on every renewal of a
subscription**. A free shipping code on a subscription covers its first delivery.

### Who can use it

Under **Who can use it**, choose **Every shopper who has the code**, or limit it:

- **Only customers in these groups**, when your store has [customer groups](/admin/{store}/customer-groups);
- **Only these customers**: their emails, one per line, at most 100, each a customer of your store;
- **People in a segment**, when you have [segments](/docs/owners/marketing/email-marketing). Whether a shopper is in it is worked out
  each time the code is used.

A limited code needs the shopper signed in to My account. A guest is asked to sign in.

### Single-use codes

To give everyone their own code, tick **Hand out single-use codes instead** and save. The code you typed is then only its name. On the
code's page, under **Single-use codes**:

1. Say **How many** (up to 10,000 at a time, 100,000 in all for one code) and, if you like, a **Prefix**.
2. Press **Make codes**. Each is eight characters, without characters that look alike, such as 0 and O.
3. Press **Download the codes** for a CSV file of the codes, whether each was used, and when it was made.

Each single-use code works for one order. **Uses in all (optional)** and **Once per customer** do not apply to them.

## Start a campaign

1. Open **Marketing** and choose [Campaigns](/admin/{store}/campaigns). Press **New campaign**.
2. Give it a **Name**. Shoppers see it in their cart, at checkout and on their order, so write it for them: "Summer sale".
3. Choose **What it gives** (see the table below), then what it applies to: the whole store, or chosen products, categories or tags.
4. Under **When**, set **Starts (optional)** and **Ends (optional)** if you like, in Norwegian time. Without dates it runs while it is
   switched on.
5. Press **Save campaign**.

| What it gives | What the shopper gets |
|---|---|
| **A percentage off** | For example 20 % off the chosen products. |
| **Buy more, pay for fewer** | For example 3 for 2: in every full group of three, the cheapest is free. The items can be different products. |
| **An amount off** | An amount in each country's currency, shared over the products by what each costs, optionally once those products come to an amount. |
| **Bigger discounts for buying more** | Two to five steps, by items bought or by what the basket comes to, each giving a percentage or an amount off. The highest step reached applies. |
| **Free shipping** | No shipping to pay, whichever delivery the shopper chooses, optionally over an amount. Not for subscriptions. |
| **Buy one thing, get another** | For example buy 2 shirts and get a cap free, or the cheapest at half price. The shopper puts both in the basket. |
| **A free product** | Added to the order free when the basket comes to an amount you set per country. Only goods you ship yourself, in stock, on an order that ships anyway. |

Campaigns take money off goods bought once: not appointments, stays, rentals or subscriptions. Where two campaigns apply to the same
product, it gets the one that gives the shopper more.

Product pages announce a running campaign, and product cards show its offer when it needs no amount, such as *20 % off* or *3 for 2*.
The cart tells shoppers how far they are from the next step or from an amount, and shows a free product as free.

### More campaign options

- **Orders it can go to in all (optional)**: an order counts once, however many products it took effect on. The campaign stops by itself
  when they are used up.
- **Orders for each customer (optional)**: 1 is once per customer. Shoppers must be signed in to get it; the product pages say so.
- **Where**, when you sell in more than one country: **Every country the store sells to** or **Only some countries**.
- **Who**: **Every shopper**, **Only customers in these groups** or **People in a segment**. Such a campaign is not announced on product
  pages, which are the same for everyone.
- **Also apply on top of other campaigns**, for a percentage, buy more pay for fewer, and bigger discounts for buying more. Normally a
  product gets one campaign; with this on, this one also comes off what the other left, in the order the campaigns were made.

## Codes and campaigns together

What comes off, in order: campaigns, a customer group's discount, a friend's welcome discount from the [referral
program](/docs/owners/marketing/loyalty-and-referrals), codes, and bonus credits last. Each counts what the one before it left.

**Several codes.** A shopper can put up to five codes on one order. Under **Using it with other codes**, tick the kinds of code this one
may be used with: **Codes on chosen products, categories or tags**, **Codes on everything** or **Free shipping codes**. Two codes are
used together only when each allows the other. Nothing is ticked at first, so a code works alone. Where two cannot be used together, the
shopper gets the one that takes more off, and the cart says why the other was left out.

**A code beside a campaign.** A code's **Can be used with campaigns** and a campaign's **Can be used with discount codes** are both on
at first: the code comes off what the campaign leaves. Turn either off, and a basket gets the code or the campaigns, whichever gives the
shopper more, and the cart says which was left out.

> [!NOTE]
> Nothing comes off a gift card, and a gift card in the basket does not count towards a minimum or an amount. See [Gift
> cards](/docs/owners/marketing/gift-cards).

## Change, switch off or delete

Open a code or a campaign to change it, or press **Switch off** beside a campaign in the list. Their pages have **Delete this code** and
**Delete this campaign**. Orders already placed keep what they got, whatever you change or delete.

> [!TIP]
> A [cart reminder](/docs/owners/marketing/email-marketing) can carry a code, and a newsletter form can email each new subscriber a
> single-use code.
