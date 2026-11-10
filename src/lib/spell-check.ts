/**
 * Spell-check in the page builder and the live site's text editor: which
 * fields are checked, and in which language. The browser does the checking
 * with its own dictionaries; this says which fields hold the page's words and
 * the language of the version being edited (`lang`), so a Norwegian page is
 * checked as Norwegian while the admin around it stays English.
 */

/** What is known of a focused element, read from the DOM by `SpellCheckScope`. */
export type SpellField = {
  /** Lower-case tag name. */
  tag: string;
  /** An input's `type` attribute as written (empty when none). */
  type: string;
  /** The `spellcheck` attribute as written (null when none). */
  spellcheck: string | null;
  /** Whether it is the host of editable content (`contenteditable`). */
  editableHost: boolean;
  readOnly: boolean;
  disabled: boolean;
  /** An input's `inputmode` attribute as written (empty when none). */
  inputMode: string;
  /** Its own `lang` attribute (null when none) and whether the scope wrote it. */
  lang: string | null;
  langOurs: boolean;
};

/** Input types whose value is words; every other type (url, email, number, …) is not checked. */
const WORDS_TYPES = new Set(["", "text", "search"]);
/** Input modes that say the value is not words. */
const NOT_WORDS_MODES = new Set(["numeric", "decimal", "tel", "email", "url", "none"]);

/**
 * Whether a field holds words to check: a text area, a text input or editable
 * content, not read-only, and not one its component said not to check
 * (`spellCheck={false}`: CSS, HTML, addresses, class names and other code).
 */
export function holdsWords(field: SpellField): boolean {
  if (field.spellcheck?.toLowerCase() === "false") return false;
  if (field.readOnly || field.disabled) return false;
  if (NOT_WORDS_MODES.has(field.inputMode.toLowerCase())) return false;
  if (field.tag === "textarea") return true;
  if (field.tag === "input") return WORDS_TYPES.has(field.type.toLowerCase());
  return field.editableHost;
}

/**
 * The language to give a field: the version's, unless the field names its own
 * (a component that knows better, such as a field shown in another language).
 * Null: leave the field's language as it is (inherited from the page).
 */
export function fieldLang(field: SpellField, lang: string | null | undefined): string | null {
  const wanted = spellLang(lang);
  if (!wanted) return null;
  if (field.lang !== null && !field.langOurs) return null;
  return field.lang === wanted ? null : wanted;
}

/** A BCP 47 tag as browsers' dictionaries name it (`nb-no` → `nb-NO`); null for anything that is not one. */
export function spellLang(lang: string | null | undefined): string | null {
  const parts = (lang ?? "").trim().replaceAll("_", "-").split("-");
  if (!/^[a-z]{2,3}$/i.test(parts[0] ?? "")) return null;
  const out = [parts[0].toLowerCase()];
  for (const part of parts.slice(1)) {
    if (/^[a-z]{2}$/i.test(part)) out.push(part.toUpperCase());
    else if (/^[a-z]{4}$/i.test(part)) out.push(part[0].toUpperCase() + part.slice(1).toLowerCase());
    else if (/^(\d{3}|[a-z\d]{5,8})$/i.test(part)) out.push(part.toLowerCase());
    else return null;
  }
  return out.join("-");
}
