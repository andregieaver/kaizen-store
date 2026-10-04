import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMS_MODE,
  TERMS_MODES,
  TERMS_MODE_WORDS,
  canonicalJson,
  isTermsMode,
  payHeld,
  payStep,
  sentenceKind,
  sha256Hex,
  snapshotHash,
  staffTermsLine,
  termsDisplay,
  termsPagesOf,
  termsSettingNotice,
  termsSettingProblem,
  type OrderTermsRecord,
} from "./checkout-terms";

const terms = { title: "Vilkår", href: "/s/demo/no/vilkar" };
const privacy = { title: "Personvern", href: "/s/demo/no/personvern" };

describe("the modes", () => {
  it("are link (the default), checkbox and off", () => {
    expect(TERMS_MODES).toEqual(["link", "checkbox", "off"]);
    expect(DEFAULT_TERMS_MODE).toBe("link");
    for (const mode of TERMS_MODES) expect(TERMS_MODE_WORDS[mode].name.length).toBeGreaterThan(1);
    expect(isTermsMode("checkbox")).toBe(true);
    expect(isTermsMode("banner")).toBe(false);
    expect(isTermsMode(undefined)).toBe(false);
  });
});

describe("which pages the sentence names", () => {
  it("names the terms and the privacy statement, in that order, whichever the store has", () => {
    expect(termsPagesOf({ terms, privacy }).map((p) => p.role)).toEqual(["terms", "privacy"]);
    expect(termsPagesOf({ privacy, terms }).map((p) => p.role)).toEqual(["terms", "privacy"]);
    expect(termsPagesOf({ privacy }).map((p) => p.role)).toEqual(["privacy"]);
    expect(termsPagesOf({ terms: null, privacy: undefined })).toEqual([]);
    expect(termsPagesOf({})).toEqual([]);
  });

  it("leaves out a page with no title or address, and trims the title", () => {
    expect(termsPagesOf({ terms: { title: "  ", href: "/x" }, privacy: { title: " Personvern ", href: "/p" } })).toEqual([{ role: "privacy", title: "Personvern", href: "/p" }]);
    expect(termsPagesOf({ terms: { title: "T", href: "" } })).toEqual([]);
  });

  it("has a form of sentence for each case, and none for nothing", () => {
    expect(sentenceKind(termsPagesOf({ terms, privacy }))).toBe("both");
    expect(sentenceKind(termsPagesOf({ terms }))).toBe("terms");
    expect(sentenceKind(termsPagesOf({ privacy }))).toBe("privacy");
    expect(sentenceKind([])).toBeNull();
  });
});

describe("what checkout draws", () => {
  const both = termsPagesOf({ terms, privacy });

  it("draws the sentence in link and checkbox mode, and nothing when it is off or there is nothing to name", () => {
    expect(termsDisplay("link", both)).toMatchObject({ mode: "link", kind: "both" });
    expect(termsDisplay("checkbox", both)).toMatchObject({ mode: "checkbox", kind: "both" });
    expect(termsDisplay("off", both)).toBeNull();
    expect(termsDisplay("link", [])).toBeNull();
    expect(termsDisplay("checkbox", [])).toBeNull();
    expect(termsDisplay("link", termsPagesOf({ privacy }))).toMatchObject({ kind: "privacy" });
  });

  it("holds the pay button until the box is ticked, in checkbox mode only", () => {
    const link = termsDisplay("link", both);
    const box = termsDisplay("checkbox", both);
    expect(payHeld(box, false)).toBe(true);
    expect(payHeld(box, true)).toBe(false);
    expect(payHeld(link, false)).toBe(false);
    expect(payHeld(null, false)).toBe(false);
  });

  it("records before it pays, and stops when it cannot only in checkbox mode", () => {
    expect(payStep(termsDisplay("checkbox", both))).toEqual({ record: true, stopOnFailure: true });
    expect(payStep(termsDisplay("link", both))).toEqual({ record: true, stopOnFailure: false });
    expect(payStep(termsDisplay("off", both))).toEqual({ record: false });
    expect(payStep(null)).toEqual({ record: false });
  });
});

