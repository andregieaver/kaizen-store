/**
 * The storefront's click watch (D656, `docs/heatmaps-and-recordings.md` 7.5): turns the page's clicks and signs of life into the input of
 * `ClickJudge` (`src/lib/click-signals.ts`) and hands its verdicts on. One MutationObserver, armed only while a click waits for its verdict;
 * clicks inside `[data-kz-private]` are not seen at all. Only started for a visitor who allowed what it serves.
 */

import { ClickJudge, type Verdict } from "@/lib/click-signals";
import { anchorOf, cellOf, isCandidateTarget, isRageable, partIdOf, type ChainLink } from "@/lib/heat-anchor";
import { TICK_MS } from "@/lib/page-heat";

type Listener = (verdicts: Verdict[]) => void;

let judge: ClickJudge | null = null;
let onVerdicts: Listener | null = null;
let observer: MutationObserver | null = null;
let ticker: number | null = null;
let lastDown = 0;
let lastHref = "";
const ids = new WeakMap<Element, number>();
let nextId = 0;
const off: (() => void)[] = [];

const now = () => Date.now();
const idOf = (el: Element) => {
  let id = ids.get(el);
  if (id === undefined) {
    id = ++nextId;
    ids.set(el, id);
  }
  return id;
};

/** Which part a card sits in, and its place among that part's cards; and its list's place among the page's card lists. */
function cardFacts(card: Element, part: Element | null): Pick<ChainLink, "cardIndexInPart" | "listIndex" | "cardIndexInList"> {
  const all = [...document.querySelectorAll("li.product-card")];
  const lists = [...new Set(all.map((c) => c.parentElement))];
  const list = card.parentElement;
  return {
    cardIndexInPart: part ? [...part.querySelectorAll("li.product-card")].indexOf(card) : null,
    listIndex: lists.indexOf(list),
    cardIndexInList: list ? [...list.children].filter((c) => c.matches("li.product-card")).indexOf(card) : null,
  };
}

/** The chain from the clicked element up to `<body>`, as `anchorOf()` reads it, with the elements themselves. */
function chainOf(target: Element): { chain: ChainLink[]; elements: Element[] } {
  const elements: Element[] = [];
  for (let el: Element | null = target; el && el !== document.documentElement; el = el.parentElement) elements.push(el);
  const partAbove = (from: number) => elements.slice(from + 1).find((el) => partIdOf(el.classList[0] ?? null) !== null) ?? null;
  const chain = elements.map((el, i): ChainLink => {
    const isProductCard = el.matches("li.product-card");
    return { firstClass: el.classList[0] ?? null, tag: el.tagName.toLowerCase(), isProductCard, ...(isProductCard ? cardFacts(el, partAbove(i)) : {}) };
  });
  return { chain, elements };
}

function arm() {
  if (!observer) {
    observer = new MutationObserver((records) => {
      const counted = records.some((r) => {
        if (r.type === "attributes" && (r.attributeName === "style" || r.attributeName?.startsWith("data-fx"))) return false;
        const el = r.target instanceof Element ? r.target : r.target.parentElement;
        return !el?.closest("[data-kz-ambient]");
      });
      if (counted) judge?.mutation(now());
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  if (ticker === null) ticker = window.setInterval(tick, TICK_MS);
}

function disarm() {
  observer?.disconnect();
  observer = null;
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
}

function tick() {
  if (!judge) return;
  if (location.href !== lastHref) {
    lastHref = location.href;
    judge.urlChange(now());
  }
  const verdicts = judge.tick(now());
  if (verdicts.length > 0) onVerdicts?.(verdicts);
  if (judge.pending === 0) disarm();
}

function onClick(event: MouseEvent) {
  if (!judge || !event.isTrusted || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest("[data-kz-private]")) return;
  const { chain, elements } = chainOf(target);
  const found = anchorOf(chain);
  if (!found) return;
  const [cx, cy] = cellOf(event.clientX, event.clientY, elements[found.at].getBoundingClientRect());
  const editable = target instanceof HTMLElement && target.isContentEditable;
  const modified = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
  const at = now();
  judge.click({
    at,
    downAt: lastDown > 0 && at - lastDown <= 1000 ? lastDown : null,
    x: event.clientX,
    y: event.clientY,
    targetId: idOf(target),
    candidate: !modified && isCandidateTarget(target.tagName, editable) && !target.closest("[data-kz-no-deadclick]"),
    rageable: isRageable(target.tagName, target.getAttribute("type"), editable) && !target.closest("[data-kz-no-rage]"),
    anchor: found.anchor,
    cx,
    cy,
  });
  arm();
}

const listen = <K extends keyof DocumentEventMap>(type: K, handler: (event: DocumentEventMap[K]) => void) => {
  document.addEventListener(type, handler, { capture: true, passive: true });
  off.push(() => document.removeEventListener(type, handler, { capture: true }));
};

/** Starts watching clicks (once); verdicts go to `listener`. */
export function startClickWatch(listener: Listener): void {
  onVerdicts = listener;
  if (judge) return;
  judge = new ClickJudge();
  lastHref = location.href;
  listen("pointerdown", () => {
    lastDown = now();
    arm();
  });
  listen("click", onClick);
  listen("scroll", () => judge?.scroll(now()));
  listen("selectionchange", () => {
    // Every click on text moves the caret; only text actually selected is a sign of life.
    if (document.getSelection()?.isCollapsed === false) judge?.selection(now());
  });
  listen("focusin", () => judge?.focus(now()));
  listen("visibilitychange", () => judge?.leave(now()));
  const leave = () => judge?.leave(now());
  window.addEventListener("blur", leave);
  window.addEventListener("pagehide", leave);
  off.push(() => window.removeEventListener("blur", leave), () => window.removeEventListener("pagehide", leave));
}

/** Every click still waiting, released now as not dead (the view is being summarised). */
export function flushClicks(): Verdict[] {
  return judge?.flush() ?? [];
}

/** Stops watching; what still waits is dropped. */
export function stopClickWatch(): void {
  disarm();
  for (const stop of off.splice(0)) stop();
  judge = null;
  onVerdicts = null;
}
