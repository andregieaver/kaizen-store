---
title: "Email marketing: subscribers, broadcasts and automatic emails"
summary: Build a list of people who asked for your emails, group them into segments, send them broadcasts, let automatic emails go by themselves, and remind shoppers about carts they left.
track: owners
section: marketing
kind: how-to
areas: [marketing, customers]
features: []
plans: []
admin: /admin/{store}/broadcasts
order: 20
checked: 2026-11-04
sources: [D33, D295, D296, D297, D298, D304, D314, D352, D368]
---

## Who gets your emails

Your marketing emails go only to people who asked for them: the people on your [Subscribers](/admin/{store}/subscribers) list who want
your emails. They join in three ways:

- a **Newsletter** sign-up on a page of your site, added in the [page builder](/docs/owners/website/the-page-builder);
- a box at checkout, which is never ticked for them;
- the switch in My account.

An address someone types joins once its owner confirms it from a link we email them. In a newsletter form this is **Confirm the
address first (double opt-in)**, which is on unless you switch it off; keep it on, as it proves the consent. A signed-in customer
with a confirmed email joins at once. Staff never add anyone.

Every marketing email has a link to leave, and the unsubscribe button in people's mail apps works too. An address that does not exist,
or whose owner marks an email as spam, leaves the list by itself.

On **Subscribers** you see each person's status, where they joined, the words they agreed to and when. Open one for their history, and
press **Unsubscribe** for someone who asks you to take them off. The store's owners can **Export** the list.

## Send a broadcast

A broadcast is an email with news or offers, written once and sent to everyone on your list, or to a segment.

1. Open **Marketing** in the menu and choose [Broadcasts](/admin/{store}/broadcasts). Press **New broadcast**.
2. Under **Start from**, choose **Blank** or one of the templates: **News**, **New products**, **An offer**, **The season** or
   **Thank you**.
3. Give it a **Name**, which only you see, and choose **Who gets it**: **Everyone who wants your emails**, or **The people in a segment
   who want your emails**.
4. For each of your languages, write the **Subject**, an optional **Preview line** and what it says, from parts: **Heading**, **Text**,
   **Button**, **Picture**, **Line**, **Product** and **Campaign**.
5. Press **Save draft**, then **Send a test to yourself** and read it.
6. Press **Send now**, or **Send it later** and choose when.

Each person gets it once, in their own language where you wrote it. Pictures come from your media library as JPEG, PNG or GIF, since
some mail apps cannot show other formats.

A **Product** part shows the product's picture, its price as each reader's country shows it, and a link. A **Campaign** part shows the
campaign's offer. Both are filled in when the email is sent, and left out where the product is no longer sold or the campaign has ended.

> [!TIP]
> **Write with AI** suggests the words from a few of your own, and can pick products and running campaigns. It never writes prices or
> stock, and nothing is sent until you send it. It needs AI set up for your store
> ([AI texts and pictures](/docs/owners/ai/ai-texts-and-pictures)).

### After you send

While a broadcast goes out, **Stop sending** stops the rest. A scheduled one can be called back with **Don't send it then**.

Once sent, its page shows how many it **Went to**, how many were **Delivered**, **Bounced** or **Marked as spam**, how many have
**Unsubscribed since**, and the **Presses on its links**. Opens are not tracked. The addresses are removed 90 days after the send; the figures stay.

A broadcast you like can be kept with **Save as template**, and is then under **Your templates** when you start a new one.

Marketing emails count towards your plan's monthly limit; see [Choose a plan](/docs/owners/getting-started/choose-a-plan).

## Make a segment

A segment is a group of your customers and subscribers by what they did. It is counted again each time you open it, so it is always up
to date.

1. Open **Marketing** and choose [Segments](/admin/{store}/segments). Press **New segment**.
2. **Start from** a ready one, such as *Your best customers*, *No order in six months* or *Subscribed but never bought*, or from
   everyone.
3. **Add a condition**: **Email consent**, **Number of orders**, **Money spent**, **Last order**, **First order**, **Customer type**,
   **Country**, **Language**, **Customer group**, **Company account**, **Account** or **Tag**. Choose whether people must match all of
   them or any of them.
4. Watch the count change as you edit: how many people are in it, and how many want your emails. Then **Save segment**.

Send a broadcast to a segment, or keep a [code or campaign](/docs/owners/marketing/discount-codes-and-campaigns) for its people. You tag
people on their customer page. A store has up to 100 segments.

## Automatic emails

Open **Marketing** and choose [Email automations](/admin/{store}/automations). There are four:

| Email | When it goes |
|---|---|
| **Welcome** | When someone joins your list, at once or some days after. |
| **After a purchase** | Some days after an order is delivered. |
| **Win-back** | When a number of days have passed since a person's last order. |
| **Back in stock** | Shoppers press *Email me when it is back* on a sold-out product, and get one email when it is back. |

The first three go only to people on your list who want your emails, once each. Each starts with words you can use as they are or
change. Press **Set it up**, read and change the words, **Send a test to yourself**, save, and press **Switch on**. Switching one on
never writes to people about what happened before. Each card shows how many emails it sent in the last 30 days.

Asking for a back-in-stock email does not put anyone on your list.

## Cart reminders

Cart reminders email shoppers who typed their email at checkout but did not pay, with a button that puts the same cart back.

1. Open **Marketing** and choose [Cart reminders](/admin/{store}/cart-reminders). Press **Turn on**.
2. You start with three reminders: after an hour, a day and three days. Open one to change when it goes (from 30 minutes to 30 days
   after the email was typed), its words in each language, or to add a discount code. Each can be switched off on its own.

While they are on, checkout keeps the email of a shopper who is not signed in as soon as they type it, and says under the field that a
reminder may come, with a link to say no. Every reminder has a link to stop them. They stop when the cart is bought, and 30 days after
the email was typed. The email and the cart are erased after 60 days. Signed-in customers get no reminders.

The page shows the last 30 days: carts with an email, how many were reminded, how many bought after a reminder, and those sales. Under
**For your privacy policy** you find what to add to your privacy policy.

## More options

- **A welcome code.** A newsletter form can email each address that confirms one single-use code of a discount (**Welcome code**), and
  tag them (**Tag those who sign up**) for your segments. The discount needs single-use codes, and the form must confirm addresses.
- **Personal data.** A person's place on your list, their history and the emails sent to them are in their data export, and erasing
  them removes it all ([Personal data](/docs/owners/customers/personal-data)).
