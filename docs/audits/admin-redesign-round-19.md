# Admin redesign, round 19: stock and variants on a phone

Decision D661, 16 November 2026. The boards are on the design canvas of round 19 (today at 390 px and a phone proposal for each part).
Owners count stock at the shelf; a variant's count was a bare number beside an unlabelled tick, and Inventory with several locations was a
table four columns wider than the phone. Wide screens are unchanged.

## Price and stock in the product editor

- On a phone, price on request, how it is delivered and the options are rows saying what is true (*Off: prices are shown*, *Physical*,
  *colour: black, white*), each opening its fields under it with Change (`PhoneFold`).
- Each variant is a row with its name and *3 in stock · 249,00 NOK*; Change opens its fields, where the count says *In stock* and the tick
  says *Sold in the shop*. With one stock location the count has − and + as before; with several, each location is counted under *More*.
- The notes on locations, VAT and price history are one fold, *How prices and stock work*, on every screen.

## Inventory (`/admin/{store}/inventory`)

- On a phone, with every location summed (Advanced, or several locations), each variant is a card: its name, SKU, *committed* and *available*
  in words and its on-hand count; with one location chosen the count has − and +, with several each location is counted with − and + under
  *Locations of …*. The table stays from 640 px.
- *Review changes* stays at the bottom of the screen while there are changes.

## What differs from the boards

- The variant's price field keeps its market's label and VAT line as before; *More for black* keeps its existing folds.

## Tests

The product editor and inventory view tests run unchanged; the inventory e2e (Basic view) is unchanged.
