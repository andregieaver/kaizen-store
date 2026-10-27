/**
 * What a shopper reads about customs and duties (wave 7 unit I, D343): the cart, the checkout, the order page, the confirmation email and Stripe's
 * line. LEGAL TEXT: hand-written in nb, sv, da and en, never machine-translated (it is not in `i18n.ts` or `email-text.ts`'s `text`, so the AI
 * catalogue never sees it); every other language shows English. Not legal advice and not reviewed: it needs a lawyer's review, as the Consumer
 * Rights Directive Art. 6(1)(e) asks for extra charges to be stated and DDP is a promise that nothing more is charged on delivery.
 */
// legal: needs review

export type CustomsText = {
  /** The row in the cart and the line at Stripe for what DDP collects. */
  dutiesLine: string;
  /** Beside every amount that is an estimate. */
  estimate: string;
  /** DDP: what the row means. */
  ddpNote: string;
  /** DAP with an estimate above zero. */
  dapEstimate: (amount: string) => string;
  /** DAP where the estimate is nothing (under every threshold). */
  dapNothing: string;
  /** DAP with no estimate. */
  dapUnknown: string;
  /** DDP blocked: products with no customs code. */
  missingHs: (names: string) => string;
  /** DDP blocked: no rate for the goods or the country, or no exchange rate. */
  noEstimate: string;
  /** The checkout's refusal (`customs`). */
  problem: string;
  /** The order page and the confirmation. */
  orderDdp: (amount: string) => string;
  orderDapEstimate: (amount: string) => string;
  orderDap: string;
};

const TEXT: Record<"nb" | "sv" | "da" | "en", CustomsText> = {
  nb: {
    dutiesLine: "Toll og importavgifter",
    estimate: "anslag",
    ddpNote: "Toll og importavgifter for dette landet betales her i kassen, så transportøren skal ikke kreve dem ved levering. Beløpet er et anslag ut fra publiserte satser.",
    dapEstimate: (amount) => `Transportøren kan kreve inn toll og importavgifter på omtrent ${amount} ved levering. Dette er et anslag, før transportørens egne gebyrer.`,
    dapNothing: "Etter vårt anslag skal det ikke betales toll eller importavgifter ved levering.",
    dapUnknown: "Transportøren kan kreve inn toll og importavgifter ved levering. Vi kan ikke anslå dem for denne bestillingen.",
    missingHs: (names) => `Tollen kan ikke beregnes for ${names}: selgeren har ikke oppgitt varens tollkode. Fjern den fra handlekurven for å fortsette.`,
    noEstimate: "Toll og importavgifter kan ikke beregnes for dette landet nå, så bestillingen kan ikke betales her. Kontakt selgeren.",
    problem: "Toll og importavgifter kan ikke beregnes for en vare i handlekurven. Se handlekurven og prøv igjen.",
    orderDdp: (amount) => `Toll og importavgifter betalt i kassen: ${amount}.`,
    orderDapEstimate: (amount) => `Toll og importavgifter betales av mottakeren til transportøren ved levering: omtrent ${amount} etter vårt anslag, før transportørens egne gebyrer.`,
    orderDap: "Eventuell toll og importavgifter betales av mottakeren til transportøren ved levering.",
  },
  sv: {
    dutiesLine: "Tull och importskatter",
    estimate: "uppskattning",
    ddpNote: "Tull och importskatter för det här landet betalas här i kassan, så transportören ska inte ta ut dem vid leverans. Beloppet är en uppskattning utifrån publicerade satser.",
    dapEstimate: (amount) => `Transportören kan ta ut tull och importskatter på ungefär ${amount} vid leverans. Det är en uppskattning, före transportörens egna avgifter.`,
    dapNothing: "Enligt vår uppskattning ska ingen tull eller importskatt betalas vid leverans.",
    dapUnknown: "Transportören kan ta ut tull och importskatter vid leverans. Vi kan inte uppskatta dem för den här beställningen.",
    missingHs: (names) => `Tullen kan inte beräknas för ${names}: säljaren har inte angett varans tullkod. Ta bort den ur varukorgen för att fortsätta.`,
    noEstimate: "Tull och importskatter kan inte beräknas för det här landet just nu, så beställningen kan inte betalas här. Kontakta säljaren.",
    problem: "Tull och importskatter kan inte beräknas för en vara i varukorgen. Se varukorgen och försök igen.",
    orderDdp: (amount) => `Tull och importskatter betalda i kassan: ${amount}.`,
    orderDapEstimate: (amount) => `Tull och importskatter betalas av mottagaren till transportören vid leverans: ungefär ${amount} enligt vår uppskattning, före transportörens egna avgifter.`,
    orderDap: "Eventuell tull och importskatt betalas av mottagaren till transportören vid leverans.",
  },
  da: {
    dutiesLine: "Told og importafgifter",
    estimate: "skøn",
    ddpNote: "Told og importafgifter for dette land betales her ved kassen, så transportøren skal ikke opkræve dem ved levering. Beløbet er et skøn ud fra offentliggjorte satser.",
    dapEstimate: (amount) => `Transportøren kan opkræve told og importafgifter på omkring ${amount} ved levering. Det er et skøn, før transportørens egne gebyrer.`,
    dapNothing: "Efter vores skøn skal der ikke betales told eller importafgifter ved levering.",
    dapUnknown: "Transportøren kan opkræve told og importafgifter ved levering. Vi kan ikke skønne dem for denne ordre.",
    missingHs: (names) => `Tolden kan ikke beregnes for ${names}: sælgeren har ikke angivet varens toldkode. Fjern den fra kurven for at fortsætte.`,
    noEstimate: "Told og importafgifter kan ikke beregnes for dette land lige nu, så ordren kan ikke betales her. Kontakt sælgeren.",
    problem: "Told og importafgifter kan ikke beregnes for en vare i kurven. Se kurven, og prøv igen.",
    orderDdp: (amount) => `Told og importafgifter betalt ved kassen: ${amount}.`,
    orderDapEstimate: (amount) => `Told og importafgifter betales af modtageren til transportøren ved levering: omkring ${amount} efter vores skøn, før transportørens egne gebyrer.`,
    orderDap: "Eventuel told og importafgifter betales af modtageren til transportøren ved levering.",
  },
  en: {
    dutiesLine: "Duties and import taxes",
    estimate: "estimate",
    ddpNote: "Duties and import taxes for this country are paid here, at checkout, so the carrier should not ask for them on delivery. The amount is an estimate from published rates.",
    dapEstimate: (amount) => `The carrier may collect duties and import taxes of about ${amount} on delivery. This is an estimate, before the carrier's own fees.`,
    dapNothing: "By our estimate, no duties or import taxes are due on delivery.",
    dapUnknown: "The carrier may collect duties and import taxes on delivery. We can't estimate them for this order.",
    missingHs: (names) => `Duties can't be worked out for ${names}: the seller hasn't given its customs code. Remove it from the cart to continue.`,
    noEstimate: "Duties and import taxes can't be worked out for this country right now, so this order can't be paid here. Please contact the seller.",
    problem: "Duties and import taxes can't be worked out for something in your cart. Check the cart and try again.",
    orderDdp: (amount) => `Duties and import taxes paid at checkout: ${amount}.`,
    orderDapEstimate: (amount) => `Duties and import taxes are paid by the recipient to the carrier on delivery: about ${amount} by our estimate, before the carrier's own fees.`,
    orderDap: "Any duties and import taxes are paid by the recipient to the carrier on delivery.",
  },
};

