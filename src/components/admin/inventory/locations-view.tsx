"use client";

import { useState, useTransition } from "react";

import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { card, field, hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { LOCATIONS_MAX, LOCATION_NAME_MAX } from "@/lib/inventory";
import { deactivationIn, heldIn } from "@/lib/inventory-words";
import type { DeactivateResult } from "@/server/inventory-locations";
import type { LocationImpact } from "@/server/inventory";

import { PhoneRow } from "../phone-row";

export type LocationRowView = {
  id: string;
  name: string;
  country: string;
  active: boolean;
  /** Whether online orders take units from here (D383). */
  fulfilsOnline: boolean;
  priority: number;
  units: number;
  variants: number;
  /** Units on their way here (D383), not for sale until they are counted in. */
  incoming?: number;
  /** What deactivating it would take off sale (read when the page was drawn); null for a location that is already inactive. */
  impact: LocationImpact | null;
};

type Step = { ok: true } | { ok: false; problem: string };

export type LocationTools = {
  save: (raw: { name: string; country: string }, id: string | null) => Promise<{ ok: true; id: string } | { ok: false; problem: string }>;
  move: (id: string, direction: "up" | "down") => Promise<Step>;
  deactivate: (id: string, confirmedUnits: number) => Promise<DeactivateResult>;
  reactivate: (id: string) => Promise<{ ok: true; impact: LocationImpact } | { ok: false; problem: string }>;
  online: (id: string, on: boolean) => Promise<Step>;
  /** How orders choose a location (D383); absent for a member who may not change store settings. */
  routing?: (routing: "rank" | "nearest") => Promise<Step>;
};

/**
 * The stock locations (wave 3, D172, `docs/wave-3-inventory.md` 2.3): the places stock is held, in the order an order's units are taken from (the top one
 * first). Staff with `products:write` add, rename and move; only the owner deactivates and reactivates, and the deactivation first shows how many units
 * stop being for sale and asks to be confirmed with that figure, which the server compares with the figure it reads again. A location is never deleted.
 * `countries` are the platform's; `canWrite` and `isOwner` only decide what is drawn, the server checks both again. In the admin's language
 * (`useAdminText("inventory")`, D312 A5): the deactivation's notice is said here from the figures the server returns; its refusals keep the server's words.
 */
export function LocationsView({
  rows,
  countries,
  canWrite,
  isOwner,
  tools,
  routing = "rank",
}: {
  rows: LocationRowView[];
  countries: { code: string; name: string }[];
  canWrite: boolean;
  isOwner: boolean;
  tools: LocationTools;
  /** The store's routing as saved. */
  routing?: "rank" | "nearest";
}) {
  const t = useAdminText("inventory");
  const w = t.locations;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const unitsWords = (n: number) => countWords(n, w.units, { n: n.toLocaleString(locale) });
  const heldWords = (units: number, variants: number) => heldIn(units, variants, t, locale);
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [name, setName] = useState("");
  const [country, setCountry] = useState(rows.find((r) => r.active)?.country ?? countries[0]?.code ?? "NO");
  const [renaming, setRenaming] = useState<{ id: string; name: string; country: string } | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; impact: LocationImpact } | null>(null);
  const [pending, start] = useTransition();

  const activeCount = rows.filter((r) => r.active).length;
  const onlineCount = rows.filter((r) => r.active && r.fulfilsOnline).length;
  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

  const run = (job: () => Promise<void>) =>
    start(async () => {
      setMessage(null);
      await job();
    });

  const show = (result: Step | { ok: true; id: string }, done: string) => {
    if (result.ok) {
      setMessage({ tone: "ok", text: done });
    } else setMessage({ tone: "problem", text: result.problem });
    return result.ok;
  };

  const add = () =>
    run(async () => {
      if (show(await tools.save({ name, country }, null), fillWords(w.added, { name: name.trim() }))) setName("");
    });

  const rename = () =>
    run(async () => {
      if (!renaming) return;
      if (show(await tools.save({ name: renaming.name, country: renaming.country }, renaming.id), w.changed)) setRenaming(null);
    });

  const deactivate = () =>
    run(async () => {
      if (!confirming) return;
      const result = await tools.deactivate(confirming.id, confirming.impact.units);
      if (result.ok) {
        setConfirming(null);
        setMessage({ tone: "ok", text: deactivationIn(result.impact, t, locale).notice });
        return;
      }
      // The figure moved since the page was drawn: show the new one and ask again.
      if (result.impact) setConfirming({ id: confirming.id, impact: result.impact });
      setMessage({ tone: "problem", text: result.problem });
    });

  const reactivate = (id: string) =>
    run(async () => {
      const result = await tools.reactivate(id);
      if (result.ok) {
        setMessage({ tone: "ok", text: countWords(result.impact.units, w.activeAgain, { held: heldWords(result.impact.units, result.impact.variants) }) });
      } else setMessage({ tone: "problem", text: result.problem });
    });

  const confirmingRow = confirming ? rows.find((r) => r.id === confirming.id) : undefined;
  const words = confirming ? deactivationIn(confirming.impact, t, locale) : null;

  // The buttons of a location's row, in the table from `sm` up and under its line on a phone (round 53, D798).
  const actionsFor = (row: (typeof rows)[number]) => {
    const activeRows = rows.filter((r) => r.active);
    const at = activeRows.findIndex((r) => r.id === row.id);
    return (
    <span className="flex flex-wrap justify-end gap-2">
      {canWrite && row.active && (
        <>
          <button type="button" disabled={pending || at <= 0} onClick={() => run(async () => void show(await tools.move(row.id, "up"), w.movedUp))} aria-label={fillWords(w.moveUpLabel, { name: row.name })} className="min-h-9 rounded-pill border border-edge px-2 text-xs disabled:opacity-40">
            {w.moveUp}
          </button>
          <button type="button" disabled={pending || at < 0 || at >= activeRows.length - 1} onClick={() => run(async () => void show(await tools.move(row.id, "down"), w.movedDown))} aria-label={fillWords(w.moveDownLabel, { name: row.name })} className="min-h-9 rounded-pill border border-edge px-2 text-xs disabled:opacity-40">
            {w.moveDown}
          </button>
        </>
      )}
      {canWrite && (
        <button type="button" disabled={pending} onClick={() => setRenaming({ id: row.id, name: row.name, country: row.country })} aria-label={fillWords(w.renameLabel, { name: row.name })} className="min-h-9 rounded-pill border border-line px-2 text-xs">
          {w.rename}
        </button>
      )}
      {isOwner && row.active && (
        <button
          type="button"
          disabled={pending || activeCount <= 1 || row.impact === null}
          onClick={() => row.impact && setConfirming({ id: row.id, impact: row.impact })}
          aria-label={fillWords(w.deactivateLabel, { name: row.name })}
          title={activeCount <= 1 ? w.keepOne : undefined}
          className="min-h-9 rounded-pill border border-line px-2 text-xs disabled:opacity-40"
        >
          {w.deactivate}
        </button>
      )}
      {isOwner && row.active && (
        <button
          type="button"
          disabled={pending || (row.fulfilsOnline && onlineCount <= 1)}
          onClick={() =>
            run(async () => void show(await tools.online(row.id, !row.fulfilsOnline), fillWords(row.fulfilsOnline ? w.onlineOffDone : w.onlineOnDone, { name: row.name })))
          }
          aria-label={fillWords(row.fulfilsOnline ? w.onlineOffLabel : w.onlineOnLabel, { name: row.name })}
          className="min-h-9 rounded-pill border border-line px-2 text-xs disabled:opacity-40"
        >
          {row.fulfilsOnline ? w.onlineOff : w.onlineOn}
        </button>
      )}
      {isOwner && !row.active && (
        <button type="button" disabled={pending} onClick={() => reactivate(row.id)} aria-label={fillWords(w.reactivateLabel, { name: row.name })} className="min-h-9 rounded-pill border border-edge px-2 text-xs">
          {w.reactivate}
        </button>
      )}
    </span>
    );
  };

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      {/* Round 53 (D798): on a phone how orders pick a location is a row at the end; the locations are lines. From `sm` up as before. */}
      <div className="flex flex-col gap-4 max-sm:order-last max-sm:overflow-hidden max-sm:rounded-panel">
        <PhoneRow title={t.phone.pickRow} sub={routing === "nearest" ? t.phone.pickNearest : t.phone.pickRank} change={t.phone.open} done={t.phone.done} last>
          <div className="flex flex-col gap-4">
          <p className="max-w-3xl text-sm text-muted">{w.takenFirst}</p>
          {tools.routing && rows.filter((r) => r.active).length > 1 && (
            <fieldset className={`${card} flex flex-col gap-2`}>
              <legend className="text-sm font-medium">{w.routingTitle}</legend>
              {(["rank", "nearest"] as const).map((choice) => (
                <label key={choice} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="stock-routing"
                    value={choice}
                    defaultChecked={routing === choice}
                    disabled={pending}
                    onChange={() => run(async () => void show(await tools.routing!(choice), w.routingSaved))}
                  />
                  {choice === "rank" ? w.routingRank : w.routingNearest}
                </label>
              ))}
              <p className={hint}>{w.routingHint}</p>
            </fieldset>
          )}
          </div>
        </PhoneRow>
      </div>
      <ul className="flex flex-col overflow-hidden rounded-panel bg-card sm:hidden" aria-label={w.caption}>
        {rows.map((row, index) => (
          <li key={row.id} className="border-b border-line px-4 last:border-0">
            <details className="group">
              <summary className="flex min-h-15 cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-sm tabular-nums">
                  {row.active ? index + 1 : "-"}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink">{row.name}</span>
                  <span className="text-caption text-ink-2">
                    {[countryName(row.country), row.active ? w.active : w.inactive, row.fulfilsOnline ? w.onlineYes : w.onlineNo, heldWords(row.units, row.variants)].join(" · ")}
                  </span>
                </span>
                {canWrite || isOwner ? <span className="shrink-0 text-sm font-medium text-ink underline underline-offset-2 group-open:no-underline">{t.phone.change}</span> : null}
              </summary>
              {canWrite || isOwner ? <div className="pb-3 [&>span]:justify-start">{actionsFor(row)}</div> : null}
            </details>
          </li>
        ))}
      </ul>
      <div className={`${tableShell} max-sm:hidden`}>
        <table className="w-full text-sm">
          <caption className="sr-only">{w.caption}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={th}>
                {w.order}
              </th>
              <th scope="col" className={th}>
                {w.location}
              </th>
              <th scope="col" className={th}>
                {w.country}
              </th>
              <th scope="col" className={th}>
                {w.state}
              </th>
              <th scope="col" className={th}>
                {w.online}
              </th>
              <th scope="col" className={th}>
                {w.holds}
              </th>
              <th scope="col" className={th}>
                <span className="sr-only">{w.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              return (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className={`${td} tabular-nums`}>{row.active ? index + 1 : <span className={hint}>-</span>}</td>
                  <td className={`${td} font-medium`}>{row.name}</td>
                  <td className={td}>{countryName(row.country)}</td>
                  <td className={td}>{row.active ? w.active : w.inactive}</td>
                  <td className={td}>{row.fulfilsOnline ? w.onlineYes : w.onlineNo}</td>
                  <td className={td}>
                    {heldWords(row.units, row.variants)}
                    {row.incoming ? (
                      <span className={`${hint} block`} title={t.documents.incomingHint}>
                        {t.documents.incoming}: {unitsWords(row.incoming)}
                      </span>
                    ) : null}
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {actionsFor(row)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canWrite && !isOwner && <p className={hint}>{w.ownerOnly}</p>}

      {confirming && confirmingRow && words && (
        <section aria-label={w.confirmLabel} className={`${card} flex flex-col gap-3`} role="group">
          <h2 className="text-title text-ink">{fillWords(w.confirmTitle, { name: confirmingRow.name })}</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col">
              <dt className={hint}>{w.stopUnits}</dt>
              <dd className="text-metric text-ink tabular-nums">{confirming.impact.units.toLocaleString(locale)}</dd>
            </div>
            <div className="flex flex-col">
              <dt className={hint}>{w.variants}</dt>
              <dd className="text-metric text-ink tabular-nums">{confirming.impact.variants.toLocaleString(locale)}</dd>
            </div>
            <div className="flex flex-col">
              <dt className={hint}>{w.heldNow}</dt>
              <dd className="text-metric text-ink tabular-nums">{confirming.impact.committedUnits.toLocaleString(locale)}</dd>
            </div>
            <div className="flex flex-col">
              <dt className={hint}>{w.owedHere}</dt>
              <dd className="text-metric text-ink tabular-nums">{confirming.impact.owedUnits.toLocaleString(locale)}</dd>
            </div>
          </dl>
          <p className="text-sm">
            {countWords(confirming.impact.variants, w.willStop, { n: confirming.impact.variants.toLocaleString(locale), units: unitsWords(confirming.impact.units) })}
          </p>
          {words.refusal && (
            <p role="alert" className="text-sm text-danger-text">
              {words.refusal}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending || words.refusal !== null} onClick={deactivate} className={primary}>
              {pending ? w.deactivating : fillWords(w.yesDeactivate, { units: unitsWords(confirming.impact.units) })}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(null)} className={secondary}>
              {w.notNow}
            </button>
          </div>
        </section>
      )}

      {renaming && (
        <form
          className={`${card} flex flex-wrap items-end gap-3`}
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
          aria-label={w.renameForm}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="rename-name" className="text-sm font-medium">
              {w.name}
            </label>
            <input id="rename-name" value={renaming.name} maxLength={LOCATION_NAME_MAX} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} className={`${field} w-64`} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="rename-country" className="text-sm font-medium">
              {w.country}
            </label>
            <select id="rename-country" value={renaming.country} onChange={(e) => setRenaming({ ...renaming, country: e.target.value })} className={field}>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={pending} className={primary}>
            {w.save}
          </button>
          <button type="button" disabled={pending} onClick={() => setRenaming(null)} className={secondary}>
            {w.cancel}
          </button>
        </form>
      )}

      {canWrite && (
        <div className="max-sm:overflow-hidden max-sm:rounded-panel">
          <PhoneRow title={t.phone.addLocation} sub={t.phone.addLocationSub} change={t.phone.open} done={t.phone.done} flat last>
            <form
              className={`${card} flex flex-wrap items-end gap-3`}
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
              aria-label={w.addForm}
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="location-name" className="text-sm font-medium">
                  {w.newLocation}
                </label>
                <input id="location-name" value={name} maxLength={LOCATION_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder={w.namePlaceholder} className={`${field} w-64`} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="location-country" className="text-sm font-medium">
                  {w.country}
                </label>
                <select id="location-country" value={country} onChange={(e) => setCountry(e.target.value)} className={field}>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" disabled={pending || name.trim() === "" || rows.length >= LOCATIONS_MAX} className={primary}>
                {w.add}
              </button>
              <p className={`${hint} w-full`}>
                <span className="max-sm:hidden">{fillWords(w.addHint, { max: LOCATIONS_MAX })}</span>
                {rows.length >= LOCATIONS_MAX ? w.atLimit : ""}
              </p>
            </form>
          </PhoneRow>
        </div>
      )}

      <div role="status" aria-live="polite">
        {message && <p className={`text-sm ${message.tone === "problem" ? "text-danger-text " : ""}`}>{message.text}</p>}
      </div>
    </div>
  );
}
