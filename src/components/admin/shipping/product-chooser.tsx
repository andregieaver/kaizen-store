"use client";

import { useMemo, useState } from "react";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "../admin-text";

/**
 * The products of a shipping profile, chosen by search (D237 2.1): a filter over the store's products and a box per product, sent as `product`
 * fields with the form. A product in another profile says so; ticking it here moves it on save. Shows how many are ticked.
 */
export function ProductChooser({
  products,
  chosen,
  profileNames,
  self,
  disabled = false,
}: {
  products: { id: string; title: string; profileId: string | null; shipped: boolean }[];
  chosen: string[];
  profileNames: Record<string, string>;
  /** The profile being edited (null: a new one). */
  self: string | null;
  disabled?: boolean;
}) {
  const w = useAdminText("shipping").profiles.chooser;
  const [ticked, setTicked] = useState(() => new Set(chosen));
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? products.filter((p) => p.title.toLowerCase().includes(q)) : products;
    // Ticked first, so what is in the profile is seen without searching.
    return [...list].sort((a, b) => Number(ticked.has(b.id)) - Number(ticked.has(a.id)));
  }, [products, query, ticked]);
  const toggle = (id: string) =>
    setTicked((all) => {
      const next = new Set(all);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <fieldset className="flex flex-col gap-2 text-sm" disabled={disabled}>
      <legend className="mb-1">
        {w.legend}
        <span className="tabular-nums">{ticked.size}</span>
      </legend>
      {[...ticked].map((id) => (
        <input key={id} type="hidden" name="product" value={id} />
      ))}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={w.search}
        aria-label={w.search}
        className="min-h-10 w-full max-w-md rounded-md border border-line bg-card px-3"
      />
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-panel bg-sunken p-3">
        {shown.slice(0, 200).map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ticked.has(p.id)} onChange={() => toggle(p.id)} />
              <span>{p.title}</span>
              {!p.shipped && <span className="text-muted">{w.notShipped}</span>}
              {p.profileId && p.profileId !== self && !ticked.has(p.id) && <span className="text-muted">{fillWords(w.inOther, { name: profileNames[p.profileId] ?? w.anotherProfile })}</span>}
            </label>
          </li>
        ))}
        {shown.length > 200 && <li className="text-muted">{fillWords(w.more, { n: shown.length - 200 })}</li>}
        {shown.length === 0 && <li className="text-muted">{w.none}</li>}
      </ul>
    </fieldset>
  );
}
