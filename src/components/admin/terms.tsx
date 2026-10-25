"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";

import {
  TERM_NAME_MAX,
  byName,
  categoryTree,
  selfAndDescendants,
  type Term,
  type TermIds,
  type TermKind,
} from "@/lib/taxonomy";
import type { TermsResult } from "@/server/taxonomy";

import { countWords, fillWords } from "@/lib/admin-fill";
import type { TermSeo } from "@/lib/term-seo";

import { useAdminText } from "./admin-text";
import { TermFieldsButton, type TermFieldsSetup } from "./term-fields";
import { TermSeoFields, seoLanguagesOf, type TermSeoSetup } from "./term-seo-fields";
import { TermPageFields, TermProductOrder, type TermPageDraft, type TermPageSetup } from "./term-page-fields";
import { TermRulesFields, type TermRulesDraft } from "./term-rules-fields";
import { Card } from "@/components/admin/ui";

/**
 * Categories and tags in the admin (D50): `TermPicker` chooses an item's
 * (a page's or a product's), with a quick way to add one; `TermsManager`
 * adds, renames, moves and deletes them. Both work through server actions
 * bound to their owner and kind of content.
 */

/** What editing a category or tag answers: the list, and (wave 2, D168) a sentence when its address changed and a redirect from the old one was left. */
export type TermsOutcome = TermsResult & { note?: string };

export type TermActions = {
  create: (input: {
    kind: TermKind;
    name: string;
    slug?: string;
    parentId?: string | null;
    /** Unit price (D160): a product category's products need a content. Only the product categories screen sends it. */
    requiresUnitPrice?: boolean;
  }) => Promise<TermsResult>;
  update: (
    id: string,
    input: { name: string; slug: string; parentId: string | null; requiresUnitPrice?: boolean; seo?: TermSeo } & Partial<TermPageDraft>,
  ) => Promise<TermsOutcome>;
  remove: (id: string) => Promise<TermsResult>;
};

const input = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";
const button = "min-h-10 rounded-pill border border-edge px-3 text-sm disabled:opacity-50";

function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <p role="alert" className="text-sm text-danger-text">
      {problems.join(" ")}
    </p>
  );
}

