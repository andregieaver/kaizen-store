# DP-8 ✓ A 26 MB icon package is installed and parsed each build for 26 paths

Dependencies (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 0.36.
- **Second check:** confirmed.
- **Where:** `src/components/brand-icon.tsx:1-28`, `src/components/brand-icon.tsx:35-36`, `src/components/brand-icon.tsx:46-78`, `package.json:69`
- **Evidence:** brand-icon.tsx imports 26 named icons from simple-icons, which holds 3,467 (re-counted). The 26 paths total 19,982 bytes. The package is 26 MB installed and its entry module, which the bundler reads on every build to pick those 26, is 5,255,349 bytes. LinkedIn's mark is already hand-kept in the same file because the package dropped it (line 35), and the dependency is one of four with a caret range. Tree-shaking works: no unused icon is in any chunk. The licence is CC0-1.0.
- **Cost today:** 26 MB of install, a 5.25 MB module parsed per build, and a package that removes brands in major versions. Nothing at run time. Paid by: The build and CI installs; nobody's browser or function.
- **Saving:** 26 MB less to install; one 5.25 MB parse less per build. The time saved is small and not measured: tidiness, not speed.
- **Risk:** Low. A brand that redraws its mark must be updated by hand, as LinkedIn's already is. The footer's social links would show a wrong or empty mark; the unit test catches an empty one.

## The fix

1. Create src/components/brand-marks-data.ts with one entry per network: { path, hex } copied from simple-icons 16.36.0 for the 26 names imported at brand-icon.tsx:1-28, plus the LinkedIn entry now at lines 35-36 and 78. A node one-liner over require('simple-icons') writes the file; say in its header where the paths came from, the version and that the licence is CC0-1.0.
2. src/components/brand-icon.tsx: delete the simple-icons import and the Object.fromEntries block (lines 46-77); BRANDS becomes the imported data. brandColor() and BrandIcon stay as they are.
3. package.json: remove simple-icons; run pnpm install so pnpm-lock.yaml follows.
4. Add a unit test beside src/lib/social-links.test.ts: every SocialNetwork has either a brand mark or a stroked mark, and every path starts with M.

**Done when:** rg -n 'simple-icons' package.json src prints nothing, and du -sm node_modules/.pnpm falls by about 26 MB.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/social-links.test.ts: must pass; gains the coverage test
- docs/decisions.md D91 (social media buttons): no rule names the package; no edit
- DP-6's dependencies scan would have flagged nothing here (the package is imported); this is a size call, not a dead dependency

**Notes:** Costs the build only, so it waits until brand-icon.tsx or the social links are next touched.
