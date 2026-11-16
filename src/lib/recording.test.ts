import { describe, expect, it } from "vitest";

import { appendPages, coarseSize, coarseTime, pathsOf, RECORDING_KEEP_DAYS, REC_MAX_PAGES, segmentPath, sealedPath, seqName } from "./recording";
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
