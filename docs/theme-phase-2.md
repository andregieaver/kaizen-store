# Seamless switching: phase 2 of the theme store (D242)

Phase 2 of `docs/theme-store.md` (section 9): an owner switches between themes and back with no word, picture, video, link or menu changed,
and the look follows. Built in steps, each pushed on its own; this file says what each step is and, once built, what it found.

| Step | Builds | Done when |
|---|---|---|
| 1. Section styles | `ThemeSettings.sectionStyles`, `PageRow.sectionStyle`, the core names, layering, the Theme tab and the row's choice | a row naming a style looks as the live theme says, a theme without it gives its Plain, and pages that name none look as before |
| 2. The page migration for real | `detachThemeValues()` run per store with the page's content before kept, undo, report | a store's pages look the same after (parity test) and follow the theme from then on |
| 3. Try and preview | customising a theme that is not live, a preview link on the store's own site, *What changes* | an owner sees their own pages in another installed theme without visitors seeing anything |
| 4. Updates | owner's changes kept apart from the version, follow updates, *What's new* | a new version reaches installs that follow, with the owner's changes laid over it again |
| 5. Launch themes and `themeCheck()` | the checks of `docs/theme-store.md` 7 and 3 to 5 Kaizena themes | every launch theme passes, and the switch e2e (every content field the same before and after) passes on each |

## Step 1: section styles

**What it is.** A *section style* is a named set of theme elements (D182: row, h1 to h6, p, list, button) for the rows that name it. A row
naming `hero` takes, for itself and what it holds, the theme's `hero` elements laid over the theme's own elements (`layerUnder()`), and its
own settings win over both, at the sizes it sets them (as D182). Nothing is ever written into the page: a row stores only the name.

**Names.** `CORE_SECTION_STYLES` (`src/lib/section-styles.ts`): `plain`, `hero`, `feature`, `muted`, `contrast`, `quote`, each with a label
and a hint. Every Kaizena theme defines the core names, so switching between them always lands; a theme may add its own (a lowercase name
of letters, digits and hyphens, at most 12 in all). A row naming a style the live theme does not have takes the theme's `plain`; with no
`plain` either, the theme's own elements, as a row naming none.

**Data.** `ThemeSettings.sectionStyles?: Record<name, ThemeElements>` (part of the theme's settings, so it travels with a design profile's
snapshot, a theme's versions, installs and saved themes without anything new); `PageRow.sectionStyle?: string` (a name, never CSS; kept by
copies and templates, as any setting of a row).

**Drawing.** `themedRows(rows, elements, sections)` takes the section styles beside the elements; `themeLayersFor(owner)` reads both (the
store's theme, or Kaizena Flow's own, D235). The builder's canvas lays them the same way, so the canvas and the site agree.

**Editing.** The Theme tab edits the site's elements or one section style's (a choice at the top: *Whole site* or a style), with the same
fields. A row's General tab chooses its section style (*None* keeps the row on the site's elements). Saved by `saveThemeTab()` with the rest
of the tab.

**Built (D242).** `src/lib/section-styles.ts`, `layerElement()` and `sectionStylesSchema` in `src/lib/theme-elements.ts`, `themeLayersFor()` in `src/server/theme-elements.ts`, the Theme tab's *Elements for* and the row's *Section style* in `page-builder.tsx`; held by `src/lib/section-styles.test.ts` and `e2e/theme-elements-live.spec.ts`.

**Not in step 1.** Section styles on components other than rows (a button already has its variants), and Kaizena's launch themes defining
them (step 5).
