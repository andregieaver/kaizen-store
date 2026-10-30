"use client";

import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { Button, Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { parsePercentBp } from "@/lib/bulk-edit";
import { ROUND_STEPS, stepMinor } from "@/lib/currency";
import type { MarketPriceRule, PriceBasis, PriceRuleActions, RulePreview } from "@/lib/market-prices";
import { formatMoney, minorUnitDigits } from "@/lib/money";
import { parsePrice } from "@/lib/product-input";

/**
 * Prices in each country (wave 7 unit A2, D335, `docs/wave-7-storefront.md` A.2): for every country but the first, its prices are typed by hand
 * (as ever) or worked out from another country's, with a percentage, the VAT basis in words, rounding and an ending; *Show five prices* asks the
 * server what five products would cost before anything is saved. Homer picks a country and saves; the rest is one row away.
 */

type Market = { code: string; name: string; currency: string };

type Props = PriceRuleActions & {
  markets: Market[];
  rules: MarketPriceRule[];
  locale: string;
  editable: boolean;
};

export function MarketPriceRules({ markets, rules, locale, editable, preview, save, remove }: Props) {
  const w = useAdminText("settings").priceRules;
  return (
    <Card title={w.title} description={w.intro}>
      <div className="flex flex-col divide-y divide-line">
        {markets.slice(1).map((market) => (
          <RuleRow
            key={market.code}
            market={market}
            markets={markets}
            rules={rules}
            locale={locale}
            editable={editable}
            preview={preview}
            save={save}
            remove={remove}
          />
        ))}
      </div>
    </Card>
  );
}

function RuleRow({ market, markets, rules, locale, editable, preview, save, remove }: Omit<Props, "markets"> & { market: Market; markets: Market[] }) {
  const w = useAdminText("settings").priceRules;
  const saved = rules.find((r) => r.market === market.code) ?? null;
  // A base is a country whose own prices are typed by hand (rules never chain), and never a country another takes its prices from.
  const bases = markets.filter((m) => m.code !== market.code && !rules.some((r) => r.market === m.code));
  const takenFrom = rules.some((r) => r.base === market.code);
  const [base, setBase] = useState(saved?.base ?? "");
  const [percent, setPercent] = useState(saved ? String(saved.percentBps / 100).replace(".", ",") : "0");
  const [basis, setBasis] = useState<PriceBasis>(saved?.basis ?? "net");
  const [round, setRound] = useState(saved?.roundToMinor ?? 1);
  const [ending, setEnding] = useState(saved?.endingMinor === null || saved?.endingMinor === undefined ? "" : String(saved.endingMinor / 10 ** fractionDigits(market.currency)));
  const [rows, setRows] = useState<RulePreview[] | null>(null);
  const [said, setSaid] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const baseMarket = markets.find((m) => m.code === base) ?? null;

  const typed = (): MarketPriceRule | null => {
    const bps = parsePercentBp(percent);
    const end = ending.trim() === "" ? null : parsePrice(ending, market.currency);
    if (!baseMarket || bps === null || (ending.trim() !== "" && end === null)) return null;
    return { market: market.code, base: baseMarket.code, percentBps: bps, basis, roundToMinor: round, endingMinor: end };
  };
  const money = (minor: number | null, currency: string) => (minor === null ? w.noPrice : formatMoney(minor, currency, locale));

  return (
    <div className="flex flex-col gap-3 py-4" data-testid={`price-rule-${market.code}`}>
      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="min-w-32 text-body-strong">{market.name}</span>
        <select
          value={base}
          disabled={!editable || takenFrom}
          onChange={(e) => {
            setBase(e.target.value);
            setRows(null);
            setSaid(null);
          }}
          aria-label={market.name}
          className="min-h-10 rounded-md border border-line bg-card px-3"
        >
          <option value="">{w.byHand}</option>
          {bases.map((m) => (
            <option key={m.code} value={m.code}>
              {fillWords(w.from, { country: m.name })}
            </option>
          ))}
        </select>
      </label>
      {base !== "" && (
        <div className="flex flex-col gap-3 pl-0 sm:pl-35">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-body-strong">{w.change}</span>
              <input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} disabled={!editable} className="min-h-10 rounded-md border border-line bg-card px-3" />
              <span className="text-caption text-muted">{w.changeHint}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-body-strong">{w.basis}</span>
              <select value={basis} onChange={(e) => setBasis(e.target.value === "gross" ? "gross" : "net")} disabled={!editable} className="min-h-10 rounded-md border border-line bg-card px-3">
                <option value="net">{w.net}</option>
                <option value="gross">{w.gross}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-body-strong">{w.rounding}</span>
              <select value={round} onChange={(e) => setRound(Number(e.target.value))} disabled={!editable} className="min-h-10 rounded-md border border-line bg-card px-3">
                {[...new Set(ROUND_STEPS.map((step) => stepMinor(market.currency, step)))].map((minor) => (
                  <option key={minor} value={minor}>
                    {minor === 1 ? w.roundingNone : formatMoney(minor, market.currency, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-body-strong">{w.ending}</span>
              <input inputMode="decimal" value={ending} onChange={(e) => setEnding(e.target.value)} disabled={!editable || round === 1} className="min-h-10 rounded-md border border-line bg-card px-3" />
              <span className="text-caption text-muted">{w.endingHint}</span>
            </label>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="dense"
                disabled={pending}
                onClick={() => {
                  const rule = typed();
                  if (!rule) return setSaid({ tone: "problem", text: w.unreadable });
                  start(async () => {
                    const answer = await preview(rule);
                    if ("problem" in answer) setSaid({ tone: "problem", text: answer.problem });
                    else {
                      setRows(answer);
                      setSaid(null);
                    }
                  });
                }}
              >
                {w.preview}
              </Button>
              <Button
                kind="main"
                size="dense"
                disabled={pending}
                onClick={() => {
                  const rule = typed();
                  if (!rule) return setSaid({ tone: "problem", text: w.unreadable });
                  start(async () => {
                    const answer = await save(rule);
                    setSaid(answer.ok ? { tone: "ok", text: answer.message } : { tone: "problem", text: answer.problem });
                  });
                }}
              >
                {w.save}
              </Button>
              {saved && (
                <Button
                  size="dense"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const answer = await remove(market.code);
                      setBase("");
                      setRows(null);
                      setSaid(answer.ok ? { tone: "ok", text: answer.message } : { tone: "problem", text: answer.problem });
                    })
                  }
                >
                  {w.remove}
                </Button>
              )}
            </div>
          )}
          {rows && baseMarket && (
            <table className="w-full max-w-2xl text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-1 pr-3 font-normal text-muted">{w.product}</th>
                  <th scope="col" className="py-1 pr-3 font-normal text-muted">{fillWords(w.basePrice, { country: baseMarket.name })}</th>
                  <th scope="col" className="py-1 pr-3 font-normal text-muted">{w.now}</th>
                  <th scope="col" className="py-1 font-normal text-muted">{w.after}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.variantId} className="border-b border-line">
                    <td className="py-1 pr-3">{row.title} <span className="text-muted">{row.sku}</span></td>
                    <td className="py-1 pr-3">{money(row.base, baseMarket.currency)}</td>
                    <td className="py-1 pr-3">{money(row.before, market.currency)}</td>
                    <td className="py-1">{row.after === row.before && row.before !== null ? `${money(row.after, market.currency)} · ${w.fixed}` : money(row.after, market.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div role="status" aria-live="polite" className={said?.tone === "problem" ? "text-sm text-danger-text" : "text-sm text-muted"}>
        {said?.text ?? ""}
      </div>
    </div>
  );
}

/** The currency's stored decimals, for showing a stored ending (minor units) in major units. */
const fractionDigits = (currency: string): number => minorUnitDigits(currency);
