/**
 * Company facts from Brønnøysundregistrene (D891, `docs/rules/admin/commerce.md` "Company facts from Brønnøysund"): the pure parts. The open
 * Enhetsregisteret (`data.brreg.no/enhetsregisteret/api`: a unit's form, industry, headcount, founding day, place, website and the flags of
 * bankruptcy, winding up, forced dissolution and deletion; its feed of changes) and Regnskapsregisteret (`data.brreg.no/regnskapsregisteret`:
 * the latest annual accounts), both open under the NLOD licence with no key; read 24 November 2026. The calls are
 * `src/server/register-facts.ts`. Nothing here reads an answer as anything but text: a register's words are data, never markup.
 */

export const REGISTER_HOST = "data.brreg.no";
export const UNIT_URL = (number: string) => `https://${REGISTER_HOST}/enhetsregisteret/api/enheter/${number}`;
export const ACCOUNTS_URL = (number: string) => `https://${REGISTER_HOST}/regnskapsregisteret/regnskap/${number}`;
/** The changes to the given units since `since`; the feed takes the numbers as one comma-separated list. */
export function updatesUrl(since: Date, numbers: readonly string[], size = 1000): string {
  const url = new URL(`https://${REGISTER_HOST}/enhetsregisteret/api/oppdateringer/enheter`);
  url.searchParams.set("dato", since.toISOString());
  url.searchParams.set("organisasjonsnummer", numbers.join(","));
  url.searchParams.set("size", String(size));
  return url.toString();
}

/** Numbers asked about in one call of the feed. */
export const UPDATES_CHUNK = 100;
/** How long facts and accounts are kept before they are asked for again, whatever the feed says. */
export const REFRESH_DAYS = 30;
/** How far back the daily watch reads the feed: past a day, so a run that was late or missed is covered by the next. */
export const WATCH_WINDOW_DAYS = 3;
/** How long a red flag is news on a store's Home when the company buys without payment terms. */
export const FLAG_NEWS_DAYS = 30;

/** Organisation forms whose unit is one person: kept only as `sole_trader`, never with a name, place, figure or flag. */
export const SOLE_TRADER_FORMS: readonly string[] = ["ENK"];

export type RedFlag = "bankrupt" | "winding_up" | "dissolution" | "deleted";
/** The flags from the most serious down: the one a company shows is the first that holds. */
export const RED_FLAGS: readonly RedFlag[] = ["deleted", "bankrupt", "dissolution", "winding_up"];

export type RegisterFacts = {
  name: string | null;
  orgForm: string | null;
  orgFormName: string | null;
  industryCode: string | null;
  industryName: string | null;
  employees: number | null;
  founded: string | null;
  municipality: string | null;
  website: string | null;
  redFlag: RedFlag | null;
  redFlagOn: string | null;
};

export type RegisterUnit = { status: "company"; facts: RegisterFacts } | { status: "sole_trader"; orgForm: string } | { status: "not_found" };

export type RegisterAccounts = {
  year: number;
  currency: string;
  revenueMinor: number | null;
  operatingResultMinor: number | null;
  profitMinor: number | null;
  equityMinor: number | null;
  previousRevenueMinor: number | null;
};

/** What is kept of a number, as pages read it: the unit's facts (a company only), its latest accounts, when it was asked, when it was flagged. */
export type RegisterView = {
  number: string;
  status: "company" | "sole_trader" | "not_found";
  facts: RegisterFacts | null;
  accounts: RegisterAccounts | null;
  checkedAt: string;
  flaggedAt: string | null;
};

const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return clean === "" ? null : clean.slice(0, max);
}

const day = (value: unknown): string | null => {
  const t = text(value, 10);
  return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

/** A name as people write it: the register's capitals made readable ("EQUINOR ASA" → "Equinor ASA"), the legal form kept in capitals. */
export function readableName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-/&(])(\p{L})/gu, (_m, before: string, letter: string) => before + letter.toUpperCase())
    .replace(/\b(As|Asa|Sa|Ba|Ans|Da|Ks|Nuf|Sf|Iks|Hf|Kf)\b/g, (form) => form.toUpperCase());
}

/** The flag a unit shows, the most serious that holds, with its day where the register gives one (else `today`). */
export function redFlagOf(unit: Record<string, unknown>, today: string): { flag: RedFlag | null; on: string | null } {
  const holds: Record<RedFlag, { on: boolean; day: string | null }> = {
    deleted: { on: day(unit.slettedato) !== null, day: day(unit.slettedato) },
    bankrupt: { on: unit.konkurs === true, day: day(unit.konkursdato) },
    dissolution: {
      on: unit.underTvangsavviklingEllerTvangsopplosning === true,
      day: day(unit.tvangsopplostPgaMangelfulltStyreDato) ?? day(unit.tvangsavvikletPgaManglendeSlettingDato) ?? day(unit.tvangsopplostPgaManglendeDagligLederDato) ?? day(unit.tvangsopplostPgaManglendeRevisorDato) ?? day(unit.tvangsopplostPgaManglendeRegnskapDato),
    },
    winding_up: { on: unit.underAvvikling === true, day: day(unit.underAvviklingDato) },
  };
  for (const flag of RED_FLAGS) if (holds[flag].on) return { flag, on: holds[flag].day ?? today };
  return { flag: null, on: null };
}

