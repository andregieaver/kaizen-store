# Admin redesign, round 46: Import stock, Purchase orders and Stock history on a phone

Decision D750, 18 November 2026. The boards are on the design canvas of round 46.

These were the tallest store pages on a phone that no round had reworked. All three are inside Inventory.

| Page | Before | After |
|---|---|---|
| Import stock (`/inventory/import`) | 1,414 px | 688 px |
| Purchase orders (`/inventory/purchase-orders`) | 1,375 px | 664 px |
| Stock history (`/inventory/history`) | 1,357 px | 696 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Import stock (`StockUpload`)

- **One line says what the page is for.**
- **The file's hint is one line:** *Needs the columns sku and on_hand. Nothing changes until you have seen the check.* Every column is named
  from 640 px.
- **How the file is read is a row** (*Columns, reasons, what is skipped*). The five rules open under it, the export link among them.
- **The note on keeping the file is one line.**

## Purchase orders (`NewStockDocument`, `StockDocumentList`)

- **One line says what the page is for.**
- **An empty list says so in one line.**
- **New purchase order is a row that opens the form.** A reorder prepared from the briefing opens it by itself.
- **The open form shows the supplier, the lines, Add a line and Save as a draft.** Reference, currency, where it arrives, when, lines from
  a file, the cost note and the note are behind ***More about the order***. Every field is sent either way, and none is required.
- The form's heading is read out but not shown, as the row already names it.
- Transfers use the same form and are not changed.

## Stock history (`HistoryView`)

- **One line says what the page is for.**
- **The filters are one row** saying what is chosen, or *Every SKU, location and reason, any time*.
- **Each change is a line:** the variant and its options, the time without its year, the location and the reason, with the change on the
  right (*+60*).
- The table, with the new figure, who made the change and the note, shows from 640 px.
- **The note on keeping the history is one line.**

## How this differs from the boards

- **Import stock:** the export is a link inside the rules, not a row of its own.
- **Purchase orders:** the supplier's line, the lines and Save follow the board. *More about the order* sits after Add a line, not under
  the supplier.
- **Stock history:** a line is not a link. The product and the variant's own history are reached from 640 px or from Inventory.

## Platform

- Kaizena Flow sells plans, not goods: it has no stock, purchase orders or stock history (CLAUDE.md, conventions).

## Tests

- Lint and types pass.
- All unit tests pass but `api-contract.test.ts`. It fails on main without this change: the published API contract changed in another
  session's commit, and its recorded hash was not updated.
- `inventory.spec.ts` passes against a local build. It reads *What an import does and does not do*, so the phone's row has its own words.
