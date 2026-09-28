import { describe, expect, it } from "vitest";

import {
  asDoc,
  copyWithUses,
  currentGlobal,
  detachUse,
  editedGlobals,
  extractUse,
  fromDoc,
  globalContent,
  markUse,
  newUse,
  refreshUses,
  sameGlobal,
  setLocal,
  settleUses,
  usePlace,
  usesIn,
  withoutUses,
  type GlobalPart,
  type PartsDoc,
} from "./global-parts";
import type { HeadingBlock, PageBlock, PageColumn, PageRow } from "./page-content";


const uuid = () => crypto.randomUUID();
const heading = (text: string, id = uuid()): HeadingBlock => ({ id, type: "heading", text, level: 2 });
const column = (...blocks: PageBlock[]): PageColumn => ({ id: uuid(), blocks });
const row = (...columns: PageColumn[]): PageRow => ({
  id: uuid(),
  type: "row",
  layout: String(columns.length) as PageRow["layout"],
  columns,
});
const texts = (rows: PageRow[]) => rows.flatMap((r) => r.columns.flatMap((c) => c.blocks.map((b) => (b as HeadingBlock).text)));
const ids = (rows: PageRow[]) => rows.flatMap((r) => [r.id, ...r.columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])]);

/** A page with one row made global, as the builder does it. */
function pageWithGlobal() {
  const hero = row(column(heading("Welcome")), column(heading("Offer")));
  const content = globalContent("row", hero);
  const global: GlobalPart = { id: "10000000-0000-4000-8000-000000000001", kind: "row", content, translations: {} };
  const page: PartsDoc = { rows: markUse([hero, row(column(heading("Own")))], hero.id, global.id) };
  return { hero, global, page };
}

describe("a global made from a part", () => {
  it("keeps the part's ids, so the page is its first use as it was", () => {
    const { hero, global, page } = pageWithGlobal();
    expect(ids([global.content as PageRow])).not.toContain(hero.id);
    const again = refreshUses(page, new Map([[global.id, global]]));
    expect(again).toEqual(page);
    expect(usesIn(page.rows).map((u) => u.part.id)).toEqual([hero.id]);
  });

  it("gives each use ids of its own, and a change reaches every use", () => {
    const { global, page } = pageWithGlobal();
    const other: PartsDoc = { rows: [newUse(global, uuid()) as PageRow] };
    expect(ids(other.rows).some((id) => ids(page.rows).includes(id))).toBe(false);

    // Edit the first use, take the global from it, and refresh the other page.
    const edited = { ...page, rows: page.rows.map((r, i) => (i === 0 ? { ...r, columns: [r.columns[0], column(heading("Sale"))] } : r)) };
    expect(editedGlobals(edited, new Map([[global.id, global]]))).toEqual([global.id]);
    const changed = currentGlobal(edited, global);
    const refreshed = refreshUses(other, new Map([[global.id, changed]]));
    expect(texts(refreshed.rows)).toEqual(["Welcome", "Sale"]);
    // Refreshing again changes nothing, and its ids stay its own.
    expect(refreshUses(refreshed, new Map([[global.id, changed]]))).toEqual(refreshed);
    expect(refreshed.rows[0].id).toBe(other.rows[0].id);
  });
});

