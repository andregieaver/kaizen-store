/**
 * The motion runtime (D128), loaded only on pages that use motion (`MotionRuntime`, `src/components/motion-runtime.tsx`;
 * the builder's canvas starts it too). CSS does the drawing (`src/app/motion.css`); this only
 *
 *  - marks a part `data-fx-in` when it reaches its waypoint (one shared `IntersectionObserver` per waypoint position),
 *    and takes the mark away again when it leaves and is set to play again (`data-fx-repeat`);
 *  - splits text into words, letters or lines (text nodes only, never HTML; the whole text stays for screen readers);
 *  - follows the pointer for tilt, magnetic and spotlight (one delegated, passive listener; devices that hover only);
 *  - where the browser has no CSS scroll timelines (Firefox), tracks the parts near the screen with `scroll()` from the
 *    `motion` package (loaded then, and only then) and feeds `--fx-p`, which the stylesheet turns into progress;
 *  - replays entrances inside a modal each time it opens.
 *
 * Nothing runs for people who prefer less motion, nothing is written to the page but attributes, custom properties and the
 * split text, and everything is undone when the last user stops it. `initMotion` may be called any number of times.
 */

const MARGIN = { early: 10, middle: 35, late: 60 } as const;
type Start = keyof typeof MARGIN;

/** Parts that wait for a waypoint by themselves (children of a staggered group wait with their parent). */
const WAYPOINT = '[data-fx-trigger="view"]:not([data-fx-c])';
const SELECTOR = `${WAYPOINT}, [data-fx-scroll], [data-fx-text]`;
const POINTER = '[data-fx-hover="tilt"], [data-fx-hover="magnetic"], [data-fx-hover="spotlight"]';
const POINTER_VARS = ["--fx-px", "--fx-py", "--fx-x", "--fx-y"];
/** Text is split into at most this many words, or letters (longer texts keep their words). */
const MAX_WORDS = 400;
const MAX_CHARS = 300;
/** However many pieces there are, the last starts within this many milliseconds of the first. */
const MAX_SPREAD_MS = 1600;

type Engine = {
  roots: Map<ParentNode, { refs: number; observer: MutationObserver | null }>;
  bound: WeakSet<Element>;
  waypoints: Map<number, IntersectionObserver>;
  nearScreen: IntersectionObserver | null;
  trackers: Map<Element, () => void>;
  resizers: ResizeObserver[];
  pointer: boolean;
  pending: { el: HTMLElement; x: number; y: number } | null;
  frame: number;
  scrollReady: Promise<(typeof import("./motion-scroll"))["scroll"]> | null;
  alive: boolean;
};

let engine: Engine | null = null;

const supportsScrollTimelines = () =>
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("animation-timeline: view()");

/**
 * Starts (or extends) the runtime on `root` and returns the function that stops this use of it. Parts added to the root
 * later (streamed in) are picked up. With "reduce motion" nothing starts, and it starts if the person changes that.
 */
export function initMotion(given?: ParentNode): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const root: ParentNode = given ?? document;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let held = false;
  const follow = () => {
    if (reduce.matches) {
      if (held) release(root);
      held = false;
    } else if (!held) {
      held = true;
      retain(root);
    }
  };
  follow();
  reduce.addEventListener("change", follow);
  return () => {
    reduce.removeEventListener("change", follow);
    if (held) release(root);
    held = false;
  };
}

function retain(root: ParentNode) {
  const e = (engine ??= start());
  const entry = e.roots.get(root);
  if (entry) {
    entry.refs++;
  } else {
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      const added = new Set<Element>();
      let scheduled = 0;
      observer = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => {
            if (node.nodeType === 1 && !isOwn(node as Element)) added.add(node as Element);
          });
        }
        if (added.size === 0 || scheduled) return;
        scheduled = requestAnimationFrame(() => {
          scheduled = 0;
          const nodes = [...added];
          added.clear();
          for (const node of nodes) if (node.isConnected) scan(node);
        });
      });
      observer.observe(root instanceof Document ? root.body : (root as Node), { childList: true, subtree: true });
    }
    e.roots.set(root, { refs: 1, observer });
  }
  scan(root);
}

