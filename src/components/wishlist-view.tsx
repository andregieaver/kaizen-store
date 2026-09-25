"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import {
  addToCartAction,
  createListAction,
  deleteListAction,
  moveItemsAction,
  removeItemsAction,
  setItemAction,
  updateListAction,
} from "@/app/s/[store]/[market]/wishlist/actions";

export type WishlistItemView = {
  id: string;
  title: string;
  href: string;
  image: { url: string; alt: string } | null;
  variantId: string | null;
  quantity: number;
  subscriptionOnly: boolean;
  variants: { id: string; label: string; price: string; available: boolean }[];
  /** "Fra 129,00 kr", shown until a variant is chosen. */
  fromPrice: string;
};

type Labels = {
  noLists: string;
  empty: string;
  lists: string;
  newList: string;
  listName: string;
  create: string;
  rename: string;
  saveName: string;
  cancel: string;
  deleteList: string;
  deleteConfirm: string;
  selectAll: string;
  addSelected: string;
  addAll: string;
  moveTo: string;
  move: string;
  removeSelected: string;
  remove: string;
  afterCart: string;
  keep: string;
  clear: string;
  variant: string;
  chooseVariant: string;
  needsVariant: string;
  subscription: string;
  capped: string;
  quantity: string;
  soldOut: string;
  addToCart: string;
  goToCart: string;
  itemCounts: string[];
  selectItems: string[];
  selectedCounts: string[];
};

type Outcome = "added" | "capped" | "unavailable" | "needs_variant" | "subscription";

const button = "min-h-11 rounded-full px-4 text-sm font-medium disabled:opacity-40";
const primary = `${button} bg-foreground text-background`;
const secondary = `${button} border border-border hover:bg-surface`;
const input = "min-h-11 rounded-md border border-border bg-background px-3 text-sm";

/**
 * The wishlist page's working part (D34): the lists as tabs, the chosen
 * list's items with their variant and quantity, and adding all or some of
 * them to the cart, moving them to another list or removing them.
 */
