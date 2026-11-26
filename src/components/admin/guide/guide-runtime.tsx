"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";

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
import { GuideContext, type GuideState, type GuideToast } from "./guide-context";
import { GuideHint, GuideMenuLink, GuideRailButton } from "./guide-parts";
import type { GuideHintPlace } from "./guide-slots";

/**
 * Guide's runtime (D909, `src/lib/guide.ts`), loaded by `GuideProvider` once the screen is drawn, so no screen's first scripts carry it. It
 * reads the person's record, the level's places and Guide's words from Guide's route (`/api/guide`, which also marks found the place
 * the screen is in), marks the places reached as the person moves on, and decides from the page's signals when one moment may be shown:
 * never while they type, hold unsaved work, have just arrived, are in a focus task (`quietOn`) or have another dialog open. Events go to the
 * route with `fetch`, never as server actions, which Next queues with the router's own moves. It draws the rail's button, the phone's link
 * and the hints into the slots the server sent (`guide-slots.tsx`), and loads what it shows (`guide-layer.tsx`) only once there is something.
 */

const ROUTE = "/api/guide";
const EDITING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"]';
const PHONE = "(max-width: 767px)";

type Read = { progress: GuideProgress; settings: GuideSettings; places: GuidePlace[]; words: GuideMessages };

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

type Slot = { el: Element; name: string; place: GuideHintPlace | null };
const sameSlots = (a: Slot[], b: Slot[]) => a.length === b.length && a.every((slot, i) => slot.el === b[i].el);

/** The slots on the page now, followed as the page changes (a new screen, an empty page filled, the phone's menu drawn). */
function useSlots(): Slot[] {
  const [slots, setSlots] = useState<Slot[]>([]);
  useEffect(() => {
    let frame = 0;
    const scan = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const found = Array.from(document.querySelectorAll<HTMLElement>("[data-guide-slot]")).map((el) => ({
          el,
          name: el.dataset.guideSlot ?? "",
          place: (el.dataset.place as GuideHintPlace | undefined) ?? null,
        }));
        setSlots((was) => (sameSlots(was, found) ? was : found));
      });
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return slots;
}

