---
title: The listing review checklist (draft)
summary: What Kaizena Flow checks before an app is listed in the app directory. A draft for legal review.
track: developers
section: apps
kind: reference
areas: [apps]
features: []
plans: []
order: 92
checked: 2026-11-04
sources: [D441]
---

> [!WARNING]
> This is a draft, written for legal review with the developer terms and the data processing terms. The directory opens once they are
> approved; until then an approved app waits for it.

Make the app **Listed** on its page to ask for review. Kaizena Flow's review approves it, perhaps with a note, or declines it with the
reason; you are emailed either way, and the decision shows on the app's page. Mend what a decline says and save the app as **Listed**
again to ask again.

## What is checked

- **Who you are.** A name, a homepage on your own domain, a privacy policy and a support address that answers.
- **What it says.** The name and description are true, name no other company as yours, and do not suggest Kaizena Flow made or endorses
  it.
- **What it asks for.** Every scope and power is one the app needs for what it describes. An app that only reads asks for no write.
- **Addresses.** Every redirect URI and the events address are `https://` addresses on the app's own domain.
- **Install and use.** Installing it on a test store works, its calls succeed with what it asked for, and a call it is refused is handled.
- **Events.** It answers deliveries within ten seconds, checks their signatures, and acts on `customer.erased`, `app.uninstalled` and
  `store.erase_requested` as the data processing terms say.
- **Removal.** Removing it from a store leaves the store working, and installing it again works.
