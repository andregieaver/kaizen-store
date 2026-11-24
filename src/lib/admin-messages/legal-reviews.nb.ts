import type { LegalReviewsMessages } from "./legal-reviews.en";

/** Norwegian (bokmål), written by hand (D892). */
export const legalReviewsNb: LegalReviewsMessages = {
  title: "Juridiske gjennomganger",
  lead: "Utkast skrevet for at en advokat skal lese dem. Hvert sier hva koden gjør eller ville gjort; vurderingen din av hvert punkt lagres med navnet ditt og datoen.",
  none: "Ingen utkast venter.",
  open: "Les og svar",
  answered: "{n} av {all} punkter besvart",
  back: "Alle juridiske gjennomganger",
  points: "Din vurdering, punkt for punkt",
  pointsLead: "Skriv vurderingen din av hvert punkt. En ny vurdering sletter ikke den forrige: den lagres ved siden av, nyeste først.",
  yourView: "Din vurdering",
  save: "Lagre vurderingen",
  saved: "Lagret.",
  latest: "{by}, {date}",
  earlier: { one: "1 tidligere vurdering lagret", many: "{n} tidligere vurderinger lagret" },
  notYet: "Ingen vurdering ennå.",
  problems: { empty: "Skriv vurderingen først.", long: "Det er for langt: hold det under 4 000 tegn.", missing: "Det punktet hører ikke til denne gjennomgangen." },
};
