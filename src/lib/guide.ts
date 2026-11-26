/**
 * Guide (D909, `docs/rules/admin/platform.md`, the canvas "Onboarding Guide Wizard"): the admin shows a person around where they already
 * are, a little at a time. Pure: the places, the pace and the record of what was shown, read the same in the browser (which decides what to
 * show now) and on the server (which keeps the record, `src/server/guide.ts`).
 *
 * Three ways to speak up, loudest first, each with its budget:
 * - a spotlight dims the page around one place and explains it in a card: the welcome on Home (the rail, the next step, the AI manager), at
 *   most one a day, and never two in one visit;
 * - a beacon is a small dot beside a page's title on the first visits to a section; it opens its card only when pressed and fades after
 *   `BEACON_FADES_AFTER` visits not pressed;
 * - a hint is a line inside an empty page (`GuideSlot name="hint"`, drawn by `GuideHint`), part of the page, costing nothing.
 *
 * Guide never speaks while the person types, holds unsaved work, has just arrived, or is in a focus task (the browser's signals, `calm`).
 * "Later" twice and that kind of moment stops by itself (`LATER_STOPS_AFTER`). With no level chosen, Guide is Balanced for its first
 * `AUTO_QUIET_DAYS` days and Quiet after. Whatever it did not say waits in the Guide panel, where everything is one press away.
 */

export const GUIDE_LEVELS = ["quiet", "balanced", "handson"] as const;
export type GuideLevel = (typeof GUIDE_LEVELS)[number];

/** The kinds a person can switch off one by one (Customise). */
export const GUIDE_KINDS = ["spotlight", "beacon", "hint"] as const;
export type GuideKind = (typeof GUIDE_KINDS)[number];

/** The kinds that interrupt, which "Later" counts against. */
export type GuideLoudKind = Exclude<GuideKind, "hint">;

/** With no level chosen, Guide turns itself to Quiet after this many days. */
export const AUTO_QUIET_DAYS = 14;
/** One spotlight a day: the least time between two that Guide starts by itself (Hands-on has no such wait). */
export const SPOTLIGHT_GAP_MS = 20 * 60 * 60 * 1000;
/** A beacon not pressed on this many visits fades into the panel. */
export const BEACON_FADES_AFTER = 3;
/** "Later" this many times and that kind stops starting by itself. */
export const LATER_STOPS_AFTER = 2;
/** How long a page is open before Guide may start a spotlight, and a beacon. */
export const SPOTLIGHT_SETTLE_MS = 1500;
export const BEACON_SETTLE_MS = 3000;
/** Quiet for this long after the last key pressed. */
export const QUIET_AFTER_TYPING_MS = 4000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The welcome's steps on a level's Home, in order, and where each points (the first selector found on the page wins). */
export const WELCOME_STEPS = ["rail", "todo", "ai"] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];
export const WELCOME_TARGETS: Record<WelcomeStep, readonly string[]> = {
  rail: ["[data-admin-rail]"],
  todo: ["[data-next-up]", '[data-guide="todo"]'],
  ai: ['[data-guide="ask"]', '[data-guide="ai"]'],
};
export const WELCOME = "welcome";

/** A beacon's moment key: one per place. */
export const beaconKey = (place: string) => `beacon:${place}`;

/** The person's own choice, kept on their account: a level (null: automatic) and the kinds switched off. */
export type GuideSettings = { level: GuideLevel | null; off: GuideKind[] };
export const DEFAULT_GUIDE_SETTINGS: GuideSettings = { level: null, off: [] };

/** What happened to one moment: how many visits a beacon was drawn on, and whether it is done (pressed, finished or put away). */
export type MomentState = { seen?: number; done?: boolean };

/** The record for one person at one level (a store, or the platform): kept as one jsonb value. */
export type GuideProgress = {
  startedAt: string;
  found: string[];
  moments: Record<string, MomentState>;
  later: Partial<Record<GuideLoudKind, number>>;
  lastSpotlightAt: string | null;
};

/**
 * A place Guide knows: a welcome step on Home or a section of the level. `within` are the addresses that count as being there (a section's
 * tab and its sidebar's prefixes); `core` places get a beacon in Balanced, every place in Hands-on.
 */
