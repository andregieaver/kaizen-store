import type { StorePartsMessages } from "./store-parts.en";

/** Butikkens komponenter og deler slik sidebyggeren navngir dem, på bokmål (D312), skrevet for hånd. */
export const storePartsNb: StorePartsMessages = {
  parts: {
    cart: { name: "Handlekurv", hint: "Kundens handlekurv: linjene, antallene, rabattkoden og knappen til kassen." },
    checkout: { name: "Kasse", hint: "Ordresammendraget og betalingsskjemaet. Uten en ordre å betale blir kundene sendt tilbake til handlekurven." },
    order: {
      name: "Ordrebekreftelse",
      hint: "Det kunden ser etter å ha betalt: ordren, nedlastingene, bookingene og abonnementet. Adressen bærer ordren.",
    },
    account: { name: "Min konto", hint: "Den innloggede kundens ordrer, abonnementer og opplysninger. Utlogget er den skjemaet for å logge inn." },
    sign_in: { name: "Innlogging", hint: "Skjemaet for å logge inn eller opprette en konto, vist på Min konto for kunder som ikke er logget inn." },
    wishlist: { name: "Ønskelister", hint: "Kundens ønskelister, klare for handlekurven." },
    subscription: {
      name: "Abonnement",
      hint: "Ett abonnement å sette på pause, hoppe over eller avslutte. Adressen bærer hemmeligheten i en lenke, fra e-poster og Min konto.",
    },
    deliveries: { name: "Abonnementskasser", hint: "Kundens liste for butikkens abonnementskasser, levert på leveringsdagene." },
    cookies: { name: "Informasjonskapsler", hint: "Hva nettstedet lagrer i nettleseren, og kundens valg." },
    category: {
      name: "Kategoriens produkter",
      hint: "En kategoris navn, dens egne tilpassede felt, underkategoriene og produktene med Filtrer og sorter. Den vises på kategorisidene (/category/…), uansett hvilken kategori kunden er i.",
    },
    private: {
      name: "Passord",
      hint: "Butikkens navn og passordfeltet som slipper besøkende inn mens butikken er privat. Den vises bare på landingssiden (Innstillinger, Privat modus).",
    },
    tag: {
      name: "Stikkordets produkter",
      hint: "Et stikkords navn, dets egne tilpassede felt og produktene med Filtrer og sorter. Den vises på stikkordsidene (/tag/…), uansett hvilket stikkord kunden er i.",
    },
    cart_lines: {
      name: "Varer i handlekurven",
      hint: "Linjene i handlekurven med bilder, antall, fjernknapper og gratis gaver. En tom handlekurv sier det her, med en lenke tilbake til butikken.",
    },
    cart_gift: { name: "Gavehilsen", hint: "Avkrysningsboksen og feltene for en gavehilsen. Ingenting i en butikk der gavehilsener er slått av." },
    cart_summary: { name: "Sammendrag av handlekurven", hint: "Delsum, frakt, rabatter, mva. og totalen, med det et abonnement eller en avtale legger til." },
    cart_code: { name: "Rabattkode", hint: "Feltet for en rabattkode i handlekurven." },
    cart_credits: {
      name: "Bonuskreditt",
      hint: "Der en innlogget kunde bruker bonuskreditten sin, eller ser hva ordren gir; en gjest blir bedt om å logge inn. Ingenting i en butikk uten bonusprogram.",
    },
    cart_checkout: {
      name: "Knappen til kassen",
      hint: "Knappen som starter kassen, med feltene og samtykkene handlekurven trenger først (en bedrift, kontaktopplysninger, digitale varer, et abonnement).",
    },
    cart_continue: { name: "Fortsett å handle", hint: "En lenke tilbake til butikkens forside." },
    checkout_items: { name: "Varer i kassen", hint: "Ordrens linjer, slik kunden er i ferd med å betale for dem." },
    checkout_code: { name: "Rabattkode i kassen", hint: "Feltet for en rabattkode i kassen." },
    checkout_credits: {
      name: "Bonuskreditt i kassen",
      hint: "Der en innlogget kunde bruker bonuskreditten sin i kassen, eller ser hva ordren gir. Ingenting i en butikk uten bonusprogram.",
    },
    checkout_delivery: {
      name: "Levering i kassen",
      hint: "Hvordan ordren leveres: fastprisen og, når kunden har oppgitt et postnummer, fraktselskapets tjenester og hentesteder. Ingenting i en butikk uten et fraktselskaps tjenester slått på.",
    },
    checkout_totals: { name: "Totaler i kassen", hint: "Delsum, frakt, rabatter, mva. og totalen, med bedriften og et abonnements vilkår." },
    checkout_terms: {
      name: "Vilkår i kassen",
      hint: "Setningen som nevner vilkårene og personvernerklæringen, med en avkrysningsboks når du har valgt det under Innstillinger, Juridiske sider. Sett den rett over betalingsskjemaet; uten den viser standardkassen den ved betalingsknappen. Ingenting når butikken ikke viser noen.",
    },
    checkout_payment: { name: "Betalingsskjema", hint: "Kontakt, levering og betaling, og knappen for å betale. Behold den: det er slik ordren blir betalt." },
    checkout_back: { name: "Tilbake til handlekurven", hint: "En lenke tilbake til handlekurven." },
    order_status: {
      name: "Takk",
      hint: "Takkeoverskriften (eller at ordren ble kansellert), ordrenummeret og at betalingen blir bekreftet. Behold den: den oppdaterer også siden mens betalingen bekreftes.",
    },
    order_account: {
      name: "Konto opprettet",
      hint: "Hva som skjedde med kontoen kunden ba om i kassen: opprettet, med en knapp til den, eller allerede kjent, med en måte å logge inn på. Ingenting når det ikke ble bedt om noen.",
    },
    order_bookings: { name: "Bookinger", hint: "Ordrens avtaler, opphold og utleie, som kan endres eller avbestilles så lenge det er tillatt." },
    order_parcels: {
      name: "Pakker",
      hint: "Ordrens pakker, hver med sporing og hva som var i den, og hva som fortsatt kommer når ordren sendes i flere deler. Ingenting før den første pakken.",
    },
    order_lines: { name: "Varer i ordren", hint: "Linjene kunden kjøpte." },
    order_totals: { name: "Ordretotaler", hint: "Frakt, rabatter, totalen og mva. av den, og bedriften den ble kjøpt for." },
    order_documents: {
      name: "Faktura og kreditnotaer",
      hint: "Ordrens faktura og kreditnotaer, hver med en lenke for å lese den og laste den ned som PDF. Ingenting for en ordre uten, og «Testordre: ingen faktura» for en som er betalt i testmodus.",
    },
    order_subscription: { name: "Abonnement", hint: "Abonnementet ordren startet, med en lenke for å administrere det. Ingenting for en ordre uten." },
    order_downloads: { name: "Nedlastinger", hint: "Filene som er kjøpt, til nedlasting når ordren er betalt. Ingenting for en ordre uten filer." },
    order_address: { name: "Leveringsadresse", hint: "Hvor ordren leveres. Ingenting for en ordre som ikke sendes." },
    order_terms: {
      name: "Vilkår du godtok",
      hint: "Vilkårene og personvernerklæringen kunden ble vist da de bestilte, hver som en side som bare kan leses. Ingenting for en ordre som ikke tok vare på noen.",
    },
    order_continue: { name: "Fortsett å handle", hint: "En lenke tilbake til butikkens forside." },
    free_shipping: {
      name: "Fri frakt",
      hint: "Hvor mye mer kunden må handle for fri frakt, med en stolpe som fylles, eller at frakten er gratis. Den bruker beløpet for fri frakt i markedets fraktpris (Innstillinger, Frakt); ingenting vises uten et.",
    },
    you_saved: {
      name: "Du sparte",
      hint: "Hva kunden sparer i dag på handlekurven: reduksjoner mot hvert produkts laveste pris de siste 30 dagene, og rabatter. Ingenting vises når ingenting er spart.",
    },
    cart_upsell: {
      name: "Passer godt med",
      hint: "Produkter som passer med det som ligger i handlekurven (mersalg, krysssalg og tilbehør, etter reglene dine under Anbefalinger), hver med en knapp for å legge det til. Tom handlekurv, ingenting vises.",
    },
  },
  groups: {
    cart: { name: "Deler av handlekurven", hint: "Handlekurvsiden tatt fra hverandre. Delene viser seg på siden som er valgt for handlekurven." },
    checkout: { name: "Deler av kassen", hint: "Kassesiden tatt fra hverandre. Delene viser seg på siden som er valgt for kassen." },
    order: { name: "Deler av ordrebekreftelsen", hint: "Takkesiden tatt fra hverandre. Delene viser seg på siden som er valgt for ordrebekreftelsen." },
  },
};
