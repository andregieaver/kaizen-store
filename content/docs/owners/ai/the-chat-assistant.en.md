---
title: The chat assistant
summary: Put an AI chat assistant on your shop that answers shoppers from what your store publishes, and hands them to your team when a person is needed.
track: owners
section: ai
kind: how-to
areas: [ai, customers, website]
features: []
plans: []
admin: /admin/{store}/chat
order: 30
checked: 2026-11-04
sources: [D81, D216, D334, D382, D391, D428]
---

## Switch it on

1. Open **Support** in the menu and choose [Chat assistant](/admin/{store}/chat).
2. Under **The agent**, tick **Show the chat on the site** and give it a **Name**. If you like, add a picture, an **Occupation** (such
   as *Customer service*) and a **Greeting** for each language; left empty, it introduces itself by name.
3. Under **Guidance for the agent**, write in your own words the tone and what to point out, such as *Friendly and short. Suggest the
   gift wrapping for presents.* It follows your guidance within its own rules.
4. Press **Save**.

The chat then shows in the corner of every page of your shop. It needs your store's AI to have a text model: until then, the page
says *On, but hidden until the site has an AI text model.*

## What it answers from

The chat assistant answers only about your store, from what the store publishes:

- your published pages and articles, and the content entries your site shows;
- your products, with their prices and stock, and your shipping, countries and contact details;
- the documents in its **Knowledge base**.

It states products, prices, stock and policies only as your shop gives them: the AI never makes them up. Products it finds are shown
as cards that the shop draws, with the shop's own prices. It can open pages of your shop for the shopper while you talk: a product, a
page, an article, a search or the cart.

Whatever your pages, articles or knowledge base speak of is on topic, a comparison with another company included: it searches
before it says it can only help with your store, and says nothing of the other company that your pages do not say. Anything else it
turns away. Sentences that make environmental claims, false urgency or best-price claims are taken out of its answers.

### Add to its knowledge

The knowledge base holds what it should know beyond your pages: delivery and returns in detail, care guides, sizes, opening hours,
answers to common questions.

1. Under **Add a document**, give a **Title**.
2. Choose a file (Text, Markdown, PDF or Word, up to 4 MB), or paste its text under **Or its text**.
3. Press **Add to the knowledge base**.

Write only what may be told to anyone: the assistant can quote it to shoppers. Never put personal data in it. A knowledge base holds
up to 100 documents. Your pages are read again within five minutes of being published.

## What shoppers are told

While the AI answers, the chat says it is an *AI assistant*. Under the message box, shoppers read that answers are written by AI and
may contain mistakes, and not to share personal details in the chat, followed by how long the conversation is kept. With the AI first
and your team behind it (below), it gives the assistant's name, says it is an AI assistant, and adds *You can ask for a person at any
time.*

When your support desk lets the AI read the tone of customers' messages, or summarise conversations for your team, the notice says
that too, before the customer writes. **Support settings** tells you which of the two are on, and that customers are told.

## Hand over to people

Who answers your customers is chosen in [Support settings](/admin/{store}/support/settings) (Support, Settings), under **Who answers
your customers**:

| Choice | What happens |
|---|---|
| **Support off — the chat assistant alone** | The chat assistant answers by itself. Nobody takes over, and conversations are kept for a day after they end. |
| **The AI first, then your team** | The assistant answers first. A customer can press *Talk to a person* at any time, and the assistant hands over when it cannot help. |
| **Your team only** | Your people answer every conversation. The AI never writes to your customers. |

With the AI first, a conversation also goes to your team when the AI does not answer, when the chat's messages for the day are used
up, or when a customer's tone falls past the line you set. Conversations waiting for a person are in the
[Support inbox](/admin/{store}/support), and the Support tab shows how many wait. Open one and press **Take over** to answer;
**Hand back to the AI** gives it back.

For a customer who signs in in the chat, the AI first can look up their own orders, parcels, returns, bookings and subscriptions. It
can offer the actions you allow under **What the AI may do for customers**, such as moving a booking or sending the order
confirmation again: nothing happens until the customer presses *Confirm*. Anything else, such as a refund, cancelling a paid order or
a new address, it passes to your team as a request on [Requests](/admin/{store}/support/requests); the customer is told when you
decide. The AI never gives a refund, a withdrawal, an order change, a code or credit itself.

## More options

- **Let visitors talk**: shoppers press the microphone and speak, and the assistant answers aloud as well. It needs speech models and
  a voice in your store's [AI settings](/admin/{store}/settings/ai); until then the chat is typed only.
- **Messages a day**: after this many, the chat rests until the next day, which caps what it costs. With the AI first, conversations
  go to your team instead.
- **Picture frame**: a background, border and shadow for the assistant's picture.
- **Keep transcripts for** 30, 60 or 90 days after a conversation ends (90 at first, the owner's choice), under Support settings,
  Advanced. Then the words are deleted and only counts are kept.
- **This store handles health or other sensitive information.** While this is on, no AI reads what customers write: people, not the
  AI, answer the chat and emails, and transcripts are kept 30 days at most.
- Messages from your contact forms can come into the inbox while support is on. The AI never reads or answers them.
- **Support by email**: forward your support address to the inbox, and every email becomes a conversation there. With the AI first,
  the assistant answers general questions by email; anything about an order goes to a person, and each answer by the AI says it is
  the AI's.
