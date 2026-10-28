# Data protection impact assessment: the AI features (draft)

GDPR Article 35. Wave 10 unit P (`docs/wave-10-must-haves.md`), PSI REG-07 and REG-08 (`docs/audits/psi-2026-10-24.md`), the DPIA
`docs/plan.md` asks for before the assistant launches and `docs/support.md` section 8 leaves to the company. Written 28 October 2026
from the code at `a1e5f117`: every *data in* and *kept out* below was read in the prompt builders and tools named beside it.

> **A draft for the owner and a lawyer.** It describes what the code does and lists risks and measures; it does not conclude that
> any processing is lawful or compliant, and none of its *legal basis candidates* has been chosen by anyone with the authority to
> choose. The conclusions in section 6 are proposals. Where something is not known (a provider's retention, what is set in
> production's dashboards), it says so.

Related: `docs/security.md` (how the boundaries are held), `docs/runbooks/breach.md`, `docs/residency-register.md`,
`src/lib/personal-data.ts` (the register of personal data, `PERSONAL_DATA`).

---

## 1. Why an assessment, and who it is for

Article 35 asks for one where processing is likely to result in a high risk, in particular with new technologies. These features
use large language models on people's words, and one of them (tone scoring) scores customers' messages and can move a conversation
on the result. As the residency register records it, customers' messages and searches go to a provider outside the EEA (section 2). That is reason enough to assess before
relying on them; whether a DPIA is *required* for each feature is a lawyer's call. Datatilsynet publishes a list of processing that
always needs one: [[Add: each feature checked against Datatilsynet's list, by a person]].

**Who is the controller differs by feature**, and so does whose assessment this is:

| Processing | Controller | Kaizena Flow |
|---|---|---|
| A store's chat, support desk, tone, summaries, recommendations, the AI manager reading the store's customers and orders | the store | processor (the DPA, `src/lib/platform-legal/en.ts`); this document is the help the DPA promises under Art. 28(3)(f) and its section 9, *Other assistance* ("data protection impact assessments"), and each store makes its own |
| Kaizena Flow's own chat and support desk (on Kaizena Flow's site and for owners from the admin), the AI manager's conversations and memories of owners and staff, Kaizena Flow's own AI settings | Kaizena Flow | controller: this document is its own assessment |
| A store that connects its **own AI provider** (`commerce.ai_providers` with a `store_id`) | the store | Kaizena Flow sends the requests to the provider the store chose and is not a party to that provider's terms (`docs/residency-register.md`, "A store's own AI provider") |

## 2. The provider, and where it processes

- **Which provider**: a database setting, never named in code (D73, `src/server/ai.ts`, `aiFor()`): Kaizena Flow's connection, or a
  store's own, which replaces it while on. What production uses today is not in the code. `docs/residency-register.md` records that
  Kaizena Flow's AI was set on 27 September 2026 to **OpenAI, directly at `api.openai.com`, which processes in the United States**
  (`text-embedding-3-small` for search vectors, `gpt-4.1-mini` for text). Which models are set for pictures, vision, speech and the
  AI manager's live voice is not recorded there: [[Add: read Platform → AI and record each model and provider]].
- **Contract**: the register lists OpenAI's DPA (standard contractual clauses) as **to do**. The platform's privacy notice names OpenAI
  and relies on the Data Privacy Framework or standard contractual clauses (`src/lib/platform-legal/en.ts`, sections 4 and 5).
- **Retention and training at the provider**: not recorded in the repository. Zero data retention is requested in code only on the
  Vercel AI Gateway path (`gatewayOptions()` in `src/server/ai.ts`); for the direct OpenAI connection it is whatever the contract
  says. [[Add: OpenAI's retention for API data and whether it trains on it, from the signed terms]].
- **EU path**: the register names OpenAI's EU data residency (`eu.api.openai.com`, which refused a key from an ordinary project when
  tried on 27 September, so it waits for an EU project key), the gateway pinned to the EU for text (`inferenceRegion`), or Mistral.
  D10 prefers the EU where a comparable option exists.
- **Web research** (the AI manager): searches go to **Brave Search** (`api.search.brave.com`, `src/lib/web-search.ts`), a US
  company (D329), which is **not in the register** (PSI REG-06).
- **Metering**: every call is recorded in `commerce.ai_usage` (store, feature, account, tokens, cost; never the text), 400 days
  (`src/lib/retention.ts`).

## 3. Measures common to every feature

| Measure | Where | Held by |
|---|---|---|
| Every system prompt says text from the site, customers, files, pictures, web pages and tools is data, never instructions | `UNTRUSTED_TEXT`, `RULES_STAND` (`src/lib/prompt-safety.ts`) | `src/lib/prompt-safety.scan.test.ts` |
| The model never states a price, stock or product a tool did not give; arithmetic is done in code; output is drawn as text, never HTML | CLAUDE.md conventions; each feature's cleaner | per feature below |
| Customer-facing AI words pass the claims filter (green, urgency, best price, money, stock) | `findClaims()` (`src/lib/claims.ts`) | `src/lib/claims.test.ts` |
| An injection eval of the chat and the AI manager with their real prompts and tools | `src/lib/agent-eval.ts`, run from Platform → AI | `src/lib/agent-eval.test.ts` (cases); the run is by hand |
| A store on Kaizena Flow's key stops getting AI at its plan's monthly limit | `aiRoomLeft()` (`src/server/ai.ts`) | `src/server/limits-enforce.int.test.ts` |
| No AI: every feature carries on without it (a failed call is *not measured*, a fallback, or a person) | `AiError` handling at each call | per feature |
| Personal data register: every table that can hold a person's data is listed with its export section and what erasure does to it (which can be nothing) | `PERSONAL_DATA` (`src/lib/personal-data.ts`) | `src/db/privacy.test.ts` |

## 4. The features

Each feature: what it is for, what reaches the model, what is kept out, legal basis candidates (for the controller to choose),
retention, risks and the measures in code.

### 4.1 The shopper chat and AI-first support (chat, voice, email)

**Purpose.** Answer visitors' questions about a store (or Kaizena Flow) from the site's own data; with support on the AI first
(`ai_first`), answer customers about their own orders and hand over to a person (D81, D216).

**What reaches the model** (`systemPrompt()` in `src/lib/chat.ts`, `runChat()` in `src/server/chat-agent.ts`, `runSupportTurn()` in
`src/server/support-turn.ts`):
- the conversation: the last `AI_HISTORY` (20) messages, read from the database (`historyForAi()`), the customer's words as the
  user's, a person's prefixed as theirs; staff notes and the partner's help are left out;
- the page the visitor is on, today's date, the agent's name and the owner's instructions and brand voice;
- tool results: products, prices and stock from the catalogue, the store's pages and knowledge documents (`searchKnowledge()`);
  for a **signed-in** customer only, their own orders (number, date, status, lines, amounts, delivery label, tracking numbers,
  returns), bookings, subscriptions, boxes and bonus balance (`src/server/support-tools.ts`); 
- by voice: the recording, sent for transcription (`transcribeAudio()`, `src/app/api/chat/voice/route.ts`), and the answer's text for
  speech (`speakText()`); the recording is not stored, its transcript is the message;
- by email (D332): the email's words as the customer's message (`src/server/support-inbound.ts`).

**Kept out.** No tool returns a customer's address, email or phone to the chat model (the order tools return lines, amounts and
tracking, read in `orderDetails()`); the model is told never to ask for an email, card number, password or code
(`systemPrompt()`); an order is found only among the signed-in customer's own; by email nobody counts as signed in, so no order tool
runs (`NOT_BY_EMAIL`); the chat never runs on pay routes (`OffPayRoutes`, `docs/pci.md`).

**Legal basis candidates** (the store's choice, or Kaizena Flow's for its own desk): Art. 6(1)(b) where the visitor asks about a
purchase or their order; Art. 6(1)(f) for general questions (a legitimate interest in answering visitors, balanced against what they
expect from a labelled AI assistant). Special categories (Art. 9) are not intended, but a visitor may write them (section 5).

**Retention.** Messages are kept with the conversation and deleted at the desk's transcript period (`transcript_days`, 90 days by
default, `src/lib/retention.ts` `support_transcripts`; with support off, a day after the conversation ends); the anonymised record
24 months; erasure deletes them (`anonymiseConversations()`). The tab keeps only its conversation's reference and a copy
(`kaizen_chat`, session storage, `KNOWN_COOKIES`). Inbound emails' sender and subject 30 days (`support_inbound_emails`).

**Measures.** The visitor is told it is an AI (`labels.aiAssistant` in `src/components/chat-widget.tsx`; the person's name after a
hand-over; email answers marked as the AI's, `aiLabel`/`aiNote` in `src/lib/support-email-text.ts`); answers pass `cleanReply()`
(plain text, no addresses, no claims); links are buttons made by code; actions run only on the customer's own Confirm
(`src/server/support-actions.ts`), refunds, cancellations and exceptions go to a person; turns are counted before any model call
(`takeTurn()`); a person can be asked for at any time (`handoff_to_human`). The store privacy starter tells shoppers about the
assistant and the provider (`privacy.automated.chat` in `src/lib/legal-starters/en.ts`). Tests: `src/lib/chat.test.ts`,
`src/server/chat.int.test.ts`, `src/server/support-tools.int.test.ts`, `support-actions.int.test.ts`, `support-inbound.int.test.ts`,
`e2e/chat.spec.ts`, `e2e/support.spec.ts`.

### 4.2 Tone scoring in support

**Purpose.** Notice a customer who is getting upset, so a person looks sooner; with the AI first, hand the conversation to a person
at the desk's line (D216 step 6, `src/server/support-tone.ts`).

**What reaches the model.** The customer's latest message and up to four before it in the conversation (customer, AI and staff
lines; `TONE_CONTEXT`, `tonePrompt()` in `src/lib/support-tone.ts`). The answer is a score from -100 to 100 and a label.

**Kept out.** No customer identity is sent; the score is never shown to the customer; a missing score is *not measured*, never 0;
nothing about the customer is decided from it beyond the conversation's place in the queue and an alert to staff.

**Legal basis candidates.** Art. 6(1)(f), which needs a written balancing test: it is a systematic evaluation of what people write,
which they may not expect. Art. 22 does not seem to apply (no legal or similarly significant effect: the only effect is that a person
answers sooner), but that is for the lawyer.

**Retention.** The score sits on the message and the conversation and goes with the transcript.

**Default.** `support_settings.tone_on` defaults to **true** in the schema (`src/db/schema.ts`), so it is on for every desk whose
support mode is not `off`, unless the owner turns it off.

**Risks and gaps.** Customers are **not told** their messages are tone-scored: neither the store privacy starter nor the chat says so
(`legalFacts()` passes only whether the chat is on; PSI REG-02, REG-08). A message holding health or other sensitive details is
scored like any other (PSI REG-11).

### 4.3 Summaries and briefs in support

**Purpose.** A short summary of a finished conversation for staff (outcome, topics, what is still to do), and a brief for the person
who takes one over (D216 step 7, `src/server/support-summary.ts`).

**What reaches the model.** The transcript (`transcriptOf()` in `src/lib/support-summary.ts`): the customer's, the AI's and staff's
messages, staff notes marked as such, staff's names as they sign their lines, events in words; at most 12,000 characters, the start
cut first.

**Kept out.** The partner's help; anything after a conversation was anonymised. The answer is kept only through `parseSummary()`
(closed lists of outcomes and topics).

**Basis candidates.** Art. 6(1)(f) (running the desk). **Retention**: the summary is on the conversation and cleared by erasure;
summaries are on by default where support is on (`summaries_on` defaults to true). **Gap**: customers are not told transcripts are
summarised by AI (PSI REG-02).

### 4.4 The silent partner and translation for staff

**Purpose.** Help the person answering: facts and a draft (the partner), and translating a customer's message or a reply (D216 steps
8 and 13, `src/server/support-partner.ts`, `src/server/support-translate.ts`).

