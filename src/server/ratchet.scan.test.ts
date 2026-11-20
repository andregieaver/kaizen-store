import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_KIT, adminSources, ANSWERING_FORMS, ANY_SUPPRESSED, CONFIRM_CALL, DIRECT_LINK, EMPTY_LINE, handMadeEmptyBlocks, handMadePills, OSLO_ZONE, RAW_FIELD, PAGE_DOCUMENT_READ, PAGES_TAG_REFRESH, rawActionForms, SELECT_TAG, TABLE_TAG, TEST_SUPPORT, USE_SERVER_FIRST, WRAPPED_ACTION, BIG_FILE_BYTES, LONG_FILE_LINES, NOT_DISTINCT_STORE, ratchetCounts, UNKNOWN_CAST, unscopedWrites, UNTYPED_READ } from "../../scripts/lib/ratchet-count.mjs";
import { selectsDocument } from "./page-documents-test-support";
import baseline from "./ratchet.baseline.json";

/**
 * The ratchet of code review step 1.2 (findings FD6 and FH11): unchecked reads (`execute<…>(`) per file, casts through `unknown`
 * (`as unknown as`) and switched-off `any` rules in total, as `ratchet.baseline.json` records them. None may rise: a new read goes through
 * `typedRows()`/`typedRow()` (`typed-rows.ts`), a new file starts with none. And the numbers are kept true as they fall: a change that
 * types a read or drops a cast lowers the baseline with it (`node scripts/ratchet.mjs`), so the next one cannot spend the room.
 */

const now = ratchetCounts(process.cwd()) as {
  unknownCasts: number;
  anySuppressed: number;
  filesOver100Kb: number;
  filesOver2000Lines: number;
  untypedReads: Record<string, number>;
  byIdWrites: Record<string, number>;
  notDistinctStore: Record<string, number>;
  pageDocumentReads: Record<string, number>;
  pagesTagRefreshes: Record<string, number>;
  directLinks: Record<string, number>;
  adminRepeats: Record<string, number>;
  adminFiles: Record<string, Record<string, number>>;
};
const recorded: Record<string, number> = baseline.untypedReads;
const recordedWrites: Record<string, number> = baseline.byIdWrites;
const recordedNotDistinct: Record<string, number> = baseline.notDistinctStore;
const recordedDocuments: Record<string, number> = baseline.pageDocumentReads;
const recordedRefreshes: Record<string, number> = baseline.pagesTagRefreshes;
const recordedRepeats: Record<string, number> = baseline.adminRepeats;
const recordedLinks: Record<string, number> = baseline.directLinks;
const recordedFiles: Record<string, Record<string, number>> = baseline.adminFiles;

/** What to do instead, per count (bloat review step 1.17). A repeat made on purpose is accepted by `node scripts/ratchet.mjs --first`, shown in the diff. */
const REPEAT_FIX: Record<string, string> = {
  unwrappedActionFiles: "run the action through storeAction() or platformAction() (src/server/store-action.ts)",
  tables: "this count only falls until the admin kit of step 4.1 exists; reuse a list part from src/components/admin/ui",
  nativeSelects: "this count only falls until the admin kit of step 4.1 exists; reuse a list part from src/components/admin/ui",
  osloFiles: "format dates with the admin's date helper, not a literal time zone",
  confirmFiles: "use the admin's ConfirmButton (src/components/admin/ui/confirm-button.tsx), not window.confirm",
};

/** What to do instead, per file list (code review step 1.12, D818): the admin kit's pieces in src/components/admin/ui. */
const FILE_FIX: Record<string, string> = {
  rawFields: "draw the field's box with TextInput, Select or TextArea (and its label with Field) from src/components/admin/ui",
  pillLinks: "a link that is a button is ButtonLink (or buttonClass()), a state is a Chip, from src/components/admin/ui",
  rawActionForms:
    "a form bound to a server action is ActionForm (it says Saved, or each problem under its field) or QuietActionForm (it answers by what it does), from src/components/admin; a form to an address says its method",
  emptyBlocks:
    "an empty list or screen is EmptyState from src/components/admin/ui (a title, a line on what it is for, one next step; Clear filters when a search or filter matched nothing), compact in a panel or a dialog",
  emptyLines: "a word of nothing alone in a bare <p> or <div>: draw it with EmptyState (compact in a panel or a dialog) from src/components/admin/ui",
};

