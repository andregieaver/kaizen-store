// The parts Kaizena Flow's own pages are built from (docs/site-design.md, the recipes; 6.11, the feature pages the owner published on
// 5 November 2026), and the check every generator here runs: pageInput, the page checker with the platform's theme and text styles, and
// the claims filter over the page's words, as the editor's save does. Shared by the generators in this folder (README.md).
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { findClaims } from "@/lib/claims";
import { inlinePlain } from "@/lib/inline-text";
import { blockingIssues, pageIssues, themeSetsOf } from "@/lib/page-a11y";
import { pageInput, pageSlugProblem, type PageContent } from "@/lib/page-content";
import { textStylesCss } from "@/lib/text-styles";
import { parseStoreTheme } from "@/lib/theme";

export const id = () => randomUUID();
export const SAND = "#908064";
export const ICON = "#3a4293";
export const TEXT = "#171717";

// The owner's feature pages take the gradients at 35°: A towards #ededed, B towards white, C a plain sand band.
export const TURN_A = { type: "gradient", style: "shift", flow: "still", angle: 35, colors: [SAND, "#ededed"] };
export const TURN_B = { type: "gradient", style: "shift", flow: "still", angle: 35, colors: [SAND, "#ffffff"] };
export const TURN_C = { type: "color", color: SAND, opacity: 9 };
export const HERO_BG = { ...TURN_B, opacity: 80 };
export const pad = (top: number, side: number, bottom: number) => ({ padding: { top, left: side, right: side, bottom } });
export const margin = (top: number, left: number, right: number, bottom: number) => ({ margin: { top, left, right, bottom } });
export const onSand = { typography: { text: { color: TEXT } } };
/** A card of its own on a sand row (the owner's: white at half, medium shadow, small corners). */
export const CARD = { radius: 6, shadow: "md", background: { type: "color", color: "#ffffff", opacity: 50 } };
/** The highlighted card (6.5): the line round it, thicker on top. */
export const LINED = { border: { style: "solid", color: "#c4bcad", width: { top: 5, left: 1, right: 1, bottom: 1 } } };

type Mark = { type: "bold" } | { type: "link"; attrs: { href: string } };
type Run = { text: string; bold?: boolean; href?: string };
const runs = (parts: Run[]) =>
  parts.map((p) => {
    const marks: Mark[] = [...(p.bold ? [{ type: "bold" } as const] : []), ...(p.href ? [{ type: "link", attrs: { href: p.href } } as const] : [])];
    return { type: "text", text: p.text, ...(marks.length ? { marks } : {}) };
  });
export const para = (...parts: Run[]) => ({ type: "paragraph", content: runs(parts) });
export const doc = (...content: unknown[]) => ({ type: "doc", content });
export const rich = (content: unknown[], extra: Record<string, unknown> = {}) => ({ id: id(), type: "richText", doc: doc(...content), ...extra });
/** A section's text (5.2): a bold lead sentence, then plain words. */
export const lead = (bold: string, rest: string, extra: Record<string, unknown> = {}) =>
  rich([para({ text: bold, bold: true }, ...(rest ? [{ text: ` ${rest}` }] : []))], extra);
/** A link on its own line, as the highlighted cards end. */
export const link = (text: string, href: string) => rich([para({ text, href })]);

/** The dual heading (5.1): the eyebrow over the title; the page's `h1` or a section's `h2`. */
export const dual = (level: 1 | 2, eyebrow: string, title: string, tone: "light-color" | "dark-color", extra: Record<string, unknown> = {}) => ({
  id: id(),
  type: "heading",
  level,
  stack: true,
  className: "heading-on-light",
  text: `<span class="super-heading ${tone}${level === 1 ? " green-text" : ""}">${eyebrow}</span>`,
  second: title,
  typography: { ...(level === 2 ? { text: { color: TEXT } } : {}), first: { size: { unit: "px", value: level === 1 ? 30 : 18 } } },
  ...extra,
});
/** A card's `h3`, its first word purple and bold. */
export const h3 = (first: string, rest: string) => ({
  id: id(),
  type: "heading",
  level: 3,
  text: `<span class="green-text ts-colour">${first}</span> ${rest}`,
  typography: { text: { size: { unit: "px", value: 30 } } },
});
/** An icon list of checks (5.4). */
export const checks = (lines: string[], extra: Record<string, unknown> = {}) => ({
  id: id(),
  type: "iconList",
  items: lines.map((text) => ({ id: id(), icon: "check", text, href: "" })),
  iconSize: "lg",
  iconColor: ICON,
  gap: 21,
  typography: { text: { size: { unit: "px", value: 18 } } },
  ...extra,
});
const smallChecks = (lines: string[]) => checks(lines, { typography: { text: { size: { unit: "px", value: 17 }, align: "left" } } });
/** The main action (5.3): Get Started with Flow. */
export const mainAction = () => ({
  id: id(),
  type: "dualButton",
  first: { label: "Get Started with Flow", href: "/sign-up" },
  second: { label: "", href: "", variant: "outline" },
  size: "lg",
  shape: "pill",
  gap: 30,
  align: "center",
  motion: { enter: { effect: "blur-up" } },
  style: margin(26, 0, 0, 30),
  at: { sm: { stack: true, style: margin(10, 20, 20, 30) } },
});
/** The second action, a text link under the main one (5.3). */
export const textLink = (text: string, href: string) => rich([para({ text, href })], { style: margin(-20, 0, 0, 0), typography: { text: { align: "center" } } });