**What reaches the model.** The conversation, who the customer is and their earlier conversations, and what the AI manager's read-only
tools give the person's own role: `PARTNER_OWNER_TOOLS` in `src/lib/support-partner.ts` include `get_order`, `get_customer` and
`list_customers`, so a customer's **name, email and phone** can reach the model here (as in 4.5). Translation sends the one text.

**Kept out.** The partner never writes to the customer; its answer is a staff-only message; a draft passes `cleanReply()` and
`guardedForVisitor()`; translations are shown or put in the composer, never stored or sent, and a translated reply is marked
*Translated by AI*. It reads only what the person's role may read (`partnerToolsFor()`).

**Basis candidates.** Art. 6(1)(f) or (b). **Retention**: with the transcript (4.1).

### 4.5 The AI manager, the autopilot, and what they reach

**Purpose.** The owner's and staff's assistant in the admin, and the autopilot that works toward the owner's goals within their limits
(D94, D103, D309; `src/server/owner-assistant.ts`, `src/server/autopilot-runner.ts`).

**What reaches the model.** The person's messages (typed, or by voice through the speech models; the live voice talks with the
provider directly over WebRTC, `src/server/live-voice.ts`), their memories (`memoriesFor()`), the page they are on, and **tool
results from the store's own data**, which include personal data: `get_customer` returns a customer's name, email and phone,
`list_customers` names and emails, `get_order` the buyer's email and name (`src/server/owner-tools.ts`); support tools return a
conversation's messages (`get_support_conversation`). Web pages and search results the manager reads (D329). Answers from an owner's
own MCP apps (D363).

