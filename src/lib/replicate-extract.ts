import type { CaptureNode, NodeMedia, PageCapture, Run } from "./replicate-capture";

/**
 * Reads a page's boxes and styles in the browser (D150). `page.evaluate()` sends this function's source to the page,
 * so it uses nothing from outside itself: everything it needs is declared inside or passed in `options`. It walks the
 * body once, keeps what is visible and in the page, collects a text element's words as runs (bold, italic, underline
 * and links kept), notes pictures, videos and embeds, and marks the elements that are pictures to take (`svg`,
 * `canvas`) with `data-rp` so the server can photograph them. Overlays fixed to the screen (cookie banners, chat
 * widgets) are left out and named, because a copy of a page has no use for them.
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

  /** What an element does that its box does not show. */
  function observe(el: Element, cs: CSSStyleDeclaration, y: number) {
    if (cs.position === "sticky") note("sticky", el, y);
    if (cs.animationName !== "none" && cs.animationName !== "" && cs.animationDuration !== "0s") note("animated", el, y, cs.animationName.split(",")[0]);
    if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 4) note("scrollers", el, y);
    const role = el.getAttribute("role") || "";
    const roledescription = (el.getAttribute("aria-roledescription") || "").toLowerCase();
    if (ROLES.indexOf(role) >= 0) note("roles", el, y, role);
    else if (roledescription) note("roles", el, y, roledescription);
    for (const which of ["::before", "::after"]) {
      const pseudo = win.getComputedStyle(el, which);
      const content = pseudo.content;
      if (content === "none" || content === "normal" || content === "") continue;
      const empty = content === '""' || content === "''";
      const paints = pseudo.backgroundImage !== "none" || pseudo.backgroundColor !== "rgba(0, 0, 0, 0)";
      if (empty && !(paints && parseFloat(pseudo.width) > 0 && parseFloat(pseudo.height) > 0)) continue;
      note("pseudo", el, y, `${which} ${empty ? "a shape" : content.slice(0, 30)}`);
    }
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

  function visible(el: Element, cs: CSSStyleDeclaration, rect: DOMRect): boolean {
    if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
    if (Number(cs.opacity) === 0) return false;
    if (rect.width <= 0 && rect.height <= 0) return false;
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

  const INLINE = /^(inline|inline-block|inline-flex|inline-grid|contents|ruby)/;

  /** Whether a block holds only text and inline elements, so it is one piece of text. */
  function isTextual(el: Element): boolean {
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
      if (cs.display === "none") continue;
      if (!INLINE.test(cs.display) || cs.position === "absolute" || cs.position === "fixed" || cs.cssFloat !== "none") return false;
      if (["IMG", "SVG", "VIDEO", "IFRAME", "CANVAS", "INPUT", "SELECT", "TEXTAREA", "BUTTON", "PICTURE"].indexOf(element.tagName.toUpperCase()) >= 0) return false;
      // An inline box with its own look (a badge, a pill) is more than text.
      if (cs.backgroundImage !== "none") return false;
      if (!isTextual(element)) return false;
      if ((element.textContent || "").trim() !== "") text = true;
    }
    return text;
  }

  function runsOf(el: Element, root: CSSStyleDeclaration): Run[] {
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
      if (cs.display === "none") return;
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
      const url = absolute(img.currentSrc || img.getAttribute("src"));
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

  function nodesOf(el: Element, path: string, depth: number): CaptureNode[] {
    if (SKIP.indexOf(el.tagName) < 0 && isHolder(el)) {
      const found: CaptureNode[] = [];
      let index = 0;
      for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1) continue;
        found.push(...nodesOf(child as Element, `${path}/${index}`, depth + 1));
        index += 1;
      }
      return found;
    }
    const node = nodeOf(el, path, depth);
    return node ? [node] : [];
  }

  function nodeOf(el: Element, path: string, depth: number): CaptureNode | null {
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
    if (!visible(el, cs, rect) || clippedAway(el, cs, rect)) {
      hidden += 1;
      return null;
    }
    const box: [number, number, number, number] = [Math.round((rect.left + scrollX) * 10) / 10, Math.round((rect.top + scrollY) * 10) / 10, Math.round(rect.width * 10) / 10, Math.round(rect.height * 10) / 10];
    // Wider slides and menus parked off the screen are not part of the page as it is seen.
    if ((box[0] >= options.width + 2 || box[0] + box[2] <= -2) && !inScroller(el)) {
      hidden += 1;
      return null;
    }
    count += 1;
    const tag = el.tagName.toLowerCase();
    const media = mediaOf(el, cs);
    const text = !media && isTextual(el);
    const node: CaptureNode = { p: path, tag, box, s: styleOf(cs, text || tag === "li", true), children: [] };
    const sel = describe(el);
    if (sel !== tag) node.sel = sel;
    if (path !== "") observe(el, cs, box[1]);
    if (scrollsSideways(el, cs)) node.scroll = true;
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
      node.runs = runsOf(el, cs);
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
    if (depth > 60) return node;
    let index = 0;
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        const element = child as Element;
        const childNodes = nodesOf(element, path === "" ? String(index) : `${path}/${index}`, depth + 1);
        index += 1;
        node.children.push(...childNodes);
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
