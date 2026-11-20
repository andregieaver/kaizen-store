"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { bundleUpsell, signUpCurrency, type UpsellBundle } from "@/lib/bundle-upsell";
import type { ExtensionId } from "@/lib/extensions";
import { formatMoney } from "@/lib/money";
import type { signUpWorkspaceText } from "@/lib/messages/sign-up-workspace";

type Words = ReturnType<typeof signUpWorkspaceText>["picker"];

/** A price a month in each currency the price list has (the founding price while it is offered). */
type Prices = Record<string, number>;

export type PickerExtension = { id: ExtensionId; name: string; description: string; prices: Prices };
export type PickerBundle = { id: string; name: string; description: string; members: ExtensionId[]; prices: Prices };

/** What is ticked and chosen; the bundles the page chose for them (`auto`) and those they took off after (`declined`); the last switch, said. */
type State = {
  ticked: ExtensionId[];
  chosen: string[];
  auto: string[];
  declined: string[];
  /** The bundles each one the page chose took the place of: back when it is taken off. */
  replaced: Record<string, string[]>;
  switched: { bundle: string; from: number } | null;
};

const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

/**
 * The sign-up for extensions' choices (D748 E7, D859): the bundles over the extensions, each with its price a month in the currency of the
 * country chosen below. A chosen bundle ticks its extensions and holds them (the bundle is what is sent: the server starts every part's
 * trial). As the person ticks, `bundleUpsell()` chooses a bundle for them when it holds everything for no more (and says why; one they take
 * off is offered, never chosen again), or proposes one for a little more that adds something they can use. Without script the boxes work
 * as plain checkboxes.
 */
