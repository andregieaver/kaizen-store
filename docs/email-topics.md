# Topics and a preference page (email plan M4.2)

The plan for M4.2, written before any of it is built: *the store's own topics; the subscriber picks topics and how often, or pauses for
a month; consent per topic kept as a record*. This page is the design. Each slice gets its own commit and a line under "Built".

## What Homer sees

- **The owner.** Under Marketing → Subscribers, *Topics* lists what the store writes about. A store with no topics works as today: every
  broadcast goes to everyone who wants the store's emails. Adding one (*News*, *Offers*, *Workshops*) is a name per language and one
  checkbox, *New subscribers get it* (on by default). A broadcast then asks one thing more, *About*, set to *Everything* unless he picks a
  topic, and the count under the audience says how many people want that topic.
- **The reader.** The link at the foot of every marketing email says *Choose what you get or unsubscribe*. It opens one page in the
  store's look: a box per topic, *How often*: *Everything we send*, *At most once a week* or *At most once a month*, then *Save*.
  Underneath it, *Pause for a month*, then *Unsubscribe from everything*. No sign-in and no script: the link's token is the key, as today,
  and each press is a plain form post, so a mail scanner that opens links changes nothing.

Lisa's depth: per topic, its description shown on the page and whether new subscribers get it; per subscriber, the record of every topic
choice (when, from where, the words shown); the AI manager and the API read and write topics.

## Rules

1. **Topics are the store's own.** `commerce.marketing_topics`: a name and an optional line per language (the store's languages, the
   main one required), `default_on`, a position, archived rather than deleted (a choice once made is a record). At most 20 a store.
2. **Consent per topic is a record.** `commerce.marketing_topic_choices` keeps every change, never updated: subscriber, topic, in or out,
   when, the source (`preferences`, `form`, `staff`, `api`) and the words the person saw. A subscriber's current topics are the newest
   row per topic; with none, the topic's `default_on` (*Readers get it unless they turn it off*). Unsubscribing from everything stays the subscriber's status, as today; topics never re-subscribe
   anyone.
3. **A broadcast about a topic goes only to those in it.** `broadcasts.topic_id`, null for *Everything*. The audience count and
   `startBroadcast()`'s frozen list both read `inTopic()`, one rule. A flow email is about the flow's goal, not a topic: flows are not
   held back by topics in this step.
4. **How often** is the subscriber's own limit, on top of the store's contact policy (D764): `frequency` on the subscriber, `all`,
   `weekly` (at most one marketing email in 7 days) or `monthly` (one in 30). The policy's `recentContacts()` already reads what reached
   them; the stricter of the two wins. A held broadcast email is skipped with the reason `frequency`, as the policy's are.
5. **Pause for a month** sets `rest_until` to 30 days on: marketing email is held until then, as the sunset's pause holds it
   (`suppressed()`), and nothing is counted as sent. The page says until when and offers *Start again now*.
6. **The page** replaces the store's unsubscribe page for a subscriber's token (a cart reminder's token keeps its own page). It is the
   store's site, in the market's language, a server component with server actions and no client script, so the storefront's script
   budgets do not move. The email footer's words change in every language.
7. **The platform.** Kaizena Flow's own list is its house store's (D467), so its topics and page are the same.

## Slices

| Slice | What | Migration |
|---|---|---|
| 1 | Topics: the table, the admin list (add, rename per language, order, archive), the choices table, `inTopic()`, a broadcast's *About* and its count, `startBroadcast()` by topic. | topics and choices, `broadcasts.topic_id` |
| 2 | The preference page: topics, how often, pause for a month, unsubscribe; the footer's words; `frequency` and `rest_until` held at send. | `frequency`, `rest_until` |
| 3 | Sign-up forms may offer topics; a subscriber's page shows their topic record; the AI manager's and the API's topics (contract bump). | none |

## Built

- **Slice 1, 23 November 2026.** `marketing_topics` and `marketing_topic_choices` (migration `right_scarecrow`), written only by
  `src/server/marketing-topics.ts`; `inTopic()` the one rule. The subscriber list has a *Topics* card: each topic's readers now
  (`topicCounts()`), add, change per language, order, archive and bring back. A broadcast asks *About* where the store has topics; its count
  and its frozen list read `inTopic()`. A reader's topic choices are in their data export and go with the subscriber.
- **Slice 2, 23 November 2026.** The page an email's foot links to (*Choose what you get or unsubscribe*, in every storefront
  language) shows a subscriber their topics (`readerTopics()`), how often, *Pause for a month* (or the date it ends and *Start again
  now*) and *Unsubscribe from everything*, in the store's look, as a server page with one form action (`emailChoiceAction`, which
  replaced the old unsubscribe action, so the page adds no server reference). `src/server/email-preferences.ts` saves by the token;
  `marketing_subscribers.frequency` and `rest_until` (migration `tiny_rattler`) are held in `suppressed()`, one statement with the sunset,
  the look back at what was sent run only for a reader who chose a limit. A cart reminder's token keeps the plain unsubscribe page.
- **Slice 3, 23 November 2026.** A sign-up form's settings name the topics it puts people in (*Topics they get*, store and Kaizena
  Flow's own forms, the latter with its house store's topics); the sign-up keeps each as the reader's choice with the words they agreed to
  (`keepOnList()`, source `form`), with no script added to the storefront. A subscriber's page in the admin shows *What they chose* and
  every topic choice (`readerChoices()`). The AI manager's `draft_broadcast` takes a `topic` (refused with the store's topics where unknown,
  so no new tool) and `list_broadcasts` says each one's topic (API 1.55). Visitors ticking topics themselves on a form is left for later:
  it would put client code on the order page's path, whose first scripts are at their budget.
