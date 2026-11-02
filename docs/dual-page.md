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
- **Close** on either page empties its half, for another document (D424, section 7); *Close both* empties both.

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

### 3.4 A saved template beside a page (step 5)

Asked for by the owner on 1 November 2026: "template" in the request means the builder's saved templates (rows, columns, components
and page layouts, D46, D125, D127). `?with=template:{id}` opens one as the second document; *Open beside* lists them as the last kind.

- `templateAsPage()` (`src/lib/dual-page.ts`) draws it as the editor holds a page: its name as the title, its content as the canvas's
  rows (`partRows()`), a page layout's CSS as the page's and a part's translations as the page's. It is edited as the kind of page it is
  for: a page layout as its own kind, a row, column or component as a page, so the drop check and the sidebar are that kind's.
- `PageEditor`'s `template` mode: only its name in the settings; no address, versions, schedule, preview, duplicate or delete; in the
  site's main language only.
- Saving (Save both, Publish both, Ctrl/Cmd+S) saves it back through `updatePart`, the canvas's rows as its content again
  (`partFromRows()`: a saved row stays one row, a column one column, a component one component, else the save says what to keep). A
  template is never published; Publish both saves it and publishes the other page.
- Its own texts in other languages are kept as they are on save, as the builder's Saved dialog keeps them: a part copied into a template
  brings its layout and settings, not its translations. A part copied out of a template brings the template's translations.

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
5. A saved template as one of the two documents (built 1 November 2026, section 3.4).
6. The end-to-end test, `docs/rules/admin/website.md`, D412.

## 7. More ways to work with two (D424)

Asked for by the owner on 2 November 2026: scroll together or apart, swap the pages, close either or both and open others, drag the
room between them, and the same page on both sides to work on the computer's and the phone's at once.

### 7.1 What a person gets

- Over the two pages: **Scroll together** (a switch, as before, kept per browser), **Swap sides** and **Close both**.
- Each page's **Close** (over its canvas) empties its half. An empty half says so and offers **Open a page here**, **Create new here**,
  and, when the other half holds a page, **{page} on a phone** (that page again at a phone's size) and **Work on {page} alone** (its own
  editor, one page).
- Between the two pages an edge to **drag**: one page wider, the other narrower, from a fifth to four fifths; the arrow keys move it, a
  double press, Enter or Home gives the usual widths back. Kept per browser; one page drawn twice keeps its own (the phone narrower).
- **Desktop and phone** (in the editor's bar, by *Open beside*, and an empty half's *… on a phone*): the same page on both sides, the
  second at a phone's size. One page, one editor: a change on either canvas is on both, one undo, one save. Each canvas has its own
  screen size (its size bar), and the settings edit the size of the canvas last pressed, which is outlined. A drag between the two
  canvases moves, as on one page. Its second view closes with **Close this view**.

### 7.2 The address

What is shown is the address, so a reload or a shared link shows it again (`DualLayout` in `src/lib/dual-page.ts`):

- `?with=` is the second half: a document (as before), `empty`, or `mirror` (the first document again; `with` naming the first document
  itself means the same). `?first=empty` is a closed first half (the path's document is not drawn). `?swap=1` draws the second half on
  the left.
- `closeHalf()` closes a half; closing either canvas of one document drawn twice leaves it once, where the other canvas was.
  `openIn()` opens a document in a half: the other half's page again is `mirror`; a saved template, which has no address of its own, is
  always the second half, drawn on the side asked for; two templates cannot be open. `dualHref()` writes the address.
- Closing, swapping and drawing the first page again change nothing but the address (`replaceState`): no editor is drawn afresh and
  nothing typed is lost. Opening another document asks the server for the new address; the address's own document keeps what it holds
  while it stays the address's own, and a document that goes or is drawn afresh asks first about changes not saved.

### 7.3 How it is built

- `DualFrame` draws the halves in the order the swap asks (the halves' places move; what is portalled into them stays), and between
  them `DualSplitter` (`useDualSplit()` in `builder-rails.tsx`, `draggedSplit()`): the share is the first document's, so a swap keeps each
  page's width.
- One document twice is one `PageEditor` whose `PageBuilder` gets `dual.mirror`: it draws a second canvas column into the other half
  (its ids under `R|`), with its own `useResponsiveMode` starting at `sm`; `sizeEdit` is the pointed canvas's; a heading or text edited
  where it stands is the canvas's it was pressed on (`inline.side`). The builder registers its drag handlers for both sides, the hub's
  `mirror` makes the frame hand every drop to it as a move, and a column's drop place and a row's measures are the hovered canvas's.
- Scrolling together follows a device's screen where a page scrolls inside one, and by how far through the page it is
  (`followScrollShare()`) where the two are drawn at different sizes.
- `DualHalf` draws an empty half's offers in its place; the Open and Create dialogs open into it.

### 7.4 Tests

Unit (`src/lib/dual-page.test.ts`): the address read and written back, closing, opening in a half, the split, scrolling by share.
Signed-in end to end (`e2e/signed-in/dual-page.spec.ts`): swap, close one at a time, open a new document in an empty half, Close both;
the edge dragged and reset with the pointer and the keys; Desktop and phone: a heading added on one canvas is on both, the phone's
canvas pressed is the one edited, its view closed and opened again.

