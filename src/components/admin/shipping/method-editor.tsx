"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { ShippingMessages } from "@/lib/admin-messages/shipping.en";
import { ESTIMATE_DAYS_MAX, NAME_MAX, TIERS_MAX } from "@/lib/shipping-limits";
import {
  blocksFromRates,
  groupsFromBlocks,
  minorOf,
  notOfferedWords,
  tierStarts,
  typedAmount,
  type BlockBasis,
  type BlockDraft,
} from "@/lib/shipping-method-form";
import type { MethodRate } from "@/lib/shipping-methods";
import { Button, CARD_CLASS } from "@/components/admin/ui";

import { useAdminText } from "../admin-text";

/**
 * A shipping method and its rates (D237, `docs/wave-3-shipping-methods.md` 2.1): the name, transit time, free-above value and switch, and a grid
 * with one block per zone (Rest of country first) and, inside it, one per profile (General first). Each block is *Not offered*, a flat price, or
 * tiers by weight or by basket value, written as a ladder whose *from* follows the tier before, so it never has a gap. The whole method is sent as
 * JSON on Save and checked again on the server; nothing is saved while a block has a problem.
 */

export type MethodEditorProps = {
  base: string;
  market: { code: string; name: string; currency: string };
  zones: { id: string; name: string }[];
  profiles: { id: string; name: string }[];
  method: {
    id: string;
    name: string;
    names: Record<string, string>;
    estimate: { min: number; max: number } | null;
    freeOverMinor: number | null;
    active: boolean;
    rates: MethodRate[];
  } | null;
  canWrite: boolean;
  save: (input: unknown) => Promise<{ ok: true; id: string; message: string } | { ok: false; message: string }>;
};

const BASES: BlockBasis[] = ["none", "flat", "weight", "value"];

const control = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm";