**Kept out.** An erased or restricted order shows no person (`orderPrivacy()` in `getOrderTool()`); gift messages, a buyer's VAT
number and VIES's answer are not given; reviews' words never reach a model (no tool returns them; `reviews_overview` gives counts);
blog comments give ids and facts only. Memory refuses anything with an `@`, a long number or a password, and its prompt forbids
customers' personal details (`readLearned()` in `src/server/assistant-memory.ts`); names are not refused by code.

**Where it goes further.** A custom app's tool receives the arguments the model writes, which can carry what it read: the owner chose
that app (D363). Searches go to Brave with words the model chose.

**Basis candidates.** For staff's own conversations and memories, Kaizena Flow as controller relies on its contract (Art. 6(1)(b), the
privacy notice section 3). For the store's customers' data the manager reads, the store is controller (its own business purposes,
Art. 6(1)(b) or (f)); whether reading customer records through a model is compatible with the purpose they were collected for
(Art. 6(4)) is a question for the lawyer.

**Retention: the main gap.** `assistant_messages` holds what tools returned, so customers' names and emails can sit in staff's
conversations, **with no retention period** (`src/lib/personal-data.ts`: "a retention period is the owner's decision") and **not reached
by a shopper's erasure** (`src/server/privacy-erasure.ts` does not touch `assistant_messages`; checked by search). Learned memories lose importance after
60 days unused and the least important go after 180 days unused; memories the person told it to keep stay until they forget them (`fadeMemories()`); approvals keep the gated call's arguments (`assistant_approvals`).
Owner and staff accounts cannot yet be erased (PSI REG-03).

