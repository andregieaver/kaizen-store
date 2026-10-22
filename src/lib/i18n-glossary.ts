/**
 * The Norwegian glossary (D312, `docs/platform-admin-i18n.md` 5): every legal, tax, accounting, payment, consumer and privacy term the site
 * and the admin use in Norwegian, taken from the source that defines it, never translated from the English word. Each entry names its
 * source, quotes it and says when it was read; `docs/i18n/glossary-nb.md` is written from this list (`glossaryMarkdown()`), and
 * `i18n-glossary.test.ts` holds every Norwegian catalogue to it (`forbiddenUses()`): a word an entry forbids may not appear there.
 *
 * Status: `researched` (read in the source), `checked` (a person who reads Norwegian has checked it), `legal_review` (waits for the lawyer
 * before it may be used in a legal page). A term may be used in the interface once researched; in a legal page only once checked.
 */

export type GlossaryArea = "tax" | "accounting" | "consumer" | "privacy" | "marketing" | "accessibility" | "payments" | "commerce";
export type GlossaryStatus = "researched" | "checked" | "legal_review";

export type GlossarySource = {
  /** Where it was read: lovdata.no, skatteetaten.no, the authority's page. */
  url: string;
  /** The source's own words, short (25 words at most). */
  quote: string;
  /** The day it was read, YYYY-MM-DD. */
  read: string;
};

export type GlossaryEntry = {
  key: string;
  area: GlossaryArea;
  en: string;
  /** The Norwegian term as the source writes it. */
  nb: string;
  /** Other forms the catalogues may use (inflections, the abbreviation). */
  forms?: string[];
  definition: string;
  sources: GlossarySource[];
  /** Words that must not be used for this (whole words, any case). */
  avoid?: string[];
  status: GlossaryStatus;
  note?: string;
};

const READ = "2026-10-22";
const MVAL = "https://lovdata.no/lov/2009-06-19-58";
const BOKF = "https://lovdata.no/dokument/SF/forskrift/2004-12-01-1558";
const ARL = "https://lovdata.no/dokument/NL/lov/2014-06-20-27";
const FKJL = "https://lovdata.no/dokument/NL/lov/2002-06-21-34";
const GDPR = "https://lovdata.no/dokument/NL/lov/2018-06-15-38";
const PRIS = "https://lovdata.no/dokument/SF/forskrift/2012-11-14-1066";
const FAL = "https://lovdata.no/dokument/NL/lov/2020-12-18-146";
const INKL = "https://lovdata.no/dokument/NL/lov/1988-05-13-26";
const FRL = "https://lovdata.no/dokument/NL/lov/1976-12-17-100";
const FT_TERMS = "https://www.forbrukertilsynet.no/lov-og-rett/veiledninger-og-retningslinjer/standard-salgsbetingelser-for-forbrukerkjop-av-varer-over-internett";
const VIPPS = "https://help.vippsmobilepay.com/nb-NO/articles";
const SWEDBANK = "https://www.swedbankpay.no/siteassets/dokument/avtal-och-vilkar/kortinlosen/tjenestevilkar-kortinnlosning.pdf";
const SPRAK = "https://www.sprakradet.no/godt-og-korrekt-sprak/rettskriving-og-grammatikk/forkortelser/";

