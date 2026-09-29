import { describe, expect, it } from "vitest";

import {
  FIELD_CATEGORIES,
  FIELD_TYPES,
  applyChanges,
  changesFrom,
  chatDetails,
  conditionHolds,
  displayText,
  emptyGroup,
  fieldGroupInput,
  isEmptyValue,
  moneyProblems,
  needsLookups,
  newField,
  operatorsFor,
  parseFieldChanges,
  parseValue,
  readField,
  shownGroup,
  structuredProperties,
  valueText,
  writeField,
  type FieldData,
  type FieldDef,
  type FieldGroup,
} from "./custom-fields";
import { MAX_MONEY_MINOR } from "./field-money";
import { coerceFieldValue, fieldValueText, isSimpleType } from "./field-tools";

const money = (over: Partial<FieldDef> = {}): FieldDef => ({
  ...newField("money"),
  id: "f_deposit00001",
  name: "deposit",
  label: "Deposit",
  ...over,
});

const inGroup = (fields: FieldDef[]) => ({ ...emptyGroup("product"), name: "Terms", slug: "terms", fields });
const words = { yes: "Yes", no: "No" };

describe("the money field type", () => {
  it("is a commerce field that is the same in every language, with a hint that it is no price", () => {
    expect(FIELD_TYPES.money).toMatchObject({ label: "Money", category: "Commerce", translatable: false });
    expect(FIELD_TYPES.money.hint).toMatch(/not a price shoppers pay/);
    expect(FIELD_CATEGORIES).toContain("Commerce");
    expect(newField("money")).toMatchObject({ type: "money", access: "private", label: "Money" });
  });
});

describe("checking a money value", () => {
  const field = money();
  it("keeps integer minor units and an ISO code, from an editor's value or an amount typed as digits", () => {
    expect(parseValue(field, { amountMinor: 1250, currency: "EUR" })).toEqual({
      ok: true,
      value: { amountMinor: 1250, currency: "EUR" },
    });
    expect(parseValue(field, { amountMinor: "1250", currency: "nok" })).toEqual({
      ok: true,
      value: { amountMinor: 1250, currency: "NOK" },
    });
    expect(parseValue(field, { amountMinor: 0, currency: "SEK" })).toEqual({
      ok: true,
      value: { amountMinor: 0, currency: "SEK" },
    });
  });

  it("takes an empty amount away", () => {
    expect(parseValue(field, null)).toEqual({ ok: true, value: null });
    expect(parseValue(field, { amountMinor: "", currency: "EUR" })).toEqual({ ok: true, value: null });
    expect(parseValue(field, { amountMinor: null, currency: "EUR" })).toEqual({ ok: true, value: null });
  });

  it("refuses fractions, negatives, an amount too large, text, and a currency that is not one", () => {
    for (const raw of [
      { amountMinor: 12.5, currency: "EUR" },
      { amountMinor: -1, currency: "EUR" },
      { amountMinor: "12.50", currency: "EUR" },
      { amountMinor: "abc", currency: "EUR" },
      { amountMinor: MAX_MONEY_MINOR + 1, currency: "EUR" },
      { amountMinor: 100, currency: "XYZ" },
      { amountMinor: 100, currency: "" },
      { amountMinor: 100 },
      "12 EUR",
      12,
      [1250, "EUR"],
    ]) {
      expect(parseValue(field, raw).ok, JSON.stringify(raw)).toBe(false);
    }
    expect(parseValue(field, { amountMinor: MAX_MONEY_MINOR, currency: "EUR" }).ok).toBe(true);
  });

  it("holds the least and most, as amounts in the currency entered", () => {
    const bounded = money({ min: 10, max: 500 });
    expect(parseValue(bounded, { amountMinor: 1000, currency: "EUR" }).ok).toBe(true);
    expect(parseValue(bounded, { amountMinor: 999, currency: "EUR" })).toMatchObject({
      ok: false,
      problem: "Deposit: Use at least 10 EUR.",
    });
    expect(parseValue(bounded, { amountMinor: 50001, currency: "NOK" })).toMatchObject({
      ok: false,
      problem: "Deposit: Use at most 500 NOK.",
    });
  });
});

describe("a money value in words and in conditions", () => {
  const value = { amountMinor: 1250, currency: "EUR" };
  it("is worded in the language, by the market's conversion when one is given, and never empty once entered", () => {
    expect(displayText(money(), value, "en", words)).toMatch(/€\s?12\.50|12\.50\s?€/);
    expect(displayText(money(), value, "nb-NO", { ...words, money: () => "kr 143,75" })).toBe("kr 143,75");
    expect(valueText(value)).toBe("12.5 EUR");
    expect(isEmptyValue(value)).toBe(false);
    expect(isEmptyValue({ amountMinor: 0, currency: "EUR" })).toBe(false);
  });

  it("compares as its major amount", () => {
    const wanted = (operator: ">" | "<", v: string) =>
      conditionHolds({ field: "f_deposit00001", operator, value: v }, { f_deposit00001: value });
    expect(wanted(">", "12")).toBe(true);
    expect(wanted(">", "13")).toBe(false);
    expect(wanted("<", "13")).toBe(true);
    expect(operatorsFor("money")).toEqual(["has", "empty", ">", "<"]);
  });

  it("is told to the AI manager as it is, and is a type it cannot fill in", () => {
    expect(fieldValueText(money(), value, "en", words)).toMatch(/12\.50/);
    expect(isSimpleType("money")).toBe(false);
    expect(coerceFieldValue(money(), "12.50 EUR", "the editor")).toMatchObject({ ok: false });
  });
});

