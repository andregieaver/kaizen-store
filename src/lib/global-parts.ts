import type { PageBlock, PageColumn, PageRow, PageTranslation } from "./page-content";
import { maskBetween, maskId, randomMask } from "./part-ids";

/**
 * Global rows, columns and components (D98): saved parts whose uses on
 * pages stay the same everywhere. A use is the global's content with ids of
 * its own (`part-ids.ts`), marked on its first part with the global's id
 * (`global`). Inside a use, a column or component can be the page's own
 * (`local`): the global keeps its place, and each page what is in it. A
 * global can hold uses of other globals (a row a global component); a
 * `local` mark belongs to the nearest use it is in.
 *
 * Pages keep whole copies, so the site and everything reading pages works
 * on them as on any part: when a global changes, every copy is written
 * again (`src/server/saved-parts.ts`). These pure functions are shared by
 * the builder and the server.
 */

export type PartKind = "row" | "column" | "block";
export type AnyPart = PageRow | PageColumn | PageBlock;
export type Translations = Record<string, PageTranslation>;

/** A global as its uses are made from: its content (in its own ids) and its texts in other languages (D55). */
export type GlobalPart = { id: string; kind: PartKind; content: AnyPart; translations: Translations };

/** What holds uses: a page, or a saved part's content as rows (`asDoc`). */
export type PartsDoc = { rows: PageRow[]; translations?: Translations };

const CHILD = { row: "column", column: "block", block: "block" } as const;

function kids(kind: PartKind, part: AnyPart): AnyPart[] {
  if (kind === "row") return (part as PageRow).columns;
  if (kind === "column") return (part as PageColumn).blocks;
  return [];
}

function withKids<T extends AnyPart>(kind: PartKind, part: T, children: AnyPart[]): T {
  if (kind === "row") return { ...part, columns: children as PageColumn[] };
  if (kind === "column") return { ...part, blocks: children as PageBlock[] };
  return part;
}

function without<T extends AnyPart>(part: T, keys: ("global" | "local")[]): T {
  const next = { ...part };
  for (const key of keys) delete next[key];
  return next;
}

/** The part with the mask applied to its id and every id inside it (not items' ids, which live under their block's). */
function remask<T extends AnyPart>(kind: PartKind, part: T, mask: string): T {
  return withKids(kind, { ...part, id: maskId(part.id, mask) }, kids(kind, part).map((c) => remask(CHILD[kind], c, mask)));
}

function subtreeIds(kind: PartKind, part: AnyPart, into = new Set<string>()): Set<string> {
  into.add(part.id);
  for (const child of kids(kind, part)) subtreeIds(CHILD[kind], child, into);
  return into;
}

/**
 * The ids a use shares with its global: all but the page's own parts
 * (`local`, with what they hold). Marks inside another global's use in it
 * are that global's, so everything there is shared.
 */
function syncedIds(kind: PartKind, part: AnyPart, into = new Set<string>(), root = true, nested = false): Set<string> {
  if (!root && !nested && part.local) return into;
  into.add(part.id);
  const inner = nested || (!root && Boolean(part.global));
  for (const child of kids(kind, part)) syncedIds(CHILD[kind], child, into, false, inner);
  return into;
}

function findIn(kind: PartKind, part: AnyPart, id: string): { kind: PartKind; part: AnyPart } | null {
  if (part.id === id) return { kind, part };
  for (const child of kids(kind, part)) {
    const found = findIn(CHILD[kind], child, id);
    if (found) return found;
  }
  return null;
}

// Translations are kept by the place of each text: `block.{id}.…` and `column.{id}.…` (D55).
const KEY = /^(block|column)\.([A-Za-z0-9_-]+)\.(.+)$/;
const keyId = (key: string): string | null => KEY.exec(key)?.[2] ?? null;
const rekey = (key: string, id: string): string => key.replace(KEY, (_all, kind: string, _id: string, rest: string) => `${kind}.${id}.${rest}`);

