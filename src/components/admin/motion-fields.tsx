"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

import { SPEED_MS, partFx, type FxProps } from "@/lib/motion-attrs";
import { initMotion } from "@/lib/motion-runtime";
import {
  DELAY_MAX,
  DURATION_MAX,
  DURATION_MIN,
  MOTION_DISTANCES,
  MOTION_EASES,
  MOTION_INTENSITIES,
  MOTION_SPEEDS,
  MOTION_STARTS,
  STAGGER_MAX,
  type EnterEffect,
  type MotionTarget,
  type PartMotion,
} from "@/lib/motion";
import {
  ENTER_DEFAULTS,
  INTENSITY_DEFAULT,
  STAGGER_STEP,
  drawTarget,
  enterFitsPart,
  enterOffered,
  hoverFitsPart,
  hoverOffered,
  onlyScroll,
  patchEnter,
  scrollFitsPart,
  scrollOffered,
  setEnterEffect,
  setHoverEffect,
  setHoverIntensity,
  setScrollEffect,
  setScrollIntensity,
  staggerKind,
  withoutScroll,
  type MotionPart,
  type StaggerKind,
} from "@/lib/motion-edit";
import { Check, Choices } from "./block-fields";

/**
 * A part's Motion tab (D128): the effects an owner can give a row, column or component, chosen from lists built from
 * the catalogues in `src/lib/motion.ts`, with a preview that plays them. What is stored is only names and small named
 * amounts (`motion-edit.ts` keeps it lean); the drawing is `motion-attrs.ts` and the small runtime.
 */

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

const QUERY = "(prefers-reduced-motion: reduce)";
function subscribe(callback: () => void) {
  if (typeof matchMedia !== "function") return () => {};
  const query = matchMedia(QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const snapshot = () => typeof matchMedia === "function" && matchMedia(QUERY).matches;

/** Whether this device asks for less motion; where it does, nothing is played in the builder either. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

export const REDUCED_NOTE = "Motion is reduced on this device, so effects are not played here.";

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export function MotionFields({
  part,
  motion,
  onChange,
}: {
  part: MotionPart;
  motion: PartMotion | undefined;
  /** The part's new motion; undefined when nothing is left, which takes the `motion` key away. */
  onChange: (motion: PartMotion | undefined) => void;
}) {
  const enter = motion?.enter;
  const stagger = staggerKind(part, enter?.effect);
  const trigger = enter?.trigger ?? ENTER_DEFAULTS.trigger;
  const hover = motion?.hover;
  const scroll = motion?.scroll;
  return (
    <div className="flex flex-col gap-6">
      <MotionPreview part={part} motion={motion} />
      <p className="text-sm text-muted">
        Visitors who ask their device for less motion see none of these effects. Keep the first section of a page quiet:
        it is what people see before anything has moved.
      </p>

      <Section title="Entrance" hint="How it arrives, when it comes into view or when the page opens.">
        <EffectPicker
          legend="Entrance effect"
          kind="enter"
          target={drawTarget(part)}
          groups={enterOffered(part)}
          value={enter?.effect ?? null}
          fits={enter ? enterFitsPart(enter.effect, part) : true}
          onChange={(effect) => onChange(setEnterEffect(motion, effect, part))}
        />
        {enter && (
          <div className="flex flex-col gap-4 rounded-md border border-border p-4">
            <Choices
              legend="Plays"
              options={[
                { value: "view", label: "When it comes into view" },
                { value: "load", label: "When the page opens" },
              ]}
              value={trigger}
              onChange={(next) => onChange(patchEnter(motion, { trigger: next }, part))}
            />
            {trigger === "view" && (
              <Setting
                label="Starts"
                value={enter.start ?? ENTER_DEFAULTS.start}
                options={MOTION_STARTS}
                onChange={(start) => onChange(patchEnter(motion, { start }, part))}
              />
            )}
            <div className="flex flex-wrap gap-4">
              <Setting
                label="Speed"
                value={enter.speed ?? ENTER_DEFAULTS.speed}
                options={MOTION_SPEEDS}
                onChange={(speed) => onChange(patchEnter(motion, { speed }, part))}
              />
              <Setting
                label="Distance"
                value={enter.distance ?? ENTER_DEFAULTS.distance}
                options={MOTION_DISTANCES}
                onChange={(distance) => onChange(patchEnter(motion, { distance }, part))}
              />
              <Setting
                label="Easing"
                value={enter.ease ?? ENTER_DEFAULTS.ease}
                options={MOTION_EASES}
                onChange={(ease) => onChange(patchEnter(motion, { ease }, part))}
              />
            </div>
            <p className="text-xs text-muted">Its delay and duration, in seconds, are under Advanced, Animation.</p>
            {stagger && (
              <MotionRange
                label={STAGGER_LABELS[stagger]}
                max={STAGGER_MAX}
                value={enter.stagger ?? 0}
                shown={(ms) =>
                  ms === 0 ? (stagger === "columns" || stagger === "components" ? "Together" : "Standard") : `${ms} ms`
                }
                onChange={(next) => onChange(patchEnter(motion, { stagger: next }, part))}
              />
            )}
            {trigger === "view" && (
              <Check
                label="Play it again each time it comes into view"
                hint="Off, it plays the first time only."
                checked={enter.once === false}
                onChange={(again) => onChange(patchEnter(motion, { once: again ? false : undefined }, part))}
              />
            )}
          </div>
        )}
      </Section>

      <Section title="Hover" hint="What happens while the pointer is over it. Touch screens have no hover.">
        <EffectPicker
          legend="Hover effect"
          kind="hover"
          target={drawTarget(part)}
          groups={hoverOffered(part)}
          value={hover?.effect ?? null}
          fits={hover ? hoverFitsPart(hover.effect, part) : true}
          onChange={(effect) => onChange(setHoverEffect(motion, effect))}
        />
        {hover && (
          <Setting
            label="Intensity"
            value={hover.intensity ?? INTENSITY_DEFAULT}
            options={MOTION_INTENSITIES}
            onChange={(intensity) => onChange(setHoverIntensity(motion, intensity))}
          />
        )}
      </Section>

      <Section title="While scrolling" hint="Moves, fades or changes as the page is scrolled.">
        <EffectPicker
          legend="Scroll effect"
          kind="scroll"
          target={drawTarget(part)}
          groups={scrollOffered(part)}
          value={scroll?.effect ?? null}
          fits={scroll ? scrollFitsPart(scroll.effect, part) : true}
          onChange={(effect) => onChange(setScrollEffect(motion, effect))}
        />
        {scroll && (
          <Setting
            label="Intensity"
            value={scroll.intensity ?? INTENSITY_DEFAULT}
            options={MOTION_INTENSITIES}
            onChange={(intensity) => onChange(setScrollIntensity(motion, intensity))}
          />
        )}
      </Section>
    </div>
  );
}

