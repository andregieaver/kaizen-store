---
title: Pre-orders and backorders
summary: Keep selling a variant when it is sold out, or take pre-orders before a release date, and send the orders when the goods arrive.
track: owners
section: stock
kind: how-to
areas: [stock, products, orders]
features: [shop]
plans: []
admin: /admin/{store}/products/{productId}
order: 20
checked: 2026-11-04
sources: [D172, D298, D396]
---

## Two ways to sell what you do not have yet

- **Backorder.** The variant keeps selling when it is sold out, and shoppers are told how many days it is expected to ship within.
- **Pre-order.** Until a release date, every unit is sold as a pre-order, even if you have some in stock, and shoppers see the date
  it is expected to ship from.

Both are for goods you ship, not for downloads or bookings. Both are paid in full at checkout, like any other order: there is no
deposit.

## Keep selling when sold out

1. Open the product. Under **Price and stock**, open **Stock rules for …** under the variant.
2. Tick **Keep selling when sold out**.
3. Fill in **Expected to ship within (days)**: from 1 to 90 days, and it is always shown to shoppers.
4. Press **Save**.

A product with several variants that are shipped also has **Keep selling every variant when sold out**, with one number of days for
all of them. On [Inventory](/admin/{store}/inventory) you can do the same for many variants at once: tick them, fill in **Expected to
ship within (days)** and press **Keep selling when sold out**, or **Stop selling when sold out** to turn it off.

> [!IMPORTANT]
> Choose days you can keep. When the days plus transport could pass 30 days, the editor reminds you that the 30 days run until the
> goods are delivered, not until they are shipped. A longer time must be said clearly, since the customer agrees to it by ordering.

### What shoppers see

- On the product page: *On backorder: expected to ship within 7 days*.
- In the cart: *2 on backorder: expected to ship within 7 days*.
- On the order page and in the confirmation: *2 of 3 on backorder: expected to ship within 7 days of your order*.

Only the units beyond what you have are on backorder. The days are kept on the order as they were when it was placed.

## Take pre-orders

1. Under **Stock rules for …**, tick **Keep selling when sold out** and fill in the days, as above.
2. Choose the release date under **Pre-order until**.
3. Press **Save**.

Until that date, shoppers see *Pre-order: expected to ship from* the date on the product page, and the date also shows on product
cards (the earliest date of the product's variants), in the cart, the checkout, the order and confirmation pages, My account and the
confirmation email. Your product feeds mark it as a pre-order with its date, and the chat assistant says it is on pre-order.

From the date on, the variant sells like any variant that keeps selling: from stock while there is some, then on backorder with the
days you set. Untick **Keep selling when sold out** to stop selling it at zero; that also clears the date.

> [!NOTE]
> Product cards in lists can say *pre-order* for up to a day after the date. The product page itself is right at once.

The release date is set in the product editor only: the product file, the Inventory page and the AI manager do not set it.

## When the goods arrive

Nothing happens by itself when goods come in. Do it in this order:

1. **Receive the stock.** Count in the purchase order, or on Inventory set the figure with the reason *Received*. See
   [Stock and locations](/docs/owners/stock/stock-and-locations). Stock sold on backorder shows **Below zero** until then.
2. **Find the orders that waited.** On [Orders](/admin/{store}/orders), the **Waiting for stock** view lists paid orders with units
   sold on backorder. The order page says *Waiting for stock*, how many units were sold on backorder, and links to Inventory.
3. **Send them** as usual. See [Send orders](/docs/owners/orders/send-orders).

Pre-orders wait apart: an order whose only units left to send are pre-orders before their date is not in **To send**. Filter
**Fulfilment** by **Pre-orders waiting** to see them; each has a badge with its earliest date, and each line on the order page says
when it ships from. After the date, the order is in **To send**.

**Owed** on Inventory counts the units sold on backorder until their orders are sent.

## More options

- **Sold out and not selling?** When a variant stops selling at zero, shoppers can ask to be emailed when it is back, once you switch
  on the **Back in stock** email. See [Email marketing](/docs/owners/marketing/email-marketing).
- **Several locations.** What is sold on backorder is put at the first location that stocks the variant.
- **The stock file** on Inventory can set `stock_policy` (`deny` or `continue`) and `backorder_days` for many variants at once.
- **Pre-orders and backorders are part of the online shop**, which every new store starts with. It is switched on and off under
  Settings, Features.
