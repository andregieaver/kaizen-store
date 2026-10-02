/**
 * The arithmetic behind the analytics charts (D152): axis ticks, scales, paths and colour steps. Pure and free of React, so every
 * edge (nothing, one point, all zero, negative, a gap) is tested here and the components only draw what these return.
 */

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** A number without the floating-point dust (0.1 + 0.2 → 0.3). */
const clean = (n: number) => Number(n.toPrecision(12));

export type Ticks = { ticks: number[]; min: number; max: number; step: number };

/**
 * Round numbers for an axis that cover `[min, max]`: steps of 1, 2 or 5 times a power of ten, at most about `target` of them.
 * Zero is included by default (bars and money lines read from zero). With `integer` the step is never under 1, so a count
 * never gets a tick at 0.5. Nothing to draw (equal ends, all zero, non-numbers) still gives a usable axis, 0 to 1.
 */
export function niceTicks(minimum: number, maximum: number, opts: { target?: number; integer?: boolean; includeZero?: boolean } = {}): Ticks {
  const target = Math.max(2, Math.floor(opts.target ?? 5));
  let lo = finite(minimum) ? minimum : 0;
  let hi = finite(maximum) ? maximum : 0;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (opts.includeZero ?? true) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    if (lo === 0) hi = 1;
    else {
      const pad = Math.abs(lo) * 0.1;
      lo -= pad;
      hi += pad;
    }
  }
  const raw = (hi - lo) / (target - 1);
  const exponent = Math.floor(Math.log10(raw));
  const fraction = raw / 10 ** exponent;
  // To the nearest of 1, 2, 5 and 10 (not always upward), so an axis keeps about the number of ticks asked for.
  const nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  let step = nice * 10 ** exponent;
  if (opts.integer) step = Math.max(1, Math.round(step));
  const first = clean(Math.floor(lo / step) * step);
  const last = clean(Math.ceil(hi / step) * step);
  const ticks: number[] = [];
  // An index, not a running sum, so the ticks do not drift; the cap keeps a wrong input from looping.
  for (let i = 0; i <= 200; i += 1) {
    const tick = clean(first + i * step);
    ticks.push(tick);
    if (tick >= last) break;
  }
  return { ticks, min: first, max: ticks[ticks.length - 1], step };
}

/** A straight mapping from a domain to a range; an empty domain maps everything to the middle of the range. */
export function linearScale(domain: readonly [number, number], range: readonly [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d0 === d1) return () => (r0 + r1) / 2;
  const k = (r1 - r0) / (d1 - d0);
  return (value) => r0 + (value - d0) * k;
}

export type Point = { x: number; y: number };

const num = (n: number) => String(Math.round(n * 10) / 10);

/** A line through the points, lifting the pen at a gap (null), so a missing day is a break and never a dive to zero. */
export function linePath(points: readonly (Point | null)[]): string {
  let out = "";
  let pen = false;
  for (const p of points) {
    if (!p || !finite(p.x) || !finite(p.y)) {
      pen = false;
      continue;
    }
    out += `${pen ? "L" : out ? " M" : "M"}${num(p.x)} ${num(p.y)}`;
    pen = true;
  }
  return out;
}

/** The area between a line and a baseline, one closed shape for each unbroken run of points. */
export function areaPath(points: readonly (Point | null)[], baselineY: number): string {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    if (p && finite(p.x) && finite(p.y)) run.push(p);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs
    .filter((r) => r.length > 1)
    .map((r) => `M${num(r[0].x)} ${num(baselineY)} ${r.map((p) => `L${num(p.x)} ${num(p.y)}`).join(" ")} L${num(r[r.length - 1].x)} ${num(baselineY)} Z`)
    .join(" ");
}

/**
 * A column from the baseline to its end, with the end rounded and the baseline square (the end can be above the baseline or
 * under it). The radius never exceeds half the width or the height; nothing to draw (a zero-height column) gives "".
 */
export function barPath(x: number, baseline: number, end: number, width: number, radius = 4): string {
  const height = Math.abs(end - baseline);
  if (!finite(x) || !finite(baseline) || !finite(end) || !(width > 0) || !(height > 0)) return "";
  const r = Math.max(0, Math.min(radius, width / 2, height));
  const right = x + width;
  if (end < baseline) {
    return `M${num(x)} ${num(baseline)}V${num(end + r)}${r ? `Q${num(x)} ${num(end)} ${num(x + r)} ${num(end)}H${num(right - r)}Q${num(right)} ${num(end)} ${num(right)} ${num(end + r)}` : `H${num(right)}`}V${num(baseline)}Z`;
  }
  return `M${num(x)} ${num(baseline)}V${num(end - r)}${r ? `Q${num(x)} ${num(end)} ${num(x + r)} ${num(end)}H${num(right - r)}Q${num(right)} ${num(end)} ${num(right)} ${num(end - r)}` : `H${num(right)}`}V${num(baseline)}Z`;
}