/** Seconds as the fields show them: tenths, without a trailing zero. */
const seconds = (ms: number) => String(Math.round(ms / 100) / 10);

/**
 * Beaver's Animation in the Advanced tab (D179 phase 3): the entrance's **Delay** (0 to 10 seconds) and **Duration** (0.1 to
 * 5 seconds, its speed's when empty), in tenths of a second. Stored in milliseconds on the entrance (`delay`, `duration`)
 * and drawn as `--fx-delay` and `--fx-duration`; visitors who ask for less motion still see none, and the content shows
 * whatever the times say if the page's scripts never run.
 */
export function AnimationFields({
  part,
  motion,
  onChange,
}: {
  part: MotionPart;
  motion: PartMotion | undefined;
  onChange: (motion: PartMotion | undefined) => void;
}) {
  const id = useId();
  const enter = motion?.enter;
  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4" data-animation-fields="">
      <legend className="float-left mb-1 w-full font-medium">Animation</legend>
      {enter ? (
        <div className="flex flex-wrap gap-4">
          <SecondsField
            id={`${id}-delay`}
            label="Delay"
            hint="0 to 10 seconds"
            value={enter.delay ?? 0}
            min={0}
            max={DELAY_MAX}
            empty="0"
            onChange={(ms) => onChange(patchEnter(motion, { delay: ms ?? 0 }, part))}
          />
          <SecondsField
            id={`${id}-duration`}
            label="Duration"
            hint={`0.1 to 5 seconds; empty is its speed's (${seconds(SPEED_MS[enter.speed ?? ENTER_DEFAULTS.speed])})`}
            value={enter.duration}
            min={DURATION_MIN}
            max={DURATION_MAX}
            empty={seconds(SPEED_MS[enter.speed ?? ENTER_DEFAULTS.speed])}
            onChange={(ms) => onChange(patchEnter(motion, { duration: ms }, part))}
          />
        </div>
      ) : (
        <p className="text-sm text-muted">Choose an entrance under Motion to set when it starts and how long it takes.</p>
      )}
    </fieldset>
  );
}