describe("saving and reading money", () => {
  const field = money({ access: "public" });
  const value = { amountMinor: 4990, currency: "NOK" };

  it("round trips through the editor's changes and the data, the same in every language", () => {
    let data: FieldData = { values: {}, translations: {} };
    data = writeField(field, data, "nb", "nb", value);
    expect(data).toEqual({ values: { [field.id]: value }, translations: {} });
    expect(readField(field, data, "sv", "nb")).toEqual(value);

    const sent = changesFrom([field], data, ["nb", "sv"]);
    expect(sent).toEqual({ values: { [field.id]: value }, translations: {} });
    const parsed = parseFieldChanges([field], sent, ["nb", "sv"], "nb");
    expect(parsed.problems).toEqual([]);
    expect(applyChanges({ values: {}, translations: {} }, parsed.changes)).toEqual(data);
    expect(writeField(field, data, "nb", "nb", undefined)).toEqual({ values: {}, translations: {} });
  });

  it("is drawn in a group, converted as the caller says, and with the field's own text", () => {
    const g: FieldGroup = { ...inGroup([field]), id: "g", sort: 0, fields: [field] };
    const shown = shownGroup(
      g,
      { values: { [field.id]: value }, translations: {} },
      "sv-SE",
      "nb",
      { ...words, money: (v) => `${(v.amountMinor / 100) * 1.05} SEK` },
      { publicOnly: true },
    );
    expect(shown.fields).toHaveLength(1);
    expect(shown.fields[0]).toMatchObject({ type: "money", text: "52.395 SEK", value });
  });

  it("is refused in a currency the store does not offer, once it is known which it offers", () => {
    const changes = { values: { [field.id]: value }, translations: {} };
    expect(moneyProblems([field], changes, ["NOK", "EUR"])).toEqual([]);
    expect(moneyProblems([field], changes, ["EUR", "SEK"])).toEqual([
      "Deposit: the store does not offer NOK. Choose one of EUR, SEK.",
    ]);
    // Inside a repeater's rows and a group's cells too.
    const cell = money({ id: "f_cellmoney001", name: "cell", label: "Cell" });
    const repeater: FieldDef = {
      ...newField("repeater"),
      id: "f_reprows00001",
      name: "rows",
      label: "Rows",
      subFields: [cell],
    };
    const grouped: FieldDef = {
      ...newField("group"),
      id: "f_grpmoney0001",
      name: "grp",
      label: "Grp",
      subFields: [cell],
    };
    const inRows = {
      values: {
        [repeater.id]: [{ id: "r_aaaaaaaa", [cell.id]: { amountMinor: 1, currency: "NOK" } }] as never,
        [grouped.id]: { [cell.id]: { amountMinor: 1, currency: "SEK" } } as never,
      },
      translations: {},
    };
    expect(moneyProblems([repeater, grouped], inRows, ["EUR"])).toHaveLength(2);
  });

  it("asks the editor for the store's currencies", () => {
    const g = { ...inGroup([field]), id: "g", sort: 0 } as FieldGroup;
    expect(needsLookups([g])).toBe(true);
    expect(needsLookups([{ ...g, fields: [newField("text")] }])).toBe(false);
  });
});

describe("money and the chat assistant, filters and search", () => {
  const body = (over: Partial<FieldDef>) => ({ ...inGroup([money({ access: "public", ...over })]) });

  it("cannot be told by the chat: the schema refuses the flag, on a field or one inside a group", () => {
    const result = fieldGroupInput.safeParse(body({ chat: true }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain(
      "Deposit cannot be told by the chat: the assistant states no amount from a field.",
    );

    const inner = fieldGroupInput.safeParse(
      inGroup([
        {
          ...newField("group"),
          id: "f_grpmoney0002",
          name: "grp",
          label: "Grp",
          access: "public",
          subFields: [money({ chat: true })],
        },
      ]),
    );
    expect(inner.success).toBe(false);
    expect(fieldGroupInput.safeParse(body({})).success).toBe(true);
  });

  it("is no filter and is not searched", () => {
    expect(fieldGroupInput.safeParse(body({ filter: true })).success).toBe(false);
    expect(fieldGroupInput.safeParse(body({ search: true })).success).toBe(false);
  });

  it("is left out of what the chat and structured data say, even when the flag is somehow set", () => {
    const g = { ...inGroup([money({ access: "public", chat: true })]), id: "g", sort: 0 } as FieldGroup;
    const shown = shownGroup(
      g,
      { values: { [g.fields[0].id]: { amountMinor: 100, currency: "EUR" } }, translations: {} },
      "en",
      "en",
      words,
      { publicOnly: true },
    );
    expect(shown.fields[0].chat).toBe(true);
    expect(chatDetails([shown])).toEqual([]);
    expect(structuredProperties([shown])).toEqual([]);
  });
});
