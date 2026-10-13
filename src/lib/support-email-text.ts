/**
 * The answer email a customer gets from a support conversation (D216, `docs/support.md` 2.3, step 5): hand-written in Norwegian,
 * Swedish, Danish and English, never machine-translated (it says what an address typed in a chat is used for), English for any
 * other language. Legal: needs review (section 8).
 */

export type SupportEmailText = {
  subject: (desk: string) => string;
  preview: (desk: string) => string;
  heading: string;
  intro: (desk: string) => string;
  button: string;
  linkNote: string;
  why: string;
  /** A staff request was decided (step 10, `support.request_done`). */
  decisionSubject: (desk: string) => string;
  decisionHeading: string;
  decisionWhy: string;
};

const TEXT: Record<"nb" | "sv" | "da" | "en", SupportEmailText> = {
  nb: {
    subject: (desk) => `Svar fra ${desk}`,
    preview: (desk) => `${desk} har svart deg i chatten.`,
    heading: "Du har fått svar",
    intro: (desk) => `${desk} har svart deg i chatten:`,
    button: "Svar i samtalen",
    linkNote: "Lenken åpner samtalen til en nyere e-post fra oss kommer med en ny lenke. Ikke del den med andre.",
    why: "Du får denne e-posten fordi du la igjen adressen din i chatten. Vi bruker den bare til svarene i denne samtalen.",
    decisionSubject: (desk) => `${desk} har svart på forespørselen din`,
    decisionHeading: "Svar på forespørselen din",
    decisionWhy: "Du får denne e-posten fordi du ba om dette i chatten.",
  },
  sv: {
    subject: (desk) => `Svar från ${desk}`,
    preview: (desk) => `${desk} har svarat dig i chatten.`,
    heading: "Du har fått svar",
    intro: (desk) => `${desk} har svarat dig i chatten:`,
    button: "Svara i samtalet",
    linkNote: "Länken öppnar samtalet tills ett nyare mejl från oss kommer med en ny länk. Dela den inte med någon.",
    why: "Du får det här mejlet eftersom du lämnade din adress i chatten. Vi använder den bara för svaren i det här samtalet.",
    decisionSubject: (desk) => `${desk} har svarat på din begäran`,
    decisionHeading: "Svar på din begäran",
    decisionWhy: "Du får det här mejlet eftersom du bad om det här i chatten.",
  },
  da: {
    subject: (desk) => `Svar fra ${desk}`,
    preview: (desk) => `${desk} har svaret dig i chatten.`,
    heading: "Du har fået svar",
    intro: (desk) => `${desk} har svaret dig i chatten:`,
    button: "Svar i samtalen",
    linkNote: "Linket åbner samtalen, indtil en nyere e-mail fra os kommer med et nyt link. Del det ikke med andre.",
    why: "Du får denne e-mail, fordi du skrev din adresse i chatten. Vi bruger den kun til svarene i denne samtale.",
    decisionSubject: (desk) => `${desk} har svaret på din forespørgsel`,
    decisionHeading: "Svar på din forespørgsel",
    decisionWhy: "Du får denne e-mail, fordi du bad om dette i chatten.",
  },
  en: {
    subject: (desk) => `An answer from ${desk}`,
    preview: (desk) => `${desk} answered you in the chat.`,
    heading: "You have an answer",
    intro: (desk) => `${desk} answered you in the chat:`,
    button: "Answer in the conversation",
    linkNote: "The link opens the conversation until a newer email from us brings a new one. Don't share it.",
    why: "You get this email because you left your address in the chat. We use it only for the answers in this conversation.",
    decisionSubject: (desk) => `${desk} answered your request`,
    decisionHeading: "An answer to your request",
    decisionWhy: "You get this email because you asked for this in the chat.",
  },
};

export function supportEmailText(lang: string): SupportEmailText {
  const short = lang.split("-")[0];
  return short in TEXT ? TEXT[short as keyof typeof TEXT] : TEXT.en;
}
