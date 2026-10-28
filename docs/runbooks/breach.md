# Personal-data breach (runbook)

GDPR Articles 33 and 34, for Kaizena Flow. Wave 10 unit P (`docs/wave-10-must-haves.md`), PSI REG-07 and SEC-11
(`docs/audits/psi-2026-10-24.md`). Written 28 October 2026 from the code at `a1e5f117`, the platform's data processing agreement
(`src/lib/platform-legal/en.ts`, section 10) and `docs/security.md`.

> **Draft. Needs the owner's review and a lawyer's before it is relied on.** Nothing here is legal advice. Names, phone numbers and
> the company's legal details are not in the repository: they are marked `[[Add: …]]` and must be filled in before launch. The
> platform's own legal texts still say `[company name to be added]` (`src/lib/platform-legal/en.ts`).

What a breach is (Art. 4(12)): a breach of security that leads to personal data being destroyed, lost, changed, disclosed or
reached without authority, whether by accident or on purpose. It is not only a leak: a bucket lost with no backup
(`docs/runbooks/restore.md`, *Files*) is an availability breach, and an email sent to the wrong customer is a confidentiality breach.

---

## 1. Who decides

| Role | Who | How to reach | Decides |
|---|---|---|---|
| Incident lead | the owner of Kaizena Flow: [[Add: name]] | [[Add: phone, and a second channel that does not depend on Kaizena Flow's email]] | containment, whether it is a breach, every notification |
| Deputy, when the lead cannot be reached within 2 hours | [[Add: name]] | [[Add: phone]] | the same, until the lead takes over |
| Lawyer | [[Add: firm, name]] | [[Add: phone, email]] | reads the notices before they go, where time allows |
| Whoever holds production access | [[Add: the list PSI SEC-09 asks for: Supabase, Vercel, Stripe, Resend, GitHub, Mollie, each with their two-step status]] | | does the technical steps on the lead's word |

The supervisory authority for Kaizena Flow as a Norwegian controller is **Datatilsynet** (the platform's privacy notice names it,
`src/lib/platform-legal/en.ts`, the section on complaints). Notification is made on Datatilsynet's own breach form: [[Add: the form's address on
datatilsynet.no and the login it needs, checked when this is filled in]]. Kaizena Flow's organisation number and address go on it:
[[Add: organisation number, postal address]].

## 2. The clocks

The clock starts when Kaizena Flow **becomes aware**: when a person has a reasonable degree of certainty that a security incident
has touched personal data, not when the investigation ends. Write that moment in the log (section 9) first.

| Whose data | Kaizena Flow is | Duty | Deadline |
|---|---|---|---|
| Owners' and staff's accounts, access requests, visitors to Kaizena Flow's own site, Kaizena Flow's own support desk, the AI manager's conversations and memories | **controller** (privacy notice) | notify Datatilsynet unless the breach is unlikely to result in a risk to people (Art. 33(1)); tell the people themselves when the risk is high (Art. 34) | Datatilsynet **within 72 hours** of awareness; if later, say why. People: without undue delay |
| Each store's shoppers and visitors: customers, orders, carts, addresses, support conversations with a store, reviews, subscribers, checkout answers, email copies | **processor** for the store (the DPA) | tell **each affected store** (Art. 33(2)); the store decides whether to notify its authority and its customers | the DPA promises **without undue delay, and no later than 48 hours** after awareness (section 10 of the DPA). Do not wait for the 72 hours: the store's own 72 hours start when it hears from us |
| Both at once (a database leak) | both | both of the above | the 48-hour store notice is the tighter one |

**Every breach is recorded** (Art. 33(5)), also one that is not notified: what happened, its effects, what was done, and why it was
or was not notified. The log in section 9 is that record. Keep it outside the database it may be about: [[Add: where the breach log
is kept, e.g. a shared document only the incident lead and deputy can edit]].

Information may be given in phases (Art. 33(4)): send what is known within the deadline and follow up.

## 3. First hour

