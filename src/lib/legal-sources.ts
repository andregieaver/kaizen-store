/**
 * The register of official legal sources for the AI's legal pages (D311, unit L, `docs/ai-autopilot.md` 8.2): which acts a store's legal
 * pages may rest on, where code fetches each from, in which languages, and which of their articles or sections each topic of a page may
 * cite. Pure data and helpers, so a person reading this file reads every source a page can rest on; a lawyer may read it once per country
 * (recommended, not a gate). Which sources a page uses is decided here from the store's facts, never by the model.
 *
 * Passage keys are the ones `src/lib/legal-passages.ts` cuts each text into: `art_9` and `anx_I` for EU acts (the same in every language),
 * `2:10` (chapter 2, section 10) or `8` for Swedish acts, `18` for Danish acts (numbered straight through), `21` for a Norwegian act's
 * section and `gdpr/a13` for the GDPR's articles as Norwegian law holds them. A read that cannot find a passage named here fails, so a renumbered act is noticed at its next read.
 */
export const LEGAL_LANGUAGES = ["nb", "sv", "da", "en"] as const;
export type LegalLanguage = (typeof LEGAL_LANGUAGES)[number];

export const JURISDICTIONS = ["EU", "NO", "SE", "DK"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

/** The countries a seller may be established in for the AI to write its pages (8.1); others keep the starters. */
export const COVERED_COUNTRIES = ["NO", "SE", "DK"] as const;
export type CoveredCountry = (typeof COVERED_COUNTRIES)[number];
export const isCoveredCountry = (code: string | null | undefined): code is CoveredCountry => (COVERED_COUNTRIES as readonly string[]).includes(code ?? "");

/** The EU and EEA countries whose consumers EU law protects (EU directives reach Norway through the EEA Agreement). */
const EEA = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "NO", "IS", "LI"]);

/**
 * How a source is fetched:
 * - `cellar`: EU law from the Publications Office's Cellar, the newest consolidated version of the act found through its SPARQL endpoint,
 *   as XHTML in the language asked for (EUR-Lex's own pages answer automated requests with an empty bot check).
 * - `riksdagen`: Swedish law as plain text from Riksdagen's open data, always the act as in force with its amendments.
 * - `retsinformation`: Danish law as XML by ELI. The consolidated act is named here; its `Status` is read each time, and an act no longer in
 *   force fails the read so the register is brought up to date.
 * - `lovdata`: Norwegian law from Lovdata's open data (NLOD 2.0): one archive of every act in force, updated with its amendments
 *   (`gjeldende-lover.tar.bz2`), each act a file named by its date and number. Lovdata's web pages are for reading, not for automated use.
 */
export type SourceRoute =
  | { kind: "cellar"; celex: string }
  | { kind: "riksdagen"; doc: string }
  | { kind: "retsinformation"; eli: string }
  | { kind: "lovdata"; file: string };

export type LegalSource = {
  key: string;
  jurisdiction: Jurisdiction;
  /** The act as a page names it in its Sources section. */
  title: string;
  /** Its official identifier: CELEX number, SFS number, the Danish act's number, Lovdata's id. */
  officialId: string;
  route: SourceRoute;
  languages: readonly LegalLanguage[];
  /** Where a person reads it. */
  url: string;
};

