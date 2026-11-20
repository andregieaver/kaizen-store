/**
 * The reasons a person gives for a stock change, in English (bloat review step 2.50): beside `inventory-admin.ts`, which re-exports them, so the
 * admin's `inventory` catalogue and the stock table read one text and the catalogue imports no code. Imports nothing but types.
 */
import type { AdjustReason } from "./inventory";

/** The reasons a person gives, in the order the page offers them, with the sentence under the select. */
export const REASON_CHOICES: { id: AdjustReason; label: string; help: string }[] = [
  { id: "correction", label: "Correction", help: "The figure was wrong." },
  { id: "count", label: "Count", help: "You counted what is on the shelf and the figure is that count." },
  { id: "received", label: "Received", help: "Stock arrived from a supplier." },
  { id: "damaged", label: "Damaged", help: "Units that cannot be sold." },
  { id: "lost", label: "Theft or loss", help: "Units that are gone." },
  { id: "promotion", label: "Promotion or donation", help: "Units given away." },
];
