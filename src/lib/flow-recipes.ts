import type { FlowInput } from "./flows";

type Words = {
  name: string;
  welcome: [string, string];
  best: [string, string];
  thanks: [string, string];
  afterName: string;
  howIsIt: [string, string];
  again: [string, string];
};

const WORDS: Record<"nb" | "en", Words> = {
  nb: {
    name: "Velkomstserie",
    welcome: ["Velkommen!", "Takk for at du vil høre fra oss. Her er det vi er mest stolte av."],
    best: ["Det andre liker best", "Har du sett våre mest populære varer? Her er et utvalg."],
    thanks: ["Takk for bestillingen!", "Vi håper du blir fornøyd. Si gjerne fra hvis noe er galt."],
    afterName: "Etter et kjøp",
    howIsIt: ["Hvordan går det med varen?", "Nå har du hatt den en uke. Svar gjerne på denne e-posten hvis noe ikke er som det skal."],
    again: ["Noe nytt til deg", "Takk for sist! Her er noe vi tror du vil like."],
  },
  en: {
    name: "Welcome series",
    welcome: ["Welcome!", "Thank you for wanting to hear from us. Here is what we are most proud of."],
    best: ["What others like best", "Have you seen our most popular things? Here are a few."],
    thanks: ["Thank you for your order!", "We hope you love it. Tell us if anything is wrong."],
    afterName: "After a purchase",
    howIsIt: ["How is it going?", "You have had it for a week now. Reply to this email if anything is not as it should be."],
    again: ["Something new for you", "Thank you for last time! Here is something we think you will like."],
  },
};

const email = (id: string, locale: string, [subject, text]: [string, string]) => ({
  id,
  kind: "email" as const,
  content: { [locale]: { subject, preview: "", blocks: [{ type: "paragraph" as const, text }] } },
});

export type Recipe = Pick<FlowInput, "name" | "trigger" | "steps" | "goals" | "replaces">;

const wordsFor = (locale: string) => WORDS[locale.startsWith("nb") || locale.startsWith("nn") || locale.startsWith("no") ? "nb" : "en"];

/**
 * The welcome series (D767 slice 2): a welcome the same day; three days later best sellers to someone who has not ordered, a thank-you to
 * someone who has. In the store's first language, Norwegian or English words; the owner's to change. Does the welcome automation's
 * work (`replaces`).
 */
export function welcomeSeries(locale: string): Recipe {
  const w = wordsFor(locale);
  return {
    name: w.name,
    trigger: "subscriber.subscribed",
    replaces: "welcome",
    steps: [
      email("welcome", locale, w.welcome),
      { id: "wait-3d", kind: "wait", hours: 72 },
      { id: "ordered", kind: "if", condition: { kind: "ordered_since_entry" }, then: [email("thanks", locale, w.thanks)], else: [email("best", locale, w.best)] },
    ],
    goals: [],
  };
}

/**
 * After a purchase (D767 slice 3, M2.2): a week after an order is paid, ask how it is going; three weeks later, to someone who has not
 * ordered again, something new. Does the after-purchase automation's work, so switching it on switches that one off.
 */
export function afterPurchase(locale: string): Recipe {
  const w = wordsFor(locale);
  return {
    name: w.afterName,
    trigger: "order.paid",
    replaces: "after_purchase",
    steps: [
      { id: "wait-7d", kind: "wait", hours: 7 * 24 },
      email("how", locale, w.howIsIt),
      { id: "wait-21d", kind: "wait", hours: 21 * 24 },
      { id: "ordered", kind: "if", condition: { kind: "ordered_since_entry" }, then: [], else: [email("again", locale, w.again)] },
    ],
    goals: [],
  };
}

/** The goals a flow starts from on the flows page (M3.1), each with its recipe; in the order shown. */
export const RECIPES = { welcome: welcomeSeries, after_purchase: afterPurchase } as const;
export type RecipeKey = keyof typeof RECIPES;