/** Every source, in the order a Sources section lists them. */
export const LEGAL_SOURCES: readonly LegalSource[] = [
  {
    key: "eu-crd",
    jurisdiction: "EU",
    title: "Directive 2011/83/EU on consumer rights",
    officialId: "CELEX 32011L0083",
    route: { kind: "cellar", celex: "32011L0083" },
    languages: ["sv", "da", "en"],
    url: "http://data.europa.eu/eli/dir/2011/83/oj",
  },
  {
    key: "eu-sgd",
    jurisdiction: "EU",
    title: "Directive (EU) 2019/771 on contracts for the sale of goods",
    officialId: "CELEX 32019L0771",
    route: { kind: "cellar", celex: "32019L0771" },
    languages: ["sv", "da", "en"],
    url: "http://data.europa.eu/eli/dir/2019/771/oj",
  },
  {
    key: "eu-ecd",
    jurisdiction: "EU",
    title: "Directive 2000/31/EC on electronic commerce",
    officialId: "CELEX 32000L0031",
    route: { kind: "cellar", celex: "32000L0031" },
    languages: ["sv", "da", "en"],
    url: "http://data.europa.eu/eli/dir/2000/31/oj",
  },
  {
    key: "eu-gdpr",
    jurisdiction: "EU",
    title: "Regulation (EU) 2016/679 (General Data Protection Regulation)",
    officialId: "CELEX 32016R0679",
    route: { kind: "cellar", celex: "32016R0679" },
    languages: ["sv", "da", "en"],
    url: "http://data.europa.eu/eli/reg/2016/679/oj",
  },
  {
    key: "se-distans",
    jurisdiction: "SE",
    title: "Lag (2005:59) om distansavtal och avtal utanför affärslokaler",
    officialId: "SFS 2005:59",
    route: { kind: "riksdagen", doc: "sfs-2005-59" },
    languages: ["sv"],
    url: "https://data.riksdagen.se/dokument/sfs-2005-59.html",
  },
  {
    key: "se-kkl",
    jurisdiction: "SE",
    title: "Konsumentköplag (2022:260)",
    officialId: "SFS 2022:260",
    route: { kind: "riksdagen", doc: "sfs-2022-260" },
    languages: ["sv"],
    url: "https://data.riksdagen.se/dokument/sfs-2022-260.html",
  },
  {
    key: "se-ehandel",
    jurisdiction: "SE",
    title: "Lag (2002:562) om elektronisk handel och andra informationssamhällets tjänster",
    officialId: "SFS 2002:562",
    route: { kind: "riksdagen", doc: "sfs-2002-562" },
    languages: ["sv"],
    url: "https://data.riksdagen.se/dokument/sfs-2002-562.html",
  },
  {
    key: "dk-forbrugeraftale",
    jurisdiction: "DK",
    title: "Forbrugeraftaleloven (LBK nr 1184 af 28/09/2025)",
    officialId: "LBK nr 1184 af 28/09/2025",
    route: { kind: "retsinformation", eli: "lta/2025/1184" },
    languages: ["da"],
    url: "https://www.retsinformation.dk/eli/lta/2025/1184",
  },
  {
    key: "dk-kob",
    jurisdiction: "DK",
    title: "Købeloven (LBK nr 1853 af 24/09/2021)",
    officialId: "LBK nr 1853 af 24/09/2021",
    route: { kind: "retsinformation", eli: "lta/2021/1853" },
    languages: ["da"],
    url: "https://www.retsinformation.dk/eli/lta/2021/1853",
  },
  {
    key: "no-arl",
    jurisdiction: "NO",
    title: "Angrerettloven (LOV-2014-06-20-27)",
    officialId: "LOV-2014-06-20-27",
    route: { kind: "lovdata", file: "nl-20140620-027" },
    languages: ["nb"],
    url: "https://lovdata.no/dokument/NL/lov/2014-06-20-27",
  },
  {
    key: "no-fkjl",
    jurisdiction: "NO",
    title: "Forbrukerkjøpsloven (LOV-2002-06-21-34)",
    officialId: "LOV-2002-06-21-34",
    route: { kind: "lovdata", file: "nl-20020621-034" },
    languages: ["nb"],
    url: "https://lovdata.no/dokument/NL/lov/2002-06-21-34",
  },
  {
    key: "no-ehl",
    jurisdiction: "NO",
    title: "Ehandelsloven (LOV-2003-05-23-35)",
    officialId: "LOV-2003-05-23-35",
    route: { kind: "lovdata", file: "nl-20030523-035" },
    languages: ["nb"],
    url: "https://lovdata.no/dokument/NL/lov/2003-05-23-35",
  },
  {
    key: "no-popplyl",
    jurisdiction: "NO",
    title: "Personopplysningsloven (LOV-2018-06-15-38) med personvernforordningen",
    officialId: "LOV-2018-06-15-38",
    route: { kind: "lovdata", file: "nl-20180615-038" },
    languages: ["nb"],
    url: "https://lovdata.no/dokument/NL/lov/2018-06-15-38",
  },
];

export const LEGAL_SOURCES_BY_KEY: Readonly<Record<string, LegalSource>> = Object.fromEntries(LEGAL_SOURCES.map((s) => [s.key, s]));

/** The only hosts a source is fetched from (`safeFetch()` is still used for each). */
export const LEGAL_SOURCE_HOSTS = ["publications.europa.eu", "data.riksdagen.se", "www.retsinformation.dk", "api.lovdata.no"] as const;

/** The Cellar language code for a page language (the Publications Office's own three letters). */
export const CELLAR_LANGUAGE: Readonly<Record<Exclude<LegalLanguage, "nb">, string>> = { sv: "swe", da: "dan", en: "eng" };

