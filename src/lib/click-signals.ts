/**
 * Dead clicks and rage clicks (D656, `docs/heatmaps-and-recordings.md` sections 3 and 7.5). A judge with its clock passed in, which knows
 * nothing of the DOM: the storefront's click watch tells it each click and each sign of life (a counted mutation, a scroll, a selection, focus
 * moving, the page left, the address changing) and collects its verdicts. Every click gets exactly one verdict; only a candidate can be dead.
 *
 * Numbers: a mutation within 2500 ms makes a click alive (PostHog's threshold), a scroll within 300 ms, a selection within 100 ms either side,
 * focus or leaving within 1000 ms; three clicks each within 1000 ms of the last and 30 px of the first (or on the same element) are a rage run.
 */

export const DEAD_AFTER_MS = 2500;
export const SCROLL_ALIVE_MS = 300;
export const SELECTION_ALIVE_MS = 100;
export const FOCUS_ALIVE_MS = 1000;
export const LEAVE_ALIVE_MS = 1000;
export const REPEAT_MS = 1000;
/** A pointerdown counts as the click's start when it came at most this long before it. */
export const DOWN_MS = 1000;
export const RAGE_COUNT = 3;
export const RAGE_GAP_MS = 1000;
export const RAGE_RADIUS_PX = 30;

export type ClickInput = {
  at: number;
  /** When the pointer went down for this click, if it did. */
  downAt: number | null;
  x: number;
  y: number;
  /** A number standing for the clicked element. */
  targetId: number;
  candidate: boolean;
  rageable: boolean;
  anchor: string;
  cx: number;
  cy: number;
};

export type Verdict = { anchor: string; cx: number; cy: number; dead: boolean; rage: boolean; rageAndDead: boolean; at: number };

type Signal = "mutation" | "scroll" | "selection" | "focus" | "leave" | "url";

type Click = ClickInput & { start: number; alive: boolean; run: Run | null; released: boolean };
type Run = { clicks: Click[]; closed: boolean };

/** Whether a sign of life at `t` makes this click alive. */
function wakes(c: Click, signal: Signal, t: number): boolean {
  switch (signal) {
    case "mutation":
      return t >= c.start && t <= c.at + DEAD_AFTER_MS;
    case "scroll":
      return t >= c.at && t <= c.at + SCROLL_ALIVE_MS;
    case "selection":
      return Math.abs(t - c.at) <= SELECTION_ALIVE_MS;
    case "focus":
      return t >= c.start && t <= c.at + FOCUS_ALIVE_MS;
    case "leave":
      return Math.abs(t - c.at) <= LEAVE_ALIVE_MS;
    case "url":
      return t >= c.at && t <= c.at + DEAD_AFTER_MS;
  }
}

export class ClickJudge {
  private clicks: Click[] = [];
  private recent: { signal: Signal; at: number }[] = [];
  private run: Run | null = null;
  private last: { targetId: number; at: number } | null = null;

  click(input: ClickInput): void {
    const repeat = this.last !== null && this.last.targetId === input.targetId && input.at - this.last.at <= REPEAT_MS;
    this.last = { targetId: input.targetId, at: input.at };
    const start = input.downAt !== null && input.at - input.downAt >= 0 && input.at - input.downAt <= DOWN_MS ? input.downAt : input.at;
    const c: Click = { ...input, candidate: input.candidate && !repeat, start, alive: false, run: null, released: false };
    c.alive = this.recent.some((s) => wakes(c, s.signal, s.at));
    this.joinRun(c);
    this.clicks.push(c);
  }

  mutation(at: number): void {
    this.signal("mutation", at);
  }
  scroll(at: number): void {
    this.breakRun();
    this.signal("scroll", at);
  }
  selection(at: number): void {
    this.breakRun();
    this.signal("selection", at);
  }
  focus(at: number): void {
    this.signal("focus", at);
  }
  leave(at: number): void {
    this.signal("leave", at);
  }
  urlChange(at: number): void {
    this.signal("url", at);
  }

  /** Clicks still waiting for a verdict. */
  get pending(): number {
    return this.clicks.length;
  }

  /** The verdicts that are due: a click's after `DEAD_AFTER_MS`; a rage run's together, once it is over and every click of it is due. */
  tick(now: number): Verdict[] {
    if (this.run && now - this.run.clicks[this.run.clicks.length - 1].at > RAGE_GAP_MS) this.breakRun();
    this.recent = this.recent.filter((s) => now - s.at <= DEAD_AFTER_MS + DOWN_MS);
    const out: Verdict[] = [];
    for (const c of this.clicks) {
      if (c.released) continue;
      const rageRun = c.run && c.run.clicks.length >= RAGE_COUNT ? c.run : null;
      if (rageRun) {
        if (rageRun.closed && rageRun.clicks.every((k) => now >= k.at + DEAD_AFTER_MS)) out.push(...this.release(rageRun.clicks, true));
      } else if (now >= c.at + DEAD_AFTER_MS && !(c.run && !c.run.closed)) {
        out.push(...this.release([c], true));
      }
    }
    this.clicks = this.clicks.filter((c) => !c.released);
    return out.sort((a, b) => a.at - b.at);
  }

  /** Ends the view: every click still waiting is released, none of them dead. */
  flush(): Verdict[] {
    this.breakRun();
    const out: Verdict[] = [];
    const runs = new Set<Run>();
    for (const c of this.clicks) {
      if (c.released) continue;
      if (c.run && c.run.clicks.length >= RAGE_COUNT) {
        if (!runs.has(c.run)) {
          runs.add(c.run);
          out.push(...this.release(c.run.clicks, false));
        }
      } else out.push(...this.release([c], false));
    }
    this.clicks = [];
    this.recent = [];
    return out.sort((a, b) => a.at - b.at);
  }

  private signal(signal: Signal, at: number): void {
    this.recent.push({ signal, at });
    for (const c of this.clicks) if (!c.alive && wakes(c, signal, at)) c.alive = true;
  }

  private joinRun(c: Click): void {
    const run = this.run;
    if (!c.rageable) {
      this.breakRun();
      return;
    }
    if (run && !run.closed) {
      const first = run.clicks[0];
      const previous = run.clicks[run.clicks.length - 1];
      const near = Math.hypot(c.x - first.x, c.y - first.y) <= RAGE_RADIUS_PX || c.targetId === first.targetId;
      if (c.at - previous.at <= RAGE_GAP_MS && near) {
        run.clicks.push(c);
        c.run = run;
        return;
      }
      this.breakRun();
    }
    this.run = { clicks: [c], closed: false };
    c.run = this.run;
  }

  private breakRun(): void {
    if (this.run) this.run.closed = true;
    this.run = null;
  }

  /** Verdicts for clicks; in a rage run, the click that made it three carries the rage, with the run's first click's anchor and cell. */
  private release(clicks: Click[], judged: boolean): Verdict[] {
    const deadOf = (c: Click) => judged && c.candidate && !c.alive;
    const anyDead = clicks.some(deadOf);
    const rageRun = clicks.length >= RAGE_COUNT && clicks[0].run !== null && clicks[0].run === clicks[clicks.length - 1].run;
    return clicks.map((c, i) => {
      c.released = true;
      const rage = rageRun && i === RAGE_COUNT - 1;
      const where = rage ? clicks[0] : c;
      return { anchor: where.anchor, cx: where.cx, cy: where.cy, dead: deadOf(c), rage, rageAndDead: rage && anyDead, at: c.at };
    });
  }
}
