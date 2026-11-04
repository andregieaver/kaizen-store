---
title: Emails and notifications
summary: Choose which emails customers get about their orders and returns, write them in your own words, choose who on the team is told what, and see every email the store sent.
track: owners
section: team-and-settings
kind: how-to
areas: [settings, orders, integrations]
features: []
plans: []
admin: /admin/{store}/settings/notifications
order: 30
checked: 2026-11-04
sources: [D26, D101, D238, D348, D361]
---

## The emails your customers get

Your store emails customers by itself when something happens to their order or return. The emails go out in your store's name, in the
order's language, and replies go to the store's contact address under **Settings**, **Company**.

Open **Settings** and choose [Notifications](/admin/{store}/settings/notifications), under Selling. The emails are listed in three
groups: **Orders**, **Pickup and local delivery** and **Returns**. Each says when it is sent and whether it is **On**, **Off**,
**Always on** or **Fixed**. Press **Switch off** or **Switch on** to change one.

- **Always on**, because the law or the money needs them: *Order confirmation*, *Subscription renewal*, *Order change*, *Return
  approved*, *Return declined*, *Exchange: payment asked* and *Exchange done*.
- **Fixed**, always sent and never changed: *Withdrawal acknowledgement*, kept as evidence, and *Gift card*, the only place a card's code
  is given.
- **Off until you switch them on**: *Out for delivery (carrier)* and *Delivered (carrier)*.
- **On until you switch them off**: every other email, such as *Order sent*, *Refund* and *Order cancelled*.

Switching an email off also unticks **Notify the customer** where staff send, refund or cancel an order. With *Refund* off, the credit
note for a refund still goes out.

> [!NOTE]
> The pickup and local delivery emails are sent only once your store offers pickup or delivery by your own driver. See
> [Pickup and local delivery](/docs/owners/shipping/pickup-and-local-delivery).

## Write an email in your own words

1. Press **Edit** beside the email, and choose the language.
2. Fill in the **Subject**, the **Heading** and the **Text**. A field left empty uses the standard text. A blank line starts a new
   paragraph.
3. Add **Placeholders** such as `{order_number}` or `{customer_first_name}`: they are filled in for each order.
4. Press **Preview** to see it with a made-up order, or **Send a test to me** to get it in your own inbox.
5. Press **Save**.

Your words replace only the subject, the heading and the first text. Kaizena Flow always adds the order lines, totals, the VAT
statement, the invoice link, tracking, pickup details and the right of withdrawal, in the order's own language and currency. Web
addresses are not allowed (the email's buttons link to the order), and an email about an order must not carry offers: that would be
marketing. **Use standard text** takes your words away again. Text you write yourself is your responsibility.

People whose role can view **Settings** but not change it can read the emails but not edit them.

## Tell your team

Owners choose who on the team is emailed. On **Notifications**, press [Staff alerts](/admin/{store}/settings/notifications/staff).
Tick, for each person or the store's contact address, which alerts they get:

| Alert | Sent when |
|---|---|
| New order | An order is paid. |
| Return requested | A customer asks to return something. |
| Refund overdue | A refund is late. |
| Low stock | Stock runs low. |
| Dispute | A payment is disputed. |
| Payment overdue | An order on payment terms is not paid in time. |
| Automation | One of your automation rules says to tell staff. |
| Briefing | Daily or weekly, with the store's figures. |
| Analytics alerts | Once a day, when the analytics find something. |

A box is offered only where the person's role may read what the email shows. Staff emails name the order or return and what was bought,
never the customer's name, email address, phone number or address. Until you save the page, owners get new orders, return requests,
low stock, disputes and overdue payments, and overdue refunds go to the store's contact address.

Under **Briefing**, choose **How often** (**Daily (yesterday)** or **Weekly (the last seven days)**), the day and the hour. Under
**Analytics alerts by email**, choose how much you want to hear. Press **Save**, and **Send a test** to see one in your inbox.

## See every email that was sent

Open **Orders** in the menu and choose [Emails](/admin/{store}/emails). Each email shows who it went to, its subject and whether it
arrived: *Sending*, *Sent*, *Delivered*, *Failed*, *Bounced (address does not take email)* or *Marked as spam by the recipient*. Open
one to read it exactly as the customer got it. An order's page and a customer's page list their own emails too.

## More options

### Notifications on your phone

The admin can be added to your phone's home screen like an app. On **Your account**, under **Notifications on this device**, press
**Turn on** beside a store and allow notifications when the browser asks. You then get a notification on that device for each new
order: its number and total only, nothing about the customer. On an iPhone or iPad, add Kaizena Flow to the Home Screen first (Share,
then Add to Home Screen). Only stores whose orders you may read are listed, and **Devices that get them** lets you **Remove** one.

### Slack

Owners can have the store post to a Slack channel when an order is paid, sent, cancelled or refunded, and for new customers and
subscriptions. Open **Settings**, [Integrations](/admin/{store}/integrations), choose Slack and press **Add to Slack** (Slack asks which
channel), or paste a webhook address you made yourself. Press **Send a test** to see a message arrive. Messages name the shopper and what
they bought, never their email or address, and everyone in the channel sees them: make sure your agreement with Slack covers personal
data.
