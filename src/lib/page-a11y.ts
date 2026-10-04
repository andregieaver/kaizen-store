/**
 * The page builder's checker (wave 1, 1e, `docs/wave-1-trust.md` 2.2): lists what is wrong with a draft that a shopper,
 * a screen reader or a regulator would meet: a picture with no alt text, a link or button with nothing in it, text that
 * is hard to read on its background, headings out of order, a `[[placeholder]]` left in a starter text, the legal review
 * notice, and on the checkout page what the payment policy would break. Pure; the builder shows the list in its Checks
 * tab with a link to each block, and `savePage()` runs it again on the server, so what publishing with a blocking issue
 * asks for cannot be skipped by skipping the dialog.
 *
 * It reads only the page's own content. It cannot know the final colour behind text laid over a picture, a video or a
 * gradient (those are not checked, and the tab says so), nor a colour that is see-through. A passing check does not make a
 * page accessible: it finds some of the problems, the ones a machine can see.
 */
import { contrastRatio } from "./theme";
import type { PageBlock, PageColumn, PageContent, PageRow, RichTextDoc, BlockNode, InlineNode } from "./page-content";
import { localizePage } from "./page-translation";

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
};

function inlineText(nodes: InlineNode[] | undefined): string {
  return (nodes ?? []).map((n) => (n.type === "text" ? n.text : " ")).join("");
}

function richFacts(doc: RichTextDoc | undefined): RichFacts {
  const facts: RichFacts = { text: "", headings: [], links: [] };
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

/** What is behind a block's text, as far as is known: the column's solid colour, else the row's. */
function behind(row: PageRow, column: PageColumn): { color: string | null; unknown: boolean } {
  if (column.background) {
    const own = solid(column.background);
    return own ? { color: own, unknown: false } : { color: null, unknown: true };
  }
  if (row.background) {
    const own = solid(row.background as { type: string; color?: string; opacity?: number });
    return own ? { color: own, unknown: false } : { color: null, unknown: true };
  }
  return { color: null, unknown: false };
}

export function pageIssues(content: Pick<PageContent, "rows" | "title"> & Partial<Pick<PageContent, "translations" | "seo" | "thumbnail">>, context: CheckContext = {}): PageIssue[] {
  const issues: PageIssue[] = [];
  const add = (rule: PageIssueRule, place: { rowId: string | null; columnId: string | null; blockId: string | null }, where: string, message: string) =>
    issues.push({ rule, severity: RULE_SEVERITY[rule], blockId: place.blockId, rowId: place.rowId, columnId: place.columnId, where, message });

  if (PLACEHOLDER.test(content.title)) add("placeholder", { rowId: null, columnId: null, blockId: null }, "Title", "The page's title has text still to fill in ([[…]]).");

  let lastLevel = 0;
  let h1 = 0;

  for (const row of content.rows) {
    for (const column of row.columns) {
      const back = behind(row, column);
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

        const textOver = (textColor: string | null, label: string, over: string | null, overUnknown: boolean) => {
          // An explicit text colour over an explicit solid background; with the theme, the theme's colour stands in for a missing one.
          if (overUnknown) return;
          const pairs: { text: string; bg: string; set: string | null }[] = [];
          if (textColor && over) pairs.push({ text: textColor, bg: over, set: null });
          else if (context.theme) {
            for (const set of context.theme.sets) {
              const text = textColor ?? hex6(set.text);
              const bg = over ?? hex6(set.background);
              // Nothing of the page's own to hold it to when neither colour is the owner's.
              if (!textColor && !over) continue;
              if (text && bg) pairs.push({ text, bg, set: set.name });
            }
          }
          for (const pair of pairs) {
            const ratio = contrastRatio(pair.text, pair.bg);
            if (ratio < MIN_CONTRAST) {
              add("contrast", place, where, `${label} is hard to read on its background (${ratio.toFixed(1)}:1; aim for ${MIN_CONTRAST}:1)${pair.set ? ` in the ${pair.set} colours` : ""}.`);
              break;
            }
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
            break;
          }
          case "heading": {
            heading(block.level, block.text, Boolean(block.bind));
            textOver(hex6(block.textColor), "The heading", back.color, back.unknown);
            break;
          }
          case "richText": {
            const facts = richFacts(block.doc);
            for (const h of facts.headings) heading(h.level, h.text, false);
            for (const link of facts.links) {
              if (link.trim() === "") add("empty_link", place, where, "A link in this text has no words.");
              else if (isGenericLinkText(link)) add("link_text_generic", place, where, `The link "${link.trim()}" does not say where it goes.`);
            }
            // Rich text has no colour of its own: it is the theme's.
            textOver(null, "The text", back.color, back.unknown);
            break;
          }
          case "button": {
            if (block.bind) break;
            if (block.label.trim() === "" || block.href.trim() === "") add("empty_link", place, where, block.label.trim() === "" ? "This button has no text." : "This button goes nowhere: it has no address.");
            else if (isGenericLinkText(block.label)) add("link_text_generic", place, where, `The button "${block.label.trim()}" does not say where it goes.`);
            if (block.variant === "filled" || block.variant === undefined) {
              const fill = hex6(block.fill);
              const text = hex6(block.textColor);
              if (fill && text) textOver(text, "The button's text", fill, false);
            } else textOver(hex6(block.textColor ?? block.fill), "The button's text", back.color, back.unknown);
            break;
          }
          case "dualButton": {
            for (const [name, side] of [["first", block.first], ["second", block.second]] as const) {
              const empty = side.label.trim() === "";
              const nowhere = side.href.trim() === "";
              if (empty && nowhere) continue; // not shown: nothing to read
              if (empty || nowhere) add("empty_link", place, where, `The ${name} button ${empty ? "has no text" : "goes nowhere: it has no address"}.`);
              else if (isGenericLinkText(side.label)) add("link_text_generic", place, where, `The ${name} button "${side.label.trim()}" does not say where it goes.`);
            }
            break;
          }
          case "socialLinks": {
            for (const link of block.links) if (link.href.trim() === "") add("empty_link", place, where, "A social link has no address.");
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
            }
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
