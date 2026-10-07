"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";

import { ACTION_WORDS, buildBulkRequest, cappedNote, emptyPanel, gridSelectionProblem, type BulkRequestInput, type ListAction, type PanelForm } from "@/lib/bulk-admin";
import { OMNIBUS_SENTENCE } from "@/lib/bulk-edit";
import { BULK_MAX_PRODUCTS } from "@/lib/data-limits";
import { formatMoney } from "@/lib/money";
import type { BatchSummary, BulkPreview, UndoResult } from "@/server/bulk-edit";
import type { BulkRun } from "@/app/admin/(gated)/[store]/products/bulk/actions";

import { BulkFailures, BulkResult } from "./bulk-result";
import { card, field, hint, label, primary, secondary } from "./data/ui";

export type ProductRowView = {
  id: string;
  title: string;
  status: "draft" | "active" | "archived";
  image: string | null;
  variants: number;
  digitalVariants: number;
  stock: number;
  price: { min: number; max: number; currency: string } | null;
  /** The feature that is off and keeps it from shoppers (D178), or null. */
  hiddenBy?: string | null;
};

export type BulkTools = {
  preview: (request: BulkRequestInput) => Promise<BulkPreview | { ok: false; problem: string }>;
  start: (request: BulkRequestInput) => Promise<BulkRun>;
  next: (batchId: string) => Promise<BulkRun>;
  matching: (filter: { status?: "archived" }) => Promise<{ ids: string[]; total: number }>;
  undo: (batchId: string) => Promise<UndoResult>;
  terms: { id: string; name: string; kind: "category" | "tag" }[];
  markets: { code: string; name: string; currency: string }[];
};

type Phase =
  | { kind: "idle" }
  | { kind: "form"; action: ListAction }
  | { kind: "review"; action: ListAction; request: BulkRequestInput; preview: BulkPreview }
  | { kind: "running"; processed: number; total: number }
  | { kind: "done"; summary: BatchSummary };

const ACTIONS_CURRENT: ListAction[] = ["status", "archive", "terms_add", "terms_remove", "price", "stock"];
const ACTIONS_ARCHIVED: ListAction[] = ["unarchive"];

/**
 * The products list with a tick box for each product and, with some ticked, the bulk bar (D165, `docs/wave-2-data.md` 2.6): set status, archive,
 * categories and tags, price, stock, and the grid. Every action ends in one confirmation that says what will happen to how many products; applying runs in
 * chunks, each product through the editor's own door on the server. Without the right to change products (`bulk` null) it is the plain list.
 */
