"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition } from "react";

import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { useAdminView } from "@/components/admin/admin-view";
import { card, field, hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { backorderMayPassAgreed, BACKORDER_DAYS_MAX, BACKORDER_DAYS_MIN, BACKORDER_LONG_HINT, STOCK_MAX, THRESHOLD_MAX, type AdjustReason } from "@/lib/inventory";
import {
  EMPTY_CELL,
  REASON_CHOICES,
  adjustPayload,
  parseTyped,
  reasonChoice,
  reviewRows,
  rowStates,
  sendable,
  type CellRef,
  type CellTyped,
} from "@/lib/inventory-admin";
import { adjustProblemsIn, deltaIn, figureIn, policyIn, savedIn } from "@/lib/inventory-words";
import type { AdjustResult, InventoryRow, PolicyResult } from "@/server/inventory";

export type InventoryTools = {
  adjust: (payload: unknown) => Promise<AdjustResult>;
  setPolicy: (payload: unknown) => Promise<PolicyResult>;
};

type LocationView = { id: string; name: string; active: boolean };

const keyOf = (variantId: string, locationId: string) => `${variantId}:${locationId}`;
const optionsText = (options: Record<string, string>) => Object.values(options).join(" / ");
const cellInput = "min-h-9 w-24 rounded-md border border-line bg-card px-2 text-sm";

/**
 * The Inventory list (wave 3, D172, `docs/wave-3-inventory.md` 2.2): one row for each variant with its on hand, committed, available and owed figures, its
 * policy at zero stock and its low-stock level. A person types a counted figure (*Set to*) or a change (*Adjust by*) in a cell; nothing is written until
 * *Review changes* has listed every row before and after and *Save changes* is pressed with a reason. The server compares each row with the figure it was
 * loaded with (a sale or another person's count since makes it a conflict that is not written) and works the new figure out under the row lock.
 *
 * A store with one active location (or a list filtered to one location) edits right in the row. With several, a row's *Locations* opens each location's
 * own figures and boxes: a figure is always one location's. Selected rows can be set to keep selling at zero stock, to stop, or given a low-stock level.
 * In the admin's language (`useAdminText("inventory")`, D312 A5); what the server answers (a refusal, a row's problem) keeps the server's words.
 */
export function InventoryTable({
  rows,
  locations,
  chosenLocationId,
  canWrite,
  tools,
  historyBase,
  productBase,
  pictures = {},
}: {
  /** Each variant's picture by id, for the Basic view (round 7, D624). */
  pictures?: Record<string, string | null>;
  rows: InventoryRow[];
  locations: LocationView[];
  /** The location the list was filtered to (its figures, and the only one a row's boxes write to); null for every active location summed. */
  chosenLocationId: string | null;
  canWrite: boolean;
  tools: InventoryTools;
  historyBase: string;
  productBase: string;
}) {
  const t = useAdminText("inventory");
  const w = t.table;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const figureText = (n: number) => figureIn(n, locale);
  const deltaText = (n: number) => deltaIn(n, locale);
  const [typed, setTyped] = useState<Record<string, CellTyped>>({});
  const [reason, setReason] = useState<AdjustReason>("correction");
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<Extract<AdjustResult, { ok: true }> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [policyNote, setPolicyNote] = useState<string | null>(null);
  const [days, setDays] = useState("7");
  const [level, setLevel] = useState("");
  const [pending, start] = useTransition();

  const locationName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);

  // The location a row's own boxes write to: the one the list was filtered to, else the store's only active location; with several, each location has its boxes.
  const soleActive = locations.filter((l) => l.active);
  const mainLocation = chosenLocationId ?? (soleActive.length === 1 ? soleActive[0].id : null);
  const showLocations = chosenLocationId === null && locations.length > 1;

  // Every cell a person can type in: the filtered location's, or each location the row shows (and the main one, which may hold no level yet).
  const cells = useMemo(() => {
    const out: CellRef[] = [];
    for (const row of rows) {
      const base = { variantId: row.variantId, sku: row.sku, title: row.title, options: optionsText(row.options) };
      const places = new Map<string, number>();
      if (chosenLocationId) places.set(chosenLocationId, row.locations.find((l) => l.locationId === chosenLocationId)?.onHand ?? 0);
      else {
        for (const l of row.locations) places.set(l.locationId, l.onHand);
        if (mainLocation && !places.has(mainLocation)) places.set(mainLocation, 0);
      }
      for (const [locationId, onHand] of places) out.push({ ...base, key: keyOf(row.variantId, locationId), locationId, was: onHand, location: locationName.get(locationId) ?? w.location });
    }
    return out;
  }, [rows, chosenLocationId, mainLocation, locationName, w.location]);

  const problemWords = useMemo(() => adjustProblemsIn(t, locale), [t, locale]);
  const review = useMemo(() => reviewRows(cells, typed, problemWords), [cells, typed, problemWords]);
  const sendableRows = sendable(review);
  const problems = review.filter((r) => r.problem !== null);

  const type = (key: string, change: Partial<CellTyped>) => {
    setSaved(null);
    setReviewing(false);
    setTyped((all) => {
      const now = { ...(all[key] ?? EMPTY_CELL), ...change };
      // Typing in one box clears the other: a cell is either a counted figure or a change.
      if (change.set !== undefined && change.set !== "") now.by = "";
      if (change.by !== undefined && change.by !== "") now.set = "";
      return { ...all, [key]: now };
    });
  };

  const discard = () => {
    setTyped({});
    setReviewing(false);
    setProblem(null);
  };

  const save = () =>
    start(async () => {
      setProblem(null);
      const result = await tools.adjust(adjustPayload(review, reason, note));
      if (!result.ok) return setProblem(result.problems.join(" "));
      setSaved(result);
      setTyped({});
      setReviewing(false);
      setNote("");
    });

  const applyPolicy = (change: unknown) =>
    start(async () => {
      setPolicyNote(null);
      const result = await tools.setPolicy({ variantIds: [...selected], change });
      if (!result.ok) return setPolicyNote(result.problems.join(" "));
      const bits = [fillWords(w.policyChanged, { n: result.changed.toLocaleString(locale) })];
      if (result.unchanged > 0) bits.push(fillWords(w.policyUnchanged, { n: result.unchanged.toLocaleString(locale) }));
      setPolicyNote(`${bits.join(", ")}.${result.problems.length > 0 ? ` ${result.problems.join(" ")}` : ""}`);
      setSelected(new Set());
    });

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const daysNumber = parseTyped(days);
  const daysOk = typeof daysNumber === "number" && daysNumber >= BACKORDER_DAYS_MIN && daysNumber <= BACKORDER_DAYS_MAX;
  const levelNumber = parseTyped(level);
  const levelOk = levelNumber === null || (typeof levelNumber === "number" && levelNumber >= 0 && levelNumber <= THRESHOLD_MAX);

  const editable = canWrite && mainLocation !== null;
  // Round 7 (D624): the Basic view's one count per variant, wherever a row's figure is one location's.
  const { view } = useAdminView();
  const simple = view === "basic" && mainLocation !== null && !showLocations;
  const changedKeys = new Set(review.map((r) => r.key));
  const columns = 9 + Number(canWrite) + (editable ? 2 : 0);

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      {canWrite && !simple && selected.size > 0 && (
        <section aria-label={w.chosenHeading} className={`${card} flex flex-col gap-3`}>
          <h2 className="text-title text-ink">
            {countWords(selected.size, w.chosen, { n: selected.size.toLocaleString(locale) })}
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="bulk-days" className="text-xs font-medium">
                {w.shipWithin}
              </label>
              <input id="bulk-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={`${field} w-24`} />
            </div>
            <button type="button" disabled={pending || !daysOk} onClick={() => applyPolicy({ kind: "continue", backorderDays: daysNumber })} className={secondary}>
              {w.keepSelling}
            </button>
            <button type="button" disabled={pending} onClick={() => applyPolicy({ kind: "deny" })} className={secondary}>
              {w.stopSelling}
            </button>
            <div className="flex flex-col gap-1">
              <label htmlFor="bulk-level" className="text-xs font-medium">
                {w.warnAt}
              </label>
              <input id="bulk-level" inputMode="numeric" value={level} placeholder={w.noWarning} onChange={(e) => setLevel(e.target.value)} className={`${field} w-28`} />
            </div>
            <button type="button" disabled={pending || !levelOk} onClick={() => applyPolicy({ kind: "threshold", lowStockThreshold: levelNumber })} className={secondary}>
              {w.setLevel}
            </button>
            <button type="button" disabled={pending} onClick={() => setSelected(new Set())} className="min-h-10 text-sm underline underline-offset-2">
              {w.clearChoice}
            </button>
          </div>
          {typeof daysNumber === "number" && backorderMayPassAgreed(daysNumber) && <p className={hint}>{BACKORDER_LONG_HINT}</p>}
          <p className={hint}>
            {fillWords(w.keepHint, { min: BACKORDER_DAYS_MIN, max: BACKORDER_DAYS_MAX })}
          </p>
        </section>
      )}
      {policyNote && (
        <p role="status" className="text-sm">
          {policyNote}
        </p>
      )}

      {simple ? (
        // Round 7 (D624), the Basic view: each variant with its picture, its state and one count, changed with − and + or typed.
        <ul aria-label={w.caption} className={`flex flex-col px-5 ${card}`}>
          {rows.map((row) => {
            const states = rowStates(row);
            const own = keyOf(row.variantId, mainLocation ?? "");
            const typedHere = typed[own] ?? EMPTY_CELL;
            const shown = typedHere.set !== "" ? typedHere.set : String(row.onHand);
            const count = parseTyped(shown);
            const step = (by: number) => type(own, { set: String(Math.max(0, (typeof count === "number" ? count : row.onHand) + by)) });
            const name = `${row.title}${optionsText(row.options) ? `, ${optionsText(row.options)}` : ""}`;
            const picture = pictures[row.variantId];
            return (
              <li key={row.variantId} className="flex min-h-19 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3 last:border-0">
                {picture ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a small product picture
                  <img src={picture} alt="" className="size-12 shrink-0 rounded-card object-cover" />
                ) : (
                  <span aria-hidden className="size-12 shrink-0 rounded-card bg-sunken" />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <Link href={`${productBase}/${row.productId}`} className="truncate text-body text-ink underline-offset-2 hover:underline">
                    {row.title}
                    {optionsText(row.options) && <span className="text-muted"> {optionsText(row.options)}</span>}
                  </Link>
                  <span className="truncate text-caption text-muted">
                    {row.sku} · {policyIn(row.stockPolicy, row.backorderDays, t)}
                    {" · "}
                    <Link href={`${historyBase}?variant=${row.variantId}`} className="underline-offset-2 hover:underline">
                      {w.history}
                    </Link>
                  </span>
                </span>
                {states
                  .filter((s) => s !== "owed")
                  .slice(0, 1)
                  .map((s) => (
                    <span key={s} title={t.stateHelp[s]} className={`inline-flex h-6 items-center rounded-pill px-2.5 text-chip ${s === "out" || s === "negative" ? "bg-danger-soft text-danger-text" : "bg-warning-soft text-warning-text"}`}>
                      {t.states[s]}
                    </span>
                  ))}
                {canWrite ? (
                  <span className="flex items-center gap-1.5">
                    <button type="button" onClick={() => step(-1)} aria-label={fillWords(w.less, { name })} className="flex size-10 items-center justify-center rounded-pill border border-edge bg-card text-lg text-ink hover:bg-sunken">
                      −
                    </button>
                    <input
                      inputMode="numeric"
                      value={shown}
                      onChange={(e) => type(own, { set: e.target.value })}
                      aria-label={fillWords(w.onShelf, { name })}
                      className={`h-10 w-16 rounded-md border bg-card text-center text-body tabular-nums ${changedKeys.has(own) ? "border-2 border-brand" : "border-line"}`}
                    />
                    <button type="button" onClick={() => step(1)} aria-label={fillWords(w.moreOne, { name })} className="flex size-10 items-center justify-center rounded-pill border border-edge bg-card text-lg text-ink hover:bg-sunken">
                      +
                    </button>
                  </span>
                ) : (
                  <span className="w-16 text-right text-body text-ink tabular-nums">{figureText(row.onHand)}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
      <>
      {/* Round 19 (D661): on a phone each variant is a card (its figures in words, − and + to count), not a table wider than the screen. */}
      <ul aria-label={w.caption} className={`flex flex-col px-4 sm:hidden ${card}`}>
        {rows.map((row) => {
          const name = `${row.title}${optionsText(row.options) ? `, ${optionsText(row.options)}` : ""}`;
          const counter = (key: string, onHand: number, label: string) => {
            const typedHere = typed[key] ?? EMPTY_CELL;
            const shown = typedHere.set !== "" ? typedHere.set : String(onHand);
            const count = parseTyped(shown);
            const step = (by: number) => type(key, { set: String(Math.max(0, (typeof count === "number" ? count : onHand) + by)) });
            return canWrite ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <button type="button" onClick={() => step(-1)} aria-label={fillWords(w.less, { name: label })} className="flex size-10 items-center justify-center rounded-pill border border-edge bg-card text-lg text-ink">
                  −
                </button>
                <input
                  inputMode="numeric"
                  value={shown}
                  onChange={(e) => type(key, { set: e.target.value })}
                  aria-label={fillWords(w.onShelf, { name: label })}
                  className={`h-10 w-14 rounded-md border bg-card text-center text-body tabular-nums ${changedKeys.has(key) ? "border-2 border-brand" : "border-line"}`}
                />
                <button type="button" onClick={() => step(1)} aria-label={fillWords(w.moreOne, { name: label })} className="flex size-10 items-center justify-center rounded-pill border border-edge bg-card text-lg text-ink">
                  +
                </button>
              </span>
            ) : (
              <span className="shrink-0 text-body text-ink tabular-nums">{figureText(onHand)}</span>
            );
          };
          const own = mainLocation ? keyOf(row.variantId, mainLocation) : null;
          return (
            <li key={row.variantId} className="flex flex-col gap-2 border-b border-line py-3 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <Link href={`${productBase}/${row.productId}`} className="text-body text-ink underline-offset-2 hover:underline">
                    {name}
                  </Link>
                  <span className="truncate font-mono text-xs text-muted">{row.sku}</span>
                  <span className="text-caption text-ink-2">
                    {figureText(row.committed)} {w.committed.toLowerCase()} · {figureText(row.available)} {w.available.toLowerCase()}
                  </span>
                </span>
                {own ? counter(own, row.onHand, name) : <span className="shrink-0 text-body text-ink tabular-nums">{figureText(row.onHand)}</span>}
              </div>
              {!own && row.locations.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-caption text-ink-2">{fillWords(w.locationsOf, { name, n: row.locations.length })}</summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {row.locations.map((l) => (
                      <li key={l.locationId} className="flex items-center justify-between gap-3">
                        <span className="text-caption text-ink">
                          {l.name}
                          {!l.active && <span className="text-muted">{w.inactive}</span>}
                        </span>
                        {counter(keyOf(row.variantId, l.locationId), l.onHand, `${name}, ${l.name}`)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <div className={`${tableShell} max-sm:hidden`}>
        <table className="w-full text-sm">
          <caption className="sr-only">{w.caption}</caption>
          <thead>
            <tr className="border-b border-line">
              {canWrite && (
                <th scope="col" className={th}>
                  <span className="sr-only">{w.choose}</span>
                </th>
              )}
              <th scope="col" className={th}>
                {w.variant}
              </th>
              <th scope="col" className={th}>
                {w.sku}
              </th>
              <th scope="col" className={`${th} text-right`}>
                {w.onHand}
              </th>
              {editable && (
                <>
                  <th scope="col" className={th}>
                    {w.setTo}
                  </th>
                  <th scope="col" className={th}>
                    {w.adjustBy}
                  </th>
                </>
              )}
              <th scope="col" className={`${th} text-right`}>
                {w.committed}
              </th>
              <th scope="col" className={`${th} text-right`}>
                {w.available}
              </th>
              <th scope="col" className={`${th} text-right`}>
                {w.owed}
              </th>
              <th scope="col" className={th}>
                {w.atZero}
              </th>
              <th scope="col" className={th}>
                {w.lowLevel}
              </th>
              <th scope="col" className={th}>
                {w.state}
              </th>
              <th scope="col" className={th}>
                <span className="sr-only">{w.more}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const states = rowStates(row);
              const own = mainLocation ? keyOf(row.variantId, mainLocation) : null;
              const typedHere = own ? (typed[own] ?? EMPTY_CELL) : EMPTY_CELL;
              const changed = own ? review.find((r) => r.key === own) : undefined;
              const name = `${row.title}${optionsText(row.options) ? `, ${optionsText(row.options)}` : ""}`;
              return (
                <Fragment key={row.variantId}>
                  <tr className="border-b border-line last:border-0">
                    {canWrite && (
                      <td className={td}>
                        <input type="checkbox" checked={selected.has(row.variantId)} onChange={() => toggle(row.variantId)} aria-label={fillWords(w.chooseRow, { name })} className="size-4" />
                      </td>
                    )}
                    <td className={td}>
                      <Link href={`${productBase}/${row.productId}`} className="font-medium underline-offset-2 hover:underline">
                        {row.title}
                      </Link>
                      {optionsText(row.options) && <span className={`${hint} block`}>{optionsText(row.options)}</span>}
                      {row.productStatus === "draft" && <span className={`${hint} block`}>{w.draft}</span>}
                    </td>
                    <td className={`${td} font-mono text-xs`}>{row.sku}</td>
                    <td className={`${td} text-right tabular-nums`}>{figureText(row.onHand)}</td>
                    {editable && (
                      <>
                        <td className={td}>
                          {own ? (
                            <input
                              inputMode="numeric"
                              value={typedHere.set}
                              onChange={(e) => type(own, { set: e.target.value })}
                              aria-label={fillWords(w.setLabel, { name })}
                              placeholder={String(row.onHand)}
                              className={`${cellInput} ${changed && typedHere.set !== "" ? "border-brand" : ""}`}
                            />
                          ) : (
                            <span className={hint}>{w.seeLocations}</span>
                          )}
                        </td>
                        <td className={td}>
                          {own ? (
                            <input
                              inputMode="numeric"
                              value={typedHere.by}
                              onChange={(e) => type(own, { by: e.target.value })}
                              aria-label={fillWords(w.adjustLabel, { name })}
                              placeholder={w.adjustPlaceholder}
                              className={`${cellInput} ${changed && typedHere.by !== "" ? "border-brand" : ""}`}
                            />
                          ) : (
                            <span className={hint}>-</span>
                          )}
                        </td>
                      </>
                    )}
                    <td className={`${td} text-right tabular-nums`}>{figureText(row.committed)}</td>
                    <td className={`${td} text-right tabular-nums`}>{figureText(row.available)}</td>
                    <td className={`${td} text-right tabular-nums`}>{row.owed > 0 ? figureText(row.owed) : <span className={hint}>0</span>}</td>
                    <td className={td}>{policyIn(row.stockPolicy, row.backorderDays, t)}</td>
                    <td className={td}>{row.lowStockThreshold === null ? <span className={hint}>{w.none}</span> : figureText(row.lowStockThreshold)}</td>
                    <td className={td}>
                      <span className="flex flex-wrap gap-1">
                        {states.length === 0 ? (
                          <span className={hint}>-</span>
                        ) : (
                          states.map((s) => (
                            <span key={s} title={t.stateHelp[s]} className={`rounded-full border border-line px-2 py-0.5 text-xs ${s === "negative" || s === "out" ? "font-medium" : ""}`}>
                              {t.states[s]}
                            </span>
                          ))
                        )}
                      </span>
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <Link href={`${historyBase}?variant=${row.variantId}`} className="text-xs underline underline-offset-2">
                        {w.history}
                      </Link>
                    </td>
                  </tr>
                  {showLocations && row.locations.length > 0 && (
                    <tr className="border-b border-line last:border-0">
                      <td colSpan={columns} className="px-3 pb-3 pt-0">
                        <details>
                          <summary className="cursor-pointer text-xs text-muted">
                            {fillWords(w.locationsOf, { name, n: row.locations.length })}
                          </summary>
                          <div className="mt-2 overflow-x-auto">
                            <table className="w-full text-xs">
                              <caption className="sr-only">{fillWords(w.locationsCaption, { name })}</caption>
                              <thead>
                                <tr className="border-b border-line">
                                  <th scope="col" className="py-1 pr-3 text-left font-medium">
                                    {w.location}
                                  </th>
                                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                                    {w.onHand}
                                  </th>
                                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                                    {w.committed}
                                  </th>
                                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                                    {w.available}
                                  </th>
                                  {canWrite && (
                                    <>
                                      <th scope="col" className="py-1 pr-3 text-left font-medium">
                                        {w.setTo}
                                      </th>
                                      <th scope="col" className="py-1 text-left font-medium">
                                        {w.adjustBy}
                                      </th>
                                    </>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {row.locations.map((l) => {
                                  const key = keyOf(row.variantId, l.locationId);
                                  const t = typed[key] ?? EMPTY_CELL;
                                  return (
                                    <tr key={l.locationId} className="border-b border-line last:border-0">
                                      <th scope="row" className="py-1 pr-3 text-left font-normal">
                                        {l.name}
                                        {!l.active && <span className="text-muted">{w.inactive}</span>}
                                      </th>
                                      <td className="py-1 pr-3 text-right tabular-nums">{figureText(l.onHand)}</td>
                                      <td className="py-1 pr-3 text-right tabular-nums">{figureText(l.committed)}</td>
                                      <td className="py-1 pr-3 text-right tabular-nums">{figureText(l.available)}</td>
                                      {canWrite && (
                                        <>
                                          <td className="py-1 pr-3">
                                            <input inputMode="numeric" value={t.set} onChange={(e) => type(key, { set: e.target.value })} aria-label={fillWords(w.setAtLabel, { location: l.name, name })} placeholder={String(l.onHand)} className={cellInput} />
                                          </td>
                                          <td className="py-1">
                                            <input inputMode="numeric" value={t.by} onChange={(e) => type(key, { by: e.target.value })} aria-label={fillWords(w.adjustAtLabel, { location: l.name, name })} placeholder={w.adjustPlaceholder} className={cellInput} />
                                          </td>
                                        </>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}

      {/* The Basic view saves from one bar (round 7): what changed, why, and Save; the review table stays in Advanced. */}
      {simple && canWrite && review.length > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 self-center rounded-pill bg-inverse py-2 pr-2 pl-5 text-inverse-ink shadow-[var(--shadow-float)]">
          <span className="text-body">
            {review.length === 1 && review[0].next !== null ? `${review[0].title}${review[0].options ? ` ${review[0].options}` : ""}: ${figureText(review[0].was)} → ${figureText(review[0].next)}` : countWords(review.length, w.changes)}
          </span>
          <label className="flex items-center gap-2 text-caption">
            {w.why}
            <select value={reason} onChange={(e) => setReason(reasonChoice(e.target.value))} className="h-9 rounded-pill border-0 bg-card px-3 text-caption text-ink">
              {REASON_CHOICES.map((r) => (
                <option key={r.id} value={r.id}>
                  {t.reasonChoices[r.id].label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={pending} onClick={discard} className="h-10 rounded-pill px-3 text-body text-inverse-ink underline-offset-2 hover:underline">
            {w.discard}
          </button>
          <button type="button" disabled={pending || sendableRows.length === 0} onClick={save} className="h-10 rounded-pill bg-brand px-5 text-body-strong text-brand-ink hover:bg-brand-hover disabled:opacity-60">
            {pending ? w.saving : w.saveBar}
          </button>
        </div>
      )}

      {canWrite && !simple && (
        <>
          <p className={hint}>
            {fillWords(t.figureHint, { max: STOCK_MAX.toLocaleString(locale) })} {w.figuresHint}
          </p>
          {/* On a phone the review stays at the bottom of the screen while there is something to review (round 19). */}
          <div className={`flex flex-wrap items-center gap-3 ${review.length > 0 ? "max-sm:sticky max-sm:bottom-20 max-sm:z-20 max-sm:rounded-pill max-sm:bg-inverse max-sm:p-2 max-sm:shadow-[var(--shadow-float)]" : ""}`}>
            <button type="button" disabled={pending || review.length === 0} onClick={() => setReviewing(true)} className={primary}>
              {w.review}
              {review.length > 0 ? ` (${review.length})` : ""}
            </button>
            {review.length > 0 && (
              <button type="button" disabled={pending} onClick={discard} className={secondary}>
                {w.discard}
              </button>
            )}
          </div>
        </>
      )}

      {reviewing && !simple && review.length > 0 && (
        <section aria-label={w.reviewHeading} className={`${card} flex flex-col gap-3`}>
          <h2 className="text-title text-ink">{w.reviewHeading}</h2>
          <p className={hint}>{w.reviewHint}</p>
          <div className={tableShell}>
            <table className="w-full text-sm">
              <caption className="sr-only">{w.reviewCaption}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={th}>
                    {w.variant}
                  </th>
                  <th scope="col" className={th}>
                    {w.location}
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    {w.before}
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    {w.after}
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    {w.change}
                  </th>
                </tr>
              </thead>
              <tbody>
                {review.map((r) => (
                  <tr key={r.key} className="border-b border-line last:border-0">
                    <td className={td}>
                      <span className="font-medium">{r.title}</span>
                      {r.options && <span className={`${hint} block`}>{r.options}</span>}
                      <span className={`${hint} block font-mono`}>{r.sku}</span>
                    </td>
                    <td className={td}>{r.location}</td>
                    <td className={`${td} text-right tabular-nums`}>{figureText(r.was)}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.next === null ? "-" : figureText(r.next)}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {r.delta === null ? <span className="text-danger-text">{r.problem}</span> : deltaText(r.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {problems.length > 0 && <p className="text-sm text-danger-text">{countWords(problems.length, w.leftOut)}</p>}
          <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
            <div className="flex flex-col gap-1">
              <label htmlFor="adjust-reason" className="text-sm font-medium">
                {w.reason}
              </label>
              <select id="adjust-reason" value={reason} onChange={(e) => setReason(reasonChoice(e.target.value))} className={field}>
                {REASON_CHOICES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {t.reasonChoices[r.id].label}
                  </option>
                ))}
              </select>
              <p className={hint}>{t.reasonChoices[reason]?.help}</p>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="adjust-note" className="text-sm font-medium">
                {w.note} <span className="font-normal text-muted">{w.optional}</span>
              </label>
              <input id="adjust-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className={field} />
              <p className={hint}>{t.noteHint}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={pending || sendableRows.length === 0} onClick={save} className={primary}>
              {pending ? w.saving : fillWords(w.save, { n: sendableRows.length })}
            </button>
            <button type="button" disabled={pending} onClick={() => setReviewing(false)} className={secondary}>
              {w.backToEditing}
            </button>
          </div>
        </section>
      )}

      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-danger-text">{problem}</p>}
      </div>

      {saved && (
        <section aria-label={w.result} className={`${card} flex flex-col gap-2`}>
          <h2 className="text-title text-ink">{savedIn(saved, t, locale)}</h2>
          {saved.rows.filter((r) => r.outcome !== "written" && r.outcome !== "unchanged").length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {saved.rows
                .filter((r) => r.outcome !== "written" && r.outcome !== "unchanged")
                .map((r) => {
                  const cell = cells.find((c) => c.key === keyOf(r.variantId, r.locationId));
                  return (
                    <li key={keyOf(r.variantId, r.locationId)} className="rounded-md border border-line bg-card px-3 py-2">
                      <span className="font-medium">{cell ? `${cell.title}${cell.options ? `, ${cell.options}` : ""}` : w.aVariant}</span>
                      {cell ? <span className="text-muted">, {cell.location}</span> : null}: {t.outcomes[r.outcome].toLowerCase()}. {r.problem}
                    </li>
                  );
                })}
            </ul>
          )}
          <p className={hint}>{w.historyShows}</p>
        </section>
      )}
    </div>
  );
}
