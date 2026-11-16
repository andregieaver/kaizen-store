# A deploy that hurts a challenge store (runbook)

`docs/100-day-challenge.md` F5, D625. During the 100-day challenge a store is run by the autopilot alone and judged against another store,
so a deploy that breaks it costs more than an ordinary bug: lost orders count against the clone, and a person stepping in counts as an
intervention. This is what the platform team does when a deploy may have hurt a challenge store.

## What protects the store already

- **The deploy's smoke.** After every deploy `scripts/await-deploy.mjs` asks production for the challenge stores' pages
  (`/api/health/smoke`: each store's front page and cart in its main market) and requests them beside `SMOKE_PAGES`; one that does not
  answer 200 fails the job, and the job's log names it.
- **The pin and its log.** What each challenge store's AI runs on (every agent's prompt version, the tools' version and the text model)
  is pinned when the challenge is set. The dispatcher's job `challengeVersions` compares it every five minutes, and each change is
  logged on the challenge with its time. The console (Platform → Settings → 100-day challenge) shows the pin and the last changes.
- **The rule.** During the run a change to the autopilot's prompts or tools is a bug fix only. Each one shows in the log; say in its
  commit why it was needed.

## When the smoke fails on a challenge store, or the console shows a change nobody meant

1. **Look first, change nothing in the store.** Open the store's pages and its autopilot page; read the job's log and Vercel's runtime
   errors for the store. A person's change inside the store is an intervention (A5); a platform fix is not.
2. **Roll the platform back, not the store.** In Vercel: Deployments → the last good production deployment → *Instant Rollback*. It
   serves the earlier build at once and touches no data. Then revert the commit on `main` (`git revert`), so the next push does not bring
   it back, and push; CI deploys the revert.
3. **A migration came with it?** A migration is additive (CLAUDE.md, Database), so the earlier build runs on the newer schema. Never
   drop or undo a migration by hand: write a new one if something must change, and let CI apply it.
4. **Check the store again.** Its pages answer 200, `/api/health` reports the commit you meant, and the console's log shows the versions
   going back to the pin (each move is logged; that is expected).
5. **Write it down.** A line in `docs/decisions.md` (or the open incident's) with what broke, for how long, and the commits; the referee
   reads the console's log beside it at Day 50 and Day 100.

## When the model's provider fails

The autopilot falls back to the provider's fallback models by itself (F1, Platform → AI). Changing the platform's model during the run is
a platform change and shows in the log; prefer the fallback list to switching the model.
