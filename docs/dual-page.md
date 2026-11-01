# Dual page

Two of the builder's documents open side by side, both editable, with drag and drop between them (D412). Asked for by the owner on
1 November 2026; the eight questions put back were answered the same day (section 2). Built in the steps of section 6.

## 1. What a person gets

- In the builder for a page, an article, a product layout, a header, a footer, an entry page or a saved template, **Open beside** puts a
  second document next to the first: an existing one of any of those kinds, or a new one.
- **Create new** asks which kind of document, then *Side by side* (the new one opens next to this one) or *On its own* (the editor
  leaves for the new one, asking first when there are unsaved changes).
- With two open, rows, columns and components are dragged onto either page from the left sidebar, as on one page. A row, column or
  component dragged **from one page onto the other is copied**, with all its settings; the original stays where it was. Within one page a
  drag still moves.
- **Publish** publishes both; **Save draft** saves both.
- A toggle scrolls the two pages **together or independently**.
- In **Custom CSS**, *This page* has a **Left / Right** toggle.
- **Close** on the second page goes back to one page.

Homer sees two pages and one Publish. Lisa still has every setting: the sidebar, the settings on the right, undo, versions, find and
replace and the page checker all act on the page last pointed at.

## 2. What was decided (the owner's answers, 1 November 2026)

1. **Which documents.** Any two of the builder's documents of one site, mixed kinds too (a page beside a product layout). "Product" means a
   product layout: the builder edits the layout products are shown with, never one product's own fields.
2. **Parts that fit only one kind.** A drop that the target kind cannot hold is refused with a short note naming why, never copied
   broken. The check is the one a save makes (`pageRulesProblem()`, moved to `src/lib/page-rules.ts` so the browser asks the same
   question): product parts only on a product layout; a header's or footer's site parts only there; the shop's parts only on a store's
   page; search only on a store's page or article; and so on.
3. **What a copy keeps.** New ids, the same settings: every screen size's settings, motion, text styles, display rules and translations
   come along. A use of a global saved part (D98) stays a use of it (still linked). An A/B test (D148) is not copied: a test belongs to its
   page and names the parts by id, which the copy does not share. Custom HTML ids are kept unless the target page already uses them (D48,
   as when a saved part is placed).
