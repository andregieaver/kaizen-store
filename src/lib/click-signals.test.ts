import { describe, expect, it } from "vitest";

import { ClickJudge, type ClickInput } from "./click-signals";

let id = 0;
const click = (at: number, over: Partial<ClickInput> = {}): ClickInput => ({
  at,
  downAt: null,
  x: 100,
  y: 100,
  targetId: ++id,
  candidate: true,
  rageable: true,
  anchor: `part-${id}`,
  cx: 1,
  cy: 2,
  ...over,
});

describe("dead clicks (D656)", () => {
  it("is alive with a mutation within 2.5 s, dead without", () => {
    const judge = new ClickJudge();
    judge.click(click(0));
    judge.mutation(2000);
    expect(judge.tick(2600)).toMatchObject([{ dead: false }]);
    const other = new ClickJudge();
    other.click(click(0));
    other.mutation(2600);
    expect(other.tick(2600)).toMatchObject([{ dead: true }]);
  });

  it("counts a scroll only within 300 ms, a selection within 100 ms, focus and leaving within 1 s", () => {
    const at = (signal: (j: ClickJudge) => void) => {
      const judge = new ClickJudge();
      judge.click(click(0));
      signal(judge);
      return judge.tick(3000)[0].dead;
    };
    expect(at((j) => j.scroll(250))).toBe(false);
    expect(at((j) => j.scroll(400))).toBe(true);
    expect(at((j) => j.selection(90))).toBe(false);
    expect(at((j) => j.selection(150))).toBe(true);
    expect(at((j) => j.focus(900))).toBe(false);
    expect(at((j) => j.leave(800))).toBe(false);
    expect(at((j) => j.urlChange(2000))).toBe(false);
  });

  it("takes a change between the pointer going down and the click as alive (a dropdown that closes on pointerdown)", () => {
    const judge = new ClickJudge();
    judge.mutation(50);
    judge.click(click(120, { downAt: 40 }));
    expect(judge.tick(3000)).toMatchObject([{ dead: false }]);
  });

  it("never calls a click dead that was not a candidate, or that was still waiting when the view ended", () => {
    const judge = new ClickJudge();
    judge.click(click(0, { candidate: false }));
    expect(judge.tick(3000)).toMatchObject([{ dead: false }]);
    judge.click(click(5000));
    expect(judge.flush()).toMatchObject([{ dead: false }]);
    expect(judge.pending).toBe(0);
  });

  it("does not take the same element again within a second as a new candidate", () => {
    const judge = new ClickJudge();
    judge.click(click(0, { targetId: 7, rageable: false }));
    judge.click(click(500, { targetId: 7, rageable: false }));
    expect(judge.tick(4000).map((v) => v.dead)).toEqual([true, false]);
  });
});

describe("rage clicks (D656)", () => {
  it("gives one rage, on the third click, with the first click's place", () => {
    const judge = new ClickJudge();
    judge.click(click(0, { anchor: "first", x: 100 }));
    judge.click(click(900, { anchor: "second", x: 110 }));
    judge.click(click(1800, { anchor: "third", x: 95 }));
    const verdicts = judge.tick(5000);
    expect(verdicts).toHaveLength(3);
    expect(verdicts.map((v) => v.rage)).toEqual([false, false, true]);
    expect(verdicts[2].anchor).toBe("first");
  });

  it("needs each click within a second of the last, and near the first or on the same element", () => {
    const slow = new ClickJudge();
    for (const at of [0, 1100, 2200]) slow.click(click(at));
    expect(slow.tick(6000).some((v) => v.rage)).toBe(false);
    const far = new ClickJudge();
    far.click(click(0, { x: 0 }));
    far.click(click(300, { x: 200 }));
    far.click(click(600, { x: 400 }));
    expect(far.tick(6000).some((v) => v.rage)).toBe(false);
    const same = new ClickJudge();
    for (const [at, x] of [[0, 0], [300, 200], [600, 400]]) same.click(click(at, { x, targetId: 99 }));
    expect(same.tick(6000).filter((v) => v.rage)).toHaveLength(1);
  });

  it("is broken by a scroll, and never made by text fields; a label can rage but never be dead", () => {
    const scrolled = new ClickJudge();
    scrolled.click(click(0));
    scrolled.click(click(300));
    scrolled.scroll(400);
    scrolled.click(click(600));
    expect(scrolled.tick(6000).some((v) => v.rage)).toBe(false);
    const field = new ClickJudge();
    for (const at of [0, 200, 400]) field.click(click(at, { rageable: false }));
    expect(field.tick(6000).some((v) => v.rage)).toBe(false);
    const label = new ClickJudge();
    for (const at of [0, 200, 400]) label.click(click(at, { candidate: false }));
    expect(label.tick(6000)).toMatchObject([{ dead: false }, { dead: false }, { dead: false, rage: true, rageAndDead: false }]);
  });

  it("is rage and dead when any click of the run was dead", () => {
    const judge = new ClickJudge();
    for (const at of [0, 200, 400]) judge.click(click(at));
    expect(judge.tick(6000)[2]).toMatchObject({ rage: true, rageAndDead: true });
  });

  it("gives every click exactly one verdict", () => {
    const judge = new ClickJudge();
    for (const at of [0, 200, 400, 600, 5000]) judge.click(click(at));
    const verdicts = [...judge.tick(4000), ...judge.tick(9000)];
    expect(verdicts.map((v) => v.at)).toEqual([0, 200, 400, 600, 5000]);
  });
});
