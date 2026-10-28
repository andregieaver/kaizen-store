/**
 * What a store owes its customers and how it moved over a period (wave 11 unit B, D381): bonus credit and gift cards, each a roll-forward from
 * the ledger's sum before the period's first instant to its sum at the end, the movements in between by kind. Pure: the sums come from the
 * ledgers (`src/server/liabilities.ts`), never from a balance worked out here. A roll-forward that does not add up says so (`addsUp` false); it
 * never makes a figure fit.
 */

export type RollForwardLine = { key: string; amountMinor: number };

export type RollForward = {
  currency: string;
  openingMinor: number;
  /** Each kind's movement in the period, signed as the ledger holds it (money owed going up is positive). */
  movements: RollForwardLine[];
  closingMinor: number;
  /** Opening plus the movements is the closing, to the minor unit. */
  addsUp: boolean;
  /** What the opening and movements come to, for the line that says by how much it does not add up. */
  expectedClosingMinor: number;
};

/** The bonus ledger's kinds in the order the roll-forward lists them. */
export const BONUS_ROLL_KINDS = ["earn", "referral", "redeem", "restore", "reverse", "expire", "adjust"] as const;
export type BonusRollKind = (typeof BONUS_ROLL_KINDS)[number];

/** The gift card ledger's kinds that move what customers hold (a hold and its release net to nothing and are left out). */
export const GIFT_CARD_ROLL_KINDS = ["issue", "spend", "refund", "adjust", "expire", "void"] as const;
export type GiftCardRollKind = (typeof GIFT_CARD_ROLL_KINDS)[number];

/**
 * A roll-forward from the ledger's own sums: `opening` and `closing` are the ledger's sums before the period and at its end, `moved` each kind's
 * sum within it. Kinds not in `order` are kept, at the end, so a new kind shows rather than vanishing into a gap.
 */
export function rollForward(
  currency: string,
  openingMinor: number,
  moved: readonly { kind: string; amountMinor: number }[],
  closingMinor: number,
  order: readonly string[],
): RollForward {
  const byKind = new Map<string, number>();
  for (const m of moved) byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + m.amountMinor);
  const known = order.filter((k) => byKind.has(k));
  const others = [...byKind.keys()].filter((k) => !order.includes(k)).sort();
  const movements = [...known, ...others].map((key) => ({ key, amountMinor: byKind.get(key) ?? 0 }));
  const expectedClosingMinor = openingMinor + movements.reduce((sum, m) => sum + m.amountMinor, 0);
  return { currency, openingMinor, movements, closingMinor, addsUp: expectedClosingMinor === closingMinor, expectedClosingMinor };
}

/** The roll-forward's columns, the same for both ledgers so one table holds them. */
export const LIABILITY_COLUMNS = ["granted", "used", "returned", "takenBack", "expired", "changed", "other"] as const;
export type LiabilityColumn = (typeof LIABILITY_COLUMNS)[number];
export type Ledger = "bonus" | "gift_cards";

/** Which column each ledger's kind is: what grants, what customers use, what comes back to them, what is taken back, what expires, staff's changes. */
export const COLUMN_OF: Record<Ledger, Record<string, LiabilityColumn>> = {
  bonus: { earn: "granted", referral: "granted", redeem: "used", restore: "returned", reverse: "takenBack", expire: "expired", adjust: "changed" },
  gift_cards: { issue: "granted", spend: "used", held: "used", refund: "returned", void: "takenBack", expire: "expired", adjust: "changed" },
};

export type LiabilityRow = {
  ledger: Ledger;
  currency: string;
  openingMinor: number;
  columns: Record<LiabilityColumn, number>;
  closingMinor: number;
  addsUp: boolean;
  /** By how much opening plus the movements misses the closing; 0 when it adds up. */
  differenceMinor: number;
  /** What customers hold now as the ledger's own reader says (bonus: `bonus_balance()`; gift cards: delivered, live cards); null when not read. */
  owedNowMinor: number | null;
  /** What is owed now in the store's main currency, for display only, when the ledger's currency is another (null minor: no rate); else null. */
  owedNowMain: { currency: string; minor: number | null } | null;
};

/** One row of the table from a roll-forward: each movement in its column, a kind not mapped in `other`. */
export function liabilityRow(
  ledger: Ledger,
  roll: RollForward,
  owedNowMinor: number | null,
  owedNowMain: LiabilityRow["owedNowMain"] = null,
): LiabilityRow {
  const columns = Object.fromEntries(LIABILITY_COLUMNS.map((c) => [c, 0])) as Record<LiabilityColumn, number>;
  for (const m of roll.movements) columns[COLUMN_OF[ledger][m.key] ?? "other"] += m.amountMinor;
  return {
    ledger,
    currency: roll.currency,
    openingMinor: roll.openingMinor,
    columns,
    closingMinor: roll.closingMinor,
    addsUp: roll.addsUp,
    differenceMinor: roll.closingMinor - roll.expectedClosingMinor,
    owedNowMinor,
    owedNowMain,
  };
}