export type GuidePlace = {
  key: string;
  label: string;
  what: string;
  href: string;
  within: string[];
  exact?: boolean;
  /** The section's everyday pages, named on the beacon's card ("Also here"). */
  also: string[];
  welcome?: WelcomeStep;
  core?: boolean;
};

export type GuideEvent =
  | { type: "found"; place: string }
  | { type: "seen"; moment: string }
  | { type: "spotlight"; moment: string }
  | { type: "done"; moment: string }
  | { type: "later"; moment: string; kind: GuideLoudKind }
  | { type: "replay"; moment: string }
  | { type: "restart" };

/** What Guide shows now: the welcome from a step on, or one place's beacon (`open` when asked for from the panel). */
export type GuideMoment = { kind: "spotlight"; key: typeof WELCOME; steps: WelcomeStep[] } | { kind: "beacon"; key: string; place: string; open: boolean } | null;

/** A place asked for from the panel ("Show me"), or the whole welcome (`WELCOME`, "Replay"): shown on arrival, whatever the budget. */
export type GuideAsk = { place: string } | null;

/** The browser's facts at this moment. `calm`: no typing, no unsaved work, settled on the page, not a focus task. */
export type GuideSignals = { path: string; calm: boolean; phone: boolean; now: number };

const KEY = /^[a-z0-9][a-z0-9:_-]{0,47}$/;
const MAX_KEYS = 80;

const isLevel = (value: unknown): value is GuideLevel => typeof value === "string" && (GUIDE_LEVELS as readonly string[]).includes(value);
const isKey = (value: unknown): value is string => typeof value === "string" && KEY.test(value);
const count = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, 99) : undefined);
const iso = (value: unknown): string | null => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);

/** The stored columns as settings: anything unknown left out. */
export function guideSettingsOf(level: unknown, off: unknown): GuideSettings {
  return { level: isLevel(level) ? level : null, off: Array.isArray(off) ? GUIDE_KINDS.filter((kind) => off.includes(kind)) : [] };
}

/** A fresh record, started now. */
export const newGuideProgress = (now: string): GuideProgress => ({ startedAt: now, found: [], moments: {}, later: {}, lastSpotlightAt: null });

/** The stored jsonb as a record: unknown keys and values dropped, a missing start set to `now` (the first read). */
export function guideProgressOf(stored: unknown, now: string): GuideProgress {
  const s = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const moments: Record<string, MomentState> = {};
  if (s.moments && typeof s.moments === "object" && !Array.isArray(s.moments)) {
    for (const [key, value] of Object.entries(s.moments as Record<string, unknown>).slice(0, MAX_KEYS)) {
      if (!isKey(key) || !value || typeof value !== "object") continue;
      const m = value as Record<string, unknown>;
      const seen = count(m.seen);
      moments[key] = { ...(seen && { seen }), ...(m.done === true && { done: true }) };
    }
  }
  const later: GuideProgress["later"] = {};
  if (s.later && typeof s.later === "object") {
    for (const kind of ["spotlight", "beacon"] as const) {
      const n = count((s.later as Record<string, unknown>)[kind]);
      if (n) later[kind] = n;
    }
  }
  return {
    startedAt: iso(s.startedAt) ?? now,
    found: Array.isArray(s.found) ? [...new Set(s.found.filter(isKey))].slice(0, MAX_KEYS) : [],
    moments,
    later,
    lastSpotlightAt: iso(s.lastSpotlightAt),
  };
}

/** A sent event, checked: null for anything else. */
export function guideEventOf(value: unknown): GuideEvent | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  switch (e.type) {
    case "found":
      return isKey(e.place) ? { type: "found", place: e.place } : null;
    case "seen":
    case "spotlight":
    case "done":
    case "replay":
      return isKey(e.moment) ? { type: e.type, moment: e.moment } : null;
    case "later":
      return isKey(e.moment) && (e.kind === "spotlight" || e.kind === "beacon") ? { type: "later", moment: e.moment, kind: e.kind } : null;
    case "restart":
      return { type: "restart" };
    default:
      return null;
  }
}

const withMoment = (p: GuideProgress, key: string, change: (m: MomentState) => MomentState): GuideProgress =>
  key in p.moments || Object.keys(p.moments).length < MAX_KEYS ? { ...p, moments: { ...p.moments, [key]: change(p.moments[key] ?? {}) } } : p;

