# Admin redesign, round 36: Customers, a new product and Recommendations on a phone

Decision D724, 17 November 2026. The boards are on the design canvas of round 36.

After round 35 no store page on a phone was above 2,570 px. The three tallest:

| Page | Before | After |
|---|---|---|
| Customers (`/customers`) | 2,568 px | 1,999 px |
| A new product (`/products/new`) | 2,556 px | 1,924 px |
| Recommendations (`/recommendations`) | 2,549 px | 686 px |

Below 640 px wide (768 px for the product editor's order, as round 4 set it), each page changes as described here; from there up it
is as before.

## Customers (`CustomerList`)

- **The first twenty customers show**, then *Show all 30* (`PhoneMore`).
- **Choosing shows everyone**, so ticking several to tag works on the whole page.
- **The search, the kinds and the sort** stay above the list.

## A new product (`ProductEditor`)

- **A new product starts with its title and description**, then its pictures. An existing product keeps round 4's order: pictures,
  then price and stock, then the words.
- **What it is is one row** (*Goods · Shipped or downloaded*) with *Change*.
- **Categories and tags are one row** (*None chosen*, or how many). An existing product gets this row too.

## Recommendations

- **On or off comes first.** Off is an amber card with *Switch on*, which opens the settings row at its switch.
- **The settings are rows saying what is set:**
  - Settings (*Off · plain ranking · upsell up to 50 %*)
  - Your rules (*No rules yet*)
  - Check against past orders, which opens by itself after a check has run
  - What shoppers did (*The last 30 days*)

## How this differs from the boards

- **New product:** price and stock stays its own card of rows (round 4), not one more row.
- **New product:** the picture field keeps its card under the words.
- **Recommendations:** *Switch on* opens the settings row rather than switching at once, since the switch is saved with the settings
  form.
- **Recommendations:** what shoppers did says its period, not a verdict.

## Platform

- Kaizena Flow's own customers are its owners, on the platform's own screens.
- Kaizena Flow sells plans, not products, so it has no product editor or recommendations.

## Tests

- Lint, types and all unit tests pass.
