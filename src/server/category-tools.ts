import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { CategoryRuleArg, UpdateCategoryArgs } from "@/lib/category-tools";
import { categoryApprovalSummary, updateCategoryInput } from "@/lib/category-tools";
import { findClaims } from "@/lib/claims";
import { formatMoney, minorUnitDigits } from "@/lib/money";
import type { RichTextDoc } from "@/lib/page-content";
import { withDescendants, type Term } from "@/lib/taxonomy";
import { describeRules, type RuleCondition, type RuleNames, type TermRules } from "@/lib/term-rules";

import type { Account } from "./auth";
import { catalogTag } from "./catalog";
import { libraryFilesByUrl } from "./media-library";
import { OwnerToolError } from "./owner-tool-error";
import { OFFERED, inTerms, textList } from "./product-conditions";
import type { Store } from "./stores";
import { listTerms, setTermOrder, termsTag, updateTerm } from "./taxonomy";
import { ruleChoices, type RuleChoices } from "./term-rules";

/**
 * The AI manager's category tools (wave 6 unit A, D319, `docs/wave-6-catalogue.md` 3.4): `list_categories` reads the store's categories and tags
 * with their counts and their rules in words, `update_category` (gated `public`) changes one only through the categories page's own save
 * (`updateTerm()`, `setTermOrder()`), after every name it was given is found in the store and its words pass the claims filter.
 */

type Ctx = { account: Account; store: Store; invalidate: (tag: string) => void };
type Row = Record<string, unknown>;

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const scopeOf = (store: Store) => ({ storeId: store.id, contentType: "product" }) as const;

/** The names a rule's words need, from the store's own rows. */
function namesOf(terms: readonly Term[], choices: RuleChoices): RuleNames {
  return {
    terms: new Map(terms.map((t) => [t.id, { name: t.name, kind: t.kind }])),
    manufacturers: new Map(choices.manufacturers.map((m) => [m.id, m.name])),
    fields: new Map(choices.fields.map((f) => [f.id, f.label])),
    money: (minor) => formatMoney(minor, choices.currency, choices.locale),
    kinds: { goods: "goods", appointment: "appointment", stay: "stay", rental: "rental", gift_card: "gift card", bundle: "bundle" },
  };
}

/** `list_categories`: each category and tag, with its products (active and offered, its subcategories' and its rules' included) and its rules in words. */
export async function listCategoriesTool(ctx: Ctx, args: { kind?: "category" | "tag" }) {
  const [terms, choices] = await Promise.all([listTerms(scopeOf(ctx.store)), ruleChoices(ctx.store.id, null)]);
  const names = namesOf(terms, choices);
  const shown = terms.filter((t) => !args.kind || t.kind === args.kind);
  const counts = await Promise.all(
    shown.map(async (term) => {
      const ids = term.kind === "category" ? withDescendants(terms, [term.id]) : [term.id];
      const [row] = await db().execute<Row>(sql`
        select count(*)::int as n from commerce.products p
        where p.store_id = ${ctx.store.id}::uuid and p.status = 'active' and ${OFFERED} and ${inTerms(ids)}
      `);
      return Number(row?.n ?? 0);
    }),
  );
  return {
    categories: shown.map((term, i) => ({
      kind: term.kind,
      name: term.name,
      address: term.slug,
      ...(term.parentId ? { inside: terms.find((t) => t.id === term.parentId)?.name ?? null } : {}),
      products: counts[i],
      filled: term.rules ? describeRules(term.rules, names) : "by hand",
      description: Boolean(term.description),
      picture: Boolean(term.image),
    })),
  };
}

/** A category or tag of the store by name or address. */
function findTerm(terms: readonly Term[], ref: string, kind?: "category" | "tag"): Term {
  const wanted = ref.trim().toLowerCase();
  const found = terms.filter((t) => (!kind || t.kind === kind) && (t.name.toLowerCase() === wanted || t.slug === wanted));
  if (found.length === 0) return fail(`No category or tag "${ref}" in this store. list_categories lists them.`);
  if (found.length > 1) return fail(`Both a category and a tag are called "${ref}": say which with kind.`);
  return found[0];
}

