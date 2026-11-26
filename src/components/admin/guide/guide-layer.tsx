"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { fillWords } from "@/lib/admin-fill";
import { GUIDE_KINDS, GUIDE_LEVELS, WELCOME, WELCOME_TARGETS, effectiveLevel, guideDay, guideTally, type GuideLevel, type GuidePlace, type WelcomeStep } from "@/lib/guide";

import { useGuide, type GuideState } from "./guide-context";
import { GuideIcon } from "./guide-parts";

/**
 * What Guide draws (D909), in its runtime's chunk (`guide-runtime.tsx`), never a screen's first scripts: the welcome's spotlight, a beacon beside a
 * page's title, the panel, and the note after the welcome. Each is placed from the page as it is drawn (the target's box, followed as the
 * page scrolls or resizes), in the admin's colour roles and classes the admin already has: what is Guide's own (a shadow, a width, a layer)
 * is written as a style, so it adds nothing to the stylesheet every page shares (`e2e/performance.spec.ts`).
 */
export function GuideLayer() {
  const guide = useGuide();
  if (!guide) return null;
  return (
    <>
      {guide.moment?.kind === "spotlight" && <Spotlight guide={guide} steps={guide.moment.steps} />}
      {guide.moment?.kind === "beacon" && <BeaconFor guide={guide} placeKey={guide.moment.place} open={guide.moment.open} />}
      {guide.panel && <Panel guide={guide} />}
      {guide.toast && !guide.panel && <Toast guide={guide} />}
    </>
  );
}

type Box = { top: number; left: number; width: number; height: number };

/** The first of the selectors drawn on the page with a size: hidden parts (the rail on a phone) do not count. */
function targetOf(selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

/** An element's box in the window, followed as the page scrolls, resizes or the element changes size. */
function useBox(el: Element | null, measure: (el: Element) => Box = boxOf): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setBox(measure(el)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [el, measure]);
  return box;
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

/** The end of a title's text (its last line), so a beacon sits after the words, not at the far end of a wide heading. */
const textEndOf = (el: Element): Box => {
  const range = document.createRange();
  range.selectNodeContents(el);
  const lines = Array.from(range.getClientRects());
  const last = lines[lines.length - 1];
  return last ? { top: last.top, left: last.right, width: 0, height: last.height } : { ...boxOf(el), width: 0 };
};

const MARGIN = 16;

/** Where a card of `size` goes beside `box`: right, left, below or above, the first with room, kept inside the window. */
function placeCard(box: Box, size: { width: number; height: number }): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampTop = (top: number) => Math.max(MARGIN, Math.min(top, vh - size.height - MARGIN));
  const clampLeft = (left: number) => Math.max(MARGIN, Math.min(left, vw - size.width - MARGIN));
  if (box.left + box.width + MARGIN + size.width + MARGIN <= vw) return { top: clampTop(box.top), left: box.left + box.width + MARGIN };
  if (box.left - MARGIN - size.width >= MARGIN) return { top: clampTop(box.top), left: box.left - MARGIN - size.width };
  if (box.top + box.height + MARGIN + size.height <= vh) return { top: box.top + box.height + MARGIN, left: clampLeft(box.left) };
  return { top: clampTop(box.top - MARGIN - size.height), left: clampLeft(box.left) };
}

