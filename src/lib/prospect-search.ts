import { z } from "zod";

import codes from "@/data/no-register-codes.json";

import { readUnit, REGISTER_HOST, type RegisterFacts } from "./register-facts";

/**
 * Finding companies (email plan P5.1, D893): who the owner wants to reach, as filters that code runs over a public company register, first
 * Norway's Enhetsregisteret (`data.brreg.no/enhetsregisteret/api/enheter`: industry, municipality, headcount, founding day). Pure.
 *
 * - **Companies, not people.** The search asks the register for limited companies and the like only (`ORG_FORMS`), never a sole trader
 *   (`ENK`, whose company is a person), and never one bankrupt or being wound up.
 * - **Nothing invented.** Industries are SN2025 divisions and groups (`56`, `56.1`) and places are municipalities or counties, all from the
 *   lists bundled in `src/data/no-register-codes.json` (SSB and Kartverket); a code or a name not on them is dropped, never sent.
 */

type Industry = [code: string, nb: string, en: string];
const INDUSTRIES = codes.industries as Industry[];
const INDUSTRY_BY_CODE = new Map(INDUSTRIES.map((i) => [i[0], i]));
const COUNTIES = codes.counties as [string, string][];
const MUNICIPALITIES = codes.municipalities as [string, string][];

/** The register's forms of company the search asks for: limited, public limited, partnerships, cooperatives, foreign branches, foundations. */
export const ORG_FORMS = ["AS", "ASA", "ANS", "DA", "SA", "NUF", "STI"] as const;

export const INDUSTRIES_MAX = 6;
export const PLACES_MAX = 12;
export const PAGE_SIZE = 20;
/** The register pages no further than 10,000 results; a search that wide is said to be too wide rather than paged through. */
export const RESULTS_MAX = 10_000;

export type ProspectFilters = {
  /** SN2025 divisions or groups: `56` or `56.1`. */
  industries: string[];
  /** Municipality numbers (`0301`) or county numbers (`46`, every municipality in it). */
  places: string[];
  employeesMin: number | null;
  employeesMax: number | null;
  /** Registered on or after this day (`YYYY-MM-DD`): for "new companies". */
  foundedFrom: string | null;
  /** Registered on or before this day: for "established companies". */
  foundedTo: string | null;
};

export const EMPTY_FILTERS: ProspectFilters = { industries: [], places: [], employeesMin: null, employeesMax: null, foundedFrom: null, foundedTo: null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const count = z.number().int().min(0).max(100_000).nullable().catch(null);
const dayOrNull = z.string().regex(DAY).nullable().catch(null);

/** Whether a code is an industry on the list (`56`, `56.1`). */
export const isIndustry = (code: string): boolean => INDUSTRY_BY_CODE.has(code);

/** Whether a number is a county (`46`) or a municipality (`4601`) on the list. */
export const isPlace = (code: string): boolean => (code.length === 2 ? COUNTIES.some((c) => c[0] === code) : MUNICIPALITIES.some((m) => m[0] === code));

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The numbers of places named in words: a county by its name gives the county, a municipality its number (two municipalities of the same
 * name both). Names not on the lists give nothing.
 */
export function placesNamed(names: readonly string[]): string[] {
  const found: string[] = [];
  for (const raw of names) {
    const name = fold(raw);
    if (!name) continue;
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
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean);
  const industries = [...new Set(list(value.industries).filter(isIndustry))].slice(0, INDUSTRIES_MAX);
  const places = [...new Set([...list(value.places).filter(isPlace), ...placesNamed(list(value.placeNames))])].slice(0, PLACES_MAX);
  const num = (v: unknown) => count.parse(v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v) : v);
  let employeesMin = num(value.employeesMin);
  let employeesMax = num(value.employeesMax);
  if (employeesMin !== null && employeesMax !== null && employeesMin > employeesMax) [employeesMin, employeesMax] = [employeesMax, employeesMin];
  const foundedFrom = dayOrNull.parse(value.foundedFrom || null);
  const foundedTo = dayOrNull.parse(value.foundedTo || null);
  return { industries, places, employeesMin, employeesMax, foundedFrom, foundedTo };
}

/** Whether the filters name something to search by: a register-wide list of every company is never asked for. */
export const hasFilters = (f: ProspectFilters): boolean => f.industries.length > 0 || f.places.length > 0;

/** The filters as the page's address keeps them (`?industries=56.1&places=0301&min=5&max=50`), so a search can be linked and paged. */
export function filtersToQuery(f: ProspectFilters): Record<string, string> {
  const q: Record<string, string> = {};
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
  return cleanFilters({ industries: one("industries"), places: one("places"), employeesMin: one("min"), employeesMax: one("max"), foundedFrom: one("from"), foundedTo: one("to") });
}

/** The register's search address for these filters and a page (from 0): companies only, none bankrupt or being wound up. */
export function searchUrl(f: ProspectFilters, page: number): string {
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
  url.searchParams.set("page", String(Math.max(0, Math.min(page, Math.floor((RESULTS_MAX - 1) / PAGE_SIZE)))));
  return url.toString();
}

export type FoundCompany = RegisterFacts & { number: string };
export type SearchPage = { companies: FoundCompany[]; total: number; page: number; pages: number };

/** One page of the register's answer: its companies (a sole trader or one with a red flag that slipped through is left out) and the total. */
export function readSearch(json: unknown, today: string): SearchPage {
  const body = (json && typeof json === "object" ? json : {}) as { _embedded?: { enheter?: unknown[] }; page?: Record<string, unknown> };
  const companies: FoundCompany[] = [];
  for (const raw of body._embedded?.enheter ?? []) {
    const unit = readUnit(raw, today);
    const number = String((raw as Record<string, unknown>)?.organisasjonsnummer ?? "");
    if (unit.status === "company" && !unit.facts.redFlag) companies.push({ ...unit.facts, number });
  }
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
  return { companies, total: int(body.page?.totalElements), page: int(body.page?.number), pages: int(body.page?.totalPages) };
}

/** An industry's name in the admin's language (Norwegian for `nb`, else English), or the code. */
export const industryName = (code: string, lang: string): string => INDUSTRY_BY_CODE.get(code)?.[lang === "nb" ? 1 : 2] ?? code;

/** A place's name: the municipality's, or the county's. */
export const placeName = (code: string): string => (code.length === 2 ? COUNTIES.find((c) => c[0] === code)?.[1] : MUNICIPALITIES.find((m) => m[0] === code)?.[1]) ?? code;

/** The industries the model may choose from, one a line (`56.1 Drift av restauranter …`), in Norwegian: the register's own words. */
export const industryCatalogue = (): string => INDUSTRIES.map((i) => `${i[0]} ${i[1]} / ${i[2]}`).join("\n");
