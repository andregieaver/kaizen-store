/**
 * A store's own data protection impact assessment for recordings of visits (D656; the lawyer's answer to Q3 on 18 November 2026: each
 * store that records needs its own). Drawn from Kaizena Flow's assessment (`docs/dpia-recordings.md`) as a template, with the store's
 * facts filled in: who it is, the share of visits it records and what recordings hide. The owner downloads it from the Recordings switch,
 * reads it, adds what only they know and signs it; recordings start only after they confirm they have one. Pure: every value from the
 * store is escaped, since the file is HTML.
 */

export type AssessmentFacts = {
  storeName: string;
  legalName: string | null;
  organisationNumber: string | null;
  postalAddress: string | null;
  contactEmail: string | null;
  /** The share of browser tabs recorded, in per cent. */
  share: number;
  mask: "balanced" | "strict";
  /** The day it was drawn, YYYY-MM-DD. */
  today: string;
};

export type AssessmentLang = "en" | "nb";

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

type Words = {
  title: string;
  lead: string;
  draft: string;
  sections: { heading: string; body: (f: AssessmentFacts, fill: (v: string | null) => string) => string }[];
  sign: { heading: string; role: string; name: string; date: string; decision: string; owner: string; dpo: string };
};

const list = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const table = (head: string[], rows: string[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

const EN: Words = {
  title: "Data protection impact assessment: recordings of visits",
  lead: "GDPR Article 35. Drawn by Kaizena Flow as a template for this store; the store is the controller and decides what it says.",
  draft: "A draft to read, complete and sign. The parts in brackets are for you to fill in.",
  sections: [
    {
      heading: "1. Who is responsible",
      body: (f, fill) =>
        `<p>Controller: ${fill(f.legalName)}, organisation number ${fill(f.organisationNumber)}, ${fill(f.postalAddress)}, ${fill(f.contactEmail)}, running the online store ${escape(f.storeName)}.</p><p>Processor: Kaizena Flow, which hosts the store and keeps the recordings on its behalf under the data processing agreement, in Ireland. Kaizena Flow never uses them for its own purposes, and its staff do not watch them.</p>`,
    },
    {
      heading: "2. What is processed and why",
      body: (f) =>
        `<p>Purpose: to see where visitors find the store's pages hard to use, so they can be fixed.</p>${list([
          `What is recorded, for visitors who allow recordings: the page as drawn, clicks, taps, scrolling and pointer movement, the screen size (rounded) and roughly when (to 10 minutes), under a random number for the browser tab that is joined to nothing else.`,
          `How many visits: ${f.share} % of browser tabs.`,
          f.mask === "strict"
            ? "What is hidden: all text on the page, and everything typed."
            : "What is hidden: everything typed (not even its length), text visitors wrote such as reviews, and every area holding personal data; the store's own text and catalogue pictures stay visible.",
          "Never recorded: passwords, payment data, forms, the chat, the cart, and the cart, checkout, order, account and search pages; nothing at all when the browser sends Global Privacy Control or Do Not Track. No IP address or user agent is kept.",
          "Kept 30 days, then deleted. Only the store's owner can watch them, and every viewing is logged.",
        ])}`,
    },
    {
      heading: "3. Legal basis and the visitor's choice",
      body: () =>
        `<p>Consent (GDPR Article 6(1)(a)), asked as a category of its own on the cookie banner, apart from statistics. Withdrawing it stops recording at once and deletes the recordings that browser made; the cookie page has a button that does the same.</p>`,
    },
    {
      heading: "4. Risks and measures",
      body: () =>
        table(
          ["Risk to people", "Measures", "Left after measures"],
          [
            ["Typed or personal data in a recording", "Every field masked, private areas blocked, refused pages never recorded, addresses stripped of their query", "Low; custom page code the store added that shows personal data could still be recorded"],
            ["A recording tied to a person", "Relative times, rounded sizes, a random id per tab, no IP or user agent", "Low; something shown on a page, such as a name, could still identify"],
            ["Children, or special categories of data", "The store confirms it is not aimed at children and sells nothing sensitive", "Low, while that stays true"],
            ["Recordings seen by the wrong person", "Owner only, every viewing logged, kept in a private store in Ireland", "Low"],
          ],
        ),
    },
    {
      heading: "5. Necessity and proportionality",
      body: () =>
        `<p>Heatmaps show where visitors click and scroll as totals without personal data, but not the order in which a visitor tried things, which is what shows why a page is hard to use. Recordings are therefore a separate choice, sampled, masked, kept 30 days and off by default.</p><p>[Your notes: why recordings help this store, and why the share above is enough.]</p>`,
    },
    {
      heading: "6. Consultation and conclusion",
      body: () =>
        `<p>Kaizena Flow's legal review (18 November 2026) found that recordings of visits are not on Datatilsynet's list of processing that always needs an assessment, that no high risk remains after these measures, and that neither visitors nor Datatilsynet need be consulted first. Each store still needs this assessment of its own.</p><p>[Your conclusion for this store. If you have a data protection officer, their advice.]</p>`,
    },
  ],
  sign: { heading: "7. Sign-off", role: "Role", name: "Name", date: "Date", decision: "Decision", owner: "Owner of the store", dpo: "Data protection officer, if any" },
};

const NB: Words = {
  title: "Vurdering av personvernkonsekvenser: opptak av besøk",
  lead: "Personvernforordningen artikkel 35. Laget av Kaizena Flow som mal for denne butikken; butikken er behandlingsansvarlig og avgjør hva den sier.",
  draft: "Et utkast å lese, fullføre og signere. Delene i klammer fyller du ut.",
  sections: [
    {
      heading: "1. Hvem som er ansvarlig",
      body: (f, fill) =>
        `<p>Behandlingsansvarlig: ${fill(f.legalName)}, organisasjonsnummer ${fill(f.organisationNumber)}, ${fill(f.postalAddress)}, ${fill(f.contactEmail)}, som driver nettbutikken ${escape(f.storeName)}.</p><p>Databehandler: Kaizena Flow, som drifter butikken og lagrer opptakene for den etter databehandleravtalen, i Irland. Kaizena Flow bruker dem aldri til egne formål, og de ansatte ser ikke på dem.</p>`,
    },
    {
      heading: "2. Hva som behandles, og hvorfor",
      body: (f) =>
        `<p>Formål: å se hvor besøkende synes butikkens sider er vanskelige å bruke, slik at de kan rettes.</p>${list([
          "Hva som tas opp, for besøkende som tillater opptak: siden slik den ble vist, klikk, trykk, rulling og pekerbevegelser, skjermstørrelsen (avrundet) og omtrent når (til 10 minutter), under et tilfeldig nummer for fanen i nettleseren som ikke kobles til noe annet.",
          `Hvor mange besøk: ${f.share} % av fanene.`,
          f.mask === "strict"
            ? "Hva som skjules: all tekst på siden, og alt som skrives."
            : "Hva som skjules: alt som skrives (heller ikke lengden), tekst besøkende har skrevet, som omtaler, og alle områder med personopplysninger; butikkens egen tekst og produktbilder vises.",
          "Tas aldri opp: passord, betalingsopplysninger, skjemaer, chatten, handlekurven, og sidene for handlekurv, kasse, ordre, konto og søk; ingenting når nettleseren sender Global Privacy Control eller Do Not Track. Ingen IP-adresse eller nettleserinformasjon lagres.",
          "Lagres i 30 dager og slettes så. Bare butikkens eier kan se dem, og hver visning logges.",
        ])}`,
    },
    {
      heading: "3. Rettslig grunnlag og den besøkendes valg",
      body: () =>
        `<p>Samtykke (artikkel 6 nr. 1 bokstav a), spurt om som en egen kategori i samtykkebanneret, adskilt fra statistikk. Trekkes samtykket, stanser opptaket med en gang og opptakene nettleseren laget slettes; siden om informasjonskapsler har en knapp som gjør det samme.</p>`,
    },
    {
      heading: "4. Risiko og tiltak",
      body: () =>
        table(
          ["Risiko for personer", "Tiltak", "Igjen etter tiltakene"],
          [
            ["Det som skrives, eller personopplysninger, i et opptak", "Alle felt skjules, private områder blokkeres, sider som ikke skal tas opp tas aldri opp, adresser uten spørrestreng", "Lav; egen sidekode butikken har lagt til som viser personopplysninger, kan fortsatt tas opp"],
            ["Et opptak knyttet til en person", "Relative tider, avrundede størrelser, tilfeldig nummer per fane, ingen IP eller nettleserinformasjon", "Lav; noe som vises på en side, som et navn, kan fortsatt identifisere"],
            ["Barn, eller særlige kategorier opplysninger", "Butikken bekrefter at den ikke retter seg mot barn og ikke selger noe sensitivt", "Lav, så lenge det stemmer"],
            ["Opptak sett av feil person", "Bare eieren, hver visning logges, lagret privat i Irland", "Lav"],
          ],
        ),
    },
    {
      heading: "5. Nødvendighet og forholdsmessighet",
      body: () =>
        `<p>Varmekart viser hvor besøkende klikker og ruller som summer uten personopplysninger, men ikke rekkefølgen en besøkende prøvde ting i, som er det som viser hvorfor en side er vanskelig å bruke. Opptak er derfor et eget valg, med utvalg, skjuling, 30 dagers lagring og av som standard.</p><p>[Dine notater: hvorfor opptak hjelper denne butikken, og hvorfor andelen over er nok.]</p>`,
    },
    {
      heading: "6. Forhåndsdrøfting og konklusjon",
      body: () =>
        `<p>Kaizena Flows juridiske vurdering (18. november 2026) fant at opptak av besøk ikke står på Datatilsynets liste over behandling som alltid krever en vurdering, at ingen høy risiko gjenstår etter disse tiltakene, og at verken besøkende eller Datatilsynet må rådføres først. Hver butikk trenger likevel sin egen vurdering.</p><p>[Din konklusjon for denne butikken. Har du personvernombud, deres råd.]</p>`,
    },
  ],
  sign: { heading: "7. Signering", role: "Rolle", name: "Navn", date: "Dato", decision: "Beslutning", owner: "Butikkens eier", dpo: "Personvernombud, om noen" },
};

/** The assessment as a whole HTML file, opened in a browser or a word processor. */
export function assessmentHtml(facts: AssessmentFacts, lang: AssessmentLang): string {
  const w = lang === "nb" ? NB : EN;
  const fill = (value: string | null) => (value && value.trim() ? escape(value.trim()) : lang === "nb" ? "[fyll ut]" : "[fill in]");
  const sections = w.sections.map((s) => `<h2>${s.heading}</h2>${s.body(facts, fill)}`).join("\n");
  const sign = `<h2>${w.sign.heading}</h2>${table([w.sign.role, w.sign.name, w.sign.date, w.sign.decision], [[w.sign.owner, "", "", ""], [w.sign.dpo, "", "", ""]])}`;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${escape(w.title)} · ${escape(facts.storeName)}</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1b1b1b}h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:2rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:.4rem .5rem;text-align:left;vertical-align:top}.note{color:#555}</style>
</head><body>
<h1>${escape(w.title)}</h1>
<p><strong>${escape(facts.storeName)}</strong> · ${escape(facts.today)}</p>
<p class="note">${escape(w.lead)} ${escape(w.draft)}</p>
${sections}
${sign}
</body></html>
`;
}

/** The file's name: the store's address, safe in a header. */
export const assessmentFileName = (slug: string) => `recordings-assessment-${slug.replace(/[^a-z0-9-]/gi, "")}.html`;