export function ProductsTable({ slug, rows, archived, priceHeader, locale, bulk }: { slug: string; rows: ProductRowView[]; archived: boolean; priceHeader: string; locale: string; bulk: BulkTools | null }) {
  const base = `/admin/${slug}/products`;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [form, setForm] = useState<PanelForm>(() => emptyPanel(bulk?.markets[0]?.code ?? ""));
  const [pending, start] = useTransition();
  const stop = useRef(false);

  const ids = useMemo(() => [...selected], [selected]);
  const allShown = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const actions = archived ? ACTIONS_ARCHIVED : ACTIONS_CURRENT;

  const toggle = (id: string) => {
    setNote(null);
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectShown = () => {
    if (allShown) return setSelected(new Set());
    const take = rows.slice(0, BULK_MAX_PRODUCTS).map((r) => r.id);
    setSelected(new Set(take));
    setNote(cappedNote(rows.length));
  };
  const selectMatching = () =>
    start(async () => {
      const result = await bulk!.matching(archived ? { status: "archived" } : {});
      setSelected(new Set(result.ids));
      setNote(cappedNote(result.total) ?? `${result.total} ${result.total === 1 ? "product matches" : "products match"} and all of them are chosen.`);
    });
  const clear = () => {
    setSelected(new Set());
    setNote(null);
    setPhase({ kind: "idle" });
    setProblem(null);
  };

  const review = (action: ListAction) =>
    start(async () => {
      setProblem(null);
      const built = buildBulkRequest(action, form, ids, bulk!.terms);
      if (!built.ok) return setProblem(built.problem);
      const preview = await bulk!.preview(built.request);
      if (!preview.ok) return setProblem(preview.problem);
      setPhase({ kind: "review", action, request: built.request, preview });
    });

  const apply = (request: BulkRequestInput) =>
    start(async () => {
      stop.current = false;
      setProblem(null);
      let run = await bulk!.start(request);
      while (run.ok && !run.done && !stop.current) {
        setPhase({ kind: "running", processed: run.processed, total: run.total });
        run = await bulk!.next(run.batchId);
      }
      if (!run.ok) {
        setProblem(run.problem);
        setPhase({ kind: "idle" });
        return;
      }
      if (run.summary) setPhase({ kind: "done", summary: run.summary });
    });

  const gridProblem = gridSelectionProblem(ids.length);
  const gridHref = `${base}/bulk?ids=${ids.slice(0, 50).join(",")}`;
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);

  return (
    <div className="flex flex-col gap-3">
      {bulk && selected.size > 0 && (
        <div role="region" aria-label="Bulk actions" className={`${card} sticky top-2 z-10 flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium" aria-live="polite">
              {selected.size} {selected.size === 1 ? "product" : "products"} chosen
            </p>
            <button type="button" onClick={clear} className="text-sm underline underline-offset-2">
              Clear
            </button>
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
            {actions.map((a) => (
              <button key={a} type="button" disabled={pending || phase.kind === "running"} onClick={() => {
                  setPhase({ kind: "form", action: a });
                  setProblem(null);
                }} className={secondary} aria-pressed={phase.kind === "form" && phase.action === a}>
                {ACTION_WORDS[a]}
              </button>
            ))}
            {!archived &&
              (gridProblem ? (
                <span className={hint}>{gridProblem}</span>
              ) : (
                <Link href={gridHref} className={secondary}>
                  Edit in a grid
                </Link>
              ))}
          </div>
          {note && <p className={hint}>{note}</p>}
          {phase.kind === "form" && (
            <ActionPanel
              action={phase.action}
              form={form}
              setForm={setForm}
              terms={bulk.terms}
              markets={bulk.markets}
              pending={pending}
              onReview={() => review((phase as { action: ListAction }).action)}
              onCancel={() => setPhase({ kind: "idle" })}
            />
          )}
          {phase.kind === "review" && (
            <div role="group" aria-label="Confirm" className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
              <p className="text-sm font-medium">
                {ACTION_WORDS[phase.action]}: this will change {phase.preview.counts.changed} of {phase.preview.counts.products} products
                {phase.preview.counts.unchanged > 0 ? `, leave ${phase.preview.counts.unchanged} as they are` : ""}
                {phase.preview.counts.failed > 0 ? ` and cannot change ${phase.preview.counts.failed}` : ""}.
              </p>
              {phase.preview.notFound > 0 && <p className={hint}>{phase.preview.notFound} of the chosen products are not in this store and are not changed.</p>}
              {phase.action === "price" && phase.preview.prices.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">The first {phase.preview.prices.length}:</p>
                  <ul className="text-sm">
                    {phase.preview.prices.map((p, i) => (
                      <li key={`${p.productId}-${p.sku}-${p.market}-${i}`}>
                        {p.title}
                        {p.sku ? ` (${p.sku})` : ""}, {p.market}: {money(p.before, p.currency)} to {money(p.after, p.currency)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm">{OMNIBUS_SENTENCE}</p>
                </div>
              )}
              {phase.preview.failures.length > 0 && (
                <BulkFailures failures={phase.preview.failures.map((f) => ({ productId: f.productId, handle: f.handle, title: f.title, sku: f.sku, field: f.field, reason: f.reason }))} />
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending || phase.preview.counts.changed === 0} className={primary} onClick={() => apply((phase as { request: BulkRequestInput }).request)}>
                  {pending ? "Applying …" : `Apply to ${phase.preview.counts.changed} ${phase.preview.counts.changed === 1 ? "product" : "products"}`}
                </button>
                <button type="button" disabled={pending} className={secondary} onClick={() => setPhase({ kind: "form", action: (phase as { action: ListAction }).action })}>
                  Back
                </button>
              </div>
              {phase.preview.counts.changed === 0 && <p className={hint}>Nothing would change.</p>}
            </div>
          )}
          {phase.kind === "running" && (
            <p role="status" className="text-sm" aria-live="polite">
              Changing products: {phase.processed} of {phase.total} done. You can leave this page; what is done stays done.
            </p>
          )}
          {phase.kind === "done" && <BulkResult summary={phase.summary} undo={bulk.undo} onReload={clear} />}
          {problem && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {problem}
            </p>
          )}
        </div>
      )}
      <table className="w-full overflow-hidden rounded-lg border border-border bg-background text-left text-sm">
        <caption className="sr-only">{archived ? "Archived products" : "Products"}</caption>
        <thead>
          <tr className="border-b border-border">
            {bulk && (
              <th scope="col" className="w-10 px-4 py-2">
                <input type="checkbox" aria-label={allShown ? "Clear the choice" : "Choose all products shown"} checked={allShown} onChange={selectShown} />
              </th>
            )}
            <th scope="col" className="px-4 py-2 font-medium">
              Product
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
              Stock
            </th>
            <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
              {priceHeader}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((product) => (
            <tr key={product.id} className="border-b border-border last:border-0">
              {bulk && (
                <td className="px-4 py-2">
                  <input type="checkbox" aria-label={`Choose ${product.title}`} checked={selected.has(product.id)} onChange={() => toggle(product.id)} />
                </td>
              )}
              <td className="px-4 py-2">
                <Link href={`${base}/${product.id}`} className="flex items-center gap-3 font-medium hover:underline">
                  {product.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- small admin thumbnail
                    <img src={product.image} alt="" width={40} height={40} loading="lazy" className="size-10 rounded border border-border object-cover" />
                  ) : (
                    <span aria-hidden="true" className="size-10 rounded border border-dashed border-border" />
                  )}
                  <span>
                    {product.title}
                    {product.variants > 1 && <span className="block text-xs font-normal text-muted">{product.variants} variants</span>}
                  </span>
                </Link>
              </td>
              <td className="px-4 py-2">
                {product.status === "active" ? "Published" : product.status === "draft" ? "Draft" : "Archived"}
                {product.status === "active" && product.hiddenBy && <span className="block text-xs text-muted">Not shown: {product.hiddenBy} is off</span>}
              </td>
              <td className="hidden px-4 py-2 sm:table-cell">
                {product.digitalVariants > 0 && product.digitalVariants === product.variants ? (
                  <span className="text-muted">Digital</span>
                ) : product.stock === 0 ? (
                  <span className="text-muted">Out of stock</span>
                ) : (
                  product.stock
                )}
                {product.digitalVariants > 0 && product.digitalVariants < product.variants && <span className="block text-xs text-muted">and digital</span>}
              </td>
              <td className="hidden px-4 py-2 sm:table-cell">
                {product.price ? (
                  product.price.min === product.price.max ? (
                    money(product.price.min, product.price.currency)
                  ) : (
                    `${money(product.price.min, product.price.currency)} – ${money(product.price.max, product.price.currency)}`
                  )
                ) : (
                  <span className="text-muted">No price</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {bulk && rows.length > 0 && (
        <p className={hint}>
          {rows.length > BULK_MAX_PRODUCTS ? `A bulk action takes at most ${BULK_MAX_PRODUCTS} products at a time. ` : ""}
          <button type="button" onClick={selectMatching} disabled={pending} className="underline underline-offset-2">
            Choose all {rows.length} {archived ? "archived" : "listed"} products
          </button>
        </p>
      )}
    </div>
  );
}

function ActionPanel({
  action,
  form,
  setForm,
  terms,
  markets,
  pending,
  onReview,
  onCancel,
}: {
  action: ListAction;
  form: PanelForm;
  setForm: (f: PanelForm) => void;
  terms: BulkTools["terms"];
  markets: BulkTools["markets"];
  pending: boolean;
  onReview: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<PanelForm>) => setForm({ ...form, ...patch });
  const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onReview();
      }}
      aria-label={ACTION_WORDS[action]}
    >
      {action === "status" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="bulk-status" className={label}>
            Set the status to
          </label>
          <select id="bulk-status" value={form.to} onChange={(e) => set({ to: e.target.value as PanelForm["to"] })} className={field}>
            <option value="active">Published</option>
            <option value="draft">Draft</option>
          </select>
          <p className={hint}>A product that cannot be published (no picture or price, say) is not changed, and the reason is listed.</p>
        </div>
      )}
      {(action === "archive" || action === "unarchive") && (
        <p className="text-sm">{action === "archive" ? "The chosen products are archived: they leave the shop and the list." : "The chosen products come back as drafts. Publish them one by one, or set their status in bulk."}</p>
      )}
      {(action === "terms_add" || action === "terms_remove") && (
        <fieldset className="flex flex-col gap-1">
          <legend className={label}>{action === "terms_add" ? "Add the chosen products to" : "Remove the chosen products from"}</legend>
          {terms.length === 0 ? (
            <p className={hint}>This store has no categories or tags yet.</p>
          ) : (
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {terms.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.termIds.includes(t.id)} onChange={() => set({ termIds: toggleIn(form.termIds, t.id) })} />
                  {t.kind === "category" ? "Category" : "Tag"}: {t.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      {action === "stock" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="bulk-stock" className={label}>
            Stock
          </label>
          <input id="bulk-stock" value={form.stock} onChange={(e) => set({ stock: e.target.value })} inputMode="text" placeholder="12, +5 or -3" className={field} />
          <p className={hint}>A number sets the stock of every variant. A number with a sign, such as +5 or -3, changes it. Digital variants have no stock and are skipped.</p>
        </div>
      )}
      {action === "price" && (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1">
            <legend className={label}>Which markets</legend>
            {markets.map((m) => (
              <label key={m.code} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.markets.includes(m.code)} onChange={() => set({ markets: toggleIn(form.markets, m.code) })} />
                {m.name} ({m.currency})
              </label>
            ))}
            <p className={hint}>By default only the main market changes, so a percentage never rewrites every country&apos;s price by accident.</p>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className={label}>Change by</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={form.mode === "percent"} onChange={() => set({ mode: "percent" })} /> A percentage
            </label>
            {form.mode === "percent" && (
              <div className="ml-6 flex flex-col gap-1">
                <label htmlFor="bulk-percent" className="sr-only">
                  Percentage
                </label>
                <input id="bulk-percent" value={form.percent} onChange={(e) => set({ percent: e.target.value })} placeholder="-10 or 5.5" className={`${field} max-w-40`} />
                <p className={hint}>From -90 to +500, two decimals at most. The new price is rounded half up to the smallest unit of the currency.</p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={form.mode === "amount"} onChange={() => set({ mode: "amount" })} /> An amount
            </label>
            {form.mode === "amount" && (
              <div className="ml-6 flex flex-col gap-2">
                {markets
                  .filter((m) => form.markets.includes(m.code))
                  .map((m) => (
                    <label key={m.code} className="flex items-center gap-2 text-sm">
                      <span className="w-28">
                        {m.name} ({m.currency})
                      </span>
                      <input value={form.amounts[m.code] ?? ""} onChange={(e) => set({ amounts: { ...form.amounts, [m.code]: e.target.value } })} placeholder="+5 or -2,50" className={`${field} max-w-40`} />
                    </label>
                  ))}
                <p className={hint}>An amount is in each market&apos;s own currency, never applied across currencies. It is the price as you type it in the editor.</p>
              </div>
            )}
          </fieldset>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Checking …" : "Review"}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className={secondary}>
          Close
        </button>
      </div>
    </form>
  );
}