/**
 * The hand-written empty blocks kept (code review step 2.9, D845), each with why: places a person drops or opens something, whose words are
 * already their next step, and the page finder's line, kept out of every admin route's first scripts. Every other "nothing here" box in the
 * admin is the kit's `EmptyState`.
 */
const KEPT_EMPTY_BLOCKS: Record<string, string> = {
  "src/components/admin/page-builder.tsx":
    "the canvas's foot and an empty column are drop targets of the drag and drop (their frame lights up under a dragged block), and their words are the next step: Start from a layout, Drag a block here or add text",
  "src/components/admin/dual-page-editor.tsx":
    "an empty half of the two-page editor is where a page is opened: a heading and three ways in (open, create, mirror the other half), its frame the size of the half (data-dual-empty)",
  "src/components/admin/page-finder.tsx":
    "the page finder (Ctrl/Cmd+K) is in the first scripts of every admin route, where EmptyState would add about 0.9 KB to each for one line that already says what to try (another word, or ask the AI manager)",
};

/** Why the job it does keeps its own form (it answers by itself). */
const OWN_STATE = "its action is its own useActionState's: the button is busy with `pending` and the state is its answer";
const OWN_TRANSITION = "it runs its action in a transition of its own (`aria-busy`) and shows what comes back itself: a new key or secret once, or its problem";

/**
 * The forms still bound to an action by hand (code review step 1.15, D829), each with why: client parts that hold the action's answer in
 * their own state. Every other admin form bound to a server action is `ActionForm` or `QuietActionForm`. The list is the ratchet's
 * (`adminFiles.rawActionForms`): a file leaves it once its forms move onto the two, and a new one is not added without its reason.
 */
const KEPT_ACTION_FORMS: Record<string, string> = {
  "src/app/admin/(gated)/[store]/gift-cards/[cardId]/new-code-form.tsx": OWN_STATE,
  "src/app/admin/(gated)/[store]/gift-cards/new/issue-form.tsx": OWN_STATE,
  "src/components/admin/admin-trail.tsx":
    "Sign out leaves the admin, so there is nothing to answer; it is in every admin page's frame, where QuietActionForm would add 4 KB to the first scripts of every admin route",
  "src/components/admin/api-tokens.tsx": OWN_TRANSITION,
  "src/components/admin/contact-fields-card.tsx": OWN_TRANSITION,
  "src/components/admin/custom-apps.tsx": OWN_TRANSITION,
  "src/components/admin/customer-accounts-card.tsx": OWN_TRANSITION,
  "src/components/admin/demo-content-card.tsx": OWN_STATE,
  "src/components/admin/demo-home-take.tsx": OWN_STATE,
  "src/components/admin/developer-apps.tsx": OWN_TRANSITION,
  "src/components/admin/moving/woo-list.tsx": OWN_STATE,
  "src/components/admin/no-show-form.tsx": OWN_STATE,
  "src/components/admin/order-actions.tsx": OWN_STATE,
  "src/components/admin/orders/capture-card.tsx": OWN_STATE,
  "src/components/admin/orders/send-parcel.tsx": OWN_STATE,
  "src/components/admin/review-import-form.tsx": OWN_STATE,
  "src/components/admin/storefront-tokens.tsx": OWN_TRANSITION,
  "src/components/admin/subscription-actions.tsx": OWN_STATE,
  "src/components/admin/support/request-actions.tsx": OWN_STATE,
  "src/components/admin/webhook-endpoints.tsx": OWN_TRANSITION,
  "src/components/admin/workflows.tsx": OWN_TRANSITION,
};

