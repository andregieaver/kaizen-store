import { countWords, fillWords } from "@/lib/admin-fill";
import { shippingEn, type ShippingMessages } from "@/lib/admin-messages/shipping.en";
import { formatMoney } from "@/lib/money";
import type { MethodRate } from "@/lib/shipping-methods";
import { Button, ButtonLink, Card, Chip, List, ListRow, RowActions, RowFact, RowLead } from "@/components/admin/ui";

/**
 * One country's shipping methods (D237, `docs/wave-3-shipping-methods.md` 2.1): in the order shoppers see ties broken, each with what its rates
 * come to in a few words, whether it is offered, and buttons to move it. Presentational.
 */

export type MethodListItem = {
  id: string;
  name: string;
  active: boolean;
  estimate: { min: number; max: number } | null;
  freeOverMinor: number | null;
  rates: MethodRate[];
};

/** What a method's rates come to, in a few words: one flat price, or how many blocks and by what. */
export function ratesSummary(rates: readonly MethodRate[], currency: string, locale = "en-GB", words: ShippingMessages["methods"] = shippingEn.methods): string {
  if (rates.length === 0) return words.noRates;
  const groups = new Set(rates.map((r) => `${r.zoneId}|${r.profileId}`));
  if (groups.size === 1 && rates.length === 1 && rates[0].basis === "flat") return fillWords(words.flat, { amount: formatMoney(rates[0].amountMinor, currency, locale) });
  const bases = new Set(rates.map((r) => r.basis));
  const how = [bases.has("flat") ? words.byFlat : null, bases.has("weight") ? words.byWeight : null, bases.has("value") ? words.byValue : null].filter(Boolean).join(", ");
  return countWords(groups.size, words.blocks, { how });
}

export function MethodsListView({
  base,
  market,
  methods,
  canWrite,
  move,
  words: w = shippingEn.methods,
  locale = "en-GB",
}: {
  base: string;
  market: { code: string; name: string; currency: string };
  methods: MethodListItem[];
  canWrite: boolean;
  move: (id: string, direction: "up" | "down") => (form: FormData) => Promise<void>;
  /** The list's words and how amounts are written, in the admin's language (D312 A8); English unless given. */
  words?: ShippingMessages["methods"];
  locale?: string;
}) {
  const title = fillWords(w.title, { market: market.name });
  return (
    <Card
      title={title}
      count={methods.length}
      aside={canWrite ? <ButtonLink kind="main" href={`${base}/methods/new?market=${market.code}`}>{w.add}</ButtonLink> : null}
      description={fillWords(w.description, { currency: market.currency, market: market.name })}
    >
      {methods.length === 0 ? (
        <p className="text-sm text-muted">{fillWords(w.empty, { market: market.name })}</p>
      ) : (
        <List label={title}>
          {methods.map((m, i) => (
            <ListRow key={m.id}>
              <RowLead
                title={m.name}
                href={`${base}/methods/${m.id}`}
                sub={[
                  ratesSummary(m.rates, market.currency, locale, w),
                  m.estimate ? fillWords(w.days, { days: m.estimate.min === m.estimate.max ? m.estimate.min : `${m.estimate.min}–${m.estimate.max}` }) : null,
                  m.freeOverMinor ? fillWords(w.freeFrom, { amount: formatMoney(m.freeOverMinor, market.currency, locale) }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              {m.active ? <Chip signal="positive">{w.offered}</Chip> : <Chip>{w.off}</Chip>}
              <RowFact>{fillWords(w.position, { n: i + 1 })}</RowFact>
              {canWrite && methods.length > 1 && (
                <RowActions>
                  <form action={move(m.id, "up")}>
                    <Button type="submit" kind="quiet" size="dense" disabled={i === 0} aria-label={fillWords(w.moveUp, { name: m.name })}>
                      {w.up}
                    </Button>
                  </form>
                  <form action={move(m.id, "down")}>
                    <Button type="submit" kind="quiet" size="dense" disabled={i === methods.length - 1} aria-label={fillWords(w.moveDown, { name: m.name })}>
                      {w.down}
                    </Button>
                  </form>
                </RowActions>
              )}
            </ListRow>
          ))}
        </List>
      )}
    </Card>
  );
}
