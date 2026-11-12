# AC-5 ✓ The page builder loads everything at once: 3.3 MB of script before the first paint

What an owner's browser loads in the admin (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 2.15.
- **Second check:** corrected.
- **Where:** `src/components/admin/page-builder.tsx:14`, `src/components/admin/page-builder.tsx:15`, `src/components/admin/page-builder.tsx:96`, `src/components/admin/block-fields.tsx:3`, `src/components/admin/block-fields.tsx:33`, `src/components/admin/page-builder-fields.tsx:8`, `src/components/admin/rich-text-editor.tsx:128`, `src/components/admin/markup-input.tsx:17`, `src/components/inline-edit/markup-editor.tsx:54`, `src/components/inline-edit/rich-text-inline.tsx:17`, `docs/audits/code-review-2026-11.md:106`, `docs/audits/code-review-2026-11.md:281`
- **Evidence:** route-bundle-stats.json: 3,303,372 bytes raw / 1,014,731 gzip on a store's editor routes; 39 routes carry the builder's own chunk of 460,704 bytes (26 editors and the 13 previews of AC-2). Against a plain list the builder adds, by the verified report, 2,164,685 bytes: its own chunk, Tiptap 435,421, the storefront's text in four languages 318,693 plus 49,242 (AC-6), components' fields 136,082 and 114,972, the page-content schema 74,836, dnd-kit 43,245, and about 150 KB of English copies of builder, blocks and fields that the page also hands down (AC-9). page-builder.tsx (6,658 lines) and block-fields.tsx (3,644) hold no import() or next/dynamic. Four modules import Tiptap, and they are imported at eight lines in five files (page-builder.tsx 14, 15, 96; block-fields.tsx 3, 33; page-builder-fields.tsx 8; fields-form.tsx 41; term-page-fields.tsx 10): with those eight edges cut my closure of the builder route no longer reaches @tiptap. The canvas mounts the inline editors only when a text is pressed.
- **Cost today:** 3.30 MB raw / 1.0 MB gzip on the first open of the builder, and the changed chunks again after a deploy. PSI PERF-01 and code review FB8 name the editors for the admin's 3.93 s largest paint at p75, measured on the team's own use. Paid by: An owner's browser on every page, article, header, footer and layout edit; a prospect's browser in the sandbox.
- **Saving:** Estimate: the first load from 3.3 MB to about 2.3 to 2.4 MB raw from the three named cuts (the storefront's text about 350 KB, Tiptap 435 KB put off, English copies about 150 KB), lower once the dialogs load on demand. AC-1 saves nothing here: the builder needs zod, the Supabase client and its own English itself.
- **Risk:** Medium. A text pressed, or a dialog opened, before its chunk has arrived must show a waiting state and keep the press; a field that appears late must not move the form. It would show in the builder specs (a press that opens nothing) and in text-styles.spec.ts.
- **Already tracked:** docs/audits/code-review-2026-11.md step 3.4 (FB8), Open, after step 3.1 (split the builder, Open). FB8's finding names the rich text editor; its fix lists only dialogs and panels. The component registry is step 3.2, Open. The sandbox budget is in neither.

## The fix

1. Tiptap off the first load: create src/components/admin/lazy/editors.tsx ("use client") with next/dynamic stand-ins for RichTextEditor and MarkupInput (a fallback box of the field's height) and for InlineMarkupEditor and InlineRichEditor (ssr: false; they mount on a press). Import the four from there at the eight lines named in the evidence. Add the stand-ins to src/test/eager-lazy-views.ts.
2. In PageBuilder, warm the chunk when the browser is idle after mount (requestIdleCallback, then import("@/components/inline-edit/rich-text-inline")), and keep the press point in state while the chunk loads, so the first press on a text opens the editor at the right place.
3. Do AC-6 (the storefront's text) and the builder's part of AC-9 (builder.en through responsive-edit.tsx line 20 and templates-helpers.ts line 1, blocks.en through modal-fields.tsx line 38, fields.en through lib/field-group-editor.ts line 31).
4. Then code review step 3.4 as written: next/dynamic for the template dialogs, the saved-part and layout dialogs, translation, the theme panel, the dual frame and the settings dialog's body. Loading each component's fields when its dialog opens needs one file per component first, which is step 3.2.
5. Lower the "/pages/{page}" budget in e2e/signed-in/admin-scripts.spec.ts line 44 and add the sandbox's builder (/admin/try/...) to the budgets.

**Done when:** route-bundle-stats.json after a build: /admin/[store]/pages/[pageId] at or under 2,450,000 bytes (3,303,372 today) with no Tiptap chunk in its firstLoadChunkPaths, and the signed-in builder specs pass.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/signed-in: builder-animation, builder-backdrops, builder-columns, builder-lines, builder-palette, builder-saved-edit, dual-page, dual-heading, text-styles, page-builder-fit, page-history and css-editor specs.
- e2e/inline-edit-live.spec.ts and inline-edit-hosts.spec.ts: the same inline editors on the live site, loaded through page-edit-link.tsx; unchanged, but they share the modules.
- e2e/text-colour.spec.ts (the rich text toolbar).
- Unit tests that draw block fields with renderToStaticMarkup need the stand-ins in src/test/eager-lazy-views.ts.
- docs/rules/admin/website.md, Editing words where they are (D191, D192, D193).
- docs/audits/code-review-2026-11.md Progress rows 3.1, 3.2 and 3.4: set 3.4's note when the Tiptap part lands, and correct FB8's fix, which lists only dialogs and panels.

**Comes after:** AC-6; AC-9; code review step 3.1 and 3.2 for step 4

**Notes:** Steps 1 to 3 do not wait for the builder's split (3.1): they change import lines, not the builder's structure. Tiptap is put off, not removed: with the idle warm-up its bytes still arrive on each open, after the first paint.
