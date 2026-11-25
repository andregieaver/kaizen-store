import { z } from "zod";

import codes from "@/data/no-register-codes.json";

import { readUnit, REGISTER_HOST, type RegisterFacts } from "./register-facts";

/**
 * Finding companies (email plan P5.1, D893, D896): who the owner wants to reach, as filters that code runs over a public company register:
 * Norway's Enhetsregisteret (`data.brreg.no/enhetsregisteret/api/enheter`: industry, municipality, headcount, founding day) and Finland's
 * PRH (`avoindata.prh.fi/opendata-ytj-api/v3/companies`: industry, town, registration day; no headcount). Pure.
 *
 * - **Companies, not people.** Only limited companies and the like (`ORG_FORMS`, `FI_FORMS`), never a sole trader (whose company is a
 *   person), and never one bankrupt, being wound up or ceased.
 * - **Nothing invented.** Industries are the 2025 EU classification's divisions and groups (`56`, `56.1`: Norway's SN2025 and Finland's
 *   TOL 2025 share them; Finland's search takes one, and one town) and places are Norway's municipalities and counties or Finland's municipalities, all from the lists bundled in
 *   `src/data/no-register-codes.json` (SSB, Kartverket, Statistics Finland); a code or a name not on them is dropped, never sent.
 */

type Industry = [code: string, nb: string, en: string];
const INDUSTRIES = codes.industries as Industry[];
const INDUSTRY_BY_CODE = new Map(INDUSTRIES.map((i) => [i[0], i]));
const COUNTIES = codes.counties as [string, string][];
const MUNICIPALITIES = codes.municipalities as [string, string][];
const FI_MUNICIPALITIES = codes.fiMunicipalities as [string, string][];

export const COUNTRIES = ["NO", "FI"] as const;
export type ProspectCountry = (typeof COUNTRIES)[number];

/** Norway's forms of company the search asks for: limited, public limited, partnerships, cooperatives, foreign branches, foundations. */
export const ORG_FORMS = ["AS", "ASA", "ANS", "DA", "SA", "NUF", "STI"] as const;
/** Finland's (PRH's codes): limited, public limited, general and limited partnerships, cooperatives, foreign branches, European companies. */
export const FI_FORMS: readonly string[] = ["16", "17", "5", "13", "14", "19", "80"];

export const FI_HOST = "avoindata.prh.fi";
export const INDUSTRIES_MAX = 6;
export const PLACES_MAX = 12;
export const PAGE_SIZE = 20;
/** PRH answers 100 a page; a page of ours is a fifth of one. */
const FI_PAGE = 100;
/** The register pages no further than 10,000 results; a search that wide is said to be too wide rather than paged through. */
export const RESULTS_MAX = 10_000;

export type ProspectFilters = {
  country: ProspectCountry;
  /** The 2025 classification's divisions or groups: `56` or `56.1`. */
  industries: string[];
  /** Norway: municipality numbers (`0301`) or county numbers (`46`, every municipality in it). Finland: one municipality number (`091`). */
  places: string[];
  /** Headcount: Norway's register only. */
  employeesMin: number | null;
  employeesMax: number | null;
  /** Registered on or after this day (`YYYY-MM-DD`): for "new companies". */
  foundedFrom: string | null;
  /** Registered on or before this day: for "established companies". */
  foundedTo: string | null;
};

export const EMPTY_FILTERS: ProspectFilters = { country: "NO", industries: [], places: [], employeesMin: null, employeesMax: null, foundedFrom: null, foundedTo: null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const count = z.number().int().min(0).max(100_000).nullable().catch(null);
const dayOrNull = z.string().regex(DAY).nullable().catch(null);

/** Whether a code is an industry on the list (`56`, `56.1`). */
export const isIndustry = (code: string): boolean => INDUSTRY_BY_CODE.has(code);

/** Whether a number is a place on the country's list: Norway's county (`46`) or municipality (`4601`), Finland's municipality (`091`). */
export function isPlace(code: string, country: ProspectCountry = "NO"): boolean {
  if (country === "FI") return FI_MUNICIPALITIES.some((m) => m[0] === code);
  return code.length === 2 ? COUNTIES.some((c) => c[0] === code) : MUNICIPALITIES.some((m) => m[0] === code);
}

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The numbers of places named in words, in the country's list: in Norway a county by its name gives the county and a municipality its
 * number (two municipalities of the same name both); in Finland a municipality by its Finnish name. Names not on the lists give nothing.
 */
export function placesNamed(names: readonly string[], country: ProspectCountry = "NO"): string[] {
  const found: string[] = [];
  for (const raw of names) {
    const name = fold(raw);
    if (!name) continue;
    if (country === "FI") {
      found.push(...FI_MUNICIPALITIES.filter((m) => fold(m[1]) === name).map((m) => m[0]));
      continue;
    }
    const municipalities = MUNICIPALITIES.filter((m) => fold(m[1]) === name).map((m) => m[0]);
    const county = COUNTIES.find((c) => fold(c[1]) === name)?.[0];
    // Oslo is both a county and its one municipality: the municipality is the same place, said once.
    if (municipalities.length > 0) found.push(...municipalities);
    else if (county) found.push(county);
  }
  return [...new Set(found)];
}

/** Filters from anything (the model's answer, a form, an address): what is on the lists and in range, else left out. */
export function cleanFilters(raw: unknown): ProspectFilters {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const country: ProspectCountry = String(value.country ?? "").toUpperCase() === "FI" ? "FI" : "NO";
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean);
  // PRH takes one industry and one town a search.
  const industries = [...new Set(list(value.industries).filter(isIndustry))].slice(0, country === "FI" ? 1 : INDUSTRIES_MAX);
  const places = [...new Set([...list(value.places).filter((p) => isPlace(p, country)), ...placesNamed(list(value.placeNames), country)])].slice(0, country === "FI" ? 1 : PLACES_MAX);
  const num = (v: unknown) => count.parse(v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v) : v);
  let employeesMin = country === "FI" ? null : num(value.employeesMin);
  let employeesMax = country === "FI" ? null : num(value.employeesMax);
  if (employeesMin !== null && employeesMax !== null && employeesMin > employeesMax) [employeesMin, employeesMax] = [employeesMax, employeesMin];
  const foundedFrom = dayOrNull.parse(value.foundedFrom || null);
  const foundedTo = dayOrNull.parse(value.foundedTo || null);
  return { country, industries, places, employeesMin, employeesMax, foundedFrom, foundedTo };
}

