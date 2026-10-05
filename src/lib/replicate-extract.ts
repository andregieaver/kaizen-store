import type { CaptureNode, CaptureSlider, NodeMedia, PageCapture, Run, SlideHide, SlideMark, SliderControl } from "./replicate-capture";

/**
 * Reads a page's boxes and styles in the browser (D150). `page.evaluate()` sends this function's source to the page,
 * so it uses nothing from outside itself: everything it needs is declared inside or passed in `options`. It walks the
 * body once, keeps what is visible and in the page, collects a text element's words as runs (bold, italic, underline
 * and links kept), notes pictures, videos and embeds, and marks the elements that are pictures to take (`svg`,
 * `canvas`) with `data-rp` so the server can photograph them. Overlays fixed to the screen (cookie banners, chat
 * widgets) are left out and named, because a copy of a page has no use for them.
 *
 * Script sliders (D155, C2) are read whole: a track clipped by its box, whose slides lie beyond it, are laid out by a transform or a row
 * that does not wrap, or are stacked with one showing, keeps every slide it has (hidden, parked beyond the box, or a copy made to loop)
 * with a mark on it (`SlideMark`: why it is not in view, the library's copy marker and number, its words and pictures, its parts as a
 * skeleton), so the converter can tell the real slides from the copies and a hidden slide from a different one. The track is marked
 * `data-rp-track` for the watch that tells whether it moves by itself (`replicate-watch.ts`).
 */
export type ExtractOptions = { maxNodes: number; styles: readonly string[]; width: number; height: number };

