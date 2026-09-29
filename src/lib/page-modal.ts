import { z } from "zod";

import { consentCookieName, decodeConsent } from "./cookie-consent";
import { slugify } from "./slug";

/**
 * Modals (D121): a row of a page with a *Modal* setting. Its columns and
 * blocks are the modal's content, built with the ordinary builder, so every
 * component, form, picture and video works inside it. On the site the row is
 * taken out of the page's flow and drawn in a native `<dialog>` that opens
 * by a link or a class, a timer or exit intent (`src/components/page-modal.tsx`).
 * A modal row in a footer or header is on every page of the site. This file
 * is the pure part, shared by the site, the builder and the tests.
 */

// ---------------------------------------------------------------------------
// The setting
// ---------------------------------------------------------------------------

export const MODAL_SIZES = {
  sm: { label: "Small", width: "24rem" },
  md: { label: "Medium", width: "36rem" },
  lg: { label: "Large", width: "56rem" },
  full: { label: "Almost the whole screen", width: "100vw" },
} as const;
export type ModalSize = keyof typeof MODAL_SIZES;
export const MODAL_SIZE_KEYS = Object.keys(MODAL_SIZES) as [ModalSize, ...ModalSize[]];

/** How dark the page behind is dimmed, as the share of black. */
export const MODAL_OVERLAYS = {
  light: { label: "Light", dim: 0.25 },
  medium: { label: "Medium", dim: 0.5 },
  strong: { label: "Strong", dim: 0.75 },
} as const;
export type ModalOverlay = keyof typeof MODAL_OVERLAYS;
export const MODAL_OVERLAY_KEYS = Object.keys(MODAL_OVERLAYS) as [ModalOverlay, ...ModalOverlay[]];

export const MODAL_POSITIONS = { center: "Centre", bottom: "Bottom" } as const;
export type ModalPosition = keyof typeof MODAL_POSITIONS;

export const MODAL_FREQUENCIES = {
  always: "Every time the page is shown",
  session: "Once per visit (until the browser is closed)",
  days: "Once every number of days",
} as const;
export type ModalFrequency = keyof typeof MODAL_FREQUENCIES;

export const MODAL_KEY_MAX = 40;
export const MODAL_NAME_MAX = 60;
export const MODAL_CLASS_MAX = 40;
export const MODAL_SECONDS_MIN = 1;
export const MODAL_SECONDS_MAX = 600;
export const MODAL_DAYS_MIN = 1;
export const MODAL_DAYS_MAX = 365;

export type ModalTriggers = {
  /** A link to `#modal-{key}` anywhere on the site opens it. */
  button?: boolean;
  /** Any element with this class opens it when pressed. */
  className?: string;
  /** The pointer leaves the top of the window (touch: a quick scroll up after scrolling down). */
  exitIntent?: boolean;
  /** Opens by itself this many seconds after the page is shown. */
  timer?: { seconds: number };
};

/** A row's modal setting; a row without it is an ordinary row. */
export type RowModal = {
  /** Its address name: the modal is `#modal-{key}`; unique among a page's rows. */
  key: string;
  /** For the builder only. */
  name?: string;
  triggers: ModalTriggers;
  frequency: ModalFrequency;
  /** With `frequency` "days": how many. */
  days?: number;
  size: ModalSize;
  position?: ModalPosition;
  overlay?: ModalOverlay;
  /** A click outside it closes it: on unless `false`. */
  closeOnOverlay?: boolean;
  /** A visible close button: on unless `false`. Escape always closes. */
  closeButton?: boolean;
};

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CLASS_TOKEN = /^[a-z][a-z0-9_-]{0,39}$/i;

/** Why a key cannot be used, or null. */
export function keyProblem(key: string): string | null {
  if (key.length === 0) return "Give the modal an address name.";
  if (key.length > MODAL_KEY_MAX) return `Keep the address name to ${MODAL_KEY_MAX} characters or fewer.`;
  if (!KEY.test(key))
    return "The address name uses lower-case letters, digits and single dashes, like newsletter or summer-sale.";
  return null;
}

/** Why a class name cannot open a modal, or null. One class, not a list. */
export function classProblem(name: string): string | null {
  if (name.length === 0) return null;
  if (/\s/.test(name)) return "Write one class name, without spaces.";
  if (!CLASS_TOKEN.test(name)) {
    return `A class name starts with a letter and has letters, digits, dashes and underscores, up to ${MODAL_CLASS_MAX} characters.`;
  }
  return null;
}

