import { describe, expect, it } from "vitest";

import { FIKEN_BLOCK_WORDS, FIKEN_FAILURE_WORDS } from "../fiken-errors";
import { FIKEN_SALE_VAT_TYPES } from "../fiken-settings";
import { FIKEN_PROBLEM_WORDS } from "../fiken-setup";
import { fikenEn } from "./fiken.en";
import { fikenNb } from "./fiken.nb";

/** Every text of a catalogue with its path, so the two languages can be compared leaf by leaf. */
function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}
const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the Fiken catalogue (D460)", () => {
  it("keeps every placeholder of the English in the Norwegian", () => {
    const nb = new Map(leaves(fikenNb));
    for (const [path, en] of leaves(fikenEn)) expect(names(nb.get(path) ?? ""), path).toEqual(names(en));
  });

  it("says in English what the Fiken modules say, and names every VAT type a sale takes", () => {
    expect(fikenEn.failures).toEqual(FIKEN_FAILURE_WORDS);
    expect(fikenEn.blocks).toEqual(FIKEN_BLOCK_WORDS);
    expect(fikenEn.problemWords).toEqual(FIKEN_PROBLEM_WORDS);
    expect(Object.keys(fikenNb.vatTypes).sort()).toEqual([...FIKEN_SALE_VAT_TYPES].sort());
  });
});