/** Plain paragraphs as the description's rich text. */
function descriptionDoc(text: string): RichTextDoc {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return { type: "doc", content: paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p.replace(/\s*\n\s*/g, " ") }] })) } as RichTextDoc;
}

/** A rule condition as the owner named it, as ids and minor units of the store's own; a name not found refuses the call. */
function conditionOf(c: CategoryRuleArg, terms: readonly Term[], self: Term, choices: RuleChoices): RuleCondition {
  switch (c.kind) {
    case "term": {
      const term = findTerm(terms, c.name);
      if (term.id === self.id) return fail("A category's rules cannot name the category itself.");
      if (term.rules) return fail(`"${term.name}" is filled by rules itself: name a category or tag filled by hand.`);
      return { kind: "term", termId: term.id, not: c.not ?? false };
    }
    case "price": {
      const digits = minorUnitDigits(choices.currency);
      const minor = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 10 ** digits));
      return { kind: "price", min: minor(c.min), max: minor(c.max) };
    }
    case "inStock":
      return { kind: "inStock" };
    case "manufacturer":
      return {
        kind: "manufacturer",
        ids: c.names.map((name) => {
          const found = choices.manufacturers.find((m) => m.name.toLowerCase() === name.toLowerCase());
          return found ? found.id : fail(`No manufacturer "${name}" in this store.`);
        }),
      };
    case "option":
      return { kind: "option", name: c.name, value: c.value };
    case "field": {
      const wanted = c.field.toLowerCase();
      const field = choices.fields.find((f) => f.label.toLowerCase() === wanted || f.id === c.field);
      if (!field) return fail(`No custom field "${c.field}" shoppers can filter by in this store.`);
      if (field.range) return { kind: "field", fieldId: field.id, value: null, min: c.min ?? null, max: c.max ?? null, unit: field.unit };
      const said = (c.value ?? "").trim().toLowerCase();
      if (field.type === "boolean") {
        const value = ["yes", "true", "ja"].includes(said) ? "true" : ["no", "false", "nei"].includes(said) ? "false" : null;
        return value ? { kind: "field", fieldId: field.id, value, min: null, max: null, unit: null } : fail(`Say yes or no for "${field.label}".`);
      }
      const choice = field.choices.find((x) => x.key.toLowerCase() === said || x.label.toLowerCase() === said);
      return choice
        ? { kind: "field", fieldId: field.id, value: choice.key, min: null, max: null, unit: null }
        : fail(`"${c.value ?? ""}" is not one of ${field.label}'s choices: ${field.choices.map((x) => x.label).join(", ")}.`);
    }
    case "kind":
      return { kind: "kind", values: c.values };
    case "newWithin":
      return { kind: "newWithin", days: c.days };
  }
}

type CategoryChange = { term: Term; terms: Term[]; input: Record<string, unknown>; order: string[] | null; rules: TermRules | null | undefined; names: RuleNames };

