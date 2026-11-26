import { describe, expect, it } from "vitest";

import { DAY_NAMES, DAYS } from "../opening-hours";
import { dependentsOf, FEATURE_GROUPS, STORE_FEATURES, type FeatureId } from "../store-features";
import { commonEn } from "./common.en";
import { commonNb } from "./common.nb";
import { settingsEn } from "./settings.en";
import { settingsNb } from "./settings.nb";

/** Every string of a catalogue by its path. */
function strings(value: unknown, path = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") out.set(path, value);
  else if (value && typeof value === "object") for (const [key, v] of Object.entries(value)) for (const [p, s] of strings(v, path ? `${path}.${key}` : key)) out.set(p, s);
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the settings catalogue (D312 A8)", () => {
  it("says in English what the libraries say", () => {
    for (const f of STORE_FEATURES) {
      expect(commonEn.features.labels[f.id]).toBe(f.label);
      expect(settingsEn.features.items[f.id]).toEqual({ words: f.words, offWords: f.offWords });
      // A feature another needs is named in a sentence ("needs the bonus program"); one no other needs may go without (Projects, D903).
      const need = (commonEn.features.need as Partial<Record<FeatureId, string>>)[f.id];
      if (need !== undefined || dependentsOf(f.id).length > 0) expect(need).toBe(f.id === "shop" ? "the online shop" : `the ${f.label.toLowerCase()}`);
    }
    for (const g of FEATURE_GROUPS) expect(settingsEn.features.groups[g.id]).toBe(g.label);
    for (const day of DAYS) {
      expect(settingsEn.hours.days[day]).toBe(DAY_NAMES[day]);
      expect(settingsEn.hours.short[day]).toBe(DAY_NAMES[day].slice(0, 3));
    }
  });

  it("keeps every placeholder in Norwegian", () => {
    for (const [en, nb] of [
      [settingsEn, settingsNb],
      [commonEn.features, commonNb.features],
    ] as const) {
      const english = strings(en);
      const norwegian = strings(nb);
      for (const [path, text] of english) {
        // A problems map is keyed by the server's English; its Norwegian values are checked like any other.
        expect(norwegian.has(path), path).toBe(true);
        expect(placeholders(norwegian.get(path)!), path).toEqual(placeholders(text));
      }
    }
  });
});
