"use client";

import { ChevronDown, ChevronRight, Ellipsis, Eye } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { foldOpen, keepFold, keepScroll, keepTab, newSettingsMemory, rememberedScroll, type SettingsMemory, type SettingsTab } from "@/lib/settings-memory";
import { readCopiedStyle, type CopiedStyle } from "@/lib/style-copy";
import { frameAtGlance, spacingAtGlance, typographyAtGlance, visibilityAtGlance, type SidesAtGlance } from "@/lib/settings-summary";
import { SIZES } from "@/lib/breakpoints";
import { adminDate } from "@/lib/admin-date";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import type { PartBase, Spacing } from "@/lib/page-content";
import type { TypographyGroups } from "@/lib/typography";
import type { BuilderMessages } from "@/lib/admin-messages/builder.en";
import { useAdminLang, useAdminText } from "./admin-text";
import { DeviceIcon, useSizeEdit } from "./responsive-edit";

/**
 * The parts of the page builder's settings panel that every row's, column's and component's settings share (D631): the memory it
 * keeps from one part to the next, folds that say their value while closed, the trail to the part's row and column, its menu of
 * actions, and the copied style.
 */

const MemoryContext = createContext<RefObject<SettingsMemory> | null>(null);

/** Around the builder's dialogs: one memory for every settings panel they open. */
export function SettingsMemoryProvider({ children }: { children: ReactNode }) {
  const memory = useRef<SettingsMemory>(newSettingsMemory());
  return <MemoryContext value={memory}>{children}</MemoryContext>;
}

function useMemory(): RefObject<SettingsMemory> {
  const shared = useContext(MemoryContext);
  const own = useRef<SettingsMemory>(newSettingsMemory());
  return shared ?? own;
}

/** The tab a settings panel opens on: the one the owner was last on, in any part's settings, unless `start` says another. */
export function useRememberedTab(start?: SettingsTab): [SettingsTab, (tab: SettingsTab) => void] {
  const memory = useMemory();
  const [tab, setTab] = useState<SettingsTab>(() => start ?? memory.current.tab);
  return [
    tab,
    (next) => {
      keepTab(memory.current, next);
      setTab(next);
    },
  ];
}

/**
 * Keeps how far the panel's body is scrolled for this kind of part and tab, and scrolls back there when such a tab opens. What
 * a tab holds can grow after it is drawn (pictures, fields fetched when first opened), so it keeps to the remembered depth as it
 * grows until the owner scrolls, presses or types, or a moment has passed.
 */
export function useRememberedScroll(kind: string, tab: SettingsTab, root: RefObject<HTMLElement | null>) {
  const memory = useMemory();
  useLayoutEffect(() => {
    const element = root.current;
    const body = element?.closest<HTMLElement>("[data-panel-body]");
    if (!element || !body) return;
    const target = rememberedScroll(memory.current, kind, tab);
    let restoring = true;
    const apply = () => {
      if (restoring) body.scrollTop = target;
    };
    apply();
    const frame = requestAnimationFrame(apply);
    const grown = new ResizeObserver(apply);
    grown.observe(element);
    const settle = window.setTimeout(() => {
      restoring = false;
    }, 800);
    const byOwner = () => {
      restoring = false;
    };
    const onScroll = () => {
      if (!restoring) keepScroll(memory.current, kind, tab, body.scrollTop);
    };
    const owner = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of owner) body.addEventListener(event, byOwner, { passive: true });
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      grown.disconnect();
      for (const event of owner) body.removeEventListener(event, byOwner);
      body.removeEventListener("scroll", onScroll);
    };
  }, [kind, tab, root, memory]);
}

/**
 * A group of settings behind one press, its current value written beside its name so the tab can be read closed. Open or
 * closed as the owner last left a fold of this name, in any part's settings. `quiet` is Advanced's: the last fold, in grey.
 */
export function Fold({
  id,
  title,
  summary,
  quiet = false,
  defaultOpen = false,
  children,
}: {
  /** The fold's name in the memory: the same group in every part's settings shares it. */
  id: string;
  title: string;
  summary?: ReactNode;
  quiet?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const memory = useMemory();
  const [open, setOpen] = useState(() => foldOpen(memory.current, id, defaultOpen));
  const body = useId();
  return (
    <div className="border-t border-line" data-fold={id}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={body}
        onClick={() => {
          keepFold(memory.current, id, !open);
          setOpen(!open);
        }}
        className="flex min-h-12 w-full items-center gap-3 text-left"
      >
        <span className={`shrink-0 text-sm ${quiet ? "text-muted" : "font-medium text-ink"}`}>{title}</span>
        <span className="ml-auto min-w-0 truncate text-right text-xs text-muted">{summary}</span>
        <ChevronDown aria-hidden className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        // The groups inside drew a line above themselves when they stood in the tab; the fold's own line is enough.
        <div id={body} className="flex flex-col gap-5 pb-5 pt-1 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0">
          {children}
        </div>
      )}
    </div>
  );
}

