"use client";

import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { REWARDS_MAX, type BonusReward, type RewardKind } from "@/lib/bonus-rewards";
import { formatPriceInput, parsePrice } from "@/lib/product-input";

import { Button, Card, Chip, List, ListRow, RowActions, RowLead } from "./ui";

const FIELD = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";

type Draft = { id: string | null; name: string; cost: string; kind: RewardKind; productId: string; amounts: Record<string, string>; active: boolean };
type Choice = { id: string; title: string };
type MarketChoice = { code: string; currency: string; name: string };

const blank: Draft = { id: null, name: "", cost: "", kind: "free_shipping", productId: "", amounts: {}, active: true };

/**
 * The store's loyalty rewards (D401) on the Bonus page: what a signed-in customer may spend credits on besides a price reduction. Homer adds a
 * reward with a name, a cost and what it gives; each is a code of the store's own, so a customer's code takes off what the reward says.
 */
export function BonusRewardsCard({
  rewards,
  currency,
  products,
  markets,
  canEdit,
  save,
  toggle,
  locale,
}: {
  rewards: BonusReward[];
  currency: string;
  products: Choice[];
  markets: MarketChoice[];
  canEdit: boolean;
  save: (id: string | null, raw: unknown) => Promise<{ ok: true; id: string } | { ok: false; problems: string[] }>;
  toggle: (id: string, active: boolean) => Promise<boolean>;
  locale: string;
}) {
  const w = useAdminText("loyalty").rewards;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  const kindLine = (r: BonusReward) =>
    r.kind === "free_shipping"
      ? w.kinds.free_shipping
      : r.kind === "product"
        ? fillWords(w.productLine, { product: products.find((p) => p.id === r.productId)?.title ?? "—" })
        : w.kinds.amount;

  const edit = (r: BonusReward) =>
    setDraft({
      id: r.id,
      name: r.name,
      cost: formatPriceInput(r.costMinor, currency),
      kind: r.kind,
      productId: r.productId ?? "",
      amounts: Object.fromEntries(Object.entries(r.amounts).map(([code, minor]) => [code, formatPriceInput(minor, markets.find((m) => m.code === code)?.currency ?? currency)])),
      active: r.active,
    });

  const submit = () => {
    if (!draft) return;
    const costMinor = parsePrice(draft.cost, currency);
    const amounts: Record<string, number> = {};
    for (const m of markets) {
      const text = draft.amounts[m.code]?.trim();
      if (!text) continue;
      const minor = parsePrice(text, m.currency);
      if (minor === null) return setProblems([fillWords(w.amountProblem, { currency: m.currency })]);
      amounts[m.code] = minor;
    }
    if (costMinor === null) return setProblems([fillWords(w.costProblem, { currency })]);
    start(async () => {
      const saved = await save(draft.id, {
        name: draft.name,
        costMinor,
        kind: draft.kind,
        productId: draft.kind === "product" ? draft.productId || null : null,
        amounts: draft.kind === "amount" ? amounts : {},
        active: draft.active,
      });
      if (saved.ok) {
        setDraft(null);
        setProblems([]);
      } else setProblems(saved.problems);
    });
  };

  return (
    <Card
      title={w.title}
      description={w.description}
      aside={
        canEdit && !draft && rewards.length < REWARDS_MAX ? (
          <Button type="button" kind="strong" onClick={() => setDraft(blank)}>
            {w.add}
          </Button>
        ) : null
      }
    >
      {rewards.length === 0 && !draft && <p className="text-sm text-muted">{w.none}</p>}
      {rewards.length > 0 && (
        <List>
          {rewards.map((r) => (
            <ListRow key={r.id}>
              <RowLead title={r.name} sub={`${fillWords(w.costs, { amount: money(r.costMinor) })} · ${kindLine(r)}`} />
              <Chip signal={r.active ? "positive" : "neutral"}>{r.active ? w.on : w.off}</Chip>
              {canEdit && (
                <RowActions>
                  <Button type="button" kind="quiet" onClick={() => edit(r)}>
                    {w.edit}
                  </Button>
                  <Button type="button" kind="quiet" disabled={pending} onClick={() => start(async () => void (await toggle(r.id, !r.active)))}>
                    {r.active ? w.switchOff : w.switchOn}
                  </Button>
                </RowActions>
              )}
            </ListRow>
          ))}
        </List>
      )}
      {draft && (
        <form
          className="mt-4 flex flex-col gap-3"
          aria-busy={pending}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {w.name}
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={FIELD} maxLength={80} required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {fillWords(w.cost, { currency })}
            <input value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} className={FIELD} inputMode="decimal" required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {w.gives}
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as RewardKind })} className={FIELD}>
              <option value="free_shipping">{w.kinds.free_shipping}</option>
              <option value="product">{w.kinds.product}</option>
              <option value="amount">{w.kinds.amount}</option>
            </select>
          </label>
          {draft.kind === "product" && (
            <label className="flex flex-col gap-1 text-sm">
              {w.product}
              <select value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })} className={FIELD} required>
                <option value="">{w.choose}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.kind === "amount" &&
            markets.map((m) => (
              <label key={m.code} className="flex flex-col gap-1 text-sm">
                {fillWords(w.amountIn, { country: m.name, currency: m.currency })}
                <input
                  value={draft.amounts[m.code] ?? ""}
                  onChange={(e) => setDraft({ ...draft, amounts: { ...draft.amounts, [m.code]: e.target.value } })}
                  className={FIELD}
                  inputMode="decimal"
                />
              </label>
            ))}
          <p className="text-sm text-muted">{w.hint}</p>
          {problems.length > 0 && (
            <ul className="text-sm text-danger-text" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button type="submit" kind="strong" disabled={pending}>
              {pending ? w.saving : w.save}
            </Button>
            <Button type="button" kind="quiet" onClick={() => (setDraft(null), setProblems([]))}>
              {w.cancel}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
