import { describe, expect, it } from "vitest";

import { formatBytes, momentText, rowsPhrase } from "./data-admin";
import { inventoryEn } from "./admin-messages/inventory.en";
import { inventoryNb } from "./admin-messages/inventory.nb";
import { forbiddenUses } from "./i18n-glossary";
import { ADJUST_PROBLEM_WORDS, MOVEMENT_REASONS, byWords, deactivationWords, reasonWord } from "./inventory";
import { FIGURE_HINT, deltaText, figureText, heldWords, policyCell, savedWords } from "./inventory-admin";
import { STOCK_MAX } from "./inventory";
import { fillWords } from "./admin-fill";
import { adjustProblemsIn, byIn, bytesIn, deactivationIn, deltaIn, figureIn, heldIn, momentIn, policyIn, reasonIn, rowsIn, savedIn } from "./inventory-words";

const EN = "en-GB";
const NB = "nb-NO";

describe("the Inventory pages' words in English", () => {
  it("say exactly what the libraries say", () => {
    for (const n of [0, 1, -1, 12, 1234, -98765, 1_000_000]) {
      expect(figureIn(n, EN)).toBe(figureText(n));
      expect(deltaIn(n, EN)).toBe(deltaText(n));
    }
    for (const days of [null, 1, 7]) {
      expect(policyIn("continue", days, inventoryEn)).toBe(policyCell("continue", days));
      expect(policyIn("deny", days, inventoryEn)).toBe(policyCell("deny", days));
    }
    expect(adjustProblemsIn(inventoryEn, EN)).toEqual(ADJUST_PROBLEM_WORDS);
    for (const c of [
      { written: 1, unchanged: 0, conflicts: 0, refused: 0, failed: 0 },
      { written: 0, unchanged: 2, conflicts: 1, refused: 3, failed: 1 },
      { written: 1500, unchanged: 1, conflicts: 2, refused: 0, failed: 0 },
    ]) {
      expect(savedIn(c, inventoryEn, EN)).toBe(savedWords(c));
    }
    for (const [u, v] of [[1, 1], [12, 3], [2500, 1]] as const) expect(heldIn(u, v, inventoryEn, EN)).toBe(heldWords(u, v));
    for (const impact of [
      { units: 1, variants: 1, committedUnits: 0 },
      { units: 2400, variants: 3, committedUnits: 1 },
      { units: 5, variants: 2, committedUnits: 4 },
    ]) {
      expect(deactivationIn(impact, inventoryEn, EN)).toEqual(deactivationWords(impact));
    }
    for (const r of [...MOVEMENT_REASONS, "unknown"]) expect(reasonIn(r, inventoryEn)).toBe(reasonWord(r));
    for (const m of [
      { source: "staff", actorName: "Kari" },
      { source: "staff", actorName: " " },
      { source: "file", actorName: "Kari" },
      { source: "file" },
      { source: "checkout" },
      { source: "ai_manager" },
      { source: "copy" },
      { source: "system" },
      { source: "order", orderNumber: "1001" },
      { source: "order", orderNumber: "1001", returnNumber: "R-2" },
    ]) {
      expect(byIn(m, inventoryEn)).toBe(byWords(m));
    }
    expect(momentIn("2026-10-05T10:00:00Z", "Europe/Oslo", EN)).toBe(momentText("2026-10-05T10:00:00Z", "Europe/Oslo"));
    for (const rows of [[], [3], [4, 3, 9], [1, 2, 3, 4, 5, 6, 7]]) expect(rowsIn(rows, inventoryEn.import.findings)).toBe(rowsPhrase(rows));
    for (const b of [812, 14_540, 3_670_016]) expect(bytesIn(b, EN)).toBe(formatBytes(b));
    expect(fillWords(inventoryEn.figureHint, { max: STOCK_MAX.toLocaleString(EN) })).toBe(FIGURE_HINT);
  });
});

describe("the Inventory pages' words in Norwegian", () => {
  it("are written in the language with its own figures", () => {
    expect(figureIn(-1234, NB)).toBe(`−${(1234).toLocaleString(NB)}`);
    expect(policyIn("continue", 1, inventoryNb)).toBe("Selg videre: 1 dag");
    expect(policyIn("continue", 7, inventoryNb)).toBe("Selg videre: 7 dager");
    expect(savedIn({ written: 2, unchanged: 0, conflicts: 1, refused: 0, failed: 0 }, inventoryNb, NB)).toBe("2 tall lagret, 1 tall ikke lagret fordi lageret hadde endret seg.");
    expect(heldIn(1, 2, inventoryNb, NB)).toBe("1 enhet fordelt på 2 varianter");
    expect(deactivationIn({ units: 3, variants: 1, committedUnits: 2 }, inventoryNb, NB).refusal).toBe("2 enheter er holdt av utsjekkinger som pågår; prøv igjen om noen minutter.");
    expect(reasonIn("sale", inventoryNb)).toBe("Salg");
    expect(reasonIn("unknown", inventoryNb)).toBe("Annet");
    expect(byIn({ source: "order", orderNumber: "1001" }, inventoryNb)).toBe("Ordre 1001");
    expect(byIn({ source: "staff" }, inventoryNb)).toBe("En ansatt");
    expect(rowsIn([2, 1], inventoryNb.import.findings)).toBe("1 og 2");
    expect(bytesIn(14_540, NB)).toBe("14,2 KB");
    expect(adjustProblemsIn(inventoryNb, NB).too_high).toContain((1_000_000).toLocaleString(NB));
  });

  it("use the glossary's words and none it forbids", () => {
    expect(forbiddenUses(JSON.stringify(inventoryNb))).toEqual([]);
    expect(inventoryNb.head.nav).toBe("Lager");
    expect(inventoryNb.table.sku).toBe("Varenummer");
    expect(inventoryNb.states.backorder).toBe("På restordre");
  });
});