4. **Within one page** a drag moves, as before. Only a drag to the other page copies.
5. **Publish both: both, or neither.** Publishing first saves both as drafts, which runs every check the server makes on either page
   (address, parts, fonts, the checkout page's policy, a running A/B test). If either is refused, nothing has gone live and the bar says
   which page and why. The page checker's blocking questions (wave 1, 1e) for both pages are asked in one dialog, each problem under its
   page's name. Only then are both published, one after the other. What can still separate them is a change made by someone else in the
   seconds between (an address taken, a test started); the bar then says plainly which page went live and which did not. *Save draft*
   saves both.
6. **Layout.** Two canvases side by side, each half of the middle. The left sidebar and the settings on the right are shared and act on
   the page last pointed at or clicked, which has a clear outline and its name in the bar. Undo and redo are that page's; each page keeps
   its own versions. The screen-size switch (desktop, tablet, phone) applies to both.
7. **Create new** asks which kind of document to create (page, article, product layout, header, footer; a saved template is made from a
   page with *Save as template*, and an entry page from its content type), then *Side by side* or *On its own*.
8. **Scope.** A store's builder and Kaizena Flow's own site builder, two documents of the same site only. The second document is in the
   address (`?with=article:{id}`, `?with=new:article`), so a reload or a shared link opens both.

Not offered in dual mode: the staging set's copy (D385) and an A/B test's version (D148), which belong to their own screens; while either
page is shown in another language than its main one (D55), nothing is copied between them (rows cannot change while translating).

## 3. How it is built

### 3.1 One drag and drop for two pages

Today each `PageBuilder` holds its own `DndContext`. In dual mode a shell (`DualPageEditor`) holds the one `DndContext`, and each
builder registers its handlers with it (`DualHub`, a React context): drag start, move, end and cancel are passed to the builder of the
page the drag is over, and *what is being dragged* is shared, so both canvases show their drop places (new lines, nesting) while anything
is held.

- Every draggable and droppable id is prefixed with its side in dual mode (`L|`, `R|`; none on one page, so nothing changes there), and
  every `DragData` carries `side`. Two pages may hold the same ids (a duplicated page, or the same page twice).
- A drop on the page the drag came from is handled as today. A row, column or component from the other page becomes a `foreign` drag:
  the source page hands over the part as it stands, and the target places it as a saved part is placed (`placeSaved()`), copied with new
  ids. A tile from the sidebar or a saved part dropped on the other page is added there as on its own.
- Before a copy or a new component lands, `dropProblem(owner, kind, part)` (`src/lib/dual-page.ts`) asks `pageRulesProblem()` about a
  page holding only that part; a problem is said in the canvas's note and nothing changes.
- `DragOverlay` is drawn by the source page's builder only.

### 3.2 One frame for two editors

`PageEditor` gains a `dual` prop. With it, its builder draws its canvas into its own half of the shell and its sidebar and settings into
the shell's sidebars only while it is the active page (React portals, so every context it provides still reaches them); its editor bar
goes into the shell's bar only while active, without its own Save and Publish, which the shell draws once for both. Each editor reports
to the shell what the shell needs (`DualHandle`: its name, whether it has changes, its CSS, and `save(publish, acknowledged)`), and its
keyboard shortcuts work only while it is active (Ctrl or Cmd + S saves both).

- **Scroll together**: the shell links the two canvases' scroll by pixels from the top; independently, each scrolls on its own. The
  choice is kept per browser.
- **Custom CSS**: one panel, *This page* with Left and Right; the site's CSS is one for both (the same site).
- **Screen size**: the shell holds the size; both builders follow it.
- **Saved parts**: a part saved, changed or deleted on one page reaches the other's sidebar and uses at once (`updateParts()`).
- **First save of a new page**: the address is rewritten with its id (`?with=article:{id}`), not left for it.
- The theme tab (D182) and text styles (D393) are the active page's; what one saves the other draws after the next reload.

### 3.3 The server

The editor views (`StoreEditPageView`, `StoreNewPageView` and the platform's) read `with`: the kind and id (or `new`), checked with
`requirePageTypeAccess()` for that kind and the shop feature for a product layout, loaded with `getPageForEdit()` and its own context
(`storePageContext()`), and drawn as `DualPageEditor`. A `with` the person may not open, or that names nothing, opens the first page alone
with a note. The documents a person can open beside come from `dualChoicesAction()` (the site's documents of each kind they may read).
Saving uses each page's own actions, unchanged.

## 4. Words

Every new string is in `src/lib/messages/` for English and Norwegian (`builder.dual`): *Open beside*, *Create new*, *Side by side*,
*On its own*, *Scroll together*, *Left page*, *Right page*, *Close this page*, *Copied to the other page*, *Publish both*, *Save both*,
and the refusals.

## 5. Tests

- Unit: `src/lib/dual-page.test.ts` (the `with` address, the drop check per kind, the copy keeping settings and global uses with new
  ids, the scroll link).
- Signed-in end to end (`e2e/signed-in/dual-page.spec.ts`): open a page beside another, drag a row across (copied, original kept), a
  product part refused on a page, Publish both, scroll together, the CSS panel's toggle.

## 6. Steps

1. The spec (this), the rules moved to `src/lib/page-rules.ts`, `src/lib/dual-page.ts` with its tests.
2. The builder in dual mode: the hub, side ids, portals, the shared drag, copying across and refusing.
3. The shell and the editors in dual mode: the views reading `with`, the bar (Save both, Publish both), the active page, scroll, screen
   size, the CSS panel's toggle, closing the second page.
4. *Open beside* and *Create new* with their dialogs.
5. A saved template as one of the two documents.
6. The end-to-end test, `docs/rules/admin/website.md`, D412.
