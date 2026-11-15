# Admin redesign, round 15: Legal pages, Tax, Domains

Decision D647, 15 November 2026. The boards are on the design canvas of round 15 (today and proposal for each page). Built as drawn,
for Homer first, with Lisa's depth one step away. The rules of the round: what the law needs is a checklist, not a page of text;
explanations read once go in a fold; an address is shown whole, with a way to copy it; one Save per row.

## Rows that open in place

`FoldRow` (`src/components/admin/fold-row.tsx`), first drawn for Company in round 10, is now shared: a row with its title and what is true,
and Change (Add, Choose) that opens its form in place. Company, Legal pages and Tax use it.

## Legal pages (`/admin/{store}/settings/legal`)

- A sentence (`legalLead()`): *None of your legal pages is chosen, so checkout shows no terms.*, *{n} of your {total} legal pages are chosen.*
  or *All your legal pages are chosen.*, counting the pages the store needs now.
- *Make all {n} drafts*: one press makes a starter of every kind the store needs that has neither a page chosen nor a draft
  (`createAllStartersAction`, each through `createLegalStarter()` as before), with the warning that no lawyer has checked them.
- The details the drafts lack are one line with *Fill them in* (Company).
- *Your legal pages*: one row per page (chosen, a draft waiting, or none yet) with Choose or Change, which opens the page picker, the
  starter and the AI's buttons; *Written by AI* is a row of its own (on, off, or why it is not available here); *At checkout* is a row
  with the mode and what it cannot honour, its form under Change. The review notice stays at the foot while the AI is off.

## Tax (`/admin/{store}/settings/tax`)

- A sentence: *Prices include VAT; the store is not registered for VAT.* (or registered as its number), then the page's own words.
- *Your registrations*: VAT registration, OSS and IOSS as rows saying what is true (the number and its check, the scheme and member state,
  the IOSS number and its markets); reverse charge, where selling to businesses is on, a row that only tells. "What is on" became the rows.
- Each row's Change opens that part's form alone (`TaxProfileForm` `part`), which sends the other parts' saved values unseen, so the one
  action saves the profile whole and the other parts stay as they were. The VAT number check sits in the VAT row.
- *Read this with your accountant* is a fold.

## Domains (`/admin/{store}/settings/domains`, before the store domain is set up)

- The store's whole address with Copy and View store; *Your own domain* as a row saying it is not available yet. Once the platform's store
  domain is set up, the page is as before.

## What differs from the boards

- The legal rows list each page on its own (the board grouped four for space).
- The VAT number check keeps its card inside the VAT row rather than a line under the field.

## Platform

Kaizena Flow writes its own legal pages under Pages → *Write the legal pages* (terms, privacy, DPA, D408); giving that the same sentence
and rows is the next step. Tax and Domains are store-only: Kaizena Flow sells its plans
through Stripe and runs on its own domain.

## Tests

`activity-and-legal.test.ts` reads the sentence and the one-press drafts; `tax-profile-form.test.ts` one part with the others kept;
`e2e/signed-in/vat-screens.spec.ts` opens the VAT row before filling it.