/** The record after an event. The browser applies it at once and the server again, so both hold the same. */
export function applyGuideEvent(p: GuideProgress, event: GuideEvent, now: string): GuideProgress {
  switch (event.type) {
    case "found":
      return p.found.includes(event.place) || p.found.length >= MAX_KEYS ? p : { ...p, found: [...p.found, event.place] };
    case "seen":
      return withMoment(p, event.moment, (m) => ({ ...m, seen: Math.min((m.seen ?? 0) + 1, 99) }));
    case "spotlight":
      return { ...p, lastSpotlightAt: now };
    case "done":
      return withMoment(p, event.moment, (m) => ({ ...m, done: true }));
    case "later":
      return { ...withMoment(p, event.moment, (m) => ({ ...m, done: true })), later: { ...p.later, [event.kind]: Math.min((p.later[event.kind] ?? 0) + 1, 99) } };
    case "replay":
      return withMoment(p, event.moment, () => ({}));
    case "restart":
      return newGuideProgress(now);
  }
}

/** The day of Guide this is for the person: 1 on the day it started. */
export const guideDay = (p: GuideProgress, now: number): number => Math.max(1, Math.floor((now - Date.parse(p.startedAt)) / DAY_MS) + 1);

/** The level in force: the person's own, or Balanced for the first days and Quiet after. */
export function effectiveLevel(settings: GuideSettings, p: GuideProgress, now: number): GuideLevel {
  if (settings.level) return settings.level;
  return guideDay(p, now) > AUTO_QUIET_DAYS ? "quiet" : "balanced";
}

/** Whether a kind may start by itself: not switched off, allowed by the level, and not put away "Later" too often. */
export function kindOn(kind: GuideKind, settings: GuideSettings, p: GuideProgress, now: number): boolean {
  if (settings.off.includes(kind)) return false;
  if (kind === "hint") return true;
  if (effectiveLevel(settings, p, now) === "quiet") return false;
  return (p.later[kind] ?? 0) < LATER_STOPS_AFTER;
}

/** Whether a path is inside an address: the address itself or a page below it. */
const inside = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The section place the page is in (the deepest match), or undefined on Home and pages of no section. */
export function placeAt(places: readonly GuidePlace[], path: string): GuidePlace | undefined {
  let best: { place: GuidePlace; length: number } | undefined;
  for (const place of places) {
    if (place.welcome) continue;
    for (const prefix of place.within) {
      const hit = place.exact && prefix === place.href ? path === prefix : inside(path, prefix);
      if (hit && (!best || prefix.length > best.length)) best = { place, length: prefix.length };
    }
  }
  return best?.place;
}

/** The welcome's steps from `from` on, or all of them. */
const stepsFrom = (places: readonly GuidePlace[], from?: WelcomeStep): WelcomeStep[] =>
  from ? [from] : WELCOME_STEPS.filter((step) => places.some((place) => place.welcome === step));

/**
 * What Guide shows now, if anything (the pace above). `home` is the level's Home address, where the welcome is. An `ask` from the panel is
 * shown once the page is calm, whatever the level, budget or "Later"s: the person asked.
 */
export function guideMoment(places: readonly GuidePlace[], home: string, settings: GuideSettings, p: GuideProgress, signals: GuideSignals, ask: GuideAsk): GuideMoment {
  if (!signals.calm) return null;
  const here = placeAt(places, signals.path);
  if (ask) {
    if (ask.place === WELCOME && signals.path === home) return { kind: "spotlight", key: WELCOME, steps: stepsFrom(places) };
    const asked = places.find((place) => place.key === ask.place);
    if (asked?.welcome && signals.path === home) return { kind: "spotlight", key: WELCOME, steps: stepsFrom(places, asked.welcome) };
    if (asked && here?.key === asked.key) return { kind: "beacon", key: beaconKey(asked.key), place: asked.key, open: true };
    // Asked for elsewhere: nothing else is shown on the way there.
    return null;
  }
  if (signals.phone) return null;
  const level = effectiveLevel(settings, p, signals.now);
  if (level === "quiet") return null;
  if (signals.path === home) {
    const rested = level === "handson" || !p.lastSpotlightAt || signals.now - Date.parse(p.lastSpotlightAt) >= SPOTLIGHT_GAP_MS;
    if (!p.moments[WELCOME]?.done && rested && kindOn("spotlight", settings, p, signals.now)) return { kind: "spotlight", key: WELCOME, steps: stepsFrom(places) };
    return null;
  }
  if (!here || !kindOn("beacon", settings, p, signals.now) || (level !== "handson" && !here.core)) return null;
  const m = p.moments[beaconKey(here.key)];
  if (m?.done || (m?.seen ?? 0) >= BEACON_FADES_AFTER) return null;
  return { kind: "beacon", key: beaconKey(here.key), place: here.key, open: false };
}