export function ExtensionPicker({
  extensions,
  bundles,
  names,
  partPrices,
  needsStore,
  currencies,
  nearPercent,
  initial,
  lang,
  w,
}: {
  /** The extensions sold on their own, to tick. */
  extensions: PickerExtension[];
  bundles: PickerBundle[];
  /** Every extension's name, for a bundle's parts that are not ticked here. */
  names: Record<string, string>;
  /** Every extension's price a month, those not sold on their own too: what a bundle saves against its parts one by one. */
  partPrices: Record<string, Prices>;
  /** Parts that do nothing without a store. */
  needsStore: ExtensionId[];
  /** Each country's currency, by its code, to price in the country chosen below. */
  currencies: Record<string, string>;
  nearPercent: number;
  /** What a link asked to tick (`?with=`). */
  initial: ExtensionId[];
  lang: string;
  w: Words;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ ticked: initial, chosen: [], auto: [], declined: [], replaced: {}, switched: null });
  const [country, setCountry] = useState<string | null>(null);
  const [withStore, setWithStore] = useState(false);

  // The country and the store box are the form's own fields, outside this part: read as they change.
  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    const read = () => {
      const select = form.querySelector<HTMLSelectElement>('select[name="country"]');
      const store = form.querySelector<HTMLInputElement>('input[name="store"]');
      setCountry(select?.value || null);
      setWithStore(Boolean(store?.checked));
    };
    read();
    form.addEventListener("change", read);
    return () => form.removeEventListener("change", read);
  }, []);

  const priced = useMemo(() => [...new Set([...extensions, ...bundles].flatMap((x) => Object.keys(x.prices)))].sort(), [extensions, bundles]);
  const currency = signUpCurrency(country ? (currencies[country] ?? null) : null, priced);
  const money = (minor: number) => (currency ? formatMoney(minor, currency, lang) : "");
  const list = (ids: readonly string[]) => new Intl.ListFormat(lang, { type: "conjunction" }).format(ids.map((id) => names[id] ?? id));

  function upsellOf(s: Pick<State, "ticked" | "chosen" | "declined">) {
    if (!currency) return null;
    const prices: Partial<Record<ExtensionId, number>> = {};
    for (const e of extensions) if (e.prices[currency] !== undefined) prices[e.id] = e.prices[currency];
    const offered: UpsellBundle[] = bundles.flatMap((b) => (b.prices[currency] === undefined ? [] : [{ id: b.id, name: b.name, members: b.members, priceMinor: b.prices[currency] }]));
    return bundleUpsell({ ticked: s.ticked, chosen: s.chosen, prices, bundles: offered, needsStore, withStore, nearPercent, declined: s.declined });
  }

  /** A bundle chosen, and any other chosen bundle sharing a part with it taken off: it holds them. */
  function choose(s: State, id: string): State {
    const members = bundles.find((b) => b.id === id)?.members ?? [];
    const others = s.chosen.filter((other) => !(bundles.find((b) => b.id === other)?.members ?? []).some((m) => members.includes(m)));
    return { ...s, chosen: [...others, id] };
  }

  /** The state after a change: a bundle that holds everything for no more is chosen for them, and said. */
  function settle(s: State): State {
    const up = upsellOf(s);
    if (!up?.switchTo) return s;
    const id = up.switchTo.bundle.id;
    const next = choose(s, id);
    return { ...next, auto: [...s.auto, id], replaced: { ...s.replaced, [id]: s.chosen.filter((other) => !next.chosen.includes(other)) }, switched: { bundle: id, from: up.switchTo.fromMinor } };
  }

  const change = (next: State) => setState(settle({ ...next, switched: null }));
  const up = upsellOf(state);
  const inBundle = (id: ExtensionId) => bundles.find((b) => state.chosen.includes(b.id) && b.members.includes(id));
  const nameOf = (id: string) => bundles.find((b) => b.id === id)?.name ?? "";
  const card = "flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 text-sm transition-colors has-[:checked]:border-foreground";

  return (
    <div ref={box} className="flex flex-col gap-3">
      {bundles.length > 0 && <p className="text-sm font-medium">{w.bundles}</p>}
      {bundles.map((b) => {
        const price = currency ? b.prices[currency] : undefined;
        const sum = currency ? b.members.reduce<number | null>((total, id) => {
          const part = partPrices[id]?.[currency];
          return total === null || part === undefined ? null : total + part;
        }, 0) : null;
        const later = withStore ? [] : b.members.filter((id) => needsStore.includes(id));
        const chosen = state.chosen.includes(b.id);
        return (
          <label key={b.id} className={card}>
            <input
              type="checkbox"
              name="bundle"
              value={b.id}
              checked={chosen}
              onChange={(event) =>
                change(
                  event.target.checked
                    ? choose(state, b.id)
                    : // Taken off: one the page chose is never chosen for them again, only offered, and what it replaced comes back.
                      {
                        ...state,
                        chosen: [...state.chosen.filter((id) => id !== b.id), ...(state.auto.includes(b.id) ? (state.replaced[b.id] ?? []) : [])],
                        declined: state.auto.includes(b.id) ? [...new Set([...state.declined, b.id])] : state.declined,
                      },
                )
              }
              className="mt-0.5 size-5 shrink-0 accent-foreground"
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium">
                {b.name}
                {price !== undefined && <span className="font-normal text-muted"> · {fill(w.price, { price: money(price) })}</span>}
              </span>
              <span className="text-muted">{fill(w.holds, { names: list(b.members) })}</span>
              {price !== undefined && sum !== null && sum > price && <span className="font-medium text-accent">{fill(w.saves, { amount: money(sum - price) })}</span>}
              {later.length > 0 && <span className="text-muted">{fill(w.later, { names: list(later) })}</span>}
            </span>
          </label>
        );
      })}
      {bundles.length > 0 && <p className="mt-2 text-sm font-medium">{w.oneByOne}</p>}
      {extensions.map((e) => {
        const held = inBundle(e.id);
        const price = currency ? e.prices[currency] : undefined;
        return (
          <label key={e.id} className={`${card} ${held ? "cursor-default opacity-80" : ""}`}>
            <input
              type="checkbox"
              name="extension"
              value={e.id}
              checked={Boolean(held) || state.ticked.includes(e.id)}
              disabled={Boolean(held)}
              onChange={(event) => change({ ...state, ticked: event.target.checked ? [...state.ticked, e.id] : state.ticked.filter((id) => id !== e.id) })}
              className="mt-0.5 size-5 shrink-0 accent-foreground"
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium">
                {e.name}
                {price !== undefined && <span className="font-normal text-muted"> · {fill(w.price, { price: money(price) })}</span>}
              </span>
              <span className="text-muted">{held ? fill(w.inBundle, { bundle: held.name }) : e.description}</span>
            </span>
          </label>
        );
      })}
      <div aria-live="polite" className="flex flex-col gap-3">
        {state.switched && up && up.totalMinor !== null && (
          <p className="rounded-xl bg-accent/10 p-4 text-sm font-medium">
            {fill(w.switched, { bundle: nameOf(state.switched.bundle), price: money(up.totalMinor), from: money(state.switched.from) })}
          </p>
        )}
        {up?.offer && (
          <Proposal
            text={fill(w.offer, { bundle: up.offer.bundle.name, price: money(up.offer.bundle.priceMinor), from: money(up.offer.fromMinor) })}
            button={fill(w.choose, { bundle: up.offer.bundle.name })}
            onChoose={() => setState({ ...choose(state, up.offer!.bundle.id), auto: state.auto.filter((id) => id !== up.offer!.bundle.id), declined: state.declined.filter((id) => id !== up.offer!.bundle.id), switched: null })}
          />
        )}
        {up?.propose && (
          <Proposal
            text={fill(w.propose, { extra: money(up.propose.extraMinor), bundle: up.propose.bundle.name, adds: list(up.propose.adds) })}
            later={up.propose.addsLater.length > 0 ? fill(w.proposeLater, { names: list(up.propose.addsLater) }) : null}
            button={fill(w.choose, { bundle: up.propose.bundle.name })}
            onChoose={() => change(choose(state, up.propose!.bundle.id))}
          />
        )}
        {up && up.totalMinor !== null && up.covered.length > 0 && <p className="text-sm text-muted">{fill(w.total, { total: money(up.totalMinor) })}</p>}
      </div>
    </div>
  );
}

/** A bundle offered or proposed: why, and one press to choose it. */
function Proposal({ text, later = null, button, onChoose }: { text: string; later?: string | null; button: string; onChoose: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-accent p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="flex flex-col gap-1">
        <span className="font-medium">{text}</span>
        {later && <span className="text-muted">{later}</span>}
      </p>
      <button type="button" onClick={onChoose} className="shrink-0 rounded-full bg-foreground px-4 py-2 font-medium text-background">
        {button}
      </button>
    </div>
  );
}
