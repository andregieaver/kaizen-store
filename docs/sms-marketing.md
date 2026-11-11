# SMS marketing (D565)

Offers by text message, for the Nordic and EU shops that asked for it, built on 11 November 2026 when the owner chose it as the next
thing to build (reversing D405's "skipped for now").

## 1. The provider

**46elks** (Stockholm, processes in Sweden): a REST API with Basic auth (`POST https://api.46elks.com/a1/sms`, form fields `from`, `to`,
`message`, `dryrun`, `whendelivered`), incoming texts posted to a number's `sms_url`, delivery reports posted to `whendelivered`, and costs in
ten-thousandths of the account's currency (`cost`, `estimated_cost` on a dry run). Each store connects **its own** account (the owner's API
username and password, kept encrypted), so it pays 46elks directly and Kaizena Flow never resells texts. Chosen over Sinch and Twilio
because it is EU-based, priced per text with no subscription, and its API needs no SDK. Recorded in `docs/residency-register.md`'s spirit:
the store's provider, processing in Sweden.

## 2. Consent (criterion 2)

- A number's consent is its own (`sms_subscribers`), never email's. Its words, time and source are kept, and every change of status is
  written by the table's trigger to `sms_consent_events`.
- Checkout offers an unticked box *Text me offers from {store} at this number. I can stop at any time with the link in each message.* (nb, sv,
  da, en; hand-written, to be read by a lawyer) only when the store has SMS on. Ticked, a mobile number field appears. The pay press keeps the
  consent `pending` on that order; the five-minute job makes it `subscribed` once the order is paid, and drops it after 7 days unpaid. The
  payment never waits on it.
- Nothing is texted without consent: the database refuses a message for a number that is not `subscribed`, and refuses marking one sent
  after the number stopped.

## 3. Stopping (criterion 2)

- Every text ends with the number's own link (`/sms/{token}`, 22 characters): a page with one button. A press stops the texts, never the
  link itself, because phones open links to show a preview.
- With a 46elks number in the settings, texts come from it and a reply whose first word is STOP, STOPP, AVSLUTT, SLUTA, AFMELD, LOPETA and
  the like stops them at once (`/api/sms/{key}/inbound`; connecting points the number's `sms_url` there).
- Staff stop a number for its owner from the list. Erasure deletes the number with its history and texts.

## 4. Sending (criterion 3)

- A text message goes to every subscribed number or a saved segment's (by its address or account), with the same segments as email.
- Each text waits for its reader's hours: the country's time zone (one per country), 09:00 to 20:00 unless the owner narrows them (never
  before 08:00 or after 21:00), and never on a Sunday in France. Public holidays are not known.
- Countries a store may text: the EU's, the EEA's, Switzerland and the United Kingdom.
- Before it starts, the price is 46elks's own dry run, one per country with a real reader's whole text (every part), times that country's
  readers; a text message that would take the month past the owner's cap is refused. While sending, the job stops a store's campaigns as soon
  as the month's real cost reaches the cap.
- A text is at most 4 parts (the store's name first and the stop link last are counted).

## 5. My account (11 November 2026)

A signed-in customer turns texts on or off under My account → Text messages, shown while the store has SMS connected: their number
(their saved phone filled in) and the store's consent words; on is a subscription at once with source `account` (they are signed in, so no
confirming text), off stops the number as a STOP reply does (`accountSms()`, `setAccountSms()` in `src/server/sms.ts`).

## 6. Not built yet

A sign-up form's phone field; automations by text (back in stock; an abandoned-checkout text was weighed on 11 November 2026 and left
out: checkout's box only counts once the order is paid, so almost no abandoned checkout has a number that may be texted); public holidays per
country; the AI manager's tools for texts (a new tool needs a new safety-eval run). Not tried against 46elks itself (no account in the
sandbox): built from its documentation and a stand-in.
