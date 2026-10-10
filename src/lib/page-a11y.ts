/**
 * The page builder's checker (wave 1, 1e, `docs/wave-1-trust.md` 2.2): lists what is wrong with a draft that a shopper,
 * a screen reader or a regulator would meet: a picture with no alt text, a link or button with nothing in it, text that
 * is hard to read on its background, headings out of order, a `[[placeholder]]` left in a starter text, the legal review
 * notice, and on the checkout page what the payment policy would break. Pure; the builder shows the list in its Checks
 * tab with a link to each block, and `savePage()` runs it again on the server, so what publishing with a blocking issue
 * asks for cannot be skipped by skipping the dialog.
 *
 * It reads only the page's own content. It cannot know the final colour behind text laid over a picture, a video or a
 * gradient (those are not checked, and the tab says so), nor a background that is see-through. Text that is see-through
 * (D180: a colour with an opacity) is blended over its background first (`blend()`), at every screen size where the text's
 * colour or the background differs (`valueAt()`, `colourAt()`); a block's text with no colour of its own takes its column's,
 * else its row's, as the browser passes it down. A passing check does not make a page accessible: it finds some of the
 * problems, the ones a machine can see.
 */
import { SIZES, SIZE_LABELS, type Size } from "./breakpoints";
import { blend } from "./colour";
import { inlinePlain } from "./inline-text";
import { contrastRatio } from "./theme";
import type { PageBlock, PageColumn, PageContent, PageRow, RichTextDoc, BlockNode, InlineNode } from "./page-content";
import { footerHasWithdrawal, footerRequired, siteBlocks } from "./site-layout";
import { localizePage } from "./page-translation";
import { valueAt } from "./responsive";
import { colourAt, textRoles, type RoleDef } from "./typography";

export const PAGE_ISSUE_RULES = [
  "image_alt",
  "empty_link",
  "contrast",
  "heading_order",
  "heading_empty",
  "alt_long",
  "link_text_generic",
  "placeholder",
  "legal_notice",
  "pay_page_block",
  "footer_legal",
] as const;
export type PageIssueRule = (typeof PAGE_ISSUE_RULES)[number];
export type IssueSeverity = "blocking" | "warning";

/** How serious each rule is: blocking asks before publishing, a warning does not. */
export const RULE_SEVERITY: Record<PageIssueRule, IssueSeverity> = {
  image_alt: "blocking",
  empty_link: "blocking",
  contrast: "blocking",
  heading_order: "warning",
  heading_empty: "blocking",
  alt_long: "warning",
  link_text_generic: "warning",
  placeholder: "blocking",
  legal_notice: "blocking",
  pay_page_block: "blocking",
  footer_legal: "warning",
};

/** What the owner is told each rule found, in a few words (the title of a group in the tab). */
export const RULE_TITLE: Record<PageIssueRule, string> = {
  image_alt: "Picture with no alt text",
  empty_link: "Link or button with nothing in it",
  contrast: "Text hard to read on its background",
  heading_order: "Headings out of order",
  heading_empty: "Heading with no text",
  alt_long: "Very long alt text",
  link_text_generic: "Link that does not say where it goes",
  placeholder: "Text still to fill in",
  legal_notice: "Draft notice still on the page",
  pay_page_block: "Not allowed on the checkout page",
  footer_legal: "Footer missing what the law asks",
};

export type PageIssue = {
  rule: PageIssueRule;
  severity: IssueSeverity;
  /** The block the issue is in; null for the page's own title. */
  blockId: string | null;
  rowId: string | null;
  columnId: string | null;
  /** The kind of block, for the tab's link: "Picture", "Button", … */
  where: string;
  message: string;
};

/** The colours of the theme, one set for each look the site shows (light, dark): where a text has no colour of its own it is the theme's. */
export type ThemeSet = { name: string; text: string; background: string };

export type CheckContext = {
  /** The theme's colours, so text with no colour of its own is checked against its background. Left out: only explicit colours are. */
  theme?: { sets: readonly ThemeSet[] };
  /** The page is the one chosen for the checkout: what the payment policy would break is refused (`pay_page_block`). */
  checkout?: boolean;
  /** The page is a footer (of the store, or Kaizen's with null): what the law asks to be in it and is missing is a warning (`footer_legal`), never a reason not to save. */
  footer?: { storeId: string | null };
};