describe("the page's own parts inside a use", () => {
  it("keep each page's content while the rest follows the global", () => {
    const { hero, global, page } = pageWithGlobal();
    const offerId = hero.columns[1].id;
    // This page makes its second column its own, and writes in it.
    const localRows = setLocal(page.rows, offerId, true);
    let mine: PartsDoc = { rows: localRows };
    let current = currentGlobal(mine, global);
    expect(sameGlobal("row", current, global)).toBe(false);

    const other: PartsDoc = { rows: [newUse(global, uuid()) as PageRow] };
    let theirs = refreshUses(other, new Map([[global.id, current]]));
    // The other page has the column as its own now, starting from what it had.
    expect(texts(theirs.rows)).toEqual(["Welcome", "Offer"]);
    expect(theirs.rows[0].columns[1].local).toBe(true);

    // Each page writes its own offer; the first column stays shared.
    const write = (doc: PartsDoc, column: number, text: string): PartsDoc => ({
      ...doc,
      rows: doc.rows.map((r, i) =>
        i === 0 ? { ...r, columns: r.columns.map((c, j) => (j === column ? { ...c, blocks: [{ ...(c.blocks[0] as HeadingBlock), text }] } : c)) } : r,
      ),
    });
    mine = write(write(mine, 0, "Hello"), 1, "Mine");
    theirs = write(theirs, 1, "Theirs");
    current = currentGlobal(mine, current);
    const synced = refreshUses(theirs, new Map([[global.id, current]]));
    expect(texts(synced.rows)).toEqual(["Hello", "Theirs"]);
    // Changing only the page's own part is no change to the global.
    const onlyOwn = { rows: [{ ...synced.rows[0], columns: [synced.rows[0].columns[0], { ...synced.rows[0].columns[1], blocks: [heading("Other")] }] }] };
    expect(editedGlobals(onlyOwn, new Map([[global.id, current]]))).toEqual([]);
  });
});

describe("globals inside globals", () => {
  it("a global component in a global row follows its own changes, on its own and inside the row", () => {
    const promise = heading("Free delivery");
    const block: GlobalPart = { id: "20000000-0000-4000-8000-000000000002", kind: "block", content: globalContent("block", promise), translations: {} };
    const blockUse = { ...promise, global: block.id };
    const inner = row(column(heading("Title")), column(blockUse));
    const rowGlobal: GlobalPart = { id: "30000000-0000-4000-8000-000000000003", kind: "row", content: globalContent("row", inner), translations: {} };
    const page: PartsDoc = { rows: [newUse(rowGlobal, uuid()) as PageRow, row(column(newUse(block, uuid()) as PageBlock))] };
    expect(usesIn(page.rows).map((u) => u.kind)).toEqual(["row", "block", "block"]);

    // The component changes (somewhere else): first the row's own content follows, then the page.
    const changed: GlobalPart = { ...block, content: { ...(block.content as HeadingBlock), text: "Free returns" } };
    const rowContent = fromDoc("row", refreshUses(asDoc("row", rowGlobal.content), new Map([[block.id, changed]])));
    const rowChanged: GlobalPart = { ...rowGlobal, content: rowContent };
    const refreshed = refreshUses(page, new Map<string, GlobalPart>([[rowGlobal.id, rowChanged], [block.id, changed]]));
    expect(texts(refreshed.rows)).toEqual(["Title", "Free returns", "Free returns"]);
    // The component inside the row is still a use of it, with consistent ids.
    const uses = usesIn(refreshed.rows).filter((u) => u.part.global === block.id);
    expect(uses).toHaveLength(2);
    for (const use of uses) expect(extractUse("block", use.part, changed.content.id, {}).content).toEqual(changed.content);
  });

  it("an edit in the builder reaches the page's other uses, the component's first", () => {
    const promise = heading("Free delivery");
    const block: GlobalPart = { id: "20000000-0000-4000-8000-000000000002", kind: "block", content: globalContent("block", promise), translations: {} };
    const inside = row(column(heading("Title")), column(newUse(block, uuid()) as PageBlock));
    const rowGlobal: GlobalPart = { id: "30000000-0000-4000-8000-000000000003", kind: "row", content: globalContent("row", inside), translations: {} };
    const known = new Map<string, GlobalPart>([[block.id, block], [rowGlobal.id, rowGlobal]]);
    const prev: PartsDoc = {
      rows: [newUse(rowGlobal, uuid()) as PageRow, newUse(rowGlobal, uuid()) as PageRow, row(column(newUse(block, uuid()) as PageBlock))],
    };
    // Change the component inside the first row's use.
    const first = prev.rows[0];
    const next: PartsDoc = {
      rows: [{ ...first, columns: [first.columns[0], { ...first.columns[1], blocks: [{ ...(first.columns[1].blocks[0] as HeadingBlock), text: "Free returns" }] }] }, prev.rows[1], prev.rows[2]],
    };
    const settled = settleUses(prev, next, known);
    expect(texts(settled.rows)).toEqual(["Title", "Free returns", "Title", "Free returns", "Free returns"]);
    expect(editedGlobals(settled, known).sort()).toEqual([block.id, rowGlobal.id].sort());
  });
});

