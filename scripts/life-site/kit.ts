/**
 * The parts the Kaizena Life importer builds pages from (D916, `docs/life-site-move.md`): the page builder's own rows, columns and
 * components, in Life's look (its theme carries the colours; the few written here are Life's palette, for what the theme cannot say),
 * and Life's words read from lifesaver-app's message files in one language at a time. A page is built once per language with the same
 * ids; `import.ts` keeps the English and makes the others translations with the builder's own `translationOf()`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { RichTextDoc } from "@/lib/rich-text-doc";

export const LANGS = ["en", "nb", "sv"] as const;
export type Lang = (typeof LANGS)[number];
/** The store's locale for each translated language; English is the pages' own (the owner, 28 November 2026). */
export const LOCALES: Record<Exclude<Lang, "en">, string> = { nb: "nb-NO", sv: "sv-SE" };

/** Life's palette (its `globals.css`, dark), for the places a part needs a colour of its own. */
export const LIFE = {
  muted: "#a9a9b0",
  accent: "#0975e2",
  surface: "#1c1c1e",
  border: "#38383a",
  glow: "#0d2547",
  black: "#000000",
  success: "#30d158",
} as const;

export const APP_TITLE = "Kaizena Life";

type Messages = Record<string, unknown>;

/** Life's words in one language: `w("marketing", "home.heroTitle")`, with `{appTitle}` and other values filled in. */
export class Words {
  private readonly files = new Map<string, Messages>();
  constructor(
    private readonly life: string,
    readonly lang: Lang,
  ) {}

  private file(ns: string): Messages {
    let messages = this.files.get(ns);
    if (!messages) {
      messages = JSON.parse(readFileSync(join(this.life, "messages", this.lang, `${ns}.json`), "utf8")) as Messages;
      this.files.set(ns, messages);
    }
    return messages;
  }

  /** A value as the file holds it (a list, an object), or throws when it is missing. */
  raw<T = unknown>(ns: string, key: string): T {
    const value = this.file(ns)[key];
    if (value === undefined) throw new Error(`${this.lang}/${ns}.json has no ${key}`);
    return fill(value, {}) as T;
  }

  /** A text, with `{name}` values filled in (`appTitle` always). */
  t(ns: string, key: string, values: Record<string, string> = {}): string {
    const value = this.raw<unknown>(ns, key);
    if (typeof value !== "string") throw new Error(`${this.lang}/${ns}.json ${key} is not a text`);
    return fill(value, values) as string;
  }
}

function fill(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === "string") return value.replace(/\{(\w+)\}/g, (whole, name: string) => (name === "appTitle" ? APP_TITLE : (values[name] ?? whole)));
  if (Array.isArray(value)) return value.map((entry) => fill(entry, values));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, values)]));
  return value;
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

export type Json = Record<string, unknown>;
type Inline = string | { text: string; href?: string; bold?: boolean };

/** A rich text document of paragraphs, each words and links. */
export function doc(...paragraphs: (Inline | Inline[])[]): RichTextDoc {
  return {
    type: "doc",
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      content: (Array.isArray(paragraph) ? paragraph : [paragraph])
        .map((part) => (typeof part === "string" ? { text: part } : part))
        .filter((part) => part.text !== "")
        .map((part) => ({
          type: "text" as const,
          text: part.text,
          ...(part.href || part.bold ? { marks: [...(part.href ? [{ type: "link" as const, attrs: { href: part.href } }] : []), ...(part.bold ? [{ type: "bold" as const }] : [])] } : {}),
        })),
    })),
  } as RichTextDoc;
}

const px = (value: number) => ({ value, unit: "px" as const });
const pad = (top: number, right: number, bottom: number, left: number) => ({ padding: { top, right, bottom, left } });

/** Muted text in Life's secondary colour, at a size. */
export const mutedText = (size?: number) => ({ text: { color: LIFE.muted, ...(size ? { size: px(size) } : {}) } });
/** A small line in capitals over a title, in the accent. */
export const eyebrowText = { text: { color: LIFE.accent, size: px(12), weight: 600, transform: "uppercase", letterSpacing: { value: 0.18, unit: "em" } } };

