import type { LeadScoreMessages } from "./lead-score.en";

/** En bedriftskundes lead-poeng (M2.8, D865), på norsk bokmål, skrevet for hånd. */
export const leadScoreNb: LeadScoreMessages = {
  title: "Lead-poeng",
  score: "{n} av 100",
  levels: { hot: "Het: verdt en samtale", warm: "Varm", cool: "Kjølig", none: "Ingenting ennå" },
  none: "Ingen tilbudsforespørsel, avtale, trykk på en e-postlenke eller produktvisning ennå.",
  reasons: {
    quotes: { one: "Ba om et tilbud de siste 90 dagene", many: "Ba om {n} tilbud de siste 90 dagene" },
    deal: { one: "Har en åpen avtale", many: "Har {n} åpne avtaler" },
    pressed: { one: "Trykket på en lenke i e-postene dine denne måneden", many: "Trykket på {n} lenker i e-postene dine denne måneden" },
    pressedEarlier: { one: "Trykket på en lenke i e-postene dine de siste 3 månedene", many: "Trykket på {n} lenker i e-postene dine de siste 3 månedene" },
    viewed: { one: "Så på en vare mens de var innlogget", many: "Så på {n} varer mens de var innlogget" },
  },
};
