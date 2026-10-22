import { describe, expect, it } from "vitest";

import { ordersEn } from "./admin-messages/orders.en";
import { ordersNb } from "./admin-messages/orders.nb";
import { bulkSummary, groupRefusals, type BulkRefusal } from "./order-bulk";
import { DEFAULT_ORDER_LIST, describeFilters, type OrderListParams } from "./order-list";
import { matchingText } from "./order-list-admin";
import { shipWords } from "./order-list-row";
import { appliedWords, filterChips, matchingWords, refusalGroups, shipCellWords } from "./order-list-words";

const busy: OrderListParams = {
  ...DEFAULT_ORDER_LIST,
  q: "linen",
  pay: ["partially_refunded", "disputed"],
  ship: ["to_send"],
  status: ["paid"],
  tag: ["vip"],
  range: "30d",
  market: "no",
  source: "draft",
  gift: true,
  archived: "all",
};

const refused: BulkRefusal[] = [
  { id: "a", number: "1001", reason: "unpaid" },
  { id: "b", number: null, reason: "not_found" },
  { id: "c", number: "1003", reason: "unpaid" },
];

describe("the Orders list's words (D312 A4)", () => {
  it("say in English exactly what the libraries say", () => {
    expect(filterChips(busy)).toEqual(describeFilters(busy));
    expect(filterChips({ ...DEFAULT_ORDER_LIST, from: "2026-01-01", archived: "yes" })).toEqual(describeFilters({ ...DEFAULT_ORDER_LIST, from: "2026-01-01", archived: "yes" }));
    for (const [count, capped] of [[0, false], [1, false], [37, false], [12_000, false], [10_001, true]] as const) {
      expect(matchingWords(count, capped)).toBe(matchingText(count, capped));
    }
    expect(appliedWords({ requested: 43, applied: 41 })).toBe(bulkSummary({ requested: 43, applied: 41 }));
    expect(appliedWords({ requested: 1, applied: 1 })).toBe(bulkSummary({ requested: 1, applied: 1 }));
    expect(refusalGroups(refused)).toEqual(groupRefusals(refused));
    for (const item of [
      { ship: "to_send", delivery: { method: "pickup", ready: true } },
      { ship: "sent", delivery: { method: "pickup" } },
      { ship: "partly_sent", delivery: { method: "local" } },
      { ship: "waiting" },
    ] as Parameters<typeof shipWords>[0][]) {
      expect(shipCellWords(item)).toBe(shipWords(item));
    }
  });

  it("are written in Norwegian from the catalogue", () => {
    expect(filterChips(busy, ordersNb.filters).map((c) => c.label)).toEqual([
      "Søk: linen",
      "Betaling: Delvis tilbakebetalt, Tvist om betalingen",
      "Forsendelse: Skal sendes",
      "Status: Betalt, ikke sendt",
      "Merket med: vip",
      "Lagt inn: siste 30 dager",
      "Marked: no",
      "Kilde: Laget av ansatte",
      "Gaver",
      "Medregnet arkiverte",
    ]);
    expect(matchingWords(1, false, ordersNb.list, "nb-NO")).toBe("1 bestilling");
    expect(matchingWords(12_000, false, ordersNb.list, "nb-NO")).toBe(`${(12_000).toLocaleString("nb-NO")} bestillinger`);
    expect(appliedWords({ requested: 43, applied: 41 }, ordersNb.bulk)).toBe("Gjort for 41 av 43 bestillinger");
    expect(refusalGroups(refused, ordersNb.bulk).map((g) => g.text)).toEqual(["Den er ikke betalt.", "Den ble ikke funnet."]);
    expect(shipCellWords({ ship: "to_send", delivery: { method: "pickup", ready: true } } as Parameters<typeof shipWords>[0], ordersNb.table)).toBe("Klar til henting");
  });

  it("have a Norwegian word for every English one, none left empty", () => {
    const leaves = (value: unknown, path = ""): [string, string][] =>
      typeof value === "string" ? [[path, value]] : Object.entries(value as object).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
    const nb = leaves(ordersNb);
    expect(nb.map(([p]) => p).sort()).toEqual(leaves(ordersEn).map(([p]) => p).sort());
    expect(nb.filter(([, v]) => v.trim() === "")).toEqual([]);
  });
});
