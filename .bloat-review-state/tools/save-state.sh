#!/usr/bin/env bash
# Saves the bloat review's working state to the session branch (never to main). Safe to run at any time, and again.
set -u
S=/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad
W=/root/.claude/projects/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/subagents/workflows
WF=/root/.claude/projects/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/workflows/scripts/bloat-review-wf_e3268582-217.js
T=/home/user/kaizen-state
BR=ccr-fc510f5b-x0whis
line=$(node "$S/state-tools/extract.mjs" "$S" "$W" 2>&1 | tail -1)
cd "$T" || exit 1
git fetch -q origin main "$BR" 2>/dev/null
git merge -q --no-edit "origin/$BR" >/dev/null 2>&1
git merge -q --no-edit origin/main >/dev/null 2>&1
D="$T/.bloat-review-state"
mkdir -p "$D/tools" "$D/page" "$D/evidence"
for d in audits verified findings digest panel; do rm -rf "$D/$d"; [ -d "$S/$d" ] && cp -r "$S/$d" "$D/$d"; done
cp "$S/STATUS.md" "$S/status.json" "$S/evidence-raw.tar.xz" "$D/"
cp "$S"/m/*.md "$D/evidence/"
# The review's own tools only: the reviewers leave large scratch files beside them.
for f in "$D"/tools/*; do case "$(basename "$f")" in build-docs.mjs|plan-data.mjs|main-template.md|summary.mjs|audits.mjs|measure-routes.mjs|routes-md.mjs|chunks.mjs|loaded.mjs|dead.mjs|clones.mjs|storm.mjs|shot.mjs|shot-sections.mjs|build-page.mjs|page-v4.html|findings-totals.json|extract.mjs|digest.mjs|compact-stewards.mjs|check-panel.mjs|save-state.sh|restore.sh|validate-findings.mjs|bloat-review.workflow.js|bloat-grade-panel.workflow.js) ;; *) git rm -q --cached "$f" 2>/dev/null; rm -f "$f" ;; esac; done
for f in build-docs.mjs plan-data.mjs main-template.md summary.mjs audits.mjs measure-routes.mjs routes-md.mjs chunks.mjs loaded.mjs dead.mjs clones.mjs storm.mjs shot.mjs shot-sections.mjs build-page.mjs page-v4.html findings-totals.json; do cp "$S/work/$f" "$D/tools/" 2>/dev/null; done
cp "$S"/state-tools/*.mjs "$S"/state-tools/*.sh "$S/validate-findings.mjs" "$D/tools/"
[ -f "$WF" ] && cp "$WF" "$D/tools/bloat-review.workflow.js"
PW=/root/.claude/projects/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/workflows/scripts/bloat-grade-panel-wf_dfd6e2d1-e25.js
[ -f "$PW" ] && cp "$PW" "$D/tools/bloat-grade-panel.workflow.js"
cp "$S/bloat-review.html" "$D/page/"
cp "$S/state-tools/RESUME.md" "$D/RESUME.md"
git add -A .bloat-review-state
if ! git diff --cached --quiet; then
  git commit -q -m "Bloat review, working state: $line" -m "Saved by the session's state loop. Not for main." -m "Claude-Session: https://claude.ai/code/session_01URyFZNCJ4wAswtAb6PgZL3"
fi
git push -q origin "HEAD:refs/heads/$BR" 2>&1 | tail -1
echo "$(date -u +%H:%M) saved: $line"