export function WishlistView({
  store,
  market,
  base,
  lists,
  current,
  items,
  labels,
}: {
  store: string;
  market: string;
  base: string;
  lists: { id: string; name: string; items: number }[];
  current: { id: string; name: string; keepAfterCart: boolean } | null;
  items: WishlistItemView[];
  labels: Labels;
}) {
  const router = useRouter();
  const id = useId();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [message, setMessage] = useState<{ text: string; cart?: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  // The shopper's choice shows at once; the server keeps it.
  const [keepChoice, setKeepChoice] = useState<{ list: string; keep: boolean } | null>(null);
  const [busy, start] = useTransition();
  const others = lists.filter((l) => l.id !== current?.id);
  const chosen = items.filter((item) => selected.has(item.id)).map((item) => item.id);
  const allSelected = items.length > 0 && chosen.length === items.length;

  const run = (work: () => Promise<void>) =>
    start(async () => {
      setProblem(null);
      await work();
    });

  const toCart = (itemIds: string[] | null) =>
    run(async () => {
      if (!current) return;
      const result = await addToCartAction(store, market, current.id, itemIds);
      setOutcomes(result.outcomes);
      setMessage(result.added > 0 ? { text: result.message, cart: true } : null);
      setSelected(new Set());
      router.refresh();
    });

  const move = () =>
    run(async () => {
      const target = lists.find((l) => l.id === moveTarget);
      if (!target || chosen.length === 0) return;
      const result = await moveItemsAction(store, market, chosen, target.id, target.name);
      setMessage(result.message ? { text: result.message } : null);
      setSelected(new Set());
      router.refresh();
    });

  const remove = (itemIds: string[]) =>
    run(async () => {
      await removeItemsAction(store, market, itemIds);
      setSelected(new Set());
      router.refresh();
    });

  const createForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const name = String(new FormData(event.currentTarget).get("name") ?? "");
        run(async () => {
          const result = await createListAction(store, market, name);
          if (!result.ok) return setProblem(result.message);
          setCreating(false);
          router.push(`${base}/wishlist?list=${result.id}`);
        });
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        {labels.listName}
        <input name="name" required maxLength={60} autoFocus className={input} />
      </label>
      <button type="submit" disabled={busy} className={primary}>
        {labels.create}
      </button>
      <button type="button" onClick={() => setCreating(false)} className={secondary}>
        {labels.cancel}
      </button>
    </form>
  );

  if (!current) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted">{labels.noLists}</p>
        <Problem text={problem} />
        {creating ? createForm : (
          <button type="button" onClick={() => setCreating(true)} className={`${secondary} self-start`}>
            {labels.newList}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={labels.lists} className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2">
          {lists.map((list, i) => (
            <li key={list.id}>
              <Link
                href={`${base}/wishlist?list=${list.id}`}
                aria-current={list.id === current.id ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm ${
                  list.id === current.id ? "bg-foreground text-background" : "border border-border hover:bg-surface"
                }`}
              >
                <span className="font-medium">{list.name}</span>
                <span className={list.id === current.id ? "opacity-80" : "text-muted"}>{labels.itemCounts[i]}</span>
              </Link>
            </li>
          ))}
          {!creating && (
            <li>
              <button type="button" onClick={() => setCreating(true)} className={secondary}>
                + {labels.newList}
              </button>
            </li>
          )}
        </ul>
        {creating && createForm}
      </nav>

      <section aria-labelledby={`${id}-list`} className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {renaming ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const name = String(new FormData(event.currentTarget).get("name") ?? "");
                run(async () => {
                  const result = await updateListAction(store, market, current.id, { name });
                  if (!result.ok) return setProblem(result.message);
                  setRenaming(false);
                  router.refresh();
                });
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="flex flex-col gap-1 text-sm font-medium">
                {labels.listName}
                <input name="name" required maxLength={60} defaultValue={current.name} autoFocus className={input} />
              </label>
              <button type="submit" disabled={busy} className={primary}>
                {labels.saveName}
              </button>
              <button type="button" onClick={() => setRenaming(false)} className={secondary}>
                {labels.cancel}
              </button>
            </form>
          ) : (
            <h2 id={`${id}-list`} className="text-xl font-semibold">
              {current.name}
            </h2>
          )}
          {!renaming && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setRenaming(true)} className={secondary}>
                {labels.rename}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(labels.deleteConfirm)) return;
                  run(async () => {
                    await deleteListAction(store, market, current.id);
                    router.push(`${base}/wishlist`);
                  });
                }}
                className={`${secondary} text-red-700 dark:text-red-400`}
              >
                {labels.deleteList}
              </button>
            </div>
          )}
        </div>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">{labels.afterCart}</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {([true, false] as const).map((keep) => (
              <label key={String(keep)} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-keep`}
                  checked={(keepChoice?.list === current.id ? keepChoice.keep : current.keepAfterCart) === keep}
                  onChange={() => {
                    setKeepChoice({ list: current.id, keep });
                    run(async () => {
                      await updateListAction(store, market, current.id, { keepAfterCart: keep });
                      router.refresh();
                    });
                  }}
                  className="size-4"
                />
                {keep ? labels.keep : labels.clear}
              </label>
            ))}
          </div>
        </fieldset>

        <Problem text={problem} />
        <p role="status" aria-live="polite" className="text-sm empty:hidden">
          {message?.text}{" "}
          {message?.cart && (
            <Link href={`${base}/cart`} className="underline">
              {labels.goToCart}
            </Link>
          )}
        </p>

        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted">{labels.empty}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => setSelected(event.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                  className="size-4"
                />
                {labels.selectAll}
              </label>
              <button type="button" disabled={busy} onClick={() => toCart(null)} className={`${primary} ml-auto`}>
                {labels.addAll}
              </button>
            </div>

            {chosen.length > 0 && (
              <div role="group" aria-label={labels.selectedCounts[chosen.length - 1]} className="flex flex-wrap items-center gap-2 rounded-md bg-surface p-3">
                <span className="text-sm font-medium">{labels.selectedCounts[chosen.length - 1]}</span>
                <button type="button" disabled={busy} onClick={() => toCart(chosen)} className={primary}>
                  {labels.addSelected}
                </button>
                {others.length > 0 && (
                  <span className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={labels.moveTo}
                      value={moveTarget}
                      onChange={(event) => setMoveTarget(event.target.value)}
                      className={input}
                    >
                      <option value="">{labels.moveTo} …</option>
                      {others.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" disabled={busy || !moveTarget} onClick={move} className={secondary}>
                      {labels.move}
                    </button>
                  </span>
                )}
                <button type="button" disabled={busy} onClick={() => remove(chosen)} className={secondary}>
                  {labels.removeSelected}
                </button>
              </div>
            )}

            <ul className="flex flex-col divide-y divide-border">
              {items.map((item, i) => (
                <Item
                  key={item.id}
                  item={item}
                  store={store}
                  market={market}
                  labels={labels}
                  selectLabel={labels.selectItems[i]}
                  checked={selected.has(item.id)}
                  onCheck={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                  outcome={outcomes[item.id]}
                  busy={busy}
                  onAdd={() => toCart([item.id])}
                  onRemove={() => remove([item.id])}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Problem({ text }: { text: string | null }) {
  return (
    <p role="alert" className="text-sm text-red-700 empty:hidden dark:text-red-400">
      {text}
    </p>
  );
}

function Item({
  item,
  store,
  market,
  labels,
  selectLabel,
  checked,
  onCheck,
  outcome,
  busy,
  onAdd,
  onRemove,
}: {
  item: WishlistItemView;
  store: string;
  market: string;
  labels: Labels;
  selectLabel: string;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  outcome: Outcome | undefined;
  busy: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const id = useId();
  const [variantId, setVariantId] = useState(item.variantId ?? (item.variants.length === 1 ? item.variants[0].id : ""));
  const [quantity, setQuantity] = useState(String(item.quantity));
  const variant = item.variants.find((v) => v.id === variantId);
  const soldOut = variant ? !variant.available : false;
  const note =
    outcome === "needs_variant"
      ? labels.needsVariant
      : outcome === "subscription"
        ? labels.subscription
        : outcome === "unavailable"
          ? labels.soldOut
          : outcome === "capped"
            ? labels.capped
            : null;

  return (
    <li className="flex gap-3 py-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheck(event.target.checked)}
        aria-label={selectLabel}
        className="mt-1 size-5 shrink-0"
      />
      {item.image ? (
        <Image src={item.image.url} alt={item.image.alt} width={96} height={96} unoptimized className="size-20 shrink-0 rounded-md bg-surface object-cover sm:size-24" />
      ) : (
        <div className="size-20 shrink-0 rounded-md bg-surface sm:size-24" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={item.href} className="font-medium hover:underline">
              {item.title}
            </Link>
            <p className="text-sm">{variant ? variant.price : item.fromPrice}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="-mt-2 -mr-2 min-h-11 shrink-0 px-2 text-sm text-muted underline hover:text-foreground disabled:opacity-40"
          >
            {labels.remove}
          </button>
        </div>
        {!item.subscriptionOnly && (
          <div className="flex flex-wrap items-end gap-2">
            {item.variants.length > 1 && (
              <label className="flex flex-col gap-1 text-xs font-medium">
                {labels.variant}
                <select
                  value={variantId}
                  onChange={(event) => {
                    setVariantId(event.target.value);
                    void setItemAction(store, market, item.id, { variantId: event.target.value || null });
                  }}
                  className={input}
                >
                  <option value="">{labels.chooseVariant}</option>
                  {item.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                      {v.available ? "" : ` · ${labels.soldOut}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-medium">
              {labels.quantity}
              <input
                id={`${id}-quantity`}
                type="number"
                min={1}
                max={99}
                inputMode="numeric"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                onBlur={() => {
                  const value = Math.min(99, Math.max(1, Math.floor(Number(quantity) || 1)));
                  setQuantity(String(value));
                  if (value !== item.quantity) void setItemAction(store, market, item.id, { quantity: value });
                }}
                className={`${input} w-20`}
              />
            </label>
          </div>
        )}
        {(note || soldOut || item.subscriptionOnly) && (
          <p className="text-sm text-muted">{note ?? (item.subscriptionOnly ? labels.subscription : labels.soldOut)}</p>
        )}
        {!item.subscriptionOnly && (
          <button type="button" disabled={busy || soldOut || !variantId} onClick={onAdd} className={`${secondary} self-start`}>
            {labels.addToCart}
          </button>
        )}
      </div>
    </li>
  );
}