/** The host of a website the register lists, without `www.`, or null. */
export function websiteOf(value: unknown): string | null {
  const raw = text(value, 300);
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && host.length <= 253 ? host : null;
  } catch {
    return null;
  }
}

/**
 * Reads a unit (`GET /enhetsregisteret/api/enheter/{number}`, 200). A sole trader is only that it is one; anything without a nine-digit
 * number is not found. `today` is the day a flag without its own day is dated.
 */
export function readUnit(json: unknown, today: string): RegisterUnit {
  const unit = obj(json);
  const number = text(unit?.organisasjonsnummer, 9);
  if (!unit || !number || !/^\d{9}$/.test(number)) return { status: "not_found" };
  const form = obj(unit.organisasjonsform);
  const orgForm = text(form?.kode, 10);
  if (orgForm && SOLE_TRADER_FORMS.includes(orgForm)) return { status: "sole_trader", orgForm };
  const industry = obj(unit.naeringskode1);
  const address = obj(unit.forretningsadresse) ?? obj(unit.postadresse);
  const employees = typeof unit.antallAnsatte === "number" && Number.isInteger(unit.antallAnsatte) && unit.antallAnsatte >= 0 ? unit.antallAnsatte : null;
  const name = text(unit.navn, 200);
  const municipality = text(address?.poststed, 100) ?? text(address?.kommune, 100);
  const flag = redFlagOf(unit, today);
  return {
    status: "company",
    facts: {
      name: name ? readableName(name) : null,
      orgForm,
      orgFormName: text(form?.beskrivelse, 100),
      industryCode: text(industry?.kode, 20),
      industryName: text(industry?.beskrivelse, 200),
      employees: unit.harRegistrertAntallAnsatte === false ? null : employees,
      founded: day(unit.stiftelsesdato),
      municipality: municipality ? readableName(municipality) : null,
      website: websiteOf(unit.hjemmeside),
      redFlag: flag.flag,
      redFlagOn: flag.on,
    },
  };
}

/** An amount in whole units (the register's floats) as minor units, or null. */
const minor = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 9e15 / 100 ? Math.round(value * 100) : null);

/**
 * Reads the accounts (`GET /regnskapsregisteret/regnskap/{number}`, 200: a list of the last years, each the company's own or its group's):
 * the latest year of the company's own accounts (its group's when it files none of its own), with the year before's revenue for a trend.
 */
export function readAccounts(json: unknown): RegisterAccounts | null {
  if (!Array.isArray(json)) return null;
  const years = json
    .map((entry) => {
      const e = obj(entry);
      const end = day(obj(e?.regnskapsperiode)?.tilDato);
      const currency = text(e?.valuta, 3)?.toUpperCase() ?? null;
      if (!e || !end || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
      const result = obj(e.resultatregnskapResultat);
      const operating = obj(result?.driftsresultat);
      return {
        own: e.regnskapstype !== "KONSERN",
        year: Number(end.slice(0, 4)),
        currency,
        revenueMinor: minor(obj(operating?.driftsinntekter)?.sumDriftsinntekter),
        operatingResultMinor: minor(operating?.driftsresultat),
        profitMinor: minor(result?.aarsresultat),
        equityMinor: minor(obj(obj(e.egenkapitalGjeld)?.egenkapital)?.sumEgenkapital),
      };
    })
    .filter((y): y is NonNullable<typeof y> => y !== null);
  const own = years.filter((y) => y.own);
  const pool = (own.length > 0 ? own : years).sort((a, b) => b.year - a.year);
  const latest = pool[0];
  if (!latest) return null;
  const before = pool.find((y) => y.year === latest.year - 1 && y.currency === latest.currency);
  return {
    year: latest.year,
    currency: latest.currency,
    revenueMinor: latest.revenueMinor,
    operatingResultMinor: latest.operatingResultMinor,
    profitMinor: latest.profitMinor,
    equityMinor: latest.equityMinor,
    previousRevenueMinor: before?.revenueMinor ?? null,
  };
}

/** The numbers the feed (`GET /enhetsregisteret/api/oppdateringer/enheter`) says changed, once each. */
export function readUpdates(json: unknown): string[] {
  const list = obj(obj(json)?._embedded)?.oppdaterteEnheter;
  if (!Array.isArray(list)) return [];
  const numbers = new Set<string>();
  for (const item of list) {
    const number = text(obj(item)?.organisasjonsnummer, 9);
    if (number && /^\d{9}$/.test(number)) numbers.add(number);
  }
  return [...numbers];
}

/** The revenue's change on the year before, as a whole percent; null without both years or from nothing. */
export function revenueChange(accounts: Pick<RegisterAccounts, "revenueMinor" | "previousRevenueMinor">): number | null {
  const { revenueMinor: now, previousRevenueMinor: before } = accounts;
  if (now === null || before === null || before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/** An amount in a few characters ("8,4 mill. kr", "NOK 8.4M"), for a card or a line. */
export function compactMoney(amountMinor: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(amountMinor / 100);
  } catch {
    return `${currency} ${Math.round(amountMinor / 100)}`;
  }
}
