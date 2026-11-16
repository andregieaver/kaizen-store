import { describe, expect, it } from "vitest";

import { attentionBands, attentionDelta, attentionTick, newAttention, NO_REACH, reachBucket, reachStep } from "./heat-collect";
import { BAND_CAP_MS, TICK_MS } from "./page-heat";

const tick = (s: ReturnType<typeof newAttention>, scrollY: number, innerHeight = 800, active = true, visible = true) =>
  attentionTick(s, { scrollY, innerHeight, active, visible });

describe("scroll reach (D656)", () => {
  it("keeps the deepest point and the tallest page, and the fold at the first look", () => {
    let s = reachStep(NO_REACH, { scrollY: 0, innerHeight: 800, scrollHeight: 4000 });
    expect(s.fold).toBe(200);
    s = reachStep(s, { scrollY: 1200, innerHeight: 800, scrollHeight: 4000 });
    s = reachStep(s, { scrollY: 0, innerHeight: 800, scrollHeight: 4000 });
    expect(reachBucket(s, 800)).toBe(10);
    // The page grew from lazy content: the share is of the tallest it was.
    s = reachStep(s, { scrollY: 0, innerHeight: 800, scrollHeight: 8000 });
    expect(reachBucket(s, 800)).toBe(5);
    expect(s.fold).toBe(200);
  });

  it("counts a page no taller than the window as wholly seen", () => {
    expect(reachBucket(reachStep(NO_REACH, { scrollY: 0, innerHeight: 900, scrollHeight: 700 }), 900)).toBe(20);
  });
});

describe("attention (D656)", () => {
  it("counts only bins on screen in two ticks running, while visible and active", () => {
    let s = tick(newAttention(), 0);
    expect(s.bins[0]).toBe(0);
    s = tick(s, 0);
    expect(s.bins[0]).toBe(TICK_MS);
    expect(s.bins[15]).toBe(TICK_MS);
    expect(s.bins[16]).toBe(0);
    // Idle or hidden: nothing, and the next tick starts again.
    s = tick(s, 0, 800, false);
    s = tick(s, 0);
    expect(s.bins[0]).toBe(TICK_MS);
    s = tick(s, 0, 800, true, false);
    expect(s.bins[0]).toBe(TICK_MS);
  });

  it("gives a band the time a strip of it was on screen, whatever the page's height", () => {
    let s = newAttention();
    for (let i = 0; i < 3; i++) s = tick(s, 0, 250);
    // 5,000 px: each band is 250 px, five bins; the first band's bins were all on screen for two counted ticks.
    const { bands, attH } = attentionBands(s, 5000);
    expect(attH).toBe(5000);
    expect(bands[0]).toBe(2 * TICK_MS);
    expect(bands[1]).toBe(0);
  });

  it("covers at most 20,000 px, gives a short page a value in every band, and caps a band", () => {
    expect(attentionBands(newAttention(), 30000).attH).toBe(20000);
    let s = newAttention();
    for (let i = 0; i < 3; i++) s = tick(s, 0, 600);
    expect(attentionBands(s, 600).bands.every((ms) => ms === 2 * TICK_MS)).toBe(true);
    const full = { ...newAttention(), bins: new Array(400).fill(10 * BAND_CAP_MS) };
    expect(Math.max(...attentionBands(full, 5000).bands)).toBe(BAND_CAP_MS);
  });

  it("fixes the height at the first summary, so a continuation never goes below zero", () => {
    let s = newAttention();
    for (let i = 0; i < 5; i++) s = tick(s, 0, 2000);
    const first = attentionDelta(s, 2000);
    expect(first.attH).toBe(2000);
    s = first.next;
    // The page doubles after the first summary.
    for (let i = 0; i < 3; i++) s = tick(s, 2000, 2000);
    const second = attentionDelta(s, 4000);
    expect(second.attH).toBe(2000);
    expect(second.delta.every((ms) => ms >= 0)).toBe(true);
  });
});