1. Write in the log: the time, who noticed, how, and what is known. Do not paste personal data or secrets into the log: describe them.
2. Call the incident lead. From here, only the lead or the deputy says what is sent outside.
3. **Preserve before cleaning up.** Do not delete rows, logs or deployments that show what happened. Export what is needed (section 5)
   to a place only the lead can reach. Supabase's and Vercel's logs are kept only for their plans' periods ([[Add: each plan's log
   retention, read from the dashboards]]), so read them early.
4. Contain (section 4), the narrowest step that stops it first.
5. If shoppers or owners will notice (a store suspended, sign-ins ended), post an incident on the status page: Platform → Status
   (`/admin/platform/status`, `postIncident()` in `src/server/status.ts`). Say what is affected, never whose data.

## 4. Contain

### 4.1 A secret leaked (key, token, password)

Rotate it, set the new one where it is read, redeploy (Vercel → project → Deployments → Redeploy, or push), and check the thing
still works. Every secret is listed in `docs/security.md` section 4.

| Secret | Make a new one at | Set it in | Watch for |
|---|---|---|---|
| `DATABASE_URL` (the database password) | Supabase → project settings → Database (reset the password) | Vercel `DATABASE_URL`, `READ_DATABASE_URL` if set; GitHub Actions secret `PRODUCTION_DATABASE_URL` (`.github/workflows/ci.yml`, `docs/ci-migrations.md`) | every function fails until redeployed; the CI release job too |
| `SUPABASE_SECRET_KEY` | Supabase → API keys (make a new secret key, then delete the old) | Vercel | uploads, private files, invoices' PDFs, data jobs, two-step resets (`src/server/supabase-admin.ts`, `media.ts`, `invoice-storage.ts`, `data-job-store.ts`, `review-picture-store.ts`) |
| `STRIPE_SECRET_KEY_LIVE` / `_TEST` | Stripe Dashboard → Developers → API keys (roll) | Vercel | checkout, Connect onboarding, billing (`src/server/stripe.ts`) |
| Stripe webhook signing secrets | Stripe Dashboard (roll the endpoint's secret), or make Kaizena Flow's webhooks again from Platform → Stripe (`/admin/platform/stripe`, `connectPlatformWebhooks()`) | kept encrypted in `commerce.platform_webhooks`, not in Vercel | events refused (400) until it matches; Stripe retries for three days |
| `RESEND_API_KEY` | Resend → API keys | Vercel | every email; until set again, emails are only recorded, not sent |
| `RESEND_WEBHOOK_SECRET` | Resend → webhooks | Vercel | delivery events and inbound support mail refused (503 without it) |
| `CRON_SECRET` and Vault `kaizen_cron_secret` | any long random value | Vercel; Supabase Vault (the secret named `kaizen_cron_secret`, which the `pg_cron` jobs read) | scheduled jobs refused until both sides agree (`src/server/cron-auth.ts`) |
| `MOLLIE_CLIENT_SECRET`, `SLACK_CLIENT_SECRET`, `KAIZEN_LIFE_OAUTH_CLIENT_SECRET` | the app's page at Mollie, Slack, Kaizen Life's Supabase | Vercel | new connections; tokens already given are in the database |
| `VERCEL_API_TOKEN`, `VERCEL_DEPLOY_HOOK_URL` | Vercel → account tokens; project → Git → Deploy Hooks | Vercel; GitHub secret `VERCEL_DEPLOY_HOOK_URL` | domains (`src/server/vercel.ts`), deploys from CI |
| `USAGE_DRAIN_SECRET`, `DOMAIN_CONNECT_PRIVATE_KEY`, `VAPID_PRIVATE_KEY` | the drain's settings; a new key pair | Vercel | usage counts; Domain Connect; a new VAPID pair ends every device's push subscription |
| An AI or search provider key (Kaizena Flow's) | the provider's console | Platform → AI (`/admin/platform/ai`), kept encrypted in `ai_providers`, `search_settings` | no AI until saved again; check `ai_usage` for spend after the leak |
| A store's own keys (carrier, AI, Mollie, ad tokens, webhook endpoint, custom app) | the store's owner | the store's own settings pages | it is the store's secret: tell the owner (section 7) |

**`SETTINGS_ENCRYPTION_KEY` is different: there is no rotation yet.** It decrypts every secret in the database
(`src/lib/secret-box.ts`, no key id) and is the root of the derived keys for recovery codes, gift card codes, sign-in counters,
edit passes, private-store passes and visit hashes (`docs/security.md` section 4). Changing the variable alone would make every
stored secret unreadable, end every gift card's code for good (`src/server/gift-card-codes.ts` keeps only an HMAC under it, never the
code) and void every recovery code. If it leaked:

1. Treat every encrypted secret as leaked too: rotate each at its source and tell the stores whose own secrets they are. They are
   in `platform_webhooks` (Stripe webhook secrets), `payment_credentials` (stores' old Stripe keys), `mollie_connections`,
   `kaizen_life_links`, `shipping_carriers`, `ai_providers`, `search_settings`, `google_places`, `ad_connections`, `feed_settings`,
   `store_integrations` (Zapier, Make, Slack addresses), `webhook_endpoints`, `custom_apps` and `domain_purchases` (transfer codes):
   every caller of `encryptSecret()` in `src/server/`.
2. Changing the key itself needs code that does not exist: a script that decrypts with the old key and encrypts with the new in one
   transaction for each table, and a decision about gift cards (re-key their hashes cannot be done without the codes; the cards would
   need new codes sent to their holders). Until that exists, the lead decides between rotating every secret at its source and keeping
   the key, or a planned change of the key with an engineer. PSI SEC-06 asks for the key id and a rotation procedure.

### 4.2 An admin account taken over

1. **Stop the account in the app at once**: `update commerce.accounts set disabled_at = now() where id = '<account id>';` (in the
   Supabase SQL editor). `readSession()` (`src/server/auth.ts`) reads only accounts with `disabled_at is null`, so the next request is
   refused, whatever token the browser holds. No screen does this today (`docs/security.md` section 6).
2. **End its sign-ins at Supabase Auth**: ban or delete the user in Supabase → Authentication → Users ([[Add: check the dashboard's
   current wording]]). An access token already issued stays valid until it expires, which is why step 1 comes first.
3. Its two-step: a platform admin's or a recovery code's reset deletes the account's factors (`src/server/supabase-admin.ts`); the
   account then enrols again. Its recovery codes: a new set revokes the old (`commerce.account_recovery_codes.revoked_at`).
4. A **store member** (not a platform admin): the store's owner removes them on the store's Staff page (`disableStaff()`,
   `src/server/settings.ts`); a collaborator ends at `expires_at`.
5. Check **`ADMIN_TWO_STEP`** in Vercel. It must not be `off`: that lifts the second step for everyone (`src/server/auth.ts`). Anyone
   who signed in while it was on is in the activity log as `account.two_step_switch_off`. Use it only when the lead is locked out, and
   switch it back the same hour.
6. What the account could reach: its stores
   (`select store_id, role, kind, disabled_at from commerce.store_members where account_id = '<id>';`), and everything if it is a
   platform admin.

### 4.3 A store abused, or a store's data exposed

- **Suspend the store** from Platform → Stores → the store (`/admin/platform/stores/{store}`, `suspendStore()` in
  `src/server/store-closure.ts`): its storefront answers 404, it takes no order, and its members may only read and handle what
  already happened. Reopening is on the same page.
- The store's outward doors (owners can do each; in an emergency the SQL is given):

  | Door | Owner's page | SQL |
  |---|---|---|
  | Admin API tokens | Settings → Apps and API (`/admin/{store}/settings/api`) | `update commerce.api_tokens set revoked_at = now() where store_id = '<store>' and revoked_at is null;` |
  | Storefront API tokens | Settings → Apps and API | `update commerce.storefront_tokens set revoked_at = now() where store_id = '<store>' and revoked_at is null;` |
  | WordPress sites | Your account (`/admin/account/wordpress`) | per account, not per store: `update commerce.wordpress_connections set revoked_at = now() where account_id = '<owner account>' and revoked_at is null;` |
  | Webhook endpoints | Integrations (`/admin/{store}/integrations`) | `update commerce.webhook_endpoints set enabled = false where store_id = '<store>';` |
  | Custom MCP apps | Settings → Apps and API | remove the app there |
  | Shopping agents | Feeds (`/admin/{store}/feeds`, the switch) | `update commerce.stores set shopping_agents = false where id = '<store>';` |
  | Shoppers' sessions | none | `delete from commerce.customer_sessions where store_id = '<store>';` (everyone signs in again) |

- Platform-wide, all at once: the same statements without the store condition. They end every integration for every store: the lead
  decides.

### 4.4 A provider breached (Supabase, Vercel, Resend, OpenAI, Stripe, Mollie)

Read the provider's notice, rotate what Kaizena Flow holds of theirs (4.1), and judge what of ours they held: `docs/residency-register.md`
says what each receives. If the provider is the email path (Resend), notices to stores go by another channel.

### 4.5 Something sent to the wrong person, or shown to the wrong person

Stop the sender (switch off the automation, the broadcast, the integration), find every message from `email_messages` or the
delivery log (section 5), and ask the recipient to delete it. It is still a breach to record, and usually one to tell the store about.

## 5. Find what was affected

What each source can say is in `docs/security.md` section 5. The usage drain keeps no IP address, path or user agent
(`src/lib/usage-drain.ts`): it cannot answer *who*. For *who* and *from where*, Supabase's and Vercel's own logs are the sources.

| Question | Where | Query or page |
|---|---|---|
| What did an account do? | `commerce.audit_log` (24 months; `acted_by` says person, AI manager or autopilot) | `select created_at, store_id, action, area, target_type, target_id, acted_by from commerce.audit_log where account_id = '<id>' and created_at >= '<from>' order by created_at;` The store's Activity page (`/admin/{store}/activity`) and Platform → Activity show the same |
| Did it sign in, and from where? | Supabase → Authentication logs; the audit log's `account.signed_in` and two-step entries | dashboard |
| What did it take out? | `commerce.data_jobs` (exports, 7 days of files), `tax_report_exports`, privacy exports in the audit log, `api_tokens.last_used_at` | `select kind, status, requested_by, started_at, finished_at, rows_total from commerce.data_jobs where store_id = '<store>' and started_at >= '<from>';` |
| Which emails went where? | `commerce.email_messages` (address and body for 12 months; Resend's delivery events) | `select kind, status, sent_at, store_id from commerce.email_messages where …` (count first; read addresses only when needed) |
| What did integrations send out? | `commerce.integration_deliveries` (events to Zapier, Make, Slack, owners' endpoints) | by `endpoint_id`, `event`, `delivered_at` |
| Did the AI read it? | `commerce.ai_usage` (store, feature, account, never the text); the AI manager's `assistant_messages` hold what its tools returned | by `actor_account_id` and time |
| Was the Data API used? | Supabase → API logs. It should show nothing for `commerce` (deny-all, `docs/security.md` 2.1) | dashboard |
| What did a function do? | Vercel → Logs (the `log()` lines: ids and counts) | dashboard, by `event` and `storeId` |
| Payments | Stripe and Mollie dashboards (events, each connected account's) | dashboard |
| Code and deploys | GitHub's audit log and the repository's history; Vercel's deployments | |

Then answer, for the log: **which stores**, **which kinds of people** (shoppers, staff, applicants), **how many** (counts, never
names in the log), **which kinds of data** (the `PERSONAL_DATA` register in `src/lib/personal-data.ts` says which columns hold what),
and **whether the data was protected** (encrypted secrets, hashes, a private bucket).

## 6. Judge the risk

The lead decides, with the lawyer where there is time. Questions to answer in the log:

- Is any special-category data involved? Free-text fields can hold health details in some stores (delivery notes, support messages,
  checkout answers; PSI REG-11).
- Can it be used against the people: passwords (Supabase keeps only hashes), payment facts (no card numbers are held:
  `docs/pci.md`), addresses with order contents, gift card codes (kept as HMACs)?
- How many people, and could they be identified?
- Was it only seen by a trusted recipient who confirmed deletion?

A store is told of **every** breach that touches its data, whatever the risk (Art. 33(2)): it is the store that judges the risk to
its customers. For Kaizena Flow's own subjects: no risk likely, record only; a risk, notify Datatilsynet; a high risk, also tell
the people. Where we think a store's customers face a high risk, say so in the store's notice.

## 7. Notices

Write facts only, no guesses presented as facts; say what is not known yet. Never include another store's details in a store's notice.

### 7.1 To Datatilsynet (Kaizena Flow as controller)

On Datatilsynet's form. What Art. 33(3) asks for:

```
Controller: [[Add: legal name]], org. no. [[Add]], [[Add: address]]
Contact: [[Add: name, role, phone, email]]
When it happened: <date and time, or "between … and …">     When we became aware: <date and time>
What happened: <a plain description>
Categories of people: <owners and staff / applicants / visitors>     Approximate number: <n>
Categories of data: <e.g. names, email addresses, account activity>     Approximate number of records: <n>
Likely consequences: <…>
Measures taken and proposed: <containment, rotation, what we tell the people>
People informed: <yes, on …, by … / no, because …>
If later than 72 hours, why: <…>
```

### 7.2 To a store (Kaizena Flow as processor), within 48 hours

Send to the store's owners. Their addresses, without writing them into the log:

```sql
select s.slug, s.name, a.email
from commerce.stores s
join commerce.store_members m on m.store_id = s.id and m.role = 'owner' and m.disabled_at is null
join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
where s.id in (<the affected stores>);
```

```
Subject: Personal data breach affecting <store name> (notice under our data processing agreement)

We are writing because a personal data breach at Kaizena Flow has affected data we process for <store name>.

What happened: <…>
When: <…>; we became aware on <…>.
Data affected for your store: <kinds of data>, about <approximate number> of your <customers / visitors / subscribers>.
Likely consequences: <…>
What we have done: <…>
What we still do not know: <…>; we will write again by <date>.

You are the controller of this data. Under GDPR Article 33 you decide whether to notify your supervisory authority, normally within
72 hours of hearing this from us, and under Article 34 whether to tell the people affected. [[Add: what we can give the store for its own
notice, e.g. counts per kind of data, or how to find the affected customers in its admin]]. Contact: <name, phone, email>.
```

### 7.3 To the people (Art. 34, our own subjects; or for a store that asks us to send its words)

Clear and plain, in the person's own language (the account's admin language, `accounts.admin_locale`, or the store's):

```
Subject: Important: your data at <Kaizena Flow / store name>

On <date> <what happened, in one or two sentences>. It involved your <kinds of data>.
What this may mean for you: <…>
What we have done: <…>
What you can do: <e.g. change your password, watch for emails that pretend to be from us; we will never ask for your password>.
Questions: <contact>.
```

A shopper is told by the store, not by Kaizena Flow, unless the store asks Kaizena Flow to send its words. Never use an address a
person typed into a form: only the account's own or the order's own (`email_messages` keeps who got what).

## 8. After

1. Close the incident on the status page when the cause is fixed.
2. Write a postmortem (what failed, why, what changes) beside the log; if a control in `docs/security.md` failed, change that file and
   its test in the same change.
3. Check the security and performance advisors of the Supabase project, as after any migration.
4. Review this runbook with what the incident taught.

## 9. Breach log

One row per incident, kept also when nothing was notified (Art. 33(5)). No personal data or secrets in the rows.

| # | Aware at | Noticed by, how | What happened | Kaizena Flow as | Stores affected (count) | People (kinds, count) | Data (kinds) | Contained at, how | Risk (none / risk / high) and why | Datatilsynet: sent at, reference, or why not | Stores told at | People told at, or why not | Postmortem |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | |

## 10. Drill

Run this runbook once before launch on an invented breach (say, an export file sent to the wrong owner), timed against the 48 and
72 hours, and write the date and what was missing below.

| Date | Scenario | Time to the store notice | Time to the authority notice | What was missing |
|---|---|---|---|---|
| | | | | |