/** The hero (6.1, at the owner's 35°): the `h1`, the lead, the main action, a link to the first section and three checks side by side. */
export function hero(o: { eyebrow: string; title: string; bold: string; rest: string; anchor: { text: string; href: string }; claims: string[] }) {
  return {
    id: id(), type: "row", layout: "1", align: "middle", height: 50, style: pad(150, 20, 100), background: HERO_BG, backgroundFixed: true,
    contentMax: 968, typography: { text: { align: "center" } }, at: { sm: { height: 100, style: pad(0, 20, 0) } },
    columns: [{
      id: id(),
      blocks: [
        dual(1, o.eyebrow, o.title, "dark-color"),
        lead(o.bold, o.rest),
        mainAction(),
        textLink(o.anchor.text, o.anchor.href),
        checks(o.claims, { layout: "row", position: "center", gap: 20, typography: { text: { weight: 500 } }, visibility: { hideAt: ["sm"] } }),
      ],
    }],
  };
}

/** A card of three under a section's heading (6.11): an `h3`, a lead and three checks, or the lead alone. */
export const card = (first: string, rest: string, bold: string, words: string, lines: string[] = []) => ({
  id: id(),
  ...onSand,
  ...CARD,
  style: pad(40, 24, 46),
  blocks: [h3(first, rest), lead(bold, words), ...(lines.length ? [smallChecks(lines)] : [])],
});

/** A section's heading and lead over three cards (6.11), and any further lines of one column (`after`). */
export function cardsRow(o: {
  eyebrow: string;
  title: string;
  tone: "light-color" | "dark-color";
  bold: string;
  rest: string;
  cards: Record<string, unknown>[];
  after?: Record<string, unknown>[];
  background: Record<string, unknown>;
  htmlId?: string;
}) {
  return {
    id: id(), type: "row", ...(o.htmlId ? { htmlId: o.htmlId } : {}), layout: "1", moreLines: ["3", ...(o.after ?? []).map(() => "1")], gap: 40,
    style: pad(100, 20, 100), background: o.background, backgroundFixed: true, contentMax: 1100, equalHeight: true,
    typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
    columns: [{ id: id(), ...onSand, blocks: [dual(2, o.eyebrow, o.title, o.tone), lead(o.bold, o.rest)] }, ...o.cards, ...(o.after ?? [])],
  };
}

/** The highlighted card (6.5), one centred column under the cards. */
export const highlighted = (bold: string, rest: string) => ({
  id: id(), ...onSand, ...LINED, radius: 10, background: { type: "color", color: "#ffffff", opacity: 24 }, style: pad(20, 30, 30),
  blocks: [lead(bold, rest)],
});

/** A feature row (6.3): the section's words beside a list, taking turns side; `listFirst` puts the list left and the words first on a phone. */
export function featureRow(o: {
  eyebrow: string;
  title: string;
  tone: "light-color" | "dark-color";
  bold: string;
  rest: string;
  lines: string[];
  background: Record<string, unknown>;
  listFirst?: boolean;
  htmlId?: string;
}) {
  const words = { id: id(), ...onSand, width: 40, radius: 20, ...(o.listFirst ? { style: pad(40, 0, 40) } : {}), blocks: [dual(2, o.eyebrow, o.title, o.tone), lead(o.bold, o.rest)] };
  const list = { id: id(), ...onSand, width: 60, ...(o.listFirst ? {} : { at: { sm: { style: margin(-40, 0, 0, 0) } } }), blocks: [checks(o.lines)] };
  return {
    id: id(), type: "row", ...(o.htmlId ? { htmlId: o.htmlId } : {}), layout: "2", align: "middle", gap: 70, style: pad(100, 20, 100),
    background: o.background, backgroundFixed: true, contentMax: 1000, at: { sm: { contentMax: 320, ...(o.listFirst ? { reverse: true } : {}) } },
    columns: o.listFirst ? [list, words] : [words, list],
  };
}

/** Three highlighted cards on a sand band (6.11), each a dual heading, its words and, if given, a link on. */
export function highlightRow(cards: { eyebrow: string; title: string; bold: string; rest: string; link?: { text: string; href: string } }[]) {
  return {
    id: id(), type: "row", layout: "3", gap: 40, style: pad(100, 20, 100), background: TURN_C, backgroundFixed: true,
    contentMax: 1100, equalHeight: true, typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
    columns: cards.map((c, i) => ({
      id: id(), ...onSand, ...CARD, ...LINED, style: pad(36, 24, 40),
      blocks: [dual(2, c.eyebrow, c.title, i % 2 ? "light-color" : "dark-color"), lead(c.bold, c.rest), ...(c.link ? [link(c.link.text, c.link.href)] : [])],
    })),
  };
}

