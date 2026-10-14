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
export function ratesSummary(rates: readonly MethodRate[], currency: string, locale = "en-GB"): string {
  if (rates.length === 0) return "No rates yet: not offered";
  const groups = new Set(rates.map((r) => `${r.zoneId}|${r.profileId}`));
  if (groups.size === 1 && rates.length === 1 && rates[0].basis === "flat") return `${formatMoney(rates[0].amountMinor, currency, locale)} flat`;
  const bases = new Set(rates.map((r) => r.basis));
  const how = [bases.has("flat") ? "flat" : null, bases.has("weight") ? "by weight" : null, bases.has("value") ? "by basket value" : null].filter(Boolean).join(", ");
  return `${groups.size} ${groups.size === 1 ? "rate block" : "rate blocks"}, ${how}`;
}

export function MethodsListView({
  base,
  market,
  methods,
  canWrite,
  move,
}: {
  base: string;
  market: { code: string; name: string; currency: string };
  methods: MethodListItem[];
  canWrite: boolean;
  move: (id: string, direction: "up" | "down") => (form: FormData) => Promise<void>;
}) {
  return (
    <Card
      title={`Methods in ${market.name}`}
      count={methods.length}
      aside={canWrite ? <ButtonLink kind="main" href={`${base}/methods/new?market=${market.code}`}>Add a method</ButtonLink> : null}
      description={`Amounts in ${market.currency}, including VAT. With no method offered, ${market.name} is charged the flat rate.`}
    >
      {methods.length === 0 ? (
        <p className="text-sm text-muted">No methods in {market.name} yet: baskets there pay the flat rate.</p>
      ) : (
        <List label={`Methods in ${market.name}`}>
          {methods.map((m, i) => (
            <ListRow key={m.id}>
              <RowLead
                title={m.name}
                href={`${base}/methods/${m.id}`}
                sub={[
                  ratesSummary(m.rates, market.currency),
                  m.estimate ? `${m.estimate.min === m.estimate.max ? m.estimate.min : `${m.estimate.min}–${m.estimate.max}`} days` : null,
                  m.freeOverMinor ? `free from ${formatMoney(m.freeOverMinor, market.currency, "en-GB")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              {m.active ? <Chip signal="positive">Offered</Chip> : <Chip>Off</Chip>}
              <RowFact>Position {i + 1}</RowFact>
              {canWrite && methods.length > 1 && (
                <RowActions>
                  <form action={move(m.id, "up")}>
                    <Button type="submit" kind="quiet" size="dense" disabled={i === 0} aria-label={`Move ${m.name} up`}>
                      Up
                    </Button>
                  </form>
                  <form action={move(m.id, "down")}>
                    <Button type="submit" kind="quiet" size="dense" disabled={i === methods.length - 1} aria-label={`Move ${m.name} down`}>
                      Down
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