type Changes = { drop: Set<string>; add: Translations };

/**
 * A use of `global` made again from its content, where `old` is: its ids
 * follow from `old`'s first id; the page's own parts are kept from `old`
 * (and passed to `refreshLocal`), or taken from the global when `old` has
 * none there yet. `changes` collects the texts in other languages to drop
 * (the use's shared parts, old and new) and to add (the global's).
 */
function expandUse(
  global: GlobalPart,
  old: AnyPart,
  refreshLocal: (kind: PartKind, part: AnyPart) => AnyPart,
  changes: Changes,
): AnyPart {
  const mask = maskBetween(old.id, global.content.id);
  syncedIds(global.kind, old, changes.drop);
  const fromGlobal = new Set<string>();
  const build = (kind: PartKind, part: AnyPart, root: boolean, nested: boolean): AnyPart => {
    const id = maskId(part.id, mask);
    if (!root && !nested && part.local) {
      const own = findIn(global.kind, old, id);
      if (own && own.kind === kind) return refreshLocal(kind, { ...own.part, local: true });
      const taken = remask(kind, part, mask);
      subtreeIds(kind, taken, fromGlobal);
      return taken;
    }
    fromGlobal.add(id);
    let node = { ...part, id } as AnyPart;
    // The use's first part: the global's mark, and the page's own mark from a global around it, if any.
    if (root) node = { ...without(node, ["local"]), global: global.id, ...(old.local ? { local: true as const } : {}) };
    const inner = nested || (!root && Boolean(part.global));
    return withKids(kind, node, kids(kind, part).map((child) => build(CHILD[kind], child, false, inner)));
  };
  const use = build(global.kind, global.content, true, false);
  for (const id of fromGlobal) changes.drop.add(id);
  for (const [locale, texts] of Object.entries(global.translations)) {
    for (const [key, text] of Object.entries(texts)) {
      const id = keyId(key);
      const pageId = id && maskId(id, mask);
      if (pageId && fromGlobal.has(pageId)) (changes.add[locale] ??= {})[rekey(key, pageId)] = text;
    }
  }
  return use;
}

