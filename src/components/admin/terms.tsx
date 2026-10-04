"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";

import {
  TERM_LABELS,
  TERM_NAME_MAX,
  byName,
  categoryTree,
  selfAndDescendants,
  type Term,
  type TermIds,
  type TermKind,
} from "@/lib/taxonomy";
import type { TermsResult } from "@/server/taxonomy";

import { categoryGapWords } from "@/lib/unit-price-editor";

import { TermFieldsButton, type TermFieldsSetup } from "./term-fields";

/**
 * Categories and tags in the admin (D50): `TermPicker` chooses an item's
 * (a page's or a product's), with a quick way to add one; `TermsManager`
 * adds, renames, moves and deletes them. Both work through server actions
 * bound to their owner and kind of content.
 */

export type TermActions = {
  create: (input: {
    kind: TermKind;
    name: string;
    slug?: string;
    parentId?: string | null;
    /** Unit price (D160): a product category's products need a content. Only the product categories screen sends it. */
    requiresUnitPrice?: boolean;
  }) => Promise<TermsResult>;
  update: (id: string, input: { name: string; slug: string; parentId: string | null; requiresUnitPrice?: boolean }) => Promise<TermsResult>;
  remove: (id: string) => Promise<TermsResult>;
};

const input = "min-h-10 rounded-md border border-border bg-background px-3 text-sm";
const button = "min-h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50";