function release(root: ParentNode) {
  const e = engine;
  const entry = e?.roots.get(root);
  if (!e || !entry) return;
  if (--entry.refs > 0) return;
  entry.observer?.disconnect();
  e.roots.delete(root);
  if (e.roots.size === 0) stop(e);
}

/** What the runtime made itself (split text), which is not scanned again. */
const isOwn = (el: Element) =>
  el.hasAttribute("data-fx-w") ||
  el.hasAttribute("data-fx-sr") ||
  el.hasAttribute("data-fx-sg") ||
  el.hasAttribute("data-fx-g");

function start(): Engine {
  const e: Engine = {
    roots: new Map(),
    bound: new WeakSet(),
    waypoints: new Map(),
    nearScreen: null,
    trackers: new Map(),
    resizers: [],
    pointer: false,
    pending: null,
    frame: 0,
    scrollReady: null,
    alive: true,
  };
  document.addEventListener("close", onDialogClose, true);
  return e;
}

function stop(e: Engine) {
  e.alive = false;
  document.removeEventListener("close", onDialogClose, true);
  e.waypoints.forEach((io) => io.disconnect());
  e.nearScreen?.disconnect();
  for (const [el, end] of e.trackers) {
    end();
    el.removeAttribute("data-fx-live");
  }
  e.trackers.clear();
  e.resizers.forEach((ro) => ro.disconnect());
  if (e.pointer) {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerout", onOut);
  }
  if (e.frame) cancelAnimationFrame(e.frame);
  // Without the runtime, the failsafe (motion.css) reveals what still waits for a waypoint.
  document.documentElement.removeAttribute("data-fx-ready");
  engine = null;
}

// ---------------------------------------------------------------------------
// Finding the parts
// ---------------------------------------------------------------------------

function scan(root: ParentNode) {
  const e = engine;
  if (!e) return;
  try {
    const found: Element[] = [];
    if (root instanceof Element && root.matches(SELECTOR)) found.push(root);
    root.querySelectorAll(SELECTOR).forEach((el) => found.push(el));
    const fresh = found.filter((el) => !e.bound.has(el));
    for (const el of fresh) e.bound.add(el);
    // Split first, so a text is shown before it waits for its waypoint.
    for (const el of fresh) if (el.hasAttribute("data-fx-text")) split(el as HTMLElement);
    for (const el of fresh) {
      if (el.matches(WAYPOINT)) watch(el as HTMLElement);
      if (el.hasAttribute("data-fx-scroll")) follow(el as HTMLElement);
    }
    if (root instanceof Element ? root.matches(POINTER) || root.querySelector(POINTER) : root.querySelector(POINTER))
      listenToPointer();
  } finally {
    // Said last, and always: from here the stylesheet's failsafe stands down.
    document.documentElement.setAttribute("data-fx-ready", "");
  }
}

// ---------------------------------------------------------------------------
// Waypoints
// ---------------------------------------------------------------------------

const children = (parent: Element) =>
  [...parent.querySelectorAll("[data-fx-c]")].filter((child) => child.closest("[data-fx-each]") === parent);

function reveal(el: Element) {
  el.setAttribute("data-fx-in", "");
  if (el.hasAttribute("data-fx-each")) for (const child of children(el)) child.setAttribute("data-fx-in", "");
}

function hide(el: Element) {
  el.removeAttribute("data-fx-in");
  if (el.hasAttribute("data-fx-each")) for (const child of children(el)) child.removeAttribute("data-fx-in");
}

function waypoint(percent: number): IntersectionObserver {
  const e = engine!;
  let io = e.waypoints.get(percent);
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (entry.isIntersecting) {
            reveal(el);
            if (!el.hasAttribute("data-fx-repeat")) io!.unobserve(el);
          } else if (el.hasAttribute("data-fx-repeat")) {
            hide(el);
          }
        }
      },
      // The part's top must be `percent` of the screen's height above the bottom edge (a part taller than the screen too).
      { rootMargin: `0px 0px -${percent}% 0px`, threshold: 0 },
    );
    e.waypoints.set(percent, io);
  }
  return io;
}

function watch(el: HTMLElement) {
  if (el.hasAttribute("data-fx-now") || typeof IntersectionObserver === "undefined") {
    reveal(el);
    return;
  }
  const start = (el.getAttribute("data-fx-start") ?? "early") as Start;
  waypoint(MARGIN[start] ?? MARGIN.early).observe(el);
}

