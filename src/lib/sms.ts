import { z } from "zod";

/**
 * SMS marketing (D565, `docs/sms-marketing.md`): the pure rules. Who may be texted is the server's (`src/server/sms.ts`); here are the
 * numbers (E.164, and the country a number belongs to), the words that stop messages, how many parts a text takes and what each costs
 * against the cap, the hours a message may arrive at in its recipient's country, and the text as it is sent (the store's name first, the
 * stop link last).
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
  return phoneCountry(digits) ? digits : null;
}

/** A number shown to staff: the country code and the last three digits, never the whole number (it is enough to tell people apart). */
export function maskedPhone(e164: string): string {
  const country = phoneCountry(e164);
  const code = country ? SMS_COUNTRIES[country].code : e164.slice(1, 3);
  return `+${code} ••• ${e164.slice(-3)}`;
}

/**
 * The words that stop a store's texts when a recipient replies with them (any letter case, as the first word): the Nordic languages' and
 * English, as people write them.
 */
export const STOP_WORDS = ["STOP", "STOPP", "STOPPA", "AVSLUTT", "AVSLUTA", "AVMELD", "AFMELD", "SLUTA", "SLUTT", "LOPETA", "UNSUBSCRIBE", "END", "QUIT", "CANCEL"] as const;

export function isStopReply(message: string): boolean {
  const first = message.trim().split(/\s+/)[0]?.replace(/[.!,]+$/, "").toUpperCase() ?? "";
  return (STOP_WORDS as readonly string[]).includes(first);
}

/** GSM 03.38's basic set, which a part of 160 carries; anything else makes the whole text Unicode (70 a part). */
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
/** GSM 03.38's extension, each two places. */
const GSM_EXTENDED = new Set("^{}\\[~]|€\f");

/** The parts a text is sent in, and whether it is Unicode: 160 (153 each when split) in GSM, 70 (67) otherwise. */
export function smsParts(text: string): { parts: number; unicode: boolean; length: number } {
  let gsm = 0;
  let unicode = false;
  for (const ch of text) {
    if (GSM_BASIC.has(ch)) gsm += 1;
    else if (GSM_EXTENDED.has(ch)) gsm += 2;
    else unicode = true;
  }
  if (unicode) {
    // A Unicode text counts in UTF-16 units: a character outside the basic plane takes two.
    const length = text.length;
    return { parts: length <= 70 ? 1 : Math.ceil(length / 67), unicode, length };
  }
  return { parts: gsm <= 160 ? 1 : Math.ceil(gsm / 153), unicode, length: gsm };
}

/** At most this many parts a campaign's text may take (a long text is a costly one). */
export const SMS_PARTS_MAX = 4;
/** What the owner may write: the text before the store's name and the stop link are added. */
export const SMS_TEXT_MAX = 600;

/** The words that end every marketing text: the stop link, in the recipient's language. */
const STOP_LINE: Record<string, string> = { nb: "Avmeld", sv: "Avregistrera", da: "Afmeld", en: "Unsubscribe" };

/** The text as it is sent: the sender's name first (who it is from), the owner's words, and the stop link last (every marketing text has one). */
export function smsBody(input: { storeName: string; text: string; stopUrl: string; lang: string }): string {
  const stop = STOP_LINE[input.lang] ?? STOP_LINE.en;
  return `${input.storeName.trim()}: ${input.text.trim()}\n${stop}: ${input.stopUrl}`;
}