export const NO_WAY_TO_OPEN =
  "Choose at least one way to open the modal: a button or link, a class, exit intent or a timer.";
export const NO_WAY_TO_CLOSE =
  "A modal needs a way to close it besides Escape: keep the close button, or let a click outside close it.";

/** Whether a modal has something that opens it. */
export const hasTrigger = (triggers: ModalTriggers): boolean =>
  Boolean(triggers.button || triggers.className || triggers.exitIntent || triggers.timer);

/** Every reason a modal setting is refused, in the order the builder shows them. */
export function modalProblems(modal: RowModal): string[] {
  const problems: string[] = [];
  const key = keyProblem(modal.key);
  if (key) problems.push(key);
  if (modal.triggers.className) {
    const name = classProblem(modal.triggers.className);
    if (name) problems.push(name);
  }
  if (!hasTrigger(modal.triggers)) problems.push(NO_WAY_TO_OPEN);
  if (modal.frequency === "days" && !(modal.days && modal.days >= MODAL_DAYS_MIN && modal.days <= MODAL_DAYS_MAX)) {
    problems.push(`Choose between ${MODAL_DAYS_MIN} and ${MODAL_DAYS_MAX} days.`);
  }
  if (modal.closeButton === false && modal.closeOnOverlay === false) problems.push(NO_WAY_TO_CLOSE);
  return problems;
}

/** Empty text is the same as none. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

/** What the editor sends and the site reads (`pageRowSchema`), with the checks shown to the admin. */
export const rowModalSchema = z
  .object({
    key: z
      .string()
      .trim()
      .superRefine((key, ctx) => {
        const problem = keyProblem(key);
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      }),
    name: optional(
      z.string().trim().max(MODAL_NAME_MAX, `Keep the modal's name to ${MODAL_NAME_MAX} characters or fewer.`),
    ),
    triggers: z.object({
      button: z.boolean().optional(),
      className: optional(
        z
          .string()
          .trim()
          .superRefine((name, ctx) => {
            const problem = classProblem(name);
            if (problem) ctx.addIssue({ code: "custom", message: problem });
          }),
      ),
      exitIntent: z.boolean().optional(),
      timer: z
        .object({
          seconds: z
            .number()
            .int("The timer is whole seconds.")
            .min(MODAL_SECONDS_MIN, `The timer is at least ${MODAL_SECONDS_MIN} second.`)
            .max(MODAL_SECONDS_MAX, `The timer is at most ${MODAL_SECONDS_MAX} seconds.`),
        })
        .optional(),
    }),
    frequency: z.enum(Object.keys(MODAL_FREQUENCIES) as [ModalFrequency, ...ModalFrequency[]]),
    days: z
      .number()
      .int("Days are whole days.")
      .min(MODAL_DAYS_MIN, `Choose between ${MODAL_DAYS_MIN} and ${MODAL_DAYS_MAX} days.`)
      .max(MODAL_DAYS_MAX, `Choose between ${MODAL_DAYS_MIN} and ${MODAL_DAYS_MAX} days.`)
      .optional(),
    size: z.enum(MODAL_SIZE_KEYS),
    position: z.enum(Object.keys(MODAL_POSITIONS) as [ModalPosition, ...ModalPosition[]]).optional(),
    overlay: z.enum(MODAL_OVERLAY_KEYS).optional(),
    closeOnOverlay: z.boolean().optional(),
    closeButton: z.boolean().optional(),
  })
  .superRefine((modal, ctx) => {
    if (!hasTrigger(modal.triggers)) ctx.addIssue({ code: "custom", message: NO_WAY_TO_OPEN });
    if (modal.frequency === "days" && modal.days === undefined) {
      ctx.addIssue({ code: "custom", message: `Choose between ${MODAL_DAYS_MIN} and ${MODAL_DAYS_MAX} days.` });
    }
    if (modal.closeButton === false && modal.closeOnOverlay === false)
      ctx.addIssue({ code: "custom", message: NO_WAY_TO_CLOSE });
  });

/** A new modal setting: opened by a button or link, once per visit when it opens by itself. */
export const newModal = (key: string): RowModal => ({
  key,
  triggers: { button: true },
  frequency: "session",
  size: "md",
});

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/** The modal's id in the page: the address `#modal-{key}` points at. */
export const modalDomId = (key: string) => `modal-${key}`;
export const modalHash = (key: string) => `#${modalDomId(key)}`;

const HASH = /^#modal-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The modal a hash names (`#modal-promo` → `promo`), or null. */
export function keyFromHash(hash: string | null | undefined): string | null {
  const found = HASH.exec(hash ?? "");
  return found && found[1].length <= MODAL_KEY_MAX ? found[1] : null;
}