/** How many of the places the person has found, and the first one left, in the panel's order. */
export function guideTally(places: readonly GuidePlace[], p: GuideProgress): { found: number; total: number; next: GuidePlace | undefined } {
  const found = places.filter((place) => p.found.includes(place.key)).length;
  return { found, total: places.length, next: places.find((place) => !p.found.includes(place.key)) };
}

/**
 * A level's places: the welcome's three on Home, then each section the person's menu offers, in the menu's order. `sections` are the
 * level's tabs with their key (`NavItem.section`) and the sidebar's prefixes and everyday pages; `words` give each its line, and a section
 * with no line of its own takes the menu's intro (`fallback`).
 */
export function guidePlaces({
  home,
  sections,
  words,
  core,
  welcome = WELCOME_STEPS,
}: {
  home: string;
  /** The welcome's steps this person's Home has (no AI manager for a member without it, no next step on the platform's). */
  welcome?: readonly WelcomeStep[];
  sections: readonly { key: string; href: string; label: string; exact?: boolean; within: readonly string[]; also: readonly string[]; fallback?: string }[];
  words: { welcome: Record<WelcomeStep, { label: string; what: string }>; places: Partial<Record<string, string>> };
  core: readonly string[];
}): GuidePlace[] {
  return [
    ...welcome.map((step) => ({ key: step, label: words.welcome[step].label, what: words.welcome[step].what, href: home, within: [], also: [], welcome: step })),
    ...sections
      .filter((s) => isKey(s.key))
      .map((s) => ({
        key: s.key,
        label: s.label,
        what: words.places[s.key] ?? s.fallback ?? "",
        href: s.href,
        within: [...new Set([s.href, ...s.within])],
        ...(s.exact && { exact: true }),
        also: s.also.slice(0, 3),
        ...(core.includes(s.key) && { core: true }),
      })),
  ];
}

/** The store's sections that get a beacon in Balanced; the rest wait for Hands-on or the panel. */
export const STORE_CORE_PLACES = ["orders", "products", "customers", "marketing", "website", "settings"] as const;
/** The platform's. */
export const PLATFORM_CORE_PLACES = ["stores", "plans", "requests", "website", "support", "settings"] as const;

/**
 * A level's places from its menu as the frame draws it (`tabs` and `areas`, labels already in the person's language): each section's tab,
 * the addresses its sidebar holds, and its everyday pages (those not `advanced`) for the beacon's "Also here". Home is no place; the
 * welcome's three stand for it.
 */
export function guidePlacesFromNav({
  home,
  tabs,
  areas,
  words,
  intros,
  core,
  welcome,
}: {
  home: string;
  welcome?: readonly WelcomeStep[];
  tabs: readonly { href: string; label: string; section?: string; exact?: boolean; home?: true }[];
  areas: readonly { section?: string; prefixes: readonly string[]; exact?: readonly string[]; groups: readonly { items: readonly { href: string; label: string; advanced?: boolean }[] }[] }[];
  words: { welcome: Record<WelcomeStep, { label: string; what: string }>; places: Partial<Record<string, string>> };
  intros: Partial<Record<string, string>>;
  core: readonly string[];
}): GuidePlace[] {
  const sections = tabs
    .filter((tab) => !tab.home && tab.section)
    .map((tab) => {
      const key = tab.section as string;
      const area = areas.find((a) => a.section === key);
      const items = area?.groups.flatMap((g) => g.items) ?? [];
      return {
        key,
        href: tab.href,
        label: tab.label,
        exact: tab.exact,
        within: [...(area?.prefixes ?? []), ...(area?.exact ?? [])],
        also: items.filter((item) => !item.advanced && item.href !== tab.href && item.label !== tab.label).map((item) => item.label),
        fallback: intros[key],
      };
    });
  return guidePlaces({ home, sections, words, core, welcome });
}