/** The customs wording in a language (`nb`, `sv`, `da`, `en`; a locale's language part is enough), English for every other. */
export function customsText(lang: string): CustomsText {
  const code = (lang || "en").toLowerCase().split("-")[0];
  const key = code === "nn" || code === "no" ? "nb" : code;
  return key in TEXT ? TEXT[key as keyof typeof TEXT] : TEXT.en;
}

type Money = (minor: number) => string;

/** What the cart and checkout say about a basket's customs, as sentences (the DDP row itself is drawn by the caller); none where no border is crossed. */
export function cartCustomsSentences(
  customs: {
    mode: "ddp" | "dap";
    blocked: boolean;
    estimate: { kind: "none" } | { kind: "unknown"; reason: string; lines: { title: string }[] } | { kind: "estimate"; dapMinor: number };
  },
  words: CustomsText,
  money: Money,
): { text: string; problem: boolean }[] {
  const e = customs.estimate;
  if (e.kind === "none") return [];
  if (customs.blocked && e.kind === "unknown") {
    return [{ text: e.reason === "missing_hs" && e.lines.length > 0 ? words.missingHs(e.lines.map((l) => l.title).join(", ")) : words.noEstimate, problem: true }];
  }
  if (customs.mode === "ddp") return [{ text: words.ddpNote, problem: false }];
  if (e.kind === "unknown") return [{ text: words.dapUnknown, problem: false }];
  return [{ text: e.dapMinor > 0 ? words.dapEstimate(money(e.dapMinor)) : words.dapNothing, problem: false }];
}

/** What the order page and the confirmation email say about an order's customs, or null where none crossed a border. */
export function orderCustomsSentence(
  customs: { mode: "ddp" | "dap"; collectedMinor: number; estimate: { dapMinor: number } | null } | null,
  words: CustomsText,
  money: Money,
): string | null {
  if (!customs) return null;
  if (customs.mode === "ddp" && customs.collectedMinor > 0) return words.orderDdp(money(customs.collectedMinor));
  if (customs.mode === "dap" && customs.estimate && customs.estimate.dapMinor > 0) return words.orderDapEstimate(money(customs.estimate.dapMinor));
  if (customs.mode === "dap") return words.orderDap;
  // DDP with nothing to collect (under every threshold): nothing is due on delivery by the estimate.
  return words.dapNothing;
}
