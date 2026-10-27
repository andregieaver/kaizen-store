"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { Button, Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import {
  keepForCategory,
  MAX_ATTRIBUTE_VALUES,
  type CategoryDetails,
  type CategoryHit,
  type LoadCategory,
  type SearchCategories,
  type StandardAttributes,
} from "@/lib/product-taxonomy";

/**
 * The product editor's Category card (wave 6 unit I, D327): the standard taxonomy's category, found by typing what the product is, and
 * one step away its attributes, each a set of values to tick. The taxonomy stays on the server; this asks it through two read-only
 * actions and keeps only the category's id and the chosen values' ids, which are saved with the product.
 */

type Props = {
  category: string | null;
  attributes: StandardAttributes;
  onChange: (category: string | null, attributes: StandardAttributes) => void;
  search: SearchCategories;
  details: LoadCategory;
};

export function ProductCategoryCard({ category, attributes, onChange, search, details }: Props) {
  const w = useAdminText("product").standard;
  const [shown, setShown] = useState<CategoryDetails | null>(null);
  const [missing, setMissing] = useState(false);
  const [choosing, setChoosing] = useState(category === null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CategoryHit[] | null>(null);
  const [pending, start] = useTransition();
  const asked = useRef(0);
  const searchId = useId();

  // The chosen category's path and attributes, read again whenever it changes.
  useEffect(() => {
    if (category === null || shown?.id === category) return;
    let live = true;
    details(category).then((found) => {
      if (!live) return;
      setShown(found);
      setMissing(found === null);
    });
    return () => {
      live = false;
    };
  }, [category, details, shown?.id]);

  // Searching as the person types, a quarter of a second after they stop; an answer to an older query is dropped.
  useEffect(() => {
    const words = query.trim();
    if (words.length < 2) return;
    const ask = ++asked.current;
    const timer = setTimeout(() => {
      start(async () => {
        const found = await search(words);
        if (ask === asked.current) setHits(found);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, search]);

  const choose = (hit: CategoryHit) => {
    start(async () => {
      const found = await details(hit.id);
      if (!found) return;
      setShown(found);
      setMissing(false);
      setChoosing(false);
      setQuery("");
      setHits(null);
      onChange(found.id, keepForCategory(found.attributes.map((a) => a.id), attributes));
    });
  };

  const toggle = (attributeId: number, valueId: number, on: boolean) => {
    const key = String(attributeId);
    const was = attributes[key] ?? [];
    const next = on ? [...was, valueId].slice(0, MAX_ATTRIBUTE_VALUES) : was.filter((v) => v !== valueId);
    const rest = Object.fromEntries(Object.entries(attributes).filter(([k]) => k !== key));
    onChange(category, next.length > 0 ? { ...rest, [key]: next } : rest);
  };

  const chosenCount = Object.values(attributes).reduce((sum, values) => sum + values.length, 0);

  return (
    <Card title={w.title} description={w.intro}>
      <div className="flex flex-col gap-4">
        {category !== null && !choosing && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-body text-ink" data-testid="standard-category">
              {shown ? shown.path : missing ? fillWords(w.unknown, { id: category }) : "…"}
            </p>
            <div className="flex gap-2">
              <Button size="dense" onClick={() => setChoosing(true)}>
                {w.change}
              </Button>
              <Button
                size="dense"
                onClick={() => {
                  setShown(null);
                  setMissing(false);
                  setChoosing(true);
                  onChange(null, {});
                }}
              >
                {w.remove}
              </Button>
            </div>
          </div>
        )}
        {(choosing || category === null) && (
          <div className="flex max-w-xl flex-col gap-2">
            <label htmlFor={searchId} className="flex flex-col gap-1 text-sm">
              <span className="text-body-strong">{w.search}</span>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value.trim().length < 2) setHits(null);
                }}
                autoComplete="off"
                className="min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm"
                aria-describedby={`${searchId}-hint`}
              />
              <span id={`${searchId}-hint`} className="text-muted">
                {w.searchHint}
              </span>
            </label>
            <div role="status" aria-live="polite" className="text-sm text-muted">
              {pending && query.trim().length >= 2 ? w.searching : hits && hits.length === 0 ? w.noMatch : ""}
            </div>
            {hits && hits.length > 0 && (
              <ul className="flex flex-col divide-y divide-line rounded-panel border border-line">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button type="button" onClick={() => choose(hit)} className="flex w-full flex-col items-start gap-0.5 rounded-pill px-3 py-2 text-left hover:bg-sunken">
                      <span className="text-body-strong text-ink">{hit.name}</span>
                      <span className="text-caption text-muted">{hit.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {category !== null && shown && shown.attributes.length > 0 && (
          <details className="rounded-panel border border-line">
            <summary className="cursor-pointer px-4 py-3 text-body-strong">
              {w.attributes}
              {chosenCount > 0 && <span className="ml-2 text-muted">{fillWords(w.chosen, { n: chosenCount })}</span>}
            </summary>
            <div className="flex flex-col gap-2 px-4 pb-4">
              <p className="text-sm text-muted">{w.attributesHint}</p>
              {shown.attributes.map((attribute) => {
                const picked = new Set(attributes[String(attribute.id)] ?? []);
                return (
                  <details key={attribute.id} className="rounded-panel bg-sunken">
                    <summary className="cursor-pointer px-3 py-2 text-sm">
                      {attribute.name}
                      {picked.size > 0 && <span className="ml-2 text-muted">{fillWords(w.chosen, { n: picked.size })}</span>}
                    </summary>
                    <fieldset className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-4 gap-y-1 overflow-y-auto px-3 pb-3">
                      <legend className="sr-only">{attribute.name}</legend>
                      {attribute.values.map((value) => (
                        <label key={value.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={picked.has(value.id)} onChange={(e) => toggle(attribute.id, value.id, e.target.checked)} />
                          {value.name}
                        </label>
                      ))}
                    </fieldset>
                  </details>
                );
              })}
            </div>
          </details>
        )}
        {shown && <p className="text-caption text-muted">{fillWords(w.release, { release: shown.release })}</p>}
      </div>
    </Card>
  );
}
