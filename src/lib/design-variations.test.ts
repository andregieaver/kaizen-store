import { describe, expect, it } from "vitest";

import { parseDesignSnapshot, snapshotAsStored, type DesignSnapshot } from "./design-presets";
import {
  chosenVariation,
  installedLook,
  presetChoice,
  presetLine,
  publishedVariations,
  variationChoices,
  variationKey,
  variationName,
  variationSnapshot,
  variationsChanged,
  type DraftVariation,
} from "./design-variations";
import { LAUNCH_THEMES } from "./launch-themes";
import { templateSettings } from "./theme";

/** A theme's presets (`docs/theme-showcase-phase-1.md` step 1): named looks over a theme, kept in its versions. */
const base = (): DesignSnapshot => structuredClone(LAUNCH_THEMES[0].snapshot) as DesignSnapshot;
const coast = { key: "coast", name: "Coast", theme: { base: "bold" as const, settings: templateSettings("bold") } };
const withPresets = (): DesignSnapshot => ({ ...base(), v: 2, variations: [coast] });

describe("a preset's key and name", () => {
  it("comes from its name in the address shape, unique among the theme's, never an address the theme's page uses", () => {
    expect(variationKey("Coast", [])).toBe("coast");
    expect(variationKey("Coast", ["coast"])).toBe("coast-2");
    expect(variationKey("Café & Bar", [])).toBe("cafe-bar");
    expect(variationKey("Try", [])).toBe("try-2");
    expect(variationKey("!!!", [])).toBe("preset");
    expect(variationKey("A".repeat(80), [])).toHaveLength(32);
  });

  it("is a trimmed name of at most 40 characters, and none when empty", () => {
    expect(variationName("  Coast   line ")).toBe("Coast line");
    expect(variationName("   ")).toBeNull();
    expect(variationName("x".repeat(50))).toHaveLength(40);
  });

  it("is read from a form in its shape only, and from an address only when the theme has it", () => {
    expect(presetChoice("coast")).toBe("coast");
    expect(presetChoice("Bad Key")).toBeNull();
    expect(presetChoice(undefined)).toBeNull();
    expect(chosenVariation(withPresets(), "coast")).toBe("coast");
    expect(chosenVariation(withPresets(), "shore")).toBeNull();
  });
});

describe("a version with presets", () => {
  it("is version 2 only when it has presets, so a theme without them is stored as before", () => {
    expect(snapshotAsStored({ ...base(), variations: [] })).not.toHaveProperty("variations");
    expect(snapshotAsStored({ ...base(), variations: [] }).v).toBe(1);
    expect(snapshotAsStored(withPresets())).toMatchObject({ v: 2, variations: [{ key: "coast" }] });
  });

  it("is read with its presets; version 1 has none, and two presets of one key or more than five are refused", () => {
    expect(parseDesignSnapshot(withPresets())?.variations?.map((v) => v.key)).toEqual(["coast"]);
    // A version 1 snapshot never carries presets, whatever it says.
    expect(parseDesignSnapshot({ ...withPresets(), v: 1 })).not.toHaveProperty("variations");
    expect(parseDesignSnapshot({ ...base(), v: 2, variations: [] })?.v).toBe(1);
    expect(parseDesignSnapshot({ ...withPresets(), variations: [coast, coast] })).toBeNull();
    const six = ["a", "b", "c", "d", "e", "f"].map((key) => ({ ...coast, key, name: key }));
    expect(parseDesignSnapshot({ ...withPresets(), variations: six })).toBeNull();
    expect(parseDesignSnapshot({ ...withPresets(), variations: [{ ...coast, key: "Bad Key" }] })).toBeNull();
  });

  it("lays a preset over the theme: its settings in place of the theme's, everything else shared, no presets carried", () => {
    const own = variationSnapshot(withPresets(), null)!;
    expect(own.theme).toEqual(base().theme);
    expect(own).not.toHaveProperty("variations");
    const laid = variationSnapshot(withPresets(), "coast")!;
    expect(laid.theme).toEqual(coast.theme);
    expect(laid.css).toBe(base().css);
    expect(laid.header).toEqual(base().header);
    expect(laid).not.toHaveProperty("variations");
    expect(variationSnapshot(withPresets(), "shore")).toBeNull();
  });

  it("offers the theme's own look first, then its presets in order", () => {
    expect(variationChoices(withPresets(), "Calm")).toEqual([
      { key: null, name: "Calm" },
      { key: "coast", name: "Coast" },
    ]);
  });
});

describe("an install made from a preset", () => {
  it("follows its preset, and has the theme's own look while a version has none of it", () => {
    expect(installedLook(withPresets(), "coast")).toMatchObject({ missing: false, snapshot: { theme: coast.theme } });
    expect(installedLook(base(), "coast")).toMatchObject({ missing: true, snapshot: { theme: base().theme } });
    expect(installedLook(withPresets(), null).snapshot.theme).toEqual(base().theme);
  });

  it("is told when a version drops its preset or brings it back", () => {
    expect(presetLine(withPresets(), base(), "coast")).toBe("This version no longer has the Coast preset, so the theme's own look is used.");
    expect(presetLine(base(), withPresets(), "coast")).toBe("The Coast preset is back in this version.");
    expect(presetLine(withPresets(), withPresets(), "coast")).toBeNull();
    expect(presetLine(withPresets(), base(), null)).toBeNull();
  });
});

describe("the drafted presets", () => {
  const draft = (key: string, position: number, extra: Partial<DraftVariation> = {}): DraftVariation => ({
    id: key,
    key,
    name: key.toUpperCase(),
    position,
    theme: coast.theme,
    ...extra,
  });

  it("are published in their order, and one that cannot be read is left out", () => {
    const published = publishedVariations([draft("b", 2), draft("a", 1), draft("bad", 3, { name: "" })]);
    expect(published.map((v) => v.key)).toEqual(["a", "b"]);
  });

  it("count as unpublished changes while they differ from the version's", () => {
    const version = { ...withPresets(), variations: [{ key: "coast", name: "Coast", theme: coast.theme }] };
    expect(variationsChanged([draft("coast", 1, { name: "Coast" })], version)).toBe(false);
    expect(variationsChanged([draft("coast", 1, { name: "Coastline" })], version)).toBe(true);
    expect(variationsChanged([], base())).toBe(false);
    expect(variationsChanged([draft("coast", 1)], null)).toBe(true);
  });
});
