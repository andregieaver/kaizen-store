/**
 * How a person reads each booking bucket, in English and Norwegian (bloat review step 2.50): beside `accounting-docs.ts`, which re-exports it
 * (and `tripletex-settings.ts` through it), so the admin's `fiken` and `notifications` catalogues take it from here and import no code.
 * Imports nothing but types.
 */
import type { BookingKey } from "./accounting-docs";

/** How a person reads each bucket, in the settings and in the summary for the accountant. */
export const BOOKING_WORDS: Record<BookingKey, { en: string; nb: string }> = {
  standard_25: { en: "Sales with 25% VAT", nb: "Salg med 25 % mva" },
  standard_15: { en: "Sales with 15% VAT (food)", nb: "Salg med 15 % mva (mat)" },
  standard_12: { en: "Sales with 12% VAT", nb: "Salg med 12 % mva" },
  standard_0: { en: "Sales without VAT (not VAT registered)", nb: "Salg uten mva (ikke mva-registrert)" },
  exempt: { en: "Sales exempt from VAT", nb: "Salg fritatt for mva" },
  outside_scope: { en: "Sales outside the VAT act", nb: "Salg utenfor mva-loven" },
  reverse_charge: { en: "Services to businesses abroad", nb: "Tjenester til næringsdrivende i utlandet" },
  gift_card: { en: "Gift cards sold (owed to their holders)", nb: "Solgte gavekort (gjeld til innehaver)" },
};