describe("settings", () => {
  it("refuses a tick box with no terms page to tick for", () => {
    expect(termsSettingProblem("checkbox", {})).toMatch(/terms page/);
    expect(termsSettingProblem("checkbox", { privacy: "x" })).toMatch(/terms page/);
    expect(termsSettingProblem("checkbox", { terms: "x" })).toBeNull();
    expect(termsSettingProblem("link", {})).toBeNull();
    expect(termsSettingProblem("off", {})).toBeNull();
  });

  it("says when the mode cannot be honoured now", () => {
    expect(termsSettingNotice("link", [])).toMatch(/no sentence and keeps no record/);
    expect(termsSettingNotice("checkbox", termsPagesOf({ privacy }))).toMatch(/no tick box/);
    expect(termsSettingNotice("checkbox", termsPagesOf({ terms }))).toBeNull();
    expect(termsSettingNotice("off", [])).toBeNull();
  });
});

describe("what staff are told", () => {
  const format = (d: Date) => d.toISOString().slice(0, 10);
  const record: OrderTermsRecord = {
    orderId: "o1",
    mode: "checkbox",
    acceptedAt: new Date("2026-10-03T10:00:00Z"),
    locale: "nb-NO",
    snapshots: [
      { role: "terms", snapshotId: "s1", hash: "a".repeat(64), title: "Vilkår" },
      { role: "privacy", snapshotId: "s2", hash: "b".repeat(64), title: "Personvern" },
    ],
  };

  it("says when the terms were accepted and as what", () => {
    expect(staffTermsLine(record, { mode: "checkbox", storeHasRecords: true, format })).toMatchObject({ kind: "accepted", text: "Terms accepted 2026-10-03 as ticked", titles: ["Vilkår", "Personvern"] });
    expect(staffTermsLine({ ...record, mode: "link" }, { mode: "link", storeHasRecords: true, format })).toMatchObject({ text: "Terms accepted 2026-10-03 as shown" });
    // A record stands whatever the setting is now.
    expect(staffTermsLine(record, { mode: "off", storeHasRecords: false, format }).kind).toBe("accepted");
  });

  it("says the link was shown and nothing was kept, where the store keeps records", () => {
    expect(staffTermsLine(null, { mode: "link", storeHasRecords: true, format })).toEqual({ kind: "not_recorded", text: "Terms link shown, not recorded" });
    expect(staffTermsLine(null, { mode: "checkbox", storeHasRecords: true, format }).kind).toBe("not_recorded");
  });

  it("says nothing for a copied order, a store that never kept records, or when it is off", () => {
    expect(staffTermsLine(null, { mode: "link", copied: true, storeHasRecords: true, format })).toEqual({ kind: "none" });
    expect(staffTermsLine(null, { mode: "link", storeHasRecords: false, format })).toEqual({ kind: "none" });
    expect(staffTermsLine(null, { mode: "off", storeHasRecords: true, format })).toEqual({ kind: "none" });
  });
});

describe("the hash of a snapshot", () => {
  it("is SHA-256: it agrees with node's for the known vectors and for odd strings", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    const samples = ["a", "Kjøpsvilkår æøå", "日本語 ✓ 🚀", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(1000), "line\nbreak\r\n"];
    for (const text of samples) expect([text.length, sha256Hex(text)]).toEqual([text.length, createHash("sha256").update(text, "utf8").digest("hex")]);
  });

  it("is made of the canonical JSON: keys in order, no whitespace, undefined left out", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: "x" }], u: undefined })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
    expect(canonicalJson([undefined, 1])).toBe("[null,1]");
    expect(canonicalJson("é\n")).toBe('"é\\n"');
  });

  it("is the same for the same page whatever order its keys are in, and different when anything of it differs", () => {
    const rows = [{ id: "r", type: "row", columns: [{ id: "c", blocks: [] }] }];
    const a = snapshotHash({ title: "Vilkår", rows });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotHash({ rows, title: "Vilkår" })).toBe(a);
    expect(snapshotHash({ title: "Vilkår", rows: [{ columns: [{ blocks: [], id: "c" }], type: "row", id: "r" }] })).toBe(a);
    expect(snapshotHash({ title: "Vilkår ", rows })).not.toBe(a);
    expect(snapshotHash({ title: "Vilkår", rows: [] })).not.toBe(a);
    // Only the title and the rows count: the same text under another address is the same snapshot.
    expect(snapshotHash({ title: "Vilkår", rows, slug: "x", other: 1 } as never)).toBe(a);
  });
});