describe("texts in other languages", () => {
  it("move with the ids into the global and out to its uses", () => {
    const { hero, global, page } = pageWithGlobal();
    const welcome = hero.columns[0].blocks[0].id;
    const own = page.rows[1].columns[0].blocks[0].id;
    const translated: PartsDoc = { ...page, translations: { sv: { [`block.${welcome}.text`]: "Välkommen", [`block.${own}.text`]: "Egen" } } };
    const current = currentGlobal(translated, global);
    expect(Object.values(current.translations.sv ?? {})).toEqual(["Välkommen"]);

    const other = refreshUses<PartsDoc>({ rows: [newUse(global, uuid()) as PageRow] }, new Map([[global.id, current]]));
    const otherWelcome = other.rows[0].columns[0].blocks[0].id;
    expect(other.translations).toEqual({ sv: { [`block.${otherWelcome}.text`]: "Välkommen" } });
    // A text dropped from the global goes from its uses; the page's own stay.
    const dropped = refreshUses(translated, new Map([[global.id, { ...current, translations: {} }]]));
    expect(dropped.translations).toEqual({ sv: { [`block.${own}.text`]: "Egen" } });
  });
});

describe("copies and detaching", () => {
  it("a copy of a use is another use; a copy of a part holding one keeps it a use", () => {
    const { global, page } = pageWithGlobal();
    const copy = copyWithUses("row", page.rows[0], uuid) as PageRow;
    expect(copy.id).not.toBe(page.rows[0].id);
    expect(refreshUses({ rows: [copy] }, new Map([[global.id, global]])).rows[0]).toEqual(copy);

    const holder = row(column(heading("A")), column({ ...(newUse({ ...global, kind: "block", content: heading("B") }, uuid()) as PageBlock) }));
    const block: GlobalPart = { ...global, kind: "block", content: heading("B") };
    const copied = copyWithUses("row", holder, uuid) as PageRow;
    const use = copied.columns[1].blocks[0];
    expect(use.global).toBe(global.id);
    expect(extractUse("block", use, block.content.id, {}).content).toEqual(block.content);
  });

  it("detaching makes a use a plain copy; so does a global that is gone", () => {
    const { hero, global, page } = pageWithGlobal();
    const local = setLocal(page.rows, hero.columns[1].id, true);
    const detached = detachUse(local, hero.id);
    expect(usesIn(detached)).toEqual([]);
    expect(detached[0].columns[1].local).toBeUndefined();
    expect(texts(detached)).toEqual(texts(page.rows));
    expect(refreshUses({ rows: local }, new Map(), (id) => id === global.id).rows).toEqual(detached);
    expect(withoutUses("row", local[0]).global).toBeUndefined();
  });
});

describe("usePlace", () => {
  it("says where a part is among uses, for its settings", () => {
    const { hero, global, page } = pageWithGlobal();
    const rows = setLocal(page.rows, hero.columns[1].id, true);
    expect(usePlace(rows, hero.id)).toEqual({ global: global.id, within: null, local: false, inLocal: false });
    expect(usePlace(rows, hero.columns[0].id)).toEqual({
      global: null,
      within: { global: global.id, rootId: hero.id, shared: false },
      local: false,
      inLocal: false,
    });
    expect(usePlace(rows, hero.columns[1].id)?.local).toBe(true);
    expect(usePlace(rows, hero.columns[1].blocks[0].id)?.inLocal).toBe(true);
    expect(usePlace(rows, page.rows[1].id)).toEqual({ global: null, within: null, local: false, inLocal: false });
  });
});
