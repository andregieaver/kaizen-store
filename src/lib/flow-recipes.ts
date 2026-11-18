import type { FlowInput } from "./flows";

type Words = { name: string; welcome: [string, string]; best: [string, string]; thanks: [string, string] };

const WORDS: Record<"nb" | "en", Words> = {
  nb: {
    name: "Velkomstserie",
    welcome: ["Velkommen!", "Takk for at du vil høre fra oss. Her er det vi er mest stolte av."],
    best: ["Det andre liker best", "Har du sett våre mest populære varer? Her er et utvalg."],
    thanks: ["Takk for bestillingen!", "Vi håper du blir fornøyd. Si gjerne fra hvis noe er galt."],
  },
  en: {
    name: "Welcome series",
    welcome: ["Welcome!", "Thank you for wanting to hear from us. Here is what we are most proud of."],
    best: ["What others like best", "Have you seen our most popular things? Here are a few."],
    thanks: ["Thank you for your order!", "We hope you love it. Tell us if anything is wrong."],
  },
};

const email = (id: string, locale: string, [subject, text]: [string, string]) => ({
  id,
  kind: "email" as const,
  content: { [locale]: { subject, preview: "", blocks: [{ type: "paragraph" as const, text }] } },
});

/**
 * The welcome series (D767 slice 2): a welcome the same day; three days later best sellers to someone who has not ordered, a thank-you to
 * someone who has; ended early by an order. In the store's first language, Norwegian or English words; the owner's to change. Slice 3 adds
 * the other recipes (M2.2, M3.1).
 */
export function welcomeSeries(locale: string): { name: string; trigger: "subscriber.subscribed"; steps: FlowInput["steps"]; goals: FlowInput["goals"] } {
  const w = WORDS[locale.startsWith("nb") || locale.startsWith("nn") || locale.startsWith("no") ? "nb" : "en"];
  return {
    name: w.name,
    trigger: "subscriber.subscribed",
    steps: [
      email("welcome", locale, w.welcome),
      { id: "wait-3d", kind: "wait", hours: 72 },
      { id: "ordered", kind: "if", condition: { kind: "ordered_since_entry" }, then: [email("thanks", locale, w.thanks)], else: [email("best", locale, w.best)] },
    ],
    goals: [],
  };
}