function send(body: unknown): Promise<Response> {
  return fetch(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
}

export default function GuideRuntime({ level, home, quietOn }: { level: string; home: string; quietOn: string }) {
  const path = usePathname();
  const [read, setRead] = useState<Read | null>(null);
  const [progress, setProgress] = useState<GuideProgress | null>(null);
  const [settings, setSettings] = useState<GuideSettings>(DEFAULT_GUIDE_SETTINGS);
  // The moment drawn, for the page it was drawn on: a new page leaves it behind without an effect setting state.
  const [shown, setShown] = useState<{ path: string; moment: GuideMoment } | null>(null);
  const moment = shown?.path === path ? shown.moment : null;
  const setMoment = useCallback((next: GuideMoment) => setShown(next ? { path: window.location.pathname, moment: next } : null), []);
  const [now, setNow] = useState(0);
  const [panel, setPanel] = useState(false);
  const [toast, setToast] = useState<GuideToast>(null);
  const [asked, setAsked] = useState<GuideAsk>(null);
  const pending = useRef(0);
  const arrived = useRef({ path, at: 0 });
  const decided = useRef<string | null>(null);
  const lastKey = useRef(0);
  const firstPath = useRef(path);
  const slots = useSlots();
  const [Drawn, setDrawn] = useState<Layer | null>(layer);

  // The record, once; the route marks found the place this first screen is in. Without it (signed out, the network gone) Guide draws nothing.
  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}?place=${encodeURIComponent(level)}&path=${encodeURIComponent(firstPath.current)}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Read>) : null))
      .then(
        (got) => {
          if (!live || !got) return;
          setRead(got);
          setProgress(got.progress);
          setSettings(got.settings);
          setNow(Date.now());
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [level]);

  const dispatch = useCallback(
    (event: GuideEvent) => {
      setProgress((p) => (p ? applyGuideEvent(p, event, new Date().toISOString()) : p));
      pending.current += 1;
      send({ place: level, event })
        .then((response) => (response.ok ? (response.json() as Promise<{ progress: GuideProgress }>) : null))
        .then(
          (kept) => {
            pending.current -= 1;
            // The route's record wins once nothing else is on its way, so both hold the same.
            if (kept && pending.current === 0) setProgress(kept.progress);
          },
          () => {
            pending.current -= 1;
          },
        );
    },
    [level],
  );

  const saveSettings = useCallback((next: GuideSettings) => {
    setSettings(next);
    send({ settings: next }).catch(() => undefined);
  }, []);

  // Keys pressed anywhere: Guide waits a moment after the last.
  useEffect(() => {
    const typed = () => (lastKey.current = Date.now());
    window.addEventListener("keydown", typed, true);
    return () => window.removeEventListener("keydown", typed, true);
  }, []);

  // A new page: a new visit, and the place reached is found (the first screen's by the route's read).
  const ready = progress !== null;
  useEffect(() => {
    arrived.current = { path, at: Date.now() };
    decided.current = null;
    if (!ready || !read || !progress) return;
    const here = placeAt(read.places, path);
    const timer = window.setTimeout(() => {
      // An ask is for the page it leads to: a person who went elsewhere instead has it put away.
      setAsked((ask) => {
        if (!ask) return ask;
        const target = ask.place === WELCOME || read.places.some((p) => p.key === ask.place && p.welcome) ? path === home : here?.key === ask.place;
        return target ? ask : null;
      });
      if (path === firstPath.current) return;
      if (here && !progress.found.includes(here.key)) dispatch({ type: "found", place: here.key });
      if (path.startsWith(`${home}/assistant`) && !progress.found.includes("ai")) dispatch({ type: "found", place: "ai" });
    }, 0);
    return () => window.clearTimeout(timer);
    // Only the address decides a visit; the record changing on the way is not a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ready]);

  // Whether a moment may be shown now, and which; checked until the page is calm, once per visit.
  useEffect(() => {
    if (!read || !progress || moment || panel || decided.current === path) return;
    const quiet = new RegExp(quietOn);
    const candidate = guideMoment(read.places, home, settings, progress, { path, calm: true, phone: window.matchMedia(PHONE).matches, now: Date.now() }, asked);
    if (!candidate) return;
    const settle = candidate.kind === "spotlight" ? SPOTLIGHT_SETTLE_MS : candidate.open ? 0 : BEACON_SETTLE_MS;
    const calm = () => {
      const at = Date.now();
      if (document.visibilityState !== "visible" || quiet.test(path)) return false;
      if (at - arrived.current.at < settle || at - lastKey.current < QUIET_AFTER_TYPING_MS) return false;
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
  }, [read, progress, settings, home, path, asked, moment, panel, quietOn, dispatch, setMoment]);

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

  // What it shows, loaded once there is something to draw.
  const needed = Boolean(moment || panel || toast);
  useEffect(() => {
    if (!needed || Drawn) return;
    loadLayer().then(setDrawn, () => undefined);
  }, [needed, Drawn]);

  if (!read || !progress) return null;
  const { found, total } = guideTally(read.places, progress);
  const shownState = { found, total, button: read.words.button, panel, setPanel };
  const hints = kindOn("hint", settings, progress, now) ? read.words.hints : null;
  const state: GuideState = {
    now,
    progress,
    settings,
    places: read.places,
    home,
    platform: level === "platform",
    words: read.words,
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
    <>
      {slots.map((slot, i) =>
        slot.name === "rail"
          ? createPortal(<GuideRailButton shown={shownState} />, slot.el, `rail-${i}`)
          : slot.name === "menu"
            ? createPortal(<GuideMenuLink shown={shownState} href={home} />, slot.el, `menu-${i}`)
            : slot.name === "hint" && slot.place && hints
              ? createPortal(<GuideHint place={slot.place} hints={hints} />, slot.el, `hint-${i}`)
              : null,
      )}
      {needed && Drawn && (
        <GuideContext value={state}>
          <Drawn.GuideLayer />
        </GuideContext>
      )}
    </>
  );
}
