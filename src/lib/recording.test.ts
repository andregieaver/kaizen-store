import { describe, expect, it } from "vitest";

import {
  addId,
  appendPages,
  coarseSize,
  coarseTime,
  idsOf,
  pathsOf,
  readSession,
  RECORDING_KEEP_DAYS,
  recorderOptions,
  REC_IDLE_MS,
  REC_MAX_IDS,
  REC_MAX_MS,
  REC_MAX_PAGES,
  segmentPath,
  sealedPath,
  seqName,
  sessionFor,
  type RecSession,
} from "./recording";
import { RETENTION_SEED } from "./retention";

/** Recordings of visits (D656): where their files are, what the row says exists, and the coarse facts kept about them. */

const STORE = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

describe("a recording's files", () => {
  it("names a segment by three digits and a sealed recording by one file", () => {
    expect(seqName(0)).toBe("000");
    expect(seqName(199)).toBe("199");
    expect(segmentPath(STORE, ID, 7)).toBe(`${STORE}/${ID}/007.gz`);
    expect(sealedPath(STORE, ID)).toBe(`${STORE}/${ID}/all.gz`);
  });

  it("lists exactly the files the row says exist, a gap included, or the sealed one alone", () => {
    expect(pathsOf({ storeId: STORE, id: ID, sealed: false, seqs: [3, 0, 1] })).toEqual([0, 1, 3].map((s) => segmentPath(STORE, ID, s)));
    expect(pathsOf({ storeId: STORE, id: ID, sealed: true, seqs: [0, 1] })).toEqual([sealedPath(STORE, ID)]);
    expect(pathsOf({ storeId: STORE, id: ID, sealed: false, seqs: [] })).toEqual([]);
  });
});

describe("the facts kept about it", () => {
  it("floors times to ten minutes and rounds sizes to ten pixels", () => {
    expect(coarseTime(new Date("2026-11-16T10:19:59.999Z")).toISOString()).toBe("2026-11-16T10:10:00.000Z");
    expect(coarseSize(393)).toBe(390);
    expect(coarseSize(395)).toBe(400);
    expect(coarseSize(-5)).toBe(0);
    expect(coarseSize(50_000)).toBe(9990);
  });

  it("appends pages without repeating the last, and keeps the first fifty", () => {
    expect(appendPages(["/no"], ["/no", "/no/p/mug", "/no/p/mug", "/no"])).toEqual(["/no", "/no/p/mug", "/no"]);
    const many = Array.from({ length: 80 }, (_, i) => `/no/p/${i}`);
    const kept = appendPages(["/no"], many);
    expect(kept).toHaveLength(REC_MAX_PAGES);
    expect(kept[0]).toBe("/no");
  });

  it("is kept as long as the retention rule says", () => {
    const rule = RETENTION_SEED.find((r) => r.kind === "recordings" && r.country === null);
    expect(rule).toMatchObject({ periodValue: RECORDING_KEEP_DAYS, periodUnit: "days" });
  });
});

describe("the tab's session (step 9)", () => {
  const T = 1_800_000_000_000;
  const stored: RecSession = { v: 1, id: ID, seq: 3, sampled: true, started: T, lastInput: T + 1000, pages: 2, qualified: true };

  it("keeps a session while it lasts, and starts a new one after 30 idle minutes or an hour", () => {
    const fresh = () => "44444444-4444-4444-8444-444444444444";
    expect(sessionFor(stored, T + 60_000, 50, fresh, 0.9)).toBe(stored);
    expect(sessionFor(stored, T + 1000 + REC_IDLE_MS, 50, fresh, 0.9).id).toBe(fresh());
    expect(sessionFor(stored, T + REC_MAX_MS, 50, fresh, 0.9).seq).toBe(0);
  });

  it("samples a new session once, by the store's share", () => {
    const id = () => "44444444-4444-4444-8444-444444444444";
    expect(sessionFor(null, T, 25, id, 0.24).sampled).toBe(true);
    expect(sessionFor(null, T, 25, id, 0.25).sampled).toBe(false);
    expect(sessionFor(null, T, 100, id, 0.999).sampled).toBe(true);
  });

  it("reads back only a session it wrote", () => {
    expect(readSession(JSON.stringify(stored))).toEqual(stored);
    expect(readSession("{}")).toBeNull();
    expect(readSession("not json")).toBeNull();
    expect(readSession(JSON.stringify({ ...stored, id: "x" }))).toBeNull();
  });
});

describe("the ids kept for deleting", () => {
  it("adds one for 31 days, drops expired ones and keeps at most 50", () => {
    const T = 1_800_000_000_000;
    const old = JSON.stringify([{ id: "55555555-5555-4555-8555-555555555555", until: T - 1 }]);
    expect(addId(old, ID, T, T)).toEqual([{ id: ID, until: T + 31 * 86_400_000 }]);
    let text: string | null = null;
    for (let i = 0; i < 60; i++) text = JSON.stringify(addId(text, `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`, T, T));
    expect(JSON.parse(text!)).toHaveLength(REC_MAX_IDS);
    expect(idsOf(text)).toHaveLength(REC_MAX_IDS);
    expect(idsOf("[{}, 3]")).toEqual([]);
    expect(idsOf("broken")).toEqual([]);
  });
});

describe("rrweb's options", () => {
  it("masks every field to nothing, masked text to three dots whatever its length, and blocks private parts", () => {
    const balanced = recorderOptions("balanced", false);
    expect(balanced).toMatchObject({ maskAllInputs: true, maskTextSelector: "[data-kz-mask]", blockSelector: "[data-kz-private]", recordCanvas: false, inlineImages: false });
    expect(balanced.maskInputFn()).toBe("");
    expect(balanced.maskTextFn("a long review written by a person")).toBe("•••");
    expect(balanced.maskTextFn("   ")).toBe("   ");
    expect(recorderOptions("strict", true)).toMatchObject({ maskTextSelector: "*", sampling: { mousemove: 150 } });
  });
});
