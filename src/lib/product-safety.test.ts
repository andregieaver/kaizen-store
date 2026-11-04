import { describe, expect, it } from "vitest";

import { establishedIn, missingResponsible, responsibleAreas, ruleFor, safetyData, safetyOf, type ProductSafety, type ResponsibleArea } from "./product-safety";

const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
const EEA_EFTA = ["NO", "IS", "LI"];

/** The classification and rules as the migration seeds them (3 November 2026), with the EEA EFTA states' rule chosen per test. */
const safety = (eeaEfta: ResponsibleArea): ProductSafety => ({
  eu: new Set(EU),
  eea: new Set([...EU, ...EEA_EFTA]),
  rules: new Map<string, ResponsibleArea>([...EU.map((c) => [c, "eu"] as const), ...EEA_EFTA.map((c) => [c, eeaEfta] as const)]),
});
const now = safety("none");
const incorporated = safety("eea");

describe("EU and EEA membership", () => {
  it("are two classifications: an EEA EFTA state is in the EEA and never in the EU", () => {
    for (const c of EEA_EFTA) expect([establishedIn("eu", c, now), establishedIn("eea", c, now)]).toEqual([false, true]);
    expect([establishedIn("eu", "SE", now), establishedIn("eea", "SE", now)]).toEqual([true, true]);
    expect([establishedIn("eu", "CH", now), establishedIn("eea", "CH", now), establishedIn("eu", null, now)]).toEqual([false, false, false]);
    // EU membership is never worked out from EEA membership: a country only in the EEA set stays outside the EU.
    expect(establishedIn("eu", "NO", { eu: new Set(), eea: new Set(["NO"]), rules: new Map() })).toBe(false);
  });

  it("holds an EU member state without a rule to the EU's, and any other country without one to nothing", () => {
    const bare: ProductSafety = { eu: new Set(EU), eea: new Set([...EU, ...EEA_EFTA]), rules: new Map() };
    expect([ruleFor("DE", bare), ruleFor("NO", bare), ruleFor("CH", bare)]).toEqual(["eu", "none", "none"]);
  });
});

describe("the responsible person a manufacturer needs, per destination", () => {
  for (const maker of EEA_EFTA) {
    describe(`a manufacturer in ${maker}`, () => {
      it("selling into the EU needs one established in the EU; one in the EEA outside the EU is not enough", () => {
        expect(responsibleAreas(maker, ["SE"], now)).toEqual(["eu"]);
        for (const rep of EEA_EFTA) expect(missingResponsible(maker, rep, ["SE"], now)).toEqual(["eu"]);
        expect(missingResponsible(maker, "DE", ["SE"], now)).toEqual([]);
        // Incorporation into the EEA Agreement changes nothing on the EU market.
        expect(missingResponsible(maker, "NO", ["SE"], incorporated)).toEqual(["eu"]);
      });

      it("selling into the EEA EFTA states needs none while the GPSR is not incorporated there", () => {
        expect(responsibleAreas(maker, EEA_EFTA, now)).toEqual([]);
        expect(missingResponsible(maker, null, ["NO"], now)).toEqual([]);
      });

      it("selling into the EEA EFTA states needs none once incorporated either: it is established in the EEA", () => {
        expect(responsibleAreas(maker, EEA_EFTA, incorporated)).toEqual([]);
      });

      it("selling into both needs one in the EU", () => {
        expect(responsibleAreas(maker, ["NO", "DK"], now)).toEqual(["eu"]);
        expect(missingResponsible(maker, "IS", ["NO", "DK"], incorporated)).toEqual(["eu"]);
        expect(missingResponsible(maker, "DK", ["NO", "DK"], incorporated)).toEqual([]);
      });
    });
  }

  it("asks a manufacturer outside the EEA for one in the EEA where incorporated, which one in Norway, Iceland or Liechtenstein satisfies", () => {
    expect(responsibleAreas("CN", ["NO"], now)).toEqual([]);
    expect(responsibleAreas("CN", ["NO"], incorporated)).toEqual(["eea"]);
    for (const rep of [...EEA_EFTA, "SE"]) expect(missingResponsible("CN", rep, ["IS"], incorporated)).toEqual([]);
    expect(missingResponsible("CN", "CH", ["LI"], incorporated)).toEqual(["eea"]);
    // Into the EU and an incorporated EEA EFTA state: an EU responsible person covers both, an EEA EFTA one only the latter.
    expect(responsibleAreas("CN", ["NO", "SE"], incorporated)).toEqual(["eu", "eea"]);
    expect(missingResponsible("CN", "NO", ["NO", "SE"], incorporated)).toEqual(["eu"]);
    expect(missingResponsible("CN", "SE", ["NO", "SE"], incorporated)).toEqual([]);
  });

  it("keeps the EU's rule for an EU manufacturer: none needed", () => {
    expect(responsibleAreas("DE", ["SE", "NO"], incorporated)).toEqual([]);
  });

  it("passes to the browser and back unchanged", () => {
    const back = safetyOf(safetyData(incorporated));
    expect(missingResponsible("CN", "NO", ["NO", "SE"], back)).toEqual(["eu"]);
  });
});
