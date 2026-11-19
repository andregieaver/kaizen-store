import type { BroadcastContent } from "./broadcasts";
import type { FlowInput } from "./flows";

type Words = {
  name: string;
  welcome: [string, string];
  best: [string, string];
  thanks: [string, string];
  afterName: string;
  howIsIt: [string, string];
  again: [string, string];
  backName: string;
  missYou: [string, string];
  lastCall: [string, string];
  ownName: string;
  hello: [string, string];
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
    backName: "Hent tilbake kunder",
    missYou: ["Vi savner deg", "Det er en stund siden sist. Se hva som er nytt hos oss."],
    lastCall: ["Fortsatt her for deg", "Vi har mye nytt siden sist. Kanskje noe for deg?"],
    ownName: "Mitt forløp",
    hello: ["Hei!", "Skriv hva denne e-posten sier."],
  },
  en: {
    name: "Welcome series",
    welcome: ["Welcome!", "Thank you for wanting to hear from us. Here is what we are most proud of."],
    best: ["What others like best", "Have you seen our most popular things? Here are a few."],
    thanks: ["Thank you for your order!", "We hope you love it. Tell us if anything is wrong."],
    afterName: "After a purchase",
    howIsIt: ["How is it going?", "You have had it for a week now. Reply to this email if anything is not as it should be."],
    again: ["Something new for you", "Thank you for last time! Here is something we think you will like."],
    backName: "Bring back customers",
    missYou: ["We miss you", "It has been a while. See what is new with us."],
    lastCall: ["Still here for you", "A lot is new since last time. Perhaps something for you?"],
    ownName: "My flow",
    hello: ["Hello!", "Write what this email says."],
  },
};

const email = (id: string, locale: string, [subject, text]: [string, string]) => ({
  id,
  kind: "email" as const,
  content: { [locale]: { subject, preview: "", blocks: [{ type: "paragraph" as const, text }] } },
});

export type Recipe = Pick<FlowInput, "name" | "trigger" | "steps" | "goals" | "replaces" | "triggerDays">;

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

/**
 * Bring back customers (slice 4, M2.3, win-back): 90 days after a person's latest paid order with nothing since, we miss you; two weeks
 * later, to someone who has still not ordered, one more. Ended by an order. Does the win-back automation's work.
 */
export function winBack(locale: string): Recipe {
  const w = wordsFor(locale);
  return {
    name: w.backName,
    trigger: "customer.lapsed",
    triggerDays: 90,
    replaces: "win_back",
    steps: [email("miss", locale, w.missYou), { id: "wait-14d", kind: "wait", hours: 14 * 24 }, email("last", locale, w.lastCall)],
    goals: [{ kind: "ordered" }],
  };
}

/** The goals a flow starts from on the flows page (M3.1), each with its recipe; in the order shown. */
export const RECIPES = { welcome: welcomeSeries, after_purchase: afterPurchase, win_back: winBack } as const;
export type RecipeKey = keyof typeof RECIPES;

/** An automation as saved (D298, D653): its days, words and follow-ups, as `getAutomation()` gives them. */
export type SavedAutomation = { delayDays: number | null; content: BroadcastContent | null; followUps: readonly { position: number; delayDays: number; content: BroadcastContent }[] };

/**
 * A goal's flow from the owner's own automation (D767 slice 3, M2.2: today's automations moved onto the engine): its first email after its
 * days, then each follow-up its days after the one before, ended by an order as follow-ups are (D653), replacing that automation. The
 * owner's words and days as they are; the recipe's name. Null when the automation has no words.
 */
export function flowFromAutomation(key: RecipeKey, automation: SavedAutomation, locale: string): Recipe | null {
  if (!automation.content || Object.keys(automation.content).length === 0) return null;
  const recipe = RECIPES[key](locale);
  const wait = (id: string, days: number | null): FlowInput["steps"] => (days && days > 0 ? [{ id, kind: "wait", hours: days * 24 }] : []);
  // Win-back's days are the lapse itself (the trigger's), not a wait after it.
  const lapse = recipe.trigger === "customer.lapsed";
  const steps: FlowInput["steps"] = [
    ...(lapse ? [] : wait("wait-1", automation.delayDays)),
    { id: "email-1", kind: "email", content: automation.content },
    ...automation.followUps.flatMap((f) => [...wait(`wait-${f.position}`, f.delayDays), { id: `email-${f.position}`, kind: "email" as const, content: f.content }]),
  ];
  return {
    name: recipe.name,
    trigger: recipe.trigger,
    triggerDays: lapse ? (automation.delayDays ?? recipe.triggerDays) : null,
    replaces: recipe.replaces,
    steps,
    // An order ends follow-ups (D653), and a win-back always: its only point is the next order.
    goals: lapse || automation.followUps.length > 0 ? [{ kind: "ordered" }] : [],
  };
}

/**
 * A flow of the owner's own (slice 4, M2.3): one email when an order is sent, to change from there; what starts it is chosen under
 * Customise. Replaces nothing.
 */
export function ownFlow(locale: string): Recipe {
  const w = wordsFor(locale);
  return { name: w.ownName, trigger: "order.sent", replaces: null, steps: [email("hello", locale, w.hello)], goals: [] };
}