/** What a page may cite for a topic: passages of one source. */
export type TopicRef = { source: string; passages: readonly string[] };

const crd = (...passages: string[]): TopicRef => ({ source: "eu-crd", passages });
const sgd = (...passages: string[]): TopicRef => ({ source: "eu-sgd", passages });
const ecd = (...passages: string[]): TopicRef => ({ source: "eu-ecd", passages });
const gdpr = (...passages: string[]): TopicRef => ({ source: "eu-gdpr", passages });
const seDistans = (...passages: string[]): TopicRef => ({ source: "se-distans", passages });
const seKkl = (...passages: string[]): TopicRef => ({ source: "se-kkl", passages });
const seEhandel = (...passages: string[]): TopicRef => ({ source: "se-ehandel", passages });
const dkFal = (...passages: string[]): TopicRef => ({ source: "dk-forbrugeraftale", passages });
const dkKob = (...passages: string[]): TopicRef => ({ source: "dk-kob", passages });
/** Angrerettloven § 20 a (the withdrawal function) is added by a law of 19 June 2026 not yet in force: Lovdata gives it no text, so no page cites it. */
const noArl = (...passages: string[]): TopicRef => ({ source: "no-arl", passages });
const noFkjl = (...passages: string[]): TopicRef => ({ source: "no-fkjl", passages });
const noEhl = (...passages: string[]): TopicRef => ({ source: "no-ehl", passages });
const noGdpr = (...passages: string[]): TopicRef => ({ source: "no-popplyl", passages: passages.map((a) => `gdpr/a${a.slice(4)}`) });

const GDPR_RIGHTS = ["art_15", "art_16", "art_17", "art_18", "art_20", "art_21"];

/**
 * The passages each topic of each kind of page may cite, by `{kind}.{topic}` (the topics of `REQUIRED_TOPICS` and `CONDITIONAL_TOPICS`). A
 * topic with no entry, or none for the page's countries, is written from the store's facts alone (a `practical` paragraph: how this store
 * does something), never as a statement of the law.
 */
