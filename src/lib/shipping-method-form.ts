import { fillWords } from "./admin-fill";
import { shippingEn, type ShippingMessages } from "./admin-messages/shipping.en";
import { minorUnitDigits } from "./money";
import { TIERS_MAX } from "./shipping-limits";
import { tierProblems, type MethodRate, type RateBasis, type TierProblem, type TierRow } from "./shipping-methods";

/**
 * The method page's rate grid as the owner types it, and the rows it saves (D237, `docs/wave-3-shipping-methods.md` 2.1). A block is one zone and
 * one profile: *Not offered*, a flat price, or tiers by weight or by basket value. A tier is written as *up to* and its price; its *from* is the
 * tier before's *up to* (the first starts at 0), so a ladder typed here never has a gap; only the last tier may be open (*and above*). Weights are
 * typed in kilograms (up to three decimals) and kept in grams; amounts are typed in the market's own currency and kept in minor units. Pure: the
 * editor (a client component) and its tests read it, the server checks the result again (`methodInput`, the database's trigger).
 */

export type BlockBasis = "none" | RateBasis;

export type TierDraft = { upTo: string; price: string };

export type BlockDraft = {
  zoneId: string | null;
  profileId: string | null;
  basis: BlockBasis;
  /** The flat price, as typed. */
  flat: string;
  tiers: TierDraft[];
};

export type GroupOut = { zoneId: string | null; profileId: string | null; tiers: TierRow[] };

/** A number of minor units as the owner types it (`1234,50` for 123450 øre), with a comma as the decimal mark. */
export function typedAmount(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  if (digits === 0) return String(minor);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** digits);
  const part = abs % 10 ** digits;
  return part === 0 ? `${sign}${whole}` : `${sign}${whole},${String(part).padStart(digits, "0")}`;
}

/** Minor units from a typed amount (`99`, `99,50`, `1 299.5`), or null when it is not one. */
export function minorOf(typed: string, currency: string): number | null {
  const text = typed.replace(/[\s ]/g, "").replace(",", ".");
  const digits = minorUnitDigits(currency);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`);
  if (!pattern.test(text)) return null;
  const [whole, part = ""] = text.split(".");
  const minor = Number(whole) * 10 ** digits + Number(part.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Kilograms typed (`2`, `0,5`, `1.25`) to grams, or null. */
export function gramsOf(typed: string): number | null {
  const text = typed.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  const grams = Math.round(Number(text) * 1000);
  return Number.isSafeInteger(grams) ? grams : null;
}

/** Grams as kilograms to type (`1500` → `1,5`). */
export function typedKilograms(grams: number): string {
  const kg = grams / 1000;
  return String(Number(kg.toFixed(3))).replace(".", ",");
}

const bound = (basis: RateBasis, value: number, currency: string) => (basis === "weight" ? typedKilograms(value) : typedAmount(value, currency));

/**
 * The grid's blocks from a method's saved rates: Rest of country (null) first, then each zone; inside each, General first, then each profile.
 * A block with no rows is *Not offered*.
 */
export function blocksFromRates(rates: readonly MethodRate[], zoneIds: readonly string[], profileIds: readonly string[], currency: string): BlockDraft[] {
  const blocks: BlockDraft[] = [];
  for (const zoneId of [null, ...zoneIds]) {
    for (const profileId of [null, ...profileIds]) {
      const rows = rates.filter((r) => r.zoneId === zoneId && r.profileId === profileId).sort((a, b) => a.minValue - b.minValue);
      if (rows.length === 0) {
        blocks.push({ zoneId, profileId, basis: "none", flat: "", tiers: [] });
      } else if (rows[0].basis === "flat") {
        blocks.push({ zoneId, profileId, basis: "flat", flat: typedAmount(rows[0].amountMinor, currency), tiers: [] });
      } else {
        const basis = rows[0].basis;
        blocks.push({
          zoneId,
          profileId,
          basis,
          flat: "",
          tiers: rows.map((r) => ({ upTo: r.maxValue === null ? "" : bound(basis, r.maxValue, currency), price: typedAmount(r.amountMinor, currency) })),
        });
      }
    }
  }
  return blocks;
}

/** A block's tier *from* values as the editor shows them (the first 0, then each tier before's *up to*), typed. */
export function tierStarts(block: Pick<BlockDraft, "tiers" | "basis">): string[] {
  return block.tiers.map((_, i) => (i === 0 ? "0" : block.tiers[i - 1].upTo || "…"));
}

export type BlockProblem = { block: number; message: string };

/** The words of a block's problems and of a block not offered (D312 A8): the admin's `shipping` catalogue's, English unless given. */
export type MethodFormWords = Pick<ShippingMessages["method"], "problems" | "notOffered">;

/**
 * What the grid saves: one group per block that is offered (a block *Not offered* sends no rows, and the save replaces every group of the method),
 * with what is wrong with each block in words. Nothing is saved while any block has a problem.
 */
export function groupsFromBlocks(blocks: readonly BlockDraft[], currency: string, words: MethodFormWords = shippingEn.method): { groups: GroupOut[]; problems: BlockProblem[] } {
  const w = words.problems;
  const tierWords = (problem: TierProblem) => (problem === "too_many" ? fillWords(w.too_many, { max: TIERS_MAX }) : w[problem]);
  const groups: GroupOut[] = [];
  const problems: BlockProblem[] = [];
  blocks.forEach((block, index) => {
    if (block.basis === "none") return;
    if (block.basis === "flat") {
      const amount = minorOf(block.flat, currency);
      if (amount === null) problems.push({ block: index, message: fillWords(w.enterPrice, { currency }) });
      else groups.push({ zoneId: block.zoneId, profileId: block.profileId, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor: amount }] });
      return;
    }
    if (block.tiers.length === 0) {
      problems.push({ block: index, message: w.addTier });
      return;
    }
    const tiers: TierRow[] = [];
    let from = 0;
    let broken = false;
    block.tiers.forEach((tier, i) => {
      const last = i === block.tiers.length - 1;
      const upTo = tier.upTo.trim() === "" ? null : block.basis === "weight" ? gramsOf(tier.upTo) : minorOf(tier.upTo, currency);
      const price = minorOf(tier.price, currency);
      if (tier.upTo.trim() !== "" && upTo === null) {
        problems.push({ block: index, message: block.basis === "weight" ? fillWords(w.upToKg, { n: i + 1 }) : fillWords(w.upToMoney, { n: i + 1, currency }) });
        broken = true;
      }
      if (price === null) {
        problems.push({ block: index, message: fillWords(w.tierPrice, { n: i + 1, currency }) });
        broken = true;
      }
      if (upTo === null && !last && tier.upTo.trim() === "") {
        problems.push({ block: index, message: w.overlap });
        broken = true;
      }
      tiers.push({ basis: block.basis as RateBasis, minValue: from, maxValue: upTo, amountMinor: price ?? 0 });
      if (upTo !== null) from = upTo;
    });
    if (broken) return;
    const found = tierProblems(tiers);
    if (found.length > 0) {
      for (const problem of found) problems.push({ block: index, message: tierWords(problem) });
      return;
    }
    groups.push({ zoneId: block.zoneId, profileId: block.profileId, tiers });
  });
  return { groups, problems };
}

/** The sentence beside a block left *Not offered*: what the shopper's basket meets. */
export function notOfferedWords(zoneName: string, profileName: string, words: MethodFormWords = shippingEn.method): string {
  return fillWords(words.notOffered, { profile: profileName, zone: zoneName });
}
