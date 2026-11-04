---
title: Data processing terms for apps (draft)
summary: What an app accepts for the personal data it receives from the stores that install it. A draft for legal review.
track: developers
section: apps
kind: reference
areas: [apps]
features: []
plans: []
order: 91
checked: 2026-11-04
sources: [D441]
---

> [!WARNING]
> This is a draft, written for legal review together with the [developer terms](/docs/developers/apps/developer-terms). It will be
> replaced by the reviewed terms before any app is listed in a directory.

A store that installs your app is the controller of its customers' personal data. When your app reads or receives that data, you process
it on the store's behalf, under these terms, which are part of the developer terms.

## What you may do with it

- Process a store's personal data only to provide your app to that store, as its listing and install screen describe.
- Never sell it, use it to build profiles across stores, or use it to train models that serve anyone but that store.
- Keep it in the EU or EEA, or under the safeguards the GDPR requires for a transfer, and name your sub-processors on request.

## Keeping it safe

- Protect it with measures fit for the risk: encryption in transit and at rest, access only for the people who need it, and logs.
- Tell Kaizena Flow and the store without undue delay, and within 48 hours at the latest, of any breach that touches it.

## Erasing it

- When you receive `customer.erased`, erase that customer's data from your systems within 30 days.
- When you receive `store.erase_requested`, erase what you keep of that store within 30 days, unless the law requires you to keep it.
- Help the store answer its customers' requests to see, correct or erase their data.

## Audits

Answer Kaizena Flow's and the store's reasonable questions about how you meet these terms, and allow an audit when the GDPR gives the
store the right to one.
