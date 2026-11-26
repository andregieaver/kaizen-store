"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { GuideMessages } from "@/lib/admin-messages/guide.en";
import {
  BEACON_SETTLE_MS,
  DEFAULT_GUIDE_SETTINGS,
  QUIET_AFTER_TYPING_MS,
  SPOTLIGHT_SETTLE_MS,
  WELCOME,
  applyGuideEvent,
  guideMoment,
  guideTally,
  kindOn,
  placeAt,
  type GuideAsk,
  type GuideEvent,
  type GuideMoment,
  type GuidePlace,
  type GuideProgress,
  type GuideSettings,
} from "@/lib/guide";

import { asker } from "../leave-listeners";

/**
 * Guide in the browser (D909, `src/lib/guide.ts`): held around each level's frame (a store's and the platform's), it reads the person's
 * record once the page is drawn (never in the layout), marks the places they reach, and decides from the page's signals when one moment
 * may be shown: never while they type, hold unsaved work, have just arrived, are in a focus task (`quietOn`) or have another dialog open.
 * What it draws (the spotlight, a beacon, the panel, the note after the welcome) is in `guide-layer.tsx`, loaded only once something is to
 * be drawn, so a screen with nothing to say carries none of it.
 */

export type GuideActions = {
  load: (store: string | null) => Promise<{ progress: GuideProgress; settings: GuideSettings }>;
  event: (store: string | null, event: GuideEvent) => Promise<GuideProgress | null>;
  settings: (level: GuideSettings["level"], off: GuideSettings["off"]) => Promise<void>;
};

export type GuideToast = "done" | "later" | null;

export type GuideState = {
  ready: boolean;
  /** When the record was read (ms). */
  now: number;
  progress: GuideProgress | null;
  settings: GuideSettings;
  places: GuidePlace[];
  home: string;
  platform: boolean;
  words: GuideMessages;
  moment: GuideMoment;
  panel: boolean;
  toast: GuideToast;
  dispatch: (event: GuideEvent) => void;
  saveSettings: (settings: GuideSettings) => void;
  setPanel: (open: boolean) => void;
  /** Ask for a place (or the whole welcome) to be shown on arrival; the panel moves there. */
  ask: (ask: GuideAsk) => void;
  /** The moment drawn is over: `done`, put away (`later`), or it found nothing to point at (`none`). */
  finish: (how: "done" | "later" | "none") => void;
  setToast: (toast: GuideToast) => void;
};

const GuideContext = createContext<GuideState | null>(null);

/** Guide here, or null outside a level's frame (the builder's sandbox, a page drawn alone in a test). */
export function useGuide(): GuideState | null {
  return useContext(GuideContext);
}

type Layer = { GuideLayer: ComponentType };
let layer: Layer | null = null;
let loadingLayer: Promise<Layer> | null = null;
function loadLayer(): Promise<Layer> {
  loadingLayer ??= import("./guide-layer").then(
    (module) => (layer = module),
    (error: unknown) => {
      loadingLayer = null;
      throw error;
    },
  );
  return loadingLayer;
}

const EDITING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"]';
const PHONE = "(max-width: 767px)";

