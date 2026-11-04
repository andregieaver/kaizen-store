---
title: Stock and locations
summary: See and change the stock of each variant at each location, move stock between locations, record what you buy from suppliers, and get a warning when stock runs low.
track: owners
section: stock
kind: how-to
areas: [stock, products, orders]
features: [shop]
plans: []
admin: /admin/{store}/inventory
order: 10
checked: 2026-11-04
sources: [D172, D370, D383, D397, D416]
---

## See your stock

Open **Products** and choose [Inventory](/admin/{store}/inventory). There is one row for each variant of the goods you ship; digital
products have no stock and never sell out.

| Column | What it means |
|---|---|
| **On hand** | What you have counted and a paid order has not yet taken. |
| **Committed** | What checkouts in progress hold. |
| **Available** | On hand less committed: what can still be sold. |
| **Owed** | Units sold on backorder on paid orders that are not sent yet. |

At the top, **What needs a look** counts the variants at or below their low-stock level, sold out, owed on backorder and below
zero. **Show them** lists them. Search by title, handle or SKU, or filter by location.

## Change a stock figure

1. In the variant's row, type the counted figure under **Set to**, or a change under **Adjust by**, such as `+5` or `-2`.
2. Press **Review changes**. Nothing is saved yet: each row is shown before and after.
3. Choose a **Reason**: Correction, Count, Received, Damaged, Theft or loss, or Promotion or donation. Add a short **Note** if it
   helps, but do not write about a person.
4. Press **Save changes**.

Each row is saved on its own. A row whose stock changed since you opened the page, by a sale say, is left alone and listed, so a
sale is never undone. A change you make never takes stock below 0. Changing stock takes the right to change products; others can
read the page.

Every change is kept for 24 months in **History**: when, which variant and location, the change, the new figure, the reason, and who
or what made it (a staff member, an order, a return, a file or the AI manager). A change cannot be edited: a wrong one is corrected
by a new one. **History** at the end of a row shows that variant's changes.

> [!TIP]
> You can also set stock in the product editor, under **Price and stock**. With several locations, each variant there has one field
> per location.

## Stock in several places

If you keep stock in more than one place, add each one on the **Locations** tab. Each variant has its own stock at each location,
and the shop sells the sum of the active ones.

- **Add location**: a name, such as *Bergen shop*, and its country. A new location goes last. A store can have up to 20.
- **Move up** and **Move down** set the order orders take stock in.
- **Rename** changes the name or the country.
- **Deactivate** takes a location's stock off sale. It first shows how many units would stop being for sale, and it is refused
  while checkouts hold stock there. Nothing is deleted: **Reactivate** puts the units on sale again.
- **Stop online orders here** keeps a location's stock out of the online shop. Its stock is still counted, moved and received.

A store always keeps one active location that takes online orders, and a location is never deleted. Only the store's owner can
deactivate, reactivate or stop online orders.

With several locations, the Inventory list shows each variant's totals. Open **Locations of …** under a row to see and change each
location's figures, or filter the list by one location.

### Which location an order takes from

When you have more than one active location, choose under **How orders choose a location**:

- **In the order below**: from the top location first.
- **Locations in the delivery country first, then the order below**.

Either way, an order is kept together at one location when one location can supply all of it. Otherwise it is taken location by
location in that order, and what is sold on backorder is put at the first location that stocks the variant.

## Move stock between locations

On the **Transfers** tab, press **New transfer**.

1. Choose **From** and **To**, and add lines: a **SKU** and its **Units**. **Add a line** adds another, or **Add lines from a CSV
   file** reads a file with a SKU and a Quantity column.
2. Press **Save as a draft**. Nothing moves yet.
3. Open the transfer and press **Send it**. The units leave the first location at once and are not for sale anywhere until they are
   counted in. Units that checkouts hold are never sent: a line with too few free units is refused, with how many are free.
4. When they arrive, write the units that came under **Count units in** and press **Count them in**. A delivery can be counted in
   parts.

**Cancel the transfer** puts the units not yet counted in back where they came from. On the Locations tab, units on their way show as
**Incoming**.

## Record what you buy

On the **Purchase orders** tab, press **New purchase order**.

1. Fill in the **Supplier**, the **Supplier's reference** (optional), the **Currency** the supplier bills in, where the stock
   **Arrives at** and when it is **Expected** (optional).
2. Add lines: a SKU, its units and the **Cost of one unit**. A CSV file with SKU, Quantity and Unit cost columns works too.
3. Press **Save as a draft**, then **Mark as ordered** when you order. From then on its supplier, currency, place and lines are fixed.
4. When goods arrive, **Count units in**. The stock goes up at that location, and each variant's cost becomes what one unit cost on
   this order, converted into your main currency at the store's exchange rates. Every change of a cost is kept.

Without an exchange rate for the supplier's currency, the cost is left as it was, and the page says so. **Cancel the purchase order**
keeps what was already counted in. Purchase orders are your own records: nothing is sent to the supplier.

> [!TIP]
> When the briefing says stock is running out, **Prepare reorder** opens a purchase order filled in for you: the variants that will
> run low within 37 days at the pace of the last 30, with their cost and the supplier you used last. Check it and press **Save as a
> draft**.

## Low-stock warnings

Set a level for a variant, and the store's owners get one email when its stock goes down to that level, not one for every sale.

- In the product editor, open **Stock rules for …** under the variant and fill in **Warn me when stock is at or below**.
- On Inventory, tick variants, fill in **Warn me at or below** and press **Set low-stock level**.

A variant already at or below the level when you set it counts at once.

## More options

- **Stock files.** **Export** on Inventory writes one row for each variant at each active location. To count, change the `on_hand`
  column and bring the file back under **Import**: press **Check the file** to see what it would do, row by row (it changes nothing),
  then **Import …** and **Yes, import**. Leave the `on_hand_was` column as the export wrote it: a row whose stock has changed since, by
  a sale say, is left alone instead of undoing the sale. The file can also set `reason`, `stock_policy`, `backorder_days` and
  `low_stock_threshold`. An import never creates a variant, a location or a product, never deletes anything and never writes a
  figure below zero. At most 20,000 rows in a file.
- **Many products at once.** With one location, tick products under [Products](/admin/{store}/products) and press **Set stock**: a
  number sets every variant's stock, and `+5` or `-3` changes it.
- **Refunds and returns** can put units back in stock, where they were taken from or at a location you choose. See
  [Refunds and exchanges](/docs/owners/orders/refunds-and-exchanges).
- **Selling when sold out**, and pre-orders: see [Pre-orders and backorders](/docs/owners/stock/pre-orders-and-backorders).
- **Inventory is part of the online shop**, which every new store starts with. It is switched on and off under Settings, Features.