**Measures.** Every tool is checked against the person's role and the store's features (`requireToolPermission()`, `mayUseTool()`);
emailing, publishing, spending and access changes are kept for the person's yes (`keepForApproval()`), the autopilot runs a gated call
only within the owner's levels and budgets and never one marked never automatic (`autopilotDecision()`, `NEVER_AUTOMATIC`), emails to
one customer are capped a week; a custom app's non-read tools wait for a yes and its answer is text only, as data; AI text for
customers passes `findClaims()`. Tests: `src/server/owner-assistant.int.test.ts`, `src/lib/owner-tool-permissions.test.ts`,
`src/lib/autopilot-autonomy.test.ts`, `src/server/ai-manager.int.test.ts`, `src/server/custom-apps.int.test.ts`.

### 4.6 AI product texts

**Purpose.** Suggest a product's description, search texts or a translation for staff to edit and copy in (D76,
`src/server/product-writer.ts`, `src/lib/product-writing.ts`).

**What reaches the model.** The product's own words and facts from the editor, the target language and the brand's voice. **Kept out**:
prices, stock and discounts (the prompt forbids them and they are not sent). Nothing is saved to a product by the writer; staff
copy what they want; claims filtered; each suggestion logged without its text.

**Personal data.** Normally none. **Basis**: not needed where there is none. **Retention**: nothing kept but the log line.

