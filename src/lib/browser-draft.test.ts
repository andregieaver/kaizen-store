import { describe, expect, it } from "vitest";

import { EMPTY_DATA } from "./custom-fields";
import { browserStorage, canonical, draftKey, fingerprint, forgetDrafts, pruneDrafts, readDraft, removeDraft, writeDraft, type DraftStorage } from "./browser-draft";
import { productDraftBase, withSavedStock } from "./product-draft";

/**
 * Unsaved work kept in the browser (code review 1.16, D787): a draft is offered only onto the saved version it was made from and only
 * when it holds something else than the editor opened with; a later save, two weeks or an unreadable text drop it; storage that is
 * full, blocked or missing never breaks the editor. And the product editor's version leaves stock out, which a restore takes as it is now.
 */

/** Storage in memory, which can be told to refuse reads, writes or removals, or to hold only so many characters. */
class Memory implements DraftStorage {
  items = new Map<string, string>();
  refuse: { get?: boolean; set?: boolean; remove?: boolean } = {};
  room = Infinity;
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    if (this.refuse.get) throw new Error("SecurityError");
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.refuse.set) throw new Error("SecurityError");
    const used = [...this.items].reduce((sum, [k, v]) => (k === key ? sum : sum + v.length), 0);
    if (used + value.length > this.room) throw new Error("QuotaExceededError");
    this.items.set(key, value);
  }
  removeItem(key: string) {
    if (this.refuse.remove) throw new Error("SecurityError");
    this.items.delete(key);
  }
}

const NOW = Date.UTC(2026, 10, 19, 12);
const DAY = 24 * 60 * 60 * 1000;
const KEY = draftKey("page", "store-1", "page", "page-1");
const opened = { title: "Om oss", rows: [] as string[] };
const edited = { title: "Om oss, ny", rows: ["row"] };

describe("a draft kept in the browser", () => {
  it("is kept per owner, kind and document", () => {
    expect(KEY).toBe("kaizen:draft:page:store-1:page:page-1");
    expect(draftKey("page", "platform", "page", "page-1")).not.toBe(KEY);
    expect(draftKey("product", "demo", "new")).toBe("kaizen:draft:product:demo:new");
  });

  it("is offered when the editor opens on the version it was made from, holding something else", () => {
    const storage = new Memory();
    expect(writeDraft(storage, KEY, "2026-11-19T10:00:00.000Z", edited, NOW - 60_000)).toBe(true);
    const draft = readDraft<typeof edited>(storage, KEY, "2026-11-19T10:00:00.000Z", () => opened, NOW);
    expect(draft).toEqual({ v: 1, at: NOW - 60_000, base: "2026-11-19T10:00:00.000Z", value: edited });
    expect(storage.items.has(KEY)).toBe(true);
  });

  it("is dropped, never offered, once a later save replaced the version it was made from", () => {
    const storage = new Memory();
    writeDraft(storage, KEY, "2026-11-19T10:00:00.000Z", edited, NOW - 60_000);
    // Someone saved at 10:30: the page's version is no longer the draft's.
    expect(readDraft(storage, KEY, "2026-11-19T10:30:00.000Z", () => opened, NOW)).toBeNull();
    expect(storage.items.has(KEY)).toBe(false);
  });

  it("is dropped when it holds just what the editor opened with, whatever the order of its keys", () => {
    const storage = new Memory();
    writeDraft(storage, KEY, "v1", { rows: [], title: "Om oss" }, NOW);
    expect(readDraft(storage, KEY, "v1", () => opened, NOW)).toBeNull();
    expect(storage.items.has(KEY)).toBe(false);
  });

  it("is kept two weeks, then dropped", () => {
    const storage = new Memory();
    writeDraft(storage, KEY, "v1", edited, NOW - 13 * DAY);
    expect(readDraft(storage, KEY, "v1", () => opened, NOW)).not.toBeNull();
    writeDraft(storage, KEY, "v1", edited, NOW - 15 * DAY);
    expect(readDraft(storage, KEY, "v1", () => opened, NOW)).toBeNull();
    expect(storage.items.has(KEY)).toBe(false);
  });

  it("is dropped when its text cannot be read as a draft", () => {
    const storage = new Memory();
    for (const text of ["{not json", "null", JSON.stringify({ v: 2, at: NOW, base: "v1", value: edited }), JSON.stringify({ v: 1, at: NOW, base: "v1" })]) {
      storage.items.set(KEY, text);
      expect(readDraft(storage, KEY, "v1", () => opened, NOW)).toBeNull();
      expect(storage.items.has(KEY)).toBe(false);
    }
  });

  it("does not ask what the editor opened with unless a draft of its version is there", () => {
    const storage = new Memory();
    let asked = 0;
    const ask = () => {
      asked++;
      return opened;
    };
    readDraft(storage, KEY, "v1", ask, NOW);
    writeDraft(storage, KEY, "v0", edited, NOW);
    readDraft(storage, KEY, "v1", ask, NOW);
    expect(asked).toBe(0);
  });

  it("never throws where storage is blocked or missing: the editor works the same without it", () => {
    const storage = new Memory();
    writeDraft(storage, KEY, "v1", edited, NOW);
    storage.refuse = { get: true, set: true, remove: true };
    expect(readDraft(storage, KEY, "v1", () => opened, NOW)).toBeNull();
    expect(writeDraft(storage, KEY, "v1", edited, NOW)).toBe(false);
    expect(() => removeDraft(storage, KEY)).not.toThrow();
    expect(() => pruneDrafts(storage, NOW)).not.toThrow();
    expect(readDraft(null, KEY, "v1", () => opened, NOW)).toBeNull();
    expect(writeDraft(null, KEY, "v1", edited, NOW)).toBe(false);
    // No window here, as on the server: no storage, and signing out forgets nothing without a throw.
    expect(browserStorage()).toBeNull();
    expect(() => forgetDrafts()).not.toThrow();
  });

  it("makes room in full storage from the other drafts, the work in hand first, and leaves the rest of storage alone", () => {
    const storage = new Memory();
    const other = draftKey("page", "store-1", "page", "page-2");
    writeDraft(storage, other, "v1", { title: "x".repeat(400) }, NOW);
    storage.items.set("kaizen:admin-lang", "nb");
    storage.room = 500;
    expect(writeDraft(storage, KEY, "v1", { title: "y".repeat(300) }, NOW)).toBe(true);
    expect(storage.items.has(other)).toBe(false);
    expect(storage.items.get("kaizen:admin-lang")).toBe("nb");
    // Still too large alone: not kept, and no throw.
    expect(writeDraft(storage, KEY, "v1", { title: "z".repeat(600) }, NOW)).toBe(false);
  });

  it("is swept after two weeks, or when unreadable, and every draft is forgotten on signing out", () => {
    const storage = new Memory();
    const old = draftKey("product", "demo", "p-1");
    const fresh = draftKey("product", "demo", "p-2");
    writeDraft(storage, old, "v1", edited, NOW - 20 * DAY);
    writeDraft(storage, fresh, "v1", edited, NOW - DAY);
    storage.items.set(draftKey("product", "demo", "p-3"), "garbled");
    storage.items.set("kaizen:admin-lang", "en");
    pruneDrafts(storage, NOW);
    expect([...storage.items.keys()].sort()).toEqual(["kaizen:admin-lang", fresh]);
    pruneDrafts(storage, NOW, null, true);
    expect([...storage.items.keys()]).toEqual(["kaizen:admin-lang"]);
  });
});