export function GuideProvider({
  store,
  home,
  places,
  words,
  quietOn,
  platform = false,
  actions,
  children,
}: {
  /** The store's slug, or null for the platform. */
  store: string | null;
  home: string;
  places: GuidePlace[];
  words: GuideMessages;
  /** Addresses where Guide stays quiet (a regular expression's source): the focus tasks and the workspace tools. */
  quietOn: string;
  platform?: boolean;
  actions: GuideActions;
  children: ReactNode;
}) {
  const path = usePathname();
  const [progress, setProgress] = useState<GuideProgress | null>(null);
  const [settings, setSettings] = useState<GuideSettings>(DEFAULT_GUIDE_SETTINGS);
  // The moment drawn, for the page it was drawn on: a new page leaves it behind without an effect setting state.
  const [shown, setShown] = useState<{ path: string; moment: GuideMoment } | null>(null);
  const moment = shown?.path === path ? shown.moment : null;
  const setMoment = useCallback((next: GuideMoment) => setShown(next ? { path: window.location.pathname, moment: next } : null), []);
  // When the record was read: the panel's day and the hints' level are read against it, not the clock at each draw.
  const [now, setNow] = useState(0);
  const [panel, setPanel] = useState(false);
  const [toast, setToast] = useState<GuideToast>(null);
  const [asked, setAsked] = useState<GuideAsk>(null);
  const [Drawn, setDrawn] = useState<Layer | null>(layer);
  const pending = useRef(0);
  const arrived = useRef({ path, at: 0 });
  const decided = useRef<string | null>(null);
  const lastKey = useRef(0);

  // The record, once the page is drawn; without it (signed out, the network gone) Guide draws nothing.
  useEffect(() => {
    let live = true;
    actions.load(store).then(
      (read) => {
        if (!live) return;
        setProgress(read.progress);
        setSettings(read.settings);
        setNow(Date.now());
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [actions, store]);

  const dispatch = useCallback(
    (event: GuideEvent) => {
      setProgress((p) => (p ? applyGuideEvent(p, event, new Date().toISOString()) : p));
      pending.current += 1;
      actions.event(store, event).then(
        (kept) => {
          pending.current -= 1;
          // The server's record wins once nothing else is on its way, so both hold the same.
          if (kept && pending.current === 0) setProgress(kept);
        },
        () => {
          pending.current -= 1;
        },
      );
    },
    [actions, store],
  );

  const saveSettings = useCallback(
    (next: GuideSettings) => {
      setSettings(next);
      actions.settings(next.level, next.off).catch(() => undefined);
    },
    [actions],
  );

  // Keys pressed anywhere: Guide waits a moment after the last.
  useEffect(() => {
    const typed = () => (lastKey.current = Date.now());
    window.addEventListener("keydown", typed, true);
    return () => window.removeEventListener("keydown", typed, true);
  }, []);

  // A new page: a new visit, and the place reached is found.
  useEffect(() => {
    arrived.current = { path, at: Date.now() };
    decided.current = null;
    if (!progress) return;
    const here = placeAt(places, path);
    // Marked once the page is drawn, out of the effect's own pass.
    const timer = window.setTimeout(() => {
      // An ask is for the page it leads to: a person who went elsewhere instead has it put away.
      setAsked((ask) => {
        if (!ask) return ask;
        const target = ask.place === WELCOME || places.some((p) => p.key === ask.place && p.welcome) ? path === home : here?.key === ask.place;
        return target ? ask : null;
      });
      if (here && !progress.found.includes(here.key)) dispatch({ type: "found", place: here.key });
      if (path.startsWith(`${home}/assistant`) && !progress.found.includes("ai")) dispatch({ type: "found", place: "ai" });
    }, 0);
    return () => window.clearTimeout(timer);
    // Only the address decides a visit; the record changing on the way is not a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, progress === null]);

  // Whether a moment may be shown now, and which; checked until the page is calm, once per visit.
  useEffect(() => {
    if (!progress || moment || panel || decided.current === path) return;
    const quiet = new RegExp(quietOn);
    const candidate = guideMoment(places, home, settings, progress, { path, calm: true, phone: window.matchMedia(PHONE).matches, now: Date.now() }, asked);
    if (!candidate) return;
    const settle = candidate.kind === "spotlight" ? SPOTLIGHT_SETTLE_MS : candidate.kind === "beacon" && candidate.open ? 0 : BEACON_SETTLE_MS;
    const calm = () => {
      const now = Date.now();
      if (document.visibilityState !== "visible" || quiet.test(path)) return false;
      if (now - arrived.current.at < settle || now - lastKey.current < QUIET_AFTER_TYPING_MS) return false;
      if (document.activeElement?.matches(EDITING)) return false;
      if (asker()) return false;
      // Another dialog is open (the AI manager, a confirm, the phone's menu).
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return false;
      return true;
    };
    const tick = () => {
      if (!calm()) return;
      window.clearInterval(timer);
      decided.current = path;
      setAsked(null);
      if (candidate.kind === "beacon") dispatch({ type: "seen", moment: candidate.key });
      else dispatch({ type: "spotlight", moment: candidate.key });
      setMoment(candidate);
    };
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [progress, settings, places, home, path, asked, moment, panel, quietOn, dispatch, setMoment]);

  const finish = useCallback(
    (how: "done" | "later" | "none") => {
      if (moment && how !== "none") {
        dispatch(how === "done" ? { type: "done", moment: moment.key } : { type: "later", moment: moment.key, kind: moment.kind });
        // The note after the whole welcome, not after one place shown again from the panel.
        if (moment.kind === "spotlight" && moment.steps.length > 1) setToast(how);
      }
      setMoment(null);
    },
    [dispatch, moment, setMoment],
  );

  const ask = useCallback(
    (next: GuideAsk) => {
      decided.current = null;
      setMoment(null);
      setAsked(next);
    },
    [setMoment],
  );

  // The layer's code, once there is something to draw.
  const needed = Boolean(moment || panel || toast);
  useEffect(() => {
    if (!needed || Drawn) return;
    loadLayer().then(setDrawn, () => undefined);
  }, [needed, Drawn]);

  const value: GuideState = {
    ready: progress !== null,
    now,
    progress,
    settings,
    places,
    home,
    platform,
    words,
    moment,
    panel,
    toast,
    dispatch,
    saveSettings,
    setPanel,
    ask,
    finish,
    setToast,
  };
  return (
    <GuideContext value={value}>
      {children}
      {needed && Drawn && <Drawn.GuideLayer />}
    </GuideContext>
  );
}

/** The compass Guide is drawn with: lucide's at the sections' stroke. */
export function GuideIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z" />
    </svg>
  );
}

/** Guide's tile at the foot of the rail: its name and how far the person is, when the rail shows names. */
export function GuideRailButton() {
  const guide = useGuide();
  if (!guide?.ready || !guide.progress) return null;
  const { found, total } = guideTally(guide.places, guide.progress);
  const w = guide.words.button;
  return (
    <button
      type="button"
      data-guide="button"
      onClick={() => guide.setPanel(!guide.panel)}
      aria-expanded={guide.panel}
      aria-label={fillWords(w.open, { found, total })}
      className="group relative flex size-11 items-center justify-center rounded-tile text-rail-icon hover:bg-[color-mix(in_srgb,var(--rail),white_8%)] hover:text-[color-mix(in_srgb,var(--rail-icon),white_45%)] aria-expanded:bg-[color-mix(in_srgb,var(--rail),white_12%)] aria-expanded:text-inverse-ink [[data-collapsed]_&]:size-10 [[data-rail=names]_[data-admin-rail]:not([data-collapsed])_&]:w-full [[data-rail=names]_[data-admin-rail]:not([data-collapsed])_&]:justify-start [[data-rail=names]_[data-admin-rail]:not([data-collapsed])_&]:gap-3 [[data-rail=names]_[data-admin-rail]:not([data-collapsed])_&]:px-3"
    >
      <span className="text-brand">
        <GuideIcon />
      </span>
      <span aria-hidden className="hidden flex-1 truncate text-left text-body-strong [[data-rail=names]_[data-admin-rail]:not([data-collapsed])_&]:inline">
        {w.label}
      </span>
      <span aria-hidden className="hidden text-caption tabular-nums [[data-rail=names]_[data-admin-rail]:not([data-collapsed])_&]:inline">
        {fillWords(w.progress, { found, total })}
      </span>
      {found < total && <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-pill bg-brand ring-2 ring-rail [[data-rail=names]_[data-admin-rail]:not([data-collapsed])_&]:hidden" />}
    </button>
  );
}

/**
 * Guide in the phone's menu: a link, so the menu closes as it does for any link (`MobileMenu`), then the panel opens. `href` is the level's
 * Home, where the link would lead without scripts.
 */
export function GuideMenuLink() {
  const guide = useGuide();
  if (!guide?.ready || !guide.progress) return null;
  const { found, total } = guideTally(guide.places, guide.progress);
  const w = guide.words.button;
  return (
    <a
      href={guide.home}
      onClick={(event) => {
        event.preventDefault();
        guide.setPanel(true);
      }}
      className="flex min-h-11 items-center gap-2 text-ink"
    >
      <span className="text-brand-text">
        <GuideIcon className="size-4" />
      </span>
      <span className="flex-1">{w.label}</span>
      <span className="text-caption text-muted tabular-nums">{fillWords(w.progress, { found, total })}</span>
    </a>
  );
}

/**
 * A hint inside an empty page (D909): a line and a few steps of what the person will do here, part of the page and in no budget. Gone
 * once the page has something in it (the page draws it only while empty), when hints are switched off, and outside a level's frame.
 */
export function GuideHint({ place }: { place: "orders" | "products" | "customers" }) {
  const guide = useGuide();
  if (!guide?.ready || !guide.progress || !kindOn("hint", guide.settings, guide.progress, guide.now)) return null;
  const hint = guide.words.hints[place];
  return (
    <div data-guide-hint={place} className="mt-4 flex w-full max-w-3xl flex-col items-center gap-4 text-left">
      <p className="inline-flex items-center gap-2 rounded-pill border border-insight-line bg-insight-soft px-4 py-2 text-body text-insight-text">
        <GuideIcon className="size-4" />
        <span>
          <span className="sr-only">{guide.words.hints.lead}: </span>
          {hint.line}
        </span>
      </p>
      <ol className={`grid w-full gap-3 ${hint.steps.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {hint.steps.map((step, i) => (
          <li key={step.title} className="flex flex-col gap-1.5 rounded-panel bg-sunken p-4">
            <span aria-hidden className="flex size-7 items-center justify-center rounded-pill bg-inverse text-caption text-inverse-ink tabular-nums">
              {i + 1}
            </span>
            <span className="text-body-strong text-ink">{step.title}</span>
            <span className="text-body text-ink-2">{step.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