### 4.7 Alt texts, and pictures made or edited

**Purpose.** Describe library pictures for people who cannot see them (D89, `src/server/alt-texts.ts`, `src/lib/alt-text.ts`); make a
picture from a description (D283, `makeSitePicture()` in `src/server/picture-maker.ts`); edit a library picture (D349,
`src/server/picture-editor.ts`).

**What reaches the model.** For alt texts: the picture's small copy and where it is used (`Used in:` titles of pages and products).
For a made picture: the person's words, the site's look and what it is about, never a picture. For an edit: the library's own file.

**Personal data.** Only if a picture shows a person: owners upload photographs, which can show staff, models or customers; the
alt-text model may then describe them. A made picture's prompt asks for no faces except where a content pack marks `people`
(invented models, D282). **Basis candidates**: Art. 6(1)(f) for the owner's own pictures; the owner's own rights in the photograph are
theirs. **Retention**: alt texts are kept with the picture until changed; an edit is a new picture beside the original.

**Measures.** The AI never writes over staff's alt text (`alt_source`); alt texts pass `parseAltTexts()` with the claims filter; a
picture goes to a model only through `seeing()`, which picks the vision model or none.

### 4.8 Translation

**Purpose.** Translate a store's pages, products, categories and fields (D110, `src/server/store-translate.ts`), a page from the
builder (`src/lib/page-translate-ai.ts`), and the interface's words into other languages (D111, the platform's catalogue).

**What reaches the model.** The store's own texts; the interface's English messages. **Personal data**: normally none, though a
page an owner writes may name people (staff, authors). **Measures**: every suggestion is read and ticked by a person before
`applyTranslations()` writes it; pages are saved only as drafts; legal texts start unticked (`isLegalPage()`); answers are checked
for shape, length and claims. **Retention**: what the person accepts becomes the store's content.

### 4.9 Recommendations re-ranking, and search

**Purpose.** Order product recommendations for the visitor's session (D139, `src/server/recommend.ts`, `src/lib/recommendations.ts`);
understand a search and search by meaning (D74, D75, `src/server/query-understanding.ts`, `src/server/search.ts`).

**What reaches the model.** For re-ranking (`rerankUser()`): the session's products (ids and titles), what was searched, the start of
the page's text, candidate products. For search: the words typed, as text to understand and as a vector. **Kept out**: no person, no
cookie identity; the tab's session (`kaizen_rec`, session storage) carries a random id; the model only orders ids the code chose
(`parseRerank()`, `applyRerank()`), never for the held-out arm, under the owner's monthly token cap.

