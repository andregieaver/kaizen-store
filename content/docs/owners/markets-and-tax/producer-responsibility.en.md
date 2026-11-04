---
title: Producer responsibility
summary: Record your registrations for packaging, electrical equipment, batteries and the other schemes in each country, so the products under them can be sold there.
track: owners
section: markets-and-tax
kind: how-to
areas: [products, markets, settings]
features: []
plans: []
admin: /admin/{store}/settings/producer-responsibility
order: 50
checked: 2026-11-04
sources: [D342]
---

## How it works

In many countries, whoever sells certain goods there must register for the scheme that collects and recycles them, and may pay a fee.
Kaizena Flow keeps your registrations, scheme by scheme and country by country, and holds back what is not covered:

- You tick the schemes a product falls under in its editor. A new product ticks none.
- A ticked product is sold in a country only while a registration for that scheme there is valid, from its first day through its last,
  or you have recorded why none is needed.

The schemes are **Packaging**, **Electrical and electronic equipment**, **Batteries**, **Textiles**, **Furniture** and **Tyres**.

> [!IMPORTANT]
> Kaizena Flow does not check numbers with the authorities, and what each country requires is for you to check.

## 1. Tick the schemes on your products

In a product's editor, open **Tax, returns and recycling** and tick the schemes under **Recycling schemes this product falls under**.
Save the product.

## 2. Add your registrations

Open **Settings** in the menu and choose [Producer responsibility](/admin/{store}/settings/producer-responsibility), under Selling. Under
**Add a registration**:

1. Choose the **Scheme** and the **Country**.
2. Under **In this country**, choose **We are registered**.
3. Type the **Registration number**, and under **Registered with** the authority or producer responsibility organisation that gave it.
4. Give the day under **Valid from**, and the last day under **Valid to (optional)** if it ends.
5. Press **Save registration**.

Where a country needs no registration, choose **No registration is needed here** instead and say why under **Why none is needed**: for
example, there is no scheme for it there, or you are below its threshold. Check with the authority first. The reason is never shown to
shoppers.

When a registration is renewed, add the new one with its own dates; the old one stays as a record.

## What the page shows

- **Not sold now**: each scheme and country with nothing valid today, the products it holds back, and **Add the registration** beside
  them. You can also untick the scheme on the product, if it does not fall under it.
- **Registrations**: each with its number, the authority, its dates and its state: *Valid*, *Not begun* or *Ended*. Press **Change**
  or **Remove** to edit one.

A registration that ends within 30 days, with none after it, says the day it ends and the day sales stop, unless a new registration
follows.

> [!WARNING]
> Removing a registration leaves nothing on record for that scheme and country, so its products are held back there again.

## What shoppers see

- Where a product is held back, its page says it is not sold in this country at the moment, in place of the buy button. It cannot be
  added to the cart, and checkout refuses it.
- Days follow your store's time zone: a registration covers its last day, and sales stop the next. One not begun holds sales back
  until its first day.

## More options

### Showing the number on product pages

Tick **Show the number on product pages in this country** and the number appears under the product's safety information, while it is
valid. It starts ticked where Kaizena Flow knows a country asks for the number in offers; check what applies to you.

### Good to know

- The number is not printed on invoices yet. If you must show it there, put it in **Note on every document** under Settings,
  [Invoicing](/admin/{store}/settings/invoices).
- A copy of your store carries no registration: each store records its own.
- A demo store is never held back; its products under a scheme are listed under **No registration recorded** instead.
- The AI manager can read your registrations and add one, which always waits for your yes.