export const GLOSSARY_NB: readonly GlossaryEntry[] = [
  // VAT and tax ------------------------------------------------------------------------------
  {
    key: "vat",
    area: "tax",
    en: "VAT",
    nb: "merverdiavgift",
    forms: ["mva.", "mva-melding", "mva-kode"],
    definition: "The tax on sales, own use and import of goods and services. Write merverdiavgift in formal text, mva. (lower case, full stop) in running text, mva- in compounds.",
    sources: [
      { url: MVAL, quote: "Merverdiavgift er en avgift til staten som skal beregnes ved omsetning, uttak og innførsel av varer og tjenester.", read: READ },
      { url: SPRAK, quote: "mva.: merverdiavgift/meirverdiavgift", read: READ },
    ],
    avoid: ["moms"],
    status: "researched",
    note: "Capital MVA belongs only after an organisation number (see vat_registered).",
  },
  {
    key: "vat_registered",
    area: "tax",
    en: "VAT number / VAT-registered",
    nb: "registrert i Merverdiavgiftsregisteret",
    forms: ["Merverdiavgiftsregisteret", "organisasjonsnummer etterfulgt av MVA"],
    definition: "Norway has no separate VAT number: a registered business's organisation number is followed by the letters MVA (123 456 789 MVA).",
    sources: [{ url: BOKF, quote: "Dersom kjøper er registrert i Merverdiavgiftsregisteret, skal organisasjonsnummer etterfølges av bokstavene MVA.", read: READ }],
    avoid: ["momsnummer", "MVA-registeret"],
    status: "researched",
  },
  {
    key: "org_number",
    area: "accounting",
    en: "organisation number",
    nb: "organisasjonsnummer",
    forms: ["org.nr."],
    definition: "The nine-digit number from Enhetsregisteret; shown with the name on websites and business documents.",
    sources: [
      { url: "https://lovdata.no/dokument/NL/lov/2025-06-20-106", quote: "foretakets organisasjonsnummer og foretaksnavn eller navn", read: READ },
      { url: SPRAK, quote: "org.nr.: organisasjonsnummer", read: READ },
    ],
    status: "researched",
    note: "Enhetsregisteret gives the number; Foretaksregisteret is a separate register. Foretaksregisterloven of 2025 (§ 7-2) replaced the 1985 act from 1 January 2026.",
  },
  {
    key: "vat_rate",
    area: "tax",
    en: "VAT rate (standard, reduced)",
    nb: "sats",
    forms: ["alminnelig sats", "redusert sats"],
    definition: "Alminnelig sats is 25 %; the law's redusert sats covers 15 % (food) and 12 % (passenger transport and others).",
    sources: [{ url: "https://www.skatteetaten.no/satser/merverdiavgift/", quote: "Næringsmidler 15 %", read: READ }],
    avoid: ["nullsats"],
    status: "researched",
    note: "Skatteetaten names each lower rate by what it covers, the law says redusert sats.",
  },
  {
    key: "zero_rated",
    area: "tax",
    en: "zero-rated",
    nb: "fritatt",
    forms: ["fritak"],
    definition: "Inside the VAT act with no output VAT; input VAT may be deducted. Not the same as unntatt.",
    sources: [{ url: MVAL, quote: "omsetning og uttak som er omfattet av loven, men der det ikke skal beregnes utgående merverdiavgift", read: READ }],
    status: "researched",
  },
  {
    key: "exempt",
    area: "tax",
    en: "exempt (outside VAT)",
    nb: "unntatt",
    forms: ["unntak"],
    definition: "Outside the VAT act; no input VAT deduction. Never used for zero-rated.",
    sources: [{ url: MVAL, quote: "omsetning og uttak som ikke er omfattet av loven", read: READ }],
    status: "researched",
  },
  {
    key: "reverse_charge",
    area: "tax",
    en: "reverse charge",
    nb: "omvendt avgiftsplikt",
    forms: ["Omvendt avgiftsplikt – Merverdiavgift ikke beregnet"],
    definition: "The buyer calculates and pays the VAT. A sales document says so in the prescribed words «Omvendt avgiftsplikt – Merverdiavgift ikke beregnet».",
    sources: [{ url: BOKF, quote: "Omvendt avgiftsplikt – Merverdiavgift ikke beregnet", read: READ }],
    avoid: ["snudd avgift"],
    status: "researched",
    note: "Prescribed by bokføringsforskriften § 5-1-1 nr. 7; mval. § 11-1's own wording not yet read.",
  },
  {
    key: "voec",
    area: "tax",
    en: "VOEC (VAT on E-Commerce)",
    nb: "VOEC-ordningen",
    forms: ["forenklet registreringsordning", "Merverdiavgift på e-handel (VOEC)"],
    definition: "Norway's simplified scheme for foreign sellers of goods under 3 000 kroner and electronic services to Norwegian consumers. Not the EU's IOSS.",
    sources: [
      { url: "https://www.skatteetaten.no/bedrift-og-organisasjon/avgifter/mva/utland/e-handel-voec/", quote: "varer med lav verdi (under 3000 kroner)", read: READ },
      { url: MVAL, quote: "Forenklet registrerings- og rapporteringsordning for tilbydere av varer med lav verdi og elektroniske tjenester (forenklet registreringsordning)", read: READ },
    ],
    status: "researched",
  },
  {
    key: "oss",
    area: "tax",
    en: "OSS (One Stop Shop), Union and non-Union scheme",
    nb: "EUs OSS-ordning",
    forms: ["OSS"],
    definition: "The EU's scheme for declaring VAT on sales to consumers in other EU countries. No Norwegian legal term exists: the EU VAT directive is not part of the EEA agreement.",
    sources: [{ url: "https://www.skatteetaten.no/bedrift-og-organisasjon/avgifter/mva/utland/e-handel-voec/", quote: "Merverdiavgift på e-handel (VOEC)", read: READ }],
    avoid: ["unionsordningen", "ikke-unionsordningen"],
    status: "legal_review",
    note: "Keep the acronym, with «EUs» and a short explanation; never a Norwegian name of our own. An accountant confirms before use.",
  },
  {
    key: "ioss",
    area: "tax",
    en: "IOSS (Import One Stop Shop)",
    nb: "EUs IOSS-ordning",
    forms: ["IOSS"],
    definition: "The EU's import scheme for low-value consignments to EU consumers. Not Norway's VOEC.",
    sources: [{ url: "https://www.skatteetaten.no/bedrift-og-organisasjon/avgifter/mva/utland/e-handel-voec/", quote: "Merverdiavgift på e-handel (VOEC)", read: READ }],
    avoid: ["importordningen"],
    status: "legal_review",
    note: "As OSS: the acronym with «EUs», confirmed by an accountant.",
  },
  {
    key: "vat_return",
    area: "tax",
    en: "VAT return; reporting period",
    nb: "mva-melding",
    forms: ["mva-meldingen", "skattemelding for merverdiavgift", "termin", "skattleggingsperiode", "årstermin"],
    definition: "Mva-melding in the interface, skattemelding for merverdiavgift in legal text; a period of two calendar months is a termin (skattleggingsperiode in the regulation).",
    sources: [{ url: "https://lovdata.no/forskrift/2016-11-23-1360/§8-3-1", quote: "Hver skattleggingsperiode omfatter to kalendermåneder.", read: READ }],
    avoid: ["omsetningsoppgave", "MVA-oppgave", "skatteleggingsperiode"],
    status: "researched",
  },
  {
    key: "incl_excl_vat",
    area: "tax",
    en: "including / excluding VAT",
    nb: "inkl. mva.",
    forms: ["ekskl. mva.", "inkludert merverdiavgift"],
    definition: "Språkrådet's abbreviations: inkl. (inklusive, inkludert) and ekskl. (eksklusive); eks. is eksempel and must not stand for excluding.",
    sources: [
      { url: SPRAK, quote: "ekskl.: eksklusive", read: READ },
      { url: SPRAK, quote: "eks.: eksempel; eksemplar", read: READ },
    ],
    avoid: ["eks. mva."],
    status: "researched",
  },
  {
    key: "consumer_prices_incl_vat",
    area: "tax",
    en: "prices to consumers include VAT",
    nb: "Alle priser det opplyses om skal inkludere merverdiavgift og offentlige avgifter.",
    definition: "Prisopplysningsforskriften § 3: every price given to consumers includes VAT and public charges.",
    sources: [{ url: PRIS, quote: "Alle priser det opplyses om skal inkludere merverdiavgift og offentlige avgifter.", read: READ }],
    status: "researched",
  },
  {
    key: "unit_price",
    area: "tax",
    en: "unit price (per kg, litre)",
    nb: "enhetspris",
    forms: ["salgspris"],
    definition: "The full price per litre, kilo, metre and so on, beside the selling price (salgspris), given with two decimals.",
    sources: [{ url: PRIS, quote: "den fullstendige prisen som angis per liter eller kubikkmeter for varer som selges etter volum", read: READ }],
    avoid: ["kilopris"],
    status: "researched",
  },
  {
    key: "exchange_rate",
    area: "accounting",
    en: "exchange rate",
    nb: "valutakurs",
    forms: ["kurs", "kursen på fakturatidspunktet"],
    definition: "VAT on a document in a foreign currency is locked in Norwegian kroner at the rate when the invoice is made.",
    sources: [{ url: BOKF, quote: "skal fastsettes (låses) i norske kroner til kursen på fakturatidspunktet.", read: READ }],
    avoid: ["vekslingskurs"],
    status: "researched",
    note: "No Norwegian legal source names an ECB reference rate; say «ECBs referansekurs» only as a description.",
  },
  // Accounting and invoices ------------------------------------------------------------------
  {
    key: "sales_document",
    area: "accounting",
    en: "invoice; sales document",
    nb: "salgsdokument",
    forms: ["faktura", "dokumentasjonsdato"],
    definition: "The law's word for the document of a sale (faktura in everyday use); its minimum contents are bokføringsforskriften § 5-1-1.",
    sources: [{ url: BOKF, quote: "Dokumentasjon av salg av varer og tjenester skal minst inneholde:", read: READ }],
    status: "researched",
  },
  {
    key: "credit_note",
    area: "accounting",
    en: "credit note",
    nb: "kreditnota",
    definition: "Reverses a sales document in whole or in part.",
    sources: [{ url: BOKF, quote: "skal det også utstedes en kreditnota som reverserer opprinnelig salgsdokument.", read: READ }],
    avoid: ["kreditnote", "kredittnota"],
    status: "researched",
  },
  {
    key: "due_date",
    area: "accounting",
    en: "due date",
    nb: "betalingsforfall",
    forms: ["forfallsdato"],
    definition: "When payment is due; betalingsforfall in the regulation, forfallsdato also used there.",
    sources: [{ url: BOKF, quote: "vederlag og betalingsforfall, og", read: READ }],
    status: "researched",
  },
  {
    key: "retention",
    area: "accounting",
    en: "record retention",
    nb: "oppbevaringsplikt",
    forms: ["oppbevaring"],
    definition: "Primary accounting documentation is kept five years after the end of the financial year (bokføringsloven § 13).",
    sources: [{ url: "https://lovdata.no/lov/2004-11-19-73/§13", quote: "Regnskapsmateriale som nevnt i første ledd nr. 1 til 4 skal oppbevares i Norge i fem år etter regnskapsårets slutt.", read: READ }],
    status: "legal_review",
    note: "Lovdata marks § 13 as changed by the act of 19 June 2026 no. 39 from 1 January 2027; the new wording is not yet read. Never «10 år» (the rule before 2014).",
  },
  {
    key: "voucher",
    area: "tax",
    en: "gift card; single- and multi-purpose voucher",
    nb: "gavekort",
    forms: ["single-purpose voucher", "multi-purpose voucher", "kupong"],
    definition: "Skatteetaten keeps the English voucher terms; VAT on a multi-purpose voucher, such as a store's gift card, falls due when it is used.",
    sources: [
      {
        url: "https://www.skatteetaten.no/en/rettskilder/type/handboker/merverdiavgiftshandboken/gjeldende/M-1/M-1-3/M-1-3.2",
        quote: "hvor eventuell merverdiavgift beregnes først ved bruk av gavekortet",
        read: READ,
      },
    ],
    avoid: ["enkeltformålsverdikort", "flerformålsverdikort"],
    status: "researched",
    note: "From Skatteetaten's handbook (guidance), not the act.",
  },
  // Consumer law -----------------------------------------------------------------------------
  {
    key: "withdrawal",
    area: "consumer",
    en: "right of withdrawal",
    nb: "angrerett",
    forms: ["angreretten", "gå fra avtalen", "bruke angreretten"],
    definition: "The consumer's right to leave a distance or off-premises contract by notice to the trader; the law's verb is «gå fra avtalen».",
    sources: [{ url: ARL, quote: "Forbrukeren har rett til å gå fra avtalen (angrerett) ved å gi melding til den næringsdrivende", read: READ }],
    avoid: ["returrett", "avbestillingsrett"],
    status: "researched",
  },
  {
    key: "withdrawal_period",
    area: "consumer",
    en: "withdrawal period",
    nb: "angrefrist",
    forms: ["angrefristen"],
    definition: "14 days; for goods from the day the consumer gets the goods into their physical possession (angrerettloven § 21).",
    sources: [{ url: ARL, quote: "Angrefristen utløper 14 dager fra den dag … forbrukeren får varen i fysisk besittelse.", read: READ }],
    avoid: ["returfrist", "angreperiode"],
    status: "researched",
  },
  {
    key: "withdrawal_form",
    area: "consumer",
    en: "standard withdrawal form",
    nb: "angreskjema",
    forms: ["standard angreskjema"],
    definition: "The standardised form the trader gives the consumer (angrerettloven § 8 h). Its text is prescribed and copied word for word.",
    sources: [{ url: ARL, quote: "et standardisert skjema for bruk av angrerett (angreskjema)", read: READ }],
    avoid: ["returskjema", "angrerettsskjema"],
    status: "legal_review",
    note: "The regulation holding the form's text is not yet read (docs/platform-admin-i18n.md 5.2a).",
  },
  {
    key: "defect",
    area: "consumer",
    en: "defect",
    nb: "mangel",
    definition: "The legal term for what is wrong with goods (forbrukerkjøpsloven § 16).",
    sources: [{ url: FKJL, quote: "Tingen har en mangel dersom", read: READ }],
    status: "researched",
  },
  {
    key: "complaint",
    area: "consumer",
    en: "complaint about a defect",
    nb: "reklamasjon",
    forms: ["reklamere", "reklamasjonsfrist"],
    definition: "The consumer's notice of a defect: within reasonable time, at most two years from delivery, five for goods meant to last much longer (§ 27).",
    sources: [{ url: FKJL, quote: "Reklamasjon må senest skje to år etter at tingen ble levert.", read: READ }],
    status: "researched",
    note: "Two months is never too late but is not the deadline: never present it as one. Not a guarantee (garanti).",
  },
  {
    key: "terms_of_sale",
    area: "consumer",
    en: "terms of sale",
    nb: "salgsbetingelser",
    definition: "Forbrukertilsynet's word, as in its model «Standard salgsbetingelser for forbrukerkjøp av varer over Internett».",
    sources: [
      {
        url: "https://www.forbrukertilsynet.no/lov-og-rett/veiledninger-og-retningslinjer/standard-salgsbetingelser-for-forbrukerkjop-av-varer-over-internett",
        quote: "Standard salgsbetingelser for forbrukerkjøp av varer over Internett",
        read: READ,
      },
    ],
    status: "researched",
    note: "The model was not updated after the EU's modernisation directive: use it for words, not as current law.",
  },
  {
    key: "consumer",
    area: "consumer",
    en: "consumer",
    nb: "forbruker",
    definition: "A natural person not acting mainly in the course of business.",
    sources: [{ url: ARL, quote: "fysisk person som ikke hovedsakelig handler som ledd i næringsvirksomhet", read: READ }],
    status: "researched",
  },
  {
    key: "trader",
    area: "consumer",
    en: "trader; business customer",
    nb: "næringsdrivende",
    forms: ["den næringsdrivende", "selger"],
    definition: "The business party (den næringsdrivende in angrerettloven, selger in forbrukerkjøpsloven); also a business as a buyer.",
    sources: [{ url: ARL, quote: "i nærvær av den næringsdrivende", read: READ }],
    status: "researched",
  },
  {
    key: "distance_contract",
    area: "consumer",
    en: "distance contract",
    nb: "fjernsalg",
    forms: ["avtale inngått utenom faste forretningslokaler"],
    definition: "A contract made through an organised scheme for distance selling, without the parties meeting.",
    sources: [{ url: ARL, quote: "avtale inngått ved organisert ordning for salg eller tjenesteyting", read: READ }],
    status: "researched",
  },
  {
    key: "total_price",
    area: "consumer",
    en: "total price; delivery costs",
    nb: "den samlede prisen",
    forms: ["totalprisen", "leveringskostnader"],
    definition: "The price with all taxes and charges, and the costs of delivery, given before the contract (angrerettloven § 8).",
    sources: [{ url: ARL, quote: "den samlede prisen for varen eller tjenesten medregnet avgifter", read: READ }],
    status: "researched",
  },
  {
    key: "delivery",
    area: "consumer",
    en: "delivery; passing of risk",
    nb: "levering",
    forms: ["risikoen går over"],
    definition: "Delivery is when the consumer takes over the goods (forbrukerkjøpsloven § 7); risk passes then (§ 14). Sent is not delivered.",
    sources: [{ url: FKJL, quote: "Levering skjer når tingen overtas av forbrukeren.", read: READ }],
    status: "researched",
  },
  {
    key: "business_information",
    area: "consumer",
    en: "imprint (company information)",
    nb: "opplysninger om virksomheten",
    definition: "The information a web shop must always give: name, address, email address, register and organisation number (ehandelsloven § 8). The law names no page.",
    sources: [{ url: "https://lovdata.no/dokument/NL/lov/2003-05-23-35", quote: "alltid gi informasjon om navn, adresse, elektronisk postadresse", read: READ }],
    avoid: ["impressum"],
    status: "legal_review",
    note: "The page's title is to be chosen with the lawyer.",
  },
  // Personal data ----------------------------------------------------------------------------
  {
    key: "personal_data",
    area: "privacy",
    en: "personal data; data subject",
    nb: "personopplysninger",
    forms: ["den registrerte"],
    definition: "Any information about an identified or identifiable natural person (GDPR art. 4 nr. 1).",
    sources: [{ url: `${GDPR}/gdpr/ARTIKKEL_4`, quote: "«personopplysninger» enhver opplysning om en identifisert eller identifiserbar fysisk person («den registrerte»)", read: READ }],
    avoid: ["persondata"],
    status: "researched",
  },
  {
    key: "controller",
    area: "privacy",
    en: "controller; processor",
    nb: "behandlingsansvarlig",
    forms: ["databehandler"],
    definition: "Who decides the purposes and means of processing (behandlingsansvarlig), and who processes on their behalf (databehandler).",
    sources: [{ url: `${GDPR}/gdpr/ARTIKKEL_4`, quote: "«behandlingsansvarlig» en fysisk eller juridisk person, en offentlig myndighet", read: READ }],
    avoid: ["dataansvarlig"],
    status: "researched",
  },
  {
    key: "dpa",
    area: "privacy",
    en: "data processing agreement",
    nb: "databehandleravtale",
    definition: "The contract between controller and processor (GDPR art. 28, which itself says «avtale»).",
    sources: [{ url: "https://www.datatilsynet.no/", quote: "Hvordan lage en databehandleravtale?", read: READ }],
    avoid: ["databehandlingsavtale"],
    status: "legal_review",
    note: "Seen only as the title of Datatilsynet's guide in a search; to be read on its page.",
  },
  {
    key: "privacy_notice",
    area: "privacy",
    en: "privacy notice",
    nb: "personvernerklæring",
    definition: "Datatilsynet's word for the page that tells people how their personal data is used.",
    sources: [{ url: "https://www.datatilsynet.no/rettigheter-og-plikter/den-registrertes-rettigheter/rett-til-informasjon/", quote: "Ofte er dette samlet i en personvernerklæring nederst på hjemmesiden til virksomheten.", read: READ }],
    avoid: ["personvernpolicy"],
    status: "researched",
  },
  {
    key: "consent",
    area: "privacy",
    en: "consent",
    nb: "samtykke",
    definition: "A freely given, specific, informed and unambiguous indication of wishes (GDPR art. 4 nr. 11).",
    sources: [{ url: `${GDPR}/gdpr/ARTIKKEL_4`, quote: "«samtykke» fra den registrerte enhver frivillig, spesifikk, informert og utvetydig viljesytring", read: READ }],
    status: "researched",
  },
  {
    key: "data_rights",
    area: "privacy",
    en: "right of access; to erasure; to data portability",
    nb: "rett til innsyn",
    forms: ["rett til sletting («rett til å bli glemt»)", "rett til dataportabilitet"],
    definition: "The headings of GDPR articles 15, 17 and 20 in Norwegian.",
    sources: [{ url: GDPR, quote: "Rett til sletting («rett til å bli glemt»)", read: READ }],
    avoid: ["rett til tilgang"],
    status: "researched",
  },
  {
    key: "cookies",
    area: "privacy",
    en: "cookies",
    nb: "informasjonskapsler",
    forms: ["informasjonskapsler (cookies)"],
    definition: "Storing or reading information on the user's device needs consent to the GDPR's standard: ekomloven (2024) § 3-15, in force 1 January 2025.",
    sources: [
      { url: "https://lovdata.no/dokument/NL/lov/2024-12-13-76", quote: "Samtykke skal oppfylle kravene til samtykke i personvernforordningen.", read: READ },
      { url: "https://nkom.no/internett/informasjonskapsler-cookies", quote: "informasjonskapsler (cookies)", read: READ },
    ],
    status: "researched",
    note: "Never cite the old § 2-7b. § 3-15 was amended again from 1 July 2026; that amendment is not yet read.",
  },
  // Marketing --------------------------------------------------------------------------------
  {
    key: "marketing_consent",
    area: "marketing",
    en: "prior consent to marketing email",
    nb: "forutgående samtykke",
    definition: "Marketing by email to a natural person needs their prior consent (markedsføringsloven § 15).",
    sources: [{ url: "https://lovdata.no/dokument/NL/lov/2009-01-09-2", quote: "uten mottakerens forutgående samtykke", read: READ }],
    status: "researched",
  },
  {
    key: "opt_out",
    area: "marketing",
    en: "opt out",
    nb: "reservere seg",
    forms: ["reservasjon"],
    definition: "The law's words for a customer declining further marketing, which must be simple and free; a button may still say «Meld deg av».",
    sources: [{ url: "https://lovdata.no/dokument/NL/lov/2009-01-09-2", quote: "skal kunden enkelt og gebyrfritt gis anledning til å reservere seg mot slike henvendelser.", read: READ }],
    status: "researched",
  },
  // Accessibility ----------------------------------------------------------------------------
  {
    key: "accessibility_statement",
    area: "accessibility",
    en: "accessibility statement; universal design",
    nb: "tilgjengelighetserklæring",
    forms: ["universell utforming", "universell utforming av ikt"],
    definition: "A self-declaration against the requirements for universal design of ICT.",
    sources: [{ url: "https://www.uutilsynet.no/veiledning/tilgjengelighetserklaering/1127", quote: "En tilgjengelighetserklæring er en egenerklæring om kravene til universell utforming av ikt.", read: READ }],
    avoid: ["tilgjengelighetsuttalelse"],
    status: "researched",
    note: "Uutilsynet says the duty is the public sector's; whether the EU Accessibility Act's Norwegian rules now reach private web shops is to be checked.",
  },
  // Payments and shop words (D312 P0). Stripe publishes no Norwegian documentation, so nothing here cites it; every quote was read on its page.
  {
    key: "payment_method",
    area: "payments",
    en: "payment method",
    nb: "betalingsmetode",
    forms: ["betalingsmetoder", "betalingsmåte"],
    definition: "How a shopper pays: card, Vipps, Klarna and the like.",
    sources: [{ url: `${VIPPS}/payment-options-mobile-point-of-sale`, quote: "Hvilke betalingsmetoder er tilgjengelig på Vippskassa?", read: READ }],
    status: "researched",
  },
  {
    key: "payment_provider",
    area: "payments",
    en: "payment provider",
    nb: "betalingsleverandør",
    forms: ["betalingstjenesteyter"],
    definition: "The company that takes payments for the store. Legal text says betalingstjenesteyter, as finansavtaleloven does.",
    sources: [{ url: FAL, quote: "en tjenesteyter som tilbyr finansielle tjenester som er omfattet av kapittel 4", read: READ }],
    status: "researched",
  },
  {
    key: "authorise",
    area: "payments",
    en: "authorise (hold) a card payment",
    nb: "reservere",
    forms: ["reservasjon", "reservert", "autorisasjon"],
    definition: "The amount is held on the card, not yet taken. Autorisasjon only in technical or contract text.",
    sources: [
      { url: FAL, quote: "kan reservere betalingsmidler på betalerens konto", read: READ },
      { url: FT_TERMS, quote: "kan selgeren reservere kjøpesummen på kortet ved bestilling", read: READ },
    ],
    status: "researched",
  },
  {
    key: "capture",
    area: "payments",
    en: "capture a payment",
    nb: "belaste",
    forms: ["belastning", "belastet"],
    definition: "Taking money that was held.",
    sources: [{ url: FT_TERMS, quote: "Kortet blir belastet samme dag som varen sendes.", read: READ }],
    status: "researched",
  },
  {
    key: "refund",
    area: "payments",
    en: "refund",
    nb: "tilbakebetaling",
    forms: ["tilbakebetale", "refusjon", "refundere", "refunder"],
    definition: "Consumer and withdrawal text says tilbakebetaling, as angrerettloven § 24 does; the owner's admin may say refusjon and Refunder.",
    sources: [
      { url: ARL, quote: "Tilbakebetaling skal skje uten unødig opphold", read: READ },
      { url: `${VIPPS}/how-to-make-a-refund`, quote: "velg 'Refunder' etter å ha trykket på transaksjonen", read: READ },
    ],
    status: "researched",
  },
  {
    key: "chargeback",
    area: "payments",
    en: "chargeback; dispute",
    nb: "tilbakeføring",
    forms: ["tilbakedebitering", "tvist"],
    definition: "The card issuer takes a payment back; the case around it is a tvist.",
    sources: [{ url: SWEDBANK, quote: "Swedbank Pay har rett til kompensasjon for behandling av Reklamasjoner og Tilbakedebiteringer.", read: READ }],
    status: "legal_review",
    note: "No Norwegian provider defines the merchant's word; an accountant or the acquirer confirms before release.",
  },
  {
    key: "payout",
    area: "payments",
    en: "payout; settlement",
    nb: "utbetaling",
    forms: ["utbetalinger", "oppgjør", "oppgjørskonto"],
    definition: "Money the payment provider pays into the store's bank account.",
    sources: [
      { url: `${VIPPS}/receive-less-than-what-i-sold-for`, quote: "derfor er utbetalingen litt mindre enn det totale salget", read: READ },
      { url: `${VIPPS}/change-settlement-account-profile`, quote: "Hvordan endrer jeg oppgjørskonto?", read: READ },
    ],
    status: "researched",
  },
  {
    key: "balance_transaction",
    area: "payments",
    en: "balance transaction",
    nb: "postering",
    forms: ["posteringer"],
    definition: "One movement in the store's balance at the provider.",
    sources: [{ url: `${VIPPS}/understand-the-settlement-report`, quote: "Dette arket viser alle posteringer som har påvirket balansen.", read: READ }],
    avoid: ["balansetransaksjon"],
    status: "researched",
  },
  {
    key: "fee",
    area: "payments",
    en: "fee",
    nb: "gebyr",
    forms: ["gebyrer", "transaksjonsgebyr", "plattformgebyr"],
    definition: "What the provider or Kaizena Flow takes. Avgift reads as a public charge.",
    sources: [{ url: `${VIPPS}/receive-less-than-what-i-sold-for`, quote: "Vi trekker gebyr fra salget ditt", read: READ }],
    avoid: ["applikasjonsgebyr"],
    status: "researched",
  },
  {
    key: "payment_deadline",
    area: "payments",
    en: "payment deadline",
    nb: "betalingsfrist",
    definition: "The time a buyer has to pay.",
    sources: [{ url: INKL, quote: "en betalingsfrist som må ha løpt ut uten at beløpet er betalt", read: READ }],
    status: "researched",
  },
  {
    key: "reminder",
    area: "payments",
    en: "payment reminder",
    nb: "purring",
    forms: ["betalingspåminnelse"],
    definition: "The seller's own reminder; not an inkassovarsel, which is a debt-collection notice.",
    sources: [{ url: INKL, quote: "sendt skriftlig purring, eller inkassovarsel etter § 9", read: READ }],
    status: "researched",
    note: "Inkassoloven 2026 (lov 22. mai 2026 nr. 19) is not in force yet; read again when it is.",
  },
  {
    key: "late_interest",
    area: "payments",
    en: "late-payment interest",
    nb: "forsinkelsesrente",
    definition: "Interest a creditor may charge from the due date.",
    sources: [{ url: FRL, quote: "Fordringshaveren kan kreve rente etter denne lov (forsinkelsesrente)", read: READ }],
    avoid: ["morarente", "straffrente"],
    status: "researched",
  },
  {
    key: "subscription",
    area: "payments",
    en: "subscription; recurring payment",
    nb: "abonnement",
    forms: ["abonnementer", "gjentakende betaling", "betalingsavtale"],
    definition: "Paying again and again for the same thing.",
    sources: [{ url: `${VIPPS}/how-do-recurring-payments-work`, quote: "betale for abonnementer og andre faste kjøp", read: READ }],
    status: "researched",
  },
  {
    key: "test_mode",
    area: "payments",
    en: "test mode",
    nb: "testmodus",
    definition: "Payments that move no money.",
    sources: [{ url: "https://www.mollie.com/no/growth/payment-gateway-testing", quote: "Sørg for at du er i testmodus", read: READ }],
    avoid: ["sandkassemodus"],
    status: "researched",
  },
  {
    key: "order",
    area: "commerce",
    en: "order",
    nb: "bestilling",
    forms: ["bestillingen", "bestillinger", "ordre", "ordrenummer"],
    definition: "What a shopper sees always says bestilling, as angrerettloven § 16 does; the admin may say ordre for the same thing.",
    sources: [
      { url: ARL, quote: "bestillingen medfører en forpliktelse til å betale", read: READ },
      { url: FT_TERMS, quote: "Avtalen er bindende for begge parter når kjøperen har sendt sin bestilling", read: READ },
    ],
    status: "researched",
  },
  {
    key: "stock",
    area: "commerce",
    en: "stock; inventory",
    nb: "lager",
    forms: ["lagernivå", "lagerstyring", "lagerbeholdning"],
    definition: "How many of an item the store has.",
    sources: [{ url: `${VIPPS}/stock-management-mobile-point-of-sale`, quote: "Kan Vippskassa håndtere lagerstyring?", read: READ }],
    avoid: ["inventar"],
    status: "researched",
  },
  {
    key: "sku",
    area: "commerce",
    en: "SKU",
    nb: "varenummer",
    forms: ["varenummer (SKU)", "SKU"],
    definition: "The store's own code for a variant.",
    sources: [{ url: "https://www.mollie.com/no/growth/what-is-a-sku", quote: "Butikkdrivende bruker varenummer (SKU)", read: READ }],
    avoid: ["lagerenhet"],
    status: "researched",
  },
  {
    key: "online_shop",
    area: "commerce",
    en: "online shop",
    nb: "nettbutikk",
    forms: ["nettbutikken", "nettbutikker"],
    definition: "The store as shoppers see it; payment contracts call the merchant brukersted.",
    sources: [{ url: FT_TERMS, quote: "i bestillingsløsningen i nettbutikken", read: READ }],
    status: "researched",
  },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every forbidden word found in a text, with the entry that forbids it. Words are matched whole, in any case. */
export function forbiddenUses(text: string, entries: readonly GlossaryEntry[] = GLOSSARY_NB): { word: string; key: string; nb: string }[] {
  const found: { word: string; key: string; nb: string }[] = [];
  for (const entry of entries) {
    for (const word of entry.avoid ?? []) {
      if (new RegExp(`(^|[^\\p{L}])${escape(word)}(?=$|[^\\p{L}])`, "iu").test(text)) found.push({ word, key: entry.key, nb: entry.nb });
    }
  }
  return found;
}

/** What is wrong with the list itself: a missing source, a long quote, a bad date, a key twice, a forbidden word that is also a form. */
export function glossaryProblems(entries: readonly GlossaryEntry[] = GLOSSARY_NB): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const e of entries) {
    if (keys.has(e.key)) problems.push(`${e.key}: twice`);
    keys.add(e.key);
    if (e.sources.length === 0) problems.push(`${e.key}: no source`);
    for (const s of e.sources) {
      if (!/^https:\/\//.test(s.url)) problems.push(`${e.key}: ${s.url} is not an https address`);
      if (s.quote.trim().split(/\s+/).length > 25) problems.push(`${e.key}: a quote longer than 25 words`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.read)) problems.push(`${e.key}: the date read is not YYYY-MM-DD`);
    }
    const forms = [e.nb, ...(e.forms ?? [])].map((f) => f.toLowerCase());
    for (const word of e.avoid ?? []) if (forms.includes(word.toLowerCase())) problems.push(`${e.key}: "${word}" is both a form and avoided`);
  }
  return problems;
}

