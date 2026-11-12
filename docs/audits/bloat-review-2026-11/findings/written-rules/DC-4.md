# DC-4 ✓ Half of the rules' text is in lines the search tool cannot show

The written rules and the agents' context (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.40.
- **Second check:** corrected.
- **Where:** `docs/rules/admin/marketing.md:202`, `docs/rules/admin/website.md:302`, `docs/rules/admin/website.md:439-441`, `docs/rules/admin/platform.md:229`, `docs/rules/admin/README.md:8-13`, `docs/rules/storefront.md:9-12`, `CLAUDE.md:97`, `CLAUDE.md:135`
- **Evidence:** CLAUDE.md:97 and :135 tell agents to read a rule before changing its part. The seven rule files are 49 to 163 KB. 156 lines are over 500 characters and hold 291,981 of 564,581 bytes (52%): website.md 62 lines (110,926 bytes), commerce.md 35 (73,887), marketing.md 18, ai.md 20, platform.md 12, integrations.md 6, storefront.md 3. The longest is 7,436 characters (marketing.md:202). The Grep tool prints no text for any of them (tested on decisions.md, same limit). storefront.md shows the working shape: a bullet wrapped into short continuation lines (lines 9-12). 151 of 295 rules have a body of one line. 292 rules open by repeating their heading's words (29,043 bytes). The README's counts say 241 admin rules; the files hold 262.
- **Cost today:** A content search of the rules returns no text for the lines that hold 52% of the bytes. The agent then reads the whole line (up to 7.4 KB, about 1,900 tokens, estimate) or searches through the shell, where one hit is the whole paragraph. Paid by: An agent's session
- **Saving:** 291,981 bytes of rule text (52%) become visible to a content search, and a hit returns one sentence instead of a paragraph of up to 7.4 KB. No saving is claimed for reading a rule: it can already be read alone by its heading.
- **Risk:** A break in the wrong place could split a list item or a code span: the script never breaks inside backticks, and the whitespace-collapsed comparison plus one rendered look at website.md and commerce.md catch the rest. A phrase search across a line break misses; that is already so in storefront.md and in every wrapped doc.
- **Already tracked:** no (step 1.10 keeps the area files and moves the index to their tops)

## The fix

1. Write scripts/wrap-docs.mjs (DC-2's split can use it too): for each line over 500 characters in docs/rules/storefront.md and docs/rules/admin/*.md, break it at sentence ends ('. ' before a capital, a backtick or an asterisk; then at '; ' if a piece is still over 400) into continuation lines of the same list item, indented two spaces under its '- ', never inside a code span. Markdown joins the lines, so the rule renders the same.
2. The script proves it changed no word: each file with every run of whitespace collapsed to one space must be byte-identical before and after, or it exits 1. Commit this alone and say so in the message.
3. In a second commit delete the per-area rule counts in docs/rules/admin/README.md:8-13 (stale: 241 against 262); the README check at rules-index.test.ts:45-49 only needs each file's name in brackets.
4. Lower DC-3's baseline: docs/rules long lines 0.
5. Not as a sweep: when a rule over 4,000 bytes is next changed (24 today, held by the baseline), cut it to its invariants with a pointer to the section of its feature doc, and drop the repeat of the heading in its first line.

**Done when:** awk 'length($0)>500' docs/rules/storefront.md docs/rules/admin/*.md | wc -l prints 0 (today 156), and the script reports the seven files identical once whitespace is collapsed.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/rules-index.test.ts reads only '## ' headings and the README's links: line breaks inside a rule do not affect it.
- docs/rules/admin/README.md:4-5 and line 3 of each area file say the rules were moved verbatim: the break keeps every word.
- CLAUDE.md:97 and :135 (read the rule before changing that part) stay.

**Notes:** The skeptic set effort M for a hand check of 156 lines. A mechanical break with a proof of no changed word makes it S. Shortening rules and dropping the repeated headings changes wording, so it waits for the next edit of each rule.
