---
title: The AI manager
summary: Ask the AI manager about your store, let it do work in the admin for you, and say yes to each change before it reaches customers or costs money.
track: owners
section: ai
kind: how-to
areas: [ai, settings]
features: []
plans: []
admin: /admin/{store}/assistant
order: 10
checked: 2026-11-04
sources: [D73, D94, D103, D104, D105, D308, D318, D350, D391]
---

## Open it

Press **AI manager** in the admin's header, or press ⌘K (Ctrl+K on Windows) on any page of your store's admin. It opens as a panel
beside the page: the page stays usable, and the conversation goes on as you move from page to page. Escape closes it.

Write what you want in plain words and press **Send**. A new conversation offers a few questions to start with, such as *What needs
my attention?*, and help with the page you are on. Press **Stop** to stop an answer; if you close the page instead, the answer
finishes and is there when you open the conversation again.

The [AI manager's own page](/admin/{store}/assistant) has every conversation, with the tabs **Memory**, **Skills** and **Autopilot**.
**Full page** in the panel opens the conversation there.

> [!NOTE]
> Only the store's owners have the AI manager. It uses your store's AI and needs a text model: without one it says so, with a link to
> set one up under AI.

## What it can do

The AI manager knows every page of the admin, and opens the one you need. It answers from your store's own data through its tools:
it never states a price, a stock level or a product that a tool did not give it, and figures are added up by code, never by the AI.
Under each answer, *Used:* lists the tools it used.

Ask it, for example, to:

- tell you how sales, orders, products, stock and customers are doing, or run a report;
- find an order, a product or a customer, and add a note to an order;
- make or change products: their texts, prices, pictures and status;
- build and change pages, menus and the standard header and footer, or add a theme and try it;
- set up the store: business details, countries, languages, currencies and shipping;
- draft a newsletter, tag customers, or make a discount or a campaign;
- change an order, propose or process an exchange, or refund one;
- read your support conversations, leave a note on one, or answer the customer;
- invite, change or remove staff, and change or end your plan.

A page it builds is made after its answer, and its pictures one by one. Until it is done, the Pages list shows it under *Being made
by AI*.

Some things only you can do: connect payments, choose your first plan (paid by card on Stripe's page, see
[Choose a plan](/docs/owners/getting-started/choose-a-plan)) and make an agreement with a carrier. It does not moderate product
reviews: a review's words never go to the AI.

## What it asks your yes for

Drafts, and things only you see, it changes at once, as you would in the editor. A change that reaches customers, the site or your
money is kept instead: a card under its answer says what it will do, with **Approve** and **Decline**. Only **Approve** makes the
change, once. Each card says what kind of change it is:

| The card says | For example |
|---|---|
| *Sends something in the store's name* | an email to a customer, a newsletter, an answer in support |
| *Changes what the site shows* | publishing a page, a change to a live product, a discount |
| *Costs money* | a refund, an order change, a gift card, a theme that costs money, your plan |
| *Changes who works in the store and what they may do* | inviting or removing staff |
| *Changes your domain: where it points, its email or its renewal* | a change to your domain's records |
| *Starts work in your name* | starting an autopilot plan |

While your store is being set up, it changes setup settings at once; once the store is open, those wait for your yes too. Opening
the store always waits.

You can also say yes in words, typed or spoken. It counts only when your own message plainly says yes, and only for a change that was
already waiting. A card nobody answers is dropped after seven days: *No answer in seven days, so it was not done.*

Every change it makes is in the **Activity log** (Settings, Account) under your name, marked *through the AI manager*.

## Notices

The AI manager can finish things while you are away: a page it built, a follow-up it answered, a change waiting for your yes, a
question or a report from the autopilot. A number on the **AI manager** button counts the new ones. **Notices**, at the top of the
panel, lists them, and each opens its conversation or page. [AI manager notices](/admin/account/notices), in your account menu, lists
those of all your stores. Notices are kept for 60 days.

## Follow-ups

Ask it to come back to something later: "On Friday, check whether order 1042 has been sent", or "Every Monday, tell me what needs a
look". At that time it does the task in the same conversation, with what your role may do that day, and emails you that the answer is
there; the email never holds the answer itself. A follow-up can repeat every day or every week, at the same time of day. It never says
yes for you: a change still waits for your yes.

The follow-ups waiting are listed on the [Autopilot](/admin/{store}/assistant/autopilot) page's **Decisions** tab, under *What the AI
manager will come back to*, each with **Cancel**. You can also ask the AI manager to list or cancel them.

A follow-up is at least five minutes and at most a year ahead, and you can have 20 waiting in a store. One that fails three times
stops.

*Ask the AI manager* is also a button beside an analytics alert, and an action of an order rule under
[Automation](/admin/{store}/settings/automation).

## More options

### Memory

The AI manager keeps what you tell it to remember ("Remember that we never ship on Fridays") and learns how you work from your
conversations and from the thumbs you give its answers. The **Memory** tab shows *What it knows about you*: change a memory, **Forget**
one, **Forget everything**, or **Download as a file**. Untick **Learn from my conversations** to keep only what you tell it.

Memories are yours: only you and your AI manager see them. It never keeps customers' details or passwords. Learned notes it does not
use fade over time; what you told it stays.

### Skills

A skill is a way of doing a job you come back to, in your own words. Press **Save as skill** under something you asked, or ask the
AI manager to save one. On the **Skills** tab you give it a **Name**, **When to use it** and its **Steps**, one a line, at most 2,000
characters, never a password or a customer's details. Ask for a skill by name, or the AI manager uses it when the job comes up. The
tab also lists the playbooks it knows already, under **Built in**.

**Share with the store's other owners** lets them use it too (staff who are not owners have no AI manager). A skill never lets anyone
do more than they may, and never skips a yes.

### Voice

Press the microphone beside the **AI manager** button, or **Voice mode** in a conversation, and talk: it listens, answers aloud and
listens again, and you can talk over it to cut in. When your store's AI has a *Live voice* model, voice mode is a call instead: it
hears you while it speaks. Voice mode needs the AI settings' *Speech to text* and *Text to speech* models and a *Voice*, or a
live voice model.
**Read aloud** reads written answers out.

### How long conversations are kept

Conversations hold what the tools read, customers' names and emails among them, so their messages are deleted 12 months after they
were written. An owner can choose from 1 to 60 months under Settings, AI, **AI manager conversations**: type the months in **Keep
for (months)** and press **Save**, or leave it empty for 12. A conversation left empty goes too, unless an autopilot plan, a
follow-up or a change waiting for your yes still uses it.

You can delete a conversation yourself at any time. Deleting your account erases your conversations with the AI manager, your
memories, notices and saved skills.

The AI manager answers up to 300 messages a day in a store; after that it is back the next day.

### Its AI and your key

The AI manager uses the same AI as the rest of your store: Kaizena Flow's, included in your plan, unless an owner chooses the store's
own provider under [Settings, AI](/admin/{store}/settings/ai). There, **Your own AI provider** takes the provider, its API key and the
models; **Use my own AI** saves them, and **Go back to Kaizena Flow's AI** returns. Your own provider is paid on your own account with
them, and your products and shoppers' searches are then sent to it, so make sure your agreement with them covers personal data. The
key is kept encrypted and only ever sent to that provider.

AI on Kaizena Flow's AI counts towards your plan's AI limit ([Choose a plan](/docs/owners/getting-started/choose-a-plan)). Owners see
what the AI used under [AI usage](/admin/account/usage).
