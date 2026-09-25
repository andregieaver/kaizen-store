import {
  cleanRichText,
  richTextIsEmpty,
  type PageBlock,
  type PageColumn,
  type PageContent,
  type PageText,
  type PageTranslation,
} from "./page-content";

/**
 * A page's texts in other languages (D55). A page is built once, in its
 * owner's main language; each other language keeps only the texts that
 * differ, by where they are on the page (`title`, `block.{id}.text`, …), so
 * rows, columns, pictures and settings stay one. A text not translated
 * shows in the main language.
 */

/** A text's place on the page and its longest length (a rich text's is checked on its own). */
type Visit = (key: string, value: PageText, max: number) => PageText;

/**
 * The page with each text replaced by what `visit` returns for it. Every
 * text is visited, even an empty one, so a language can have words where
 * the main one has none (a search title, say).
 */
export function mapTexts(content: PageContent, visit: Visit): PageContent {
  const str = (key: string, value: string, max: number) => {
    const next = visit(key, value, max);
    return typeof next === "string" ? next : value;
  };
  const block = (b: PageBlock): PageBlock => {
    const key = (field: string) => `block.${b.id}.${field}`;
    switch (b.type) {
      case "richText": {
        const doc = visit(key("doc"), b.doc, 0);
        return typeof doc === "string" ? b : { ...b, doc };
      }
      case "heading":
        return { ...b, text: str(key("text"), b.text, 300) };
      case "button":
        return { ...b, label: str(key("label"), b.label, 100) };
      case "image":
        return {
          ...b,
          caption: str(key("caption"), b.caption, 300),
          image: b.image && { ...b.image, alt: str(key("alt"), b.image.alt, 300) },
        };
      case "contentGrid":
        return { ...b, buttonLabel: str(key("buttonLabel"), b.buttonLabel, 100), emptyText: str(key("emptyText"), b.emptyText, 300) };
    }
  };
  const column = (c: PageColumn): PageColumn => ({
    ...c,
    ...(c.link && { link: { ...c.link, label: str(`column.${c.id}.label`, c.link.label, 200) } }),
    blocks: c.blocks.map(block),
  });
  return {
    ...content,
    title: str("title", content.title, 200),
    seo: { title: str("seo.title", content.seo.title, 70), description: str("seo.description", content.seo.description, 160) },
    thumbnail: content.thumbnail && { ...content.thumbnail, alt: str("thumbnail.alt", content.thumbnail.alt, 300) },
    rows: content.rows.map((row) => ({ ...row, columns: row.columns.map(column) })),
  };
}

/** Every text of the page by its place, with its longest length (0 for rich text). */
export function pageTexts(content: PageContent): Map<string, { value: PageText; max: number }> {
  const texts = new Map<string, { value: PageText; max: number }>();
  mapTexts(content, (key, value, max) => {
    texts.set(key, { value, max });
    return value;
  });
  return texts;
}

const same = (a: PageText, b: PageText) => (typeof a === "string" ? a === b : JSON.stringify(a) === JSON.stringify(b));

const isEmpty = (value: PageText) => (typeof value === "string" ? value.trim() === "" : richTextIsEmpty(value));

/**
 * The page as it reads in `locale`: its texts in that language where they
 * are translated, else as written. The main language (or one without a
 * translation) gets the page as it is.
 */
export function localizePage(content: PageContent, locale: string | null | undefined): PageContent {
  const translation = locale ? content.translations?.[locale] : undefined;
  if (!translation) return content;
  return mapTexts(content, (key, value) => translation[key] ?? value);
}

/**
 * A translation from a copy of the page edited in another language: the
 * texts that differ from the page's own. Only texts count; anything else
 * changed in the copy is ignored.
 */
export function translationOf(content: PageContent, edited: PageContent): PageTranslation {
  const own = pageTexts(content);
  const translation: PageTranslation = {};
  for (const [key, { value }] of pageTexts(edited)) {
    const base = own.get(key);
    if (!base || same(base.value, value)) continue;
    if (isEmpty(value)) continue;
    translation[key] = value;
  }
  return translation;
}

/** The page with `locale`'s translation set (or removed when it has no texts). */
export function withTranslation(content: PageContent, locale: string, translation: PageTranslation): PageContent {
  const translations = Object.fromEntries(
    Object.entries({ ...content.translations, [locale]: translation }).filter(([, texts]) => Object.keys(texts).length > 0),
  );
  const next: PageContent = { ...content, translations };
  if (Object.keys(translations).length === 0) delete next.translations;
  return next;
}

/** How much of the page a language has: translated texts out of those written in the main language. */
export function translationProgress(content: PageContent, locale: string): { done: number; of: number } {
  const translation = content.translations?.[locale] ?? {};
  let of = 0;
  let done = 0;
  for (const [key, { value }] of pageTexts(content)) {
    if (isEmpty(value)) continue;
    of += 1;
    if (key in translation) done += 1;
  }
  return { done, of };
}

/**
 * A page's translations as they may be saved: only the owner's other
 * languages, only texts the page has, rich text cleaned as the page's own
 * is, and nothing that repeats the main language.
 */
export function cleanTranslations(
  content: PageContent,
  languages: readonly { locale: string; name: string }[],
): { ok: true; content: PageContent } | { ok: false; problems: string[] } {
  const texts = pageTexts(content);
  const problems: string[] = [];
  let next: PageContent = { ...content };
  delete next.translations;
  for (const { locale, name } of languages) {
    const raw = content.translations?.[locale];
    if (!raw) continue;
    const translation: PageTranslation = {};
    for (const [key, { value: own, max }] of texts) {
      const value = raw[key];
      if (value === undefined) continue;
      if (typeof own === "string") {
        if (typeof value !== "string") continue;
        const text = value.trim();
        if (text.length > max) problems.push(`Keep each text under ${max} characters (${name}).`);
        else if (text !== "" && text !== own) translation[key] = text;
      } else {
        const cleaned = cleanRichText(value);
        if (!cleaned.ok) problems.push(`${cleaned.problem} (${name})`);
        else if (!richTextIsEmpty(cleaned.doc) && !same(cleaned.doc, own)) translation[key] = cleaned.doc;
      }
    }
    next = withTranslation(next, locale, translation);
  }
  return problems.length > 0 ? { ok: false, problems: [...new Set(problems)] } : { ok: true, content: next };
}

/** A language a page can be written in, with its name in English for the admin. */
export type PageLanguage = { locale: string; name: string };

/**
 * An owner's languages from its markets' locales, in the markets' order
 * (the store's own country first), each once: the first is the page's main
 * language, the others its translations.
 */
export function pageLanguages(locales: readonly string[]): PageLanguage[] {
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  const unique = [...new Set(locales)];
  const language = (locale: string) => locale.split("-")[0];
  // "Swedish", unless two of the locales share a language: then "German (Austria)".
  const name = (locale: string) =>
    unique.filter((l) => language(l) === language(locale)).length > 1 ? names.of(locale) : names.of(language(locale));
  return unique.map((locale) => ({ locale, name: name(locale) ?? locale }));
}
