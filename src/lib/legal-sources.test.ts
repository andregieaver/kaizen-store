import { describe, expect, it } from "vitest";

import { CONDITIONAL_TOPICS, REQUIRED_TOPICS, STARTER_LANGUAGES, STARTER_ROLES } from "./legal-starters";
import {
  COVERED_COUNTRIES,
  DISPUTE_BODIES,
  LEGAL_LANGUAGES,
  LEGAL_SOURCES,
  LEGAL_SOURCES_BY_KEY,
  TOPIC_REFS,
  jurisdictionsFor,
  passagesNamed,
  readingLanguage,
  refsFor,
  registerProblems,
} from "./legal-sources";

/** The register of legal sources (D311, unit L, `docs/ai-autopilot.md` 8.2). */

describe("the register", () => {
  it("has nothing wrong with it", () => {
    expect(registerProblems()).toEqual([]);
  });

  it("speaks the starters' languages", () => {
    expect([...LEGAL_LANGUAGES].sort()).toEqual([...STARTER_LANGUAGES].sort());
  });

  it("names only real topics of real kinds of page", () => {
    for (const key of Object.keys(TOPIC_REFS)) {
      const [role, topic] = key.split(".");
      expect(STARTER_ROLES as readonly string[], key).toContain(role);
      const topics = [...REQUIRED_TOPICS[role as (typeof STARTER_ROLES)[number]], ...Object.keys(CONDITIONAL_TOPICS[role as (typeof STARTER_ROLES)[number]])];
      expect(topics, key).toContain(topic);
    }
  });

  it("gives the law's core topics a source in every covered country, in its own language or through EU law", () => {
    const core = ["terms.withdrawal", "terms.conformity", "returns_policy.window", "withdrawal_info.right", "withdrawal_info.model_form", "privacy.rights", "imprint.legal_name"];
    for (const country of COVERED_COUNTRIES) {
      const jurisdictions = jurisdictionsFor({ country, markets: [{ code: country }] });
      for (const topic of core) expect(refsFor(topic, jurisdictions, "en").length, `${country} ${topic}`).toBeGreaterThan(0);
    }
  });

  it("names a complaint body for every covered country and never the repealed ODR platform", () => {
    for (const country of COVERED_COUNTRIES) expect(DISPUTE_BODIES[country].length).toBeGreaterThan(0);
    expect(JSON.stringify({ LEGAL_SOURCES, DISPUTE_BODIES })).not.toMatch(/ec\.europa\.eu\/consumers\/odr/i);
  });

  it("lists the passages a read of each source must find", () => {
    expect(passagesNamed("eu-crd")).toEqual(expect.arrayContaining(["art_9", "art_16", "anx_I"]));
    expect(passagesNamed("se-distans")).toContain("2:10");
    expect(passagesNamed("dk-forbrugeraftale")).toContain("18");
  });
});

describe("which law a store's pages rest on", () => {
  it("is EU law and the seller's own country, with the covered countries it sells to", () => {
    expect(jurisdictionsFor({ country: "NO", markets: [{ code: "NO" }] })).toEqual(["EU", "NO"]);
    expect(jurisdictionsFor({ country: "SE", markets: [{ code: "SE" }, { code: "DK" }, { code: "DE" }] })).toEqual(["EU", "SE", "DK"]);
  });

  it("is none for a seller outside the covered countries", () => {
    expect(jurisdictionsFor({ country: "DE", markets: [{ code: "DE" }] })).toEqual([]);
    expect(jurisdictionsFor({ country: null, markets: [] })).toEqual([]);
  });

  it("puts sources in the page's language first, and reads EU law in English for a Norwegian page", () => {
    const refs = refsFor("terms.withdrawal", ["EU", "NO"], "nb");
    expect(refs[0].source).toBe("no-arl");
    expect(readingLanguage(LEGAL_SOURCES_BY_KEY["eu-crd"], "nb")).toBe("en");
    expect(readingLanguage(LEGAL_SOURCES_BY_KEY["eu-crd"], "da")).toBe("da");
  });
});