**Personal data.** Pseudonymous at most, but a search can hold a name or a health word (the register says so: "shoppers' searches,
which can hold personal data"). **Basis candidates**: Art. 6(1)(f). **ePrivacy**: `kaizen_rec` is listed as *necessary*
(`KNOWN_COOKIES` in `src/lib/cookie-consent.ts`); whether storage for personalised recommendations is strictly necessary is a
question for the lawyer. **Retention**: searches 90 days (`search_queries`); the model's answers 30 days in `commerce.search_cache`
(vectors, filters and re-rankings under an MD5 key, `src/server/search-cache.ts`), which is **in neither `PERSONAL_DATA` nor
`NOT_PERSONAL`** (checked by search; filters may keep words the shopper typed, `cleanFilters()`).

## 5. Risks

Likelihood and severity are proposals for the owner to confirm.

| # | Risk | Features | Likelihood | Severity | Measures in place | Left over |
|---|---|---|---|---|---|---|
| R1 | Customers' words and, through the AI manager and partner, customers' names, emails and phone numbers go to a US provider without a signed DPA | all, mostly 4.1 to 4.5 | certain while the platform's AI is direct OpenAI | medium | privacy notice names OpenAI; transfer by DPF or SCC claimed | DPA unsigned; no ZDR on the direct path; provider retention not recorded |
| R2 | A visitor or a text the model reads makes it act or say something it should not (prompt injection) | 4.1, 4.4, 4.5 | possible | medium to high | `UNTRUSTED_TEXT`; tools checked by role; actions gated or confirmed; outputs cleaned; injection eval | the eval is not in CI |
| R3 | The model states something false about an order, a price or a right | 4.1, 4.5 | possible | medium | facts only from tools; claims filter; withdrawals only to the withdrawal page | none beyond the model's errors in wording |
| R4 | Customers are scored and summarised without being told | 4.2, 4.3 | certain today | low to medium | score never shown, never decides more than the queue; can be turned off per desk | not disclosed (REG-02, REG-08); on by default |
| R5 | Sensitive data (health, in a clinic or care store) in messages, searches or checkout answers goes to the model | 4.1 to 4.5, 4.9 | possible in some stores | high for those people | the starter tells shoppers not to write sensitive data to the chat | no store setting that turns AI summaries, tone or AI email answers off for sensitive trades (REG-11) |
| R6 | Customer data copied into the AI manager's conversations outlives the customer's erasure and has no retention | 4.5 | likely | medium | erased orders show no person to the model | `assistant_messages` not erased and not pruned |
| R7 | A store's own provider or an owner's custom app receives data outside Kaizena Flow's contracts | 4.1, 4.5 | possible | medium | the store's choice, said on the page; https and `safeFetch()` | relies on the store's own agreements |
| R8 | Search caches and recommendation storage hold shoppers' words longer or more widely than the register says | 4.9 | possible | low | 30-day prune; random tab id | `search_cache` not in the register; `kaizen_rec` classed necessary |
| R9 | A person in an uploaded picture is described or sent to a model | 4.7 | possible | low | alt text only from the store's own library; no faces asked for in made pictures | none |

## 6. Proposed conclusions (draft)

None of these is a decision. For the owner, with a lawyer:

1. **Before relying on 4.1 to 4.5 with real customers**: sign OpenAI's DPA, or move Kaizena Flow's AI to the EU path the register
   names, and record the provider's retention and training terms (R1). Bring the register up to date (Brave, Resend's inbound mail).
2. **Tell customers** about tone scoring and AI summaries in the chat and in the store privacy starter, in all four languages (R4);
   consider whether tone should start off rather than on.
3. **A retention period for `assistant_messages`**, and erasure of a customer's data from it, or stop the manager's tools from
   returning contact details where a name or a key would do (R6). Owner and staff account erasure (REG-03).
4. **A "sensitive information" switch** for stores (no tone, summaries or AI email answers; shorter retention) (R5, REG-11).
5. Put `search_cache` in the register, and have the lawyer read `kaizen_rec`'s category (R8).
6. Run the agent safety eval in CI (R2).
7. Write `docs/ai-act.md`: each feature's AI Act classification and its Article 50 measure (REG-08).
8. Each store needs its own assessment for its own use of these features; Kaizena Flow offers this document as the processor's help.

## 7. Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Owner of Kaizena Flow | [[Add]] | | |
| Lawyer | [[Add]] | | |
| Data protection officer, if one is appointed | [[Add: whether one is required]] | | |

Review this assessment when a feature in section 4 changes what reaches the model, when the provider changes, and at least yearly.