export function extractPage(options: ExtractOptions): Omit<PageCapture, "viewport" | "url"> {
  const SKIP = ["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "BASE", "PARAM", "SOURCE", "TRACK", "DATALIST", "OPTION", "OPTGROUP", "MAP", "AREA"];
  const DEFAULTS: Record<string, string[]> = {
    position: ["static"],
    flexDirection: ["row"],
    flexWrap: ["nowrap"],
    justifyContent: ["normal", "flex-start"],
    alignItems: ["normal", "stretch"],
    columnGap: ["normal", "0px"],
    rowGap: ["normal", "0px"],
    gridTemplateColumns: ["none"],
    overflowX: ["visible"],
    overflowY: ["visible"],
    opacity: ["1"],
    transform: ["none"],
    backgroundColor: ["rgba(0, 0, 0, 0)"],
    backgroundImage: ["none"],
    backgroundSize: ["auto"],
    backgroundPosition: ["0% 0%"],
    backgroundRepeat: ["repeat"],
    textTransform: ["none"],
    textDecorationLine: ["none"],
    whiteSpace: ["normal"],
    paddingTop: ["0px"],
    paddingRight: ["0px"],
    paddingBottom: ["0px"],
    paddingLeft: ["0px"],
    marginTop: ["0px"],
    marginRight: ["0px"],
    marginBottom: ["0px"],
    marginLeft: ["0px"],
    borderTopWidth: ["0px"],
    borderRightWidth: ["0px"],
    borderBottomWidth: ["0px"],
    borderLeftWidth: ["0px"],
    borderTopStyle: ["none"],
    borderTopLeftRadius: ["0px"],
    borderTopRightRadius: ["0px"],
    borderBottomRightRadius: ["0px"],
    borderBottomLeftRadius: ["0px"],
    boxShadow: ["none"],
    objectFit: ["fill"],
    objectPosition: ["50% 50%"],
    maxWidth: ["none"],
    minHeight: ["0px", "auto"],
    aspectRatio: ["auto"],
    filter: ["none"],
    textShadow: ["none"],
    listStyleType: ["disc"],
    scrollSnapType: ["none"],
    scrollSnapAlign: ["none"],
  };
  /** Boxes that only hold what is in them and say nothing of their own: the text styles are read only where there is text. */
  const TEXT_STYLES = ["color", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textAlign"];

  const doc = document;
  const win = window;
  const scrollX = win.scrollX || 0;
  const scrollY = win.scrollY || 0;
  let count = 0;
  let capped = false;
  let hidden = 0;
  const fixed: string[] = [];
  const fontUse = new Map<string, { family: string; weight: string; style: string; chars: number }>();
  const extras = {
    pseudo: [] as { sel: string; y: number; note?: string }[],
    animated: [] as { sel: string; y: number; note?: string }[],
    sticky: [] as { sel: string; y: number; note?: string }[],
    scrollers: [] as { sel: string; y: number; note?: string }[],
    roles: [] as { sel: string; y: number; note?: string }[],
    total: { pseudo: 0, animated: 0, sticky: 0, scrollers: 0, roles: 0 },
  };
  const ROLES = ["tablist", "tab", "tabpanel", "dialog", "alertdialog", "slider", "menu", "menubar", "marquee", "timer", "progressbar", "carousel"];

  function describe(el: Element): string {
    const id = el.id && !/^rp\d+$/.test(el.id) ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 70);
  }

  function note(kind: "pseudo" | "animated" | "sticky" | "scrollers" | "roles", el: Element, y: number, text?: string) {
    extras.total[kind] += 1;
    if (extras[kind].length < 15) extras[kind].push(text ? { sel: describe(el), y: Math.round(y), note: text } : { sel: describe(el), y: Math.round(y) });
  }

  /** What an element does that its box does not show; the words its pseudo-elements draw (`::before`, `::after`) are given back. */
  function observe(el: Element, cs: CSSStyleDeclaration, y: number): string[] {
    if (cs.position === "sticky") note("sticky", el, y);
    if (cs.animationName !== "none" && cs.animationName !== "" && cs.animationDuration !== "0s") note("animated", el, y, cs.animationName.split(",")[0]);
    if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 4) note("scrollers", el, y);
    const role = el.getAttribute("role") || "";
    const roledescription = (el.getAttribute("aria-roledescription") || "").toLowerCase();
    if (ROLES.indexOf(role) >= 0) note("roles", el, y, role);
    else if (roledescription) note("roles", el, y, roledescription);
    const words: string[] = [];
    for (const which of ["::before", "::after"]) {
      const pseudo = win.getComputedStyle(el, which);
      const content = pseudo.content;
      if (content === "none" || content === "normal" || content === "") continue;
      const empty = content === '""' || content === "''";
      const paints = pseudo.backgroundImage !== "none" || pseudo.backgroundColor !== "rgba(0, 0, 0, 0)";
      if (empty && !(paints && parseFloat(pseudo.width) > 0 && parseFloat(pseudo.height) > 0)) continue;
      note("pseudo", el, y, `${which} ${empty ? "a shape" : content.slice(0, 30)}`);
      // The words a pseudo-element draws are text a visitor reads, and they are in no run: kept on the node so a copy can say it lacks them. A string only
      // (not `attr()`, a counter or a picture), with a letter or a digit in it (an icon font's private-use glyph is no word), and only if it shows.
      const quoted = /^"([\s\S]*)"$/.exec(content) ?? /^'([\s\S]*)'$/.exec(content);
      if (!quoted || pseudo.display === "none" || pseudo.visibility === "hidden" || Number(pseudo.opacity) === 0) continue;
      const text = quoted[1].replace(/\\(["'\\])/g, "$1").replace(/\\a\s?/gi, " ").replace(/\s+/g, " ").trim();
      if (/[\p{L}\p{N}]/u.test(text)) words.push(text.slice(0, 60));
    }
    return words;
  }

  function styleOf(cs: CSSStyleDeclaration, text: boolean, boxy: boolean): Record<string, string> {
    const out: Record<string, string> = {};
    const record = cs as unknown as Record<string, string>;
    for (const key of options.styles) {
      const textual = TEXT_STYLES.indexOf(key) >= 0;
      if (textual && !text && key !== "color") continue;
      if (!textual && !boxy && key !== "display") continue;
      const value = record[key];
      if (value === undefined || value === "") continue;
      const defaults = DEFAULTS[key];
      if (defaults && defaults.indexOf(value) >= 0) continue;
      out[key] = value;
    }
    out.display = cs.display;
    return out;
  }

  function absolute(value: string | null): string | null {
    if (!value) return null;
    try {
      const url = new URL(value, doc.baseURI);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }

  function backgroundList(value: string): string[] {
    const urls: string[] = [];
    const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) {
      const url = absolute(match[1] ?? match[2] ?? match[3] ?? "");
      if (url) urls.push(url);
    }
    return urls;
  }

  /**
   * A slide that is not in view is read all the same (`force`): its own display, opacity and visibility, and the box that clips it, are not
   * asked of it. What is inside it is still held to the page's rules (a part with `display: none` or no opacity of its own is not there), and
   * `vis` says the slide itself is `visibility: hidden`, which its parts inherit.
   */
  type Force = { vis: boolean; root: boolean } | null;

  function visible(el: Element, cs: CSSStyleDeclaration, rect: DOMRect, force: Force = null): boolean {
    if (force) {
      if (cs.display === "none" && !force.root) return false;
      if (!force.vis && !force.root && (cs.visibility === "hidden" || cs.visibility === "collapse")) return false;
      if (!force.root && Number(cs.opacity) === 0) return false;
    } else {
      if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
      if (Number(cs.opacity) === 0) return false;
    }
    if (rect.width <= 0 && rect.height <= 0) return false;
    // Wholly above or to the left of the page, which cannot be scrolled to (a cookie tool's iframe parked at -9999px): not on the page, however big. It
    // was a row of its own and pushed every row after it 9,963 px down on lampan.no. A slide scrolled out of its track (`force`) is another matter.
    if (!force && (rect.bottom + scrollY <= -20 || rect.right + scrollX <= -20)) return false;
    // Screen-reader-only text: a pixel in size, clipped.
    if (rect.width <= 1 && rect.height <= 1 && (cs.position === "absolute" || cs.position === "fixed")) return false;
    if (el.getAttribute("aria-hidden") === "true" && rect.width * rect.height < 4) return false;
    return true;
  }

  /**
   * Whether a box lies wholly outside a box that clips it: a menu folded to no height, a slide scrolled out of a track. Such
   * content is in the document but not on the page, as a visitor sees it. A box placed absolutely is clipped only by the boxes
   * from the one it is placed against, outward.
   */
  /** A box that scrolls sideways: its overflow is meant to be reached by scrolling. */
  function scrollsSideways(el: Element, cs: CSSStyleDeclaration): boolean {
    return (cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 4;
  }

  /** Whether an element is inside a box that scrolls sideways. */
  function inScroller(el: Element): boolean {
    for (let ancestor = el.parentElement; ancestor && ancestor !== doc.body; ancestor = ancestor.parentElement) {
      if (scrollsSideways(ancestor, win.getComputedStyle(ancestor))) return true;
    }
    return false;
  }

  function clippedAway(el: Element, cs: CSSStyleDeclaration, rect: DOMRect): boolean {
    if (cs.position === "fixed" || (rect.width <= 0 && rect.height <= 0)) return false;
    let absolute = cs.position === "absolute";
    for (let ancestor = el.parentElement; ancestor && ancestor !== doc.body && ancestor !== doc.documentElement; ancestor = ancestor.parentElement) {
      const style = win.getComputedStyle(ancestor);
      if (absolute) {
        if (style.position === "static") continue;
        absolute = false;
      }
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        const r = ancestor.getBoundingClientRect();
        // What a box scrolls sideways is not hidden by it, only what lies above or below it.
        const sideways = scrollsSideways(ancestor, style) && (rect.right <= r.left + 1 || rect.left >= r.right - 1);
        if (!sideways && (rect.right <= r.left + 1 || rect.left >= r.right - 1 || rect.bottom <= r.top + 1 || rect.top >= r.bottom - 1)) return true;
      }
      if (style.position === "fixed") break;
    }
    return false;
  }

  /**
   * How far down a box is seen: the bottom of the lowest-reaching clip that cuts it. A "read more" box (`max-height` with `overflow: hidden`) holds a
   * text of 600 px that the visitor sees 170 px of, and the row after it follows the 170 px: a box is read as far as it is seen, or the copy's rows stand
   * 380 px too low (lampan.no). Only a box that starts inside the clip and runs past its bottom; one wholly outside is `clippedAway()`.
   */
  function seenBottom(el: Element, cs: CSSStyleDeclaration, rect: DOMRect): number {
    let bottom = rect.bottom;
    if (cs.position === "fixed") return bottom;
    let absolute = cs.position === "absolute";
    for (let ancestor = el.parentElement; ancestor && ancestor !== doc.body && ancestor !== doc.documentElement; ancestor = ancestor.parentElement) {
      const style = win.getComputedStyle(ancestor);
      if (absolute) {
        if (style.position === "static") continue;
        absolute = false;
      }
      if (style.overflowY === "hidden" || style.overflowY === "clip") {
        const r = ancestor.getBoundingClientRect();
        if (rect.top < r.bottom - 1 && r.bottom < bottom - 4) bottom = r.bottom;
      }
      if (style.position === "fixed") break;
    }
    return bottom;
  }

  const INLINE = /^(inline|inline-block|inline-flex|inline-grid|contents|ruby)/;

  /**
   * Whether an element inside a piece of text is not seen by a visitor: not displayed, `visibility: hidden`, see-through, a font size of nothing, or
   * (placed absolutely) a pixel, clipped, or parked off the screen, as a screen-reader-only part is. Its words are no part of what the page says, so they
   * are in no run and do not make the text "more than text". `vis`: the slide it is in is itself `visibility: hidden` (read all the same), so what it
   * inherits does not count.
   */
  function unseen(element: Element, cs: CSSStyleDeclaration, vis: boolean): boolean {
    if (cs.display === "none") return true;
    if (!vis && (cs.visibility === "hidden" || cs.visibility === "collapse")) return true;
    if (Number(cs.opacity) === 0 || parseFloat(cs.fontSize) === 0) return true;
    if (cs.position === "absolute" || cs.position === "fixed") {
      const r = element.getBoundingClientRect();
      if (r.width <= 1 && r.height <= 1) return true;
      if (r.right + scrollX <= 0 || r.bottom + scrollY <= 0) return true;
      if (/^rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)$/.test(cs.clip) || /^inset\((50|100)%\)$/.test(cs.clipPath)) return true;
    }
    return false;
  }

  /** Whether a background colour paints (it is not transparent). */
  function paintsFill(colour: string): boolean {
    const m = /^rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(colour.trim());
    if (!m) return colour !== "" && colour !== "transparent";
    const alpha = m[1] === undefined ? 1 : Number(m[1]) / (m[2] ? 100 : 1);
    return alpha > 0.05;
  }

  /** Whether a block holds only text and inline elements, so it is one piece of text. */
  function isTextual(el: Element, vis = false): boolean {
    let text = false;
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        if ((child.nodeValue || "").trim() !== "") text = true;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (SKIP.indexOf(element.tagName) >= 0) continue;
      if (element.tagName === "BR" || element.tagName === "WBR") continue;
      const cs = win.getComputedStyle(element);
      if (unseen(element, cs, vis)) continue;
      if (!INLINE.test(cs.display) || cs.position === "absolute" || cs.position === "fixed" || cs.cssFloat !== "none") return false;
      if (["IMG", "SVG", "VIDEO", "IFRAME", "CANVAS", "INPUT", "SELECT", "TEXTAREA", "BUTTON", "PICTURE"].indexOf(element.tagName.toUpperCase()) >= 0) return false;
      // An inline box with its own look (a badge, a pill, a link drawn as a button) is more than text.
      if (cs.backgroundImage !== "none" || paintsFill(cs.backgroundColor)) return false;
      if (!isTextual(element, vis)) return false;
      if ((element.textContent || "").trim() !== "") text = true;
    }
    return text;
  }

  function runsOf(el: Element, root: CSSStyleDeclaration, vis = false): Run[] {
    const runs: Run[] = [];
    const keep = root.whiteSpace === "pre" || root.whiteSpace === "pre-wrap" || root.whiteSpace === "pre-line";
    function visit(node: Node, mark: { b: boolean; i: boolean; u: boolean; href: string | undefined; c: string | undefined }) {
      if (node.nodeType === 3) {
        let text = node.nodeValue || "";
        if (!keep) text = text.replace(/[\t\n\r ]+/g, " ");
        if (text === "") return;
        const run: Run = { t: text };
        if (mark.b) run.b = 1;
        if (mark.i) run.i = 1;
        if (mark.u) run.u = 1;
        if (mark.href) run.href = mark.href;
        if (mark.href && mark.c) run.c = mark.c;
        runs.push(run);
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node as Element;
      if (SKIP.indexOf(element.tagName) >= 0) return;
      if (element.tagName === "BR") {
        runs.push({ t: "", br: 1 });
        return;
      }
      const cs = win.getComputedStyle(element);
      if (unseen(element, cs, vis)) return;
      const weight = Number(cs.fontWeight);
      const next = {
        b: mark.b || (weight >= 600 && weight > Number(root.fontWeight)),
        i: mark.i || (cs.fontStyle === "italic" && root.fontStyle !== "italic"),
        u: mark.u || (cs.textDecorationLine.indexOf("underline") >= 0 && root.textDecorationLine.indexOf("underline") < 0),
        href: mark.href || (element.tagName === "A" ? absolute(element.getAttribute("href")) || undefined : undefined),
        c: mark.c || (element.tagName === "A" ? cs.color : undefined),
      };
      for (let child = element.firstChild; child; child = child.nextSibling) visit(child, next);
    }
    for (let child = el.firstChild; child; child = child.nextSibling) visit(child, { b: false, i: false, u: false, href: undefined, c: undefined });
    // Spaces at the ends of the block and doubled spaces between runs do not show.
    if (!keep) {
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        if (run.br) continue;
        const before = i === 0 || runs[i - 1].br;
        if (before) run.t = run.t.replace(/^ +/, "");
        const after = i === runs.length - 1 || runs[i + 1].br;
        if (after) run.t = run.t.replace(/ +$/, "");
        const previous = runs[i - 1];
        if (previous && !previous.br && previous.t.endsWith(" ") && run.t.startsWith(" ")) run.t = run.t.slice(1);
      }
    }
    return runs.filter((run) => run.br || run.t !== "");
  }

  function mediaOf(el: Element, cs: CSSStyleDeclaration): NodeMedia | undefined {
    const tag = el.tagName.toUpperCase();
    if (tag === "IMG") {
      const img = el as HTMLImageElement;
      let url = absolute(img.currentSrc || img.getAttribute("src"));
      // A picture a script has not loaded yet: its address is in a lazy-loading attribute, and `src` is a placeholder (a data address or a one-pixel file).
      if (!url || (img.complete && img.naturalWidth > 0 && img.naturalWidth <= 2)) {
        for (const name of LAZY) {
          const lazy = absolute((img.getAttribute(name) || "").split(",")[0].trim().split(/\s+/)[0] || null);
          if (lazy) {
            url = lazy;
            break;
          }
        }
      }
      if (!url) return undefined;
      return { kind: "img", url, width: img.naturalWidth || 0, height: img.naturalHeight || 0, alt: img.alt || "" };
    }
    if (tag === "SVG") return { kind: "svg" };
    if (tag === "CANVAS") return { kind: "canvas" };
    if (tag === "VIDEO") {
      const video = el as HTMLVideoElement;
      const source = video.querySelector("source");
      return {
        kind: "video",
        url: absolute(video.currentSrc || video.getAttribute("src") || (source && source.getAttribute("src"))),
        poster: absolute(video.getAttribute("poster")),
        autoplay: video.autoplay,
        loop: video.loop,
        muted: video.muted || video.defaultMuted,
        controls: video.controls,
      };
    }
    if (tag === "IFRAME") {
      const url = absolute(el.getAttribute("src"));
      return url ? { kind: "embed", url, title: el.getAttribute("title") || "" } : undefined;
    }
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      const input = el as HTMLInputElement;
      return { kind: "control", type: tag === "INPUT" ? input.type || "text" : tag.toLowerCase(), label: input.placeholder || input.value || input.getAttribute("aria-label") || "" };
    }
    void cs;
    return undefined;
  }

  function buttonLike(el: Element, cs: CSSStyleDeclaration, text: boolean): boolean {
    const tag = el.tagName;
    if (!text) return false;
    if (tag !== "A" && tag !== "BUTTON" && el.getAttribute("role") !== "button") return false;
    const paintsBackground = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none";
    const bordered = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none";
    const padded = parseFloat(cs.paddingLeft) >= 8 && parseFloat(cs.paddingTop) >= 4;
    return tag === "BUTTON" || paintsBackground || bordered || (padded && (cs.display === "inline-block" || cs.display === "inline-flex" || cs.display === "flex"));
  }

  /**
   * A box that is nothing but a holder for what is in it: a `picture` (zero size, its image drawn wherever the image's own
   * styles put it), `display: contents`, or an empty inline wrapper. Its children belong to its parent, with the paths they
   * have, so a picture laid over a whole section is not lost with its holder.
   */
  function isHolder(el: Element): boolean {
    if (el.children.length === 0) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === "PICTURE") return true;
    const cs = win.getComputedStyle(el);
    if (cs.display === "contents") return true;
    const rect = el.getBoundingClientRect();
    return rect.width === 0 && rect.height === 0 && /^inline/.test(cs.display) && (el.textContent || "").trim() === "";
  }

  /**
   * Whether an element takes a place in its parent's numbering. A box's address is its index among its parent's elements, and the phone's
   * and computer's readings are matched by it; a script or a cookie tool's dialog that one load injects and the other does not (found on
   * lampan.no: Cookiebot, in front of the page's own boxes in two loads of three) would renumber every box after it, and the phone's copy
   * of every part would be "not there". Scripts and styles, and what is fixed to the screen other than a bar at the top (left out of the
   * capture), are not counted: they have no box of their own in it, and a left-out element shares the number of the next one.
   */
  function counted(el: Element): boolean {
    if (SKIP.indexOf(el.tagName) >= 0) return false;
    const cs = win.getComputedStyle(el);
    if (cs.position !== "fixed") return true;
    const rect = el.getBoundingClientRect();
    return rect.top <= 4 && rect.height <= 220 && rect.width >= options.width * 0.8;
  }

  function nodesOf(el: Element, path: string, depth: number, force: Force = null, shallow = false): CaptureNode[] {
    if (SKIP.indexOf(el.tagName) < 0 && isHolder(el)) {
      const found: CaptureNode[] = [];
      let index = 0;
      for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1) continue;
        found.push(...nodesOf(child as Element, `${path}/${index}`, depth + 1, force && { vis: force.vis, root: false }, shallow));
        if (counted(child as Element)) index += 1;
      }
      return found;
    }
    const node = nodeOf(el, path, depth, force, shallow);
    return node ? [node] : [];
  }

  // -- script sliders ------------------------------------------------------------------------------------------------
  const CLONE_CLASSES = ["swiper-slide-duplicate", "slick-cloned", "splide__slide--clone", "glide__slide--clone", "tns-slide-cloned", "bx-clone", "cloned", "clone"];
  const KEY_ATTRS = ["data-swiper-slide-index", "data-slick-index", "data-slide-index", "data-index"];
  const HINT = /^(swiper|slick|splide|glide|embla|owl|flickity|keen-slider|tns|uk-slider|bx-|carousel|slider|slideshow)/i;
  const LAZY = ["data-src", "data-lazy", "data-lazy-src", "data-original", "data-srcset", "data-lazy-srcset"];

  const classesOf = (el: Element): string[] => (typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean) : []);

  /** Library class names on some elements: hints for the report, never what decides. */
  function hintsOf(els: (Element | null)[]): string[] {
    const found: string[] = [];
    for (const el of els) {
      if (!el) continue;
      for (const token of classesOf(el)) if (HINT.test(token) && found.indexOf(token) < 0 && found.length < 6) found.push(token);
    }
    return found;
  }

  const box4 = (r: DOMRect): [number, number, number, number] => [Math.round((r.left + scrollX) * 10) / 10, Math.round((r.top + scrollY) * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];

  /** `looked`, `unread` and `shown` are the track's own bookkeeping while its tiles are read: how many were looked at, how many were never read, and the display a shown tile has. */
  type SliderFound = { kind: "transform" | "flex" | "stack"; clip: Element; clipRect: DOMRect; kids: number; looked: number; unread: number; shown: string | null | undefined };
  /** The most tiles of one track that are read; a track with thousands of slides is cut here and the rest are counted (`CaptureSlider.unread`). */
  const TILES_MAX = 200;

  /**
   * Whether an element is a script slider's track: a clipped box (itself or one of the two above it) whose children lie in one row beyond it,
   * moved by a transform or a row that does not wrap; or slides on top of each other with one showing. Library names help where the
   * geometry is not enough (slides that are `display: none` but one), and are never required where it is.
   */
  function sliderOf(el: Element, cs: CSSStyleDeclaration): SliderFound | null {
    if (el.children.length < 2 || el === doc.body) return null;
    // A track that never stops (a ticker) is not a slider.
    if (cs.animationName !== "none" && cs.animationName !== "" && cs.animationIterationCount.indexOf("infinite") >= 0) return null;
    if (scrollsSideways(el, cs)) return null;
    const kids = Array.from(el.children).filter((child) => SKIP.indexOf(child.tagName) < 0);
    if (kids.length < 2) return null;
    let clip: Element | null = null;
    let up: Element | null = el;
    for (let n = 0; up && up !== doc.body && n <= 2; up = up.parentElement, n++) {
      const style = up === el ? cs : win.getComputedStyle(up);
      if (style.overflowX === "hidden" || style.overflowX === "clip") {
        clip = up;
        break;
      }
      if (style.overflowX === "auto" || style.overflowX === "scroll") break;
    }
    if (clip) {
      const clipRect = clip.getBoundingClientRect();
      const laid = kids.map((child) => child.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      if (laid.length >= 2 && clipRect.width > 40) {
        const tops = laid.map((r) => r.top);
        const sameRow = Math.max(...tops) - Math.min(...tops) <= Math.max(8, 0.3 * Math.min(...laid.map((r) => r.height)));
        const span = Math.max(...laid.map((r) => r.right)) - Math.min(...laid.map((r) => r.left));
        const beyond = laid.filter((r) => r.left >= clipRect.right - 1 || r.right <= clipRect.left + 1).length;
        if (sameRow && beyond >= 1 && span > clipRect.width + 4) {
          const moved = cs.transform !== "none" || kids.slice(0, 3).some((child) => win.getComputedStyle(child).transform !== "none");
          return { kind: moved ? "transform" : "flex", clip, clipRect, kids: kids.length, looked: 0, unread: 0, shown: undefined };
        }
      }
    }
    const hint = hintsOf([el, clip, el.parentElement]).length > 0;
    // Slides on top of each other need a name a library knows, or to be placed absolutely; most boxes fail at their first child.
    if (hint || kids.every((child) => win.getComputedStyle(child).position === "absolute")) {
      const states = kids.map((child) => ({ cs: win.getComputedStyle(child), r: child.getBoundingClientRect() }));
      const shown = states.filter((st) => st.cs.display !== "none" && st.cs.visibility === "visible" && Number(st.cs.opacity) > 0.5 && st.r.width > 0);
      const laid = states.filter((st) => st.cs.display !== "none" && st.r.width > 0);
      const stacked = laid.every((st) => Math.abs(st.r.left - laid[0].r.left) <= 2 && Math.abs(st.r.top - laid[0].r.top) <= 2);
      const panels = kids.some((child) => child.getAttribute("role") === "tabpanel");
      if (shown.length === 1 && states.length - shown.length >= 1 && stacked && !panels && (hint || laid.length >= 2)) {
        const box = clip ?? el;
        const found: SliderFound = { kind: "stack", clip: box, clipRect: box.getBoundingClientRect(), kids: kids.length, looked: 0, unread: 0, shown: undefined };
        // One of several boxes showing is also what tabs, an accordion and a step-by-step form look like: it is a slider only when the page says so
        // (a library's name) or has the buttons of one (previous and next, or dots).
        if (hint || arrowsOf(found, el).length > 0 || dotsOf(found, el) !== null) return found;
      }
    }
    return null;
  }

  /** Previous and next buttons near a track, found by their label, role or class. */
  function arrowsOf(found: SliderFound, track: Element): SliderControl[] {
    const root = found.clip.parentElement && found.clip.parentElement !== doc.body ? found.clip.parentElement : found.clip;
    const reach = 90;
    const cr = found.clipRect;
    const out: SliderControl[] = [];
    const candidates = Array.from(root.querySelectorAll('button, a, [role="button"], [class*="arrow"], [class*="prev"], [class*="next"]')).slice(0, 600);
    for (const candidate of candidates) {
      if (out.length >= 6) break;
      if (track.contains(candidate)) continue;
      const r = candidate.getBoundingClientRect();
      if (r.width < 12 || r.height < 12 || r.width > 96 || r.height > 96) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < cr.left - reach || cx > cr.right + reach || cy < cr.top - reach || cy > cr.bottom + reach) continue;
      const style = win.getComputedStyle(candidate);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const label = (candidate.getAttribute("aria-label") || candidate.getAttribute("title") || (candidate.textContent || "").trim()).replace(/\s+/g, " ").slice(0, 60);
      const classes = classesOf(candidate).join(" ");
      const named = (words: string, glyphs: string[]) => new RegExp(`(^|[^a-z])(${words})([^a-z]|$)`, "i").test(label) || new RegExp(`(^|[\\s_-])(${words})`, "i").test(classes) || glyphs.indexOf(label) >= 0;
      const prev = named("prev|previous|back|forrige|föregående", ["<", "‹", "«", "←", "❮", "❰", "⟨"]);
      const next = named("next|forward|neste|nästa|næste", [">", "›", "»", "→", "❯", "❱", "⟩"]);
      if (!prev && !next) continue;
      out.push({ dir: prev && !next ? "prev" : next && !prev ? "next" : "", label, sel: describe(candidate), box: box4(r) });
    }
    return out;
  }

  /** A row of dots the page names as such: a tablist, or a box named for pagination, dots or bullets, with as many small buttons as dots. */
  function dotsOf(found: SliderFound, track: Element): CaptureSlider["dots"] {
    const root = found.clip.parentElement && found.clip.parentElement !== doc.body ? found.clip.parentElement : found.clip;
    // Tabs that carry words are tabs, not dots: dots are buttons with no label of their own beyond a name (`Go to slide 2`) or a number.
    const dotLike = (el: Element) => Array.from(el.querySelectorAll('[role="tab"]')).every((tab) => (tab.textContent || "").trim().length <= 2);
    const list = Array.from(root.querySelectorAll('[role="tablist"]')).find((el) => !track.contains(el) && el.querySelectorAll('[role="tab"]').length >= 2 && dotLike(el));
    if (list) {
      const r = list.getBoundingClientRect();
      return { count: list.querySelectorAll('[role="tab"]').length, role: "tablist", sel: describe(list), box: box4(r) };
    }
    for (const named of Array.from(root.querySelectorAll('[class*="pagination"], [class*="dots"], [class*="bullets"], [class*="indicators"]'))) {
      if (track.contains(named) || named.children.length < 2 || named.children.length > 40) continue;
      const kids = Array.from(named.children).map((child) => child.getBoundingClientRect());
      if (!kids.every((r) => r.width >= 2 && r.width <= 40 && r.height >= 2 && r.height <= 40)) continue;
      return { count: named.children.length, role: "named", sel: describe(named), box: box4(named.getBoundingClientRect()) };
    }
    return null;
  }

  /** The words a slide holds as the page draws them: what is not drawn (hidden, see-through, a screen-reader's pixel) is left out, as in a text's runs. */
  function slideText(root: Element, vis: boolean): string {
    let out = "";
    function visit(node: Node) {
      if (node.nodeType === 3) {
        out += node.nodeValue || "";
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node as Element;
      if (SKIP.indexOf(element.tagName) >= 0 || element.tagName.toUpperCase() === "SVG") return;
      if (element === root) {
        for (let child = element.firstChild; child; child = child.nextSibling) visit(child);
        return;
      }
      const style = win.getComputedStyle(element);
      if (style.display === "none" || Number(style.opacity) === 0) return;
      if (!vis && (style.visibility === "hidden" || style.visibility === "collapse")) return;
      if ((style.position === "absolute" || style.position === "fixed") && element.getBoundingClientRect().width <= 1 && element.getBoundingClientRect().height <= 1) return;
      if (element.tagName === "BR") {
        out += " ";
        return;
      }
      const block = !INLINE.test(style.display);
      if (block) out += " ";
      for (let child = element.firstChild; child; child = child.nextSibling) visit(child);
      if (block) out += " ";
    }
    visit(root);
    return out.replace(/\s+/g, " ").trim();
  }

  /** The addresses of a slide's pictures, loaded or not: its `src`, a lazy-loading attribute, the first of a `srcset`. */
  function slideImages(root: Element): string[] {
    const urls: string[] = [];
    const push = (value: string | null | undefined) => {
      const first = (value || "").split(",")[0].trim().split(/\s+/)[0];
      const url = absolute(first || null);
      if (url && urls.indexOf(url) < 0 && urls.length < 8) urls.push(url);
    };
    for (const image of Array.from(root.querySelectorAll("img"))) {
      const el = image as HTMLImageElement;
      push(el.currentSrc || el.getAttribute("src"));
      for (const name of LAZY) push(el.getAttribute(name));
      push(el.getAttribute("srcset"));
    }
    for (const source of Array.from(root.querySelectorAll("picture source"))) push(source.getAttribute("srcset") || source.getAttribute("data-srcset"));
    return urls;
  }

  /** A slide's parts in order, by what they are: `I` picture, `H` heading, `B` link or button with words, `T` text. From the elements, so a slide with no box has one. */
  function slideSig(root: Element, vis: boolean): string {
    let out = "";
    function visit(element: Element) {
      if (SKIP.indexOf(element.tagName) >= 0) return;
      const tag = element.tagName.toUpperCase();
      if (element !== root) {
        const style = win.getComputedStyle(element);
        if (style.display === "none" || Number(style.opacity) === 0) return;
        if (!vis && (style.visibility === "hidden" || style.visibility === "collapse")) return;
      }
      if (tag === "IMG" || tag === "SVG" || tag === "CANVAS" || tag === "PICTURE") {
        out += "I";
        return;
      }
      if (tag === "VIDEO" || tag === "IFRAME") {
        out += "V";
        return;
      }
      if (/^H[1-6]$/.test(tag)) {
        if ((element.textContent || "").trim() !== "") out += "H";
        return;
      }
      if (tag === "A" || tag === "BUTTON") {
        if (element.querySelector("img, svg, picture")) out += "I";
        if ((element.textContent || "").trim() !== "") out += "B";
        return;
      }
      let own = false;
      for (let child = element.firstChild; child; child = child.nextSibling) if (child.nodeType === 3 && (child.nodeValue || "").trim() !== "") own = true;
      if (own) out += "T";
      for (const child of Array.from(element.children)) visit(child);
    }
    visit(root);
    return out.slice(0, 80);
  }

  /** The addresses a slide's links go to, in order. */
  function slideLinks(root: Element): string[] {
    const urls: string[] = [];
    const own = root.tagName === "A" ? [root] : [];
    for (const link of [...own, ...Array.from(root.querySelectorAll("a[href]"))]) {
      const url = absolute(link.getAttribute("href"));
      if (url && urls.indexOf(url) < 0 && urls.length < 8) urls.push(url);
    }
    return urls;
  }

  function slideMark(el: Element, hide: SlideHide | undefined, vis: boolean): SlideMark {
    const mark: SlideMark = { text: slideText(el, vis).slice(0, 1500), imgs: slideImages(el), sig: slideSig(el, vis) };
    const links = slideLinks(el);
    if (links.length > 0) mark.links = links;
    if (hide) mark.hide = hide;
    const tokens = classesOf(el);
    const clone = tokens.find((token) => CLONE_CLASSES.indexOf(token) >= 0 || token.indexOf("swiper-slide-duplicate") === 0);
    if (clone) mark.clone = clone;
    for (const name of KEY_ATTRS) {
      const value = el.getAttribute(name);
      if (value !== null && value !== "") {
        mark.key = value.slice(0, 20);
        break;
      }
    }
    return mark;
  }

  /**
   * A tile of a slider's track, kept whether it shows or not. A slide that is `display: none` is shown for as long as it takes to be measured,
   * in the display of a sibling that shows (or `block`; worked out once for the track), and put back as it was. A copy the library made to loop (told by
   * its marker) is read for its words and pictures only, with no parts of its own: it would spend the page's node budget and is left out of the copy
   * all the same. At most `TILES_MAX` tiles of a track are read, and none once the page's node budget is spent; the rest are counted, not read.
   */
  function tileNodes(el: Element, path: string, depth: number, found: SliderFound): CaptureNode[] {
    if (SKIP.indexOf(el.tagName) >= 0) return [];
    if (count >= options.maxNodes) {
      capped = true;
      found.unread += 1;
      return [];
    }
    found.looked += 1;
    if (found.looked > TILES_MAX) {
      found.unread += 1;
      return [];
    }
    const cs0 = win.getComputedStyle(el);
    const r0 = el.getBoundingClientRect();
    let hide: SlideHide | undefined;
    if (cs0.display === "none") hide = "none";
    else if (cs0.visibility === "hidden" || cs0.visibility === "collapse") hide = "visibility";
    else if (Number(cs0.opacity) < 0.02) hide = "opacity";
    else if (found.kind !== "stack" && r0.width > 0 && (r0.right <= found.clipRect.left + 1 || r0.left >= found.clipRect.right - 1)) hide = "outside";
    const style = (el as HTMLElement).style;
    let restore: (() => void) | null = null;
    if (hide === "none" && style) {
      if (found.shown === undefined) {
        found.shown = null;
        for (const child of Array.from(el.parentElement ? el.parentElement.children : [])) {
          const display = win.getComputedStyle(child).display;
          if (display !== "none") {
            found.shown = display;
            break;
          }
        }
      }
      const before = style.getPropertyValue("display");
      const priority = style.getPropertyPriority("display");
      style.setProperty("display", found.shown || "block", "important");
      restore = () => {
        if (before) style.setProperty("display", before, priority);
        else style.removeProperty("display");
      };
    }
    try {
      const vis = hide === "visibility";
      const mark = slideMark(el, hide, vis);
      // A slide half in view has parts beyond the box, and they are the slide's all the same.
      const partial = !hide && r0.width > 0 && (r0.left < found.clipRect.left - 1 || r0.right > found.clipRect.right + 1);
      const nodes = nodesOf(el, path, depth, hide ? { vis, root: true } : partial ? { vis: false, root: false } : null, mark.clone !== undefined);
      if (nodes.length > 0) nodes[0].slide = mark;
      return nodes;
    } finally {
      if (restore) restore();
    }
  }

  function nodeOf(el: Element, path: string, depth: number, force: Force = null, shallow = false): CaptureNode | null {
    if (count >= options.maxNodes) {
      capped = true;
      return null;
    }
    if (SKIP.indexOf(el.tagName) >= 0) return null;
    const cs = win.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (cs.position === "fixed") {
      // A bar at the top of the page is part of it; every other thing fixed to the screen is an overlay.
      const top = rect.top <= 4 && rect.height <= 220 && rect.width >= options.width * 0.8;
      if (!top) {
        fixed.push(describe(el));
        return null;
      }
    }
    // A slider's track is read before it is judged: a library moves the track out of the box that clips it (its own box is then wholly outside),
    // and its slides are what is in the box. Worked out once, and only when the track would otherwise be left out or is a candidate.
    let track: SliderFound | null | undefined;
    const trackOf = (): SliderFound | null => {
      if (track === undefined) track = !force && path !== "" ? sliderOf(el, cs) : null;
      return track;
    };
    if (!visible(el, cs, rect, force) || (!force && clippedAway(el, cs, rect) && !trackOf())) {
      hidden += 1;
      return null;
    }
    const box: [number, number, number, number] = [Math.round((rect.left + scrollX) * 10) / 10, Math.round((rect.top + scrollY) * 10) / 10, Math.round(rect.width * 10) / 10, Math.round(rect.height * 10) / 10];
    // Wider slides and menus parked off the screen are not part of the page as it is seen.
    if ((box[0] >= options.width + 2 || box[0] + box[2] <= -2) && !force && !inScroller(el) && !trackOf()) {
      hidden += 1;
      return null;
    }
    count += 1;
    const tag = el.tagName.toLowerCase();
    const media = mediaOf(el, cs);
    // A box is read as far as it is seen (not a picture, which is drawn whole and cropped by its frame, nor a slide of a track).
    const whole = box[3];
    if (!force && !media && !inScroller(el)) box[3] = Math.round((Math.max(rect.top, seenBottom(el, cs, rect)) - rect.top) * 10) / 10;
    const text = !media && isTextual(el, Boolean(force?.vis));
    const node: CaptureNode = { p: path, tag, box, s: styleOf(cs, text || tag === "li", true), children: [] };
    // Cut off by a box that clips it (a "read more" text): the copy clips it at the same height.
    if (box[3] < whole - 4) node.cut = true;
    const sel = describe(el);
    if (sel !== tag) node.sel = sel;
    const gen = path !== "" ? observe(el, cs, box[1]) : [];
    if (gen.length > 0) node.gen = gen;
    if (scrollsSideways(el, cs)) {
      node.scroll = true;
      if (el.children.length >= 2) {
        // Watched for autoplay (`replicate-watch.ts`): a track with at least two tiles. Its previous and next buttons and dots are found as a script slider's are.
        el.setAttribute("data-rp-track", path);
        const asTrack: SliderFound = { kind: "flex", clip: el, clipRect: rect, kids: el.children.length, looked: 0, unread: 0, shown: undefined };
        node.controls = { arrows: arrowsOf(asTrack, el), dots: dotsOf(asTrack, el) };
      }
    }
    const found = !media && !text ? trackOf() : null;
    if (found) {
      node.scroll = true;
      node.slider = {
        kind: found.kind,
        clip: box4(found.clipRect),
        tiles: found.kids,
        hints: hintsOf([el, found.clip, el.parentElement]),
        arrows: arrowsOf(found, el),
        dots: dotsOf(found, el),
      };
      el.setAttribute("data-rp-track", path);
      note("scrollers", el, box[1], `script slider (${found.kind})`);
    }
    if (media) node.media = media;
    if (el.id && /^rp\d+$/.test(el.id)) node.id = el.id;
    if (media && (media.kind === "svg" || media.kind === "canvas")) el.setAttribute("data-rp", path);
    if (tag === "a") {
      const href = absolute(el.getAttribute("href"));
      if (href) node.href = href;
    }
    const background = cs.backgroundImage !== "none" ? backgroundList(cs.backgroundImage) : [];
    if (background.length > 0) node.bg = background;
    if (text) {
      node.runs = runsOf(el, cs, Boolean(force?.vis));
      if (buttonLike(el, cs, true)) node.button = true;
      const chars = node.runs.reduce((n, run) => n + (run.t ? run.t.length : 0), 0);
      const family = (cs.fontFamily.split(",")[0] || "").trim().replace(/^["']|["']$/g, "");
      const key = `${family}|${cs.fontWeight}|${cs.fontStyle}`;
      const used = fontUse.get(key);
      if (used) used.chars += chars;
      else fontUse.set(key, { family, weight: cs.fontWeight, style: cs.fontStyle, chars });
      return node;
    }
    if (media) return node;
    // A copy a library made to loop is read for its words and picture (its mark) and no deeper: its parts would only spend the page's node budget.
    if (depth > 60 || shallow) return node;
    let index = 0;
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        const element = child as Element;
        const childPath = path === "" ? String(index) : `${path}/${index}`;
        const childNodes = found ? tileNodes(element, childPath, depth + 1, found) : nodesOf(element, childPath, depth + 1, force && { vis: force.vis, root: false });
        if (counted(element)) index += 1;
        node.children.push(...childNodes);
        if (found && found.unread > 0 && node.slider) node.slider.unread = found.unread;
      } else if (child.nodeType === 3 && (child.nodeValue || "").trim() !== "") {
        // Loose text beside boxes: its own text node, where the browser drew it.
        const range = doc.createRange();
        range.selectNodeContents(child);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          count += 1;
          const loose: CaptureNode = {
            p: `${path === "" ? "" : `${path}/`}t${index}`,
            tag: "#text",
            box: [Math.round((r.left + scrollX) * 10) / 10, Math.round((r.top + scrollY) * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
            s: styleOf(cs, true, false),
            runs: [{ t: (child.nodeValue || "").replace(/[\t\n\r ]+/g, " ").trim() }],
            children: [],
          };
          node.children.push(loose);
          const family = (cs.fontFamily.split(",")[0] || "").trim().replace(/^["']|["']$/g, "");
          const key = `${family}|${cs.fontWeight}|${cs.fontStyle}`;
          const used = fontUse.get(key);
          const chars = (child.nodeValue || "").trim().length;
          if (used) used.chars += chars;
          else fontUse.set(key, { family, weight: cs.fontWeight, style: cs.fontStyle, chars });
        }
      }
    }
    return node;
  }

  const body = doc.body;
  const root = nodeOf(body, "", 0) || { p: "", tag: "body", box: [0, 0, options.width, 0] as [number, number, number, number], s: { display: "block" }, children: [] };
  const paint = (el: Element) => win.getComputedStyle(el).backgroundColor;
  const rootPaint = paint(doc.documentElement);
  const background = rootPaint !== "rgba(0, 0, 0, 0)" ? rootPaint : paint(body);
  const description = doc.querySelector('meta[name="description"]');
  const height = Math.max(doc.documentElement.scrollHeight, body.scrollHeight);
  const width = Math.max(doc.documentElement.scrollWidth, body.scrollWidth);
  return {
    title: (doc.title || "").trim(),
    lang: (doc.documentElement.lang || "").trim(),
    description: ((description && description.getAttribute("content")) || "").trim(),
    docWidth: width,
    docHeight: height,
    background: background === "rgba(0, 0, 0, 0)" ? "rgb(255, 255, 255)" : background,
    root,
    fonts: Array.from(fontUse.values()).sort((a, b) => b.chars - a.chars),
    left: { fixed: fixed.slice(0, 20), hidden, capped },
    extras,
  };
}