function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <p role="alert" className="text-sm text-red-700 dark:text-red-400">
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
            <legend className="mb-1 text-sm font-medium">{TERM_LABELS[kind].many}</legend>
            {list.length === 0 ? (
              <p className="text-sm text-muted">None yet.</p>
            ) : (
              <ul className={kind === "tag" ? "flex flex-wrap gap-2" : "flex flex-col gap-1"}>
                {list.map((term) => (
                  <li key={term.id} style={{ paddingLeft: `${term.depth * 1.25}rem` }}>
                    <label
                      className={
                        kind === "tag"
                          ? "flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-border px-3 text-sm has-checked:border-foreground has-checked:bg-surface"
                          : "flex min-h-8 items-center gap-2 text-sm"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={chosen.has(term.id)}
                        onChange={(event) => toggle(kind, term.id, event.target.checked)}
                        className="size-4"
                      />
                      {term.name}
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
        Manage categories and tags
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
  const label = `New ${TERM_LABELS[kind].one.toLowerCase()}`;
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
          {busy ? "Adding …" : "Add"}
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

const MARK_LABEL = "Products in this category need a price per kg or litre";

/** The checkbox of the mark, with what it does. */
function UnitPriceMark({ id, checked, onChange }: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <label className="flex items-center gap-2" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4" />
        {MARK_LABEL}
      </label>
      <span className="pl-6 text-xs text-muted">
        It applies to the category&apos;s products and its subcategories&apos;. Nothing changes in the shop at once; products on sale
        without a content are listed, and one is refused the next time it is saved.
      </span>
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
}: {
  initial: Term[];
  actions: TermActions;
  usedBy: string;
  /** Custom fields on the categories and tags (D118), when the store has groups for them. */
  fields?: TermFieldsSetup;
  /** Only a store's product categories (D160): the checkbox "need a price per kg or litre", with how many products still lack a content. */
  unitPrice?: UnitPriceCategories;
}) {
  const [terms, setTerms] = useState(initial);
  const tree = categoryTree(terms);
  const tags = terms.filter((t) => t.kind === "tag").sort(byName);
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {(["category", "tag"] as const).map((kind) => {
        const list = kind === "category" ? tree : tags.map((t) => ({ ...t, depth: 0 }));
        return (
          <section key={kind} aria-labelledby={`${kind}-heading`} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
            <div className="flex flex-col gap-1">
              <h2 id={`${kind}-heading`} className="font-medium">
                {TERM_LABELS[kind].many}
              </h2>
              <p className="text-sm text-muted">
                {kind === "category"
                  ? `Group ${usedBy}; a category can hold subcategories. A grid showing a category shows its subcategories' ${usedBy} too.`
                  : `Label ${usedBy} across categories. Tags are one flat list.`}
              </p>
            </div>
            <NewTerm kind={kind} terms={terms} actions={actions} onTerms={setTerms} unitPrice={kind === "category" && unitPrice !== undefined} />
            {list.length === 0 ? (
              <p className="text-sm text-muted">No {TERM_LABELS[kind].many.toLowerCase()} yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border border-y border-border">
                {list.map((term) => (
                  <TermRow key={term.id} term={term} terms={terms} actions={actions} onTerms={setTerms} fields={fields} unitPrice={kind === "category" ? unitPrice : undefined} />
                ))}
              </ul>
            )}
          </section>
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
  return (
    <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className={input}>
      <option value="">At the top</option>
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
  const id = useId();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const one = TERM_LABELS[kind].one.toLowerCase();
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
            New {one}
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
              Inside
            </label>
            <ParentSelect id={`${id}-parent`} terms={terms} value={parentId} onChange={setParentId} exclude={new Set()} />
          </div>
        )}
        <button type="submit" disabled={busy || !name.trim()} className={`${button} bg-foreground font-medium text-background`}>
          {busy ? "Adding …" : `Add ${one}`}
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
}: {
  term: Term & { depth: number };
  terms: Term[];
  actions: TermActions;
  onTerms: (terms: Term[]) => void;
  fields?: TermFieldsSetup;
  /** Set on a store's product categories (D160). */
  unitPrice?: UnitPriceCategories;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const marked = term.requiresUnitPrice === true;
  const [draft, setDraft] = useState({ name: term.name, slug: term.slug, parentId: term.parentId, requiresUnitPrice: marked });
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const run = (action: () => Promise<TermsResult>, after: () => void) =>
    start(async () => {
      const result = await action();
      if (!result.ok) return setProblems(result.problems);
      setProblems([]);
      after();
      onTerms(result.terms);
    });
  const one = TERM_LABELS[term.kind].one.toLowerCase();

  return (
    <li className="flex flex-col gap-2 py-2" style={{ paddingLeft: `${term.depth * 1.5}rem` }}>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            // Only a screen that offers the mark sends it: left out, it stays as it was.
            const { requiresUnitPrice, ...rest } = draft;
            run(() => actions.update(term.id, unitPrice ? { ...rest, requiresUnitPrice } : rest), () => setEditing(false));
          }}
          className="flex flex-col gap-2"
          aria-label={`Change ${term.name}`}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-36 flex-1 flex-col gap-1">
              <label htmlFor={`${id}-name`} className="text-xs font-medium">
                Name
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
                Address
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
                  Inside
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
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={`${button} bg-foreground font-medium text-background`}>
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft({ name: term.name, slug: term.slug, parentId: term.parentId, requiresUnitPrice: marked });
                setProblems([]);
              }}
              className={button}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{term.name}</span>
            <span className="font-mono text-xs text-muted">{term.slug}</span>
            {unitPrice && marked && (
              <span className="text-xs text-muted">
                Needs a price per kg or litre. {categoryGapWords(unitPrice.gaps[term.id] ?? 0)}{" "}
                {(unitPrice.gaps[term.id] ?? 0) > 0 && (
                  <Link href={unitPrice.needsHref} className="underline">
                    Show them
                  </Link>
                )}
              </span>
            )}
          </span>
          {confirming ? (
            <span className="flex items-center gap-2 text-sm">
              Delete {term.name}
              {term.kind === "category" ? " (its subcategories move up)" : ""}?
              <button type="button" onClick={() => setConfirming(false)} className={button}>
                Keep
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => actions.remove(term.id), () => setConfirming(false))}
                className={`${button} border-red-700 bg-red-700 font-medium text-white`}
              >
                Delete
              </button>
            </span>
          ) : (
            <span className="flex gap-2">
              {fields && <TermFieldsButton term={term} setup={fields} />}
              <button type="button" onClick={() => setEditing(true)} className={button} aria-label={`Change ${one} ${term.name}`}>
                Change
              </button>
              <button type="button" onClick={() => setConfirming(true)} className={button} aria-label={`Delete ${one} ${term.name}`}>
                Delete
              </button>
            </span>
          )}
        </div>
      )}
      <Problems problems={problems} />
    </li>
  );
}
