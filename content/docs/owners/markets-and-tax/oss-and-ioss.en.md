---
title: VAT, OSS and IOSS reports
summary: See your VAT by country and rate, the quarterly OSS and monthly IOSS return data, and export the CSV files your accountant needs.
track: owners
section: markets-and-tax
kind: how-to
areas: [tax, analytics]
features: []
plans: []
admin: /admin/{store}/analytics/tax
order: 30
checked: 2026-11-04
sources: [D161, D159, D157]
---

> [!IMPORTANT]
> These are your own figures, made from your invoices and credit notes, for you and your accountant. They are not a tax return, and
> Kaizena Flow files nothing.

## Before you start

The reports are made from your invoices and credit notes alone. If invoicing is off, switch it on under Settings,
[Invoicing](/admin/{store}/settings/invoices): see [Invoices and credit notes](/docs/owners/orders/invoices-and-credit-notes). A paid
order with no invoice is not added to the figures: it is counted, with its cause, in the reconciliation.

OSS and IOSS registrations are recorded under Settings, Tax: see [VAT](/docs/owners/markets-and-tax/vat).

## Open the reports

Open **Analytics** in the menu and choose [VAT](/admin/{store}/analytics/tax). The page has three tabs:

- **VAT by country and rate**, for any period;
- **OSS return data**, by quarter;
- **IOSS return data**, by month.

## VAT by country and rate

Choose a period at the top; the page starts on last month. Cards show **VAT charged**, **VAT credited**, **VAT after credits**,
**Net sales after credits** and how many invoices and credit notes there are, in your main currency.

The table **VAT by country and rate** has one row for each delivery country, rate, basis (*Standard*, *Reverse charge*, *Exempt* or
*IOSS*) and currency. Its last column, **Reported in**, says where that VAT belongs: your own country's return, a part of the OSS
return, the IOSS return, or no return and why. Shipping is in the rate it was charged at.

Good to know:

- An invoice is dated by the day of payment. A credit note counts in the period it is issued.
- Amounts are written with a decimal point, as the files write them, whatever language your admin is in.
- An order with both goods and downloads is classed by its goods.

### Reconciliation

Under the table, **Reconciliation** shows how the report agrees with [Finance](/admin/{store}/analytics/finance) and your orders, in
each currency. Finance counts an order on the day it was placed, so the two can differ; every difference is named and counted. When all
is accounted for, it says *Equal: every difference is named.*

## OSS return data

Choose a **Quarter** and press **Show**; the page starts on the last quarter that has ended. The figures are in euro, laid out as the
return's parts:

- **Part 2**: sales by Member State of consumption and rate (*2a* services, *2b* goods sent from your Member State of identification,
  *2d* goods sent from another Member State);
- **Part 3**: corrections of earlier periods;
- **Part 4**: the balance per Member State;
- **Part 5**: the total due, the sum of the positive balances.

Two modes are a press apart:

- **Filing** shows what a return for the period holds: a credit note of the same quarter reduces Part 2, a later one is a Part 3
  correction of the quarter of its sale.
- **Books** is the bookkeeping view: every credit note counts in the period it is issued, so Part 2 can be negative and there is no
  Part 3.

Under the parts, **Not in this return** lists the sales of the period that belong elsewhere, with the reason, and **Registration** says
what your tax profile records. Each return says the day it is due, marked *Due soon* or *Deadline passed* near or after it.

With no OSS registration recorded, the page still shows the figures a return would hold, under a heading that says so.

> [!NOTE]
> A return also asks for the VAT or tax number the Member State you send goods from gave you. Kaizena Flow does not hold it, so you
> enter it yourself.

## IOSS return data

The same, month by month, for orders marked with your IOSS number. It stays off until Settings, Tax has an IOSS number and the markets
it applies to. When you have named an intermediary there, they normally file the return: the return data file is what you give them.

## Euro rates

OSS and IOSS amounts are converted to euro at the ECB's reference rate of the period's last day, or of the next day it published one.
**Euro rates** lists each currency with its rate and where it came from.

When a rate is missing, the return is incomplete, and its return data file is not offered. An owner can press **Fetch from the ECB**,
or **Enter a rate** with the reason, which is then shown wherever the rate is used.

## Export the files

Each view has CSV files for your accountant, in fixed layouts and in English:

| File | Where |
|---|---|
| **Export VAT by country and rate (CSV)** | VAT by country and rate |
| **Export reconciliation (CSV)** | Reconciliation |
| **Export OSS return data (CSV)**, **Export IOSS return data (CSV)** | OSS and IOSS return data |
| **Export conversion detail (CSV)** | OSS and IOSS return data: each conversion with its rate |

Exporting needs write access to Analytics; anyone who may read Analytics sees the figures. Every export is logged. If a period's
figures change after you exported it, the page says *Changed since you exported this*, with the difference, which belongs in your next
return as a correction if you have already filed.

## Good to know

- Each order keeps the country it was sent from, your country and your OSS Member State as they were when it was placed. Changing your
  tax settings later never moves a period you have filed.
- The AI manager can read these reports for you; it never makes a file. See [The AI manager](/docs/owners/ai/the-ai-manager).
- Have your accountant check how sales are classed before you rely on the figures.
