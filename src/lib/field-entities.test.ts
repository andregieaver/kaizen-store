import { describe, expect, it } from "vitest";

import {
  emptyGroup,
  fieldGroupInput,
  groupApplies,
  importGroups,
  isStaffEntity,
  newField,
  staffGroupProblem,
  type FieldDef,
  type FieldGroup,
  type FieldGroupInput,
  type ShownField,
  type ShownGroup,
} from "./custom-fields";
import { bindPage, hasBindings, hasStoreBindings } from "./field-binding";
import { draftProblems } from "./field-group-editor";
import { newPageContent, pageInput, type HeadingBlock, type PageBlock, type PageContent } from "./page-content";

/**
 * Fields on the store itself, customers and orders (D120): who may be on a
 * group, that customers' and orders' fields are for staff only, and that a
 * block can take its content from the store's own fields.
 */

const field = (over: Partial<FieldDef> & { type: FieldDef["type"] }): FieldDef => ({ ...newField(over.type), ...over });
const group = (over: Partial<FieldGroupInput> & { fields?: FieldDef[] } = {}) => ({
  ...emptyGroup(),
  name: "G",
  slug: "g",
  fields: [field({ type: "text", name: "note", label: "Note" })],
  ...over,
});
const problems = (input: unknown): string[] => {
  const parsed = fieldGroupInput.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

describe("groups for customers and orders are for staff only", () => {
  it("accepts a private group on customers, on orders, or on both", () => {
    expect(problems(group({ entities: ["customer"] }))).toEqual([]);
    expect(problems(group({ entities: ["order"] }))).toEqual([]);
    expect(problems(group({ entities: ["customer", "order"] }))).toEqual([]);
  });

  it("refuses a public field, or a public field inside a group or repeater", () => {
    const pub = field({ type: "text", name: "shown", label: "Shown", access: "public" });
    expect(problems(group({ entities: ["customer"], fields: [pub] }))[0]).toMatch(/for staff only/);
    const nested = field({
      type: "repeater",
      name: "rows",
      label: "Rows",
      subFields: [field({ type: "text", name: "cell", label: "Cell", access: "public" })],
    });
    expect(problems(group({ entities: ["order"], fields: [nested] }))[0]).toMatch(/for staff only/);
  });

  it("refuses being on anything else too, and rules", () => {
    expect(problems(group({ entities: ["customer", "product"] }))[0]).toMatch(/nothing else/);
    expect(problems(group({ entities: ["order", "store"] }))[0]).toMatch(/nothing else/);
    const rule = { param: "kind", operator: "==" as const, value: "goods" };
    expect(problems(group({ entities: ["customer"], location: [[rule]] }))[0]).toMatch(/no rules/);
  });

  it("cannot make a customer's field a filter, a search or something the chat says", () => {
    // Those need a public field, and a public field is refused on a customer's group.
    const filter = field({ type: "boolean", name: "vip", label: "VIP", access: "public", filter: true });
    expect(problems(group({ entities: ["customer"], fields: [filter] })).length).toBeGreaterThan(0);
    const chat = field({ type: "text", name: "note", label: "Note", chat: true });
    expect(problems(group({ entities: ["order"], fields: [chat] })).length).toBeGreaterThan(0);
  });

  it("is told to the group editor before the server is", () => {
    const pub = field({ type: "text", name: "shown", label: "Shown", access: "public" });
    expect(draftProblems(group({ entities: ["customer"], fields: [pub] }) as FieldGroupInput).join(" ")).toMatch(/staff only/);
    expect(draftProblems(group({ entities: ["customer"] }) as FieldGroupInput)).toEqual([]);
  });

  it("is not carried in by an imported file", () => {
    const file = {
      kaizenFieldGroups: 1,
      groups: [{ ...group({ entities: ["customer"], fields: [field({ type: "text", name: "n", label: "N", access: "public" })] }) }],
    };
    const result = importGroups(file, []);
    expect(result.ok).toBe(false);
  });

  it("names the kinds of thing", () => {
    expect(isStaffEntity("customer")).toBe(true);
    expect(isStaffEntity("order")).toBe(true);
    expect(isStaffEntity("store")).toBe(false);
    expect(isStaffEntity("product")).toBe(false);
    expect(staffGroupProblem({ entities: ["product"], fields: [field({ type: "text", access: "public" })] })).toBeNull();
  });
});

describe("groups for the store itself", () => {
  it("may hold public fields, and be on the store together with other things", () => {
    const pub = field({ type: "text", name: "hours", label: "Opening hours", access: "public" });
    expect(problems(group({ entities: ["store"], fields: [pub] }))).toEqual([]);
    expect(problems(group({ entities: ["store", "product"], fields: [pub] }))).toEqual([]);
  });
});

describe("which groups apply", () => {
  const made = (entities: FieldGroup["entities"], location: FieldGroup["location"] = []): FieldGroup => ({
    id: "g",
    name: "G",
    slug: "g",
    entities,
    location,
    fields: [],
    position: "main",
    active: true,
    sort: 0,
  });
  const facts = (entity: FieldGroup["entities"][number]) => ({ entity, categories: [], tags: [], roles: [] });

  it("is a group on the store, a customer or an order for all of them", () => {
    expect(groupApplies(made(["store"]), facts("store"))).toBe(true);
    expect(groupApplies(made(["customer"]), facts("customer"))).toBe(true);
    expect(groupApplies(made(["order"]), facts("order"))).toBe(true);
    // Not for something else.
    expect(groupApplies(made(["customer"]), facts("order"))).toBe(false);
    expect(groupApplies(made(["store"]), facts("product"))).toBe(false);
  });

  it("leaves rules for a product's kind out of the store, which has no such thing", () => {
    const rule = { param: "kind", operator: "==" as const, value: "goods" };
    const both = made(["product", "store"], [[rule]]);
    expect(groupApplies(both, facts("store"))).toBe(true);
    expect(groupApplies(both, { ...facts("product"), kind: "rental" })).toBe(false);
    expect(groupApplies(both, { ...facts("product"), kind: "goods" })).toBe(true);
  });

  it("is off when switched off", () => {
    expect(groupApplies({ ...made(["store"]), active: false }, facts("store"))).toBe(false);
  });
});

describe("blocks that take their content from the store's own fields", () => {
  const text = (id: string, value: string): ShownField => ({ id, name: id, label: id, type: "text", value, text: value });
  const shown = (...fields: ShownField[]): ShownGroup => ({ id: "g1", name: "G", slug: "g", position: "main", fields });
  const heading = (over: Partial<HeadingBlock> = {}): HeadingBlock => ({ id: "h", type: "heading", text: "Own", level: 2, ...over });
  const pageOf = (...blocks: PageBlock[]): PageContent => ({
    ...newPageContent(),
    rows: [{ id: "row1", type: "row", layout: "1", columns: [{ id: "col1", blocks }] }],
  });
  const first = (content: PageContent) => content.rows[0].columns[0].blocks[0];

  const own = [shown(text("f_own0000", "The page's"))];
  const store = [shown(text("f_store00", "Open 9 to 5"))];

  it("look among the store's groups, never the page's, when the binding says the store", () => {
    const content = pageOf(heading({ bind: { fieldId: "f_store00", source: "store" } }));
    expect(hasBindings(content)).toBe(true);
    expect(hasStoreBindings(content)).toBe(true);
    expect(first(bindPage(content, own, store))).toMatchObject({ type: "heading", text: "Open 9 to 5" });
    // The store's field is not found among the page's own fields, nor the other way round.
    expect(first(bindPage(content, store, []))).toBeUndefined();
    const ownField = pageOf(heading({ bind: { fieldId: "f_own0000" } }));
    expect(hasStoreBindings(ownField)).toBe(false);
    expect(first(bindPage(ownField, own, store))).toMatchObject({ text: "The page's" });
    expect(first(bindPage(ownField, [], store))).toBeUndefined();
  });

  it("keep the block's own words as a fallback when the store has no value", () => {
    const content = pageOf(heading({ bind: { fieldId: "f_store00", source: "store", fallback: true } }));
    expect(first(bindPage(content, [], []))).toMatchObject({ text: "Own" });
  });

  it("are saved with their source, and a source that is not the store is refused", () => {
    const ok = pageInput.safeParse({
      ...pageOf(heading({ bind: { fieldId: "f_store00", source: "store" } })),
      title: "T",
      slug: "t",
    });
    expect(ok.success, JSON.stringify(ok.error?.issues)).toBe(true);
    const saved = ok.success ? ok.data.rows[0].columns[0].blocks[0] : null;
    expect(saved).toMatchObject({ bind: { fieldId: "f_store00", source: "store" } });
    const bad = pageInput.safeParse({
      ...pageOf(heading({ bind: { fieldId: "f_store00", source: "customer" as never } })),
      title: "T",
      slug: "t",
    });
    expect(bad.success).toBe(false);
  });

  it("keep the source on a custom fields component and a product part", () => {
    const parsed = pageInput.safeParse({
      ...pageOf({ id: "cf", type: "customField", source: "store" }, { id: "pp", type: "product", part: "fields", source: "store" }),
      title: "T",
      slug: "t",
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const blocks = parsed.success ? parsed.data.rows[0].columns[0].blocks : [];
    expect(blocks).toMatchObject([{ source: "store" }, { source: "store" }]);
  });
});
