/**
 * The law's own words for Norwegian legal pages (D312, docs/platform-admin-i18n.md 5.2a): where a legal page or a store's Norwegian
 * legal starter says what the law gives or requires, it starts from these passages as Lovdata has them, citing the section.
 *
 * Every passage was read on lovdata.no on the date given. Lovdata refuses plain downloads, so they were read through a tool that
 * returns short pieces and joined; `proofread` stays false until a person has compared the passage with Lovdata letter by letter.
 * A passage the read garbled is left out (named in `note`), never guessed. Prescribed texts (`prescribed: true`) are copied word for
 * word into the pages that use them; the standard withdrawal form is not here: its regulation only points to the directive's
 * annex, which Lovdata does not hold, and its source is the owner's decision.
 */

export type LegalPassage = {
  key: string;
  /** The act's short name and number as Lovdata gives it. */
  statute: string;
  /** The section or article, as cited on a page: `angrerettloven § 20`. */
  cite: string;
  url: string;
  /** YYYY-MM-DD. A passage older than a year is listed for reading again (`staleWording()`). */
  read: string;
  /** The passage as Lovdata has it, or the section's title where only the title is used. */
  text: string;
  /** A text a law or regulation prescribes word for word; a page that uses it copies it exactly. */
  prescribed: boolean;
  /** A person has compared it with Lovdata letter by letter. */
  proofread: boolean;
  note?: string;
};

const READ = "2026-10-22";
const ARL = "https://lovdata.no/dokument/NL/lov/2014-06-20-27";
const FKJL = "https://lovdata.no/dokument/NL/lov/2002-06-21-34";
const EKOM = "https://lovdata.no/dokument/NL/lov/2024-12-13-76/KAPITTEL_3";
const EHL = "https://lovdata.no/dokument/NL/lov/2003-05-23-35";
const FORSKRIFT = "https://lovdata.no/dokument/SF/forskrift/2014-06-20-777";
const GDPR = (article: number) => `https://lovdata.no/dokument/NL/lov/2018-06-15-38/gdpr/ARTIKKEL_${article}`;

const ARL_NAME = "angrerettloven (LOV-2014-06-20-27)";
const FKJL_NAME = "forbrukerkjøpsloven (LOV-2002-06-21-34)";
const GDPR_NAME = "personvernforordningen (personopplysningsloven LOV-2018-06-15-38)";

const passage = (p: Omit<LegalPassage, "read" | "prescribed" | "proofread"> & Partial<Pick<LegalPassage, "prescribed">>): LegalPassage => ({
  prescribed: false,
  proofread: false,
  read: READ,
  ...p,
});

