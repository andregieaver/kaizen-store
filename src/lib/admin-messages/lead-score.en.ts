import type { Widen } from "./common.en";

/**
 * A business customer's lead score (email plan M2.8, D865), in English: the card on the customer's page with the score, how warm, and each
 * point's reason. `{n}` is filled by `fillWords()`. Only the server reads them (`SERVER_AREAS`).
 */
export const leadScoreEn = {
  title: "Lead score",
  score: "{n} of 100",
  levels: { hot: "Hot: worth a call", warm: "Warm", cool: "Cool", none: "Nothing yet" },
  none: "No quote, deal, press on an email link or product view yet.",
  reasons: {
    quotes: { one: "Asked for a quote in the last 90 days", many: "Asked for {n} quotes in the last 90 days" },
    deal: { one: "Has an open deal", many: "Has {n} open deals" },
    pressed: { one: "Pressed a link in your emails this month", many: "Pressed {n} links in your emails this month" },
    pressedEarlier: { one: "Pressed a link in your emails in the last 3 months", many: "Pressed {n} links in your emails in the last 3 months" },
    viewed: { one: "Looked at a product while signed in", many: "Looked at {n} products while signed in" },
  },
};

export type LeadScoreMessages = Widen<typeof leadScoreEn>;
