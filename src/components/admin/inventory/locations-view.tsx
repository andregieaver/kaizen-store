"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { card, field, hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { LOCATIONS_MAX, LOCATION_NAME_MAX, deactivationWords } from "@/lib/inventory";
import { heldWords } from "@/lib/inventory-admin";
import type { DeactivateResult } from "@/server/inventory-locations";
import type { LocationImpact } from "@/server/inventory";

export type LocationRowView = {
  id: string;
  name: string;
  country: string;
  active: boolean;
  priority: number;
  units: number;
  variants: number;
  /** What deactivating it would take off sale (read when the page was drawn); null for a location that is already inactive. */
  impact: LocationImpact | null;
};

type Step = { ok: true } | { ok: false; problem: string };

export type LocationTools = {
  save: (raw: { name: string; country: string }, id: string | null) => Promise<{ ok: true; id: string } | { ok: false; problem: string }>;
  move: (id: string, direction: "up" | "down") => Promise<Step>;
  deactivate: (id: string, confirmedUnits: number) => Promise<DeactivateResult>;
  reactivate: (id: string) => Promise<{ ok: true; impact: LocationImpact } | { ok: false; problem: string }>;
};

const unitsWords = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "unit" : "units"}`;

/**
 * The stock locations (wave 3, D172, `docs/wave-3-inventory.md` 2.3): the places stock is held, in the order an order's units are taken from (the top one
 * first). Staff with `products:write` add, rename and move; only the owner deactivates and reactivates, and the deactivation first shows how many units
 * stop being for sale and asks to be confirmed with that figure, which the server compares with the figure it reads again. A location is never deleted.
 * `countries` are the platform's; `canWrite` and `isOwner` only decide what is drawn, the server checks both again.
 */
export function LocationsView({
  rows,
  countries,
  canWrite,
  isOwner,
  tools,
}: {
  rows: LocationRowView[];
  countries: { code: string; name: string }[];
  canWrite: boolean;
  isOwner: boolean;
  tools: LocationTools;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [name, setName] = useState("");
  const [country, setCountry] = useState(rows.find((r) => r.active)?.country ?? countries[0]?.code ?? "NO");
  const [renaming, setRenaming] = useState<{ id: string; name: string; country: string } | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; impact: LocationImpact } | null>(null);
  const [pending, start] = useTransition();

  const activeCount = rows.filter((r) => r.active).length;
  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

  const run = (job: () => Promise<void>) =>
    start(async () => {
      setMessage(null);
      await job();
    });

  const show = (result: Step | { ok: true; id: string }, done: string) => {
    if (result.ok) {
      setMessage({ tone: "ok", text: done });
      router.refresh();
    } else setMessage({ tone: "problem", text: result.problem });
    return result.ok;
  };

  const add = () =>
    run(async () => {
      if (show(await tools.save({ name, country }, null), `${name.trim()} is added as the last location.`)) setName("");
    });

  const rename = () =>
    run(async () => {
      if (!renaming) return;
      if (show(await tools.save({ name: renaming.name, country: renaming.country }, renaming.id), "The location is changed.")) setRenaming(null);
    });

  const deactivate = () =>
    run(async () => {
      if (!confirming) return;
      const result = await tools.deactivate(confirming.id, confirming.impact.units);
      if (result.ok) {
        setConfirming(null);
        setMessage({ tone: "ok", text: result.notice });
        router.refresh();
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
        setMessage({ tone: "ok", text: `The location is active again. ${heldWords(result.impact.units, result.impact.variants)} ${result.impact.units === 1 ? "is" : "are"} for sale again.` });
        router.refresh();
      } else setMessage({ tone: "problem", text: result.problem });
    });

  const confirmingRow = confirming ? rows.find((r) => r.id === confirming.id) : undefined;
  const words = confirming ? deactivationWords(confirming.impact) : null;

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <p className="max-w-3xl text-sm text-muted">Orders are taken from the top location first. An order is kept together at one location when one location can supply all of it; otherwise it is taken by this order, and what is sold on backorder is put at the first location that stocks the variant.</p>
      <div className={tableShell}>
        <table className="w-full text-sm">
          <caption className="sr-only">The store&apos;s stock locations in the order orders are taken from them</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className={th}>
                Order
              </th>
              <th scope="col" className={th}>
                Location
              </th>
              <th scope="col" className={th}>
                Country
              </th>
              <th scope="col" className={th}>
                State
              </th>
              <th scope="col" className={th}>
                Holds
              </th>
              <th scope="col" className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const activeRows = rows.filter((r) => r.active);
              const at = activeRows.findIndex((r) => r.id === row.id);
              return (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className={`${td} tabular-nums`}>{row.active ? index + 1 : <span className={hint}>-</span>}</td>
                  <td className={`${td} font-medium`}>{row.name}</td>
                  <td className={td}>{countryName(row.country)}</td>
                  <td className={td}>{row.active ? "Active" : "Inactive: its stock is not for sale"}</td>
                  <td className={td}>{heldWords(row.units, row.variants)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <span className="flex flex-wrap justify-end gap-2">
                      {canWrite && row.active && (
                        <>
                          <button type="button" disabled={pending || at <= 0} onClick={() => run(async () => void show(await tools.move(row.id, "up"), "Moved up."))} aria-label={`Move ${row.name} up`} className="min-h-9 rounded-md border border-border px-2 text-xs disabled:opacity-40">
                            Move up
                          </button>
                          <button type="button" disabled={pending || at < 0 || at >= activeRows.length - 1} onClick={() => run(async () => void show(await tools.move(row.id, "down"), "Moved down."))} aria-label={`Move ${row.name} down`} className="min-h-9 rounded-md border border-border px-2 text-xs disabled:opacity-40">
                            Move down
                          </button>
                        </>
                      )}
                      {canWrite && (
                        <button type="button" disabled={pending} onClick={() => setRenaming({ id: row.id, name: row.name, country: row.country })} aria-label={`Rename ${row.name}`} className="min-h-9 rounded-md border border-border px-2 text-xs">
                          Rename
                        </button>
                      )}
                      {isOwner && row.active && (
                        <button
                          type="button"
                          disabled={pending || activeCount <= 1 || row.impact === null}
                          onClick={() => row.impact && setConfirming({ id: row.id, impact: row.impact })}
                          aria-label={`Deactivate ${row.name}`}
                          title={activeCount <= 1 ? "A store keeps at least one active location." : undefined}
                          className="min-h-9 rounded-md border border-border px-2 text-xs disabled:opacity-40"
                        >
                          Deactivate
                        </button>
                      )}
                      {isOwner && !row.active && (
                        <button type="button" disabled={pending} onClick={() => reactivate(row.id)} aria-label={`Reactivate ${row.name}`} className="min-h-9 rounded-md border border-border px-2 text-xs">
                          Reactivate
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canWrite && !isOwner && <p className={hint}>Only the store&apos;s owner can deactivate or reactivate a location, because that takes stock off sale or puts it back.</p>}

      {confirming && confirmingRow && words && (
        <section aria-label="Deactivate the location" className={`${card} flex flex-col gap-3`} role="group">
          <h2 className="text-base font-semibold">Deactivate {confirmingRow.name}?</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col">
              <dt className={hint}>Units that stop being for sale</dt>
              <dd className="text-2xl font-semibold tabular-nums">{confirming.impact.units.toLocaleString("en-GB")}</dd>
            </div>
            <div className="flex flex-col">
              <dt className={hint}>Variants</dt>
              <dd className="text-2xl font-semibold tabular-nums">{confirming.impact.variants.toLocaleString("en-GB")}</dd>
            </div>
            <div className="flex flex-col">
              <dt className={hint}>Held by checkouts now</dt>
              <dd className="text-2xl font-semibold tabular-nums">{confirming.impact.committedUnits.toLocaleString("en-GB")}</dd>
            </div>
            <div className="flex flex-col">
              <dt className={hint}>Owed on backorder here</dt>
              <dd className="text-2xl font-semibold tabular-nums">{confirming.impact.owedUnits.toLocaleString("en-GB")}</dd>
            </div>
          </dl>
          <p className="text-sm">
            {unitsWords(confirming.impact.units)} across {confirming.impact.variants.toLocaleString("en-GB")} {confirming.impact.variants === 1 ? "variant" : "variants"} will no longer be for sale. Nothing is deleted: reactivate the location and they are for sale again. Variants that have stock only here are sold out
            until then.
          </p>
          {words.refusal && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {words.refusal}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending || words.refusal !== null} onClick={deactivate} className={primary}>
              {pending ? "Deactivating …" : `Yes, deactivate (${unitsWords(confirming.impact.units)})`}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(null)} className={secondary}>
              Not now
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
          aria-label="Rename the location"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="rename-name" className="text-sm font-medium">
              Name
            </label>
            <input id="rename-name" value={renaming.name} maxLength={LOCATION_NAME_MAX} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} className={`${field} w-64`} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="rename-country" className="text-sm font-medium">
              Country
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
            Save
          </button>
          <button type="button" disabled={pending} onClick={() => setRenaming(null)} className={secondary}>
            Cancel
          </button>
        </form>
      )}

      {canWrite && (
        <form
          className={`${card} flex flex-wrap items-end gap-3`}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          aria-label="Add a location"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="location-name" className="text-sm font-medium">
              New location
            </label>
            <input id="location-name" value={name} maxLength={LOCATION_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Name, for example Bergen shop" className={`${field} w-64`} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="location-country" className="text-sm font-medium">
              Country
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
            Add location
          </button>
          <p className={`${hint} w-full`}>
            A new location goes last in the order. At most {LOCATIONS_MAX} locations; the name is unique among active locations. The country is kept for later (nearest-location orders, local pickup); today it only labels the place.
            {rows.length >= LOCATIONS_MAX ? " The store has reached the limit." : ""}
          </p>
        </form>
      )}

      <div role="status" aria-live="polite">
        {message && <p className={`text-sm ${message.tone === "problem" ? "text-red-700 dark:text-red-400" : ""}`}>{message.text}</p>}
      </div>
    </div>
  );
}