/** Whether the filters name something to search by: a register-wide list of every company is never asked for. */
export const hasFilters = (f: ProspectFilters): boolean => f.industries.length > 0 || f.places.length > 0;

/** The filters as the page's address keeps them (`?industries=56.1&places=0301&min=5&max=50`), so a search can be linked and paged. */
export function filtersToQuery(f: ProspectFilters): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.country !== "NO") q.country = f.country;
  if (f.industries.length) q.industries = f.industries.join(",");
  if (f.places.length) q.places = f.places.join(",");
  if (f.employeesMin !== null) q.min = String(f.employeesMin);
  if (f.employeesMax !== null) q.max = String(f.employeesMax);
  if (f.foundedFrom) q.from = f.foundedFrom;
  if (f.foundedTo) q.to = f.foundedTo;
  return q;
}

export function filtersFromQuery(q: Record<string, string | string[] | undefined>): ProspectFilters {
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]) ?? "";
  return cleanFilters({
    country: one("country"),
    industries: one("industries"),
    places: one("places"),
    employeesMin: one("min"),
    employeesMax: one("max"),
    foundedFrom: one("from"),
    foundedTo: one("to"),
  });
}

/** The register's search address for these filters and a page of ours (from 0). */
export function searchUrl(f: ProspectFilters, page: number): string {
  const last = Math.floor((RESULTS_MAX - 1) / PAGE_SIZE);
  const at = Math.max(0, Math.min(page, last));
  if (f.country === "FI") {
    const url = new URL(`https://${FI_HOST}/opendata-ytj-api/v3/companies`);
    if (f.industries.length) url.searchParams.set("mainBusinessLine", f.industries[0].replace(".", ""));
    const place = f.places[0] ? FI_MUNICIPALITIES.find((m) => m[0] === f.places[0])?.[1] : null;
    if (place) url.searchParams.set("location", place);
    if (f.foundedFrom) url.searchParams.set("registrationDateStart", f.foundedFrom);
    if (f.foundedTo) url.searchParams.set("registrationDateEnd", f.foundedTo);
    url.searchParams.set("page", String(Math.floor((at * PAGE_SIZE) / FI_PAGE) + 1));
    return url.toString();
  }
  const url = new URL(`https://${REGISTER_HOST}/enhetsregisteret/api/enheter`);
  const counties = f.places.filter((p) => p.length === 2);
  const municipalities = [...f.places.filter((p) => p.length === 4), ...MUNICIPALITIES.filter((m) => counties.includes(m[0].slice(0, 2))).map((m) => m[0])];
  if (f.industries.length) url.searchParams.set("naeringskode", f.industries.join(","));
  if (municipalities.length) url.searchParams.set("kommunenummer", [...new Set(municipalities)].join(","));
  if (f.employeesMin !== null) url.searchParams.set("fraAntallAnsatte", String(f.employeesMin));
  if (f.employeesMax !== null) url.searchParams.set("tilAntallAnsatte", String(f.employeesMax));
  if (f.foundedFrom) url.searchParams.set("fraRegistreringsdatoEnhetsregisteret", f.foundedFrom);
  if (f.foundedTo) url.searchParams.set("tilRegistreringsdatoEnhetsregisteret", f.foundedTo);
  url.searchParams.set("organisasjonsform", ORG_FORMS.join(","));
  url.searchParams.set("konkurs", "false");
  url.searchParams.set("underAvvikling", "false");
  url.searchParams.set("underTvangsavviklingEllerTvangsopplosning", "false");
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("page", String(at));
  return url.toString();
}