/** The longest alt text before it is a warning; a convention, not a WCAG rule. */
export const ALT_ADVISED_MAX = 125;
/** WCAG's minimum contrast for text of any size, the stricter figure, as the size of the text is not known here. */
export const MIN_CONTRAST = 4.5;
/** The class the review notice's block carries. */
export const LEGAL_NOTICE_CLASS = "legal-review-notice";

/** `[[Add: delivery time]]`: what a starter leaves for a fact the store does not hold. */
export const PLACEHOLDER = /\[\[[^\]]*\]\]/;

const GENERIC_LINK_TEXT = new Set([
  "click here", "here", "read more", "more", "learn more", "more info", "link", "this link", "click", "details",
  "klikk her", "her", "les mer", "mer", "les mer her", "se mer", "trykk her", "mer info", "lenke",
  "klicka här", "här", "läs mer", "mer", "se mer", "mer info", "länk",
  "klik her", "læs mere", "mere", "se mere", "mere info", "link her",
]);

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.!?…»«>→:;,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether the words of a link say nothing about where it goes. */
export const isGenericLinkText = (text: string): boolean => GENERIC_LINK_TEXT.has(norm(text));

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** `#abc` and `#aabbcc` as `#aabbcc`; null for anything else (a name, a variable, `rgb()`), which is not checked. */
function hex6(color: string | undefined): string | null {
  if (!color || !HEX.test(color)) return null;
  if (color.length === 7) return color.toLowerCase();
  return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toLowerCase();
}

/** The solid colour of a background, or null where it is none, a picture, a video, a gradient or see-through (not known here). */
function solid(background: { type: string; color?: string; opacity?: number } | undefined): string | null {
  if (!background || background.type !== "color") return null;
  if (background.opacity !== undefined && background.opacity < 100) return null;
  return hex6(background.color);
}

const BLOCK_WORDS: Partial<Record<PageBlock["type"], string>> = {
  richText: "Text",
  image: "Picture",
  heading: "Heading",
  button: "Button",
  dualButton: "Buttons",
  html: "HTML",
  video: "Video",
  socialLinks: "Social links",
  accordion: "Accordion",
  faq: "Questions",
  tabs: "Tabs",
  iconList: "Icon list",
  table: "Table",
};
const blockWord = (block: PageBlock) => BLOCK_WORDS[block.type] ?? "Component";

// ---------------------------------------------------------------------------
// Walking rich text
// ---------------------------------------------------------------------------

type RichFacts = {
  text: string;
  /** Headings inside it, in order. */
  headings: { level: number; text: string }[];
  /** Each link's visible text. */
  links: string[];
  /** The colours marked on words (D180), each once. */
  colours: Ink[];
};

function inlineText(nodes: InlineNode[] | undefined): string {
  return (nodes ?? []).map((n) => (n.type === "text" ? n.text : " ")).join("");
}