const AREA_TITLES: Record<GlossaryArea, string> = {
  tax: "VAT and tax",
  accounting: "Accounting and invoices",
  consumer: "Consumer law",
  privacy: "Personal data",
  marketing: "Marketing",
  accessibility: "Accessibility",
  payments: "Payments",
  commerce: "Shop words",
};

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** `docs/i18n/glossary-nb.md`, written from the list: one table per area. */
export function glossaryMarkdown(entries: readonly GlossaryEntry[] = GLOSSARY_NB): string {
  const lines = [
    "# Norwegian glossary (D312)",
    "",
    "Written from `src/lib/i18n-glossary.ts` by its test (`WRITE_GLOSSARY=1 pnpm exec vitest run src/lib/i18n-glossary.test.ts`); never edit it by hand.",
    "Every term is taken from the source that defines it (`docs/platform-admin-i18n.md` 5). Status: researched, checked by a person, or",
    "waiting for the lawyer (legal review). A term is used in a legal page only once checked.",
    "",
  ];
  for (const area of Object.keys(AREA_TITLES) as GlossaryArea[]) {
    const rows = entries.filter((e) => e.area === area);
    if (rows.length === 0) continue;
    lines.push(`## ${AREA_TITLES[area]}`, "", "| English | Norwegian | Meaning | Not | Source | Status |", "|---|---|---|---|---|---|");
    for (const e of rows) {
      const nb = [e.nb, ...(e.forms ?? [])].join(", ");
      const sources = e.sources.map((s) => `[${new URL(s.url).hostname}](${s.url}) (${s.read}): «${s.quote}»`).join("<br>");
      const meaning = e.note ? `${e.definition} ${e.note}` : e.definition;
      lines.push(`| ${cell(e.en)} | ${cell(nb)} | ${cell(meaning)} | ${cell((e.avoid ?? []).join(", "))} | ${cell(sources)} | ${e.status} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