/** A modal's entrances play each time it opens: what was shown is put back to waiting when it closes. */
function onDialogClose(event: Event) {
  const dialog = event.target;
  if (!engine || !(dialog instanceof HTMLDialogElement)) return;
  dialog.querySelectorAll("[data-fx-in]").forEach((el) => {
    if (el.hasAttribute("data-fx-now")) return;
    el.removeAttribute("data-fx-in");
    if (el.matches(WAYPOINT)) watch(el as HTMLElement);
  });
}

// ---------------------------------------------------------------------------
// Scroll effects where CSS has no scroll timelines
// ---------------------------------------------------------------------------

function loadScroll() {
  const e = engine!;
  return (e.scrollReady ??= import("./motion-scroll").then((m) => m.scroll));
}

/** The nearest ancestor that scrolls, when it is not the page (the builder's canvas). */
function scroller(el: Element): HTMLElement | undefined {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return undefined;
}

function follow(el: HTMLElement) {
  const e = engine!;
  if (supportsScrollTimelines() || typeof IntersectionObserver === "undefined") return;
  e.nearScreen ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) (entry.isIntersecting ? track : untrack)(entry.target as HTMLElement);
    },
    // Only what is on or near the screen is measured.
    { rootMargin: "25% 0px", threshold: 0 },
  );
  e.nearScreen.observe(el);
}

function track(el: HTMLElement) {
  const e = engine;
  if (!e || e.trackers.has(el)) return;
  e.trackers.set(el, () => {});
  loadScroll()
    .then((scroll) => {
      if (!e.alive || !e.trackers.has(el)) return;
      const target = el.getAttribute("data-fx-tl") === "parent" ? (el.parentElement ?? el) : el;
      let live = false;
      const end = scroll(
        (progress: number) => {
          el.style.setProperty("--fx-p", progress.toFixed(4));
          if (!live) {
            live = true;
            el.setAttribute("data-fx-live", "");
          }
        },
        { target, offset: ["start end", "end start"], source: scroller(el) },
      );
      e.trackers.set(el, end);
    })
    .catch(() => e.trackers.delete(el));
}

function untrack(el: HTMLElement) {
  const e = engine;
  const end = e?.trackers.get(el);
  if (!e || !end) return;
  e.trackers.delete(el);
  end();
  el.removeAttribute("data-fx-live");
}

// ---------------------------------------------------------------------------
// Pointer effects
// ---------------------------------------------------------------------------

