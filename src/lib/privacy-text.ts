/**
 * What the privacy features say (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.2, 2.4, 2.6 and 8).
 *
 * LEGAL TEXT. Hand-written in nb, sv, da and en, plain and careful, never machine-translated and never claimed to be legal advice. It is
 * deliberately not part of `i18n.ts`'s messages, so the AI catalogue (`ui-catalog.ts`) never sees it, and every other language shows the
 * English words. No string puts a free-text field (a name, a note, a reason a person typed) inside a statutory sentence: such a field is
 * printed on its own, as text, under a label. Dates arrive already written (`formatPrivacyDay()`), counts as numbers.
 *
 * Needs review by a lawyer in each country before real use (docs/wave-1g-gdpr.md section 8: items 1 to 5, 7, 8 and 10).
 */
import type { EmailContent } from "./email-layout";
import { languageOfLocale } from "./invoice-snapshot";
import { REFUSAL_REASONS, type RefusalReason } from "./privacy-request";

export type PrivacyLanguage = "nb" | "sv" | "da" | "en";
export const PRIVACY_LANGUAGES: readonly PrivacyLanguage[] = ["nb", "sv", "da", "en"];

/** The four hand-written languages; every other locale shows English. */
export const privacyLanguage = (locale: string | null | undefined): PrivacyLanguage => languageOfLocale(locale);

const INTL: Record<PrivacyLanguage, string> = { nb: "nb-NO", sv: "sv-SE", da: "da-DK", en: "en-GB" };