export const LEGAL_WORDING_NB: readonly LegalPassage[] = [
  passage({
    key: "arl_8_withdrawal_info",
    statute: ARL_NAME,
    cite: "angrerettloven § 8 første ledd bokstav h",
    url: ARL,
    text: "at det foreligger angrerett samt vilkårene, tidsfristene og fremgangsmåtene for å bruke angreretten",
  }),
  passage({
    key: "arl_8_form",
    statute: ARL_NAME,
    cite: "angrerettloven § 8",
    url: ARL,
    text: "Den næringsdrivende skal også gi forbrukeren et standardisert skjema for bruk av angrerett (angreskjema)",
  }),
  passage({
    key: "arl_20",
    statute: ARL_NAME,
    cite: "angrerettloven § 20",
    url: ARL,
    text:
      "Forbrukeren har rett til å gå fra avtalen (angrerett) ved å gi melding til den næringsdrivende før utløpet av angrefristen, jf. § 21. " +
      "Meldingen kan fremsettes ved bruk av utfylt angreskjema eller ved fremsettelse av annen utvetydig erklæring.",
    note: "LOV-2026-06-19-34 changes § 20 and adds § 20 a (an electronic withdrawal function) from a date the King sets; read again then.",
  }),
  passage({
    key: "arl_21_1",
    statute: ARL_NAME,
    cite: "angrerettloven § 21 første ledd",
    url: ARL,
    text: "Angrefristen utløper 14 dager fra den dag avtalen om tjeneste ble inngått, eller den dag forbrukeren får varen i fysisk besittelse.",
    note: "The lead-in to letters a to c (several deliveries, parts, regular delivery) came back garbled and is left out until read by a person.",
  }),
  passage({
    key: "arl_24_1",
    statute: ARL_NAME,
    cite: "angrerettloven § 24 første ledd",
    url: ARL,
    text:
      "Den næringsdrivende skal tilbakeføre alle betalinger som er mottatt fra forbrukeren. Dersom forbrukeren uttrykkelig har valgt en annen type " +
      "levering enn standardleveringen som den næringsdrivende tilbød, skal den næringsdrivende likevel ikke betale tilleggskostnadene dette medførte.",
  }),
  passage({
    key: "arl_24_2",
    statute: ARL_NAME,
    cite: "angrerettloven § 24 annet ledd",
    url: ARL,
    text:
      "Tilbakebetaling skal skje uten unødig opphold, og senest 14 dager fra da den næringsdrivende fikk melding om forbrukerens beslutning om å " +
      "benytte angreretten etter § 20. Med mindre noe annet uttrykkelig er avtalt med forbrukeren, skal tilbakebetalingen skje ved bruk av samme " +
      "betalingsmiddel som forbrukeren benyttet. Forbrukeren skal ikke betale noen form for gebyr som følge av tilbakebetalingen.",
    note: "The later paragraphs (holding the refund back until the goods are returned) are not read yet.",
  }),
  passage({
    key: "fkjl_26",
    statute: FKJL_NAME,
    cite: "forbrukerkjøpsloven § 26",
    url: FKJL,
    text:
      "Dersom det foreligger en mangel og dette ikke skyldes forbrukeren eller forhold på forbrukerens side, kan forbrukeren " +
      "a. holde kjøpesummen tilbake etter § 28 b. velge mellom retting og omlevering i samsvar med §§ 29 og 30 c. kreve prisavslag etter § 31 " +
      "d. kreve heving etter § 32 e. kreve erstatning etter § 33.",
    note: "The read also gave «Partene kan avtale en annen løsning.», out of place in a mandatory law; left out until a person reads the section.",
  }),
  passage({
    key: "fkjl_27_1",
    statute: FKJL_NAME,
    cite: "forbrukerkjøpsloven § 27 første ledd",
    url: FKJL,
    text:
      "Dersom det foreligger en mangel ved tingen, må forbrukeren innen rimelig tid etter at han eller hun oppdaget eller burde ha oppdaget den, " +
      "gi selgeren melding om at han eller hun vil påberope seg mangelen (reklamasjon). Denne fristen for å reklamere kan aldri være kortere enn " +
      "to måneder fra det tidspunkt da forbrukeren oppdaget mangelen.",
  }),
  passage({
    key: "fkjl_27_2",
    statute: FKJL_NAME,
    cite: "forbrukerkjøpsloven § 27 annet ledd",
    url: FKJL,
    text:
      "Reklamasjon må senest skje to år etter at tingen ble levert. Dersom tingen eller deler av den ved vanlig bruk er ment å vare vesentlig " +
      "lenger, er fristen for å reklamere fem år.",
    note: "The rest of the paragraph (updates and digital content, guarantees, § 16 d) is in the read but not needed by the pages yet.",
  }),
  passage({
    key: "ekom_3_15_1",
    statute: "ekomloven (LOV-2024-12-13-76)",
    cite: "ekomloven § 3-15 første ledd",
    url: EKOM,
    text:
      "Det er ikke tillatt å lagre eller å skaffe seg tilgang til opplysninger i sluttbrukers eller brukers kommunikasjonsutstyr uten at den " +
      "aktuelle sluttbrukeren eller brukeren er informert om blant annet hvilke opplysninger som behandles, formålet med behandlingen og hvem som " +
      "behandler opplysningene, og uten at den aktuelle sluttbrukeren eller brukeren har gitt samtykke. Samtykke skal oppfylle kravene til " +
      "samtykke i personvernforordningen.",
    note: "Replaces ekomloven 2003 § 2-7b, which a page never cites.",
  }),
  passage({
    key: "ekom_3_15_2",
    statute: "ekomloven (LOV-2024-12-13-76)",
    cite: "ekomloven § 3-15 andre ledd",
    url: EKOM,
    text:
      "Første ledd gjelder ikke for teknisk lagring av eller adgang til opplysninger a. utelukkende for det formål å overføre kommunikasjon i et " +
      "elektronisk kommunikasjonsnett, eller b. som er strengt nødvendig for å levere en informasjonssamfunnstjeneste etter den aktuelle " +
      "sluttbrukerens eller brukerens uttrykkelige forespørsel.",
  }),
  passage({
    key: "ehl_8_1",
    statute: "ehandelsloven (LOV-2003-05-23-35)",
    cite: "ehandelsloven § 8 første ledd",
    url: EHL,
    text:
      "En tjenesteyter skal ved utøving av sin virksomhet alltid gi informasjon om navn, adresse, elektronisk postadresse og øvrige opplysninger " +
      "som gjør det mulig å komme i direkte forbindelse med tjenesteyteren. I tillegg skal tjenesteyteren opplyse om: a. det foretaksregister " +
      "hvor tjenesteyteren er registrert, samt tjenesteyterens organisasjonsnummer og om virksomheten er merverdiavgiftspliktig, og b. eventuelle " +
      "godkjenninger som kreves for å utføre virksomheten og navn og adresse på den aktuelle godkjenningsmyndigheten.",
  }),
  passage({
    key: "ehl_8_3",
    statute: "ehandelsloven (LOV-2003-05-23-35)",
    cite: "ehandelsloven § 8 tredje ledd",
    url: EHL,
    text: "Informasjonen etter første og andre ledd skal gjøres enkelt og direkte tilgjengelig for tjenestemottakere og offentlige myndigheter.",
  }),
  passage({
    key: "forskrift_1",
    statute: "forskrift om opplysningsplikt og angrerett mv. (FOR-2014-06-20-777)",
    cite: "forskrift om opplysningsplikt og angrerett mv. § 1",
    url: FORSKRIFT,
    text:
      "Forbrukeren skal ved avtaler der forbrukeren har angrerett i medhold av angrerettloven motta standardisert skjema for bruk av angrerett " +
      "(angreskjema). Ved avtaler om varer og tjenester som ikke er finansielle tjenester, skal angreskjemaet tilsvare malen inntatt i " +
      "forbrukerrettighetsdirektivet (Europaparlaments- og Rådsdirektiv 2011/83/EU) vedlegg 1 B.",
    note: "The form itself is the directive's Annex I B, which Lovdata does not hold; its Norwegian source waits for the owner.",
  }),
  passage({
    key: "forskrift_2",
    statute: "forskrift om opplysningsplikt og angrerett mv. (FOR-2014-06-20-777)",
    cite: "forskrift om opplysningsplikt og angrerett mv. § 2",
    url: FORSKRIFT,
    text:
      "Ved avtaler om varer og tjenester som ikke er finansielle tjenester, kan den næringsdrivende gi forbrukeren opplysningsskjema for angrerett " +
      "som tilsvarer malen inntatt i forbrukerrettighetsdirektivet (Europaparlaments- og Rådsdirektiv 2011/83/EU) vedlegg 1 A.",
  }),
  ...(
    [
      [13, "Informasjon som skal gis ved innsamling av personopplysninger fra den registrerte"],
      [14, "Informasjon som skal gis dersom personopplysninger ikke er blitt samlet inn fra den registrerte"],
      [15, "Den registrertes rett til innsyn"],
      [16, "Rett til retting"],
      [17, "Rett til sletting («rett til å bli glemt»)"],
      [18, "Rett til begrensning av behandling"],
      [20, "Rett til dataportabilitet"],
      [21, "Rett til å protestere"],
    ] as const
  ).map(([article, title]) =>
    passage({ key: `gdpr_${article}`, statute: GDPR_NAME, cite: `personvernforordningen artikkel ${article}`, url: GDPR(article), text: title }),
  ),
];

