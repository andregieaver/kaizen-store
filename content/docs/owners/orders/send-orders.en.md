---
title: Send orders
summary: Mark an order as sent with its tracking number, send it in several parcels, print packing slips and pick lists, and book carrier labels.
track: owners
section: orders
kind: how-to
areas: [orders, shipping]
features: [shop]
plans: []
admin: /admin/{store}/orders/{id}
order: 20
checked: 2026-11-05
sources: [D174, D238, D372, D374, D153, D289, D457, D458]
---

## See what to send

Open **Orders** and choose the view **To send**: paid orders with goods still to send. Orders are part of the online shop, switched on
under Settings, Features.

## Mark an order as sent

1. Open the order. Under **Send the order**, each item shows how many were ordered, sent and withdrawn, and how many are still to send.
2. Choose the **Carrier** and type the **Tracking number**, if there is one. For a carrier that is not in the list, choose **Other** and
   paste its **Tracking link**.
3. Keep **Tell the customer** ticked: the customer is emailed what is in the parcel and how to follow it.
4. Press **Send this parcel**.

The order is sent. The parcel is listed as **Parcel 1**, with its tracking, its own **Packing slip** and **Email again** to send its
email once more.

## Send part now and the rest later

When only part of an order is ready, lower the numbers under **In this parcel** before you press **Send this parcel**. 0 leaves an
item out of this parcel. The order is then **Partly sent** and stays under **To send**.

Send the rest later with **Send another parcel**. Each parcel has its own tracking, its own email listing what is in it and its own
packing slip, and the customer's order page shows the parcels and what is still to come.

If some items will never be sent, for example because they ran out, refund them and keep **These units were not sent** ticked. See
[Refunds, cancellations and exchanges](/docs/owners/orders/refunds-and-exchanges).

## Packing slips and pick lists

- **Packing slip**, at the top of an order, prints what is still to send, without prices. On a gift order the button reads **Print gift
  slip**, and the slip also prints the buyer's gift message.
- For several orders, tick them on Orders and choose **Print packing slips**: each order on its own page, in its own language.
- **Print pick list** shows what to take off the shelves for the ticked orders, by product or by order, sorted by SKU, title or the most
  units.

Slips and pick lists take at most 100 orders. The pick list changes nothing: mark the orders as sent when they are packed.

## Book a carrier's label

With a carrier connected (see [Carriers](/docs/owners/shipping/carriers)), the order offers a booking under **Send the order**:
**Book with Posten / Bring**, and **Book with Helthjem**, **Book with Porterbuddy** or **Book with Instabox** when the customer chose that
carrier at checkout. **Book with DHL Express**, **UPS**, **PostNord**, **DHL Paket** and **nShift** are there when the customer chose them,
or chose your own shipping: then you choose the service, and you can ask the carrier to collect the parcel. The booking marks the parcel sent with its tracking number, and **Print label** opens the label to print.

To book part of an order, lower the numbers before you book, and weigh that parcel: the weight shown is guessed from the whole order.
Book the rest straight after as a parcel of its own.

> [!NOTE]
> While a carrier is in its test environment, a booking is only a test: nothing is shipped and the order is not marked as sent. PostNord
> cannot book labels from Kaizena Flow yet: book with PostNord and type its tracking number.

### Labels for many orders

Tick the orders on Orders and choose **Book labels**. Each order's remaining goods are booked as one parcel, with the carrier the
customer chose at checkout, or Posten / Bring's home parcel when they chose none. The weight comes from the products. Each order is
marked as sent, and orders that cannot be booked are listed with the reason, such as a product without a weight.

The customers are emailed only if you tick **Tell the customers**. Then press **Print the … labels**: they open one after another in
your browser's PDF viewer. At most 100 orders go at a time.

## What the customer is told

- **Order sent**: the email when you tick **Tell the customer**.
- **Out for delivery (carrier)** and **Delivered (carrier)**: off by default. Switch them on under
  [Settings, Notifications](/admin/{store}/settings/notifications). Today only Posten / Bring's tracking sends them; other carriers'
  tracking is shown on the order and the customer's order page, but sends no email.

Kaizena Flow checks the tracking of a connected carrier's parcels every few minutes; **Check now** asks at once. It stops following a
parcel 30 days after it was sent.

If you switch the **Order sent** email off, the tick box on the order is off too and links to Notifications.

## When the customer has the goods

The customer's 14 days to withdraw start the day they receive the goods, from the last parcel when they come in parts. With
Posten / Bring that day is recorded from the tracking. Otherwise, under **Returns and withdrawals** on the order, press **Mark the goods
as received by the customer** and give the day. Use the tracking or what the customer says, never the day you sent it. More in
[Returns and withdrawals](/docs/owners/orders/returns-and-withdrawals).

## Undo a parcel

Marked a parcel sent by mistake? Press **Undo “sent”** on it, with a reason if you like. Its items go back to what is still to send, and
the parcel stays in the history, marked undone. A parcel booked with UPS, DHL Paket or nShift is cancelled at the carrier too,
if it has not been handed over: the message says whether the carrier cancelled it. Three things are not done for you:

- a booking with another carrier is not cancelled: cancel it with the carrier;
- the customer is not emailed: tell them if they were told it was on its way;
- a recorded receipt day is cleared: record it again when the goods arrive.

A parcel cannot be undone once a return or withdrawal was made after it.

## More options

- **Hold fulfilment** puts an order on hold, with a reason. Nothing of it can be sent or handed over until you press **Release**. Rules
  under [Settings, Automation](/admin/{store}/settings/automation) can hold orders by themselves.
- **Mark as sent** on several ticked orders marks them sent without a tracking number. A partly sent order sends what is left as one
  parcel; orders that cannot be sent are skipped and listed.
- **Charged when sent.** When the card is charged as the order is sent (**Take payment** under Settings, Orders), the button reads
  **Capture and send**: recording the first parcel charges the card.
- **Waiting for stock.** An order with items sold on backorder says so; send it when the stock is in.
- **A change waiting for payment** stops sending until the customer pays it, or it is cancelled or expires.
- **Pickup and local delivery** are handed over with **Ready for pickup**, **Collected** and **Out for delivery**: see
  [Pickup and local delivery](/docs/owners/shipping/pickup-and-local-delivery).
