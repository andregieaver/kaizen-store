#!/usr/bin/env bash
# Puts the bloat review's saved state back into the session's scratchpad.  bash restore.sh [scratchpad path]
set -eu
D="$(cd "$(dirname "$0")/.." && pwd)"
S="${1:-/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad}"
mkdir -p "$S/work" "$S/state-tools" "$S/m"
cp -r "$D/audits" "$D/verified" "$D/findings" "$S/"
[ -d "$D/digest" ] && cp -r "$D/digest" "$S/"; [ -d "$D/panel" ] && cp -r "$D/panel" "$S/"
tar -xJf "$D/evidence-raw.tar.xz" -C "$S"
cp "$D"/evidence/*.md "$S/m/"
cp "$D"/tools/* "$S/work/"
cp "$D/tools/extract.mjs" "$D/tools/digest.mjs" "$D/tools/check-panel.mjs" "$D/tools/save-state.sh" "$D/tools/restore.sh" "$D/RESUME.md" "$S/state-tools/"
cp "$D/tools/validate-findings.mjs" "$S/"
cp "$D/page/bloat-review.html" "$S/"
cp "$D/evidence-raw.tar.xz" "$S/"
echo "restored to $S; the workflow script is $S/work/bloat-review.workflow.js"