export const TOPIC_REFS: Readonly<Record<string, readonly TopicRef[]>> = {
  "terms.seller": [crd("art_6"), ecd("art_5"), seDistans("2:2"), seEhandel("8"), dkFal("8"), noArl("8"), noEhl("8")],
  "terms.products_prices": [crd("art_6"), seDistans("2:2"), dkFal("8"), noArl("8")],
  "terms.vat_shipping_costs": [crd("art_6", "art_22"), seDistans("2:2"), dkFal("8"), noArl("8")],
  "terms.order_contract": [crd("art_8"), ecd("art_10", "art_11"), seEhandel("10", "11", "12"), seDistans("2:9"), noArl("14", "16", "18")],
  "terms.payment": [crd("art_19")],
  "terms.delivery": [crd("art_18", "art_20"), seKkl("2:1", "2:2", "2:6"), dkKob("73", "74"), noFkjl("5", "6", "7", "14")],
  "terms.withdrawal": [crd("art_9", "art_11", "art_11a", "art_12", "art_16"), seDistans("2:10", "2:10a", "2:11", "2:12"), dkFal("18", "19", "20"), noArl("20", "21", "22")],
  "terms.conformity": [sgd("art_5", "art_6", "art_7", "art_10", "art_13"), seKkl("4:1", "4:5", "5:1", "5:4", "5:8"), dkKob("75a", "76", "78"), noFkjl("15", "16", "26")],
  "terms.complaints": [sgd("art_10", "art_12"), seKkl("5:2"), dkKob("81", "83"), noFkjl("27")],
  "terms.law_and_changes": [crd("art_25"), seDistans("1:4"), dkFal("33"), noArl("3"), noFkjl("3")],
  "terms.bookings_subscriptions": [crd("art_16"), dkFal("28"), noArl("22")],
  "privacy.controller": [gdpr("art_13"), noGdpr("art_13")],
  "privacy.contact": [gdpr("art_13"), noGdpr("art_13")],
  "privacy.purposes_basis": [gdpr("art_6", "art_13"), noGdpr("art_6", "art_13")],
  "privacy.recipients": [gdpr("art_13"), noGdpr("art_13")],
  "privacy.transfers": [gdpr("art_13", "art_44"), noGdpr("art_13", "art_44")],
  "privacy.retention": [gdpr("art_5", "art_13"), noGdpr("art_5", "art_13")],
  "privacy.rights": [gdpr(...GDPR_RIGHTS), noGdpr(...GDPR_RIGHTS)],
  "privacy.consent_withdrawal": [gdpr("art_7", "art_13"), noGdpr("art_7", "art_13")],
  "privacy.complaint_authority": [gdpr("art_13", "art_77"), noGdpr("art_13", "art_77")],
  "privacy.obligation_to_provide": [gdpr("art_13"), noGdpr("art_13")],
  "privacy.automated_decisions": [gdpr("art_13", "art_22"), noGdpr("art_13", "art_22")],
  "returns_policy.window": [crd("art_9"), seDistans("2:10", "2:12"), dkFal("18", "19"), noArl("21")],
  "returns_policy.how_to": [crd("art_11", "art_11a"), seDistans("2:10", "2:10a"), dkFal("20"), noArl("20")],
  "returns_policy.who_pays": [crd("art_13", "art_14"), seDistans("2:13", "2:14"), dkFal("22", "24"), noArl("24", "25")],
  "returns_policy.refund_timing": [crd("art_13"), seDistans("2:14"), dkFal("22"), noArl("24")],
  "returns_policy.excluded_goods": [crd("art_16"), seDistans("2:11"), dkFal("18"), noArl("22")],
  "shipping_policy.rates": [crd("art_6")],
  "shipping_policy.delivery_time": [crd("art_18"), seKkl("2:2"), dkKob("74"), noFkjl("6")],
  "shipping_policy.damaged_goods": [crd("art_20"), seKkl("2:6"), dkKob("73"), noFkjl("14")],
  "withdrawal_info.right": [crd("art_9"), seDistans("2:10"), dkFal("18"), noArl("20")],
  "withdrawal_info.how": [crd("art_11", "art_11a"), seDistans("2:10", "2:10a"), dkFal("20"), noArl("20")],
  "withdrawal_info.effects": [crd("art_12", "art_13", "art_14"), seDistans("2:13", "2:14", "2:15"), dkFal("21", "22", "24"), noArl("23", "24", "25")],
  "withdrawal_info.exclusions": [crd("art_16"), seDistans("2:11"), dkFal("18"), noArl("22")],
  "withdrawal_info.model_form": [crd("anx_I", "fn_star1"), noArl("8")],
  "imprint.legal_name": [ecd("art_5"), seEhandel("8"), noEhl("8")],
  "imprint.org_number": [ecd("art_5"), seEhandel("8"), noEhl("8")],
  "imprint.vat_number": [ecd("art_5"), seEhandel("8"), noEhl("8")],
  "imprint.address": [ecd("art_5"), seEhandel("8"), noEhl("8")],
  "imprint.email": [ecd("art_5"), seEhandel("8"), noEhl("8")],
  "imprint.register": [ecd("art_5"), seEhandel("8"), noEhl("8")],
  "imprint.supervisory_authority": [ecd("art_5"), seEhandel("8"), noEhl("8")],
};

/** Every passage of a source that some topic names: what a read of it must find. */
export function passagesNamed(sourceKey: string): string[] {
  const keys = new Set<string>();
  for (const refs of Object.values(TOPIC_REFS)) for (const ref of refs) if (ref.source === sourceKey) for (const p of ref.passages) keys.add(p);
  return [...keys].sort();
}

/** A body a page names by a token code fills (`body:disputes`, …), with the address of its own page. */
export type LegalBody = { name: string; url: string };

/** Where a consumer may take a complaint about a purchase, by the seller's country: the national body first, then the European Consumer Centre. */
export const DISPUTE_BODIES: Readonly<Record<CoveredCountry, readonly LegalBody[]>> = {
  NO: [
    { name: "Forbrukerrådet", url: "https://www.forbrukerradet.no" },
    { name: "Forbrukerklageutvalget", url: "https://www.forbrukerklageutvalget.no" },
    { name: "Forbruker Europa", url: "https://www.forbrukereuropa.no" },
  ],
  SE: [
    { name: "Allmänna reklamationsnämnden (ARN)", url: "https://www.arn.se" },
    { name: "Konsument Europa", url: "https://www.konsumenteuropa.se" },
  ],
  DK: [
    { name: "Nævnenes Hus (Forbrugerklagenævnet)", url: "https://naevneneshus.dk" },
    { name: "Forbruger Europa", url: "https://www.forbrugereuropa.dk" },
  ],
};

/** The data protection authority a person may complain to (GDPR Art. 77), by the seller's country. */
export const PRIVACY_AUTHORITIES: Readonly<Record<CoveredCountry, LegalBody>> = {
  NO: { name: "Datatilsynet", url: "https://www.datatilsynet.no" },
  SE: { name: "Integritetsskyddsmyndigheten (IMY)", url: "https://www.imy.se" },
  DK: { name: "Datatilsynet", url: "https://www.datatilsynet.dk" },
};