describe("stamps of a saved version", () => {
  it("are the same for the same content in any key order, and differ for other content", () => {
    expect(canonical({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: 3 } })).toBe('{"a":{"c":3,"d":[2,{"e":0,"f":1}]},"b":1}');
    expect(fingerprint("abc")).toBe(fingerprint("abc"));
    expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
    expect(fingerprint("")).toMatch(/^[0-9a-z]+\.0$/);
  });
});

describe("the product editor's draft", () => {
  const variant = (id: string | null, stock: number, price: string) => ({ id, stock, prices: { NO: price }, sku: `SKU-${id ?? "new"}` });
  const saved = { handle: "mug", variants: [variant("a", 10, "199.00"), variant("b", 3, "249.00")] };

  it("is made from the saved product without its stock: sales since do not drop it, a price changed since does", () => {
    const base = productDraftBase(saved, EMPTY_DATA, {});
    const sold = { ...saved, variants: [variant("a", 7, "199.00"), variant("b", 0, "249.00")] };
    expect(productDraftBase(sold, EMPTY_DATA, {})).toBe(base);
    const repriced = { ...saved, variants: [variant("a", 10, "179.00"), variant("b", 3, "249.00")] };
    expect(productDraftBase(repriced, EMPTY_DATA, {})).not.toBe(base);
    expect(productDraftBase(saved, { values: { material: "stone" }, translations: {} }, {})).not.toBe(base);
  });

  it("shows each saved variant's stock as it is now when restored, and a new variant's as typed", () => {
    const draft = { handle: "mug-2", variants: [variant("a", 10, "189.00"), variant(null, 5, "99.00")] };
    const now = { ...saved, variants: [variant("a", 6, "199.00"), variant("b", 0, "249.00")] };
    const restored = withSavedStock(draft, now);
    expect(restored.handle).toBe("mug-2");
    expect(restored.variants.map((v) => [v.id, v.stock, v.prices.NO])).toEqual([
      ["a", 6, "189.00"],
      [null, 5, "99.00"],
    ]);
  });
});