/**
 * The modal a link opens: a link to `#modal-{key}` on this page, written as
 * just the hash or as the page's own address with it.
 */
export function keyFromLink(
  href: string | null | undefined,
  here: { origin: string; pathname: string; search: string },
): string | null {
  if (!href) return null;
  if (href.startsWith("#")) return keyFromHash(href);
  try {
    const url = new URL(href, here.origin + here.pathname + here.search);
    return url.origin === here.origin && url.pathname === here.pathname && url.search === here.search
      ? keyFromHash(url.hash)
      : null;
  } catch {
    return null;
  }
}

/** A key from a name: `Summer sale!` → `summer-sale`. */
export const slugifyKey = (name: string): string => slugify(name, MODAL_KEY_MAX) || "modal";

/** `base`, else `base-2`, `base-3` … the first not taken. */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const next = `${base.slice(0, MODAL_KEY_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!used.has(next)) return next;
  }
}

type RowWithModal = { modal?: RowModal };

/** The rows that are modals. */
export const modalRows = <T extends RowWithModal>(rows: readonly T[]): T[] => rows.filter((row) => row.modal);
/** The rows that are drawn in the page's flow: a modal's are not. */
export const flowRows = <T extends RowWithModal>(rows: readonly T[]): T[] => rows.filter((row) => !row.modal);

/** A key used by more than one modal row, if any. */
export function repeatedModalKey(rows: readonly RowWithModal[]): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.modal) continue;
    if (seen.has(row.modal.key)) return row.modal.key;
    seen.add(row.modal.key);
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the builder shows
// ---------------------------------------------------------------------------

/** The ways a modal opens, in words: `timer 5 s, button, class .promo, exit intent`. */
export function triggerWords(triggers: ModalTriggers): string[] {
  return [
    triggers.timer && `timer ${triggers.timer.seconds} s`,
    triggers.button && "button",
    triggers.className && `class .${triggers.className}`,
    triggers.exitIntent && "exit intent",
  ].filter((word): word is string => Boolean(word));
}

/** The badge on a modal row in the builder's canvas. */
export function modalSummary(modal: RowModal): string {
  const ways = triggerWords(modal.triggers);
  return `Modal · ${modal.name?.trim() || modal.key} · ${ways.length > 0 ? `opens by ${ways.join(", ")}` : "nothing opens it yet"}`;
}

// ---------------------------------------------------------------------------
// When it opens by itself
// ---------------------------------------------------------------------------

/** The triggers that open a modal without the visitor asking. */
export const autoTriggers = (modal: RowModal): ("timer" | "exitIntent")[] => [
  ...(modal.triggers.timer ? (["timer"] as const) : []),
  ...(modal.triggers.exitIntent ? (["exitIntent"] as const) : []),
];
export const hasAutoTriggers = (modal: RowModal): boolean => autoTriggers(modal).length > 0;

/** Nothing opens by itself in the first second. */
export const AUTO_MIN_MS = 1000;
/** Exit intent only counts after the visitor has been on the page this long. */
export const EXIT_INTENT_MIN_MS = 3000;

/** The working pages, where nothing pops up by itself: the shopper is buying or signing in. */
const WORKING_PATHS = new Set([
  "cart",
  "checkout",
  "order",
  "account",
  "wishlist",
  "subscription",
  "deliveries",
  "unsubscribe",
  "download",
  "sign-in",
  "sign-up",
  "forgot-password",
]);

export const isWorkingPath = (pathname: string): boolean =>
  pathname.split("/").some((segment) => WORKING_PATHS.has(segment));

/**
 * Whether a modal may open by itself here: not in the builder, not on a
 * store's working page (the page knows its route; a footer's modal reads the
 * address instead).
 */
export function autoAllowed({
  pathname,
  route = false,
  inAdmin = false,
}: {
  pathname: string;
  route?: boolean;
  inAdmin?: boolean;
}): boolean {
  return !inAdmin && !route && !isWorkingPath(pathname);
}

// ---------------------------------------------------------------------------
// Remembering that it was closed
// ---------------------------------------------------------------------------

/** What a modal closed by the visitor is remembered as: in the tab's session storage, or (for days) local storage. */
export const MODAL_STORAGE_PREFIX = "kaizen_modal_";
export const modalStorageName = (key: string) => `${MODAL_STORAGE_PREFIX}${key}`;

export type KeyValue = { getItem(name: string): string | null; setItem(name: string, value: string): void };
/** The browser's storages, either of which may be missing or refuse. */
export type ModalMemory = { session: KeyValue | null; local: KeyValue | null };

const DAY_MS = 86_400_000;

function read(store: KeyValue | null, name: string): string | null {
  try {
    return store?.getItem(name) ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a modal may open by itself: not while it was closed in this visit
 * (frequency `session`) or within its days (`days`), and not if it was
 * closed since the page was loaded and nothing could be remembered (`closed`).
 * Opened by a link or a class it is never held back: that is not asked here.
 */
export function shouldAutoOpen(
  modal: RowModal,
  state: { memory: ModalMemory; now: number; closed?: boolean },
): boolean {
  if (!hasAutoTriggers(modal)) return false;
  if (modal.frequency === "always") return true;
  if (state.closed) return false;
  const name = modalStorageName(modal.key);
  if (modal.frequency === "session") return read(state.memory.session, name) === null;
  const closedAt = Number(read(state.memory.local, name));
  if (!Number.isFinite(closedAt) || closedAt <= 0) return true;
  return closedAt + (modal.days ?? MODAL_DAYS_MIN) * DAY_MS <= state.now;
}

/** Whether closing a modal is remembered at all: it opens by itself, and is not shown every time. */
export const remembersClose = (modal: RowModal): boolean => modal.frequency !== "always" && hasAutoTriggers(modal);

/**
 * Remembers that the visitor closed a modal. Returns whether anything was
 * written: only when the frequency asks for it and the visitor allowed
 * preferences (`allowed`); else it is kept for this page load only.
 */
export function rememberClose(modal: RowModal, state: { memory: ModalMemory; now: number; allowed: boolean }): boolean {
  if (!remembersClose(modal) || !state.allowed) return false;
  const store = modal.frequency === "session" ? state.memory.session : state.memory.local;
  if (!store) return false;
  try {
    store.setItem(modalStorageName(modal.key), modal.frequency === "session" ? "1" : String(state.now));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the visitor allowed preferences on this site (D58): read from the
 * consent cookie. A remembered closing is a preference, so nothing is kept
 * without it.
 */
export function mayRemember(cookies: string, storeId: string | null): boolean {
  const name = consentCookieName(storeId);
  const pair = cookies.split("; ").find((cookie) => cookie.startsWith(`${name}=`));
  return decodeConsent(pair?.slice(name.length + 1))?.choices.preferences === true;
}

// ---------------------------------------------------------------------------
// Exit intent
// ---------------------------------------------------------------------------

/**
 * The pointer left the window through the top (a `mouseout` from the
 * document with nothing entered, at the top edge), after the visitor had
 * been on the page a while.
 */
export function isExitIntent(event: { clientY: number; relatedTarget: unknown }, elapsedMs: number): boolean {
  return event.relatedTarget === null && event.clientY <= 0 && elapsedMs >= EXIT_INTENT_MIN_MS;
}

/** How deep a visitor must have scrolled, and how fast and far back up, for the touch alternative. */
export const SCROLL_DEPTH = 0.3;
export const SCROLL_UP_PX = 200;
export const SCROLL_UP_MS = 600;

export type ScrollIntentState = {
  /** The deepest scroll position so far. */
  max: number;
  /** The last position and time. */
  last: { y: number; t: number } | null;
  /** Where and when the scroll last turned from down to up. */
  peak: { y: number; t: number } | null;
};
export const NO_SCROLL: ScrollIntentState = { max: 0, last: null, peak: null };

/**
 * Touch screens have no exit intent. What comes closest: after scrolling
 * down at least 30% of the page, a quick scroll up (200 px within 0.6 s).
 * One scroll sample in, the new state and whether that was it out.
 */
export function stepScrollIntent(
  state: ScrollIntentState,
  sample: { y: number; t: number; scrollable: number },
): { state: ScrollIntentState; fire: boolean } {
  const max = Math.max(state.max, sample.y);
  const last = state.last;
  // Going down (or the first sample) moves the turning point along.
  if (!last || sample.y >= last.y) {
    return { state: { max, last: { y: sample.y, t: sample.t }, peak: { y: sample.y, t: sample.t } }, fire: false };
  }
  const peak = state.peak ?? last;
  const deep = sample.scrollable > 0 && max / sample.scrollable >= SCROLL_DEPTH;
  const fire = deep && peak.y - sample.y >= SCROLL_UP_PX && sample.t - peak.t <= SCROLL_UP_MS;
  return { state: { max, last: { y: sample.y, t: sample.t }, peak }, fire };
}