function SecondsField({
  id,
  label,
  hint,
  value,
  min,
  max,
  empty,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number | undefined;
  min: number;
  max: number;
  empty: string;
  onChange: (ms: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : seconds(value));
  const typed = Number(shown);
  const invalid = shown.trim() !== "" && (!Number.isFinite(typed) || typed * 1000 < min || typed * 1000 > max);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={0.1}
          min={min / 1000}
          max={max / 1000}
          value={shown}
          placeholder={empty}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (next.trim() === "") return onChange(undefined);
            const ms = Math.round(Number(next) * 10) * 100;
            if (Number.isFinite(ms) && ms >= min && ms <= max) onChange(ms);
          }}
          onBlur={() => setDraft(null)}
          className="min-h-10 w-24 rounded-md border border-border bg-background px-3 text-sm aria-invalid:border-red-700"
        />
        <span className="text-sm text-muted">s</span>
      </span>
      <span id={`${id}-hint`} className="text-xs text-muted">
        {hint}
      </span>
    </div>
  );
}

const STAGGER_LABELS: Record<StaggerKind, string> = {
  columns: "Time between columns",
  components: "Time between components",
  words: "Time between words",
  letters: "Time between letters",
  lines: "Time between lines",
};

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-col gap-0.5">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

/** A short list to choose from, such as speed or intensity. */
export function Setting<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Readonly<Record<T, string>>;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="min-h-10 rounded-md border border-border bg-background px-3 text-sm"
      >
        {(Object.keys(options) as T[]).map((key) => (
          <option key={key} value={key}>
            {options[key]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A slider in steps of 50, with its value written beside it. */
function MotionRange({
  label,
  max,
  value,
  shown,
  onChange,
}: {
  label: string;
  max: number;
  value: number;
  shown: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex min-h-10 items-center gap-3">
        <input
          id={id}
          type="range"
          min={0}
          max={max}
          step={STAGGER_STEP}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-48"
        />
        <output htmlFor={id} className="w-24 text-sm tabular-nums">
          {shown(value)}
        </output>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The effect picker
// ---------------------------------------------------------------------------

type Kind = "enter" | "hover" | "scroll" | "background";
type Groups<Id extends string> = { group: string; effects: { id: Id; label: string; hint: string }[] }[];

/**
 * The effects to choose from, as cards grouped by what they do: a group of radio buttons (arrow keys move between the
 * cards and choose), "None" first. A card of an entrance plays a small demonstration while it is pointed at or holds
 * the focus; the others show a picture of their kind. Nothing plays for people who ask for less motion.
 */
export function EffectPicker<Id extends string>({
  legend,
  kind,
  target,
  groups,
  value,
  fits = true,
  onChange,
}: {
  legend: string;
  kind: Kind;
  target: MotionTarget;
  groups: Groups<Id>;
  value: Id | null;
  /** False when the chosen effect is not one this part can have; it is then said so and can be cleared. */
  fits?: boolean;
  onChange: (effect: Id | null) => void;
}) {
  const legendId = useId();
  const reduced = useReducedMotion();
  const present = groups.some((g) => g.effects.some((e) => e.id === value));
  const listRef = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const radios = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
    const at = radios.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? radios.length - 1
          : (at + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + radios.length) % radios.length;
    radios[next]?.focus();
    radios[next]?.click();
  };
  return (
    <div className="flex flex-col gap-3">
      <p id={legendId} className="text-sm font-medium">
        {legend}
      </p>
      <div ref={listRef} role="radiogroup" aria-labelledby={legendId} onKeyDown={move} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <EffectCard
            id={null}
            label="None"
            hint="No effect."
            group="None"
            kind={kind}
            target={target}
            checked={value === null}
            // If the chosen effect is not in the list, "None" still holds the tab stop.
            tabbable={value === null || !present}
            reduced={reduced}
            onPick={() => onChange(null)}
          />
        </div>
        {groups.map((group) => (
          <div key={group.group} role="group" aria-label={group.group} className="flex flex-col gap-2">
            <p aria-hidden className="text-xs font-medium tracking-wide text-muted uppercase">
              {group.group}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.effects.map((effect) => (
                <EffectCard
                  key={effect.id}
                  id={effect.id}
                  label={effect.label}
                  hint={effect.hint}
                  group={group.group}
                  kind={kind}
                  target={target}
                  checked={value === effect.id}
                  tabbable={value === effect.id}
                  reduced={reduced}
                  onPick={() => onChange(effect.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {!fits && value !== null && (
        <p role="status" className="text-xs text-red-700">
          The chosen effect is not one this part can have. Choose another, or None.
        </p>
      )}
    </div>
  );
}

function EffectCard<Id extends string>({
  id,
  label,
  hint,
  group,
  kind,
  target,
  checked,
  tabbable,
  reduced,
  onPick,
}: {
  id: Id | null;
  label: string;
  hint: string;
  group: string;
  kind: Kind;
  target: MotionTarget;
  checked: boolean;
  tabbable: boolean;
  /** This device asks for less motion: no demonstration plays. */
  reduced: boolean;
  onPick: () => void;
}) {
  const labelId = useId();
  const hintId = useId();
  const [run, setRun] = useState(0);
  const play = () => setRun((n) => n + 1);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={hintId}
      tabIndex={tabbable ? 0 : -1}
      onClick={onPick}
      onPointerEnter={id !== null && kind === "enter" ? play : undefined}
      onFocus={id !== null && kind === "enter" ? play : undefined}
      className="flex min-h-14 items-start gap-3 rounded-md border border-border p-2 text-left text-sm hover:bg-surface focus-visible:outline-2 aria-checked:border-foreground aria-checked:bg-surface"
    >
      <span
        aria-hidden
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded bg-surface"
      >
        {id !== null && kind === "enter" ? (
          <EnterSwatch effect={id as unknown as EnterEffect} target={target} run={reduced ? 0 : run} group={group} />
        ) : (
          <Glyph group={group} />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span id={labelId} className="font-medium">
          {label}
        </span>
        <span id={hintId} className="text-xs text-muted">
          {hint}
        </span>
      </span>
    </button>
  );
}

/** A small square that plays an entrance when its card is pointed at or focused; it is drawn as it is on the page. */
function EnterSwatch({
  effect,
  target,
  run,
  group,
}: {
  effect: EnterEffect;
  target: MotionTarget;
  run: number;
  group: string;
}) {
  // Text effects need words to play on; their card shows a picture of the kind instead.
  if (group === "Text") return <Glyph group={group} />;
  const fx =
    run > 0
      ? partFx({ enter: { effect, speed: "fast", trigger: "load" } }, target === "text" ? "block" : target, {
          preview: true,
        })
      : null;
  return <span key={run} {...fx?.attrs} style={fx?.style} className="size-6 rounded-sm bg-foreground/70" />;
}

const GLYPHS: Record<string, ReactNode> = {
  None: <path d="M6 12h12" />,
  Fade: (
    <g fill="currentColor" stroke="none">
      <rect x="4" y="6" width="3" height="12" opacity="0.25" />
      <rect x="9" y="6" width="3" height="12" opacity="0.5" />
      <rect x="14" y="6" width="3" height="12" opacity="0.75" />
      <rect x="19" y="6" width="2" height="12" />
    </g>
  ),
  Zoom: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
  Blur: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7" strokeDasharray="2 3" />
    </>
  ),
  Reveal: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M12 5v14" />
    </>
  ),
  "3D": <path d="M6 8l10-3v14L6 16zM16 5l3 2v10l-3 2" />,
  Text: (
    <text x="12" y="16" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none" fontFamily="sans-serif">
      Aa
    </text>
  ),
  Move: <path d="M7 17L17 7M9 7h8v8" />,
  Pointer: <path d="M6 4l12 6-5 2-2 5z" />,
  Light: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" />,
  Picture: <path d="M4 6h16v12H4zM4 16l5-5 4 4 3-3 4 4" />,
  Focus: <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />,
  Scale: <path d="M5 19l6-6M5 13v6h6M19 5l-6 6M19 11V5h-6" />,
  Scroll: <path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4" />,
  Ambient: <path d="M3 12c3-6 6-6 9 0s6 6 9 0" />,
};

/** A small picture for a group of effects. */
function Glyph({ group }: { group: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-6 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {GLYPHS[group] ?? <circle cx="12" cy="12" r="3" />}
    </svg>
  );
}

/** The groups the pickers can draw a picture for, so a new group added to a catalogue gets one (the tests check it). */
export const GLYPH_GROUPS = Object.keys(GLYPHS);

// ---------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------

/**
 * A sample that plays what is chosen: its entrance (with a Replay button), its hover effect when pointed at, and,
 * in a small box that scrolls, its scroll effect. It is drawn with the same attributes and styles as the page, so it
 * is what visitors get; with less motion asked for, it is left still.
 */
export function MotionPreview({ part, motion }: { part: MotionPart; motion: PartMotion | undefined }) {
  const reduced = useReducedMotion();
  const [replay, setReplay] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const target = drawTarget(part);
  const live = withoutScroll(motion);
  const scrolling = onlyScroll(motion);
  const liveKey = `${replay}:${JSON.stringify(live ?? null)}`;
  const scrollKey = JSON.stringify(scrolling ?? null);

  // The runtime starts on the preview's box (pointer effects, waypoints, text splitting) and stops with it.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || reduced) return;
    return initMotion(box);
  }, [liveKey, scrollKey, reduced]);

  const fxOf = (value: PartMotion | undefined) => (reduced || !value ? null : partFx(value, target, { preview: true }));
  const liveFx = fxOf(live);
  // A row's columns or a column's components come in one after another when the entrance has a stagger.
  const childTarget: MotionTarget = part.kind === "row" ? "column" : "block";
  const enter = live?.enter;
  const childFx = (index: number) =>
    reduced || !enter || !enter.stagger || part.kind === "block"
      ? null
      : partFx(undefined, childTarget, { preview: true, index, parentStagger: enter.stagger, parentEnter: enter });
  const scrollFx = fxOf(scrolling);
  const nothing = !motion;
  return (
    // Where there is room it stays in view under the tabs, so a change can be watched while its settings are worked at.
    <div className="z-[5] flex flex-col gap-2 rounded-md border border-border bg-surface p-3 sm:sticky sm:top-7">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Preview</h3>
        <button
          type="button"
          onClick={() => setReplay((n) => n + 1)}
          disabled={!motion?.enter || reduced}
          className="min-h-9 rounded-md border border-border bg-background px-3 text-sm disabled:opacity-40"
        >
          Replay
        </button>
      </div>
      {reduced && (
        <p role="status" className="text-xs text-muted">
          {REDUCED_NOTE}
        </p>
      )}
      <div ref={boxRef} className={`grid grid-cols-1 items-start gap-3 ${motion?.scroll ? "sm:grid-cols-2" : ""}`}>
        <div className="flex flex-col gap-1">
          <div className="overflow-hidden rounded-md bg-background p-4">
            <div key={liveKey} aria-hidden {...liveFx?.attrs} style={liveFx?.style}>
              <Sample part={part} childFx={childFx} />
            </div>
          </div>
          <p className="text-xs text-muted">
            {nothing
              ? "Choose an effect below to see it here."
              : motion?.hover
                ? "Point at the sample to see the hover effect."
                : "This is a sample, not your content."}
          </p>
        </div>
        {motion?.scroll && (
          <div className="flex flex-col gap-1">
            <div
              tabIndex={0}
              role="region"
              aria-label="Scroll this box to see the scroll effect"
              className="h-32 overflow-y-auto rounded-md bg-background focus-visible:outline-2"
            >
              <div className="h-32" aria-hidden />
              <div className="px-4">
                <div key={scrollKey} aria-hidden {...scrollFx?.attrs} style={scrollFx?.style}>
                  <Sample part={part} childFx={childFx} />
                </div>
              </div>
              <div className="h-44" aria-hidden />
            </div>
            <p className="text-xs text-muted">Scroll inside this box: the sample moves as you do.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** What the preview draws: a stand-in for the kind of part, so a row's columns and a column's components can be seen. */
function Sample({ part, childFx }: { part: MotionPart; childFx: (index: number) => FxProps | null }) {
  const bar = "h-2 rounded bg-foreground/25";
  // What a stagger plays in turn carries the attributes the parent's entrance gives its children.
  const child = (index: number) => {
    const fx = childFx(index);
    return { ...fx?.attrs, style: fx?.style };
  };
  if (part.kind === "row") {
    return (
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} {...child(i)} className="flex flex-1 flex-col gap-1.5 rounded bg-accent/15 p-3">
            <div className={`${bar} w-2/3`} />
            <div className={bar} />
          </div>
        ))}
      </div>
    );
  }
  if (part.kind === "column") {
    return (
      <div className="flex max-w-xs flex-col gap-2 rounded bg-accent/15 p-3">
        {["w-1/2", "w-full", "w-3/4"].map((width, i) => (
          <div key={i} {...child(i)}>
            <div className={`${bar} ${width}`} />
          </div>
        ))}
      </div>
    );
  }
  if (part.blockType === "heading" || part.blockType === "richText") {
    return <p className="text-xl font-semibold">A short line that draws the eye, and a little more to read</p>;
  }
  if (part.blockType === "image") {
    return <div className="h-24 w-40 rounded bg-accent/25" />;
  }
  if (part.blockType === "button" || part.blockType === "dualButton") {
    return <div className="inline-block rounded bg-foreground px-4 py-2 text-sm text-background">Button</div>;
  }
  return (
    <div className="flex max-w-xs flex-col gap-2 rounded bg-accent/15 p-3">
      <div className={`${bar} w-1/2`} />
      <div className={bar} />
    </div>
  );
}