/** Everything the call names, found in the store and checked, before anything is changed. */
async function categoryChange(ctx: Ctx, args: UpdateCategoryArgs): Promise<CategoryChange> {
  const [terms, choices] = await Promise.all([listTerms(scopeOf(ctx.store)), ruleChoices(ctx.store.id, null)]);
  const term = findTerm(terms, args.category, args.kind);
  const input: Record<string, unknown> = { name: term.name, slug: term.slug, parentId: term.parentId };
  if (args.description !== undefined) {
    if (args.description) {
      const claims = [...new Set(findClaims(args.description).map((c) => c.phrase))];
      if (claims.length > 0) fail(`Rewrite without claims the store cannot back: ${claims.join(", ")}.`);
    }
    input.description = args.description ? descriptionDoc(args.description) : null;
  }
  if (args.picture !== undefined) {
    if (args.picture === null) input.image = null;
    else {
      const file = (await libraryFilesByUrl(ctx.store.id, [args.picture])).get(args.picture);
      if (!file || file.kind !== "image") fail(`${args.picture} is not a picture in the store's media library.`);
      input.image = { url: file!.url, thumbnailUrl: file!.thumbnailUrl ?? null };
    }
  }
  let rules: TermRules | null | undefined;
  if (args.rules !== undefined) {
    if (term.requiresUnitPrice) fail(`"${term.name}" needs a price per kg or litre of its products, so it is filled by hand.`);
    rules = args.rules === null ? null : { match: args.rules.match, conditions: args.rules.conditions.map((c) => conditionOf(c, terms, term, choices)) };
    input.rules = rules;
    if (rules === null) input.keepMatches = true;
  }
  let order: string[] | null = null;
  if (args.order) {
    if (rules || (rules === undefined && term.rules)) fail(`"${term.name}" is filled by rules: its products are listed newest first, in no order of yours.`);
    const handles = [...new Set(args.order.map((h) => h.trim().toLowerCase()))];
    const rows = await db().execute<Row>(sql`
      select p.id, p.handle from commerce.products p
      join commerce.product_terms pt on pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id = ${term.id}::uuid
      where p.store_id = ${ctx.store.id}::uuid and lower(p.handle) = any(${textList(handles)})
    `);
    const byHandle = new Map(rows.map((r) => [String(r.handle).toLowerCase(), String(r.id)]));
    const missing = handles.filter((h) => !byHandle.has(h));
    if (missing.length > 0) fail(`Not in "${term.name}": ${missing.join(", ")}. Only its own products can be put in order.`);
    order = handles.map((h) => byHandle.get(h)!);
  }
  return { term, terms, input, order, rules, names: namesOf(terms, choices) };
}

/** `update_category` (gated `public`): the change, saved by the categories page's own save, then its order. */
export async function updateCategoryTool(ctx: Ctx, args: UpdateCategoryArgs) {
  const change = await categoryChange(ctx, args);
  const scope = scopeOf(ctx.store);
  const saved = await updateTerm(ctx.account, scope, change.term.id, change.input);
  if (!saved.ok) return fail(saved.problems.join(" "));
  if (change.order) {
    const ordered = await setTermOrder(ctx.account, ctx.store.id, change.term.id, change.order);
    if (!ordered.ok) return fail(ordered.problems.join(" "));
  }
  ctx.invalidate(termsTag(scope));
  ctx.invalidate(catalogTag(ctx.store.id));
  return { done: (await wordsOf(change)).replace(/^Change/, "Changed") };
}

export const preflightUpdateCategory = async (ctx: Ctx, args: UpdateCategoryArgs) => void (await categoryChange(ctx, args));

async function wordsOf(change: CategoryChange): Promise<string> {
  const parts: string[] = [];
  if (change.input.description !== undefined) parts.push(change.input.description === null ? "remove its description" : "set its description");
  if (change.input.image !== undefined) parts.push(change.input.image === null ? "remove its picture" : "set its picture");
  if (change.order) parts.push(`put ${change.order.length} of its products first, in that order`);
  if (change.rules !== undefined) {
    parts.push(change.rules === null ? "fill it by hand again, keeping the products that match now" : `fill it by rules: ${describeRules(change.rules, change.names)}`);
  }
  return `Change the ${change.term.kind} "${change.term.name}": ${parts.join("; ") || "nothing"}.`;
}

/** The approval's words, from the store's own category and names; the plain summary when the call cannot be read. */
export async function categoryApprovalWords(ctx: Ctx, args: Record<string, unknown>): Promise<string> {
  const parsed = updateCategoryInput.safeParse(args);
  if (!parsed.success) return categoryApprovalSummary(args);
  const change = await categoryChange(ctx, parsed.data).catch(() => null);
  return change ? wordsOf(change) : categoryApprovalSummary(args);
}
