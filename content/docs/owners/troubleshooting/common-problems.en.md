---
title: Common problems
summary: What to check when a product does not show, the store says it is not open, checkout takes no real payments, an email did not arrive, a domain does not work, the AI manager does not answer, or someone on your team cannot open a page.
track: owners
section: troubleshooting
kind: troubleshooting
areas: [products, setup, payments, orders, website, ai, team, settings]
features: []
plans: []
admin: /admin/{store}
order: 10
checked: 2026-11-04
sources: [D17, D26, D73, D94, D158, D171, D178, D238, D335, D339, D342, D369, D420]
---

Each entry is something you may notice, with what to check, most likely first. The page linked at the end of each entry covers it in
full.

## A product does not show in a country

Open the product under **Products** and check:

1. **Its status.** A product set to *Draft (hidden)* is not on the site, and nor is an archived one. Set it to **Published** and press
   **Save**.
2. **A price there.** A country without a price does not sell the product.
3. **Sold in.** A country unticked under **Sold in** does not sell it, though its price is kept. Tick it again and save.
4. **The country.** Your store must sell to that country: see [Countries](/admin/{store}/settings/countries).
5. **What the product needs.** An appointment, a stay or a rental, or a product sold only as a subscription, shows only while its
   feature is switched on under **Settings**, **Features**. With the online shop switched off there, no product shows.

If the product shows but says *Not sold in this country at the moment*, it falls under a recycling scheme with no valid registration in
that country: see [Producer responsibility](/admin/{store}/settings/producer-responsibility). If visitors see only a landing page, the
whole store is private: see the next entry.

More: [prices](/docs/owners/products/prices), [countries, languages and currencies](/docs/owners/markets-and-tax/countries-languages-currencies),
[producer responsibility](/docs/owners/markets-and-tax/producer-responsibility).

## The store says it is a preview or not open

What the store shows tells you why:

- **Preview: this store is not open yet.** The setup is not finished. Open [Setup](/admin/{store}/setup), go to **Open your store** and
  press **Open my store**. It needs your business details and at least one country first.
- **Only a landing page**, by default your store's name and *This store is not open to visitors yet.* The store is private. A new store
  is private until it is opened. To open a store that is already set up, go to **Settings**, [Private mode](/admin/{store}/settings/private)
  and press **Open the store to everyone**. People with the password can come in meanwhile, and **Preview the store** lets you look
  without it.
- **Private mode says your free trial has ended.** The trial ended without a plan. Choose one on [Billing](/admin/{store}/billing): the
  store is public again within a few minutes. Until then it cannot be made public or opened.
- **This is a demo store. Nothing can be bought yet.** The store is open but cannot take payments: see the next entry.

More: [create your store](/docs/owners/getting-started/create-your-store), [choose a plan](/docs/owners/getting-started/choose-a-plan).

## Checkout does not take real payments

Open **Settings**, [Payments](/admin/{store}/settings/payments). Only owners can change it.

- **The store says Test mode: no real payments.** Payments are in test mode. Under **Real payments**, press **Set up Stripe** and answer
  Stripe's questions. When the status says *Ready: your store can take payments.*, choose **Live** under **Checkout** and press **Save**.
  Until Stripe is ready, that choice reads *Live (set up Stripe above first)*.
- **The status says Stripe needs a few more details, or is checking them.** Real payments wait for Stripe. Finish its questions; a check
  usually takes minutes, sometimes a day or two.
- **The store says This is a demo store.** Checkout is off, or Stripe has not made card payments active on your account. Tick **Shoppers
  can pay** under **Checkout** and press **Save**, and check the status under **Real payments**.
- **Shoppers see that the store is not open yet, so it takes no orders.** A store takes no real payment before it is opened. Test
  payments work meanwhile, with the card `4242 4242 4242 4242`.
- **Checkout says Real payments open when Kaizena Flow goes live.** Real payments are not offered yet: there is nothing for you to
  set.

A payment method that is ticked but missing at checkout may not be active on your Stripe account: **Payment methods**, on the same
page, shows what Stripe says of each.

