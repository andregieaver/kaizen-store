import { describe, expect, it } from "vitest";

import { CONTENT_MAX_MAX, CONTENT_MAX_MIN } from "./page-content";
import { MIN_SHARE, dragWidth, moveEdge, sharesOf } from "./resize";

/** Resizing on the canvas (D182): the shares of a row's columns and a row's content width. */

describe("shares", () => {
  it("are whole numbers of 100 for the widths measured", () => {
    expect(sharesOf([100, 100])).toEqual([50, 50]);
    expect(sharesOf([1, 2])).toEqual([33, 67]);
    expect(sharesOf([100, 100, 100])).toEqual([34, 33, 33]);
    expect(sharesOf([300])).toEqual([100]);
    expect(sharesOf([])).toEqual([]);
  });

  it("always add up to 100, and no column is below the least", () => {
    for (const widths of [[1, 1, 1, 1, 1, 1], [97, 3], [1, 1000, 1], [0, 0, 0], [5, 0, 5], [333, 333, 334]]) {
      const shares = sharesOf(widths);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
      for (const share of shares) expect(share).toBeGreaterThanOrEqual(MIN_SHARE);
    }
    expect(sharesOf([0, 0, 0])).toEqual([34, 33, 33]);
  });
});

describe("moving the edge between two columns", () => {
  it("shares the pair's width differently and leaves every other column alone", () => {
    expect(moveEdge([50, 50], 0, 10)).toEqual([60, 40]);
    expect(moveEdge([25, 25, 50], 1, -5)).toEqual([25, 20, 55]);
    expect(moveEdge([20, 30, 50], 0, 4.4)).toEqual([24, 26, 50]);
  });

  it("keeps each of the two at least the least share, and never goes past the pair", () => {
    expect(moveEdge([50, 50], 0, 1000)).toEqual([95, 5]);
    expect(moveEdge([50, 50], 0, -1000)).toEqual([5, 95]);
    expect(moveEdge([10, 5, 85], 0, 20)).toEqual([10, 5, 85]);
  });

  it("does nothing for an edge that is not there", () => {
    expect(moveEdge([50, 50], 1, 5)).toEqual([50, 50]);
    expect(moveEdge([50, 50], -1, 5)).toEqual([50, 50]);
    expect(moveEdge([100], 0, 5)).toEqual([100]);
  });
});

describe("a row's content width", () => {
  it("snaps to steps of eight pixels, unless free", () => {
    expect(dragWidth(1003)).toBe(1000);
    expect(dragWidth(1005)).toBe(1008);
    expect(dragWidth(1003, { free: true })).toBe(1003);
  });

  it("is kept between what a row can hold, and within the room", () => {
    expect(dragWidth(10)).toBe(CONTENT_MAX_MIN);
    expect(dragWidth(99999)).toBe(CONTENT_MAX_MAX);
    expect(dragWidth(2000, { room: 1200 })).toBe(1200);
    expect(dragWidth(100, { room: 100 })).toBe(CONTENT_MAX_MIN);
  });
});
