import type { MarketSlug } from "./markets";

/**
 * Interface text for each market. Legal texts (terms, withdrawal information)
 * are not here: they need human review and will live in their own files.
 */
const messages = {
  no: {
    storeTagline: "Demobutikk under bygging",
    products: "Produkter",
    vatIncluded: "inkl. mva.",
    priorPrice: "Laveste pris siste 30 dager",
    fromPrice: "Fra",
    inStock: "På lager",
    lowStock: (n: number) => `Kun ${n} igjen`,
    outOfStock: "Utsolgt",
    checkingStock: "Sjekker lager …",
    variants: "Varianter",
    description: "Beskrivelse",
    safety: "Sikkerhet og produsent",
    manufacturer: "Produsent",
    euResponsiblePerson: "Ansvarlig person i EU",
    noWithdrawal: "Denne varen er unntatt fra angreretten.",
    backToProducts: "Tilbake til produkter",
    chooseMarket: "Velg land",
    noProducts: "Ingen produkter ennå.",
    demoNotice: "Dette er en demobutikk. Ingenting kan kjøpes ennå.",
    options: { colour: "Farge", ruling: "Linjer", white: "Hvit", black: "Svart", lined: "Linjert", dotted: "Prikket" },
  },
  se: {
    storeTagline: "Demobutik under uppbyggnad",
    products: "Produkter",
    vatIncluded: "inkl. moms",
    priorPrice: "Lägsta pris senaste 30 dagarna",
    fromPrice: "Från",
    inStock: "I lager",
    lowStock: (n: number) => `Endast ${n} kvar`,
    outOfStock: "Slutsåld",
    checkingStock: "Kontrollerar lager …",
    variants: "Varianter",
    description: "Beskrivning",
    safety: "Säkerhet och tillverkare",
    manufacturer: "Tillverkare",
    euResponsiblePerson: "Ansvarig person i EU",
    noWithdrawal: "Den här varan är undantagen från ångerrätten.",
    backToProducts: "Tillbaka till produkter",
    chooseMarket: "Välj land",
    noProducts: "Inga produkter ännu.",
    demoNotice: "Det här är en demobutik. Inget kan köpas ännu.",
    options: { colour: "Färg", ruling: "Linjering", white: "Vit", black: "Svart", lined: "Linjerad", dotted: "Prickad" },
  },
  dk: {
    storeTagline: "Demobutik under opbygning",
    products: "Produkter",
    vatIncluded: "inkl. moms",
    priorPrice: "Laveste pris de seneste 30 dage",
    fromPrice: "Fra",
    inStock: "På lager",
    lowStock: (n: number) => `Kun ${n} tilbage`,
    outOfStock: "Udsolgt",
    checkingStock: "Tjekker lager …",
    variants: "Varianter",
    description: "Beskrivelse",
    safety: "Sikkerhed og producent",
    manufacturer: "Producent",
    euResponsiblePerson: "Ansvarlig person i EU",
    noWithdrawal: "Denne vare er undtaget fra fortrydelsesretten.",
    backToProducts: "Tilbage til produkter",
    chooseMarket: "Vælg land",
    noProducts: "Ingen produkter endnu.",
    demoNotice: "Dette er en demobutik. Intet kan købes endnu.",
    options: { colour: "Farve", ruling: "Linjer", white: "Hvid", black: "Sort", lined: "Linjeret", dotted: "Prikket" },
  },
} satisfies Record<MarketSlug, unknown>;

export type Messages = (typeof messages)["no"];

export function t(slug: MarketSlug): Messages {
  return messages[slug];
}

/** Human label for a variant option such as `{ colour: "white" }`. */
export function optionLabel(m: Messages, options: Record<string, string>): string {
  const labels = m.options as Record<string, string>;
  return Object.entries(options)
    .map(([key, value]) => `${labels[key] ?? key}: ${labels[value] ?? value}`)
    .join(", ");
}