/** A tab's folds, under its open fields, with a line under the last. */
export function Folds({ children }: { children: ReactNode }) {
  return <div className="flex flex-col border-b border-line">{children}</div>;
}

/** One step of the trail: a row or column the part is in, which opens its settings. */
export type Crumb = { label: string; open: () => void };

/** Where the part is: its row and column (or the component it is in), each opening its own settings. */
export function PanelTrail({ crumbs }: { crumbs: Crumb[] }) {
  const w = useAdminText("builder").panel;
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label={w.trail} onPointerDown={(event) => event.stopPropagation()}>
      <ol className="flex flex-wrap items-center gap-0.5 text-xs text-muted">
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="flex items-center gap-0.5">
            {index > 0 && <ChevronRight aria-hidden className="size-3" />}
            <button type="button" onClick={crumb.open} className="min-h-6 cursor-pointer rounded px-1.5 hover:bg-sunken hover:text-ink">
              {crumb.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A line of the part's menu, or a line between its groups. */
export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; title?: string; danger?: boolean; icon?: ReactNode } | "line";

/** The part's actions behind ⋯: copy and paste its style, save it to use again, delete it. */
export function PartMenu({ items }: { items: MenuItem[] }) {
  const w = useAdminText("builder").panel;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const entries = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
  useEffect(() => {
    if (!open) return;
    entries()[0]?.focus();
    const outside = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div ref={box} className="relative" onPointerDown={(event) => event.stopPropagation()}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={w.more}
        title={w.more}
        onClick={() => setOpen((o) => !o)}
        className="flex size-9 items-center justify-center rounded-full hover:bg-sunken aria-expanded:bg-sunken"
      >
        <Ellipsis aria-hidden className="size-5" />
      </button>
      {open && (
        <div
          ref={list}
          id={menuId}
          role="menu"
          aria-label={w.more}
          onKeyDown={(event) => {
            const all = entries();
            const at = all.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === "Escape") {
              // The panel closes on Escape; here it only closes the menu.
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              all[(at + (event.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              all[event.key === "Home" ? 0 : all.length - 1]?.focus();
            } else if (event.key === "Tab") setOpen(false);
          }}
          className="absolute right-0 top-full z-30 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col rounded-panel border border-line bg-card p-1.5 shadow-xl"
        >
          {items.map((item, index) =>
            item === "line" ? (
              <div key={`line-${index}`} role="separator" className="mx-1 my-1 h-px bg-line" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={`flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-left text-sm hover:bg-sunken focus-visible:bg-sunken disabled:cursor-not-allowed disabled:opacity-50 ${item.danger ? "text-danger-text" : "text-ink"}`}
              >
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The copied style: one for the whole admin, kept in this browser so it can be pasted on another page or in another tab.
// ---------------------------------------------------------------------------

const COPIED_KEY = "kaizen:copied-style";
let copied: CopiedStyle | null | undefined;
const listeners = new Set<() => void>();

function readCopied(): CopiedStyle | null {
  if (copied !== undefined) return copied;
  try {
    copied = readCopiedStyle(JSON.parse(window.localStorage.getItem(COPIED_KEY) ?? "null"));
  } catch {
    copied = null;
  }
  return copied;
}

function subscribeCopied(listener: () => void) {
  listeners.add(listener);
  const fromAnotherTab = (event: StorageEvent) => {
    if (event.key !== COPIED_KEY) return;
    copied = undefined;
    listener();
  };
  window.addEventListener("storage", fromAnotherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", fromAnotherTab);
  };
}

/** The style last copied in this browser, and a way to copy another. */
export function useCopiedStyle(): [CopiedStyle | null, (style: CopiedStyle) => void] {
  const current = useSyncExternalStore(subscribeCopied, readCopied, () => null);
  return [
    current,
    (style) => {
      copied = style;
      try {
        window.localStorage.setItem(COPIED_KEY, JSON.stringify(style));
      } catch {
        // Storage refused (a private window): the copy still lasts while the page is open.
      }
      for (const listener of listeners) listener();
    },
  ];
}

// ---------------------------------------------------------------------------
// What the tabs say in words
// ---------------------------------------------------------------------------

/** At the top of Design: which screen size the changes reach, and the four sizes to switch the builder to. */
export function DesignSizeStrip() {
  const { size, choose } = useSizeEdit();
  const words = useAdminText("builder");
  const pw = words.panel;
  return (
    <div className="-mx-5 -mt-5 flex flex-wrap items-center gap-3 border-b border-line bg-sunken px-5 py-2.5">
      <p className="min-w-0 flex-1 text-xs text-muted">{size === "xl" ? pw.appliesAll : fillWords(pw.applies, { size: words.sizes[size] })}</p>
      <div role="group" aria-label={pw.screenSize} className="flex gap-0.5 rounded-md bg-line/60 p-0.5">
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === size}
            aria-label={words.sizes[s]}
            title={words.sizes[s]}
            onClick={() => choose(s)}
            className="flex size-8 items-center justify-center rounded text-muted hover:text-ink aria-pressed:bg-card aria-pressed:text-ink aria-pressed:shadow-sm"
          >
            <DeviceIcon size={s} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A date and time as the schedule keeps it (`2026-12-01T09:00`), in the admin's language. It is a wall clock on the store's own clock (`visibility.ts`),
 * not a moment: read and shown on UTC's, so neither the server's zone nor the browser's moves it (D812).
 */
function when(value: string, tag: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? adminDate("UTC", `${value}:00Z`, "dayTime", tag) : value;
}

/** The top of Visibility: who sees the part, on which screens and when, as one sentence (D631). */
export function VisibilitySentence({ visibility, popup = false }: { visibility: PartBase["visibility"]; popup?: boolean }) {
  const words = useAdminText("builder");
  const sw = words.panel.seen;
  const tag = ADMIN_LANG_FACTS[useAdminLang()].tag;
  const { hiddenAt, audience, schedule } = visibilityAtGlance(visibility);
  let sentence: string;
  if (audience === "nobody") sentence = sw.nobody;
  else {
    const shownAt = SIZES.filter((s) => !hiddenAt.includes(s));
    const names = hiddenAt.map((s) => words.sizes[s]);
    const screens =
      shownAt.length === 0 ? sw.noSize : hiddenAt.length === 0 ? sw.everySize : fillWords(sw.except, { sizes: names.length > 1 ? `${names.slice(0, -1).join(", ")} ${sw.and} ${names.at(-1)}` : names[0] });
    const dates =
      schedule === "own"
        ? sw.ownDates
        : schedule?.from && schedule.to
          ? fillWords(sw.between, { from: when(schedule.from, tag), until: when(schedule.to, tag) })
          : schedule?.from
            ? fillWords(sw.from, { from: when(schedule.from, tag) })
            : schedule?.to
              ? fillWords(sw.until, { until: when(schedule.to, tag) })
              : "";
    sentence = `${sw[audience]} ${screens}${dates ? ` ${dates}` : ""}.`;
  }
  return (
    <p role="status" className="flex items-start gap-2.5 rounded-lg bg-positive-soft px-3.5 py-3 text-sm text-positive-text">
      <Eye aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        {sentence}
        {popup && ` ${sw.popup}`}
      </span>
    </p>
  );
}

type PanelWords = BuilderMessages["panel"];

/** Spacing while closed: the theme's, or the space outside and inside. */
export function spacingWords(spacing: Spacing | undefined, pw: PanelWords): string {
  const { outside, inside } = spacingAtGlance(spacing);
  if (outside === null && inside === null) return pw.summary.themeDefault;
  const say = (n: SidesAtGlance) => (n === "mixed" ? pw.summary.mixed : fillWords(pw.summary.px, { n: n ?? 0 }));
  return [inside !== null && fillWords(pw.summary.inside, { n: say(inside) }), outside !== null && fillWords(pw.summary.outside, { n: say(outside) })]
    .filter(Boolean)
    .join(" · ");
}

/** Border and shadow while closed. */
type FramePart = Parameters<typeof frameAtGlance>[0];

export function frameWords(part: FramePart, pw: PanelWords, borderNames: Record<string, string>): string {
  const { border, radius, shadow } = frameAtGlance(part);
  const said = [border && borderNames[border], radius !== null && fillWords(pw.summary.rounded, { n: radius }), shadow && pw.summary.shadow].filter(Boolean);
  return said.length > 0 ? said.join(" · ") : pw.summary.none;
}

/** Text while closed: the site's, or the font and size the part sets. */
export function typographyWords(groups: TypographyGroups | undefined, pw: PanelWords): string {
  const seen = typographyAtGlance(groups);
  if (!seen) return pw.summary.theSite;
  const said = [seen.family, seen.size].filter(Boolean);
  return said.length > 0 ? said.join(" · ") : pw.summary.own;
}