/** An item's categories (as a tree) and tags, chosen with checkboxes. */
export function TermPicker({
  terms,
  value,
  onChange,
  onTerms,
  create,
  manageHref,
}: {
  terms: Term[];
  value: TermIds;
  onChange: (value: TermIds) => void;
  /** New categories and tags from the server after one is added. */
  onTerms: (terms: Term[]) => void;
  create: TermActions["create"];
  manageHref: string;
}) {
  const w = useAdminText("products").terms;
  const tree = categoryTree(terms);
  const tags = terms.filter((t) => t.kind === "tag").sort(byName);
  const toggle = (kind: TermKind, id: string, on: boolean) => {
    const key = kind === "category" ? "categories" : "tags";
    const ids = value[key].filter((x) => x !== id);
    onChange({ ...value, [key]: on ? [...ids, id] : ids });
  };
  return (
    <div className="flex flex-col gap-5">
      {(["category", "tag"] as const).map((kind) => {
        const list = kind === "category" ? tree : tags.map((t) => ({ ...t, depth: 0 }));
        const chosen = new Set(kind === "category" ? value.categories : value.tags);
        return (
          <fieldset key={kind} className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{w.labels[kind].many}</legend>
            {list.length === 0 ? (
              <p className="text-sm text-muted">{w.noneYet}</p>
            ) : (
              <ul className={kind === "tag" ? "flex flex-wrap gap-2" : "flex flex-col gap-1"}>
                {list.map((term) => (
                  <li key={term.id} style={{ paddingLeft: `${term.depth * 1.25}rem` }}>
                    <label
                      className={
                        kind === "tag"
                          ? "flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-line px-3 text-sm has-checked:border-brand has-checked:bg-sunken"
                          : "flex min-h-8 items-center gap-2 text-sm"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={chosen.has(term.id)}
                        // One filled by rules (D319) holds what its rules say: nothing is placed in it by hand.
                        disabled={Boolean(term.rules)}
                        onChange={(event) => toggle(kind, term.id, event.target.checked)}
                        className="size-4"
                      />
                      {term.name}
                      {term.rules ? <span className="text-xs text-muted">· {w.byRules}</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <QuickAdd
              kind={kind}
              create={create}
              onCreated={(id, next) => {
                onTerms(next);
                toggle(kind, id, true);
              }}
            />
          </fieldset>
        );
      })}
      <Link href={manageHref} className="w-fit text-sm underline">
        {w.manage}
      </Link>
    </div>
  );
}

/** Adds a category (at the top) or a tag by its name, and chooses it. */
function QuickAdd({
  kind,
  create,
  onCreated,
}: {
  kind: TermKind;
  create: TermActions["create"];
  onCreated: (id: string, terms: Term[]) => void;
}) {
  const w = useAdminText("products").terms;
  const id = useId();
  const [name, setName] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const add = () =>
    start(async () => {
      const result = await create({ kind, name });
      if (!result.ok) return setProblems(result.problems);
      setProblems([]);
      setName("");
      onCreated(result.id, result.terms);
    });
  const label = w.newTerm[kind];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input
          id={id}
          value={name}
          maxLength={TERM_NAME_MAX}
          placeholder={label}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            // Inside the page's or product's form: Enter adds this, not saves that.
            if (event.key === "Enter") {
              event.preventDefault();
              if (name.trim()) add();
            }
          }}
          className={`${input} min-w-0 flex-1`}
        />
        <button type="button" onClick={add} disabled={busy || !name.trim()} className={button}>
          {busy ? w.adding : w.add}
        </button>
      </div>
      <Problems problems={problems} />
    </div>
  );
}

/**
 * The unit price mark on a store's product categories (D160): `gaps` is how many active products of each marked category
 * (and of its subcategories) have a shipped variant without a content, by category id; `needsHref` opens the products page's
 * list of them.
 */
export type UnitPriceCategories = { gaps: Record<string, number>; needsHref: string };

/** The checkbox of the mark, with what it does. */
function UnitPriceMark({ id, checked, onChange }: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const w = useAdminText("products").terms;
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <label className="flex items-center gap-2" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4" />
        {w.markLabel}
      </label>
      <span className="pl-6 text-xs text-muted">{w.markHint}</span>
    </div>
  );
}

/** Every category (as a tree) and tag of one owner and kind of content, to add, change and delete. */
export function TermsManager({
  initial,
  actions,
  usedBy,
  fields,
  unitPrice,
  seo,
  page,
}: {
  initial: Term[];
  actions: TermActions;
  usedBy: string;
  /** Custom fields on the categories and tags (D118), when the store has groups for them. */
  fields?: TermFieldsSetup;
  /** Only a store's product categories (D160): the checkbox "need a price per kg or litre", with how many products still lack a content. */
  unitPrice?: UnitPriceCategories;
  /** Only a store's product categories and tags (wave 2, D168): a title and a description for search results, in each of the store's languages. */
  seo?: TermSeoSetup;
  /** Only a store's product categories and tags (wave 6 unit A, D319): a picture, a description, names in other languages and the order of products. */
  page?: TermPageSetup;
}) {
  const w = useAdminText("products").terms;
  const [terms, setTerms] = useState(initial);
  const tree = categoryTree(terms);
  const tags = terms.filter((t) => t.kind === "tag").sort(byName);
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {(["category", "tag"] as const).map((kind) => {
        const list = kind === "category" ? tree : tags.map((t) => ({ ...t, depth: 0 }));
        return (
          <Card
            key={kind}
            title={w.labels[kind].many}
            description={fillWords(w.descriptions[kind], { usedBy })}
            className="flex flex-col gap-4"
            compact
          >
            <NewTerm kind={kind} terms={terms} actions={actions} onTerms={setTerms} unitPrice={kind === "category" && unitPrice !== undefined} />
            {list.length === 0 ? (
              <p className="text-sm text-muted">{w.emptyList[kind]}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line border-y border-line">
                {list.map((term) => (
                  <TermRow
                    key={term.id}
                    term={term}
                    terms={terms}
                    actions={actions}
                    onTerms={setTerms}
                    fields={fields}
                    unitPrice={kind === "category" ? unitPrice : undefined}
                    seo={seo}
                    page={page}
                  />
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** The categories a category can go under: any but itself and its own subcategories. */
function ParentSelect({
  id,
  terms,
  value,
  onChange,
  exclude,
}: {
  id: string;
  terms: Term[];
  value: string | null;
  onChange: (value: string | null) => void;
  exclude: Set<string>;
}) {
  const w = useAdminText("products").terms;
  return (
    <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className={input}>
      <option value="">{w.top}</option>
      {categoryTree(terms)
        .filter((c) => !exclude.has(c.id))
        .map((c) => (
          <option key={c.id} value={c.id}>
            {" ".repeat(c.depth)}
            {c.name}
          </option>
        ))}
    </select>
  );
}

function NewTerm({
  kind,
  terms,
  actions,
  onTerms,
  unitPrice = false,
}: {
  kind: TermKind;
  terms: Term[];
  actions: TermActions;
  onTerms: (terms: Term[]) => void;
  /** Offer the unit price mark (a store's product categories). */
  unitPrice?: boolean;
}) {
  const w = useAdminText("products").terms;
  const id = useId();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await actions.create({ kind, name, parentId, ...(unitPrice && marked ? { requiresUnitPrice: true } : {}) });
          if (!result.ok) return setProblems(result.problems);
          setProblems([]);
          setName("");
          setMarked(false);
          onTerms(result.terms);
        });
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-40 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            {w.newTerm[kind]}
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={TERM_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            className={input}
          />
        </div>
        {kind === "category" && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-parent`} className="text-sm font-medium">
              {w.inside}
            </label>
            <ParentSelect id={`${id}-parent`} terms={terms} value={parentId} onChange={setParentId} exclude={new Set()} />
          </div>
        )}
        <button type="submit" disabled={busy || !name.trim()} className={`${button} bg-brand font-medium text-brand-ink`}>
          {busy ? w.adding : w.addTerm[kind]}
        </button>
      </div>
      {unitPrice && <UnitPriceMark id={`${id}-unit-price`} checked={marked} onChange={setMarked} />}
      <Problems problems={problems} />
    </form>
  );
}

function TermRow({
  term,
  terms,
  actions,
  onTerms,
  fields,
  unitPrice,
  seo,
  page,
}: {
  term: Term & { depth: number };
  terms: Term[];
  actions: TermActions;
  onTerms: (terms: Term[]) => void;
  fields?: TermFieldsSetup;
  /** Set on a store's product categories (D160). */
  unitPrice?: UnitPriceCategories;
  /** Set on a store's product categories and tags (D168): the search texts. */
  seo?: TermSeoSetup;
  /** Set on a store's product categories and tags (D319): its own page and its products' order. */
  page?: TermPageSetup;
}) {
  const w = useAdminText("products").terms;
  const rw = useAdminText("products").termRules;
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const marked = term.requiresUnitPrice === true;
  const pageOf = (t: Term): TermPageDraft => ({ description: t.description ?? null, image: t.image ?? null, texts: t.texts ?? {} });
  const rulesOf = (t: Term): TermRulesDraft => ({ rules: t.rules ?? null, keepMatches: false });
  const [draft, setDraft] = useState({
    name: term.name,
    slug: term.slug,
    parentId: term.parentId,
    requiresUnitPrice: marked,
    seo: term.seo ?? ({} as TermSeo),
    page: pageOf(term),
    rules: rulesOf(term),
  });
  const [problems, setProblems] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const run = (action: () => Promise<TermsOutcome>, after: () => void) =>
    start(async () => {
      const result = await action();
      if (!result.ok) return setProblems(result.problems);
      setProblems([]);
      setNote(result.note ?? null);
      after();
      onTerms(result.terms);
    });
  const seoLanguages = seo ? seoLanguagesOf(term.seo, seo) : [];
  const gaps = unitPrice?.gaps[term.id] ?? 0;

  return (
    <li className="flex flex-col gap-2 py-2" style={{ paddingLeft: `${term.depth * 1.5}rem` }}>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            // Only a screen that offers the mark sends it, and only one that offers search texts sends those: left out, they stay as they were.
            const { requiresUnitPrice, seo: drafted, page: pageDraft, rules: rulesDraft, ...rest } = draft;
            // Rules are sent only when they changed (D319), so a rename never re-checks them.
            const rulesChanged = JSON.stringify(rulesDraft.rules) !== JSON.stringify(term.rules ?? null);
            run(
              () =>
                actions.update(term.id, {
                  ...rest,
                  ...(unitPrice ? { requiresUnitPrice } : {}),
                  ...(seo ? { seo: drafted } : {}),
                  ...(page ? pageDraft : {}),
                  ...(page?.countRules && rulesChanged ? { rules: rulesDraft.rules, keepMatches: rulesDraft.keepMatches } : {}),
                }),
              () => setEditing(false),
            );
          }}
          className="flex flex-col gap-2"
          aria-label={fillWords(w.changeForm, { name: term.name })}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-36 flex-1 flex-col gap-1">
              <label htmlFor={`${id}-name`} className="text-xs font-medium">
                {w.name}
              </label>
              <input
                id={`${id}-name`}
                value={draft.name}
                maxLength={TERM_NAME_MAX}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className={input}
              />
            </div>
            <div className="flex min-w-36 flex-1 flex-col gap-1">
              <label htmlFor={`${id}-slug`} className="text-xs font-medium">
                {w.address}
              </label>
              <input
                id={`${id}-slug`}
                value={draft.slug}
                maxLength={80}
                spellCheck={false}
                onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                className={`${input} font-mono`}
              />
            </div>
            {term.kind === "category" && (
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-parent`} className="text-xs font-medium">
                  {w.inside}
                </label>
                <ParentSelect
                  id={`${id}-parent`}
                  terms={terms}
                  value={draft.parentId}
                  onChange={(parentId) => setDraft({ ...draft, parentId })}
                  exclude={selfAndDescendants(terms, term.id)}
                />
              </div>
            )}
          </div>
          {unitPrice && (
            <UnitPriceMark id={`${id}-unit-price`} checked={draft.requiresUnitPrice} onChange={(requiresUnitPrice) => setDraft({ ...draft, requiresUnitPrice })} />
          )}
          {page && <TermPageFields setup={page} value={draft.page} onChange={(next) => setDraft({ ...draft, page: next })} />}
          {page && !draft.requiresUnitPrice && (
            <TermRulesFields setup={page} termId={term.id} before={term.rules ?? null} value={draft.rules} onChange={(next) => setDraft({ ...draft, rules: next })} />
          )}
          {seo && (
            <TermSeoFields setup={seo} name={draft.name || term.name} kind={term.kind} slug={draft.slug || term.slug} value={draft.seo} onChange={(next) => setDraft({ ...draft, seo: next })} />
          )}
          {seo && <p className="text-xs text-muted">{w.redirectNote}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={`${button} bg-brand font-medium text-brand-ink`}>
              {w.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft({ name: term.name, slug: term.slug, parentId: term.parentId, requiresUnitPrice: marked, seo: term.seo ?? {}, page: pageOf(term), rules: rulesOf(term) });
                setProblems([]);
              }}
              className={button}
            >
              {w.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{term.name}</span>
            <span className="font-mono text-xs text-muted">{term.slug}</span>
            {term.rules && <span className="text-xs text-muted">{countWords(term.rules.conditions.length, rw.summary)}</span>}
            {seo && (
              <span className="text-xs text-muted">{seoLanguages.length > 0 ? fillWords(w.seoIn, { languages: seoLanguages.join(", ") }) : w.seoNone}</span>
            )}
            {unitPrice && marked && (
              <span className="text-xs text-muted">
                {w.needsUnit} {gaps === 0 ? w.gapNone : countWords(gaps, w.gaps)}{" "}
                {gaps > 0 && (
                  <Link href={unitPrice.needsHref} className="underline">
                    {w.showThem}
                  </Link>
                )}
              </span>
            )}
          </span>
          {confirming ? (
            <span className="flex items-center gap-2 text-sm">
              {fillWords(w.deleteQuestion, { name: term.name, sub: term.kind === "category" ? w.deleteSub : "" })}
              <button type="button" onClick={() => setConfirming(false)} className={button}>
                {w.keep}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => actions.remove(term.id), () => setConfirming(false))}
                className={`${button} border-danger-text bg-danger-soft font-medium text-danger-text`}
              >
                {w.delete}
              </button>
            </span>
          ) : (
            <span className="flex flex-wrap gap-2">
              {page && !term.rules && <TermProductOrder termId={term.id} setup={page} />}
              {fields && <TermFieldsButton term={term} setup={fields} />}
              <button type="button" onClick={() => setEditing(true)} className={button} aria-label={fillWords(w.changeAria[term.kind], { name: term.name })}>
                {w.change}
              </button>
              <button type="button" onClick={() => setConfirming(true)} className={button} aria-label={fillWords(w.deleteAria[term.kind], { name: term.name })}>
                {w.delete}
              </button>
            </span>
          )}
        </div>
      )}
      {note && (
        <p role="status" className="text-sm">
          {note}
        </p>
      )}
      <Problems problems={problems} />
    </li>
  );
}