export function MethodEditor({ base, market, zones, profiles, method, canWrite, save }: MethodEditorProps) {
  const w = useAdminText("shipping").method;
  const router = useRouter();
  const currency = market.currency;
  const [name, setName] = useState(method?.name ?? "");
  const [active, setActive] = useState(method?.active ?? true);
  const [estimateMin, setEstimateMin] = useState(method?.estimate ? String(method.estimate.min) : "");
  const [estimateMax, setEstimateMax] = useState(method?.estimate ? String(method.estimate.max) : "");
  const [freeOver, setFreeOver] = useState(method?.freeOverMinor ? typedAmount(method.freeOverMinor, currency) : "");
  const [blocks, setBlocks] = useState<BlockDraft[]>(() =>
    blocksFromRates(method?.rates ?? [], zones.map((z) => z.id), profiles.map((p) => p.id), currency),
  );
  const [messages, setMessages] = useState<{ ok: boolean; text: string[] }>({ ok: true, text: [] });
  const [pending, start] = useTransition();
  // A block's problems show once Save was pressed, so a tier being typed is not called wrong.
  const [tried, setTried] = useState(false);

  const zoneName = (id: string | null) => (id === null ? w.restOfCountry : zones.find((z) => z.id === id)?.name ?? w.aZone);
  const profileName = (id: string | null) => (id === null ? w.general : profiles.find((p) => p.id === id)?.name ?? w.aProfile);
  const change = (index: number, next: (block: BlockDraft) => BlockDraft) => setBlocks((all) => all.map((b, i) => (i === index ? next(b) : b)));
  const problems = tried ? groupsFromBlocks(blocks, currency, w).problems : [];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    const found: string[] = [];
    const { groups, problems: blockProblems } = groupsFromBlocks(blocks, currency, w);
    for (const p of blockProblems) found.push(fillWords(w.problemIn, { zone: zoneName(blocks[p.block].zoneId), profile: profileName(blocks[p.block].profileId), message: p.message }));
    const free = freeOver.trim() ? minorOf(freeOver, currency) : null;
    if (freeOver.trim() && (free === null || free <= 0)) found.push(fillWords(w.freeProblem, { currency }));
    const hasEstimate = estimateMin.trim() !== "" || estimateMax.trim() !== "";
    const min = Number(estimateMin || estimateMax);
    const max = Number(estimateMax || estimateMin);
    if (hasEstimate && (!/^\d*$/.test(estimateMin) || !/^\d*$/.test(estimateMax) || min > max || max > ESTIMATE_DAYS_MAX)) {
      found.push(fillWords(w.transitProblem, { max: ESTIMATE_DAYS_MAX }));
    }
    if (found.length > 0) {
      setMessages({ ok: false, text: found });
      return;
    }
    const input = {
      id: method?.id ?? null,
      marketCode: market.code,
      name: name.trim(),
      names: method?.names ?? {},
      estimate: hasEstimate ? { min, max } : null,
      freeOverMinor: free,
      active,
      groups,
    };
    start(async () => {
      const saved = await save(input);
      if (!saved.ok) {
        setMessages({ ok: false, text: [saved.message] });
        return;
      }
      setMessages({ ok: true, text: [saved.message] });
      if (!method) router.replace(`${base}/methods/${saved.id}`);
      else router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" aria-busy={pending}>
      <section aria-labelledby="method-details" className={`flex flex-col gap-4 p-6 ${CARD_CLASS}`}>
        <h2 id="method-details" className="text-title text-ink">{w.details}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            {w.name}
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={NAME_MAX} placeholder={w.namePlaceholder} className={control} disabled={!canWrite} />
          </label>
          <label className={label}>
            {fillWords(w.freeAbove, { currency })}
            <input value={freeOver} onChange={(e) => setFreeOver(e.target.value)} inputMode="decimal" placeholder={w.neverFree} className={control} disabled={!canWrite} />
          </label>
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1">{w.transit}</legend>
            <div className="flex items-center gap-2">
              <input aria-label={w.transitFrom} value={estimateMin} onChange={(e) => setEstimateMin(e.target.value)} inputMode="numeric" className={`${control} max-w-24`} disabled={!canWrite} />
              <span aria-hidden>–</span>
              <input aria-label={w.transitTo} value={estimateMax} onChange={(e) => setEstimateMax(e.target.value)} inputMode="numeric" className={`${control} max-w-24`} disabled={!canWrite} />
              <span className="text-muted">{w.days}</span>
            </div>
          </fieldset>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={!canWrite} />
            {w.offered}
          </label>
        </div>
        <p className="text-sm text-muted">{fillWords(w.note, { market: market.name })}</p>
      </section>

      <section aria-labelledby="method-rates" className={`flex flex-col gap-4 p-6 ${CARD_CLASS}`}>
        <div>
          <h2 id="method-rates" className="text-title text-ink">{w.rates}</h2>
          <p className="mt-1 max-w-[75ch] text-sm text-muted">
            {w.ratesBefore}
            <em>{w.from}</em>
            {w.ratesMiddle}
            <em>{w.upTo}</em>
            {w.ratesLast}
            <em>{w.andAbove}</em>
            {fillWords(w.ratesAfter, { currency })}
          </p>
        </div>
        {[null, ...zones.map((z) => z.id)].map((zoneId) => (
          <fieldset key={zoneId ?? "rest"} className="flex flex-col gap-3 rounded-panel bg-sunken p-4">
            <legend className="text-body-strong text-ink">{zoneName(zoneId)}</legend>
            {blocks.map((block, index) =>
              block.zoneId !== zoneId ? null : (
                <RateBlock
                  key={`${zoneId}-${block.profileId}`}
                  block={block}
                  index={index}
                  currency={currency}
                  title={profileName(block.profileId)}
                  notOffered={notOfferedWords(zoneName(zoneId), profileName(block.profileId), w)}
                  problems={problems.filter((p) => p.block === index).map((p) => p.message)}
                  canWrite={canWrite}
                  change={(next) => change(index, next)}
                />
              ),
            )}
          </fieldset>
        ))}
      </section>

      <div role="status" aria-live="polite" className="text-sm">
        {messages.text.length > 0 &&
          (messages.ok ? (
            <p>{messages.text[0]}</p>
          ) : (
            <ul className="list-disc pl-5 text-danger-text">
              {messages.text.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ))}
      </div>
      {canWrite && (
        <div>
          <Button type="submit" kind="main" disabled={pending}>
            {pending ? w.saving : method ? w.save : w.addMethod}
          </Button>
        </div>
      )}
    </form>
  );
}

function RateBlock({
  block,
  index,
  currency,
  title,
  notOffered,
  problems,
  canWrite,
  change,
}: {
  block: BlockDraft;
  index: number;
  currency: string;
  title: string;
  notOffered: string;
  problems: string[];
  canWrite: boolean;
  change: (next: (block: BlockDraft) => BlockDraft) => void;
}) {
  const w: ShippingMessages["method"] = useAdminText("shipping").method;
  const unit = block.basis === "weight" ? "kg" : currency;
  const starts = tierStarts(block);
  const setBasis = (basis: BlockBasis) =>
    change((b) => ({ ...b, basis, tiers: basis === "weight" || basis === "value" ? (b.basis === basis ? b.tiers : [{ upTo: "", price: "" }]) : [] }));
  return (
    <div className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`} data-block={index}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-body-strong text-ink">{title}</h3>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">{w.price}</span>
          <select value={block.basis} onChange={(e) => setBasis(e.target.value as BlockBasis)} className="min-h-9 rounded-md border border-line bg-card px-2 text-sm" disabled={!canWrite} aria-label={fillWords(w.howPriced, { title })}>
            {BASES.map((b) => (
              <option key={b} value={b}>
                {w.bases[b]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {block.basis === "none" && <p className="text-sm text-muted">{notOffered}</p>}
      {block.basis === "flat" && (
        <label className="flex max-w-xs flex-col gap-1 text-sm">
          {fillWords(w.priceIn, { currency })}
          <input value={block.flat} onChange={(e) => change((b) => ({ ...b, flat: e.target.value }))} inputMode="decimal" className={control} disabled={!canWrite} />
        </label>
      )}
      {(block.basis === "weight" || block.basis === "value") && (
        <table className="w-full max-w-2xl text-left text-sm">
          <caption className="sr-only">
            {fillWords(w.tiersBy[block.basis], { title })}
          </caption>
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1 pr-3 font-normal">{fillWords(w.fromIn, { unit })}</th>
              <th scope="col" className="py-1 pr-3 font-normal">{fillWords(w.upToIn, { unit })}</th>
              <th scope="col" className="py-1 pr-3 font-normal">{fillWords(w.priceIn, { currency })}</th>
              <th scope="col" className="py-1">
                <span className="sr-only">{w.remove}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {block.tiers.map((tier, i) => (
              <tr key={i}>
                <td className="py-1 pr-3 tabular-nums text-muted">{starts[i]}</td>
                <td className="py-1 pr-3">
                  <input
                    aria-label={fillWords(w.tierUpTo, { n: i + 1, unit })}
                    value={tier.upTo}
                    placeholder={i === block.tiers.length - 1 ? w.andAbove : ""}
                    onChange={(e) => change((b) => ({ ...b, tiers: b.tiers.map((t, j) => (j === i ? { ...t, upTo: e.target.value } : t)) }))}
                    inputMode="decimal"
                    className={control}
                    disabled={!canWrite}
                  />
                </td>
                <td className="py-1 pr-3">
                  <input
                    aria-label={fillWords(w.tierPrice, { n: i + 1, currency })}
                    value={tier.price}
                    onChange={(e) => change((b) => ({ ...b, tiers: b.tiers.map((t, j) => (j === i ? { ...t, price: e.target.value } : t)) }))}
                    inputMode="decimal"
                    className={control}
                    disabled={!canWrite}
                  />
                </td>
                <td className="py-1">
                  {canWrite && block.tiers.length > 1 && (
                    <Button kind="quiet" size="dense" onClick={() => change((b) => ({ ...b, tiers: b.tiers.filter((_, j) => j !== i) }))}>
                      {w.remove}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(block.basis === "weight" || block.basis === "value") && canWrite && block.tiers.length < TIERS_MAX && (
        <div>
          <Button size="dense" onClick={() => change((b) => ({ ...b, tiers: [...b.tiers, { upTo: "", price: "" }] }))}>
            {w.addTier}
          </Button>
        </div>
      )}
      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-danger-text">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
