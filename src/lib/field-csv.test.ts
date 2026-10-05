import { describe, expect, it } from "vitest";

import type { FieldDef } from "./custom-fields";
import { PLAIN_FIELD_TYPES, isNumberCell, isPlainField, parsePlainField, plainFieldText } from "./field-csv";

const def = (type: FieldDef["type"], extra: Partial<FieldDef> = {}): FieldDef => ({ id: "f_x", name: "x", label: "X", type, access: "private", ...extra }) as FieldDef;

describe("plain fields in a cell", () => {
  it("lists the types that fit in a cell, and none that hold structure, files or relations", () => {
    for (const t of ["group", "repeater", "flexible", "gallery", "image", "video", "file", "richText", "link", "product", "page", "term"]) expect(isPlainField({ type: t as never }), t).toBe(false);
    for (const t of PLAIN_FIELD_TYPES) expect(isPlainField({ type: t })).toBe(true);
  });

  const cases: [FieldDef, never | unknown, string][] = [
    [def("text"), "Hello, world", "Hello, world"],
    [def("number"), 12.5, "12.5"],
    [def("number"), -3, "-3"],
    [def("measurement", { units: ["g", "kg"] }), { value: 250, unit: "g" }, "250 g"],
    [def("money"), { amountMinor: 1250, currency: "NOK" }, "12.50 NOK"],
    [def("money"), { amountMinor: 500, currency: "HUF" }, "5.00 HUF"],
    [def("boolean"), true, "true"],
    [def("boolean"), false, "false"],
    [def("select", { choices: [{ key: "red", label: "Red" }] }), "red", "red"],
    [def("checkbox", { choices: [{ key: "a", label: "A" }, { key: "b", label: "B" }] }), ["a", "b"], "a | b"],
    [def("date"), "2026-10-05", "2026-10-05"],
    [def("url"), "https://example.com/a?b=c", "https://example.com/a?b=c"],
    [def("email"), "a@example.com", "a@example.com"],
    [def("color"), "#1f2937", "#1f2937"],
    [def("time"), "14:30", "14:30"],
  ];

  it("round-trips a value through its text", () => {
    for (const [d, value, text] of cases) {
      expect([d.type, plainFieldText(d, value as never)]).toEqual([d.type, text]);
      const back = parsePlainField(d, text);
      expect([d.type, back]).toEqual([d.type, { ok: true, value }]);
    }
  });

  it("takes a value away with a blank cell, and says nothing for no value", () => {
    expect(parsePlainField(def("text"), "  ")).toEqual({ ok: true, value: null });
    expect(plainFieldText(def("text"), null)).toBe("");
    expect(plainFieldText(def("number"), undefined)).toBe("");
  });

  it("refuses what the field itself would refuse", () => {
    expect(parsePlainField(def("number", { max: 10 }), "11").ok).toBe(false);
    expect(parsePlainField(def("number"), "abc").ok).toBe(false);
    expect(parsePlainField(def("select", { choices: [{ key: "a", label: "A" }] }), "z").ok).toBe(false);
    expect(parsePlainField(def("email"), "nope").ok).toBe(false);
    expect(parsePlainField(def("boolean"), "maybe").ok).toBe(false);
    expect(parsePlainField(def("money"), "12.50").ok).toBe(false);
    expect(parsePlainField(def("money"), "12.505 NOK").ok).toBe(false);
    expect(parsePlainField(def("measurement", { units: ["g"] }), "5 kg").ok).toBe(false);
    expect(parsePlainField(def("group"), "x").ok).toBe(false);
  });

  it("reads a decimal comma in a number and either boolean wording", () => {
    expect(parsePlainField(def("number"), "12,5")).toEqual({ ok: true, value: 12.5 });
    expect(parsePlainField(def("boolean"), "Yes")).toEqual({ ok: true, value: true });
    expect(parsePlainField(def("boolean"), "0")).toEqual({ ok: true, value: false });
  });

  it("writes a number as a number cell and never anything else", () => {
    expect(isNumberCell(def("number"), "-3")).toBe(true);
    expect(isNumberCell(def("number"), "12.5")).toBe(true);
    expect(isNumberCell(def("text"), "12")).toBe(false);
    expect(isNumberCell(def("number"), "=1")).toBe(false);
  });
});