function richFacts(doc: RichTextDoc | undefined): RichFacts {
  const facts: RichFacts = { text: "", headings: [], links: [], colours: [] };
  const lines: string[] = [];
  const visitInline = (nodes: InlineNode[] | undefined) => {
    // Adjacent text nodes with the same link are one link.
    let run = "";
    let inLink = false;
    const flush = () => {
      if (inLink) facts.links.push(run);
      run = "";
      inLink = false;
    };
    for (const node of nodes ?? []) {
      if (node.type !== "text") {
        flush();
        continue;
      }
      for (const mark of node.marks ?? []) {
        if (mark.type !== "textStyle" || node.text.trim() === "") continue;
        const ink: Ink = { color: mark.attrs.color.toLowerCase(), ...(mark.attrs.opacity !== undefined && { opacity: mark.attrs.opacity }) };
        if (!facts.colours.some((c) => c.color === ink.color && c.opacity === ink.opacity)) facts.colours.push(ink);
      }
      const linked = (node.marks ?? []).some((m) => m.type === "link");
      if (linked !== inLink) flush();
      inLink = linked;
      if (linked) run += node.text;
    }
    flush();
  };
  const walk = (nodes: BlockNode[]) => {
    for (const node of nodes) {
      switch (node.type) {
        case "paragraph":
          lines.push(inlineText(node.content));
          visitInline(node.content);
          break;
        case "heading":
          facts.headings.push({ level: node.attrs.level, text: inlineText(node.content).trim() });
          lines.push(inlineText(node.content));
          visitInline(node.content);
          break;
        case "bulletList":
        case "orderedList":
          for (const item of node.content) walk(item.content);
          break;
        case "blockquote":
          walk(node.content);
          break;
        case "horizontalRule":
          break;
      }
    }
  };
  if (doc) walk(doc.content);
  facts.text = lines.join("\n");
  return facts;
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/** A text's colour and how solid it is (0–100, solid unless set). */
type Ink = { color: string; opacity?: number };

/** What is behind a block's text at a size, as far as is known: the column's solid colour, else the row's. */
function behindAt(row: PageRow, column: PageColumn, size: Size): { color: string | null; unknown: boolean } {
  for (const part of [column, row] as const) {
    const background = valueAt(part, "background", size);
    if (!background) continue;
    const own = solid(background as { type: string; color?: string; opacity?: number });
    return own ? { color: own, unknown: false } : { color: null, unknown: true };
  }
  return { color: null, unknown: false };
}

const TEXT_ROLE: Pick<RoleDef, "role"> = { role: "text" };

/** A part's colour of a kind of text at a size, as a checkable ink (`#rrggbb`); null where it has none or one not checkable. */
function inkAt(part: Parameters<typeof colourAt>[0], def: Pick<RoleDef, "role" | "colourFrom">, size: Size): Ink | null {
  const own = colourAt(part, def, size);
  const color = hex6(own?.color);
  return own && color ? { color, ...(own.opacity !== undefined && { opacity: own.opacity }) } : null;
}

/** The colour a block's text takes from around it at a size: its column's, else its row's (CSS passes colour down). */
const aroundAt = (row: PageRow, column: PageColumn, size: Size): Ink | null => inkAt(column, TEXT_ROLE, size) ?? inkAt(row, TEXT_ROLE, size);

/** Kinds of text drawn on their own fill (a button's), not on the block's background. */
const ON_FILL: ReadonlySet<string> = new Set(["button"]);

export function pageIssues(content: Pick<PageContent, "rows" | "title"> & Partial<Pick<PageContent, "translations" | "seo" | "thumbnail">>, context: CheckContext = {}): PageIssue[] {
  const issues: PageIssue[] = [];
  const add = (rule: PageIssueRule, place: { rowId: string | null; columnId: string | null; blockId: string | null }, where: string, message: string) =>
    issues.push({ rule, severity: RULE_SEVERITY[rule], blockId: place.blockId, rowId: place.rowId, columnId: place.columnId, where, message });

  if (PLACEHOLDER.test(content.title)) add("placeholder", { rowId: null, columnId: null, blockId: null }, "Title", "The page's title has text still to fill in ([[…]]).");

  if (context.footer) {
    const parts = siteBlocks(content);
    const names: Record<string, string> = { business: "the business details", cookies: "the cookies link", withdrawal: "the withdrawal link" };
    const missing = footerRequired(context.footer.storeId)
      .filter((name) => !parts.some((block) => block.part === name))
      .map((name) => names[name]);
    // The site adds the withdrawal link under a footer without it, but only a link in the footer itself, shown at every size, counts here.
    if (context.footer.storeId !== null && !missing.includes(names.withdrawal) && !footerHasWithdrawal(content)) missing.push("the withdrawal link shown at every screen size");
    if (missing.length > 0) {
      add("footer_legal", { rowId: null, columnId: null, blockId: null }, "Footer", `The law asks a footer to show ${missing.join(", ")}. It can be saved without, but is missing: add the components from Building blocks.`);
    }
  }

  let lastLevel = 0;
  let h1 = 0;

  for (const row of content.rows) {
    for (const column of row.columns) {
      for (const block of column.blocks) {
        const place = { rowId: row.id, columnId: column.id, blockId: block.id };
        const where = blockWord(block);

        // Text the owner can still have to fill in, and the notice: any block's class and any words.
        const words = blockWords(block);
        if (words.some((w) => PLACEHOLDER.test(w))) add("placeholder", place, where, "This has text still to fill in: a [[bracketed]] part.");
        if (typeof block.className === "string" && block.className.split(/\s+/).includes(LEGAL_NOTICE_CLASS)) {
          add("legal_notice", place, where, "This is the draft notice. Read the text, fill in what is missing, then delete this block.");
        }

        const heading = (level: number, text: string, bound: boolean) => {
          if (text.trim() === "" && !bound) add("heading_empty", place, where, "A heading with no text is announced to a screen reader as an empty heading.");
          if (level === 1) {
            h1 += 1;
            if (h1 > 1) add("heading_order", place, where, "A page has one main heading (level 1); this is another.");
          }
          if (lastLevel > 0 && level > lastLevel + 1) add("heading_order", place, where, `Heading level ${level} follows level ${lastLevel}: a level is skipped.`);
          lastLevel = level;
        };

        /**
         * Text over a background, at every screen size: a colour with an opacity is blended over what is behind it first. An
         * explicit text colour over an explicit solid background; with the theme, its colour stands in for a missing one
         * (`themeText`: where the text's own is the theme's text colour). One issue a block, naming the sizes where only
         * some fail.
         */
        let contrastAdded = false;
        const textOver = (label: string, at: (size: Size) => { ink: Ink | null; over: string | null; unknown: boolean }, themeText = true) => {
          if (contrastAdded) return;
          let first: { ratio: number; set: string | null } | null = null;
          const failing: Size[] = [];
          for (const size of SIZES) {
            const { ink, over, unknown } = at(size);
            if (unknown) continue;
            const pairs: { text: string; bg: string; set: string | null }[] = [];
            if (ink && over) pairs.push({ text: blend(ink.color, ink.opacity, over), bg: over, set: null });
            else if (context.theme && (ink || over) && (ink || themeText)) {
              for (const set of context.theme.sets) {
                const bg = over ?? hex6(set.background);
                const text = ink ? (bg ? blend(ink.color, ink.opacity, bg) : null) : hex6(set.text);
                if (text && bg) pairs.push({ text, bg, set: set.name });
              }
            }
            const bad = pairs.map((pair) => ({ ratio: contrastRatio(pair.text, pair.bg), set: pair.set })).find((pair) => pair.ratio < MIN_CONTRAST);
            if (!bad) continue;
            failing.push(size);
            first ??= bad;
          }
          if (!first) return;
          contrastAdded = true;
          const sizes = failing.length < SIZES.length ? ` at ${failing.map((size) => SIZE_LABELS[size]).join(", ")}` : "";
          add("contrast", place, where, `${label} is hard to read on its background (${first.ratio.toFixed(1)}:1; aim for ${MIN_CONTRAST}:1)${first.set ? ` in the ${first.set} colours` : ""}${sizes}.`);
        };
        /** A block's own kind of text over its column's or row's background, its colour else the one around it. */
        const ownText = (label: string, def: Pick<RoleDef, "role" | "colourFrom">, inherits: boolean, themeText: boolean) =>
          textOver(
            label,
            (size) => ({ ink: inkAt(block, def, size) ?? (inherits ? aroundAt(row, column, size) : null), ...behindOf(size) }),
            themeText,
          );
        const behindOf = (size: Size) => {
          const back = behindAt(row, column, size);
          return { over: back.color, unknown: back.unknown };
        };
        /** Words coloured in rich text (D180), each colour over the block's background. */
        const marked = (facts: RichFacts) => {
          for (const ink of facts.colours) textOver("Coloured words in this text", (size) => ({ ink, ...behindOf(size) }), false);
        };
        /** A button's text: on its fill where it is filled (when the fill is known), else over the background in its colour or its fill's. */
        const buttonText = (label: string, def: Pick<RoleDef, "role" | "colourFrom">, variant: string | undefined, fill: string | undefined) => {
          if (variant === "filled" || variant === undefined) {
            const over = hex6(fill);
            if (over) textOver(label, (size) => ({ ink: inkAt(block, def, size), over, unknown: false }), false);
          } else {
            const fillInk = hex6(fill);
            textOver(label, (size) => ({ ink: inkAt(block, def, size) ?? (fillInk ? { color: fillInk } : null), ...behindOf(size) }));
          }
        };

        /**
         * Every kind of text a block colours (D180) but text drawn on a button's fill: its own colour (its main text also the
         * column's or row's) over its background.
         */
        const ownColours = () => {
          for (const def of textRoles(block)) {
            if (ON_FILL.has(def.role) || def.colour === false) continue;
            ownText(def.role === "text" ? "The text" : `The ${def.label.toLowerCase()}`, def, def.role === "text", false);
          }
        };

        switch (block.type) {
          case "image": {
            if (block.bind) break;
            if (block.image) {
              const alt = block.image.alt.trim();
              if (alt === "") add("image_alt", place, where, "This picture has no alt text, so a screen reader cannot say what it shows.");
              else if (alt.length > ALT_ADVISED_MAX) add("alt_long", place, where, `The alt text is ${alt.length} characters; aim for under ${ALT_ADVISED_MAX}.`);
            }
            ownColours();
            break;
          }
          case "heading": {
            heading(block.level, inlinePlain(block.text), Boolean(block.bind));
            ownText("The heading", TEXT_ROLE, true, true);
            break;
          }
          case "richText": {
            const facts = richFacts(block.doc);
            for (const h of facts.headings) heading(h.level, h.text, false);
            for (const link of facts.links) {
              if (link.trim() === "") add("empty_link", place, where, "A link in this text has no words.");
              else if (isGenericLinkText(link)) add("link_text_generic", place, where, `The link "${link.trim()}" does not say where it goes.`);
            }
            // Its colour is its own, else its column's or row's, else the theme's; then any words coloured in it.
            ownText("The text", TEXT_ROLE, true, true);
            marked(facts);
            break;
          }
          case "button": {
            if (block.bind) break;
            if (block.label.trim() === "" || block.href.trim() === "") add("empty_link", place, where, block.label.trim() === "" ? "This button has no text." : "This button goes nowhere: it has no address.");
            else if (isGenericLinkText(inlinePlain(block.label))) add("link_text_generic", place, where, `The button "${inlinePlain(block.label).trim()}" does not say where it goes.`);
            buttonText("The button's text", TEXT_ROLE, block.variant, block.fill);
            break;
          }
          case "dualButton": {
            for (const [name, side] of [["first", block.first], ["second", block.second]] as const) {
              const empty = side.label.trim() === "";
              const nowhere = side.href.trim() === "";
              if (empty && nowhere) continue; // not shown: nothing to read
              if (empty || nowhere) add("empty_link", place, where, `The ${name} button ${empty ? "has no text" : "goes nowhere: it has no address"}.`);
              else if (isGenericLinkText(inlinePlain(side.label))) add("link_text_generic", place, where, `The ${name} button "${inlinePlain(side.label).trim()}" does not say where it goes.`);
              else buttonText(`The ${name} button's text`, { role: name, colourFrom: "text" }, side.variant, side.fill);
            }
            break;
          }
          case "socialLinks": {
            for (const link of block.links) if (link.href.trim() === "") add("empty_link", place, where, "A social link has no address.");
            ownColours();
            break;
          }
          case "accordion":
          case "faq":
          case "tabs": {
            for (const item of block.items) {
              const facts = richFacts(item.body);
              for (const link of facts.links) {
                if (link.trim() === "") add("empty_link", place, where, "A link in this text has no words.");
                else if (isGenericLinkText(link)) add("link_text_generic", place, where, `The link "${link.trim()}" does not say where it goes.`);
              }
              marked(facts);
            }
            ownColours();
            break;
          }
          case "html": {
            if (context.checkout) add("pay_page_block", place, where, "The checkout page cannot hold your own HTML: the payment page's security policy would block it.");
            break;
          }
          case "video": {
            if (context.checkout && block.source !== "upload") add("pay_page_block", place, where, "The checkout page cannot embed a video from another site: the payment page's security policy would block it. Upload the video instead.");
            break;
          }
          default:
            ownColours();
            break;
        }
      }
    }
  }

  // What a shopper reading the page in another language sees (D55): the page as `localizePage()` draws it. A starter is written in
  // each of the store's languages we have words for, with its own `[[placeholders]]`, and filling them in the main language does not
  // fill them in the others, so the same check runs over every translation (once for a block the main language already reports).
  for (const locale of Object.keys(content.translations ?? {})) {
    const seen = new Set(issues.filter((i) => i.rule === "placeholder").map((i) => i.blockId ?? "page"));
    const localized = localizePage({ seo: { title: "", description: "" }, ...content } as PageContent, locale);
    if (PLACEHOLDER.test(localized.title) && !seen.has("page")) {
      add("placeholder", { rowId: null, columnId: null, blockId: null }, "Title", `The page's title in ${locale} has text still to fill in ([[…]]).`);
    }
    for (const row of localized.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (seen.has(block.id)) continue;
          if (!blockWords(block).some((w) => PLACEHOLDER.test(w))) continue;
          seen.add(block.id);
          add("placeholder", { rowId: row.id, columnId: column.id, blockId: block.id }, blockWord(block), `This has text still to fill in (a [[bracketed]] part) in the ${locale} translation. Edit the page in that language, or delete the translation.`);
        }
      }
    }
  }
  return issues;
}

