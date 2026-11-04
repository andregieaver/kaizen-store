---
title: Pickup and local delivery
summary: Let customers collect their orders at your shops and pickup points, deliver to customers nearby with your own driver, and hand each order over from its page.
track: owners
section: shipping
kind: how-to
areas: [shipping, orders]
features: []
plans: []
admin: /admin/{store}/settings/shipping/pickup
order: 20
checked: 2026-11-04
sources: [D135, D237, D289]
---

## Pickup

### Add your places

Customers collect at your own places. Open **Settings**, choose [Company](/admin/{store}/settings/company) under Store, and under
**Stores and pickup points** press **Add a store** or **Add a pickup point**. Give its address and opening hours: customers see both at
checkout. A place must be in a country you sell to.

### Let customers collect

1. Open **Settings**, choose **Shipping** under Selling, and press [Pickup](/admin/{store}/settings/shipping/pickup).
2. For each place, tick **Customers can collect here**.
3. Leave **Price** empty for *Free*, or type what pickup costs, VAT included.
4. Under **Usually ready in (hours)**, give how soon an order is usually ready. 0 promises nothing: customers are told you will email them
   when it is ready.
5. Write the **Pickup instructions**, such as where to ask and what to show. They are sent in the *Ready for pickup* email and shown at
   checkout, in your store's main language; translations are written on the Translate page.
6. Press **Save pickup**.

At checkout, customers choose under **Collect**, with each place's address, today's opening hours, how soon it is usually ready and its
price. No shipping address is asked. Pickup is never chosen for them.

### Hand over a pickup order

On the order:

1. When it is ready, press **Ready for pickup**. The customer gets one email, in the order's language, with the address, the opening hours
   and your instructions.
2. When they have it, set **Collected on** and press **Collected**. The order is fulfilled and no email is sent. That day starts the 14
   days to withdraw.

Pickup orders are never in *To send*. In the Orders list, **Fulfilment** in the filters finds them with *To hand over (pickup)*. A mistake
is taken back with **Undo** under **Handed over** on the order.

## Local delivery

### Add an area

1. Open **Settings**, choose **Shipping** under Selling, and press [Local delivery](/admin/{store}/settings/shipping/local).
2. Under **Add an area**, write the **Name, as shoppers see it** and choose the **Country**.
3. Under **The area**, choose:
   - **Postal codes**: codes like 0150, or prefixes like 01*, separated by commas, spaces or lines; or
   - **A distance from one of your places**: choose the place under **Measured from** and give the **Radius (km)**.
4. Type the **Price** (empty is *Free*), and if you like a **Minimum basket** and a **Free above** value.
5. Write the **Delivery information**, such as the days and hours you deliver. It is shown at checkout and in the order confirmation.
6. Keep **Offered at checkout** ticked and press **Add area**.

Areas may overlap: the cheapest one that covers a customer's postal code is offered. **Check a postal code**, on the same page, shows
which areas cover a code before you save anything.

> [!NOTE]
> A distance is measured between postal-code centres, so an address near the edge may be counted in or out, and in a city many codes
> share one centre. Use postal codes where you need a sharper line. The form says when a country has no postal-code positions, and so
> no distance.

At checkout, customers give their postal code and see **Local delivery** when an area covers it, with your information and a *Note for
the driver*. A basket below an area's minimum sees *Local delivery from* that amount and cannot choose it. Stripe's form asks for the
address and a phone number.

### Deliver the order

On the order:

1. When it leaves, press **Out for delivery**. The order is fulfilled and the customer is emailed.
2. When it is there, set **Delivered on** and press **Mark delivered**. That day starts the 14 days to withdraw. For a driver who delivers
   at once, **Mark delivered** records both steps in one go.

Local delivery orders are never in *To send*. **Fulfilment** in the Orders list's filters finds them with *Local delivery*.

## More options

### When cards are charged on sending

If you charge cards when the order is sent (see [Set up payments](/docs/owners/payments/set-up-payments)), recording the handover
charges the card first. If that fails, nothing is recorded.

### Removing a place or an area

A place cannot be deleted while paid orders wait to be collected there: mark them collected, or cancel them, first. When you delete a
local delivery area, orders already placed keep their delivery.

### Other ways to deliver

- [Shipping rates](/docs/owners/shipping/shipping-rates): a flat rate per country, and your own methods with zones and profiles.
- [Shipping carriers](/docs/owners/shipping/carriers): carriers' services, with pickup points, at checkout.
