import { describe, expect, it } from "vitest";

import {
  CONDITION_OPERATORS,
  FIELD_CATEGORIES,
  FIELD_ENTITIES,
  FIELD_POSITIONS,
  FIELD_PRESETS,
  FIELD_TYPES,
  LINK_KINDS,
  LOCATION_CHOICES,
  LOCATION_PARAMS,
} from "../custom-fields";
import { fieldsEn } from "./fields.en";
import { fieldsNb } from "./fields.nb";

/** The keys of a nested object, as paths. */
const paths = (value: unknown, at = ""): string[] =>
  typeof value === "object" && value !== null
    ? Object.entries(value).flatMap(([key, inner]) => paths(inner, at ? `${at}.${key}` : key))
    : [at];

describe("the custom fields catalogue (D312 A5)", () => {
  it("says in English what the library says", () => {
    for (const [type, facts] of Object.entries(FIELD_TYPES)) {
      expect(fieldsEn.types[type as keyof typeof FIELD_TYPES]).toEqual({ label: facts.label, hint: facts.hint });
    }
    expect(Object.keys(fieldsEn.types)).toEqual(Object.keys(FIELD_TYPES));
    expect(Object.values(fieldsEn.categories)).toEqual([...FIELD_CATEGORIES]);
    expect(Object.keys(fieldsEn.categories)).toEqual([...FIELD_CATEGORIES]);
    expect(fieldsEn.entities).toEqual(FIELD_ENTITIES);
    expect(fieldsEn.positions).toEqual(FIELD_POSITIONS);
    expect(fieldsEn.linkKinds).toEqual(LINK_KINDS);
    expect(fieldsEn.operators).toEqual(CONDITION_OPERATORS);
    const labels = new Set(Object.values(LOCATION_PARAMS).flatMap((list) => list.map((p) => p.label)));
    expect(new Set(Object.keys(fieldsEn.params))).toEqual(labels);
    for (const label of labels) expect(fieldsEn.params[label as keyof typeof fieldsEn.params]).toBe(label);
    for (const [param, choices] of Object.entries(LOCATION_CHOICES)) {
      expect(fieldsEn.choices[param as keyof typeof fieldsEn.choices]).toEqual(
        Object.fromEntries(choices.map((c) => [c.value, c.label])),
      );
    }
    for (const preset of FIELD_PRESETS) {
      expect(fieldsEn.presets[preset.key as keyof typeof fieldsEn.presets]).toEqual({
        name: preset.name,
        description: preset.description,
      });
    }
  });

  it("has every word in Norwegian, with the same placeholders", () => {
    expect(paths(fieldsNb)).toEqual(paths(fieldsEn));
    const at = (root: unknown, path: string) => path.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], root);
    for (const path of paths(fieldsEn)) {
      const names = (text: unknown) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(names(at(fieldsNb, path)), path).toEqual(names(at(fieldsEn, path)));
    }
  });
});
