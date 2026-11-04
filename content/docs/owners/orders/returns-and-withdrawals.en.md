---
title: Returns and withdrawals
summary: How customers withdraw from a purchase within 14 days, how you take the goods back, inspect them and refund in time, and how to set your return rules and labels.
track: owners
section: orders
kind: how-to
areas: [returns, orders]
features: [shop]
plans: []
admin: /admin/{store}/returns
order: 40
checked: 2026-11-04
sources: [D153, D239, D238, D174]
---

## Withdrawals and return requests

[Returns](/admin/{store}/returns) holds two kinds of return:

- **Withdrawal**: a consumer in the EU may change their mind about most purchases within 14 days, without giving a reason. You cannot
  refuse it, and the refund is due within 14 days of being told.
- **Return request**: a return inside your own longer window, if you offer more than 14 days, or one the law does not give. You may
  approve it or decline it.

Returns are part of the online shop, switched on under Settings, Features.

## How a customer withdraws

Every footer, order page and order email links to your store's withdrawal page. The customer gives the order number and their email,
chooses the items, presses **Withdraw from contract here** and then confirms it. They are never asked for a reason.

The customer is emailed an acknowledgement at once, and the withdrawal appears in Returns. If that email fails, the withdrawal still
stands: the return says **The acknowledgement was not sent**, and **Send the acknowledgement again** sends it.

### When the 14 days start

The 14 days count from the day the customer received the goods, from the last parcel when they came in parts. Until that day is
recorded, the customer can still withdraw. With Posten / Bring, it is recorded from the tracking. Otherwise, under **Returns and
withdrawals** on the order, press **Mark the goods as received by the customer** and give the day.

## Work a return

Open **Returns** in the menu. The queue shows what is open, what is **To approve** and what is **Past the refund deadline**. Open a return
and follow its steps:

1. **Approve or decline**, for a return request only. Press **Approve the return**, with the return address and instructions, or
   **Decline the return** with the reason. The customer is emailed either way. A withdrawal is approved by itself.
2. **The goods.** Press **Mark as on their way** when the customer has sent them, and **Mark as received** when they arrive. The customer
   is emailed that they arrived.
3. **Inspect the goods.** For each line, choose its **Condition**, how many go back in stock, and any deduction for diminished value
   with what it is for. Press **Save the inspection**.
4. **Refund.** The return shows how the refund is worked out. Press **Refund** with the amount shown, and the money goes back to the
   customer's payment through Stripe.
5. **Close** the return when it is done.

> [!IMPORTANT]
> A deduction is only for handling beyond what was needed to see what the goods are and that they work, as in a shop. It is never more
> than the goods are worth. You can raise a withdrawal's refund, with a reason, but never lower it below the working.

### How the refund is worked out

What the customer paid for the returned goods, after every discount, less the deduction you set when you inspected them. When the whole
order is withdrawn, the original standard delivery is added. When the customer pays return shipping, it is taken off.

### When the refund is due

By default you may wait until the goods are back, or the customer shows they sent them, but never past the deadline: 14 days after you
were told of the withdrawal. The queue marks returns that are due soon or overdue.

If the customer withdrew before anything was sent, there is nothing to send back: leave those items out of the parcel, and the refund is
due as soon as you have checked it.

## A withdrawal by email, letter or phone

A clear message that the customer withdraws counts too. Open the order, and under **Returns and withdrawals** press **Register a
withdrawal the customer made outside the form**. Say how and when they told you and what they withdraw from. It is recorded as the form
would record it, and the customer is sent the acknowledgement.

## Your return rules

Owners set them under [Settings, Returns](/admin/{store}/settings/returns). The defaults are the law's.

| Setting | What it does |
|---|---|
| **Return window (days)** | 14 to 100. Days beyond 14 are your own offer: customers send a return request you may decline. |
| **Transit allowance (days)** | 0 to 14. Your guess of how long delivery takes, shown as an estimate while no receipt day is recorded. |
| **Return shipping** | The customer pays (the default, if you tell them before they buy), or the store pays. Each order keeps the choice it was placed under. |
| **When refunds are made** | When the goods are back or shown to be sent (the default), or as soon as the customer asks. |
| **What can come back** | Also accept goods the law excludes, and return requests from companies, as requests you may decline. |
| **Where goods are sent back** | Empty means your store's postal address. |
| **Instructions for customers** | How to pack and send the goods back, in each of your languages. Practical help, not legal promises. |

Goods the law excludes, such as made-to-order goods or opened hygiene products, are marked in each product's editor under **Right of
withdrawal**.

## Return labels

With Posten / Bring connected (see [Carriers](/docs/owners/shipping/carriers)), choose it as the **Carrier** under **Return labels** in
Settings, Returns, with its **Return service**. Tick **Book withdrawals' return labels automatically**, off by default, to have a label
booked for each withdrawal within a few minutes.

To book one by hand, open the return, and under **Return shipping** press **Book a return label with Posten / Bring**. The customer gets
an email with a button to print it, and finds it on their return's page.

When the customer pays return shipping, nothing is taken off when the label is booked. At the refund, press **The parcel came with the
label: take off …** only if it came back with that label: its cost, never more, is then taken off. A test label is never taken off.

You can also paste a link to a label in the return instructions, or let the customer send the goods themselves.

## More options

- **Exchanges** let the return's credit pay for other goods instead of money back: see
  [Refunds, cancellations and exchanges](/docs/owners/orders/refunds-and-exchanges).
- A return request the customer no longer wants is cancelled with **Cancel the return**. A withdrawal is never cancelled: if the goods
  never come back, close it without a refund and say why in the note.
- Who on the team is emailed about new return requests and overdue refunds is chosen under Staff alerts:
  see [Notifications](/docs/owners/team-and-settings/notifications).