export type FoundCompany = RegisterFacts & { number: string; country: ProspectCountry };
export type SearchPage = { companies: FoundCompany[]; total: number; page: number; pages: number; country: ProspectCountry };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj).filter((x): x is Record<string, unknown> => x !== null) : []);
const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** A Finnish company from PRH's answer, or null when it is not one the search shows: ceased, in liquidation or bankrupt, or of another form. */
export function readFiCompany(raw: unknown): FoundCompany | null {
  const c = obj(raw);
  const id = obj(c?.businessId);
  const number = str(id?.value, 12);
  if (!c || !number || !/^\d{7}-\d$/.test(number)) return null;
  const form = arr(c.companyForms).find((f) => !f.endDate);
  if (!form || !FI_FORMS.includes(String(form.type))) return null;
  if (c.endDate || String(c.tradeRegisterStatus ?? "1") !== "1") return null;
  if (arr(c.companySituations).some((s) => !s.endDate)) return null;
  const name = str(arr(c.names).find((n) => !n.endDate && String(n.type) === "1")?.name);
  const line = obj(c.mainBusinessLine);
  const words = (list: unknown, lang: string) => str(arr(list).find((d) => String(d.languageCode) === lang)?.description);
  const office = arr(arr(c.addresses)[0]?.postOffices).find((o) => String(o.languageCode) === "1");
  const city = str(office?.city, 100);
  const site = str(obj(c.website)?.url, 300);
  let website: string | null = null;
  if (site) {
    try {
      const host = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).hostname.toLowerCase().replace(/^www\./, "");
      website = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
    } catch {
      website = null;
    }
  }
  const founded = str(id?.registrationDate, 10);
  return {
    number,
    country: "FI",
    name,
    orgForm: str(form.type, 10),
    orgFormName: words(form.descriptions, "3"),
    industryCode: str(line?.type, 20),
    industryName: words(line?.descriptions, "3") ?? words(line?.descriptions, "1"),
    employees: null,
    founded: founded && DAY.test(founded) ? founded : null,
    municipality: city ? city.charAt(0) + city.slice(1).toLowerCase() : null,
    website,
    redFlag: null,
    redFlagOn: null,
  };
}

/** One page of the register's answer: its companies (a sole trader or one with a red flag that slipped through is left out) and the total. */
export function readSearch(json: unknown, today: string, country: ProspectCountry = "NO", page = 0): SearchPage {
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
  if (country === "FI") {
    const body = obj(json) ?? {};
    const all = Array.isArray(body.companies) ? body.companies : [];
    // Our page is a fifth of PRH's: its slice, then the companies the search shows.
    const offset = (page * PAGE_SIZE) % FI_PAGE;
    const companies = all.slice(offset, offset + PAGE_SIZE).map(readFiCompany).filter((c): c is FoundCompany => c !== null);
    const total = int(body.totalResults);
    return { companies, total, page, pages: Math.ceil(total / PAGE_SIZE), country };
  }
  const body = (json && typeof json === "object" ? json : {}) as { _embedded?: { enheter?: unknown[] }; page?: Record<string, unknown> };
  const companies: FoundCompany[] = [];
  for (const raw of body._embedded?.enheter ?? []) {
    const unit = readUnit(raw, today);
    const number = String((raw as Record<string, unknown>)?.organisasjonsnummer ?? "");
    if (unit.status === "company" && !unit.facts.redFlag) companies.push({ ...unit.facts, number, country: "NO" });
  }
  return { companies, total: int(body.page?.totalElements), page: int(body.page?.number), pages: int(body.page?.totalPages), country };
}

/** Where a company is in its register, for people. */
export const registerLink = (c: Pick<FoundCompany, "number" | "country">): string =>
  c.country === "FI" ? `https://tietopalvelu.ytj.fi/yritys/${c.number}` : `https://virksomhet.brreg.no/nb/oppslag/enheter/${c.number}`;

/** A company's register number as the page's address may carry it. */
export const isCompanyNumber = (value: string): boolean => /^\d{9}$/.test(value) || /^\d{7}-\d$/.test(value);

/** An industry's name in the admin's language (Norwegian for `nb`, else English), or the code. */
export const industryName = (code: string, lang: string): string => INDUSTRY_BY_CODE.get(code)?.[lang === "nb" ? 1 : 2] ?? code;

/** A place's name: Finland's municipality's, or Norway's municipality's or county's. */
export function placeName(code: string, country: ProspectCountry = "NO"): string {
  if (country === "FI") return FI_MUNICIPALITIES.find((m) => m[0] === code)?.[1] ?? code;
  return (code.length === 2 ? COUNTIES.find((c) => c[0] === code)?.[1] : MUNICIPALITIES.find((m) => m[0] === code)?.[1]) ?? code;
}

/** The industries the model may choose from, one a line (`56.1 Drift av restauranter / Restaurants …`). */
export const industryCatalogue = (): string => INDUSTRIES.map((i) => `${i[0]} ${i[1]} / ${i[2]}`).join("\n");
