---
title: Shipping carriers
summary: Connect your own agreement with Posten / Bring, PostNord, Porterbuddy or Helthjem to offer their services at checkout, book and print labels from the order, and track parcels.
track: owners
section: shipping
kind: how-to
areas: [shipping, integrations, orders]
features: []
plans: []
admin: /admin/{store}/integrations
order: 30
checked: 2026-11-04
sources: [D133, D134, D135, D136, D137, D138, D239, D374]
---

## What connecting a carrier gives you

You connect a carrier with your own agreement with it: Kaizena Flow then talks to the carrier for you, with your customer number and
keys. What each one does now:

| Carrier | Delivers in | At checkout | Labels from the order |
|---|---|---|---|
| Posten / Bring | Norway, Sweden, Denmark, Finland | Bring's services and prices for parcels to Norway, with pickup points | Yes |
| PostNord | Sweden, Denmark, Norway, Finland | Its services at prices you enter, with pickup points | Not yet |
| Porterbuddy | Norway | Home delivery in a time window, the same day included | Yes |
| Helthjem | Norway | Home delivery and service points, at prices you enter | Yes |

All four have tracking: tracking numbers on the order and in emails. Posten / Bring can also book return labels for customers in Norway
(see [Returns and withdrawals](/docs/owners/orders/returns-and-withdrawals)).

## Connect a carrier

1. Open **Settings** in the menu and choose [Integrations](/admin/{store}/integrations), under Selling.
2. Under **Shipping carriers**, press **Connect** on the carrier's card.
3. **Get ready** lists what you need from the carrier first, such as an agreement and API access, with a link to its developer pages.
4. Under **Your details**, choose the **Environment**: **Test** while you try it, **Live** for real parcels. Fill in the fields the carrier
   gave you, and tick the countries under **Ship with** the carrier **to**.
5. Press **Save my details**.
6. Press **Check connection**. Kaizena Flow asks the carrier whether it accepts your details; nothing is booked. The card on Integrations
   then says *Connected* or *Not accepted*, and the carrier's page shows the answer.

Only the store's owners can change a carrier's details. Your details are kept encrypted on Kaizena Flow's servers in Europe. Keys are
never shown again after saving, only their last characters; leave a key empty to keep the one saved.

> [!NOTE]
> In the **Test** environment, booking makes a test shipment: nothing is shipped, and the order is not marked as sent. Switch the carrier
> to **Live** when you are ready. Porterbuddy and Helthjem ask you to stay in test until they have approved your setup.

## Offer the carrier at checkout

Once your details are saved, **Delivery options at checkout** appears on the carrier's page.

1. Tick **Offer** the carrier **at checkout in the countries chosen above**.
2. Under **Services to offer**, tick the services you want. Some let the shopper choose a pickup point; Helthjem's show the heaviest
   parcel each takes.
3. Set the prices:
   - **Posten / Bring and Porterbuddy** give their own price. Kaizena Flow adds VAT and what you add: a **Percentage added to the price
     with VAT** and an **Amount added**. **Free when the basket is worth at least** makes them free from a basket value.
   - **PostNord and Helthjem** have no price service. Enter each service's price for each country, with VAT, as the shopper pays it, from
     your agreement; leave a price empty and the service is not offered there. Each country has its own **Free when the basket is worth
     at least**.
4. Under **Parcel weight when the goods have none (grams)**, give the weight to use for goods without one.
5. Press **Save checkout options**.

Shoppers give their postal code at checkout and choose between your own shipping and the carrier's services. A service is shown only
when the carrier offers it for the parcel and the postal code. Porterbuddy's delivery windows are listed by date and time, each with its
own price. With several carriers on in a country, their services are listed together.

> [!IMPORTANT]
> If the carrier does not answer, your standard shipping is used. Keep a flat rate for each country under
> [Shipping](/admin/{store}/settings/shipping): the carrier's page warns when one is missing.

## Book and print labels

On an order sent with a carrier, press **Book with** the carrier. The booking starts from what the shopper chose at checkout. The order
is marked as sent with its tracking number, and **Print label** opens the label. Labels are fetched from the carrier each time you print
them and are never kept.

For several orders at once, tick them in the Orders list and choose **Book labels**. See
[Send orders](/docs/owners/orders/send-orders) for the rest of sending.

- Porterbuddy's window is asked for again when you book. If it is gone, nothing is booked.
- Helthjem's home delivery is checked for the full address before it is booked.
- PostNord's booking and labels are still to come: its page lists them as *coming next*.

## More options

- **Forget my** carrier **details**, at the bottom of its page, removes your saved agreement.
- A carrier's agreement is never copied when you duplicate the store.
- Carriers have their own default weight, on their page. Your own shipping methods use the one under Shipping (see
  [Shipping rates](/docs/owners/shipping/shipping-rates)).
