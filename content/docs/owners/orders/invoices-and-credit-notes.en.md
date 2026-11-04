---
title: Invoices and credit notes
summary: Every paid order gets an invoice and every refund a credit note, made for you. Find them, fix what makes one wait, set the numbering, and give your accountant a CSV or an e-invoice.
track: owners
section: orders
kind: how-to
areas: [orders, tax]
features: [shop]
plans: []
admin: /admin/{store}/invoices
order: 60
checked: 2026-11-04
sources: [D159, D403, D174, D173, D239]
---

## Made for you

When an order is paid, Kaizena Flow issues its invoice in your store's own numbered series. When a refund goes through, it issues a
credit note in a series of its own. You never make them by hand, and once issued they cannot be changed or deleted. In a new store this
is on from the start.

The customer finds their invoice on their order page and in the order emails: the order confirmation carries it, with the PDF attached
when it is ready. Invoices are part of the online shop, switched on under Settings, Features.

> [!NOTE]
> This is not tax or accounting advice. Have your accountant read a sample of your invoices before you rely on them.

## Find an invoice

Open **Invoices** in the menu, under Orders. [Invoices](/admin/{store}/invoices) has three tabs: **Invoices**, **Credit notes** and
**Waiting**. Search by number, order or email, and choose a period with **From** and **To**. **View** opens a document and **PDF**
downloads it.

On an order's page, **Invoice and credit notes** lists that order's documents, with **View**, **PDF**, **E-invoice (XML)** and **Send to
the customer again**.

## When an invoice waits

A paid order waits for its invoice when something the invoice must say is missing. The **Waiting** tab lists each order with the reason:

- **Business details missing**: such as your legal name, postal address or organisation number.
- **Tax profile missing**: whether the store is registered for VAT is not saved.
- **VAT charged, store not VAT-registered**.
- **No exchange rate**: for an order in another currency than your own.

The payment is never held back. Press **Fix it** to go where the cause is put right. The invoice is then made within five minutes, or at
once with **Check again**. It is dated that day and still gives the payment day as the date of supply.

## Credit notes

Each refund that goes through gets a credit note, wherever it was made: on the order, from a return, or straight in Stripe. A credit
note is never more than its invoice has left at each VAT rate.

- **A changed order** gets a credit note for what is taken off and an additional invoice for what is added, both referring to the
  original invoice.
- **An exchange** gives the original order one credit note for the returned items, and the new order its own invoice.
- **An order paid outside Kaizena Flow** is invoiced too: the invoice says it was paid outside the online checkout.

## Settings

Owners set invoicing under [Settings, Invoicing](/admin/{store}/settings/invoices).

- **Make an invoice for every paid order** switches invoicing on or off. It works from the moment it is on: orders paid before are never
  invoiced afterwards. **Before you switch on**, on the same page, lists what an invoice still needs.
- **Send the invoice with the order confirmation** is on by default. The invoice is always on the customer's order page whatever you
  choose.
- **Note on every document**: plain text printed at the bottom of every invoice and credit note, such as your bank details. It is not
  translated.
- **Invoice numbers** and **Credit note numbers**: a **Prefix** and a **First number**, until the first is issued. To go on from another
  system, set the number after the last one you used there. Issued numbers cannot be changed, skipped or removed.

While Kaizena Flow makes your invoices, Stripe's own invoice for orders is not used, so a customer never gets two.

## For your accountant

### The CSV

On the **Invoices** or **Credit notes** tab, under **CSV for your accountant**, choose the first and last day and press **Download CSV**.
You get one row for each document of the period: its number, dates, order, the buyer's name, country and VAT number, the amounts, the
VAT at each rate, and the VAT in your own currency where the document has it. It holds personal data, so keep it safe; each download is
logged. A file holds up to 20,000 documents, and only members who may change orders can download it.

For a spreadsheet of the orders themselves, line by line, the owner can press **Export** on Orders. VAT and OSS figures are under
**Analytics**: see [VAT](/docs/owners/markets-and-tax/vat).

### E-invoices

Each invoice and credit note can also be downloaded as an e-invoice: an XML file in the EU's standard format EN 16931 (UBL, with
Peppol BIS Billing 3.0's rules). Press **E-invoice (XML)** on the order's page, and pass the file to a buyer or a system that reads
e-invoices. Apps fetch the same file through the Admin API.

Kaizena Flow does not send e-invoices through the Peppol network: you pass the file on yourself. If a document lacks something the
format needs, such as the buyer's country or your VAT number where VAT was charged, you get the reason instead of a file.

## What gets no invoice

- Orders paid in Stripe's test mode.
- Orders paid while invoicing was off.
- Order history brought in from another shop.

Documents are written in Norwegian, Swedish, Danish or English, by the order's language; another language gets English. Your own layout
and logo, corrective invoices and credit notes made by hand are not available.
