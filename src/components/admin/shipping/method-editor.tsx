"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

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

const BASES: { value: BlockBasis; label: string }[] = [
  { value: "none", label: "Not offered" },
  { value: "flat", label: "Flat" },
  { value: "weight", label: "By weight" },
  { value: "value", label: "By basket value" },
];

const control = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm";

export function MethodEditor({ base, market, zones, profiles, method, canWrite, save }: MethodEditorProps) {
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

  const zoneName = (id: string | null) => (id === null ? "Rest of country" : zones.find((z) => z.id === id)?.name ?? "A zone");
  const profileName = (id: string | null) => (id === null ? "General" : profiles.find((p) => p.id === id)?.name ?? "A profile");
  const change = (index: number, next: (block: BlockDraft) => BlockDraft) => setBlocks((all) => all.map((b, i) => (i === index ? next(b) : b)));
  const problems = tried ? groupsFromBlocks(blocks, currency).problems : [];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    const found: string[] = [];
    const { groups, problems: blockProblems } = groupsFromBlocks(blocks, currency);
    for (const p of blockProblems) found.push(`${zoneName(blocks[p.block].zoneId)}, ${profileName(blocks[p.block].profileId)}: ${p.message}`);
    const free = freeOver.trim() ? minorOf(freeOver, currency) : null;
    if (freeOver.trim() && (free === null || free <= 0)) found.push(`Free above: an amount in ${currency} above zero, or leave it empty.`);
    const hasEstimate = estimateMin.trim() !== "" || estimateMax.trim() !== "";
    const min = Number(estimateMin || estimateMax);
    const max = Number(estimateMax || estimateMin);
    if (hasEstimate && (!/^\d*$/.test(estimateMin) || !/^\d*$/.test(estimateMax) || min > max || max > ESTIMATE_DAYS_MAX)) {
      found.push(`Transit time: whole days from 0 to ${ESTIMATE_DAYS_MAX}, the first at most the second.`);
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
        <h2 id="method-details" className="text-title text-ink">The method</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Name, as shoppers see it
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={NAME_MAX} placeholder="Standard" className={control} disabled={!canWrite} />
          </label>
          <label className={label}>
            Free above (basket value, {currency})
            <input value={freeOver} onChange={(e) => setFreeOver(e.target.value)} inputMode="decimal" placeholder="Never free" className={control} disabled={!canWrite} />
          </label>
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1">Transit time, in days (optional)</legend>
            <div className="flex items-center gap-2">
              <input aria-label="Transit time from, days" value={estimateMin} onChange={(e) => setEstimateMin(e.target.value)} inputMode="numeric" className={`${control} max-w-24`} disabled={!canWrite} />
              <span aria-hidden>–</span>
              <input aria-label="Transit time to, days" value={estimateMax} onChange={(e) => setEstimateMax(e.target.value)} inputMode="numeric" className={`${control} max-w-24`} disabled={!canWrite} />
              <span className="text-muted">days</span>
            </div>
          </fieldset>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={!canWrite} />
            Offered at checkout
          </label>
        </div>
        <p className="text-sm text-muted">
          Shoppers in {market.name} see the methods that price their basket, cheapest first; the free-above value is the basket&apos;s value as shown, before
          discounts. Translations of the name are written on the store&apos;s Translate page.
        </p>
      </section>

      <section aria-labelledby="method-rates" className={`flex flex-col gap-4 p-6 ${CARD_CLASS}`}>
        <div>
          <h2 id="method-rates" className="text-title text-ink">Rates</h2>
          <p className="mt-1 max-w-[75ch] text-sm text-muted">
            One block for each zone and profile. A tier counts from its <em>from</em> up to, but not including, its <em>up to</em>; leave the last tier&apos;s
            up to empty for <em>and above</em>. A basket with products of several profiles is offered this method only when each profile has a rate here, and
            pays their sum. Amounts include VAT, in {currency}.
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
                  notOffered={notOfferedWords(zoneName(zoneId), profileName(block.profileId))}
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
            {pending ? "Saving …" : method ? "Save method" : "Add method"}
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
  const unit = block.basis === "weight" ? "kg" : currency;
  const starts = tierStarts(block);
  const setBasis = (basis: BlockBasis) =>
    change((b) => ({ ...b, basis, tiers: basis === "weight" || basis === "value" ? (b.basis === basis ? b.tiers : [{ upTo: "", price: "" }]) : [] }));
  return (
    <div className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`} data-block={index}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-body-strong text-ink">{title}</h3>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Price</span>
          <select value={block.basis} onChange={(e) => setBasis(e.target.value as BlockBasis)} className="min-h-9 rounded-md border border-line bg-card px-2 text-sm" disabled={!canWrite} aria-label={`How ${title} is priced`}>
            {BASES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {block.basis === "none" && <p className="text-sm text-muted">{notOffered}</p>}
      {block.basis === "flat" && (
        <label className="flex max-w-xs flex-col gap-1 text-sm">
          Price ({currency})
          <input value={block.flat} onChange={(e) => change((b) => ({ ...b, flat: e.target.value }))} inputMode="decimal" className={control} disabled={!canWrite} />
        </label>
      )}
      {(block.basis === "weight" || block.basis === "value") && (
        <table className="w-full max-w-2xl text-left text-sm">
          <caption className="sr-only">
            Tiers {block.basis === "weight" ? "by weight" : "by basket value"} for {title}
          </caption>
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1 pr-3 font-normal">From ({unit})</th>
              <th scope="col" className="py-1 pr-3 font-normal">Up to ({unit})</th>
              <th scope="col" className="py-1 pr-3 font-normal">Price ({currency})</th>
              <th scope="col" className="py-1">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {block.tiers.map((tier, i) => (
              <tr key={i}>
                <td className="py-1 pr-3 tabular-nums text-muted">{starts[i]}</td>
                <td className="py-1 pr-3">
                  <input
                    aria-label={`Tier ${i + 1} up to, ${unit}`}
                    value={tier.upTo}
                    placeholder={i === block.tiers.length - 1 ? "and above" : ""}
                    onChange={(e) => change((b) => ({ ...b, tiers: b.tiers.map((t, j) => (j === i ? { ...t, upTo: e.target.value } : t)) }))}
                    inputMode="decimal"
                    className={control}
                    disabled={!canWrite}
                  />
                </td>
                <td className="py-1 pr-3">
                  <input
                    aria-label={`Tier ${i + 1} price, ${currency}`}
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
                      Remove
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
            Add a tier
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