/** A `YYYY-MM-DD` day written for the reader: `1. januar 2032`, `1 January 2032`. */
export function formatPrivacyDay(day: string, lang: PrivacyLanguage): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Intl.DateTimeFormat(INTL[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The data protection authority a person may complain to, by the store's country (the store's own, when it has named one, wins). */
export function supervisoryAuthority(country: string | null | undefined, lang: PrivacyLanguage, own?: string | null): string {
  if (own && own.trim()) return own.trim();
  switch ((country ?? "").toUpperCase()) {
    case "NO":
      return "Datatilsynet";
    case "SE":
      return lang === "sv" ? "Integritetsskyddsmyndigheten (IMY)" : "Integritetsskyddsmyndigheten (IMY)";
    case "DK":
      return "Datatilsynet";
    default:
      return { nb: "personvernmyndigheten i ditt land", sv: "dataskyddsmyndigheten i ditt land", da: "databeskyttelsesmyndigheden i dit land", en: "the data protection authority in your country" }[lang];
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The shopper's pages: "Your data" card, the step-up, the delete page and its result
// ---------------------------------------------------------------------------------------------------------------------------------

// legal: needs review
export type ShopperPrivacyText = {
  cardTitle: string;
  cardIntro: (store: string) => string;
  downloadHeading: string;
  downloadText: string;
  downloadButton: string;
  deleteHeading: string;
  deleteText: string;
  deleteButton: string;
  stepUpHeading: string;
  stepUpText: string;
  stepUpSendCode: string;
  stepUpCodeSent: string;
  stepUpCodeLabel: string;
  stepUpPasswordLabel: string;
  stepUpConfirm: string;
  stepUpWrong: string;
  deleteTitle: string;
  deleteIntro: (store: string) => string;
  goesHeading: string;
  goesItems: string[];
  staysHeading: string;
  staysOrders: (count: number, until: string) => string;
  staysOptOut: string;
  subscriptionsEnd: (count: number) => string;
  cardsRemoved: (count: number) => string;
  bonusLost: (amounts: string) => string;
  stripeNote: string;
  irreversible: string;
  confirmButton: string;
  backLink: string;
  doneTitle: string;
  doneText: string;
  /** The same, when the confirmation email could not be sent (never claim an email that was not sent). */
  doneTextNoEmail: string;
  doneKept: (count: number, until: string) => string;
  doneEmail: string;
  staleSession: string;
  stripeFailed: string;
  failed: string;
  tooLarge: string;
  tooMany: string;
};

const SHOPPER: Record<PrivacyLanguage, ShopperPrivacyText> = {
  nb: {
    cardTitle: "Dine data",
    cardIntro: (store) => `Du kan laste ned en kopi av opplysningene ${store} har om deg, eller slette kontoen din.`,
    downloadHeading: "Last ned dataene dine",
    downloadText: "Du får én fil med opplysningene butikken har om deg: profil, adresser, bestillinger, retur og angrerett, abonnementer, ønskelister, bonus, samtykker, e-poster og handlekurver. Filen sendes ikke på e-post.",
    downloadButton: "Last ned dataene mine",
    deleteHeading: "Slett kontoen min",
    deleteText: "Kontoen og opplysningene som ikke må beholdes, slettes. Du ser først hva som slettes og hva som beholdes.",
    deleteButton: "Gå videre til sletting",
    stepUpHeading: "Bekreft at det er deg",
    stepUpText: "For å vise eller slette dataene dine må du ha logget inn de siste ti minuttene. Be om en engangskode på e-post, eller skriv inn passordet ditt.",
    stepUpSendCode: "Send meg en kode",
    stepUpCodeSent: "Vi har sendt en kode til e-postadressen du er registrert med.",
    stepUpCodeLabel: "Kode",
    stepUpPasswordLabel: "Passord",
    stepUpConfirm: "Bekreft",
    stepUpWrong: "Koden eller passordet stemte ikke. Prøv igjen.",
    deleteTitle: "Slett kontoen din",
    deleteIntro: (store) => `Dette sletter kontoen din hos ${store}. Les hva som skjer før du bekrefter.`,
    goesHeading: "Dette slettes nå",
    goesItems: ["Kontoen din med navn, telefon, adresse og bilde", "Passord og pålogginger", "Ønskelister og faste leveringslister", "Handlekurver knyttet til deg", "E-poster du har fått, med innholdet i dem", "Skjemaer du har sendt inn"],
    staysHeading: "Dette beholdes",
    staysOrders: (count, until) =>
      `${count} ${count === 1 ? "bestilling" : "bestillinger"} beholdes av butikken til ${until}, fordi bokføringsloven krever det. Bestillingene kobles fra deg og brukes ikke til noe annet. Etter denne datoen fjernes navn, adresse og e-postadresse. Beløp, dato og varer beholdes uten navn.`,
    staysOptOut: "Hvis du har sagt nei til e-post fra butikken, beholdes e-postadressen din bare som en sperre, slik at du ikke får e-post igjen.",
    subscriptionsEnd: (count) => `${count === 1 ? "Abonnementet ditt avsluttes" : `${count} abonnementer avsluttes`} nå og refunderes ikke.`,
    cardsRemoved: (count) => `${count === 1 ? "Betalingskortet ditt fjernes" : `${count} betalingskort fjernes`} fra butikkens faste leveringer.`,
    bonusLost: (amounts) => `Bonuspoengene dine (${amounts}) mistes.`,
    stripeNote: "Betalingsleverandøren Stripe beholder sine egne betalingsopplysninger etter egne regler. Disse slettes ikke her.",
    irreversible: "Dette kan ikke angres.",
    confirmButton: "Slett kontoen min",
    backLink: "Avbryt",
    doneTitle: "Kontoen din er slettet",
    doneText: "Kontoen din er slettet, og du er logget ut. Vi har sendt deg en bekreftelse på e-post.",
    doneTextNoEmail: "Kontoen din er slettet, og du er logget ut.",
    doneKept: (count, until) => `${count === 1 ? "Én bestilling" : `${count} bestillinger`} beholdes til ${until} på grunn av bokføringsloven, uten kobling til deg.`,
    doneEmail: "Bekreftelsen sendes til e-postadressen du var registrert med.",
    staleSession: "Du må bekrefte at det er deg før du kan fortsette.",
    stripeFailed: "Stripe svarte ikke. Ingenting er endret. Prøv igjen.",
    failed: "Noe gikk galt. Prøv igjen om litt. Hvis det fortsetter, kontakt butikken.",
    tooLarge: "Det er for mye data til å lage én fil. Kontakt butikken, så hjelper de deg.",
    tooMany: "Du har lastet ned dataene dine mange ganger den siste timen. Vent litt og prøv igjen.",
  },
  sv: {
    cardTitle: "Dina uppgifter",
    cardIntro: (store) => `Du kan ladda ner en kopia av de uppgifter ${store} har om dig, eller radera ditt konto.`,
    downloadHeading: "Ladda ner dina uppgifter",
    downloadText: "Du får en fil med de uppgifter butiken har om dig: profil, adresser, beställningar, retur och ångerrätt, prenumerationer, önskelistor, bonus, samtycken, e-post och varukorgar. Filen skickas inte med e-post.",
    downloadButton: "Ladda ner mina uppgifter",
    deleteHeading: "Radera mitt konto",
    deleteText: "Kontot och de uppgifter som inte måste sparas raderas. Du ser först vad som raderas och vad som sparas.",
    deleteButton: "Gå vidare till radering",
    stepUpHeading: "Bekräfta att det är du",
    stepUpText: "För att visa eller radera dina uppgifter måste du ha loggat in de senaste tio minuterna. Be om en engångskod med e-post eller skriv ditt lösenord.",
    stepUpSendCode: "Skicka en kod till mig",
    stepUpCodeSent: "Vi har skickat en kod till den e-postadress du är registrerad med.",
    stepUpCodeLabel: "Kod",
    stepUpPasswordLabel: "Lösenord",
    stepUpConfirm: "Bekräfta",
    stepUpWrong: "Koden eller lösenordet stämde inte. Försök igen.",
    deleteTitle: "Radera ditt konto",
    deleteIntro: (store) => `Det här raderar ditt konto hos ${store}. Läs vad som händer innan du bekräftar.`,
    goesHeading: "Det här raderas nu",
    goesItems: ["Ditt konto med namn, telefon, adress och bild", "Lösenord och inloggningar", "Önskelistor och fasta leveranslistor", "Varukorgar som är kopplade till dig", "E-post du har fått, med innehållet", "Formulär du har skickat in"],
    staysHeading: "Det här sparas",
    staysOrders: (count, until) =>
      `${count} ${count === 1 ? "beställning" : "beställningar"} sparas av butiken till ${until}, eftersom bokföringslagen kräver det. Beställningarna kopplas bort från dig och används inte till något annat. Efter det datumet tas namn, adress och e-postadress bort. Belopp, datum och varor sparas utan namn.`,
    staysOptOut: "Om du har tackat nej till e-post från butiken sparas din e-postadress bara som en spärr, så att du inte får e-post igen.",
    subscriptionsEnd: (count) => `${count === 1 ? "Din prenumeration avslutas" : `${count} prenumerationer avslutas`} nu och återbetalas inte.`,
    cardsRemoved: (count) => `${count === 1 ? "Ditt betalkort tas bort" : `${count} betalkort tas bort`} från butikens fasta leveranser.`,
    bonusLost: (amounts) => `Dina bonuspoäng (${amounts}) förloras.`,
    stripeNote: "Betalningsleverantören Stripe sparar sina egna betaluppgifter enligt egna regler. De raderas inte här.",
    irreversible: "Det här går inte att ångra.",
    confirmButton: "Radera mitt konto",
    backLink: "Avbryt",
    doneTitle: "Ditt konto är raderat",
    doneText: "Ditt konto är raderat och du är utloggad. Vi har skickat en bekräftelse med e-post.",
    doneTextNoEmail: "Ditt konto är raderat och du är utloggad.",
    doneKept: (count, until) => `${count === 1 ? "En beställning" : `${count} beställningar`} sparas till ${until} på grund av bokföringslagen, utan koppling till dig.`,
    doneEmail: "Bekräftelsen skickas till den e-postadress du var registrerad med.",
    staleSession: "Du måste bekräfta att det är du innan du kan fortsätta.",
    stripeFailed: "Stripe svarade inte. Inget har ändrats. Försök igen.",
    failed: "Något gick fel. Försök igen om en stund. Om det fortsätter, kontakta butiken.",
    tooLarge: "Det är för mycket data för att göra en fil. Kontakta butiken, så hjälper de dig.",
    tooMany: "Du har laddat ner dina uppgifter många gånger den senaste timmen. Vänta en stund och försök igen.",
  },
  da: {
    cardTitle: "Dine data",
    cardIntro: (store) => `Du kan hente en kopi af de oplysninger, ${store} har om dig, eller slette din konto.`,
    downloadHeading: "Hent dine data",
    downloadText: "Du får én fil med de oplysninger, butikken har om dig: profil, adresser, bestillinger, retur og fortrydelsesret, abonnementer, ønskelister, bonus, samtykker, e-mails og indkøbskurve. Filen sendes ikke på e-mail.",
    downloadButton: "Hent mine data",
    deleteHeading: "Slet min konto",
    deleteText: "Kontoen og de oplysninger, der ikke skal opbevares, slettes. Du ser først, hvad der slettes, og hvad der opbevares.",
    deleteButton: "Gå videre til sletning",
    stepUpHeading: "Bekræft, at det er dig",
    stepUpText: "For at se eller slette dine data skal du have logget ind inden for de seneste ti minutter. Bed om en engangskode på e-mail, eller skriv din adgangskode.",
    stepUpSendCode: "Send mig en kode",
    stepUpCodeSent: "Vi har sendt en kode til den e-mailadresse, du er registreret med.",
    stepUpCodeLabel: "Kode",
    stepUpPasswordLabel: "Adgangskode",
    stepUpConfirm: "Bekræft",
    stepUpWrong: "Koden eller adgangskoden passede ikke. Prøv igen.",
    deleteTitle: "Slet din konto",
    deleteIntro: (store) => `Det her sletter din konto hos ${store}. Læs, hvad der sker, før du bekræfter.`,
    goesHeading: "Det her slettes nu",
    goesItems: ["Din konto med navn, telefon, adresse og billede", "Adgangskode og logins", "Ønskelister og faste leveringslister", "Indkøbskurve, der er knyttet til dig", "E-mails, du har fået, med indholdet", "Formularer, du har sendt"],
    staysHeading: "Det her opbevares",
    staysOrders: (count, until) =>
      `${count} ${count === 1 ? "bestilling" : "bestillinger"} opbevares af butikken til ${until}, fordi bogføringsloven kræver det. Bestillingerne kobles fra dig og bruges ikke til andet. Efter den dato fjernes navn, adresse og e-mailadresse. Beløb, dato og varer opbevares uden navn.`,
    staysOptOut: "Hvis du har sagt nej til e-mails fra butikken, opbevares din e-mailadresse kun som en spærring, så du ikke får e-mails igen.",
    subscriptionsEnd: (count) => `${count === 1 ? "Dit abonnement afsluttes" : `${count} abonnementer afsluttes`} nu og refunderes ikke.`,
    cardsRemoved: (count) => `${count === 1 ? "Dit betalingskort fjernes" : `${count} betalingskort fjernes`} fra butikkens faste leveringer.`,
    bonusLost: (amounts) => `Dine bonuspoint (${amounts}) mistes.`,
    stripeNote: "Betalingsleverandøren Stripe opbevarer sine egne betalingsoplysninger efter egne regler. De slettes ikke her.",
    irreversible: "Det kan ikke fortrydes.",
    confirmButton: "Slet min konto",
    backLink: "Annuller",
    doneTitle: "Din konto er slettet",
    doneText: "Din konto er slettet, og du er logget ud. Vi har sendt dig en bekræftelse på e-mail.",
    doneTextNoEmail: "Din konto er slettet, og du er logget ud.",
    doneKept: (count, until) => `${count === 1 ? "Én bestilling" : `${count} bestillinger`} opbevares til ${until} på grund af bogføringsloven, uden kobling til dig.`,
    doneEmail: "Bekræftelsen sendes til den e-mailadresse, du var registreret med.",
    staleSession: "Du skal bekræfte, at det er dig, før du kan fortsætte.",
    stripeFailed: "Stripe svarede ikke. Intet er ændret. Prøv igen.",
    failed: "Noget gik galt. Prøv igen om lidt. Hvis det fortsætter, så kontakt butikken.",
    tooLarge: "Der er for mange data til at lave én fil. Kontakt butikken, så hjælper de dig.",
    tooMany: "Du har hentet dine oplysninger mange gange den seneste time. Vent lidt og prøv igen.",
  },
  en: {
    cardTitle: "Your data",
    cardIntro: (store) => `You can download a copy of the information ${store} holds about you, or delete your account.`,
    downloadHeading: "Download your data",
    downloadText: "You get one file with the information the shop holds about you: profile, addresses, orders, returns and withdrawals, subscriptions, wishlists, bonus, consents, emails and carts. The file is not sent by email.",
    downloadButton: "Download my data",
    deleteHeading: "Delete my account",
    deleteText: "Your account and the information that does not have to be kept are deleted. You see first what is deleted and what is kept.",
    deleteButton: "Continue to deletion",
    stepUpHeading: "Confirm it is you",
    stepUpText: "To see or delete your data you must have signed in within the last ten minutes. Ask for a one-time code by email, or type your password.",
    stepUpSendCode: "Send me a code",
    stepUpCodeSent: "We have sent a code to the email address you are registered with.",
    stepUpCodeLabel: "Code",
    stepUpPasswordLabel: "Password",
    stepUpConfirm: "Confirm",
    stepUpWrong: "The code or password was not right. Try again.",
    deleteTitle: "Delete your account",
    deleteIntro: (store) => `This deletes your account at ${store}. Read what happens before you confirm.`,
    goesHeading: "This is deleted now",
    goesItems: ["Your account with name, phone, address and picture", "Your password and sign-ins", "Wishlists and standing delivery lists", "Carts linked to you", "Emails you were sent, with their contents", "Forms you sent in"],
    staysHeading: "This is kept",
    staysOrders: (count, until) =>
      `${count} ${count === 1 ? "order is" : "orders are"} kept by the shop until ${until}, because bookkeeping law requires it. They are cut loose from you and used for nothing else. After that date your name, address and email are removed. The amounts, date and goods stay without a name.`,
    staysOptOut: "If you have said no to emails from the shop, your email address is kept only as a block, so that you are not emailed again.",
    subscriptionsEnd: (count) => `${count === 1 ? "Your subscription ends" : `${count} subscriptions end`} now and ${count === 1 ? "is" : "are"} not refunded.`,
    cardsRemoved: (count) => `${count === 1 ? "Your saved card is" : `${count} saved cards are`} removed from the shop's standing deliveries.`,
    bonusLost: (amounts) => `Your bonus credits (${amounts}) are lost.`,
    stripeNote: "The payment provider Stripe keeps its own payment records under its own rules. They are not deleted here.",
    irreversible: "This cannot be undone.",
    confirmButton: "Delete my account",
    backLink: "Cancel",
    doneTitle: "Your account is deleted",
    doneText: "Your account is deleted and you are signed out. We have sent you a confirmation by email.",
    doneTextNoEmail: "Your account is deleted and you are signed out.",
    doneKept: (count, until) => `${count === 1 ? "One order is" : `${count} orders are`} kept until ${until} because of bookkeeping law, with no link to you.`,
    doneEmail: "The confirmation goes to the email address you were registered with.",
    staleSession: "You need to confirm it is you before you can continue.",
    stripeFailed: "Stripe did not answer. Nothing was changed. Try again.",
    failed: "Something went wrong. Try again in a moment. If it keeps happening, contact the shop.",
    tooLarge: "There is too much data for one file. Contact the shop and they will help you.",
    tooMany: "You have downloaded your data many times in the last hour. Wait a little and try again.",
  },
};

/** The shopper's privacy pages in a language: nb, sv, da or en by hand, English for every other language. */
export const shopperPrivacyText = (lang: string): ShopperPrivacyText => SHOPPER[(PRIVACY_LANGUAGES as readonly string[]).includes(lang) ? (lang as PrivacyLanguage) : "en"];

// ---------------------------------------------------------------------------------------------------------------------------------
// The export's information block (GDPR Art. 15(1)) and what is not in the file
// ---------------------------------------------------------------------------------------------------------------------------------

export type InformationFacts = {
  storeName: string;
  legalName: string | null;
  contactEmail: string | null;
  country: string | null;
  /** The store's own supervisory authority when it has named one. */
  authority?: string | null;
  /** Bookkeeping period in years in the seller's country (from the retention rule). */
  bookkeepingYears: number;
};

// legal: needs review
export type InformationBlock = {
  controller: string;
  purposes: string[];
  categories: string[];
  recipients: string[];
  storagePeriods: string[];
  source: string;
  rights: string[];
  complaint: string;
  automatedDecisions: string;
};

type InformationText = {
  controller: (f: { name: string; email: string | null }) => string;
  purposes: string[];
  categories: string[];
  recipients: string[];
  storagePeriods: (years: number) => string[];
  source: string;
  rights: string[];
  complaint: (authority: string) => string;
  automatedDecisions: string;
};

const INFO: Record<PrivacyLanguage, InformationText> = {
  nb: {
    controller: ({ name, email }) => `Behandlingsansvarlig er ${name}${email ? `. Kontakt: ${email}` : ""}.`,
    purposes: [
      "Å behandle bestillinger, betaling, levering, retur og angrerett.",
      "Å føre regnskap og oppfylle plikter etter bokføringsloven.",
      "Å gi deg en konto, ønskelister, abonnementer og bonus du har bedt om.",
      "Å sende e-post som hører til en bestilling eller som du har bedt om.",
      "Å svare på henvendelser og hindre misbruk.",
    ],
    categories: ["Navn, e-postadresse, telefon og adresser", "Bestillinger, betalinger, refusjoner og leveranser", "Retur, angrerett og abonnementer", "Samtykker og e-postvalg", "Handlekurver og ønskelister", "E-poster butikken har sendt deg"],
    recipients: ["Betalingsleverandøren (Stripe)", "E-posttjenesten som sender e-post for butikken", "Transportører som leverer varer", "Regnskaps- og skattemyndigheter når loven krever det", "Tjenester butikken selv har koblet til (for eksempel regnskap eller varsler)"],
    storagePeriods: (years) => [
      `Bestillinger og regnskapsbilag beholdes i ${years} år etter utgangen av kalenderåret de gjelder (bokføringsloven). Deretter fjernes navn, adresse og e-postadresse.`,
      "Kontoen beholdes til du sletter den.",
      "E-poster beholdes i 12 måneder, innloggingskoder og lenker i 7 dager.",
      "Handlekurver beholdes i 90 dager etter at de ble avsluttet.",
      "Henvendelser om personvern beholdes i 24 måneder.",
    ],
    source: "Opplysningene kommer fra deg, fra bestillingene dine og fra hvordan du bruker nettbutikken.",
    rights: ["Innsyn i opplysningene (denne filen)", "Retting av opplysninger som er feil", "Sletting", "Begrensning av behandlingen", "Å protestere mot behandlingen", "Å få dataene utlevert i et maskinlesbart format", "Å trekke tilbake et samtykke"],
    complaint: (authority) => `Du kan klage til ${authority}, og du kan gå til domstolene.`,
    automatedDecisions: "Butikken tar ikke avgjørelser om deg ved hjelp av automatisert behandling som har rettslig virkning for deg.",
  },
  sv: {
    controller: ({ name, email }) => `Personuppgiftsansvarig är ${name}${email ? `. Kontakt: ${email}` : ""}.`,
    purposes: [
      "Att hantera beställningar, betalning, leverans, retur och ångerrätt.",
      "Att föra bokföring och uppfylla skyldigheter enligt bokföringslagen.",
      "Att ge dig ett konto, önskelistor, prenumerationer och bonus som du har bett om.",
      "Att skicka e-post som hör till en beställning eller som du har bett om.",
      "Att svara på förfrågningar och förhindra missbruk.",
    ],
    categories: ["Namn, e-postadress, telefon och adresser", "Beställningar, betalningar, återbetalningar och leveranser", "Retur, ångerrätt och prenumerationer", "Samtycken och e-postval", "Varukorgar och önskelistor", "E-post som butiken har skickat till dig"],
    recipients: ["Betalningsleverantören (Stripe)", "E-posttjänsten som skickar e-post för butiken", "Transportörer som levererar varor", "Skatte- och redovisningsmyndigheter när lagen kräver det", "Tjänster som butiken själv har kopplat till (till exempel bokföring eller aviseringar)"],
    storagePeriods: (years) => [
      `Beställningar och bokföringsunderlag sparas i ${years} år efter utgången av det kalenderår de avser (bokföringslagen). Därefter tas namn, adress och e-postadress bort.`,
      "Kontot sparas tills du raderar det.",
      "E-post sparas i 12 månader, inloggningskoder och länkar i 7 dagar.",
      "Varukorgar sparas i 90 dagar efter att de avslutades.",
      "Förfrågningar om personuppgifter sparas i 24 månader.",
    ],
    source: "Uppgifterna kommer från dig, från dina beställningar och från hur du använder webbutiken.",
    rights: ["Tillgång till uppgifterna (den här filen)", "Rättelse av uppgifter som är fel", "Radering", "Begränsning av behandlingen", "Att invända mot behandlingen", "Att få uppgifterna i ett maskinläsbart format", "Att återkalla ett samtycke"],
    complaint: (authority) => `Du kan klaga hos ${authority}, och du kan vända dig till domstol.`,
    automatedDecisions: "Butiken fattar inga beslut om dig genom automatiserad behandling som har rättslig verkan för dig.",
  },
  da: {
    controller: ({ name, email }) => `Dataansvarlig er ${name}${email ? `. Kontakt: ${email}` : ""}.`,
    purposes: [
      "At behandle bestillinger, betaling, levering, retur og fortrydelsesret.",
      "At føre regnskab og opfylde pligter efter bogføringsloven.",
      "At give dig en konto, ønskelister, abonnementer og bonus, som du har bedt om.",
      "At sende e-mails, der hører til en bestilling, eller som du har bedt om.",
      "At besvare henvendelser og forhindre misbrug.",
    ],
    categories: ["Navn, e-mailadresse, telefon og adresser", "Bestillinger, betalinger, refusioner og leveringer", "Retur, fortrydelsesret og abonnementer", "Samtykker og e-mailvalg", "Indkøbskurve og ønskelister", "E-mails, butikken har sendt til dig"],
    recipients: ["Betalingsleverandøren (Stripe)", "E-mailtjenesten, der sender e-mails for butikken", "Transportører, der leverer varer", "Skatte- og regnskabsmyndigheder, når loven kræver det", "Tjenester, butikken selv har koblet til (for eksempel regnskab eller notifikationer)"],
    storagePeriods: (years) => [
      `Bestillinger og regnskabsbilag opbevares i ${years} år efter udgangen af det kalenderår, de vedrører (bogføringsloven). Derefter fjernes navn, adresse og e-mailadresse.`,
      "Kontoen opbevares, til du sletter den.",
      "E-mails opbevares i 12 måneder, loginkoder og links i 7 dage.",
      "Indkøbskurve opbevares i 90 dage efter, at de blev afsluttet.",
      "Henvendelser om privatliv opbevares i 24 måneder.",
    ],
    source: "Oplysningerne kommer fra dig, fra dine bestillinger og fra, hvordan du bruger webshoppen.",
    rights: ["Indsigt i oplysningerne (denne fil)", "Berigtigelse af oplysninger, der er forkerte", "Sletning", "Begrænsning af behandlingen", "At gøre indsigelse mod behandlingen", "At få oplysningerne udleveret i et maskinlæsbart format", "At trække et samtykke tilbage"],
    complaint: (authority) => `Du kan klage til ${authority}, og du kan gå til domstolene.`,
    automatedDecisions: "Butikken træffer ikke afgørelser om dig ved automatisk behandling, som har retsvirkning for dig.",
  },
  en: {
    controller: ({ name, email }) => `The controller is ${name}${email ? `. Contact: ${email}` : ""}.`,
    purposes: [
      "To handle orders, payment, delivery, returns and withdrawal.",
      "To keep accounts and meet bookkeeping law.",
      "To give you an account, wishlists, subscriptions and bonus credits you asked for.",
      "To send emails that belong to an order or that you asked for.",
      "To answer requests and prevent abuse.",
    ],
    categories: ["Name, email address, phone and addresses", "Orders, payments, refunds and deliveries", "Returns, withdrawals and subscriptions", "Consents and email choices", "Carts and wishlists", "Emails the shop has sent you"],
    recipients: ["The payment provider (Stripe)", "The email service that sends email for the shop", "Carriers that deliver goods", "Tax and accounting authorities when the law requires it", "Services the shop has connected itself (for example accounting or notifications)"],
    storagePeriods: (years) => [
      `Orders and accounting records are kept for ${years} years after the end of the calendar year they belong to (bookkeeping law). After that your name, address and email are removed.`,
      "Your account is kept until you delete it.",
      "Emails are kept for 12 months, sign-in codes and links for 7 days.",
      "Carts are kept for 90 days after they ended.",
      "Privacy requests are kept for 24 months.",
    ],
    source: "The information comes from you, from your orders and from how you use the shop.",
    rights: ["Access to the information (this file)", "Correction of information that is wrong", "Erasure", "Restriction of processing", "To object to processing", "To receive the data in a machine-readable format", "To withdraw a consent"],
    complaint: (authority) => `You can complain to ${authority}, and you can go to court.`,
    automatedDecisions: "The shop does not take decisions about you by automated processing that have legal effect for you.",
  },
};

/** The export's `information` block (Art. 15(1)), in the shopper's language. Needs review; says nothing that depends on the person's data. */
export function informationBlock(lang: string, facts: InformationFacts): InformationBlock {
  const l: PrivacyLanguage = (PRIVACY_LANGUAGES as readonly string[]).includes(lang) ? (lang as PrivacyLanguage) : "en";
  const t = INFO[l];
  return {
    controller: t.controller({ name: facts.legalName?.trim() || facts.storeName, email: facts.contactEmail }),
    purposes: t.purposes,
    categories: t.categories,
    recipients: t.recipients,
    storagePeriods: t.storagePeriods(facts.bookkeepingYears),
    source: t.source,
    rights: t.rights,
    complaint: t.complaint(supervisoryAuthority(facts.country, l, facts.authority)),
    automatedDecisions: t.automatedDecisions,
  };
}

export type NotIncluded = { what: string; why: string };

const NOT_INCLUDED: Record<PrivacyLanguage, NotIncluded[]> = {
  nb: [
    { what: "Passord og innloggede nettlesere", why: "Av sikkerhetshensyn." },
    { what: "Opplysninger om andre personer (for eksempel venner du har anbefalt, eller ansatte og rom i bestillinger av tider)", why: "Rettighetene og frihetene til andre skal ikke bli berørt." },
    { what: "Besøk, søk og anbefalinger som ikke kan knyttes til deg", why: "De lagres uten navn eller e-postadresse og kan ikke tilordnes deg." },
    { what: "Samtykker til informasjonskapsler", why: "De lagres under en tilfeldig nettleser-ID og kan ikke knyttes til deg." },
    { what: "Betalingskortopplysninger", why: "Butikken har dem ikke. Betalingsleverandøren Stripe har dem på butikkens egen konto." },
    { what: "Opplysninger hos butikkens databehandlere og mottakere (Stripe, e-posttjenesten og tjenester butikken har koblet til)", why: "De holdes på tjenestenes egne systemer. Spør butikken hvilke tjenester den bruker." },
    { what: "Anmeldelser og andre funksjoner som butikken ikke har ennå", why: "De er ikke en del av butikken ennå." },
  ],
  sv: [
    { what: "Lösenord och inloggade webbläsare", why: "Av säkerhetsskäl." },
    { what: "Uppgifter om andra personer (till exempel vänner du har rekommenderat, eller personal och rum i tidsbokningar)", why: "Andras rättigheter och friheter ska inte påverkas." },
    { what: "Besök, sökningar och rekommendationer som inte kan kopplas till dig", why: "De sparas utan namn eller e-postadress och kan inte knytas till dig." },
    { what: "Samtycken till cookies", why: "De sparas under ett slumpmässigt webbläsar-ID och kan inte kopplas till dig." },
    { what: "Betalkortsuppgifter", why: "Butiken har dem inte. Betalningsleverantören Stripe har dem på butikens eget konto." },
    { what: "Uppgifter hos butikens personuppgiftsbiträden och mottagare (Stripe, e-posttjänsten och tjänster som butiken har kopplat till)", why: "De finns i tjänsternas egna system. Fråga butiken vilka tjänster den använder." },
    { what: "Recensioner och andra funktioner som butiken inte har ännu", why: "De är inte en del av butiken ännu." },
  ],
  da: [
    { what: "Adgangskode og loggede browsere", why: "Af sikkerhedshensyn." },
    { what: "Oplysninger om andre personer (for eksempel venner, du har anbefalet, eller medarbejdere og rum i tidsbestillinger)", why: "Andres rettigheder og frihedsrettigheder må ikke berøres." },
    { what: "Besøg, søgninger og anbefalinger, der ikke kan knyttes til dig", why: "De gemmes uden navn eller e-mailadresse og kan ikke henføres til dig." },
    { what: "Samtykker til cookies", why: "De gemmes under et tilfældigt browser-id og kan ikke knyttes til dig." },
    { what: "Betalingskortoplysninger", why: "Butikken har dem ikke. Betalingsleverandøren Stripe har dem på butikkens egen konto." },
    { what: "Oplysninger hos butikkens databehandlere og modtagere (Stripe, e-mailtjenesten og tjenester, butikken har koblet til)", why: "De findes i tjenesternes egne systemer. Spørg butikken, hvilke tjenester den bruger." },
    { what: "Anmeldelser og andre funktioner, som butikken ikke har endnu", why: "De er ikke en del af butikken endnu." },
  ],
  en: [
    { what: "Passwords and signed-in browsers", why: "For security." },
    { what: "Information about other people (for example friends you referred, or staff and rooms in bookings)", why: "The rights and freedoms of others must not be affected." },
    { what: "Visits, searches and recommendations that cannot be tied to you", why: "They are kept without a name or an email address and cannot be assigned to you." },
    { what: "Cookie consents", why: "They are kept under a random browser id and cannot be tied to you." },
    { what: "Payment card details", why: "The shop does not hold them. The payment provider Stripe holds them on the shop's own account." },
    { what: "Information held by the shop's processors and recipients (Stripe, the email service and services the shop has connected)", why: "It is held in those services' own systems. Ask the shop which services it uses." },
    { what: "Reviews and other features the shop does not have yet", why: "They are not part of the shop yet." },
  ],
};

export const notIncludedText = (lang: string): NotIncluded[] => NOT_INCLUDED[(PRIVACY_LANGUAGES as readonly string[]).includes(lang) ? (lang as PrivacyLanguage) : "en"];

// ---------------------------------------------------------------------------------------------------------------------------------
// The reasons a kept record is kept: one sentence each, for a person who asks (docs/wave-1g-gdpr.md 8, item 5)
// ---------------------------------------------------------------------------------------------------------------------------------

export type KeptReasonKind = "bookkeeping" | "opt_out" | "legal_claims";

// legal: needs review
const KEPT: Record<PrivacyLanguage, Record<KeptReasonKind, (until: string) => string>> = {
  nb: {
    bookkeeping: (until) => `Beholdes av hensyn til bokføringsloven til ${until}.`,
    opt_out: () => "Beholdes slik at du ikke får e-post fra butikken igjen.",
    legal_claims: (until) => `Beholdes for å kunne fremsette eller forsvare rettskrav, til ${until}.`,
  },
  sv: {
    bookkeeping: (until) => `Sparas på grund av bokföringslagen till ${until}.`,
    opt_out: () => "Sparas så att du inte får e-post från butiken igen.",
    legal_claims: (until) => `Sparas för att kunna göra gällande eller försvara rättsliga anspråk, till ${until}.`,
  },
  da: {
    bookkeeping: (until) => `Opbevares på grund af bogføringsloven til ${until}.`,
    opt_out: () => "Opbevares, så du ikke får e-mails fra butikken igen.",
    legal_claims: (until) => `Opbevares for at kunne gøre retskrav gældende eller forsvare dem, til ${until}.`,
  },
  en: {
    bookkeeping: (until) => `Kept for bookkeeping law until ${until}.`,
    opt_out: () => "Kept so that you are not emailed by the shop again.",
    legal_claims: (until) => `Kept to establish, exercise or defend legal claims, until ${until}.`,
  },
};

export const keptReason = (lang: string, kind: KeptReasonKind, until: string): string =>
  KEPT[(PRIVACY_LANGUAGES as readonly string[]).includes(lang) ? (lang as PrivacyLanguage) : "en"][kind](until);

// ---------------------------------------------------------------------------------------------------------------------------------
// The emails to the person (erasure confirmation, extension notice, refusal notice)
// ---------------------------------------------------------------------------------------------------------------------------------

export type PrivacyEmailFacts = {
  storeName: string;
  legalName?: string | null;
  contactEmail?: string | null;
  country: string | null;
  authority?: string | null;
};

type EmailWords = {
  erasedSubject: (store: string) => string;
  erasedHeading: string;
  erasedIntro: (store: string) => string;
  erasedRemoved: string;
  erasedKept: (count: number, until: string) => string;
  erasedOptOut: string;
  erasedStripe: string;
  erasedComplaint: (authority: string) => string;
  extensionSubject: (store: string) => string;
  extensionHeading: string;
  extensionBody: (received: string, until: string) => string;
  extensionReasonLabel: string;
  extensionRights: string;
  refusalSubject: (store: string) => string;
  refusalHeading: string;
  refusalBody: (received: string) => string;
  refusalReasonLabel: string;
  refusalNoteLabel: string;
  refusalReasons: Record<RefusalReason, string>;
  refusalRights: (authority: string) => string;
  contact: (email: string) => string;
};

// legal: needs review
const EMAILS: Record<PrivacyLanguage, EmailWords> = {
  nb: {
    erasedSubject: (store) => `Kontoen din hos ${store} er slettet`,
    erasedHeading: "Kontoen din er slettet",
    erasedIntro: (store) => `Du har bedt om å få kontoen din hos ${store} slettet. Det er gjort.`,
    erasedRemoved: "Kontoen, passordet, ønskelistene, de faste leveringslistene, handlekurvene knyttet til deg og e-postene du har fått, er slettet. Abonnementer er avsluttet.",
    erasedKept: (count, until) => `${count === 1 ? "Én bestilling" : `${count} bestillinger`} beholdes til ${until} fordi bokføringsloven krever det. ${count === 1 ? "Den" : "De"} er koblet fra deg og brukes ikke til noe annet. Etter denne datoen fjernes navn, adresse og e-postadresse.`,
    erasedOptOut: "Hvis du har sagt nei til e-post fra butikken, er e-postadressen din beholdt som en sperre, slik at du ikke får e-post igjen.",
    erasedStripe: "Betalingsleverandøren Stripe beholder sine egne betalingsopplysninger etter egne regler.",
    erasedComplaint: (authority) => `Hvis du mener at dataene dine er behandlet i strid med reglene, kan du klage til ${authority}.`,
    extensionSubject: (store) => `Vi trenger mer tid til å svare deg (${store})`,
    extensionHeading: "Vi trenger mer tid",
    extensionBody: (received, until) => `Vi mottok henvendelsen din ${received}. Vi trenger mer tid til å behandle den og svarer senest ${until}.`,
    extensionReasonLabel: "Begrunnelse fra butikken:",
    extensionRights: "Du kan klage til tilsynsmyndigheten, og du kan gå til domstolene.",
    refusalSubject: (store) => `Svar på henvendelsen din til ${store}`,
    refusalHeading: "Vi kan ikke etterkomme henvendelsen",
    refusalBody: (received) => `Vi mottok henvendelsen din ${received}. Vi kan dessverre ikke etterkomme den.`,
    refusalReasonLabel: "Grunn:",
    refusalNoteLabel: "Kommentar fra butikken:",
    refusalReasons: {
      identity_not_confirmed: "Vi har ikke kunnet bekrefte hvem som ber om dataene.",
      manifestly_unfounded: "Henvendelsen er åpenbart grunnløs.",
      excessive: "Henvendelsen er uforholdsmessig, for eksempel fordi den er gjentatt.",
      legal_hold: "Dataene må beholdes for å kunne forsvare et rettskrav.",
      other: "En annen grunn, som er forklart under.",
    },
    refusalRights: (authority) => `Du har rett til å klage til ${authority}, og du har rett til å bringe saken inn for domstolene.`,
    contact: (email) => `Spørsmål? Skriv til ${email}.`,
  },
  sv: {
    erasedSubject: (store) => `Ditt konto hos ${store} är raderat`,
    erasedHeading: "Ditt konto är raderat",
    erasedIntro: (store) => `Du har bett om att få ditt konto hos ${store} raderat. Det är gjort.`,
    erasedRemoved: "Kontot, lösenordet, önskelistorna, de fasta leveranslistorna, varukorgarna som var kopplade till dig och e-posten du har fått är raderade. Prenumerationer är avslutade.",
    erasedKept: (count, until) => `${count === 1 ? "En beställning" : `${count} beställningar`} sparas till ${until} eftersom bokföringslagen kräver det. ${count === 1 ? "Den" : "De"} är bortkopplad${count === 1 ? "" : "e"} från dig och används inte till något annat. Efter det datumet tas namn, adress och e-postadress bort.`,
    erasedOptOut: "Om du har tackat nej till e-post från butiken har din e-postadress sparats som en spärr, så att du inte får e-post igen.",
    erasedStripe: "Betalningsleverantören Stripe sparar sina egna betaluppgifter enligt egna regler.",
    erasedComplaint: (authority) => `Om du anser att dina uppgifter har behandlats i strid med reglerna kan du klaga hos ${authority}.`,
    extensionSubject: (store) => `Vi behöver mer tid för att svara dig (${store})`,
    extensionHeading: "Vi behöver mer tid",
    extensionBody: (received, until) => `Vi tog emot din förfrågan ${received}. Vi behöver mer tid för att behandla den och svarar senast ${until}.`,
    extensionReasonLabel: "Motivering från butiken:",
    extensionRights: "Du kan klaga hos tillsynsmyndigheten, och du kan vända dig till domstol.",
    refusalSubject: (store) => `Svar på din förfrågan till ${store}`,
    refusalHeading: "Vi kan inte uppfylla din förfrågan",
    refusalBody: (received) => `Vi tog emot din förfrågan ${received}. Vi kan tyvärr inte uppfylla den.`,
    refusalReasonLabel: "Skäl:",
    refusalNoteLabel: "Kommentar från butiken:",
    refusalReasons: {
      identity_not_confirmed: "Vi har inte kunnat bekräfta vem som ber om uppgifterna.",
      manifestly_unfounded: "Förfrågan är uppenbart ogrundad.",
      excessive: "Förfrågan är orimlig, till exempel för att den har upprepats.",
      legal_hold: "Uppgifterna måste sparas för att kunna försvara ett rättsligt anspråk.",
      other: "Ett annat skäl, som förklaras nedan.",
    },
    refusalRights: (authority) => `Du har rätt att klaga hos ${authority}, och du har rätt att få saken prövad av domstol.`,
    contact: (email) => `Frågor? Skriv till ${email}.`,
  },
  da: {
    erasedSubject: (store) => `Din konto hos ${store} er slettet`,
    erasedHeading: "Din konto er slettet",
    erasedIntro: (store) => `Du har bedt om at få din konto hos ${store} slettet. Det er gjort.`,
    erasedRemoved: "Kontoen, adgangskoden, ønskelisterne, de faste leveringslister, indkøbskurvene knyttet til dig og de e-mails, du har fået, er slettet. Abonnementer er afsluttet.",
    erasedKept: (count, until) => `${count === 1 ? "Én bestilling" : `${count} bestillinger`} opbevares til ${until}, fordi bogføringsloven kræver det. ${count === 1 ? "Den" : "De"} er koblet fra dig og bruges ikke til andet. Efter den dato fjernes navn, adresse og e-mailadresse.`,
    erasedOptOut: "Hvis du har sagt nej til e-mails fra butikken, er din e-mailadresse opbevaret som en spærring, så du ikke får e-mails igen.",
    erasedStripe: "Betalingsleverandøren Stripe opbevarer sine egne betalingsoplysninger efter egne regler.",
    erasedComplaint: (authority) => `Hvis du mener, at dine oplysninger er behandlet i strid med reglerne, kan du klage til ${authority}.`,
    extensionSubject: (store) => `Vi har brug for mere tid til at svare dig (${store})`,
    extensionHeading: "Vi har brug for mere tid",
    extensionBody: (received, until) => `Vi modtog din henvendelse ${received}. Vi har brug for mere tid til at behandle den og svarer senest ${until}.`,
    extensionReasonLabel: "Begrundelse fra butikken:",
    extensionRights: "Du kan klage til tilsynsmyndigheden, og du kan gå til domstolene.",
    refusalSubject: (store) => `Svar på din henvendelse til ${store}`,
    refusalHeading: "Vi kan ikke efterkomme henvendelsen",
    refusalBody: (received) => `Vi modtog din henvendelse ${received}. Vi kan desværre ikke efterkomme den.`,
    refusalReasonLabel: "Grund:",
    refusalNoteLabel: "Kommentar fra butikken:",
    refusalReasons: {
      identity_not_confirmed: "Vi har ikke kunnet bekræfte, hvem der beder om oplysningerne.",
      manifestly_unfounded: "Henvendelsen er åbenbart grundløs.",
      excessive: "Henvendelsen er uforholdsmæssig, for eksempel fordi den er gentaget.",
      legal_hold: "Oplysningerne skal opbevares for at kunne forsvare et retskrav.",
      other: "En anden grund, som er forklaret nedenfor.",
    },
    refusalRights: (authority) => `Du har ret til at klage til ${authority}, og du har ret til at indbringe sagen for domstolene.`,
    contact: (email) => `Spørgsmål? Skriv til ${email}.`,
  },
  en: {
    erasedSubject: (store) => `Your account at ${store} is deleted`,
    erasedHeading: "Your account is deleted",
    erasedIntro: (store) => `You asked for your account at ${store} to be deleted. It is done.`,
    erasedRemoved: "The account, password, wishlists, standing delivery lists, carts linked to you and the emails you were sent are deleted. Subscriptions are ended.",
    erasedKept: (count, until) => `${count === 1 ? "One order is" : `${count} orders are`} kept until ${until} because bookkeeping law requires it. ${count === 1 ? "It is" : "They are"} cut loose from you and used for nothing else. After that date your name, address and email are removed.`,
    erasedOptOut: "If you have said no to emails from the shop, your email address is kept as a block, so that you are not emailed again.",
    erasedStripe: "The payment provider Stripe keeps its own payment records under its own rules.",
    erasedComplaint: (authority) => `If you believe your data has been handled against the rules, you can complain to ${authority}.`,
    extensionSubject: (store) => `We need more time to answer you (${store})`,
    extensionHeading: "We need more time",
    extensionBody: (received, until) => `We received your request on ${received}. We need more time to deal with it and will answer by ${until} at the latest.`,
    extensionReasonLabel: "The shop's reasons:",
    extensionRights: "You can complain to the supervisory authority, and you can go to court.",
    refusalSubject: (store) => `Answer to your request to ${store}`,
    refusalHeading: "We cannot act on your request",
    refusalBody: (received) => `We received your request on ${received}. We are sorry, but we cannot act on it.`,
    refusalReasonLabel: "Reason:",
    refusalNoteLabel: "A note from the shop:",
    refusalReasons: {
      identity_not_confirmed: "We could not confirm who is asking for the data.",
      manifestly_unfounded: "The request is manifestly unfounded.",
      excessive: "The request is excessive, for example because it was repeated.",
      legal_hold: "The data must be kept to defend a legal claim.",
      other: "Another reason, explained below.",
    },
    refusalRights: (authority) => `You have the right to complain to ${authority}, and the right to a judicial remedy.`,
    contact: (email) => `Questions? Write to ${email}.`,
  },
};

const words = (lang: string): EmailWords => EMAILS[(PRIVACY_LANGUAGES as readonly string[]).includes(lang) ? (lang as PrivacyLanguage) : "en"];
const langOf = (lang: string): PrivacyLanguage => ((PRIVACY_LANGUAGES as readonly string[]).includes(lang) ? (lang as PrivacyLanguage) : "en");

const footerOf = (facts: PrivacyEmailFacts): string[] => [facts.storeName, ...(facts.legalName && facts.legalName !== facts.storeName ? [facts.legalName] : []), ...(facts.contactEmail ? [facts.contactEmail] : [])];

/** The one email that survives an erasure: what was removed, what is kept and until when, the opt-out kept, how to complain. */
export function erasureConfirmationEmail(lang: string, facts: PrivacyEmailFacts, kept: { orders: number; until: string | null }): EmailContent {
  const w = words(lang);
  const l = langOf(lang);
  const blocks: EmailContent["blocks"] = [
    { type: "heading", text: w.erasedHeading },
    { type: "paragraph", text: w.erasedIntro(facts.storeName) },
    { type: "paragraph", text: w.erasedRemoved },
  ];
  if (kept.orders > 0 && kept.until) blocks.push({ type: "paragraph", text: w.erasedKept(kept.orders, formatPrivacyDay(kept.until, l)) });
  blocks.push({ type: "paragraph", text: w.erasedOptOut }, { type: "paragraph", text: w.erasedStripe });
  blocks.push({ type: "paragraph", text: w.erasedComplaint(supervisoryAuthority(facts.country, l, facts.authority)) });
  if (facts.contactEmail) blocks.push({ type: "paragraph", text: w.contact(facts.contactEmail) });
  return { subject: w.erasedSubject(facts.storeName), preview: w.erasedHeading, blocks, footer: footerOf(facts), lang: l };
}

/** Art. 12(3): told within the first month, with the reasons. The reason staff typed is printed on its own line. */
export function extensionNoticeEmail(lang: string, facts: PrivacyEmailFacts, notice: { receivedDay: string; untilDay: string; reason: string }): EmailContent {
  const w = words(lang);
  const l = langOf(lang);
  return {
    subject: w.extensionSubject(facts.storeName),
    preview: w.extensionHeading,
    blocks: [
      { type: "heading", text: w.extensionHeading },
      { type: "paragraph", text: w.extensionBody(formatPrivacyDay(notice.receivedDay, l), formatPrivacyDay(notice.untilDay, l)) },
      { type: "paragraph", text: w.extensionReasonLabel },
      { type: "paragraph", text: notice.reason },
      { type: "paragraph", text: w.extensionRights },
      ...(facts.contactEmail ? [{ type: "paragraph" as const, text: w.contact(facts.contactEmail) }] : []),
    ],
    footer: footerOf(facts),
    lang: l,
  };
}

/** Art. 12(4): the reasons, the right to complain to the supervisory authority and to seek a judicial remedy. */
export function refusalNoticeEmail(lang: string, facts: PrivacyEmailFacts, notice: { receivedDay: string; reason: RefusalReason; note?: string | null }): EmailContent {
  const w = words(lang);
  const l = langOf(lang);
  const blocks: EmailContent["blocks"] = [
    { type: "heading", text: w.refusalHeading },
    { type: "paragraph", text: w.refusalBody(formatPrivacyDay(notice.receivedDay, l)) },
    { type: "paragraph", text: `${w.refusalReasonLabel} ${w.refusalReasons[notice.reason]}` },
  ];
  if (notice.note && notice.note.trim()) blocks.push({ type: "paragraph", text: w.refusalNoteLabel }, { type: "paragraph", text: notice.note.trim() });
  blocks.push({ type: "paragraph", text: w.refusalRights(supervisoryAuthority(facts.country, l, facts.authority)) });
  if (facts.contactEmail) blocks.push({ type: "paragraph", text: w.contact(facts.contactEmail) });
  return { subject: w.refusalSubject(facts.storeName), preview: w.refusalHeading, blocks, footer: footerOf(facts), lang: l };
}

/** Every refusal reason has a sentence in every language (a test holds it). */
export const REFUSAL_REASON_KEYS: readonly RefusalReason[] = REFUSAL_REASONS;

// ---------------------------------------------------------------------------------------------------------------------------------
// Staff-facing English (the admin is English only): the clock, the warnings and the confirmations
// ---------------------------------------------------------------------------------------------------------------------------------

/** Not consumer texts, but they state the law (the one-month clock, the extension limit): a lawyer should read the clock sentences. */
export const STAFF_TEXT = {
  clock:
    "The person is owed an answer without undue delay and in any event within one month of receiving the request. If the request is complex, you may extend this by up to two further months, but the person must be told within the first month, with the reasons. The system counts the month to the same calendar day and does not move it for weekends or holidays, which is the safe side. Check how Regulation 1182/71 counts periods with your lawyer.",
  receivedHelp: "The date the request arrived. The month runs from receipt, so set an earlier day if it came by email, post or phone before today.",
  identity:
    "If you have reasonable doubt about who is asking, reply to the address you already have on file and ask for more information. Use what you hold; do not collect more data than you need.",
  identityNote: "Waiting for identity does not pause the clock in the system. Apply the law's pause yourself, and note the date here.",
  free: "A request is answered free of charge.",
  downloadWarning: "The file includes internal notes about the customer, because they are personal data. Read them first if they must not be shared.",
  exportHelp: "The file is downloaded, never emailed. Send it to the person yourself, by a channel you trust.",
  eraseConfirm: "Type the customer's email address to confirm. For a customer with no email address, type ERASE.",
  eraseIrreversible: "Erasure cannot be undone. Subscriptions are cancelled now without a refund, saved cards are detached, bonus credits are lost.",
  stripeNote: "Stripe's own customer and payment records on the store's account are not deleted here; Stripe keeps its legal records.",
  restrictedBanner: (since: string, until: string) => `Personal data restricted since ${since}. Kept until ${until} because of the bookkeeping rules. Use it only for the accounts.`,
  anonymisedBanner: (when: string) => `Personal data removed on ${when}. The sale, amounts and VAT are kept.`,
  stripeFailed: "Stripe did not answer; nothing was changed. Try again.",
  tooLarge: "There is too much data for one file. Ask the platform for help.",
  noData: "Nothing is held about this person. You can close the request as \"no data held\".",
} as const;