export function heading(id: string, text: string, level: 1 | 2 | 3, extra: Json = {}): Json {
  return { id, type: "heading", text, level, ...extra };
}

export function text(id: string, body: RichTextDoc, extra: Json = {}): Json {
  return { id, type: "richText", doc: body, ...extra };
}

export function buttons(id: string, first: { label: string; href: string }, second: { label: string; href: string }, align: "left" | "center" = "center"): Json {
  return { id, type: "dualButton", first: { ...first, variant: "filled" }, second: { ...second, variant: "outline" }, size: "lg", shape: "pill", align, gap: 12 };
}

/** A line with an icon in a pill: Life's badge over a hero. */
export function badge(id: string, line: string, icon = "sparkles"): Json {
  return {
    id,
    type: "iconList",
    items: [{ id: `${id}-line`, icon, text: line, href: "" }],
    iconColor: LIFE.accent,
    iconSize: "sm",
    border: { style: "solid", color: LIFE.border, width: { top: 1, right: 1, bottom: 1, left: 1 } },
    radius: 200,
    style: pad(4, 12, 4, 12),
    typography: mutedText(12),
  };
}

export type Card = { id: string; icon?: string; letters?: string; color?: string; eyebrow?: string; title?: string; text?: string; points?: string[]; badge?: string; badgeTone?: string; group?: string; linkLabel?: string; href?: string };

export function cards(id: string, items: Card[], options: Json = {}): Json {
  return {
    id,
    type: "cards",
    marker: "icon",
    columns: 3,
    items: items.map((item) => ({
      id: item.id,
      ...(item.icon ? { icon: item.icon } : {}),
      ...(item.letters ? { letters: item.letters } : {}),
      ...(item.color ? { color: item.color } : {}),
      ...(item.badgeTone ? { badgeTone: item.badgeTone } : {}),
      eyebrow: item.eyebrow ?? "",
      title: item.title ?? "",
      text: item.text ?? "",
      points: (item.points ?? []).map((point, at) => ({ id: `${item.id}-p${at + 1}`, text: point })),
      badge: item.badge ?? "",
      group: item.group ?? "",
      linkLabel: item.linkLabel ?? "",
      href: item.href ?? "",
    })),
    ...options,
  };
}

export function column(id: string, blocks: Json[], extra: Json = {}): Json {
  return { id, blocks, ...extra };
}

export type RowOptions = { width?: number; top?: number; bottom?: number; center?: boolean; layout?: string; moreLines?: string[]; extra?: Json };

/** A row of Life's page: content `width` wide (1152 unless set), padded above and below, its text centred where asked. */
export function row(id: string, columns: Json[], options: RowOptions = {}): Json {
  const { width = 1152, top = 96, bottom = 96, center = false, layout = "1", moreLines, extra = {} } = options;
  return {
    id,
    type: "row",
    layout,
    ...(moreLines ? { moreLines } : {}),
    columns,
    contentMax: width,
    style: pad(top, 20, bottom, 20),
    ...(center ? { typography: { text: { align: "center" } } } : {}),
    at: { sm: { style: pad(Math.round(top * 0.66), 20, Math.round(bottom * 0.66), 20) } },
    ...extra,
  };
}

/** Life's glow: the accent's tint spreading from the top of a row or a column, into its own background. */
export const glow = (y = 0, base: string = LIFE.black) => ({ background: { type: "gradient", style: "radial", colors: [LIFE.glow, base], focus: { x: 50, y }, flow: "still" } });

/** A box in Life's surface with its line and corners. */
export const box = (padding: [number, number, number, number] = [24, 24, 24, 24]) => ({
  background: { type: "color", color: LIFE.surface },
  border: { style: "solid", color: LIFE.border, width: { top: 1, right: 1, bottom: 1, left: 1 } },
  radius: 9,
  style: pad(...padding),
});

/** The sign-in to the app, which stays the app's (`docs/life-site-move.md`: the app moves to app.kaizenalife.com with the domain). */
export const APP_SIGN_IN = "https://kaizenalife.com/sign-in";
