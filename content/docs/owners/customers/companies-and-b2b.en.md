---
title: Companies, customer groups and price lists
summary: Sell to businesses with prices shown without VAT, give groups of customers a fixed discount or their own prices, and let companies buy with employees, locations and approvals.
track: owners
section: customers
kind: how-to
areas: [customers, tax, payments]
features: [business]
plans: []
admin: /admin/{store}/companies
order: 20
checked: 2026-11-04
sources: [D63, D108, D178, D293, D321, D323]
---

## Choose who you sell to

To sell to businesses, an owner switches on **Sell to businesses** under **Settings**, [Features](/admin/{store}/settings/features).
Then open **Settings**, [Company](/admin/{store}/settings/company), and under **Customers** choose what **The store sells to**:

- **Consumers**: prices are shown and entered with VAT.
- **Businesses**: prices are shown and entered without VAT, and every order takes a company name and organisation number.
- **Consumers and businesses**: shoppers choose *Private* or *Business* in the header, and businesses see prices without VAT. Tick
  **Ask first-time visitors** to ask each new visitor which they are.

Press **Save customers**. Only owners can change this.

> [!IMPORTANT]
> Every order is charged VAT, also when a business buys: businesses only *see* prices without it. See
> [VAT](/docs/owners/markets-and-tax/vat).

In a store selling to both, each product can be for **Everyone**, **Private shoppers only** or **Businesses only**: choose it under
**Customers** in the product editor. Only business buyers can put a business-only product in the cart, and an order with one needs the
company's name and organisation number. Organisation numbers are checked for Norway, Sweden, Denmark and Finland.

## Give a group a fixed discount

A customer group gives its customers a fixed percentage off, for example *Wholesale* at 10 %.

1. Open **Customers** in the menu and choose [Customer groups](/admin/{store}/customer-groups).
2. Under **New group**, fill in **Name** and **Discount, percent**, and press **Make group**.
3. Open the group and add people under **Add a customer by email**. Someone with no account gets one made, and the discount waits for
   them to sign in. You can also choose the **Customer group** on a customer's own page.

The discount comes off everything bought once, before any coupon. It does not apply to subscriptions, sign-up fees or shipping. A
customer who is also in a company gets the better of the two discounts. Switch a group off on its page to stop its discount at once;
orders already placed keep what they got.

## Company accounts

A company account lets a business buy with several people: a main account and its employees, all with the company's discount. It needs
**Sell to businesses** switched on.

1. Open **Customers**, [Companies](/admin/{store}/companies), and fill in **New company**:
   - **Company name**, and its **Organisation number** if you have it: with it, the company's accounts buy as a business with the
     number filled in.
   - **Customer group**: the discount the company gets.
   - **Employees get, percent of the discount**: 100 gives them all of it, 50 half. The main account always gets all of it.
   - **Most accounts**: how many people the company may have, invitations waiting included.
   - **Main account, email**: the person who invites the company's employees.
2. Press **Make company**.

The main account invites employees by email from **My account**, **My company** in your store, up to 20 addresses at a time and 50 a
day. Each invitation opens a page with a button, and nothing changes until it is pressed. You can also send invitations yourself from
the company's page with **Invite employees as the store**, and **Withdraw** one that is still open. An account belongs to one company at
most.

Switch a company off on its page and its accounts get no discount and it invites no one. A company can be deleted only when it has no
accounts.

## More options

### Locations, buyers and approvals

On a company's page you can add **Locations** (up to 50), each with a shipping and a billing address. Under **Who buys here**, give
each member a role: **Orders**, or **Orders and approves**. Members choose their location at checkout. The main account approves at
every location. A company with no locations buys as before.

Under **Buying rules**:

- Tick **A PO number is required on every order** to make buyers type their purchase order number. It is kept on the order, its
  invoice and credit notes, and the order search finds it.
- Set an **Approval limit**. An order over it, from someone who only orders, waits up to seven days for an approver. No payment is
  taken while it waits. The approver finds it under **Orders to approve** on **My company**; once approved, the buyer pays and the order
  is sent. An order declined, or not decided in time, is cancelled. Approvers and the buyer are emailed.

Press **Save buying rules**.

### Price lists

A price list gives customer groups and companies prices of their own.

1. Open **Customers**, [Price lists](/admin/{store}/price-lists). Under **New price list**, type a **Name** and, if you like, a
   **Percentage off the market price (optional)**. Press **Make price list**.
2. On the list's page, choose **Who it is for**: customer groups, and companies (which need **Sell to businesses**). Press **Save who it
   is for**.
3. Choose **What the percentage reaches**: categories or products. With nothing chosen it reaches every product.
4. Add **Fixed prices** if you want them: find a product, then type a price with VAT for a variant in a currency of your countries.

A buyer pays the lowest price their lists give, never more than the shop's own price, and sees it as *Your price*, not as a reduction.
A line priced by a list takes no group discount on top. Lists price goods and appointments bought once, never a subscription, a stay or
rental, or a gift card. Orders already placed keep the prices they were charged.

A price list can also hold **Price by quantity for these buyers** and **How many at a time for these buyers**, which work as a product's
own [price breaks and quantity rules](/docs/owners/products/quantity-rules-and-price-breaks) do, but only for the list's buyers.

### Products only some buyers see

Tick **Only these products for these buyers** in a price list's settings. The products and categories chosen under **What the
percentage reaches** are then offered only to the list's buyers, on **Your catalogue** in their account. Everyone else does not see
them anywhere in the shop. With nothing chosen, nothing is hidden.

### Payment terms

On a company's page, under **Payment terms**, choose **15 days**, **30 days** or **60 days** and, if you like, a **Credit limit**: what
the company may owe at once. Press **Save terms**. The company's accounts can then choose *Pay by invoice* at checkout for goods bought
once: the order is confirmed at once and the invoice is due after the days you chose. Reminders go three days before the due day and
the day after. See [Invoices and credit notes](/docs/owners/orders/invoices-and-credit-notes).
