# Owners from trial to plan (email plan M4.5, D886)

The plan's row: *the house store's flows on the platform's events: trial started, store published, first order, trial ending, plan
paid, store closed*. The owner chose service emails (D886), so this is a journey of six hand-written emails, not flows.

## What an owner gets

| Step | When | What it says, and the button |
|---|---|---|
| Trial started | their store's trial began (in the last two days) | Welcome; the three things to do first; when the trial ends. *Open your store's checklist* |
| Store published | the store was opened to shoppers | It is live; share its address; the trial's end. *See your store* |
| First order | its first paid order | Congratulations; how to send it. *Open the order list* |
| Trial ending | two to three days left, no plan chosen | When it ends, what happens then (the store goes private, nothing is lost) and how to choose. *Choose a plan* |
| Plan paid | a plan started with real money | Thanks; where billing lives. *Open billing* |
| Store paused | the trial ended with no plan, so the store went private | It is private, kept as it was; one press reopens it. *Choose a plan* |

## Rules

1. Every active owner of the store, the first by when they joined; never a template, demo, sandbox or Kaizena Flow's own store.
2. Each step once per store: the email's key is `owner-journey:{step}:{store}`, and the job looks back two days only.
3. No offer or promotion in any of them; each ends with why it came and a link to the account settings that turns them off.
4. Words in English and Norwegian, by the owner's admin language.

## Built
- **23 November 2026.** `src/server/owner-journey.ts` (`sendOwnerJourney()`, the dispatcher's `ownerJourney`) finds every due step in
  one statement over `commerce.store_plans` and the store, sends `platform.owner_journey` from Kaizena Flow with the key
  `owner-journey:{step}:{store}`, and skips an owner whose `accounts.owner_journey_off_at` is set (migration `furry_mindworm`). The words
  are in `src/lib/owner-journey.ts`; Billing has the switch beside plan reminders, one action for both.