function applyTranslations(current: Translations | undefined, changes: Changes): Translations | undefined {
  if (changes.drop.size === 0 && Object.keys(changes.add).length === 0) return current;
  const out: Translations = {};
  for (const locale of new Set([...Object.keys(current ?? {}), ...Object.keys(changes.add)])) {
    const texts: PageTranslation = {};
    for (const [key, text] of Object.entries(current?.[locale] ?? {})) {
      const id = keyId(key);
      if (!id || !changes.drop.has(id)) texts[key] = text;
    }
    Object.assign(texts, changes.add[locale]);
    if (Object.keys(texts).length > 0) out[locale] = texts;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function withTranslations<T extends PartsDoc>(doc: T, rows: PageRow[], translations: Translations | undefined): T {
  const next = { ...doc, rows };
  delete next.translations;
  return translations ? { ...next, translations } : next;
}

/** A use made a plain copy: no global's mark on it, and its own parts' marks gone. */
function detachOne<T extends AnyPart>(kind: PartKind, part: T): T {
  const strip = (k: PartKind, p: AnyPart, root: boolean): AnyPart => {
    if (!root && p.global) return p;
    return withKids(k, root ? without(p, ["global"]) : without(p, ["local"]), kids(k, p).map((c) => strip(CHILD[k], c, false)));
  };
  return strip(kind, part, true) as T;
}

/**
 * Every use in `doc` of a global in `globals` made again from it (keeping
 * each page's own parts), with the global's texts in other languages; uses
 * of globals `detach` names become plain copies. Uses of other globals stay
 * as they are.
 */
export function refreshUses<T extends PartsDoc>(
  doc: T,
  globals: ReadonlyMap<string, GlobalPart>,
  detach: (globalId: string) => boolean = () => false,
): T {
  const changes: Changes = { drop: new Set(), add: {} };
  const visit = (kind: PartKind, part: AnyPart): AnyPart => {
    if (part.global) {
      const global = globals.get(part.global);
      if (detach(part.global) || (global && global.kind !== kind)) return visit(kind, detachOne(kind, part));
      if (global) return expandUse(global, part, visit, changes);
    }
    return withKids(kind, part, kids(kind, part).map((child) => visit(CHILD[kind], child)));
  };
  const rows = doc.rows.map((row) => visit("row", row) as PageRow);
  return withTranslations(doc, rows, applyTranslations(doc.translations, changes));
}

/** Every use in the rows, anywhere (also inside other uses), in page order. */
export function usesIn(rows: PageRow[]): { kind: PartKind; part: AnyPart }[] {
  const found: { kind: PartKind; part: AnyPart }[] = [];
  const visit = (kind: PartKind, part: AnyPart) => {
    if (part.global) found.push({ kind, part });
    for (const child of kids(kind, part)) visit(CHILD[kind], child);
  };
  for (const row of rows) visit("row", row);
  return found;
}

/** The global as one of its uses has it: the use's content and texts in the global's own ids. */
export function extractUse(
  kind: PartKind,
  part: AnyPart,
  globalRootId: string,
  translations: Translations | undefined,
): { content: AnyPart; translations: Translations } {
  const mask = maskBetween(part.id, globalRootId);
  const content = without(remask(kind, part, mask), ["global", "local"]);
  const ids = subtreeIds(kind, part);
  const texts: Translations = {};
  for (const [locale, entries] of Object.entries(translations ?? {})) {
    for (const [key, text] of Object.entries(entries)) {
      const id = keyId(key);
      if (id && ids.has(id)) (texts[locale] ??= {})[rekey(key, maskId(id, mask))] = text;
    }
  }
  return { content, translations: texts };
}

/** JSON with keys in order, so the same content reads the same whatever order its keys were written in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Whether two values are the same JSON, whatever the order of their keys (as stored in jsonb, say). */
export const sameJson = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/** What all uses of a global share: its content without what is in the page's own parts, and those parts' texts. */
function fingerprint(kind: PartKind, global: { content: AnyPart; translations: Translations }): string {
  const shape = (k: PartKind, part: AnyPart, root: boolean, nested: boolean): unknown => {
    if (!root && !nested && part.local) return { id: part.id, local: true };
    const inner = nested || (!root && Boolean(part.global));
    return withKids(k, part, kids(k, part).map((c) => shape(CHILD[k], c, false, inner) as AnyPart));
  };
  const shared = syncedIds(kind, global.content);
  const texts = Object.fromEntries(
    Object.entries(global.translations).map(([locale, entries]) => [
      locale,
      Object.fromEntries(Object.entries(entries).filter(([key]) => shared.has(keyId(key) ?? ""))),
    ]),
  );
  return canonical({ content: shape(kind, global.content, true, false), texts });
}

/** Whether two versions of a global are the same for its uses. */
export const sameGlobal = (kind: PartKind, a: Omit<GlobalPart, "id" | "kind">, b: Omit<GlobalPart, "id" | "kind">) =>
  fingerprint(kind, a) === fingerprint(kind, b);

/** The global as `doc` has it: from the first use changed from `known`, else as known. */
export function currentGlobal(doc: PartsDoc, known: GlobalPart): GlobalPart {
  for (const { kind, part } of usesIn(doc.rows)) {
    if (part.global !== known.id || kind !== known.kind) continue;
    const mine = extractUse(kind, part, known.content.id, doc.translations);
    if (!sameGlobal(kind, mine, known)) return { ...known, ...mine };
  }
  return known;
}

/** The globals `doc` changed: any use that differs from the global as known (content, own parts' places, texts). */
export function editedGlobals(doc: PartsDoc, known: ReadonlyMap<string, GlobalPart>): string[] {
  const edited = new Set<string>();
  for (const { kind, part } of usesIn(doc.rows)) {
    const global = part.global ? known.get(part.global) : undefined;
    if (!global || global.kind !== kind || edited.has(global.id)) continue;
    if (!sameGlobal(kind, extractUse(kind, part, global.content.id, doc.translations), global)) edited.add(global.id);
  }
  return [...edited];
}

/**
 * After an edit in the builder: a use changed where the page has others
 * of the same global is copied to them (components first, then columns,
 * then rows, so a global inside another follows first), and new uses get
 * the global's texts in other languages.
 */
export function settleUses<T extends PartsDoc>(prev: PartsDoc, next: T, known: ReadonlyMap<string, GlobalPart>): T {
  let out = fillNewUses(prev, next, known);
  const before = new Map(usesIn(prev.rows).map((use) => [use.part.id, use]));
  for (const kind of ["block", "column", "row"] as const) {
    const byGlobal = new Map<string, AnyPart[]>();
    for (const use of usesIn(out.rows)) {
      if (use.kind === kind) byGlobal.set(use.part.global!, [...(byGlobal.get(use.part.global!) ?? []), use.part]);
    }
    for (const [id, parts] of byGlobal) {
      if (parts.length < 2) continue;
      const root = known.get(id)?.content.id ?? parts[0].id;
      const changed = parts.find((part) => {
        const was = before.get(part.id);
        if (!was || was.kind !== kind) return false;
        const now = extractUse(kind, part, root, out.translations);
        return !sameGlobal(kind, now, extractUse(kind, was.part, root, prev.translations));
      });
      if (!changed) continue;
      const global: GlobalPart = { id, kind, ...extractUse(kind, changed, root, out.translations) };
      out = refreshUses(out, new Map([[id, global]]));
    }
  }
  return out;
}

/** New uses in `next` take the global's texts in other languages where they have none. */
function fillNewUses<T extends PartsDoc>(prev: PartsDoc, next: T, known: ReadonlyMap<string, GlobalPart>): T {
  const before = new Set(usesIn(prev.rows).map((use) => use.part.id));
  const fresh = usesIn(next.rows).filter((use) => !before.has(use.part.id));
  let translations = next.translations;
  for (const { kind, part } of fresh) {
    const saved = known.get(part.global!);
    if (!saved || saved.kind !== kind) continue;
    const global = currentGlobal(prev, saved);
    const mask = maskBetween(part.id, global.content.id);
    const shared = syncedIds(kind, part);
    for (const [locale, entries] of Object.entries(global.translations)) {
      for (const [key, text] of Object.entries(entries)) {
        const id = keyId(key);
        const pageId = id && maskId(id, mask);
        if (!pageId || !shared.has(pageId)) continue;
        const pageKey = rekey(key, pageId);
        if (translations?.[locale]?.[pageKey] !== undefined) continue;
        translations = { ...translations, [locale]: { ...translations?.[locale], [pageKey]: text } };
      }
    }
  }
  return translations === next.translations ? next : { ...next, translations };
}

/** Where a part is among globals' uses, for its settings in the builder. */
export type UsePlace = {
  /** The global whose use starts at this part. */
  global: string | null;
  /** The nearest use it is inside; `shared` when that use is itself part of another global's use. */
  within: { global: string; rootId: string; shared: boolean } | null;
  /** The page's own part in the use it is inside. */
  local: boolean;
  /** Inside a part that is the page's own. */
  inLocal: boolean;
};

export function usePlace(rows: PageRow[], id: string): UsePlace | null {
  type Around = { within: UsePlace["within"]; inLocal: boolean };
  const visit = (kind: PartKind, part: AnyPart, around: Around): UsePlace | null => {
    if (part.id === id) {
      return { global: part.global ?? null, within: around.within, local: Boolean(part.local && around.within), inLocal: around.inLocal };
    }
    let inner: Around = { ...around, inLocal: around.inLocal || Boolean(part.local && around.within) };
    if (part.global) {
      inner = { within: { global: part.global, rootId: part.id, shared: Boolean(around.within) && !inner.inLocal }, inLocal: false };
    }
    for (const child of kids(kind, part)) {
      const found = visit(CHILD[kind], child, inner);
      if (found) return found;
    }
    return null;
  };
  for (const row of rows) {
    const found = visit("row", row, { within: null, inLocal: false });
    if (found) return found;
  }
  return null;
}

/** The rows with the part `id` changed by `change`. */
function mapPart(rows: PageRow[], id: string, change: (kind: PartKind, part: AnyPart) => AnyPart): PageRow[] {
  const visit = (kind: PartKind, part: AnyPart): AnyPart =>
    part.id === id ? change(kind, part) : withKids(kind, part, kids(kind, part).map((c) => visit(CHILD[kind], c)));
  return rows.map((row) => visit("row", row) as PageRow);
}

/** Makes a use a plain copy of its own on this page; nothing else changes. */
export const detachUse = (rows: PageRow[], id: string): PageRow[] => mapPart(rows, id, (kind, part) => detachOne(kind, part));

/** Marks a part as a use of a global just made from it (`globalContent`). */
export const markUse = (rows: PageRow[], id: string, globalId: string): PageRow[] =>
  mapPart(rows, id, (_kind, part) => ({ ...part, global: globalId }));

/** The page's own part inside a use, or shared with the global again. */
export const setLocal = (rows: PageRow[], id: string, local: boolean): PageRow[] =>
  mapPart(rows, id, (_kind, part) => (local ? { ...part, local: true } : without(part, ["local"])));

/**
 * A global's content made from a part on the page: its ids under a new
 * random mask, so the part itself, marked with `markUse`, is its first use
 * with the ids it has.
 */
export function globalContent<T extends AnyPart>(kind: PartKind, part: T): T {
  return without(remask(kind, part, randomMask()), ["global", "local"]);
}

/** A copy with no global's marks anywhere in it: Kaizen's library in a store (D56). */
export function withoutUses<T extends AnyPart>(kind: PartKind, part: T): T {
  return withKids(kind, without(part, ["global", "local"]), kids(kind, part).map((c) => withoutUses(CHILD[kind], c)));
}

/**
 * A copy of a part that holds uses (duplicating, or placing a saved part):
 * the part and what it holds get new ids from `newId`, and each use inside
 * keeps its ids' relation to its global, so it stays a use.
 */
export function copyWithUses<T extends AnyPart>(kind: PartKind, part: T, newId: () => string): T {
  if (part.global) return remask(kind, part, maskBetween(part.id, newId()));
  return withKids(kind, { ...part, id: newId() }, kids(kind, part).map((c) => copyWithUses(CHILD[kind], c, newId)));
}

/** A new use of a global, starting at `rootId`. */
export function newUse(global: GlobalPart, rootId: string): AnyPart {
  return expandUse(global, { ...global.content, id: rootId }, (_kind, part) => part, { drop: new Set(), add: {} });
}

const WRAP_ROW = "global-row";
const WRAP_COLUMN = "global-column";

/** A saved part's content as rows, to refresh the uses in it as a page's. */
export function asDoc(kind: PartKind, content: AnyPart, translations?: Translations): PartsDoc {
  const column = (c: PageColumn): PageRow => ({ id: WRAP_ROW, type: "row", layout: "1", columns: [c] });
  const rows =
    kind === "row"
      ? [content as PageRow]
      : kind === "column"
        ? [column(content as PageColumn)]
        : [column({ id: WRAP_COLUMN, blocks: [content as PageBlock] })];
  return translations ? { rows, translations } : { rows };
}

export function fromDoc(kind: PartKind, doc: PartsDoc): AnyPart {
  const row = doc.rows[0];
  return kind === "row" ? row : kind === "column" ? row.columns[0] : row.columns[0].blocks[0];
}