More: [set up payments](/docs/owners/payments/set-up-payments), [payment methods](/docs/owners/payments/payment-methods).

## An email did not arrive

**A customer's email.** Open **Orders**, [Emails](/admin/{store}/emails). It lists the emails the store sent, newest first, each with
the address it went to and its **Status**:

- *Sending*, *Sent* or *Delivered*: it went out. Check the address it went to.
- *Failed*: it could not be sent. For an order confirmation, a paid order's page has **Send confirmation again**.
- *Bounced (address does not take email)*: the address does not work. If it is wrong on the order, correct it there.
- *Marked as spam by the recipient*: the customer marked it as spam.
- *Not sent (email not set up)*: email sending is not set up on Kaizena Flow, so nothing went out.

Open an email to read exactly what was sent. An email switched off under **Settings**, [Notifications](/admin/{store}/settings/notifications)
is not sent at all; those marked *Always on* always are.

**An email to you or your team.** Only the people ticked for it under
[Staff alerts](/admin/{store}/settings/notifications/staff) get it, and a box is offered only where the person's role may read what the
email shows. The briefing sends nothing for a quiet period, with no paid order and no alert. Analytics alerts are sent once a day,
after 20:00 in the store's time.

More: [notifications](/docs/owners/team-and-settings/notifications), [reports, targets and alerts](/docs/owners/analytics/reports-targets-and-alerts).

## My own domain does not work

Open **Settings**, [Domains](/admin/{store}/settings/domains), and find the domain under **Your own domains**:

- **Waiting for DNS.** The records shown are not all in place. Create them at the company where you manage the domain's DNS, and
  remove other A, AAAA or CNAME records on the same name. **Found** says which are there. Press **Check now**: DNS changes can take up to
  a few hours to show.
- **Health** names anything else that is wrong: the domain does not point to your store yet, the record that shows it is yours is
  missing, a CAA record stops the https certificate, the domain has expired, or the registrant has not confirmed their email.
- **The page says your domains changed.** Kaizena Flow is putting the change live, which takes a few minutes. The page updates by
  itself.

When the records are in place, the domain becomes your store's address, with a certificate for https, and your other addresses lead
there. Only an owner can add domains.

More: [SEO, redirects and domains](/docs/owners/website/seo-redirects-and-domains).

## The AI manager does not answer

- **It says it needs a text model.** Press **Set one up under AI**, or open **Settings**, [AI](/admin/{store}/settings/ai). With your
  own AI, choose a text model for it there. With Kaizena Flow's AI, your plan's AI for the month may be used up: see **Usage this
  month** on [Billing](/admin/{store}/billing). AI on your own provider's key is never limited by your plan.
- **It says it has answered many messages today.** It answers a set number of messages a store each day, and is back the next day.
- **You cannot find it.** The AI manager is for the store's owners, and is not there while the store is closed.

More: [the AI manager](/docs/owners/ai/the-ai-manager), [choose a plan](/docs/owners/getting-started/choose-a-plan).

## Someone on my team cannot open a page

A page a person's role cannot open is left out of their menu, and its address answers as if the page did not exist. Check:

1. **Their role.** [Team](/admin/{store}/staff) shows each person's role, and [Roles](/admin/{store}/staff/roles) what it gives in each
   area: *No access*, *Can view* or *Can change*. Choose another role and press **Change role**, or change the role itself. A change
   applies at once.
2. **Pages for owners.** Team, Billing, Analytics settings, Staff alerts and the AI manager are for owners, whatever the role says.
3. **A collaborator's end date.** A collaborator's access ends on its date. Before then, **Extend** gives more days. After it, they are
   listed under **Access ended**: invite them again under **Invite a collaborator**.
4. **Two-step sign-in.** When the store requires it, someone without it is taken to set it up before they reach the store.
5. **A closed store.** While the store is closed or suspended, everyone can only read and handle what already happened.

The [Activity log](/admin/{store}/activity) notes each time someone was refused something their role does not allow.

More: [staff and permissions](/docs/owners/team-and-settings/staff-and-permissions), [security](/docs/owners/team-and-settings/security).