/** Keeps the keyboard inside `root` while it is open: Tab from the last control comes back to the first. */
function trapTab(event: ReactKeyboardEvent<HTMLElement>, root: HTMLElement | null) {
  if (event.key !== "Tab" || !root) return;
  const items = Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input, [tabindex]:not([tabindex='-1'])")).filter((el) => !el.hasAttribute("disabled"));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** The welcome's words for a step: the platform's rail speaks of the platform. */
function stepWords(guide: GuideState, step: WelcomeStep) {
  const w = guide.words.welcome[step];
  if (step === "rail" && guide.platform) return { title: guide.words.welcomePlatform.railTitle, body: guide.words.welcomePlatform.railBody, can: guide.words.welcomePlatform.railCan };
  return { title: w.title, body: w.body, can: w.can };
}

const PILL = "inline-flex min-h-11 items-center justify-center rounded-pill px-5 text-body";
const MAIN = `${PILL} bg-brand text-body-strong text-brand-ink hover:bg-brand-hover`;
/** Over the admin's dialogs (50) and menus: written as styles, so nothing of Guide adds a rule to the stylesheet every page shares. */
const ABOVE = { spotlight: 70, panel: 60, card: 40, dot: 30 } as const;
const CARD_WIDTH = (px: number) => `min(${px}px, calc(100vw - 32px))`;
/** Where the page begins beside the rail (0 on a phone, which has none). */
const railEdge = () => document.querySelector("[data-admin-rail]")?.getBoundingClientRect().right ?? 0;
const QUIET = `${PILL} border border-edge bg-card text-ink hover:bg-sunken`;

/** The welcome: the page dimmed around one place at a time, a card beside it saying what it is and what can be done there. */
function Spotlight({ guide, steps }: { guide: GuideState; steps: WelcomeStep[] }) {
  // The steps whose place is on this page; read once, when the welcome starts.
  const [shown] = useState(() => steps.filter((step) => targetOf(WELCOME_TARGETS[step])));
  const [targets] = useState(() => shown.map((step) => targetOf(WELCOME_TARGETS[step])));
  const [index, setIndex] = useState(0);
  const step = shown[index];
  const target = targets[index] ?? null;
  const box = useBox(target);
  const card = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 380, height: 320 });
  const opener = useRef<Element | null>(null);
  const { finish, dispatch } = guide;
  const w = guide.words.spotlight;

  useEffect(() => {
    opener.current = document.activeElement;
    return () => {
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    };
  }, []);

  useEffect(() => {
    if (!step) {
      // Nothing of the welcome on this page (a phone, a Home without its cards): it waits for another visit.
      finish("none");
      return;
    }
    if (target && step !== "rail") target.scrollIntoView({ block: "nearest", behavior: "auto" });
    if (!guide.progress?.found.includes(step)) dispatch({ type: "found", place: step });
    // Once a step: the record changing as it is marked found is not a new step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, target, finish, dispatch]);

  const measured = box !== null;
  useLayoutEffect(() => {
    if (!card.current) return;
    const r = card.current.getBoundingClientRect();
    setSize({ width: r.width, height: r.height });
    card.current.focus();
  }, [index, measured]);

  if (!step || !box) return null;
  const last = index === shown.length - 1;
  const words = stepWords(guide, step);
  const at = placeCard(box, size);
  const pad = 6;
  return (
    <div className="fixed inset-0" style={{ zIndex: ABOVE.spotlight }} data-guide-spotlight>
      <div aria-hidden className="absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-card"
        style={{
          top: box.top - pad,
          left: box.left - pad,
          width: box.width + pad * 2,
          height: box.height + pad * 2,
          boxShadow: "0 0 0 2px var(--brand), 0 0 0 9999px color-mix(in srgb, var(--rail) 62%, transparent)",
        }}
      />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-step-title"
        aria-describedby="guide-step-body"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            finish("later");
          }
          trapTab(event, card.current);
        }}
        className="absolute flex flex-col gap-4 rounded-card bg-card p-6 text-ink shadow-[var(--shadow-float)] outline-none"
        style={{ top: at.top, left: at.left, width: CARD_WIDTH(380) }}
      >
        <div className="flex items-center justify-between">
          <p className="text-eyebrow text-brand-text uppercase">{fillWords(guide.words.welcome.eyebrow, { n: index + 1, total: shown.length })}</p>
          <button type="button" onClick={() => finish("later")} aria-label={w.close} className="-mr-2 flex size-11 items-center justify-center rounded-pill text-muted hover:bg-sunken hover:text-ink">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <h2 id="guide-step-title" className="text-title text-ink">
          {words.title}
        </h2>
        <p id="guide-step-body" className="text-body text-ink-2">
          {words.body}
        </p>
        <div className="rounded-panel bg-sunken px-4 py-3">
          <p className="sr-only">{w.here}</p>
          <ul className="flex flex-col gap-2">
            {words.can.map((line) => (
              <li key={line} className="flex gap-2.5 text-body text-ink">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-positive-text" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5L20 7" />
                </svg>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <div aria-hidden className="flex gap-1.5">
            {shown.map((s, i) => (
              <span key={s} className={`h-2 rounded-pill ${i === index ? "w-5 bg-inverse" : "w-2 bg-line"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => finish("later")} className={QUIET}>
              {w.later}
            </button>
            <button type="button" onClick={() => (last ? finish("done") : setIndex(index + 1))} className={MAIN}>
              {last ? w.done : w.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A beacon for a place, beside its marked part (`data-guide-beacon`) or the end of the page's title. */
function BeaconFor({ guide, placeKey, open }: { guide: GuideState; placeKey: string; open: boolean }) {
  const place = guide.places.find((p) => p.key === placeKey);
  const [target] = useState(() => targetOf([`[data-guide-beacon="${placeKey}"]`, "#admin-main h1"]));
  if (!place || !target) return null;
  return <Beacon guide={guide} place={place} target={target} startOpen={open} />;
}

function Beacon({ guide, place, target, startOpen }: { guide: GuideState; place: GuidePlace; target: Element; startOpen: boolean }) {
  const titled = target.matches("h1");
  const box = useBox(target, titled ? textEndOf : boxOf);
  const [open, setOpen] = useState(startOpen);
  const dot = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 352, height: 260 });
  const w = guide.words.beacon;

  useLayoutEffect(() => {
    if (!open || !card.current) return;
    const r = card.current.getBoundingClientRect();
    setSize({ width: r.width, height: r.height });
    card.current.focus();
  }, [open]);

  // A press outside the card closes it; the dot stays until it is answered.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (card.current?.contains(event.target as Node) || dot.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [open]);

  if (!box) return null;
  // The dot: after a title's words, or at the top right corner of a marked part.
  const center = titled ? { x: box.left + 18, y: box.top + box.height / 2 } : { x: box.left + box.width, y: box.top };
  const dotBox = { top: center.y - 22, left: center.x - 22, width: 44, height: 44 };
  const below = { top: dotBox.top + dotBox.height + 4, left: Math.max(MARGIN, Math.min(center.x - 40, window.innerWidth - size.width - MARGIN)) };
  const at = below.top + size.height + MARGIN <= window.innerHeight ? below : placeCard(dotBox, size);
  const answer = (how: "done" | "later") => {
    guide.finish(how);
    if (dot.current?.isConnected) dot.current.blur();
  };
  return (
    <>
      <button
        ref={dot}
        type="button"
        data-guide-dot
        aria-label={fillWords(w.label, { place: place.label })}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="fixed flex size-11 items-center justify-center rounded-pill"
        style={{ top: dotBox.top, left: dotBox.left, zIndex: ABOVE.dot }}
      >
        <span aria-hidden className="absolute size-6 animate-pulse rounded-pill bg-brand-soft" />
        <span aria-hidden className="relative size-3 rounded-pill" style={{ background: "var(--focus)", boxShadow: "0 0 0 3px var(--card)" }} />
      </button>
      {open && (
        <div
          ref={card}
          role="dialog"
          aria-labelledby="guide-beacon-title"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              dot.current?.focus();
            }
          }}
          className="fixed flex flex-col gap-3 rounded-card border border-edge bg-card p-5 text-ink shadow-[var(--shadow-float)] outline-none"
          style={{ top: at.top, left: at.left, width: CARD_WIDTH(352), zIndex: ABOVE.card }}
        >
          <p className="text-eyebrow text-brand-text uppercase">{fillWords(w.eyebrow, { place: place.label })}</p>
          <h2 id="guide-beacon-title" className="text-title text-ink">
            {fillWords(w.title, { place: place.label })}
          </h2>
          {place.what && <p className="text-body text-ink-2">{place.what}</p>}
          {place.also.length > 0 && (
            <div className="flex flex-col gap-1 rounded-panel bg-sunken px-4 py-3">
              <p className="text-caption text-muted">{fillWords(w.also, { place: place.label })}</p>
              <p className="text-body text-ink">{place.also.join(" · ")}</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => answer("later")} className={QUIET}>
              {w.notNow}
            </button>
            <button type="button" onClick={() => answer("done")} className={MAIN}>
              {w.gotIt}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** The panel: how far the person is, the next place, every place with a way there, and how often Guide may speak up. */
function Panel({ guide }: { guide: GuideState }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [customise, setCustomise] = useState(false);
  const [edge] = useState(railEdge);
  const [confirming, setConfirming] = useState(false);
  const w = guide.words.panel;
  const progress = guide.progress;
  const { setPanel } = guide;

  useEffect(() => {
    const opener = document.activeElement;
    root.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  if (!progress) return null;
  const now = guide.now;
  const { found, total, next } = guideTally(guide.places, progress);
  const level = effectiveLevel(guide.settings, progress, now);
  const go = (place: GuidePlace) => {
    guide.ask({ place: place.key });
    setPanel(false);
    router.push(place.href);
  };
  const replay = () => {
    guide.dispatch({ type: "replay", moment: WELCOME });
    guide.ask({ place: WELCOME });
    setPanel(false);
    router.push(guide.home);
  };
  const setLevel = (value: GuideLevel) => guide.saveSettings({ ...guide.settings, level: value });
  return (
    <div className="fixed inset-0" style={{ zIndex: ABOVE.panel }}>
      <div aria-hidden className="absolute inset-0" style={{ background: "color-mix(in srgb, var(--rail) 32%, transparent)" }} onClick={() => setPanel(false)} />
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-panel-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setPanel(false);
          }
          trapTab(event, root.current);
        }}
        className="absolute inset-y-0 flex w-full flex-col gap-5 overflow-y-auto bg-card p-6 text-ink shadow-2xl outline-none sm:w-[28rem]"
        style={{ left: edge }}
      >
        <div className="flex shrink-0 items-center justify-between">
          <h2 id="guide-panel-title" className="flex items-center gap-2.5 text-title text-ink">
            <span className="text-brand-text">
              <GuideIcon />
            </span>
            {w.title}
          </h2>
          <button type="button" onClick={() => setPanel(false)} aria-label={w.close} className="-mr-2 flex size-11 items-center justify-center rounded-pill hover:bg-sunken">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex justify-between gap-3 text-body">
            <span className="text-body-strong">{fillWords(w.found, { found, total })}</span>
            <span className="text-muted">{fillWords(w.day, { n: guideDay(progress, now) })}</span>
          </div>
          <div className="h-2 rounded-pill bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={found} aria-label={fillWords(w.found, { found, total })}>
            <div className="h-2 rounded-pill bg-brand" style={{ width: `${total ? Math.round((found / total) * 100) : 0}%` }} />
          </div>
        </div>

        {next ? (
          <section aria-labelledby="guide-next" className="flex shrink-0 flex-col gap-2.5 rounded-card bg-brand-soft p-5">
            <p id="guide-next" className="text-eyebrow text-brand-text uppercase">
              {w.nextUp}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body-strong text-ink">{next.label}</span>
                <span className="text-body text-ink-2">{next.what}</span>
              </div>
              <button type="button" onClick={() => go(next)} className={MAIN}>
                {w.showMe}
              </button>
            </div>
          </section>
        ) : (
          <p className="shrink-0 rounded-card bg-brand-soft p-5 text-body text-ink">{w.allFound}</p>
        )}

        {customise ? (
          <section aria-labelledby="guide-customise" className="flex shrink-0 flex-col">
            <h3 id="guide-customise" className="mb-1 text-body-strong text-ink">
              {w.customiseTitle}
            </h3>
            {GUIDE_KINDS.map((kind) => {
              const on = !guide.settings.off.includes(kind);
              return (
                <div key={kind} className="flex min-h-14 items-center justify-between gap-4 border-b border-line">
                  <div className="flex flex-col py-2">
                    <span className="text-body text-ink">{w.kinds[kind].name}</span>
                    <span className="text-caption text-muted">{w.kinds[kind].what}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={w.kinds[kind].name}
                    onClick={() => guide.saveSettings({ ...guide.settings, off: on ? [...guide.settings.off, kind] : guide.settings.off.filter((k) => k !== kind) })}
                    className={`flex h-7 w-12 shrink-0 items-center rounded-pill p-1 ${on ? "justify-end bg-brand" : "justify-start bg-line"}`}
                  >
                    <span aria-hidden className="size-5 rounded-pill bg-card shadow" />
                  </button>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2 pt-4">
              <button type="button" onClick={replay} className={QUIET}>
                {w.replay}
              </button>
              {confirming ? (
                <div role="group" aria-label={w.restartConfirm} className="flex w-full flex-col gap-2 rounded-panel bg-sunken p-3">
                  <p className="text-body text-ink">{w.restartConfirm}</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConfirming(false)} className={QUIET}>
                      {guide.words.toast.close}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        guide.dispatch({ type: "restart" });
                        setConfirming(false);
                        setCustomise(false);
                      }}
                      className={`${PILL} bg-inverse text-inverse-ink`}
                    >
                      {w.restart}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className={QUIET}>
                  {w.restart}
                </button>
              )}
            </div>
          </section>
        ) : (
          <section aria-labelledby="guide-places" className="flex shrink-0 flex-col">
            <h3 id="guide-places" className="mb-1 text-body-strong text-ink">
              {w.places}
            </h3>
            <ul className="flex flex-col">
              {guide.places.map((place) => {
                const done = progress.found.includes(place.key);
                return (
                  <li key={place.key} className="flex min-h-12 items-center gap-3 border-b border-line">
                    <span aria-hidden className={`flex size-5 shrink-0 items-center justify-center rounded-pill ${done ? "bg-brand text-brand-ink" : "border-2 border-edge"}`}>
                      {done && (
                        <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      )}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col py-1.5">
                      <span className="text-body text-ink">
                        {place.label}
                        {done && <span className="sr-only">, {w.foundMark}</span>}
                      </span>
                      {place.what && <span className="text-caption text-muted">{place.what}</span>}
                    </div>
                    <button type="button" onClick={() => go(place)} className="min-h-11 shrink-0 px-1 text-body text-brand-text hover:underline">
                      {done ? w.again : w.showMe}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section aria-labelledby="guide-often" className="mt-auto flex shrink-0 flex-col gap-2.5 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 id="guide-often" className="text-body-strong text-ink">
              {w.howOften}
            </h3>
            <button type="button" onClick={() => setCustomise(!customise)} aria-expanded={customise} className="min-h-11 text-body text-brand-text hover:underline">
              {customise ? w.back : w.customise}
            </button>
          </div>
          <div role="group" aria-labelledby="guide-often" className="grid grid-cols-3 gap-1 rounded-pill border border-line bg-sunken p-1">
            {GUIDE_LEVELS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={level === value}
                onClick={() => setLevel(value)}
                className="min-h-10 rounded-pill text-body text-ink-2 hover:text-ink aria-pressed:bg-inverse aria-pressed:text-inverse-ink"
              >
                {w.levels[value]}
              </button>
            ))}
          </div>
          <p className="text-caption text-ink-2">{w.levelText[level]}</p>
          {guide.settings.level === null && <p className="text-caption text-muted">{w.automatic}</p>}
        </section>
      </div>
    </div>
  );
}

/** The note after the welcome: what happens next, and Guide one press away. Gone by itself after a while. */
function Toast({ guide }: { guide: GuideState }) {
  const w = guide.words.toast;
  const done = guide.toast === "done";
  const [edge] = useState(railEdge);
  const { setToast } = guide;
  useEffect(() => {
    const timer = window.setTimeout(() => setToast(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [setToast]);
  return (
    <div
      role="status"
      className="fixed flex items-start gap-3 rounded-card bg-inverse p-4 text-inverse-ink shadow-[var(--shadow-float)]"
      style={{ bottom: edge ? 24 : 96, left: edge + 16, width: CARD_WIDTH(400), zIndex: ABOVE.card }}
    >
      <span className="mt-0.5 text-brand">
        <GuideIcon />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-body-strong">{done ? w.doneTitle : w.laterTitle}</p>
        <p className="text-caption opacity-80">{done ? w.doneBody : w.laterBody}</p>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={() => {
              setToast(null);
              guide.setPanel(true);
            }}
            className="min-h-9 text-caption underline underline-offset-2"
          >
            {w.open}
          </button>
          <button type="button" onClick={() => setToast(null)} className="min-h-9 text-caption opacity-80 hover:opacity-100">
            {w.close}
          </button>
        </div>
      </div>
    </div>
  );
}