function listenToPointer() {
  const e = engine;
  if (!e || e.pointer || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  e.pointer = true;
  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerout", onOut, { passive: true });
}

function onMove(event: PointerEvent) {
  const e = engine;
  if (!e || event.pointerType === "touch") return;
  const el = (event.target as Element | null)?.closest?.(POINTER) as HTMLElement | null | undefined;
  if (!el) return;
  e.pending = { el, x: event.clientX, y: event.clientY };
  if (e.frame) return;
  e.frame = requestAnimationFrame(() => {
    e.frame = 0;
    const p = e.pending;
    e.pending = null;
    if (!p) return;
    const box = p.el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = p.x - box.left;
    const y = p.y - box.top;
    const clamp = (n: number) => Math.max(-1, Math.min(1, n));
    p.el.style.setProperty("--fx-px", clamp((x / box.width) * 2 - 1).toFixed(3));
    p.el.style.setProperty("--fx-py", clamp((y / box.height) * 2 - 1).toFixed(3));
    p.el.style.setProperty("--fx-x", `${Math.round(x)}px`);
    p.el.style.setProperty("--fx-y", `${Math.round(y)}px`);
  });
}

function onOut(event: PointerEvent) {
  const e = engine;
  const el = (event.target as Element | null)?.closest?.(POINTER) as HTMLElement | null | undefined;
  if (!e || !el) return;
  const to = event.relatedTarget as Node | null;
  if (to && el.contains(to)) return;
  if (e.pending?.el === el) e.pending = null;
  for (const name of POINTER_VARS) el.style.removeProperty(name);
}

// ---------------------------------------------------------------------------
// Text: words, letters, lines
// ---------------------------------------------------------------------------

const segments = (word: string): string[] => {
  const Segmenter = (
    Intl as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: string },
      ) => { segment(text: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;
  return Segmenter
    ? [...new Segmenter(undefined, { granularity: "grapheme" }).segment(word)].map((s) => s.segment)
    : Array.from(word);
};

function piece(text: string, index: number): HTMLSpanElement {
  const span = document.createElement("span");
  span.setAttribute("data-fx-w", "");
  span.style.setProperty("--fx-i", String(index));
  span.textContent = text;
  return span;
}

/**
 * Splits the text nodes under `el` (never HTML) into pieces that move in turn. What is read aloud stays the whole text:
 * a heading is named (`aria-label`) with its words; other text keeps a visually hidden copy next to the pieces, which are
 * `aria-hidden`. Links, bold and the like stay where they are, around their own pieces. Whatever goes wrong, the text is
 * left as it was.
 */
function split(el: HTMLElement) {
  if (!el.hasAttribute("data-fx-split")) {
    try {
      splitText(el);
    } catch {
      // The text stays as it is, and shows.
    }
    el.setAttribute("data-fx-split", "");
  }
}

function splitText(el: HTMLElement) {
  const mode = el.getAttribute("data-fx-enter");
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.nodeValue?.trim() && !node.parentElement?.closest("script, style, [data-fx-w], [data-fx-sr], [data-fx-sg]")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  if (nodes.length === 0) return;
  const words = nodes.reduce((n, text) => n + (text.data.match(/\S+/g)?.length ?? 0), 0);
  const letters = nodes.reduce((n, text) => n + text.data.replace(/\s+/g, "").length, 0);
  if (words > MAX_WORDS) return;
  const letterByLetter = mode === "chars" && letters <= MAX_CHARS;

  const heading = el.querySelector("h1, h2, h3, h4, h5, h6");
  if (heading && !heading.hasAttribute("aria-label"))
    heading.setAttribute("aria-label", (heading.textContent ?? "").replace(/\s+/g, " ").trim());

  let index = 0;
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    if (!heading?.contains(node)) {
      const whole = document.createElement("span");
      whole.setAttribute("data-fx-sr", "");
      whole.textContent = node.data;
      fragment.append(whole);
    }
    const group = document.createElement("span");
    group.setAttribute("aria-hidden", "true");
    group.setAttribute("data-fx-sg", "");
    for (const token of node.data.split(/(\s+)/)) {
      if (token === "") continue;
      if (/^\s+$/.test(token)) {
        group.append(document.createTextNode(token));
      } else if (letterByLetter) {
        const word = document.createElement("span");
        word.setAttribute("data-fx-g", "");
        for (const letter of segments(token)) word.append(piece(letter, index++));
        group.append(word);
      } else {
        group.append(piece(token, index++));
      }
    }
    fragment.append(group);
    node.replaceWith(fragment);
  }

  if (mode === "lines") {
    layLines(el);
    const e = engine;
    if (e && typeof ResizeObserver !== "undefined") {
      let width = el.clientWidth;
      const observer = new ResizeObserver(() => {
        if (el.clientWidth === width) return;
        width = el.clientWidth;
        layLines(el);
      });
      observer.observe(el);
      e.resizers.push(observer);
      void document.fonts?.ready.then(() => layLines(el));
    }
  } else {
    spread(el, index);
  }
}

/** Words on one line share a number, so a line comes in as one; the lines follow each other. */
function layLines(el: HTMLElement) {
  let line = -1;
  let top = Number.NaN;
  el.querySelectorAll<HTMLElement>("[data-fx-w]").forEach((word) => {
    const y = word.offsetTop;
    if (Number.isNaN(top) || Math.abs(y - top) > 2) {
      line++;
      top = y;
    }
    word.style.setProperty("--fx-i", String(line));
  });
  spread(el, line + 1);
}

/** A long text does not take long: the step between pieces shrinks so the last starts within `MAX_SPREAD_MS`. */
function spread(el: HTMLElement, count: number) {
  const step = Number.parseFloat(getComputedStyle(el).getPropertyValue("--fx-stagger"));
  if (Number.isFinite(step) && count > 1 && step * (count - 1) > MAX_SPREAD_MS) {
    el.style.setProperty("--fx-stagger", `${(MAX_SPREAD_MS / (count - 1)).toFixed(1)}ms`);
  }
}