/** The authority that supervises consumer law (an imprint's supervisory authority), by the seller's country. */
export const CONSUMER_AUTHORITIES: Readonly<Record<CoveredCountry, LegalBody>> = {
  NO: { name: "Forbrukertilsynet", url: "https://www.forbrukertilsynet.no" },
  SE: { name: "Konsumentverket", url: "https://www.konsumentverket.se" },
  DK: { name: "Forbrugerombudsmanden", url: "https://www.forbrugerombudsmanden.dk" },
};

/**
 * The jurisdictions a store's pages rest on: EU law where the seller or a market is in the EEA, the seller's own country, and each market
 * among the covered countries (a consumer keeps their own country's protections). Empty for a seller outside the covered countries.
 */
export function jurisdictionsFor(facts: { country: string | null; markets: readonly { code: string }[] }): Jurisdiction[] {
  if (!isCoveredCountry(facts.country)) return [];
  const out = new Set<Jurisdiction>();
  if (EEA.has(facts.country) || facts.markets.some((m) => EEA.has(m.code))) out.add("EU");
  out.add(facts.country);
  for (const m of facts.markets) if (isCoveredCountry(m.code)) out.add(m.code);
  return JURISDICTIONS.filter((j) => out.has(j));
}

/** The passages a topic of a kind of page may cite, for the page's jurisdictions; sources in the page's language first. */
export function refsFor(topicKey: string, jurisdictions: readonly Jurisdiction[], language: LegalLanguage): TopicRef[] {
  const refs = (TOPIC_REFS[topicKey] ?? []).filter((r) => jurisdictions.includes(LEGAL_SOURCES_BY_KEY[r.source].jurisdiction));
  const own = (r: TopicRef) => (LEGAL_SOURCES_BY_KEY[r.source].languages.includes(language) ? 0 : 1);
  return [...refs].sort((a, b) => own(a) - own(b));
}

/** The language a source is read in for a page: the page's own when the source has it, else English, else the source's first. */
export function readingLanguage(source: LegalSource, language: LegalLanguage): LegalLanguage {
  if (source.languages.includes(language)) return language;
  return source.languages.includes("en") ? "en" : source.languages[0];
}

/** What is wrong with the register itself (a test holds it empty). */
export function registerProblems(): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const s of LEGAL_SOURCES) {
    if (keys.has(s.key)) problems.push(`${s.key}: twice`);
    keys.add(s.key);
    if (s.languages.length === 0) problems.push(`${s.key}: no language`);
    if (s.route.kind === "cellar" && !/^3\d{4}[LR]\d{4}$/.test(s.route.celex)) problems.push(`${s.key}: not a CELEX number of a directive or regulation`);
    if (s.route.kind === "cellar" && s.languages.includes("nb")) problems.push(`${s.key}: EU law has no Norwegian text in Cellar`);
    if (s.route.kind === "riksdagen" && !/^sfs-\d{4}-\d+$/.test(s.route.doc)) problems.push(`${s.key}: not a Riksdagen SFS document id`);
    if (s.route.kind === "retsinformation" && !/^lta\/\d{4}\/\d+$/.test(s.route.eli)) problems.push(`${s.key}: not an ELI path`);
    if (s.route.kind === "lovdata" && !/^nl-\d{8}-\d{3}$/.test(s.route.file)) problems.push(`${s.key}: not a Lovdata open-data file name`);
    if (/odr/i.test(s.url) || /online dispute resolution/i.test(s.title)) problems.push(`${s.key}: the ODR platform is repealed`);
  }
  for (const [topic, refs] of Object.entries(TOPIC_REFS)) {
    for (const ref of refs) {
      const source = LEGAL_SOURCES_BY_KEY[ref.source];
      if (!source) problems.push(`${topic}: no source ${ref.source}`);
      if (ref.passages.length === 0) problems.push(`${topic}: ${ref.source} names no passage`);
    }
  }
  for (const bodies of [...Object.values(DISPUTE_BODIES).flat(), ...Object.values(PRIVACY_AUTHORITIES), ...Object.values(CONSUMER_AUTHORITIES)])
    if (!bodies.url.startsWith("https://") || /ec\.europa\.eu\/consumers\/odr/.test(bodies.url)) problems.push(`${bodies.name}: not an https address of its own`);
  return problems;
}