/** Which of `count` labels to print so that no more than `max` show, spread evenly and always including the first and last. */
export function sparseIndices(count: number, max: number): number[] {
  const n = Math.max(0, Math.floor(count));
  const m = Math.max(1, Math.floor(max));
  if (n === 0) return [];
  if (n <= m) return Array.from({ length: n }, (_, i) => i);
  if (m === 1) return [0];
  const out = new Set<number>();
  for (let i = 0; i < m; i += 1) out.add(Math.round((i * (n - 1)) / (m - 1)));
  return [...out].sort((a, b) => a - b);
}

/** A label cut to `max` characters with an ellipsis; never longer than `max`, whole words are not respected on purpose. */
export function truncateLabel(text: string, max: number): string {
  const limit = Math.max(1, Math.floor(max));
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  if (limit === 1) return "…";
  return `${chars.slice(0, Math.max(1, limit - 1)).join("").trimEnd()}…`;
}

/** The number of steps of the sequential ramp (`--chart-seq-0` to `--chart-seq-6`): 0 is "nothing", 6 the most. */
export const RAMP_STEPS = 7;

/**
 * The step of the ramp for a value out of `max`: 0 for nothing (zero, negative, missing, or nothing to compare with), and 1 to
 * 6 in proportion above it, so any real value is told apart from none.
 */
export function rampStep(value: number | null | undefined, max: number | null | undefined): number {
  if (!finite(value) || !finite(max) || value <= 0 || max <= 0) return 0;
  const ratio = Math.min(1, value / max);
  return 1 + Math.min(RAMP_STEPS - 2, Math.floor(ratio * (RAMP_STEPS - 1)));
}

/** The largest positive finite number in a list, or 0. */
export function maxOf(values: readonly (number | null | undefined)[]): number {
  let max = 0;
  for (const v of values) if (finite(v) && v > max) max = v;
  return max;
}

export type FunnelStep = {
  /** Width of the bar, 0 to 100, as a share of the widest stage (the first with a figure). Null: the stage is unknown. */
  widthPct: number | null;
  /** Share of the stage before it that came this far (can pass 1 when the counts come from different places); null when either is unknown or the earlier one is zero. */
  conversion: number | null;
  /** Share of the first stage that came this far. */
  overall: number | null;
};

/** What a funnel draws for stages' counts: bar widths and the conversion from stage to stage. Unknown stages (null) are never zero. */
export function funnelSteps(values: readonly (number | null)[]): FunnelStep[] {
  const known = values.filter(finite);
  const top = Math.max(0, ...known);
  const first = values.find(finite) ?? null;
  return values.map((value, i) => {
    if (!finite(value)) return { widthPct: null, conversion: null, overall: null };
    const previous = i > 0 ? values[i - 1] : null;
    return {
      widthPct: top > 0 ? Math.min(100, Math.max(0, (value / top) * 100)) : 0,
      conversion: finite(previous) && previous > 0 ? value / previous : null,
      overall: first !== null && first > 0 ? value / first : null,
    };
  });
}

export type Pace = "ahead" | "on" | "behind" | "unknown";

/**
 * Whether progress toward a target is ahead of, on or behind the share expected by today. Within `tolerance` of the target
 * (default 2 percentage points) counts as on pace, so a day's noise is neither praised nor blamed.
 */
export function paceOf(value: number | null | undefined, expected: number | null | undefined, target: number | null | undefined, tolerance = 0.02): Pace {
  if (!finite(value) || !finite(expected) || !finite(target) || target <= 0) return "unknown";
  const gap = (value - expected) / target;
  if (Math.abs(gap) <= tolerance) return "on";
  return gap > 0 ? "ahead" : "behind";
}

/** A value's share of a total as a width in percent, kept between 0 and 100; 0 when the total is not a positive number. */
export function sharePct(value: number | null | undefined, total: number | null | undefined): number {
  if (!finite(value) || !finite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

/** Where a column's sort goes next: the same column flips, another starts in its natural direction. */
export function nextSort(current: { key: string; dir: "asc" | "desc" } | null | undefined, key: string, firstDir: "asc" | "desc" = "desc"): "asc" | "desc" {
  if (current && current.key === key) return current.dir === "asc" ? "desc" : "asc";
  return firstDir;
}
