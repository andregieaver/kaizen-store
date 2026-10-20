import type { BroadcastContent, LanguageContent } from "./broadcasts";
import type { LifecycleKind } from "./automation-kinds";

/**
 * The words a lifecycle automation starts from (D298, `docs/wave-5-marketing.md` 6.1), written by hand in Norwegian, Swedish, Danish and English
 * and never machine translated: the owner edits them before saving. No placeholders (as broadcasts, 5.1) and no claims (`automation-starters.test.ts`).
 */

type Starter = { subject: string; preview: string; heading: string; text: string; button: string; url: string };

export const AUTOMATION_STARTERS: Record<LifecycleKind, Record<"nb" | "sv" | "da" | "en", Starter>> = {
  welcome: {
    en: {
      subject: "Welcome",
      preview: "Thank you for joining our list.",
      heading: "Welcome",
      text: "Thank you for joining our list. We will write when we have news, new products or offers, and you can unsubscribe at any time with the link at the bottom of every email.",
      button: "See our products",
      url: "/products",
    },
    nb: {
      subject: "Velkommen",
      preview: "Takk for at du meldte deg på.",
      heading: "Velkommen",
      text: "Takk for at du meldte deg på nyhetsbrevet vårt. Vi skriver når vi har nyheter, nye produkter eller tilbud, og du kan melde deg av når som helst med lenken nederst i hver e-post.",
      button: "Se produktene våre",
      url: "/products",
    },
    sv: {
      subject: "Välkommen",
      preview: "Tack för att du anmälde dig.",
      heading: "Välkommen",
      text: "Tack för att du anmälde dig till vårt nyhetsbrev. Vi skriver när vi har nyheter, nya produkter eller erbjudanden, och du kan avanmäla dig när som helst med länken längst ner i varje mejl.",
      button: "Se våra produkter",
      url: "/products",
    },
    da: {
      subject: "Velkommen",
      preview: "Tak, fordi du tilmeldte dig.",
      heading: "Velkommen",
      text: "Tak, fordi du tilmeldte dig vores nyhedsbrev. Vi skriver, når vi har nyheder, nye produkter eller tilbud, og du kan afmelde dig når som helst med linket nederst i hver e-mail.",
      button: "Se vores produkter",
      url: "/products",
    },
  },
  after_purchase: {
    en: {
      subject: "How did it go?",
      preview: "We hope you are happy with your order.",
      heading: "Thank you for your order",
      text: "We hope everything arrived as it should. If something is not right, reply to this email and we will help.",
      button: "Visit the store",
      url: "/",
    },
    nb: {
      subject: "Hvordan gikk det?",
      preview: "Vi håper du er fornøyd med bestillingen.",
      heading: "Takk for bestillingen",
      text: "Vi håper alt kom fram som det skulle. Er det noe som ikke stemmer, kan du svare på denne e-posten, så hjelper vi deg.",
      button: "Besøk butikken",
      url: "/",
    },
    sv: {
      subject: "Hur gick det?",
      preview: "Vi hoppas att du är nöjd med din beställning.",
      heading: "Tack för din beställning",
      text: "Vi hoppas att allt kom fram som det skulle. Om något inte stämmer kan du svara på det här mejlet, så hjälper vi dig.",
      button: "Besök butiken",
      url: "/",
    },
    da: {
      subject: "Hvordan gik det?",
      preview: "Vi håber, du er glad for din bestilling.",
      heading: "Tak for din bestilling",
      text: "Vi håber, at alt kom frem, som det skulle. Er der noget, der ikke er i orden, kan du svare på denne e-mail, så hjælper vi dig.",
      button: "Besøg butikken",
      url: "/",
    },
  },
  win_back: {
    en: {
      subject: "It has been a while",
      preview: "Here is what is new in the store.",
      heading: "It has been a while",
      text: "We have added things since your last visit. Have a look when you have a moment.",
      button: "See what is new",
      url: "/products",
    },
    nb: {
      subject: "Det er en stund siden",
      preview: "Her er det som er nytt i butikken.",
      heading: "Det er en stund siden",
      text: "Vi har fått inn nye ting siden sist du var innom. Ta en titt når du har tid.",
      button: "Se det som er nytt",
      url: "/products",
    },
    sv: {
      subject: "Det var ett tag sedan",
      preview: "Här är det som är nytt i butiken.",
      heading: "Det var ett tag sedan",
      text: "Vi har fått in nya saker sedan du var här senast. Ta en titt när du har tid.",
      button: "Se det som är nytt",
      url: "/products",
    },
    da: {
      subject: "Det er et stykke tid siden",
      preview: "Her er det nye i butikken.",
      heading: "Det er et stykke tid siden",
      text: "Vi har fået nye ting ind, siden du sidst kiggede forbi. Tag et kig, når du har tid.",
      button: "Se det nye",
      url: "/products",
    },
  },
};

function asContent(s: Starter): LanguageContent {
  return {
    subject: s.subject,
    preview: s.preview,
    blocks: [
      { type: "heading", text: s.heading },
      { type: "paragraph", text: s.text },
      { type: "button", text: s.button, url: s.url },
    ],
  };
}

/** A kind's starting words for each of the store's languages that has them (a language without is left for the owner to write). */
export function starterContent(kind: LifecycleKind, locales: readonly string[]): BroadcastContent {
  const out: BroadcastContent = {};
  for (const locale of locales) {
    const lang = locale.slice(0, 2) as keyof (typeof AUTOMATION_STARTERS)[LifecycleKind];
    const starter = AUTOMATION_STARTERS[kind][lang];
    if (starter) out[locale] = asContent(starter);
  }
  return out;
}
