# Admin redesign, round 29: Marketing analytics, AI settings and the Activity log on a phone

Decision D702, 16 November 2026. The boards are on the design canvas of round 29. After round 28 these were the tallest store pages on a
phone. Everything below is below 640 px wide; from 640 px each page is as before.

| Page | Before | Why it was long |
|---|---|---|
| Marketing analytics | 5,105 px | "visit counting is off" said seven times, and three forms open inside a report |
| AI settings | 4,575 px | every field of your own provider open |
| Activity log | 4,392 px | two rows of chips and every entry with a face and its own fold |

## Marketing analytics (`/admin/{store}/analytics/marketing`, `MarketingView`)

- **One card says what the figures need** (*What a customer costs needs two things*), and only while one is missing:
  - *Your ad spend · none entered*, with *Add spend*, which opens the Ad spend row
  - *Visit counting · off*, with *Turn on*. For an owner this switches counting on in place; anyone else gets the settings.
- **Each section is a row with its answer:**
  - What a customer costs (*CAC, ROAS and more · waits for ad spend*)
  - Channels (*Waits for visit counting*)
  - Campaigns (*Make a campaign link*)
  - Ad spend (*None entered · add or import*, or how many entries)
  - Discounts and coupons (*0 of 44 orders had a discount*)
- **The page's long line** waits for wider screens.
- **Old links still open their row:** `#spend`, `#campaigns` and the others.

## AI settings (`/admin/{store}/settings/ai`, `AiProviderForm`)

- **Under the title:** the line saying which AI the store uses. The sentence about pictures waits for wider screens.
- **What the store uses AI for** is a row (*Search by meaning, product texts, the chat*).
- **In *Your own AI provider*:**
  - The provider and key stay open, since the key is required.
  - After them, each part is a row saying what is set:
    - Models (the two models, or *The provider's first choices*)
    - Voice for the chat (*Off: the chat stays text*)
    - Pictures (*Off*, or the model)
    - Live voice (*Off*, or the model)
    - Where requests run (*Text in the EU · nothing kept*)
  - Fields inside a closed row are still sent when the form is saved.
- **Keeping and testing are rows too:** AI manager conversations (*Kept 12 months*) and, with your own AI, the tests.
- **Platform:** Kaizena Flow's own AI page uses the same form, so it gets the rows too.

## Activity log (`/admin/{store}/activity`, `ActivityList`)

- **The filters:** *Who* and *Area* are one choice each (`SelectNav`, a select that goes to the chip's address) in place of the two
  rows of chips.
- **Each entry is two lines:** what happened, then who, the area and the time. The face waits for wider screens, and *Details* is small
  under the line.
- **Platform:** Kaizena Flow's own log uses the same list, so its entries are two lines too.

## How this differs from the boards

- **Marketing:** the discount codes are inside Discounts and coupons rather than a row of their own.
- **AI:** the provider and key are not a row, because the form cannot be saved without the key.
- **AI:** the state at the top is the page's own line rather than a new card.
- **Activity:** the log keeps its pages of 50 with *Older entries* rather than 30 with *Show 30 more*.

## Tests

- Unit tests, lint and types pass.
- The signed-in specs for the activity log, AI settings and marketing run at desktop width, where nothing moved.
