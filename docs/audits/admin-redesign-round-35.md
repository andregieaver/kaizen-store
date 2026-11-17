# Admin redesign, round 35: Accessibility, a new campaign and a product layout on a phone

Decision D714, 17 November 2026. The boards are on the design canvas of round 35.

After round 34 no store page on a phone was above 2,630 px. The three tallest:

| Page | Before | After |
|---|---|---|
| Accessibility (`/settings/accessibility`) | 2,621 px | 922 px |
| A new campaign (`/campaigns/new`) | 2,613 px | 1,071 px |
| A new product layout (`/product-layouts/new`) | 2,579 px | 2,223 px |

Below 640 px wide, each page changes as described here; from 640 px it is as before, except the layout's one change (see below).

## Accessibility (`AccessibilityForm`)

- **The draft statement comes first**, with where the owner stands (*Not assessed*) and what the draft is.
- **What the site knows is one row:** *Colours pass · 1 picture without alt text*.
- **The assessment is one row** saying the status.
- **The statement is one row:** *No known issues · feedback to the store's email*.
- **One wide Save** follows the rows.
- **The caveat** is one line at the end.

## A new campaign (`CampaignEditor`, new and edit)

- **What it gives is one choice**, with its sentence under it, in place of seven large cards.
- **How it combines is one row** inside the campaign's card (*Works with discount codes · not on top of campaigns*): the two
  checkboxes with their explanations.
- **What it applies to, when, where and who are rows** saying what is chosen (*On now · no end · no limits*). Where shows only for
  stores with more than one country.
- **One wide Save.**

## A new product layout (the page builder's switched-off stand-in)

- **A part of a feature that is off is one dashed line** on a phone (*Rating: switched off – not shown*).
- **Why it is left out and when it comes back** is in the part's title at every width, and in the second line from 640 px.

## How this differs from the boards

- **Accessibility:** the draft card keeps its own look, not amber, and its title (*Make a draft statement*) over the status.
- **Accessibility:** Save stays with the form, under the rows.
- **Product layout:** its other parts are the layout itself and stay as drawn, so the page stays about 2,200 px. Only the four
  switched-off cards became lines.

## Platform

- Kaizena Flow's own accessibility statement is a page on its site.
- Kaizena Flow's plan campaigns are timed plan prices (D524), not this editor.
- Kaizena Flow has no product layouts: it sells plans.

## Tests

- Lint, types and all unit tests pass.