/** The passages read more than a year before `today` (YYYY-MM-DD), to read again on Lovdata. */
export function staleWording(today: string, passages: readonly LegalPassage[] = LEGAL_WORDING_NB): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const yearAgo = new Date(Date.UTC(y - 1, m - 1, d)).toISOString().slice(0, 10);
  return passages.filter((p) => p.read < yearAgo).map((p) => p.key);
}

/** What is wrong with the record itself: keys, addresses, dates and citations. */
export function wordingProblems(passages: readonly LegalPassage[] = LEGAL_WORDING_NB): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const p of passages) {
    if (keys.has(p.key)) problems.push(`${p.key}: twice`);
    keys.add(p.key);
    if (!p.url.startsWith("https://lovdata.no/")) problems.push(`${p.key}: not a Lovdata address`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.read)) problems.push(`${p.key}: the date read is not YYYY-MM-DD`);
    if (!/(§|artikkel) \d/.test(p.cite)) problems.push(`${p.key}: the citation names no section`);
    if (p.text.trim() !== p.text || p.text.length === 0) problems.push(`${p.key}: the text is empty or padded`);
    if (/§ 2-7b/.test(p.cite)) problems.push(`${p.key}: ekomloven § 2-7b is repealed; cite § 3-15`);
  }
  return problems;
}

/** The prescribed passages a text holds differently: each prescribed passage whose citation the text names must be in it word for word. */
export function misquotedPrescribed(text: string, passages: readonly LegalPassage[] = LEGAL_WORDING_NB): string[] {
  return passages.filter((p) => p.prescribed && text.includes(p.cite) && !text.includes(p.text)).map((p) => p.key);
}
