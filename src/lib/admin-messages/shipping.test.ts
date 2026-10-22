import { describe, expect, it } from "vitest";

import { CARRIER_FEATURE_LABELS, CARRIERS } from "../shipping-carriers";
import { groupsFromBlocks, notOfferedWords } from "../shipping-method-form";
import { shippingEn } from "./shipping.en";
import { shippingNb } from "./shipping.nb";

/** Every text of a catalogue with its path, so the two languages can be compared leaf by leaf. */
function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}
const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the shipping catalogue (D312 A8)", () => {
  it("keeps every placeholder of the English in the Norwegian", () => {
    const nb = new Map(leaves(shippingNb));
    for (const [path, en] of leaves(shippingEn)) expect(names(nb.get(path) ?? ""), path).toEqual(names(en));
  });

  it("says in English what the carriers' registry says, so the admin shows the same words", () => {
    expect(shippingEn.carrier.features).toEqual(CARRIER_FEATURE_LABELS);
    for (const info of CARRIERS) {
      const own = shippingEn.carrier.carriers[info.id];
      expect(own.summary).toBe(info.summary);
      expect(own.steps).toEqual(info.steps);
      const fields: Record<string, { label: string; help: string; placeholder: string }> = own.fields;
      for (const field of info.fields) {
        expect(fields[field.key]?.label, `${info.id}.${field.key}`).toBe(field.label);
        expect(fields[field.key]?.help).toBe(field.help ?? "");
        expect(fields[field.key]?.placeholder).toBe(field.placeholder ?? "");
      }
    }
  });

  it("writes a rate block's problems in the words given, English unless given", () => {
    const block = { zoneId: null, profileId: null, basis: "flat" as const, flat: "", tiers: [] };
    expect(groupsFromBlocks([block], "NOK").problems[0].message).toBe("Enter the price in NOK.");
    expect(groupsFromBlocks([block], "NOK", shippingNb.method).problems[0].message).toBe("Skriv inn prisen i NOK.");
    expect(notOfferedWords("Rest of country", "General")).toBe("This method is not offered to a basket with General products sent to Rest of country.");
    expect(notOfferedWords("Resten av landet", "Generelt", shippingNb.method)).toContain("tilbys ikke");
  });
});