/** The words of a block that a person reads, for the checks that look for text still to fill in. */
function blockWords(block: PageBlock): string[] {
  switch (block.type) {
    case "richText":
      return [richFacts(block.doc).text];
    case "heading":
      return [block.text];
    case "button":
      return [block.label];
    case "dualButton":
      return [block.first.label, block.second.label];
    case "image":
      return [block.caption, block.image?.alt ?? ""];
    case "accordion":
    case "faq":
    case "tabs":
      return block.items.flatMap((item) => [item.title, richFacts(item.body).text]);
    case "iconList":
      return block.items.map((item) => item.text);
    case "table":
      return [block.caption ?? "", ...block.rows.flat(), ...(block.sections ?? []).filter((s): s is string => Boolean(s))];
    case "video":
      return [block.title];
    case "html":
      return [block.title];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// What the builder and the server make of the list
// ---------------------------------------------------------------------------

export const blockingIssues = (issues: readonly PageIssue[]): PageIssue[] => issues.filter((i) => i.severity === "blocking");

/** What the checkout page may not hold: refused, not asked about. */
export const refusedIssues = (issues: readonly PageIssue[]): PageIssue[] => issues.filter((i) => i.rule === "pay_page_block");

/** A stable name for an issue, for the owner's acknowledgement: the rule and the block (`image_alt:b1`). */
export const issueId = (issue: Pick<PageIssue, "rule" | "blockId">): string => `${issue.rule}:${issue.blockId ?? "page"}`;

/** Blocking issues the owner has not acknowledged, by an issue's id or by its rule alone (`image_alt` acknowledges every picture). The refused ones are never acknowledged. */
export function unacknowledged(issues: readonly PageIssue[], acknowledged: readonly string[] | undefined): PageIssue[] {
  const seen = new Set(acknowledged ?? []);
  return blockingIssues(issues).filter((i) => i.rule === "pay_page_block" || !(seen.has(issueId(i)) || seen.has(i.rule)));
}

/** `[{ rule, count }]` for the audit entry: how many of each rule, in the rules' order, never the page's text. */
export function issueCounts(issues: readonly PageIssue[]): { rule: PageIssueRule; count: number }[] {
  return PAGE_ISSUE_RULES.map((rule) => ({ rule, count: issues.filter((i) => i.rule === rule).length })).filter((c) => c.count > 0);
}

/** The issues grouped by rule for the tab, blocking ones first. */
export function groupIssues(issues: readonly PageIssue[]): { rule: PageIssueRule; title: string; severity: IssueSeverity; issues: PageIssue[] }[] {
  return PAGE_ISSUE_RULES.map((rule) => ({ rule, title: RULE_TITLE[rule], severity: RULE_SEVERITY[rule], issues: issues.filter((i) => i.rule === rule) }))
    .filter((g) => g.issues.length > 0)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "blocking" ? -1 : 1));
}

/** The colours of the theme the checker needs, one set for each look the site shows. */
export function themeSetsOf(settings: { mode: "auto" | "light" | "dark"; visitorSwitch?: boolean; light: { text: string; background: string }; dark: { text: string; background: string } }): ThemeSet[] {
  const both = settings.mode === "auto" || Boolean(settings.visitorSwitch);
  const sets = both ? (["light", "dark"] as const) : ([settings.mode as "light" | "dark"] as const);
  return sets.map((name) => ({ name, text: settings[name].text, background: settings[name].background }));
}
