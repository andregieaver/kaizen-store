import type { FlowsMessages } from "./flows.en";

/** Norwegian (bokmål), written by hand (D767). */
export const flowsNb: FlowsMessages = {
  title: "Forløp",
  lead: "Et forløp sender e-poster etter hverandre til hver person, fra noe skjer, og stopper når de når målet.",
  empty: "Ingen forløp ennå. Start med en velkomstserie: tre e-poster, klare til å lese og endre.",
  startWelcome: "Start en velkomstserie",
  open: "Åpne",
  statuses: { on: "På", off: "Av" },
  untested: "Test det før du slår det på.",
  test: "Test det",
  tested: "Testet på {person}: {emails}.",
  testedNobody: "Testet uten noen på listen din ennå: {emails}.",
  ends: { goal: "Det stopper ved målet.", done: "Så slutter det." },
  switchOn: "Slå på",
  switchOff: "Slå av",
  switchedOn: "På. Nye personer går gjennom det fra nå.",
  switchedOff: "Av. Ingen nye går inn; de som er i det, fullfører.",
  emailLabel: "E-post",
  story: {
    triggers: {
      "subscriber.subscribed": "Når noen melder seg på listen din:",
      "order.paid": "Når noen betaler for en bestilling:",
      "checkout.abandoned": "Når noen forlater kassen:",
    },
    sameDay: "samme dag",
    after: { hours: { one: "en time senere", many: "{n} timer senere" }, days: { one: "en dag senere", many: "{n} dager senere" } },
    conditions: {
      ordered: { yes: "hvis de har bestilt", no: "hvis de ikke har bestilt" },
      clicked: { yes: "hvis de trykket på en lenke", no: "hvis de ikke trykket på en lenke" },
      segment: { yes: "hvis de er i {segment}", no: "hvis de ikke er i {segment}" },
    },
    goal: "Det stopper når de bestiller.",
    ends: "Så slutter det.",
  },
  problems: { untested: "Test forløpet før du slår det på.", missing: "Det forløpet hører ikke til denne butikken." },
};