/** Questions in one white card (6.11), each answer a bold first sentence. */
export function questionsRow(faq: { q: string; bold: string; rest: string }[], background: Record<string, unknown> = TURN_B) {
  return {
    id: id(), type: "row", layout: "1", style: pad(100, 20, 100), background, backgroundFixed: true, contentMax: 880, at: { sm: { contentMax: 320 } },
    columns: [{
      id: id(), ...onSand, radius: 6, shadow: "md", background: { type: "color", color: "#ffffff" }, style: pad(30, 30, 40),
      blocks: [
        dual(2, "Good to know", "Your questions, answered", "dark-color", { typography: { text: { color: TEXT, align: "center" }, first: { size: { unit: "px", value: 18 } } } }),
        { id: id(), type: "faq", look: "boxed", single: true, items: faq.map((f) => ({ id: id(), title: f.q, body: doc(para({ text: f.bold, bold: true }, { text: ` ${f.rest}` })) })) },
      ],
    }],
  };
}

/** The end of a page that sells (6.7): the main action and a text link on. */
export function endRow(o: { eyebrow: string; title: string; bold: string; rest: string; background?: Record<string, unknown> }) {
  return {
    id: id(), type: "row", layout: "1", align: "middle", style: pad(100, 20, 100), background: o.background ?? TURN_A, backgroundFixed: true,
    contentMax: 968, typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
    columns: [{ id: id(), ...onSand, blocks: [dual(2, o.eyebrow, o.title, "light-color"), lead(o.bold, o.rest), mainAction(), textLink("Compare us to others", "/compare")] }],
  };
}

const theme = {
  base: "minimal",
  savedId: null,
  settings: {
    mode: "auto",
    light: { text: "#171717", muted: "#525252", accent: "#171717", border: "#e5e5e5", surface: "#f5f5f4", accentText: "#ffffff", background: "#ffffff" },
    dark: { text: "#ededed", muted: "#a3a3a3", accent: "#ededed", border: "#2e2e2e", surface: "#1c1c1c", accentText: "#0a0a0a", background: "#1c1c1c" },
    fonts: { body: "Inter", heading: "Montserrat" },
    buttons: { style: "filled", corners: "pill" },
    visitorSwitch: false,
  },
};
const styles = [
  { slug: "green-text", kind: "colour", settings: { color: "#557400", weight: 700 }, css: null },
  { slug: "colour", kind: "colour", settings: { color: "#242a60", weight: 700 }, css: null },
] as const;

export type PageCheck = {
  page: PageContent | null;
  errors: unknown[];
  blocking: number;
  claims: ReturnType<typeof findClaims>;
  slugProblem: string | null;
  seo: [number, number];
};

/**
 * Checks a page as the editor's save does and writes `{name}.page.json` and `{name}.check.json` to the system's temporary folder
 * (`kaizena-site-pages`), never into the repository.
 */
export function checkPage(name: string, page: { slug: string; seo: { title: string; description: string } }): PageCheck {
  const out = path.join(tmpdir(), "kaizena-site-pages");
  mkdirSync(out, { recursive: true });
  const seo: [number, number] = [page.seo.title.length, page.seo.description.length];
  const slugProblem = pageSlugProblem(page.slug);
  const parsed = pageInput.safeParse(page);
  if (!parsed.success) {
    writeFileSync(path.join(out, `${name}.errors.json`), JSON.stringify(parsed.error.issues, null, 1));
    return { page: null, errors: parsed.error.issues, blocking: 0, claims: [], slugProblem, seo };
  }
  const sets = themeSetsOf(parseStoreTheme(theme).settings);
  const issues = pageIssues(parsed.data, { theme: { sets }, siteCss: textStylesCss(styles as never) });
  const blocks = parsed.data.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks));
  // The page's words only (texts, headings, labels, questions), never its ids, addresses or colours.
  const said: string[] = [];
  const walk = (v: unknown, k = ""): void => {
    if (typeof v === "string") {
      if (["text", "second", "label", "title", "description"].includes(k)) said.push(inlinePlain(v));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, k));
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  walk(parsed.data);
  const claims = findClaims(said.join("\n"));
  const blocking = blockingIssues(issues).length;
  writeFileSync(
    path.join(out, `${name}.check.json`),
    JSON.stringify(
      {
        issues: issues.map((i) => [i.rule, i.severity, i.where, i.message, JSON.stringify(blocks.find((b) => b.id === i.blockId) ?? null).slice(0, 100)]),
        blocking,
        claims,
        rows: parsed.data.rows.length,
        blocks: blocks.length,
        seo,
      },
      null,
      1,
    ),
  );
  writeFileSync(path.join(out, `${name}.page.json`), JSON.stringify(parsed.data));
  return { page: parsed.data, errors: [], blocking, claims, slugProblem, seo };
}
