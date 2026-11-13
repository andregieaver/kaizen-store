/**
 * Phone numbers (E.164) and their countries' calling codes: pure and without zod, so the checkout's pay route can read it (D158). SMS
 * marketing (D565, `./sms`) texts only `SMS_COUNTRIES` (`normalisePhone()`); a number a person is reached on may be any country's
 * (`e164Phone()`).
 */

/** The countries a store may text: the EU's, the EEA's, Switzerland and the United Kingdom; each with its calling code and one time zone. */
export const SMS_COUNTRIES: Readonly<Record<string, { code: string; zone: string }>> = {
  AT: { code: "43", zone: "Europe/Vienna" },
  BE: { code: "32", zone: "Europe/Brussels" },
  BG: { code: "359", zone: "Europe/Sofia" },
  HR: { code: "385", zone: "Europe/Zagreb" },
  CY: { code: "357", zone: "Asia/Nicosia" },
  CZ: { code: "420", zone: "Europe/Prague" },
  DK: { code: "45", zone: "Europe/Copenhagen" },
  EE: { code: "372", zone: "Europe/Tallinn" },
  FI: { code: "358", zone: "Europe/Helsinki" },
  FR: { code: "33", zone: "Europe/Paris" },
  DE: { code: "49", zone: "Europe/Berlin" },
  GR: { code: "30", zone: "Europe/Athens" },
  HU: { code: "36", zone: "Europe/Budapest" },
  IE: { code: "353", zone: "Europe/Dublin" },
  IT: { code: "39", zone: "Europe/Rome" },
  LV: { code: "371", zone: "Europe/Riga" },
  LT: { code: "370", zone: "Europe/Vilnius" },
  LU: { code: "352", zone: "Europe/Luxembourg" },
  MT: { code: "356", zone: "Europe/Malta" },
  NL: { code: "31", zone: "Europe/Amsterdam" },
  PL: { code: "48", zone: "Europe/Warsaw" },
  PT: { code: "351", zone: "Europe/Lisbon" },
  RO: { code: "40", zone: "Europe/Bucharest" },
  SK: { code: "421", zone: "Europe/Bratislava" },
  SI: { code: "386", zone: "Europe/Ljubljana" },
  ES: { code: "34", zone: "Europe/Madrid" },
  SE: { code: "46", zone: "Europe/Stockholm" },
  NO: { code: "47", zone: "Europe/Oslo" },
  IS: { code: "354", zone: "Atlantic/Reykjavik" },
  LI: { code: "423", zone: "Europe/Vaduz" },
  CH: { code: "41", zone: "Europe/Zurich" },
  GB: { code: "44", zone: "Europe/London" },
};

/** Calling codes, longest first, so `+358…` is Finland and never a code that is a prefix of it. */
const CODES = Object.entries(SMS_COUNTRIES)
  .map(([country, { code }]) => ({ country, code }))
  .sort((a, b) => b.code.length - a.code.length);

/** Countries whose national numbers keep their leading 0 after the calling code (Italy's landline and San Marino style numbers). */
const KEEPS_ZERO = new Set(["IT"]);

/** The country of an E.164 number among `SMS_COUNTRIES`, or null for one a store may not text. */
export function phoneCountry(e164: string): string | null {
  if (!/^\+[1-9]\d{6,14}$/.test(e164)) return null;
  const digits = e164.slice(1);
  return CODES.find((c) => digits.startsWith(c.code))?.country ?? null;
}

/**
 * A number as typed made E.164: `+47 912 34 567`, `0047 91234567` and, in the shopper's country (`country`), `912 34 567` or a national
 * number with its trunk 0. Null for anything that is not a number of a country a store may text.
 */
export function normalisePhone(typed: string, country: string | null): string | null {
  const number = e164Phone(typed, country);
  return number && phoneCountry(number) ? number : null;
}

/**
 * A number as typed made E.164, whatever its country: `+1 415 555 0100`, `0047 91234567`, or a national number in `country` (which must be
 * one of `SMS_COUNTRIES`, for its calling code). Null for anything that is not a phone number. For a number a person is reached on (a driver
 * calling about a delivery); `normalisePhone()` for one a store may text.
 */
export function e164Phone(typed: string, country: string | null): string | null {
  const raw = typed.trim();
  if (raw.length === 0 || raw.length > 32 || /[^\d\s+().\-/]/.test(raw)) return null;
  let digits = raw.replace(/[\s().\-/]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) {
    const home = country ? SMS_COUNTRIES[country.toUpperCase()] : undefined;
    if (!home) return null;
    const national = KEEPS_ZERO.has(country!.toUpperCase()) ? digits : digits.replace(/^0/, "");
    digits = `+${home.code}${national}`;
  }
  if (digits.indexOf("+", 1) !== -1 || !/^\+[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}