/** The stop link's token: 16 random bytes, base64url (22 characters), short because each character of a text costs. */
export const SMS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** The hours (the recipient's own clock) between which a marketing text may arrive; owners may narrow them, never send at night. */
export const QUIET_DEFAULT = { from: 9, until: 20 } as const;
export const QUIET_EARLIEST = 8;
export const QUIET_LATEST = 21;

/** The wall clock of `zone` at `at`, as the parts a time is built from. */
function wallClock(at: Date, zone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** The moment that is `hour`:00 on a wall-clock day of `zone`. */
function atWallHour(year: number, month: number, day: number, hour: number, zone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  // The zone's offset at the guess, applied, and once more where the offset changed in between (a change of summer time).
  let at = guess;
  for (let i = 0; i < 2; i++) {
    const w = wallClock(new Date(at), zone);
    const shown = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
    at += guess - shown;
  }
  return new Date(at);
}

/**
 * Countries whose rules keep commercial texts off Sundays: France (its operators' rules for commercial texts allow them Monday to Saturday,
 * 08:00 to 20:00, never on Sundays or public holidays). Public holidays are not known here; to be checked by a person (D565).
 */
export const NO_SUNDAY_COUNTRIES: ReadonlySet<string> = new Set(["FR"]);

/**
 * When a text to `country` may be sent: `now` while its clock is within the hours (and not on a Sunday where Sundays are closed), else the
 * next time it is `from` o'clock there on a day that is open. The window is `[from, until)` in whole hours.
 */
export function nextSendTime(now: Date, country: string, hours: { from: number; until: number } = QUIET_DEFAULT): Date {
  const zone = SMS_COUNTRIES[country]?.zone ?? "Europe/Oslo";
  const w = wallClock(now, zone);
  const today = Date.UTC(w.year, w.month - 1, w.day);
  const closed = (dayMs: number) => NO_SUNDAY_COUNTRIES.has(country) && new Date(dayMs).getUTCDay() === 0;
  if (w.hour >= hours.from && w.hour < hours.until && !closed(today)) return now;
  let day = w.hour < hours.from ? today : today + 86_400_000;
  while (closed(day)) day += 86_400_000;
  const d = new Date(day);
  return atWallHour(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hours.from, zone);
}

/** 46elks writes money in ten-thousandths of the account's currency; minor units are hundredths. */
export const unitsToMinor = (units: number): number => Math.round(units / 100);

/** A campaign's estimate: one recipient's price per country (from 46elks's own dry run), times its recipients and the text's parts. */
export function campaignEstimate(perCountry: ReadonlyMap<string, number>, recipients: ReadonlyMap<string, number>, parts: number): number {
  let units = 0;
  for (const [country, count] of recipients) units += (perCountry.get(country) ?? 0) * count * parts;
  return units;
}

/** Whether a campaign of `estimate` may start this month: what was spent and what it would cost stay at the cap or under (both in units). */
export const withinCap = (spentUnits: number, estimateUnits: number, capUnits: number): boolean => spentUnits + estimateUnits <= capUnits;

/** A 46elks text sender: a letter first, then letters and digits, 11 at most (46elks's rule); or the store's own number from 46elks. */
export const SENDER_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,10}$/;

export const smsSettingsInput = z.object({
  sender: z.string().trim().regex(SENDER_PATTERN, "A sender name is 1 to 11 letters and digits, starting with a letter, without spaces."),
  /** The store's 46elks number (E.164) to receive STOP replies on; empty for a sender name only (the stop link in every text still works). */
  replyNumber: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\+[1-9]\d{7,14}$/.test(v), "Write the number as +46 and its digits, with no spaces.")
    .default(""),
  quietFrom: z.coerce.number().int().min(QUIET_EARLIEST, `From ${QUIET_EARLIEST} at the earliest.`).max(QUIET_LATEST - 1).default(QUIET_DEFAULT.from),
  quietUntil: z.coerce.number().int().min(QUIET_EARLIEST + 1).max(QUIET_LATEST, `Until ${QUIET_LATEST} at the latest.`).default(QUIET_DEFAULT.until),
  /** The most a calendar month's texts may cost, in the 46elks account's currency (whole units). */
  monthlyCap: z.coerce.number().int().min(0, "The cap is 0 or more.").max(1_000_000, "The cap is at most 1 000 000.").default(500),
});
export type SmsSettingsInput = z.infer<typeof smsSettingsInput>;

export const smsCampaignInput = z.object({
  title: z.string().trim().min(1, "Give the text message a name.").max(120, "A name is at most 120 characters."),
  text: z.string().trim().min(1, "Write the message.").max(SMS_TEXT_MAX, `A message is at most ${SMS_TEXT_MAX} characters.`),
  /** `all`: every SMS subscriber; else a saved segment's people who are SMS subscribers. */
  segmentId: z.string().uuid().nullable().default(null),
});
export type SmsCampaignInput = z.infer<typeof smsCampaignInput>;

export const SMS_CAMPAIGN_STATUSES = ["draft", "sending", "sent", "stopped"] as const;
export type SmsCampaignStatus = (typeof SMS_CAMPAIGN_STATUSES)[number];
export const SMS_MESSAGE_STATUSES = ["queued", "sent", "delivered", "failed", "skipped"] as const;
export type SmsMessageStatus = (typeof SMS_MESSAGE_STATUSES)[number];
export const SMS_SUBSCRIBER_STATUSES = ["pending", "subscribed", "unsubscribed"] as const;
export type SmsSubscriberStatus = (typeof SMS_SUBSCRIBER_STATUSES)[number];
/** Where a number's consent came from: checkout's box (kept once the order is paid), or My account. */
export const SMS_SOURCES = ["checkout", "account"] as const;
/** How a number left: a STOP reply, the stop link, My account, staff for them, or 46elks saying it cannot be reached. */
export const SMS_STOP_SOURCES = ["reply", "link", "account", "staff", "unreachable"] as const;
export type SmsStopSource = (typeof SMS_STOP_SOURCES)[number];