describe("the ratchet (code review 1.2)", () => {
  it("adds no unchecked read: a file has no more than its baseline, and a file not in it has none", () => {
    const raised = Object.entries(now.untypedReads)
      .filter(([file, n]) => n > (recorded[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} unchecked reads, baseline ${recorded[file] ?? 0}. Read through typedRows()/typedRow().`);
    expect(raised).toEqual([]);
  });

  it("adds no direct import of next/link: a file not in the baseline imports it not at all (use PolicyLink or AdminLink)", () => {
    const raised = Object.keys(now.directLinks)
      .filter((file) => !(file in recordedLinks))
      .map((file) => `${file}: imports next/link directly. Use PolicyLink (src/components/policy-link.tsx) or AdminLink (src/components/admin/ui/link.tsx), which state what the link may fetch ahead (bloat review step 2.6).`);
    expect(raised).toEqual([]);
  });

  it("adds no write that picks a store's row by its id alone (code review 1.3, FV5): it names the store too", () => {
    const raised = Object.entries(now.byIdWrites)
      .filter(([file, n]) => n > (recordedWrites[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} writes by id without the store, baseline ${recordedWrites[file] ?? 0}. Add \`and store_id = …\`.`);
    expect(raised).toEqual([]);
  });

  it("adds no `store_id is not distinct from` (step 0.23): a store's rows are filtered with owned(), which an index serves", () => {
    const raised = Object.entries(now.notDistinctStore)
      .filter(([file, n]) => n > (recordedNotDistinct[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} uses of store_id is not distinct from, baseline ${recordedNotDistinct[file] ?? 0}. Filter with owned(storeId) (src/server/owned.ts); lower the baseline with node scripts/ratchet.mjs when a count falls.`);
    expect(raised).toEqual([]);
  });

  it("adds no read of a whole page document and no refresh of a store's whole pages tag (bloat review 1.3)", () => {
    const documents = Object.entries(now.pageDocumentReads)
      .filter(([file, n]) => n > (recordedDocuments[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} reads of a whole page document, baseline ${recordedDocuments[file] ?? 0}. Read the columns the list shows, or one page by its id (docs/performance.md).`);
    const refreshes = Object.entries(now.pagesTagRefreshes)
      .filter(([file, n]) => n > (recordedRefreshes[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} refreshes of a store's whole pages tag, baseline ${recordedRefreshes[file] ?? 0}. Refresh the page's own tag, not every page of the store.`);
    expect(documents).toEqual([]);
    expect(refreshes).toEqual([]);
  });

  it("adds no hand-made repeat in the admin (bloat review 1.17)", () => {
    const raised = Object.keys(REPEAT_FIX)
      .filter((key) => now.adminRepeats[key] > (recordedRepeats[key] ?? Infinity))
      .map((key) => `${key}: ${now.adminRepeats[key]}, baseline ${recordedRepeats[key]}. ${REPEAT_FIX[key]}. Accepting it on purpose: node scripts/ratchet.mjs --first, and commit the diff.`);
    expect(raised).toEqual([]);
  });

  it("adds no hand-made field box or pill link in the admin (code review 1.12): a file has no more than its baseline, a file not in it has none", () => {
    const raised = Object.keys(FILE_FIX).flatMap((key) =>
      Object.entries(now.adminFiles[key])
        .filter(([file, n]) => n > (recordedFiles[key][file] ?? 0))
        .map(([file, n]) => `${file}: ${n} ${key}, baseline ${recordedFiles[key][file] ?? 0}. ${FILE_FIX[key]}. Accepting it on purpose: node scripts/ratchet.mjs --first, and commit the diff.`),
    );
    expect(raised).toEqual([]);
  });

  it("keeps a form bound to an action by hand only where it answers by itself, each named with why (code review 1.15, D829)", () => {
    const kept = Object.keys(now.adminFiles.rawActionForms).sort();
    expect(kept.filter((file) => !(file in KEPT_ACTION_FORMS)).map((file) => `${file}: ${FILE_FIX.rawActionForms}`)).toEqual([]);
    expect(Object.keys(KEPT_ACTION_FORMS).filter((file) => !kept.includes(file)), "its forms moved onto ActionForm or QuietActionForm: take its line out").toEqual([]);
    // The two forms are where an action is bound to a <form>: the count sees theirs, and leaves them out.
    for (const file of ANSWERING_FORMS) expect(rawActionForms(readFileSync(join(process.cwd(), file), "utf8")), file).toBe(1);
  });

  it("draws every empty list and screen with the kit's EmptyState: a hand-written empty block is kept only where named with why (code review 2.9, D845)", () => {
    const kept = Object.keys(now.adminFiles.emptyBlocks).sort();
    expect(kept.filter((file) => !(file in KEPT_EMPTY_BLOCKS)).map((file) => `${file}: ${now.adminFiles.emptyBlocks[file]} hand-written empty blocks. ${FILE_FIX.emptyBlocks}`)).toEqual([]);
    expect(Object.keys(KEPT_EMPTY_BLOCKS).filter((file) => !kept.includes(file)), "it no longer draws an empty block by hand: take its line out").toEqual([]);
    // The kit's own file is where the box is drawn once, and is never in the list.
    expect(Object.keys(now.adminFiles.emptyBlocks).filter((file) => file.startsWith(ADMIN_KIT))).toEqual([]);
  });

  it("counts the repeats in every admin page and part: the store's, the platform's and the owner's level (code review 1.12)", () => {
    const files: string[] = adminSources(process.cwd());
    expect(files.some((file) => file.startsWith("src/app/admin/(gated)/platform/"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/app/admin/(gated)/[store]/"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/app/admin/(gated)/(owner)/"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/components/admin/"))).toBe(true);
    expect(files.some((file) => file.endsWith(".ts"))).toBe(true);
    // The kit is where the box and the pill are written once; it is never in the lists.
    expect(Object.keys(now.adminFiles.rawFields).filter((file) => file.startsWith(ADMIN_KIT))).toEqual([]);
  });

  it("adds no cast through unknown and no switched-off any", () => {
    expect(now.unknownCasts, "as unknown as in src, tests aside").toBeLessThanOrEqual(baseline.unknownCasts);
    expect(now.anySuppressed, "eslint-disable of no-explicit-any in src, tests aside").toBeLessThanOrEqual(baseline.anySuppressed);
  });

  it("adds no source file over 100 KB or over 2,000 lines: read by window, the counts only fall", () => {
    const how = "Split the file, or move code out of it; never raise the number.";
    expect(now.filesOver100Kb, `source files over 100 KB. ${how}`).toBeLessThanOrEqual(baseline.filesOver100Kb);
    expect(now.filesOver2000Lines, `source files over 2,000 lines. ${how}`).toBeLessThanOrEqual(baseline.filesOver2000Lines);
  });

  it("keeps the baseline as low as the code: run `node scripts/ratchet.mjs` after a change lowers a number", () => {
    const lower = [
      ...Object.entries(recorded)
        .filter(([file, n]) => (now.untypedReads[file] ?? 0) < n)
        .map(([file, n]) => `${file}: ${now.untypedReads[file] ?? 0}, baseline ${n}`),
      ...Object.entries(recordedWrites)
        .filter(([file, n]) => (now.byIdWrites[file] ?? 0) < n)
        .map(([file, n]) => `${file}: ${now.byIdWrites[file] ?? 0} writes by id without the store, baseline ${n}`),
      ...Object.entries(recordedNotDistinct)
        .filter(([file, n]) => (now.notDistinctStore[file] ?? 0) < n)
        .map(([file, n]) => `${file}: ${now.notDistinctStore[file] ?? 0} uses of store_id is not distinct from, baseline ${n}`),
      ...Object.keys(recordedLinks)
        .filter((file) => !(file in now.directLinks))
        .map((file) => `${file}: no longer imports next/link directly, baseline lists it; run node scripts/ratchet.mjs`),
      ...(now.unknownCasts < baseline.unknownCasts ? [`as unknown as: ${now.unknownCasts}, baseline ${baseline.unknownCasts}`] : []),
      ...(now.anySuppressed < baseline.anySuppressed ? [`suppressed any: ${now.anySuppressed}, baseline ${baseline.anySuppressed}`] : []),
      ...(now.filesOver100Kb < baseline.filesOver100Kb ? [`source files over 100 KB: ${now.filesOver100Kb}, baseline ${baseline.filesOver100Kb}`] : []),
      ...(now.filesOver2000Lines < baseline.filesOver2000Lines ? [`source files over 2,000 lines: ${now.filesOver2000Lines}, baseline ${baseline.filesOver2000Lines}`] : []),
    ];
    // The admin's repeats fall as screens are rebuilt: a fall is a note, and node scripts/ratchet.mjs lowers the baseline.
    const repeatsFell = Object.entries(recordedRepeats)
      .filter(([key, n]) => (now.adminRepeats[key] ?? 0) < n)
      .map(([key, n]) => `admin ${key}: ${now.adminRepeats[key] ?? 0}, baseline ${n}`);
    // The same for the two counts of step 1.3 (a note, never a failure: code is removed every day).
    const pagesFell = [
      ...Object.entries(recordedDocuments).filter(([file, n]) => (now.pageDocumentReads[file] ?? 0) < n).map(([file, n]) => `${file}: ${now.pageDocumentReads[file] ?? 0} whole page document reads, baseline ${n}`),
      ...Object.entries(recordedRefreshes).filter(([file, n]) => (now.pagesTagRefreshes[file] ?? 0) < n).map(([file, n]) => `${file}: ${now.pagesTagRefreshes[file] ?? 0} whole pages tag refreshes, baseline ${n}`),
    ];
    if (pagesFell.length > 0) console.info(`ratchet: fell, lower with node scripts/ratchet.mjs: ${pagesFell.join("; ")}`);
    if (repeatsFell.length > 0) console.info(`ratchet: fell, lower with node scripts/ratchet.mjs: ${repeatsFell.join("; ")}`);
    // The kit's file lists (step 1.12) fall as screens move onto it, here or in another change: a note, and node scripts/ratchet.mjs lowers them.
    const filesFell = Object.keys(FILE_FIX).flatMap((key) =>
      Object.entries(recordedFiles[key]).filter(([file, n]) => (now.adminFiles[key][file] ?? 0) < n).map(([file, n]) => `${file}: ${now.adminFiles[key][file] ?? 0} ${key}, baseline ${n}`),
    );
    if (filesFell.length > 0) console.info(`ratchet: fell, lower with node scripts/ratchet.mjs: ${filesFell.join("; ")}`);
    expect(lower).toEqual([]);
  });

  it("counts what it says it counts", () => {
    const n = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
    expect(n("await tx.execute<Row>(sql`select 1`); await db().execute<Array<Row>>(sql`x`)", UNTYPED_READ)).toBe(2);
    expect(n("await typedRows(ROW, sql`select 1`, tx); await tx.execute(sql`update x`)", UNTYPED_READ)).toBe(0);
    expect(n("const s = value as unknown as Store;", UNKNOWN_CAST)).toBe(1);
    expect(n("where a.store_id is not distinct from ${x}::uuid and store_id\n  IS NOT DISTINCT FROM ${y}", NOT_DISTINCT_STORE)).toBe(2);
    expect(n("where ${owned(storeId)} and p.account_id is not distinct from ${a}::uuid", NOT_DISTINCT_STORE)).toBe(0);
    expect(n("// eslint-disable-next-line @typescript-eslint/no-explicit-any", ANY_SUPPRESSED)).toBe(1);
    expect(n('import Link from "next/link";', DIRECT_LINK)).toBe(1);
    expect(n('import { PolicyLink } from "./policy-link";', DIRECT_LINK)).toBe(0);
    // A whole page document: the column draft or published read from commerce.pages (bloat review step 1.3).
    expect(n("select id, draft from commerce.pages where id = 1", PAGE_DOCUMENT_READ)).toBe(1);
    expect(n("select p.published from commerce.pages p", PAGE_DOCUMENT_READ)).toBe(1);
    expect(n("select id, published_at from commerce.pages", PAGE_DOCUMENT_READ)).toBe(0);
    expect(n("select id from commerce.pages where published is not null", PAGE_DOCUMENT_READ)).toBe(0);
    expect(n("select published -> 'title' from commerce.pages", PAGE_DOCUMENT_READ)).toBe(0);
    expect(n("refreshTag(pagesTag(store.id))", PAGES_TAG_REFRESH)).toBe(1);
    expect(n("cacheTag(pagesTag(owner))", PAGES_TAG_REFRESH)).toBe(0);
    // A file is long past 2,000 lines, not at 2,000; big past 100,000 bytes.
    const lines = (k: number) => Array.from({ length: k }, () => "x").join("\n");
    expect(lines(2_001).split("\n").length > LONG_FILE_LINES).toBe(true);
    expect(lines(2_000).split("\n").length > LONG_FILE_LINES).toBe(false);
    expect(Buffer.byteLength("x".repeat(BIG_FILE_BYTES + 1)) > BIG_FILE_BYTES).toBe(true);
    expect(Buffer.byteLength("x".repeat(BIG_FILE_BYTES)) > BIG_FILE_BYTES).toBe(false);
    // The admin's repeats: a directive after leading comments counts, the wrapper in the file does not.
    const unwrapped = (text: string) => USE_SERVER_FIRST.test(text) && !WRAPPED_ACTION.test(text);
    expect(unwrapped('"use server";\nexport async function save() {}')).toBe(true);
    expect(unwrapped("// Saves it.\n/* and more */\n'use server';\nexport async function save() {}")).toBe(true);
    expect(unwrapped('// A comment\n"use server";\nexport const save = storeAction(async () => {});')).toBe(false);
    expect(unwrapped('import x from "y";\n"use server";')).toBe(false);
    expect(n("<table className=\"a\"><tr/></table> <tablet/>", TABLE_TAG)).toBe(1);
    expect(n("<select value={a}><option/></select> <selection/>", SELECT_TAG)).toBe(1);
    expect(n("<div/>", SELECT_TAG)).toBe(0);
    expect("timeZone: \"Europe/Oslo\"".includes(OSLO_ZONE)).toBe(true);
    expect("timeZone: \"UTC\"".includes(OSLO_ZONE)).toBe(false);
    expect(CONFIRM_CALL.test("if (!confirm(msg)) return;")).toBe(true);
    expect(CONFIRM_CALL.test("const confirmed = true; onConfirm(x)")).toBe(false);
    // The kit's two lists (step 1.12): a field's box by hand, with a width between or dense; a link made a pill by hand.
    expect(n('<input className="min-h-10 rounded-md border border-line bg-card px-3 text-sm" />', RAW_FIELD)).toBe(1);
    expect(n('const field = "min-h-10 w-full max-w-md rounded-md border border-line bg-card px-3"; const s = "min-h-9 rounded-md border border-edge bg-card px-2";', RAW_FIELD)).toBe(2);
    expect(n('<div className="rounded-md border border-line bg-card p-3" /> <TextInput name="q" />', RAW_FIELD)).toBe(0);
    expect(handMadePills('<AdminLink href="/x" className="inline-flex h-11 items-center rounded-pill bg-brand px-5">Go</AdminLink>')).toBe(1);
    expect(handMadePills('<Link\n  href={`/a/${b}`}\n  onClick={() => x > 1 && go()}\n  className={`rounded-full px-2 ${on ? "a" : "b"}`}\n>x</Link> <a href="/y" className="rounded-full">y</a>')).toBe(2);
    expect(handMadePills('<ButtonLink kind="main" href="/x">Go</ButtonLink> <AdminLink href="/x" className={buttonClass("main")}>Go</AdminLink> <Chip>On</Chip>')).toBe(0);
    expect(handMadePills('<a href="/x" className="underline">x</a> <aside className="rounded-full" /> <span className="rounded-pill" />')).toBe(0);
    // A form bound to an action by hand (step 1.15): a server action, bound or not, or a client function; never a form to an address.
    expect(rawActionForms('<form action={removeAction.bind(null, slug, id)}><button /></form> <form\n  className="flex"\n  action={save}\n>')).toBe(2);
    expect(rawActionForms('<form action={(form) => start(async () => { if (a > b) await make(form); })} aria-busy={pending}>')).toBe(1);
    expect(rawActionForms('<form action="/admin/x"> <form action={`${base}/orders`}> <form method="get" action={base}> <form method="post" action={exportHref}>')).toBe(0);
    expect(rawActionForms('<form onSubmit={submit}> <formset /> <QuietActionForm action={removeAction}> <ActionForm action={saveAction}>')).toBe(0);
    // A hand-written empty block (step 2.9): a centred box with room, a thin dashed box with muted words, a card that only says nothing.
    expect(handMadeEmptyBlocks("<p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>\n  {w.none}\n</p>")).toBe(1);
    expect(handMadeEmptyBlocks('<div className="rounded-panel border border-dashed border-line px-4 py-5 text-sm text-muted">{w.notCounting}</div>')).toBe(1);
    expect(handMadeEmptyBlocks('<p className="rounded-panel border border-line bg-card p-4 text-sm">{q ? w.noMatch : w.none}</p> <p className={`${card} text-sm`}>{w.nothingYet}</p>')).toBe(2);
    // The kit's box is the look the scan finds when written out by hand.
    expect(handMadeEmptyBlocks('<div className="flex flex-col items-center gap-2 rounded-panel border border-dashed border-line px-4 py-8 text-center">')).toBe(1);
    expect(handMadeEmptyBlocks('<li className="rounded-md border border-dashed border-line p-4 text-sm text-muted">{w.noLines}</li>')).toBe(1);
    // Not one: the kit's part, an alert, a chart's picture, a picture's frame, a drop zone, a card with more than a word, a table cell's centring.
    expect(handMadeEmptyBlocks('<EmptyState title={w.none} /> <p role="alert" className="rounded-md border border-dashed p-6 text-center text-sm">{error}</p>')).toBe(0);
    expect(handMadeEmptyBlocks('<div role="img" aria-label={label} className="rounded-panel border border-dashed px-4 py-8 text-center text-sm text-muted">{text}</div>')).toBe(0);
    expect(handMadeEmptyBlocks('<div className="flex h-40 items-center justify-center rounded-md border border-dashed bg-surface text-sm text-muted">{w.none}</div>')).toBe(0);
    expect(handMadeEmptyBlocks('<div className="rounded-lg border-2 border-dashed p-3 text-sm text-muted">{w.drop}</div> <td className="px-3 py-2 text-center">x</td>')).toBe(0);
    expect(handMadeEmptyBlocks('<p className="rounded-panel bg-sunken p-3 text-sm">{w.permanent}</p> <p className={`p-4 ${CARD_CLASS}`}>{w.none} <a href="/x">Add</a></p>')).toBe(0);
    // A word of nothing alone in a bare line (only falls).
    expect(n('<p className="text-sm text-muted">{w.none}</p> <div>{filtered ? w.noMatch : w.emptyList}</div>', EMPTY_LINE)).toBe(2);
    expect(n('<p className="text-sm">{w.intro}</p> <EmptyState title={w.none} /> <span>{w.none}</span>', EMPTY_LINE)).toBe(0);
    const tables = new Set(["media", "experiments"]);
    expect(unscopedWrites("sql`delete from commerce.media where id = ${id}::uuid`", tables)).toBe(1);
    expect(unscopedWrites("sql`update commerce.experiments e set status = 'done' where e.id = ${id}::uuid`", tables)).toBe(1);
    expect(unscopedWrites("sql`delete from commerce.media where store_id = ${s}::uuid and id = ${id}::uuid`", tables)).toBe(0);
    expect(unscopedWrites("sql`update commerce.media set x = 1 where ${owned(storeId)} and id = ${id}::uuid`", tables)).toBe(0);
    // A table without a store, and a write by another key, are not this rule's.
    expect(unscopedWrites("sql`delete from commerce.accounts where id = ${id}::uuid`", tables)).toBe(0);
    expect(unscopedWrites("sql`delete from commerce.media where expires_at < now()`", tables)).toBe(0);
  });
});

/**
 * The statements that return a whole page document (bloat review step 2.17): each `select … from commerce.pages` (the pattern of step
 * 1.3) whose select list returns `draft` or `published` whole, by file and function. Those that may return many rows are named in
 * `pageDocuments` with the reason the documents are read; those that read one page (by its id or address) in `pageDocumentsOneRow`.
 */
function documentReads(root: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(join(root, dir)).flatMap((name) => {
      const path = `${dir}/${name}`;
      if (statSync(join(root, path)).isDirectory()) return walk(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !TEST_SUPPORT.test(name) ? [path] : [];
    });
  const FUNCTION = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)|^(?:export\s+)?(?:const|let)\s+(\w+)\s*[:=]/gm;
  const pairs = new Set<string>();
  for (const file of [...walk("src/server"), ...walk("src/app")]) {
    const text = readFileSync(join(root, file), "utf8");
    const functions = [...text.matchAll(FUNCTION)].map((m) => ({ at: m.index, name: m[1] ?? m[2] }));
    for (const m of text.matchAll(new RegExp(PAGE_DOCUMENT_READ.source, PAGE_DOCUMENT_READ.flags))) {
      if (!selectsDocument(m[0])) continue;
      pairs.add(`${file}#${functions.filter((f) => f.at < m.index).at(-1)?.name ?? "(top)"}`);
    }
  }
  return [...pairs].sort();
}

describe("the statements that read whole page documents (bloat review step 2.17)", () => {
  const found = documentReads(process.cwd());
  const many: Record<string, string> = baseline.pageDocuments;
  const one: string[] = baseline.pageDocumentsOneRow;

  it("are each named, with the reason when they may read many", () => {
    const unnamed = found.filter((pair) => !(pair in many) && !one.includes(pair));
    expect(
      unnamed,
      "a new statement returns a whole page document: read the columns the list shows (pageTitles(), publishedPageIndex(), pageCards()), or name it in ratchet.baseline.json's pageDocuments with the reason (pageDocumentsOneRow for one page by id)",
    ).toEqual([]);
  });

  it("names only those still there, each once, with a reason", () => {
    expect([...Object.keys(many), ...one].filter((pair) => !found.includes(pair)), "delete the line of a read that went").toEqual([]);
    expect(Object.keys(many).filter((pair) => one.includes(pair))).toEqual([]);
    expect(Object.entries(many).filter(([, reason]) => reason.trim().length < 20).map(([pair]) => pair)).toEqual([]);
  });
});
