"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { actionWords, buildBulkRequest, cappedNote, emptyPanel, gridSelectionProblem, type BulkRequestInput, type ListAction, type PanelForm } from "@/lib/bulk-admin";
import { BULK_MAX_PRODUCTS } from "@/lib/data-limits";
import { formatMoney } from "@/lib/money";
import type { BatchSummary, BulkPreview, UndoResult } from "@/server/bulk-edit";
import type { BulkRun } from "@/app/admin/(gated)/[store]/products/bulk/actions";

import { useAdminText } from "./admin-text";
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
  const all = useAdminText("products");
  const w = all.table;
  const lib = all.bulkLib;
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
    setNote(cappedNote(rows.length, lib));
  };
  const selectMatching = () =>
    start(async () => {
      const result = await bulk!.matching(archived ? { status: "archived" } : {});
      setSelected(new Set(result.ids));
      setNote(cappedNote(result.total, lib) ?? countWords(result.total, w.allChosen));
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
      const built = buildBulkRequest(action, form, ids, bulk!.terms, lib);
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

  const gridProblem = gridSelectionProblem(ids.length, lib);
  const gridHref = `${base}/bulk?ids=${ids.slice(0, 50).join(",")}`;
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);

  return (
    <div className="flex flex-col gap-3">
      {bulk && selected.size > 0 && (
        <div role="region" aria-label={w.bulkActions} className={`${card} sticky top-2 z-10 flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium" aria-live="polite">
              {countWords(selected.size, w.chosen)}
            </p>
            <button type="button" onClick={clear} className="text-sm underline underline-offset-2">
              {w.clear}
            </button>
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
            {actions.map((a) => (
              <button key={a} type="button" disabled={pending || phase.kind === "running"} onClick={() => {
                  setPhase({ kind: "form", action: a });
                  setProblem(null);
                }} className={secondary} aria-pressed={phase.kind === "form" && phase.action === a}>
                {actionWords(a, lib)}
              </button>
            ))}
            {!archived &&
              (gridProblem ? (
                <span className={hint}>{gridProblem}</span>
              ) : (
                <Link href={gridHref} className={secondary}>
                  {w.editGrid}
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
            <div role="group" aria-label={w.confirm} className="flex flex-col gap-3 rounded-md border border-line bg-card p-3">
              <p className="text-sm font-medium">
                {fillWords(w.reviewLine, {
                  action: actionWords(phase.action, lib),
                  changed: phase.preview.counts.changed,
                  products: phase.preview.counts.products,
                  unchanged: phase.preview.counts.unchanged > 0 ? fillWords(w.reviewUnchanged, { n: phase.preview.counts.unchanged }) : "",
                  failed: phase.preview.counts.failed > 0 ? fillWords(w.reviewFailed, { n: phase.preview.counts.failed }) : "",
                })}
              </p>
              {phase.preview.notFound > 0 && <p className={hint}>{fillWords(w.notFound, { n: phase.preview.notFound })}</p>}
              {phase.action === "price" && phase.preview.prices.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">{fillWords(w.firstPrices, { n: phase.preview.prices.length })}</p>
                  <ul className="text-sm">
                    {phase.preview.prices.map((p, i) => (
                      <li key={`${p.productId}-${p.sku}-${p.market}-${i}`}>
                        {fillWords(w.priceLine, { title: p.title, sku: p.sku ? ` (${p.sku})` : "", market: p.market, before: money(p.before, p.currency), after: money(p.after, p.currency) })}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm">{w.omnibus}</p>
                </div>
              )}
              {phase.preview.failures.length > 0 && (
                <BulkFailures failures={phase.preview.failures.map((f) => ({ productId: f.productId, handle: f.handle, title: f.title, sku: f.sku, field: f.field, reason: f.reason }))} />
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending || phase.preview.counts.changed === 0} className={primary} onClick={() => apply((phase as { request: BulkRequestInput }).request)}>
                  {pending ? w.applying : countWords(phase.preview.counts.changed, w.applyTo)}
                </button>
                <button type="button" disabled={pending} className={secondary} onClick={() => setPhase({ kind: "form", action: (phase as { action: ListAction }).action })}>
                  {w.back}
                </button>
              </div>
              {phase.preview.counts.changed === 0 && <p className={hint}>{w.nothingChanges}</p>}
            </div>
          )}
          {phase.kind === "running" && (
            <p role="status" className="text-sm" aria-live="polite">
              {fillWords(w.running, { processed: phase.processed, total: phase.total })}
            </p>
          )}
          {phase.kind === "done" && <BulkResult summary={phase.summary} undo={bulk.undo} onReload={clear} />}
          {problem && (
            <p role="alert" className="text-sm text-danger-text">
              {problem}
            </p>
          )}
        </div>
      )}
      <table className="w-full overflow-hidden rounded-panel border border-line bg-card text-left text-sm">
        <caption className="sr-only">{archived ? w.captionArchived : w.caption}</caption>
        <thead>
          <tr className="border-b border-line">
            {bulk && (
              <th scope="col" className="w-10 px-4 py-2">
                <input type="checkbox" aria-label={allShown ? w.clearChoice : w.chooseShown} checked={allShown} onChange={selectShown} />
              </th>
            )}
            <th scope="col" className="px-4 py-2 font-medium">
              {w.product}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {w.status}
            </th>
            <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
              {w.stock}
            </th>
            <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
              {priceHeader}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((product) => (
            <tr key={product.id} className="border-b border-line last:border-0">
              {bulk && (
                <td className="px-4 py-2">
                  <input type="checkbox" aria-label={fillWords(w.choose, { title: product.title })} checked={selected.has(product.id)} onChange={() => toggle(product.id)} />
                </td>
              )}
              <td className="px-4 py-2">
                <Link href={`${base}/${product.id}`} className="flex items-center gap-3 font-medium hover:underline">
                  {product.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- small admin thumbnail
                    <img src={product.image} alt="" width={40} height={40} loading="lazy" className="size-10 rounded border border-line object-cover" />
                  ) : (
                    <span aria-hidden="true" className="size-10 rounded border border-dashed border-line" />
                  )}
                  <span>
                    {product.title}
                    {product.variants > 1 && <span className="block text-xs font-normal text-muted">{fillWords(w.variants, { n: product.variants })}</span>}
                  </span>
                </Link>
              </td>
              <td className="px-4 py-2">
                {product.status === "active" ? w.published : product.status === "draft" ? w.draft : w.archived}
                {product.status === "active" && product.hiddenBy && <span className="block text-xs text-muted">{fillWords(w.notShown, { feature: product.hiddenBy })}</span>}
              </td>
              <td className="hidden px-4 py-2 sm:table-cell">
                {product.digitalVariants > 0 && product.digitalVariants === product.variants ? (
                  <span className="text-muted">{w.digital}</span>
                ) : product.stock === 0 ? (
                  <span className="text-muted">{w.outOfStock}</span>
                ) : (
                  product.stock
                )}
                {product.digitalVariants > 0 && product.digitalVariants < product.variants && <span className="block text-xs text-muted">{w.andDigital}</span>}
              </td>
              <td className="hidden px-4 py-2 sm:table-cell">
                {product.price ? (
                  product.price.min === product.price.max ? (
                    money(product.price.min, product.price.currency)
                  ) : (
                    `${money(product.price.min, product.price.currency)} – ${money(product.price.max, product.price.currency)}`
                  )
                ) : (
                  <span className="text-muted">{w.noPrice}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {bulk && rows.length > 0 && (
        <p className={hint}>
          {rows.length > BULK_MAX_PRODUCTS ? fillWords(w.atMost, { max: BULK_MAX_PRODUCTS }) : ""}
          <button type="button" onClick={selectMatching} disabled={pending} className="underline underline-offset-2">
            {fillWords(archived ? w.chooseAllArchived : w.chooseAll, { n: rows.length })}
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
  const all = useAdminText("products");
  const w = all.panel;
  const set = (patch: Partial<PanelForm>) => setForm({ ...form, ...patch });
  const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-line bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onReview();
      }}
      aria-label={actionWords(action, all.bulkLib)}
    >
      {action === "status" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="bulk-status" className={label}>
            {w.statusTo}
          </label>
          <select id="bulk-status" value={form.to} onChange={(e) => set({ to: e.target.value as PanelForm["to"] })} className={field}>
            <option value="active">{all.table.published}</option>
            <option value="draft">{all.table.draft}</option>
          </select>
          <p className={hint}>{w.statusHint}</p>
        </div>
      )}
      {(action === "archive" || action === "unarchive") && (
        <p className="text-sm">{action === "archive" ? w.archiveText : w.unarchiveText}</p>
      )}
      {(action === "terms_add" || action === "terms_remove") && (
        <fieldset className="flex flex-col gap-1">
          <legend className={label}>{action === "terms_add" ? w.addTo : w.removeFrom}</legend>
          {terms.length === 0 ? (
            <p className={hint}>{w.noTerms}</p>
          ) : (
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {terms.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.termIds.includes(t.id)} onChange={() => set({ termIds: toggleIn(form.termIds, t.id) })} />
                  {fillWords(w.termLine, { kind: t.kind === "category" ? w.category : w.tag, name: t.name })}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      {action === "stock" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="bulk-stock" className={label}>
            {w.stock}
          </label>
          <input id="bulk-stock" value={form.stock} onChange={(e) => set({ stock: e.target.value })} inputMode="text" placeholder={w.stockPlaceholder} className={field} />
          <p className={hint}>{w.stockHint}</p>
        </div>
      )}
      {action === "price" && (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1">
            <legend className={label}>{w.markets}</legend>
            {markets.map((m) => (
              <label key={m.code} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.markets.includes(m.code)} onChange={() => set({ markets: toggleIn(form.markets, m.code) })} />
                {fillWords(w.marketLine, { name: m.name, currency: m.currency })}
              </label>
            ))}
            <p className={hint}>{w.marketsHint}</p>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className={label}>{w.changeBy}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={form.mode === "percent"} onChange={() => set({ mode: "percent" })} /> {w.percentage}
            </label>
            {form.mode === "percent" && (
              <div className="ml-6 flex flex-col gap-1">
                <label htmlFor="bulk-percent" className="sr-only">
                  {w.percentLabel}
                </label>
                <input id="bulk-percent" value={form.percent} onChange={(e) => set({ percent: e.target.value })} placeholder={w.percentPlaceholder} className={`${field} max-w-40`} />
                <p className={hint}>{w.percentHint}</p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={form.mode === "amount"} onChange={() => set({ mode: "amount" })} /> {w.amount}
            </label>
            {form.mode === "amount" && (
              <div className="ml-6 flex flex-col gap-2">
                {markets
                  .filter((m) => form.markets.includes(m.code))
                  .map((m) => (
                    <label key={m.code} className="flex items-center gap-2 text-sm">
                      <span className="w-28">{fillWords(w.marketLine, { name: m.name, currency: m.currency })}</span>
                      <input value={form.amounts[m.code] ?? ""} onChange={(e) => set({ amounts: { ...form.amounts, [m.code]: e.target.value } })} placeholder={w.amountPlaceholder} className={`${field} max-w-40`} />
                    </label>
                  ))}
                <p className={hint}>{w.amountHint}</p>
              </div>
            )}
          </fieldset>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? w.checking : w.review}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className={secondary}>
          {w.close}
        </button>
      </div>
    </form>
  );
}
