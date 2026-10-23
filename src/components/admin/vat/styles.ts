/** The platform VAT pages' shared classes (admin tokens only, D149). */
export const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal disabled:opacity-60";
export const label = "flex flex-col gap-1 text-sm font-medium";
export const hint = "font-normal text-muted";
export const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

import { platformToolsEn, type PlatformToolsMessages } from "@/lib/admin-messages/platform-tools.en";

/** The VAT pages' words (D312 A11), English unless the page hands its reader's. */
export type VatWords = PlatformToolsMessages["vat"];
export const VAT_EN: VatWords = platformToolsEn.vat;

/** A `yyyy-mm-dd` day for people ("3 Oct 2026" in English), or the text itself when it is not one. */
export const dayText = (day: string | null, locale = "en-GB"): string => {
  if (!day) return "";
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" }).format(d);
};
