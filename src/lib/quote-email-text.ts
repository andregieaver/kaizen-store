/**
 * The words of the request-a-quote emails (D431), by language, joined into `emailText()` as `quote`: the receipt a shopper gets when they ask, the
 * quote itself (the draft's pay link, `sendDraftLink()`, in place of the draft's own words), and the store's reply when it declines. Written by hand
 * in nb, sv, da and en; other languages are the AI catalogue's. Sent only to the address the shopper typed. No imports: `email-text.ts` reads it.
 */

const en = {
  quote: {
    receivedSubject: (store: string) => `${store}: we have your request for a quote`,
    receivedHeading: "Thank you for your request",
    receivedIntro: (store: string) => `${store} has your request for a quote. We will email you a quote at this address as soon as we can.`,
    linesHeading: "You asked about",
    sentSubject: (store: string, number: string) => `${store}: your quote ${number}`,
    sentHeading: "Your quote is ready",
    sentIntro: (store: string) => `${store} has prepared the quote you asked for. Look it over, and accept it by paying online when you are ready.`,
    sentButton: "See and accept the quote",
    declinedSubject: (store: string) => `${store}: about your request for a quote`,
    declinedHeading: "About your request for a quote",
    declinedIntro: (store: string) => `${store} has read your request and cannot send you a quote this time.`,
    replyHeading: "Message from the store",
    notYou: "If you did not ask for a quote, you can ignore this email.",
  },
};

type QuoteEmail = typeof en;

const nb: QuoteEmail = {
  quote: {
    receivedSubject: (store) => `${store}: vi har mottatt forespørselen din om tilbud`,
    receivedHeading: "Takk for forespørselen",
    receivedIntro: (store) => `${store} har mottatt forespørselen din om tilbud. Vi sender deg et tilbud på e-post til denne adressen så snart vi kan.`,
    linesHeading: "Du spurte om",
    sentSubject: (store, number) => `${store}: tilbudet ditt ${number}`,
    sentHeading: "Tilbudet ditt er klart",
    sentIntro: (store) => `${store} har laget tilbudet du ba om. Se over det, og godta det ved å betale på nettsiden når du er klar.`,
    sentButton: "Se og godta tilbudet",
    declinedSubject: (store) => `${store}: om forespørselen din om tilbud`,
    declinedHeading: "Om forespørselen din om tilbud",
    declinedIntro: (store) => `${store} har lest forespørselen din og kan dessverre ikke gi deg et tilbud denne gangen.`,
    replyHeading: "Melding fra butikken",
    notYou: "Har du ikke bedt om et tilbud, kan du se bort fra denne e-posten.",
  },
};

const sv: QuoteEmail = {
  quote: {
    receivedSubject: (store) => `${store}: vi har tagit emot din offertförfrågan`,
    receivedHeading: "Tack för din förfrågan",
    receivedIntro: (store) => `${store} har tagit emot din offertförfrågan. Vi mejlar dig en offert till den här adressen så snart vi kan.`,
    linesHeading: "Du frågade om",
    sentSubject: (store, number) => `${store}: din offert ${number}`,
    sentHeading: "Din offert är klar",
    sentIntro: (store) => `${store} har tagit fram offerten du bad om. Titta igenom den och godkänn den genom att betala på webbplatsen när du är redo.`,
    sentButton: "Se och godkänn offerten",
    declinedSubject: (store) => `${store}: om din offertförfrågan`,
    declinedHeading: "Om din offertförfrågan",
    declinedIntro: (store) => `${store} har läst din förfrågan och kan tyvärr inte lämna en offert den här gången.`,
    replyHeading: "Meddelande från butiken",
    notYou: "Om du inte har bett om en offert kan du bortse från det här mejlet.",
  },
};

const da: QuoteEmail = {
  quote: {
    receivedSubject: (store) => `${store}: vi har modtaget din anmodning om et tilbud`,
    receivedHeading: "Tak for din anmodning",
    receivedIntro: (store) => `${store} har modtaget din anmodning om et tilbud. Vi sender dig et tilbud på e-mail til denne adresse, så snart vi kan.`,
    linesHeading: "Du spurgte om",
    sentSubject: (store, number) => `${store}: dit tilbud ${number}`,
    sentHeading: "Dit tilbud er klar",
    sentIntro: (store) => `${store} har lavet det tilbud, du bad om. Se det igennem, og accepter det ved at betale på hjemmesiden, når du er klar.`,
    sentButton: "Se og accepter tilbuddet",
    declinedSubject: (store) => `${store}: om din anmodning om et tilbud`,
    declinedHeading: "Om din anmodning om et tilbud",
    declinedIntro: (store) => `${store} har læst din anmodning og kan desværre ikke give dig et tilbud denne gang.`,
    replyHeading: "Besked fra butikken",
    notYou: "Har du ikke bedt om et tilbud, kan du se bort fra denne e-mail.",
  },
};

export const QUOTE_EMAIL_TEXT = { nb, sv, da, en };
