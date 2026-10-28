import type { BroadcastContent, LanguageContent } from "./broadcasts";

/**
 * Templates a broadcast starts from (wave 10 unit E, D368, `docs/wave-10-must-haves.md` 4): written by hand in Norwegian, Swedish, Danish and
 * English and never machine translated, each a subject, a preview line and a few blocks the owner edits before sending. No placeholders (a
 * broadcast has none, D297), no price, stock or urgency, and no claim (`broadcast-templates.test.ts` holds them to `findClaims()`); a product or
 * an offer is added by the owner from the store's own facts (D352). An owner's own broadcasts saved as templates are `broadcast_templates`.
 */

export const BROADCAST_TEMPLATE_KEYS = ["news", "new_products", "offer", "season", "thanks"] as const;
export type BroadcastTemplateKey = (typeof BROADCAST_TEMPLATE_KEYS)[number];

export const isBroadcastTemplateKey = (value: unknown): value is BroadcastTemplateKey =>
  typeof value === "string" && (BROADCAST_TEMPLATE_KEYS as readonly string[]).includes(value);

type Template = { subject: string; preview: string; heading: string; text: string; button: string; url: string };
type Lang = "nb" | "sv" | "da" | "en";

export const BROADCAST_TEMPLATES: Record<BroadcastTemplateKey, Record<Lang, Template>> = {
  news: {
    en: {
      subject: "News from us",
      preview: "Here is what is new.",
      heading: "News from us",
      text: "Here is what has happened since we last wrote. Replace this with your news: what is new, why it matters to your customers, and what they can do next.",
      button: "Read more",
      url: "/",
    },
    nb: {
      subject: "Nytt fra oss",
      preview: "Her er det som er nytt.",
      heading: "Nytt fra oss",
      text: "Her er det som har skjedd siden sist vi skrev. Bytt ut dette med nyhetene dine: hva som er nytt, hvorfor det betyr noe for kundene, og hva de kan gjøre nå.",
      button: "Les mer",
      url: "/",
    },
    sv: {
      subject: "Nytt från oss",
      preview: "Här är det som är nytt.",
      heading: "Nytt från oss",
      text: "Här är det som har hänt sedan vi skrev sist. Byt ut det här mot dina nyheter: vad som är nytt, varför det spelar roll för kunderna och vad de kan göra nu.",
      button: "Läs mer",
      url: "/",
    },
    da: {
      subject: "Nyt fra os",
      preview: "Her er det, der er nyt.",
      heading: "Nyt fra os",
      text: "Her er det, der er sket, siden vi skrev sidst. Udskift dette med dine nyheder: hvad der er nyt, hvorfor det betyder noget for kunderne, og hvad de kan gøre nu.",
      button: "Læs mere",
      url: "/",
    },
  },
  new_products: {
    en: {
      subject: "New in the store",
      preview: "Have a look at what has come in.",
      heading: "New in the store",
      text: "We have added new products. Tell your customers what they are and who they are for, then add the products below so their pictures and prices come from the store.",
      button: "See what is new",
      url: "/products",
    },
    nb: {
      subject: "Nytt i butikken",
      preview: "Ta en titt på det som har kommet inn.",
      heading: "Nytt i butikken",
      text: "Vi har lagt inn nye produkter. Fortell kundene hva de er og hvem de passer for, og legg til produktene under, så kommer bilder og priser fra butikken.",
      button: "Se det som er nytt",
      url: "/products",
    },
    sv: {
      subject: "Nytt i butiken",
      preview: "Ta en titt på det som har kommit in.",
      heading: "Nytt i butiken",
      text: "Vi har lagt till nya produkter. Berätta för kunderna vad de är och vilka de passar, och lägg till produkterna nedan så kommer bilder och priser från butiken.",
      button: "Se det som är nytt",
      url: "/products",
    },
    da: {
      subject: "Nyt i butikken",
      preview: "Tag et kig på det, der er kommet ind.",
      heading: "Nyt i butikken",
      text: "Vi har tilføjet nye produkter. Fortæl kunderne, hvad de er, og hvem de passer til, og tilføj produkterne nedenfor, så kommer billeder og priser fra butikken.",
      button: "Se det, der er nyt",
      url: "/products",
    },
  },
  offer: {
    en: {
      subject: "An offer for you",
      preview: "Our offer, and when it runs.",
      heading: "An offer for you",
      text: "Tell your customers what the offer is and what it covers. Add the campaign below, so its terms and its end come from the store and are always right.",
      button: "See the offer",
      url: "/products",
    },
    nb: {
      subject: "Et tilbud til deg",
      preview: "Tilbudet vårt, og når det gjelder.",
      heading: "Et tilbud til deg",
      text: "Fortell kundene hva tilbudet er og hva det gjelder. Legg til kampanjen under, så kommer vilkårene og sluttdatoen fra butikken og er alltid riktige.",
      button: "Se tilbudet",
      url: "/products",
    },
    sv: {
      subject: "Ett erbjudande till dig",
      preview: "Vårt erbjudande, och när det gäller.",
      heading: "Ett erbjudande till dig",
      text: "Berätta för kunderna vad erbjudandet är och vad det gäller. Lägg till kampanjen nedan, så kommer villkoren och slutdatumet från butiken och är alltid rätt.",
      button: "Se erbjudandet",
      url: "/products",
    },
    da: {
      subject: "Et tilbud til dig",
      preview: "Vores tilbud, og hvornår det gælder.",
      heading: "Et tilbud til dig",
      text: "Fortæl kunderne, hvad tilbuddet er, og hvad det gælder. Tilføj kampagnen nedenfor, så kommer vilkårene og slutdatoen fra butikken og er altid rigtige.",
      button: "Se tilbuddet",
      url: "/products",
    },
  },
  season: {
    en: {
      subject: "Ready for the season",
      preview: "Ideas for the weeks ahead.",
      heading: "Ready for the season",
      text: "A new season is coming. Share a few ideas from your store for the weeks ahead, and add the products that fit them.",
      button: "Get ideas",
      url: "/products",
    },
    nb: {
      subject: "Klar for sesongen",
      preview: "Ideer til ukene som kommer.",
      heading: "Klar for sesongen",
      text: "En ny sesong er på vei. Del noen ideer fra butikken til ukene som kommer, og legg til produktene som passer.",
      button: "Få ideer",
      url: "/products",
    },
    sv: {
      subject: "Redo för säsongen",
      preview: "Idéer för veckorna som kommer.",
      heading: "Redo för säsongen",
      text: "En ny säsong är på väg. Dela några idéer från butiken för veckorna som kommer, och lägg till produkterna som passar.",
      button: "Få idéer",
      url: "/products",
    },
    da: {
      subject: "Klar til sæsonen",
      preview: "Idéer til de kommende uger.",
      heading: "Klar til sæsonen",
      text: "En ny sæson er på vej. Del nogle idéer fra butikken til de kommende uger, og tilføj de produkter, der passer.",
      button: "Få idéer",
      url: "/products",
    },
  },
  thanks: {
    en: {
      subject: "Thank you",
      preview: "A few words from us.",
      heading: "Thank you",
      text: "Thank you for shopping with us and for reading our emails. Tell your customers in a few words what this year has been like, and what you look forward to.",
      button: "Visit the store",
      url: "/",
    },
    nb: {
      subject: "Takk",
      preview: "Noen ord fra oss.",
      heading: "Takk",
      text: "Takk for at du handler hos oss og leser e-postene våre. Fortell kundene med noen ord hvordan året har vært, og hva du ser fram til.",
      button: "Besøk butikken",
      url: "/",
    },
    sv: {
      subject: "Tack",
      preview: "Några ord från oss.",
      heading: "Tack",
      text: "Tack för att du handlar hos oss och läser våra mejl. Berätta för kunderna med några ord hur året har varit och vad du ser fram emot.",
      button: "Besök butiken",
      url: "/",
    },
    da: {
      subject: "Tak",
      preview: "Et par ord fra os.",
      heading: "Tak",
      text: "Tak, fordi du handler hos os og læser vores e-mails. Fortæl kunderne med et par ord, hvordan året har været, og hvad du ser frem til.",
      button: "Besøg butikken",
      url: "/",
    },
  },
};

const asContent = (t: Template): LanguageContent => ({
  subject: t.subject,
  preview: t.preview,
  blocks: [
    { type: "heading", text: t.heading },
    { type: "paragraph", text: t.text },
    { type: "button", text: t.button, url: t.url },
  ],
});

/** A template's words for each of the store's languages that has them (a language without is left for the owner to write). */
export function templateContent(key: BroadcastTemplateKey, locales: readonly string[]): BroadcastContent {
  const out: BroadcastContent = {};
  for (const locale of locales) {
    const template = BROADCAST_TEMPLATES[key][locale.slice(0, 2) as Lang];
    if (template) out[locale] = asContent(template);
  }
  return out;
}

/** At most this many templates of its own a store keeps. */
export const OWN_TEMPLATES_MAX = 50;
