# Admin redesign, round 31: SEO, Ads and Support reports on a phone

Decision D704, 17 November 2026. The boards are on the design canvas of round 31.

The Activity log stays the tallest store page on a phone, because round 29 kept its pages of 50. After it came:

| Page | Height on a phone |
|---|---|
| SEO and reach | 3,416 px |
| Ads and conversions | 3,303 px |
| Support reports | 2,981 px |

Below 640 px wide, each page changes as described here; from 640 px it is as before, unless a part says otherwise.

## SEO and reach (`/admin/{store}/settings/seo`)

- **The first card** says whether search engines and AI assistants can find the store, with the sitemap, robots.txt and llms.txt.
- **The one thing to fix** is an amber strip: *2 of 12 product pictures have no words of their own*, with *Describe*.
- **Each part of the form is a row saying what is set:**
  - In search results (the title and description)
  - Share picture (*Drawn from the store's name*, or your own)
  - Your business elsewhere (*No profiles yet*, or how many)
  - AI assistants (*May read and answer · may train*)
  - Advanced (*Listed · no extra rules · not verified*)
- **One wide Save** follows the rows. Fields in a closed row are still saved.

## Ads and conversions (`/admin/{store}/ads`)

- **Sending sales:** Meta, Google Analytics 4 and TikTok are one row each.
  - A platform that is not connected says *Not connected*, with *Connect*.
  - A connected one says how many sales it sent in the last 7 days, with *Change*.
- **Spending:** Ad budgets (Meta) is a row after them (*Your Meta ad account · the AI manager can move budgets*).
- **The page's line** is shorter: *Sales sent to your ad platforms, for shoppers who allowed marketing cookies.*

## Support reports (`ReportsView`, the store's and the platform's)

- **A period with no conversation is one card at every width:** *No conversations in the 30 days*. It says what the figures will
  be, and links to the inbox. It replaces the dozen cards of *None yet* and the tables of zeros.
- **With conversations, on a phone,** the four parts are rows:
  - Conversations (*24 started · 3 still open*)
  - Waiting and answering
  - How it went
  - What they asked about

## How this differs from the boards

- **Support reports:** the rows after the first do not show an answer of their own yet. Their figures stay inside, since several are
  shown only from 10 conversations.
- **Ads:** the Connect press opens the platform's fields in place rather than a separate page.

## Platform

- The platform's support reports use the same view, so they get the empty card and the rows too.
- The platform has no ad connections of its own.
- Kaizena Flow's own SEO is set on its site pages.

## Tests

- Unit tests, lint and types pass.
- The signed-in specs run at desktop width, where these pages are as before, except Support reports with no conversation.
