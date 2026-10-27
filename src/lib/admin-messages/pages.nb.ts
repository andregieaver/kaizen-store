/** Each admin page's Norwegian title and the Norwegian words people use for it (D312 A2), by `${area}:${id}` as ADMIN_PAGES_BY_ID keys them. Hand-written; legal, tax, payment and privacy words from the glossary (src/lib/i18n-glossary.ts). */
export const PAGES_NB: Record<string, { title: string; keywords: string[] }> = {
  // The store
  "store:overview": { title: "Hjem", keywords: ["hjem", "oversikt", "dashbord", "start", "sjekkliste", "forside"] },
  "store:setup": { title: "Oppsett", keywords: ["oppsett", "veiviser", "kom i gang", "lansering", "åpne butikken"] },
  "store:setup.step": { title: "Steg i oppsettet", keywords: ["oppsett", "steg", "veiviser", "kom i gang"] },
  "store:assistant": { title: "KI-assistent", keywords: ["ki-assistent", "assistent", "ki", "chat", "minne", "kunstig intelligens"] },
  "store:assistant.autopilot": { title: "Autopilot", keywords: ["autopilot", "planer", "mål", "beslutninger", "godkjenninger", "selvstendighet"] },

  // Orders
  "store:orders": {
    title: "Bestillinger",
    keywords: ["bestillinger", "ordre", "ordrer", "salg", "søk i bestillinger", "til sending", "arkiv", "lagrede visninger"],
  },
  "store:order": {
    title: "Bestilling",
    keywords: ["bestilling", "ordre", "tilbakebetaling", "sporing", "sende", "kansellere", "pakke", "henting"],
  },
  "store:order.edit": { title: "Endre bestilling", keywords: ["endre bestilling", "endre ordre", "legg til vare", "fjern vare", "bytt vare"] },
  "store:orders.export": {
    title: "Eksporter bestillinger",
    keywords: ["eksporter bestillinger", "eksporter ordre", "csv", "regnskap", "regnskapsfører", "excel", "last ned"],
  },
  "store:order.packing-slip": { title: "Pakkseddel", keywords: ["pakkseddel", "skriv ut", "pakke", "gavekvittering"] },
  "store:orders.packing-slips": { title: "Pakksedler", keywords: ["pakksedler", "pakkseddel", "skriv ut flere", "plukk"] },
  "store:orders.pick-list": { title: "Plukkliste", keywords: ["plukkliste", "plukking", "plukk", "lager"] },
  "store:orders.drafts": {
    title: "Utkast til bestillinger",
    keywords: ["utkast", "utkast til bestilling", "tilbud", "manuell ordre", "telefonordre", "betalingslenke", "opprett bestilling"],
  },
  "store:orders.draft.new": { title: "Nytt utkast til bestilling", keywords: ["nytt utkast", "opprett bestilling", "manuell ordre", "utkast"] },
  "store:orders.draft": {
    title: "Utkast til bestilling",
    keywords: ["utkast", "betalingslenke", "send faktura", "merk som betalt", "bankoverføring", "kontant", "egen pris", "personalrabatt"],
  },
  "store:order.terms": {
    title: "Vilkår slik de ble vist",
    keywords: ["vilkår", "godtatte vilkår", "salgsbetingelser", "personvernerklæring", "hva kunden godtok"],
  },
  "store:returns": {
    title: "Returer",
    keywords: ["returer", "retur", "angrerett", "angrefrist", "sende tilbake", "returforespørsel", "tilbakebetaling"],
  },
  "store:return": { title: "Retur", keywords: ["retur", "angrerett", "tilbakebetaling", "kontroll", "tilbake på lager", "verdiforringelse"] },
  "store:invoices": {
    title: "Fakturaer",
    keywords: ["fakturaer", "faktura", "kreditnota", "salgsdokument", "kvittering", "pdf", "regnskapsfører", "fakturanummer"],
  },
  "store:subscriptions": { title: "Abonnementer", keywords: ["abonnementer", "abonnement", "gjentakende betaling", "fornyelser"] },
  "store:subscription": { title: "Abonnement", keywords: ["abonnement", "fornyelse", "pause", "hopp over", "avslutt abonnement"] },

  // Products
  "store:products": { title: "Produkter", keywords: ["produkter", "produkt", "varer", "vare", "katalog", "lager", "enhetspris"] },
  "store:product.new": { title: "Nytt produkt", keywords: ["nytt produkt", "ny vare", "legg til produkt", "opprett produkt"] },
  "store:product": { title: "Produkt", keywords: ["produkt", "vare", "pris", "lager", "variant", "rediger produkt", "enhetspris"] },
  "store:product.categories": {
    title: "Produktkategorier og stikkord",
    keywords: ["produktkategorier", "kategorier", "stikkord", "kolleksjoner", "enhetspris"],
  },
  "store:products.export": {
    title: "Eksporter produkter",
    keywords: ["eksporter produkter", "csv", "last ned produkter", "regneark", "excel", "sikkerhetskopi", "produktfil"],
  },
  "store:products.import": {
    title: "Importer produkter",
    keywords: ["importer produkter", "csv", "last opp produkter", "shopify", "flytte butikken", "produktfil"],
  },
  "store:products.import.job": {
    title: "Produktimport",
    keywords: ["produktimport", "prøvekjøring", "sjekk filen", "importfeil", "importresultat", "avbryt import"],
  },
  "store:products.bulk": {
    title: "Rediger produkter i rutenett",
    keywords: ["rediger flere produkter", "masseredigering", "prisendring", "prosent", "salg", "angre", "regneark", "rutenett"],
  },
  "store:inventory": {
    title: "Lager",
    keywords: ["lager", "lagerbeholdning", "lagernivå", "tilgjengelig", "restordre", "lite på lager", "telling", "juster lager"],
  },
  "store:gift-cards": { title: "Gavekort", keywords: ["gavekort", "tilgodelapp", "saldo", "utstede gavekort", "utløpsdato", "verdikort"] },
  "store:gift-cards.new": { title: "Utsted et gavekort", keywords: ["utstede gavekort", "nytt gavekort", "gavekort", "beløp"] },
  "store:gift-card": { title: "Gavekort", keywords: ["gavekort", "saldo", "utløpsdato", "historikk"] },
  "store:reviews": {
    title: "Omtaler",
    keywords: ["omtaler", "anmeldelser", "produktomtaler", "vurderinger", "stjerner", "moderering", "verifisert kjøp", "svar på omtale"],
  },
  "store:reviews.import": {
    title: "Importer omtaler",
    keywords: ["importer omtaler", "eksporter omtaler", "omtaler csv", "judge.me", "shopify-omtaler", "trustpilot"],
  },
  "store:inventory.history": {
    title: "Lagerhistorikk",
    keywords: ["lagerhistorikk", "lagerbevegelser", "justeringer", "hvem endret lageret", "historikk"],
  },
  "store:inventory.locations": {
    title: "Lagersteder",
    keywords: ["lagersteder", "lager", "lokasjon", "varelager", "ruting", "deaktiver lagersted"],
  },
  "store:inventory.import": { title: "Importer lager", keywords: ["importer lager", "lagertelling", "varetelling", "csv", "telling"] },
  "store:inventory.import.job": { title: "Lagerimport", keywords: ["lagerimport", "prøvekjøring", "konflikt", "importresultat", "avbryt import"] },
  "store:inventory.export": { title: "Eksporter lager", keywords: ["eksporter lager", "lagerfil", "csv", "last ned lager", "telleliste"] },
  "store:product-layouts": { title: "Produktoppsett", keywords: ["produktoppsett", "produktside", "design av produktside", "mal"] },
  "store:product-layout.new": { title: "Nytt produktoppsett", keywords: ["nytt produktoppsett", "produktside", "oppsett"] },
  "store:product-layout": { title: "Produktoppsett", keywords: ["produktoppsett", "sidebygger", "produktside"] },
  "store:product-layout.preview": { title: "Forhåndsvisning av produktoppsett", keywords: ["forhåndsvisning", "produktoppsett", "produktside"] },
  "store:product-layout.assign": {
    title: "Hvor et oppsett brukes",
    keywords: ["oppsett", "hvor brukes", "produktoppsett", "kategorier", "standardoppsett"],
  },
  "store:fields": {
    title: "Egendefinerte felt",
    keywords: ["egendefinerte felt", "ekstra felt", "felt", "egenskaper", "spesifikasjoner", "produktdata"],
  },
  "store:fields.new": { title: "Ny gruppe med egendefinerte felt", keywords: ["ny feltgruppe", "egendefinerte felt", "felt"] },
  "store:fields.store": {
    title: "Butikkens opplysninger",
    keywords: ["butikkens opplysninger", "åpningstider", "merkevarehistorie", "felles felt", "egendefinerte felt"],
  },
  "store:field-group": { title: "Gruppe med egendefinerte felt", keywords: ["feltgruppe", "egendefinerte felt", "betinget logikk", "felt"] },

  // Pages and the blog
  "store:pages": { title: "Sider", keywords: ["sider", "side", "nettsted", "forside", "landingsside", "innhold"] },
  "store:page.new": { title: "Ny side", keywords: ["ny side", "opprett side", "sidebygger"] },
  "store:page": { title: "Side", keywords: ["side", "sidebygger", "rediger side", "publiser"] },
  "store:page.preview": { title: "Forhåndsvisning av side", keywords: ["forhåndsvisning", "side", "utkast"] },
  "store:page.ai": { title: "Lag en side med KI", keywords: ["lag side med ki", "generer side", "ki-side", "ki", "studio"] },
  "store:page.categories": { title: "Sidekategorier og stikkord", keywords: ["sidekategorier", "kategorier", "stikkord"] },
  "store:articles": { title: "Blogg", keywords: ["blogg", "innlegg", "artikler", "nyheter"] },
  "store:article.new": { title: "Ny artikkel", keywords: ["ny artikkel", "nytt innlegg", "blogg"] },
  "store:article": { title: "Artikkel", keywords: ["artikkel", "innlegg", "blogg", "skriv"] },
  "store:article.preview": { title: "Forhåndsvisning av artikkel", keywords: ["forhåndsvisning", "artikkel", "innlegg", "utkast"] },
  "store:article.categories": { title: "Bloggkategorier og stikkord", keywords: ["bloggkategorier", "kategorier", "stikkord", "blogg"] },
  "store:content": { title: "Innhold", keywords: ["innholdstyper", "oppføringer", "eget innhold", "ansatte", "spørsmål og svar", "steder"] },
  "store:content.new": { title: "Ny innholdstype", keywords: ["ny innholdstype", "innholdstype", "felter"] },
  "store:content.type": { title: "Oppføringer av en innholdstype", keywords: ["oppføringer", "innholdstype"] },
  "store:content.type.settings": { title: "Innstillinger for innholdstype", keywords: ["innholdstype", "felter", "navn på nett"] },
  "store:content.entry.new": { title: "Ny oppføring", keywords: ["ny oppføring", "oppføring"] },
  "store:content.entry": { title: "Oppføring", keywords: ["oppføring", "publiser", "rediger"] },
  "store:content.layout": { title: "Oppføringsside", keywords: ["oppføringsside", "oppsett", "sidebygger", "innholdstype"] },
  "store:content.layout.preview": { title: "Forhåndsvisning av oppføringsside", keywords: ["forhåndsvisning", "oppføringsside"] },
  "store:media": {
    title: "Medier",
    keywords: ["medier", "mediebibliotek", "bilder", "foto", "videoer", "alternativ tekst", "alt-tekst"],
  },

  // Marketing
  "store:discounts": { title: "Rabattkoder", keywords: ["rabattkoder", "rabattkode", "kupong", "rabatt", "salg", "kampanje"] },
  "store:discount.new": { title: "Ny rabattkode", keywords: ["ny rabattkode", "opprett rabattkode", "kupong", "rabatt"] },
  "store:discount": { title: "Rabattkode", keywords: ["rabattkode", "kupong", "rabatt", "bruk", "slå av"] },
  "store:wishlists": { title: "Ønskelister", keywords: ["ønskelister", "ønskeliste", "favoritter", "lagret"] },
  "store:wishlist": { title: "Ønskeliste", keywords: ["ønskeliste", "favoritter", "kunde"] },
  "store:wishlists.activity": { title: "Aktivitet i ønskelister", keywords: ["ønskeliste", "aktivitet", "lagt i handlekurven", "kjøpt"] },
  "store:emails": { title: "E-poster", keywords: ["e-poster", "e-post", "sendte e-poster", "e-postlogg"] },
  "store:email": { title: "E-post", keywords: ["e-post", "sendt e-post", "melding"] },

  // Work, at the owner's level
  "account:work": {
    title: "Arbeid",
    keywords: ["arbeid", "timer", "kunder", "konsulent", "utestående", "ikke fakturert", "frilans", "oversikt"],
  },
  "account:work.clients": {
    title: "Kunder i Arbeid",
    keywords: ["kunder", "klienter", "oppdragsgivere", "oppdrag", "fakturaadresse", "konsulent"],
  },
  "account:work.time": { title: "Timer", keywords: ["timer", "timeføring", "tidtaker", "timeliste", "føre timer", "tid"] },
  "account:work.invoices": {
    title: "Fakturaer i Arbeid",
    keywords: ["fakturaer", "faktura", "kreditnota", "betaling", "forfalt", "timer", "konsulent"],
  },
  "account:work.reports": { title: "Rapporter i Arbeid", keywords: ["rapporter", "rapport", "eksport", "csv", "timer", "periode"] },
  "account:work.settings": {
    title: "Innstillinger for Arbeid",
    keywords: ["innstillinger", "arbeid", "slå på arbeid", "fakturainnstillinger", "moduler"],
  },
  "account:work.store": { title: "Butikkens arbeid", keywords: ["arbeid", "timer", "utestående", "ikke fakturert", "oversikt"] },
  "account:work.store.clients": {
    title: "Butikkens kunder i Arbeid",
    keywords: ["kunder", "klienter", "oppdragsgivere", "oppdrag", "fakturaadresse"],
  },
  "account:work.client": {
    title: "Kunde i Arbeid",
    keywords: ["kunde", "klient", "fakturaadresse", "mva-behandling", "timepris", "oppdrag", "arkiver"],
  },
  "account:work.assignment": {
    title: "Oppdrag",
    keywords: ["oppdrag", "oppgave", "estimat", "tidtaker", "føre timer", "timer", "fastpris"],
  },
  "account:work.store.invoices": {
    title: "Butikkens fakturaer",
    keywords: ["fakturaer", "faktura", "kreditnota", "betaling", "forfalt", "timer"],
  },
  "account:work.invoice": {
    title: "Faktura i Arbeid",
    keywords: ["faktura", "utkast", "utstede", "kreditnota", "betaling", "fakturalinjer", "forfalt"],
  },
  "account:work.store.time": { title: "Butikkens timer", keywords: ["timer", "timeføring", "tidtaker", "timeliste", "føre timer"] },
  "account:work.store.reports": { title: "Butikkens rapporter i Arbeid", keywords: ["rapporter", "rapport", "eksport", "csv", "timer", "periode"] },
  "account:work.store.settings": {
    title: "Butikkens innstillinger for Arbeid",
    keywords: ["fakturainnstillinger", "mva", "bankkonto", "iban", "fakturanummer", "nummerering", "betalingsfrist"],
  },

  // Bookings and hosts
  "store:bookings": { title: "Kalender", keywords: ["kalender", "timebestillinger", "avtaler", "timeplan", "booking", "uteblitt"] },
  "store:bookings.staff": { title: "Ansatte og åpningstider", keywords: ["ansatte", "åpningstider", "personale", "timebestilling"] },
  "store:bookings.staff.new": { title: "Ny ansatt", keywords: ["ny ansatt", "legg til ansatt", "timebestilling"] },
  "store:bookings.staff.one": { title: "Ansatt", keywords: ["ansatt", "åpningstider", "tjenester", "blokkeringer"] },
  "store:bookings.stays": { title: "Opphold og utleie", keywords: ["opphold", "utleie", "rom", "belegg", "booking"] },
  "store:bookings.units": { title: "Rom og gjenstander", keywords: ["rom", "gjenstander", "enheter", "utleie", "kalender"] },
  "store:bookings.units.new": { title: "Nytt rom eller ny gjenstand", keywords: ["nytt rom", "ny gjenstand", "utleie", "legg til rom"] },
  "store:bookings.unit": {
    title: "Rom eller gjenstand",
    keywords: ["rom", "gjenstand", "kapasitet", "blokkeringer", "kalendersynkronisering"],
  },
  "store:hosts": { title: "Verter", keywords: ["verter", "utleiere", "provisjon", "annonser", "utleie"] },
  "store:host": { title: "Vert", keywords: ["vert", "utleier", "utbetalinger", "provisjon", "annonser"] },
  "store:hosts.dac7": { title: "DAC7-rapport", keywords: ["dac7", "skatt", "rapport", "verter", "inntekt"] },

  // Campaigns, tests and loyalty
  "store:campaigns": {
    title: "Kampanjer",
    keywords: ["kampanjer", "kampanje", "tilbud", "salg", "3 for 2", "gratis gave", "rabatt", "black friday"],
  },
  "store:recommendations": {
    title: "Anbefalinger",
    keywords: ["anbefalinger", "anbefalte produkter", "mersalg", "kryssalg", "relaterte produkter", "du liker kanskje", "ofte kjøpt sammen"],
  },
  "store:experiments": {
    title: "A/B-tester",
    keywords: ["a/b-test", "ab-test", "splittest", "eksperiment", "test en side", "konvertering", "vinner", "versjon"],
  },
  "store:experiment.new": { title: "Ny A/B-test", keywords: ["ny a/b-test", "opprett test", "a/b-test", "eksperiment"] },
  "store:experiment": { title: "A/B-test", keywords: ["a/b-test", "test", "versjoner", "start test", "resultater"] },
  "store:experiment.variants": { title: "Testversjoner", keywords: ["testversjoner", "versjoner", "a/b-test"] },
  "store:experiment.variant": { title: "En testversjon", keywords: ["testversjon", "versjon", "a/b-test", "sidebygger"] },
  "store:experiment.variant.preview": { title: "Forhåndsvisning av testversjon", keywords: ["forhåndsvisning", "testversjon", "a/b-test"] },
  "store:campaign.new": { title: "Ny kampanje", keywords: ["ny kampanje", "opprett kampanje", "tilbud", "kampanje"] },
  "store:campaign": { title: "Kampanje", keywords: ["kampanje", "tilbud", "rabatt", "slå av"] },
  "store:bonus": {
    title: "Bonuspoeng",
    keywords: ["bonus", "bonusprogram", "lojalitet", "poeng", "belønning", "faste kunder", "kundeklubb", "opptjening"],
  },
  "store:affiliates": {
    title: "Vervekampanje",
    keywords: ["verving", "verv en venn", "vervelenke", "vennerabatt", "velkomstrabatt", "inviter venner", "tips en venn", "ambassadør"],
  },

  // Customers
  "store:customers": { title: "Kunder", keywords: ["kunder", "kunde", "kjøpere", "kundeliste", "personer"] },
  "store:customers.export": { title: "Eksporter kunder", keywords: ["eksporter kunder", "csv", "kundeliste", "last ned kunder", "excel"] },
  "store:customer": { title: "Kunde", keywords: ["kunde", "kundens bestillinger", "kundegruppe", "bonus"] },
  "store:privacy": {
    title: "Personvernforespørsler",
    keywords: ["personvern", "personvernforespørsler", "rett til innsyn", "rett til sletting", "slett kunde", "anonymisere", "personopplysninger", "gdpr"],
  },
  "store:privacy.new": {
    title: "Registrer en personvernforespørsel",
    keywords: ["registrer forespørsel", "ny forespørsel", "personvern", "rett til innsyn", "rett til sletting"],
  },
  "store:privacy.request": {
    title: "Personvernforespørsel",
    keywords: ["personvernforespørsel", "forlenge", "avslå", "identitet", "én måned", "svar på forespørsel"],
  },
  "store:customer.erase": {
    title: "Slett personopplysninger",
    keywords: ["slett personopplysninger", "slett kunde", "anonymisere", "rett til sletting", "bli glemt", "personvern", "gdpr"],
  },
  "store:customer-groups": {
    title: "Kundegrupper",
    keywords: ["kundegrupper", "grossist", "b2b", "prisliste", "forhandlerrabatt", "fast rabatt"],
  },
  "store:customer-group": { title: "Kundegruppe", keywords: ["kundegruppe", "rabattgruppe", "prosent", "kunder"] },
  "store:price-lists": {
    title: "Prislister",
    keywords: ["prisliste", "b2b-priser", "grossistpriser", "forhandlerpriser", "kundepriser", "avtalepriser", "nettopriser"],
  },
  "store:price-list": { title: "Prisliste", keywords: ["prisliste", "faste priser", "prosent", "kundegrupper", "bedrifter"] },
  "store:b2b-companies": {
    title: "Bedrifter",
    keywords: ["bedrifter", "bedriftskunder", "b2b", "ansatte", "bedriftskonto", "inviter", "grossist"],
  },
  "store:b2b-company": { title: "Bedrift", keywords: ["bedrift", "bedriftskonto", "ansatte", "invitasjoner"] },
  "store:deliveries": {
    title: "Abonnementskasser",
    keywords: ["abonnementskasse", "fast bestilling", "ukentlig levering", "matkasse", "leveringsdager"],
  },
  "store:segments": { title: "Segmenter", keywords: ["segmenter", "segment", "målgruppe", "kundeliste", "rfm", "vip", "gjenvinning"] },
  "store:broadcasts": {
    title: "Nyhetsbrev",
    keywords: ["utsendelser", "nyhetsbrev", "e-postkampanje", "e-postmarkedsføring", "send e-post til kunder"],
  },
  "store:email-automations": {
    title: "Automatiske e-poster",
    keywords: ["automatisering", "velkomst-e-post", "velkomstmail", "gjenvinning", "tilbake på lager", "gi meg beskjed", "flyt"],
  },
  "store:ads": {
    title: "Annonser og konverteringer",
    keywords: ["konverteringer", "conversions api", "meta-piksel", "facebook-piksel", "tiktok", "pinterest", "sporing på serveren", "annonsesporing"],
  },
  "store:feeds": {
    title: "Produktfeeder",
    keywords: ["produktfeed", "google shopping", "merchant center", "meta-katalog", "facebook-butikk", "instagram shopping", "tiktok-katalog", "pinterest-katalog", "xml-feed", "csv-feed"],
  },
  "store:email-automation": { title: "E-postautomatisering", keywords: ["e-postautomatisering", "automatisering", "test-e-post", "slå på"] },
  "store:broadcast.new": { title: "Ny utsendelse", keywords: ["ny utsendelse", "nytt nyhetsbrev", "skriv e-post", "utsendelse"] },
  "store:broadcast": { title: "Utsendelse", keywords: ["utsendelse", "nyhetsbrev", "send nå", "planlegg", "test-e-post"] },
  "store:segment.new": { title: "Nytt segment", keywords: ["nytt segment", "opprett segment", "regler", "målgruppe"] },
  "store:segment": { title: "Segment", keywords: ["segment", "målgruppe", "antall", "personer"] },
  "store:subscribers": {
    title: "Abonnenter",
    keywords: ["abonnenter", "nyhetsbrev", "e-postliste", "samtykke", "dobbel bekreftelse", "avmelding", "meld av"],
  },
  "store:subscriber": { title: "Abonnent", keywords: ["abonnent", "samtykke", "historikk", "meld av"] },
  "store:cart-reminders": {
    title: "Påminnelser om handlekurv",
    keywords: ["forlatt handlekurv", "handlekurvpåminnelse", "påminnelse", "gjenvinning"],
  },
  "store:cart-reminder.new": { title: "Ny handlekurvpåminnelse", keywords: ["ny påminnelse", "handlekurvpåminnelse", "forlatt handlekurv"] },
  "store:cart-reminder": { title: "Handlekurvpåminnelse", keywords: ["handlekurvpåminnelse", "påminnelse", "rabattkode", "forlatt handlekurv"] },

  // Shipping, returns and orders' settings
  "store:shipping": {
    title: "Frakt",
    keywords: ["frakt", "fraktpris", "levering", "fast fraktpris", "gratis frakt", "standardvekt", "leveringskostnader"],
  },
  "store:shipping.methods": {
    title: "Fraktmetoder",
    keywords: ["fraktmetoder", "fraktmetode", "fraktpriser", "ekspress", "standardfrakt"],
  },
  "store:shipping.method": {
    title: "Fraktmetode",
    keywords: ["fraktmetode", "vektbasert frakt", "prisbasert frakt", "pristabell", "trinn"],
  },
  "store:shipping.zones": {
    title: "Fraktsoner",
    keywords: ["fraktsoner", "sone", "soner", "postnummer", "postnumre", "avsidesliggende områder"],
  },
  "store:shipping.profiles": { title: "Fraktprofiler", keywords: ["fraktprofiler", "fraktklasse", "store varer", "skjøre varer"] },
  "store:shipping.pickup": {
    title: "Henting",
    keywords: ["henting", "hent i butikk", "hente i butikk", "klikk og hent", "hentested", "utleveringssted"],
  },
  "store:shipping.local": {
    title: "Lokal levering",
    keywords: ["lokal levering", "hjemlevering", "egen levering", "leveringsradius", "levering i nærområdet"],
  },
  "store:returns.settings": {
    title: "Innstillinger for retur",
    keywords: ["returinnstillinger", "angrerett", "angrefrist", "returadresse", "returfrakt", "retningslinjer for retur"],
  },
  "store:orders.settings": {
    title: "Innstillinger for bestillinger",
    keywords: ["bestillingsinnstillinger", "gavemelding", "gave", "arkiver automatisk", "betalingslenke", "betalt utenfor", "kontant", "bankoverføring"],
  },
  "store:notifications": {
    title: "Varsler",
    keywords: ["varsler", "varsel", "e-post til kunder", "ordrebekreftelse", "sendebekreftelse", "e-postmal", "slå av e-post"],
  },
  "store:notifications.edit": {
    title: "Rediger en kunde-e-post",
    keywords: ["e-postmal", "rediger e-post", "emne", "ordlyd", "plassholder", "forhåndsvis e-post", "test-e-post"],
  },
  "store:notifications.staff": {
    title: "Varsler til ansatte",
    keywords: ["varsler til ansatte", "ny bestilling", "ordrevarsel", "daglig sammendrag", "ukentlig sammendrag", "mottakere"],
  },
  "store:automation": {
    title: "Automatisering",
    keywords: ["automatisering", "regler", "ordreregler", "arbeidsflyt", "automatisk stikkord", "hold igjen bestilling", "svindelsjekk"],
  },
  "store:automation.new": { title: "Ny automatiseringsregel", keywords: ["ny regel", "legg til regel", "opprett automatisering", "automatisering"] },
  "store:automation.rule": { title: "Automatiseringsregel", keywords: ["regel", "automatiseringsregel", "vilkår", "handlinger"] },
  "store:automation.log": { title: "Automatiseringslogg", keywords: ["automatiseringslogg", "regelkjøringer", "hva reglene gjorde", "logg"] },

  // Tax, invoicing and payments
  "store:tax": {
    title: "Innstillinger for merverdiavgift",
    keywords: ["merverdiavgift", "mva", "avgift", "organisasjonsnummer", "omvendt avgiftsplikt", "oss", "ioss", "vies"],
  },
  "store:invoices.settings": {
    title: "Innstillinger for fakturering",
    keywords: ["fakturering", "faktura", "fakturanummer", "nummerering", "serie", "prefiks", "kreditnota", "bankopplysninger"],
  },
  "store:producer-responsibility": {
    title: "Produsentansvar",
    keywords: ["produsentansvar", "emballasje", "ee-avfall", "batterier", "returordning", "returselskap", "registreringsnummer", "gjenvinning", "selges ikke"],
  },
  "store:customs": {
    title: "Toll og importmva.",
    keywords: ["toll", "tollavgift", "importmva", "ddp", "dap", "hs-kode", "tolltariff", "voec", "eksport"],
  },
  "store:payments": {
    title: "Betalinger",
    keywords: ["betalinger", "betaling", "stripe", "kort", "gå live", "utbetalinger", "betalingsleverandør", "betalingsmetoder"],
  },

  // Analytics
  "store:analytics": {
    title: "Analyse",
    keywords: ["analyse", "statistikk", "omsetning", "salg", "fortjeneste", "konvertering", "rapport", "nøkkeltall"],
  },
  "store:analytics.finance": {
    title: "Økonomi",
    keywords: ["økonomi", "fortjeneste", "margin", "varekost", "gebyrer", "mva", "nettosalg", "dekningsbidrag"],
  },
  "store:analytics.payouts": {
    title: "Utbetalinger",
    keywords: ["utbetalinger", "utbetaling", "oppgjør", "bank", "overføring", "avstemming", "gebyrer", "saldo"],
  },
  "store:analytics.payout": { title: "En utbetaling", keywords: ["utbetaling", "oppgjør", "posteringer", "gebyr", "tilbakeføring"] },
  "store:analytics.tax": {
    title: "Rapporter for mva., OSS og IOSS",
    keywords: ["mva", "merverdiavgift", "oss", "ioss", "mva-melding", "sats", "regnskapsfører", "avstemming"],
  },
  "store:analytics.customers": {
    title: "Kundeanalyse",
    keywords: ["kundeanalyse", "livstidsverdi", "lojalitet", "kohort", "rfm", "gjenkjøp", "frafall"],
  },
  "store:analytics.products": { title: "Produktanalyse", keywords: ["produktanalyse", "bestselgere", "toppprodukter", "margin", "pareto"] },
  "store:analytics.inventory": {
    title: "Lageranalyse",
    keywords: ["lageranalyse", "lager", "utsolgt", "omløpshastighet", "ukurans", "bestille på nytt"],
  },
  "store:analytics.marketing": {
    title: "Markedsføringsanalyse",
    keywords: ["markedsføringsanalyse", "kanaler", "annonser", "kampanje", "annonsekostnad", "roas", "rabatter", "rabattkoder"],
  },
  "store:analytics.subscriptions": {
    title: "Abonnementsanalyse",
    keywords: ["abonnementsanalyse", "abonnement", "mrr", "frafall", "gjentakende inntekt"],
  },
  "store:analytics.traffic": {
    title: "Trafikkanalyse",
    keywords: ["trafikk", "trafikkanalyse", "besøkende", "økter", "trakt", "enhet", "mobil", "returrate"],
  },
  "store:analytics.speed": {
    title: "Hastighet",
    keywords: ["hastighet", "fart", "ytelse", "sidehastighet", "core web vitals", "treg", "lastetid"],
  },
  "store:analytics.settings": {
    title: "Innstillinger for analyse",
    keywords: ["analyseinnstillinger", "varekost", "kostnader", "gebyrer", "mål", "besøkstelling"],
  },

  // Website and settings
  "store:website": { title: "Nettsted", keywords: ["nettsted", "nettside", "butikkfront", "innhold", "sider"] },
  "store:settings": { title: "Innstillinger", keywords: ["innstillinger", "konfigurasjon", "oppsett", "valg"] },
  "store:countries": {
    title: "Land",
    keywords: ["land", "markeder", "selge til utlandet", "internasjonalt", "hjemland", "flere land"],
  },
  "store:localization": {
    title: "Språk og valutaer",
    keywords: ["språk", "valuta", "valutaer", "valutakurs", "flerspråklig", "euro", "ecb"],
  },
  "store:translate": { title: "Oversett butikken", keywords: ["oversett", "oversettelse", "språk", "ki", "flerspråklig", "produkter"] },
  "store:search": { title: "Søk", keywords: ["søk", "søk på nettstedet", "søkeord", "søk uten treff"] },
  "store:chat": { title: "Chatassistent", keywords: ["chatassistent", "kundechat", "chatbot", "kunnskapsbase", "chat"] },
  "store:support": {
    title: "Innboks for kundestøtte",
    keywords: ["kundestøtte", "innboks", "livechat", "kundeservice", "samtaler", "henvendelser", "support"],
  },
  "store:support.requests": {
    title: "Forespørsler til kundestøtte",
    keywords: ["forespørsler", "forespørsel om tilbakebetaling", "kansellere bestilling", "endre adresse", "unntak", "kundestøtte"],
  },
  "store:support.reports": {
    title: "Rapporter for kundestøtte",
    keywords: ["kundestøtterapport", "svartid", "første svar", "kundetilfredshet", "overleveringsrate", "tapte chatter"],
  },
  "store:support.replies": { title: "Lagrede svar", keywords: ["lagrede svar", "ferdige svar", "maler", "snarveier", "kundestøtte"] },
  "store:support.settings": {
    title: "Innstillinger for kundestøtte",
    keywords: ["kundestøtte", "støttemodus", "livechat", "åpningstider", "oppfølging på e-post", "samtalelogger", "overlevering"],
  },
  "store:seo": { title: "SEO og synlighet", keywords: ["seo", "google", "metabeskrivelse", "søkemotorer", "synlighet", "deling"] },
  "store:menus": { title: "Menyer", keywords: ["menyer", "meny", "navigasjon", "lenker"] },
  "store:redirects": {
    title: "Omdirigeringer",
    keywords: ["omdirigeringer", "omdiriger", "301", "404", "brutt lenke", "flyttet side", "gammel adresse"],
  },
  "store:redirects.import": {
    title: "Importer omdirigeringer",
    keywords: ["importer omdirigeringer", "csv", "last opp omdirigeringer", "shopify", "flytte butikken", "301-fil"],
  },
  "store:redirects.import.job": {
    title: "Import av omdirigeringer",
    keywords: ["import av omdirigeringer", "prøvekjøring", "sjekk filen", "importfeil", "importresultat", "avbryt import"],
  },
  "store:redirects.export": {
    title: "Eksporter omdirigeringer",
    keywords: ["eksporter omdirigeringer", "csv", "last ned omdirigeringer", "sikkerhetskopi"],
  },
  "store:redirects.404s": {
    title: "Sider som ikke ble funnet",
    keywords: ["side ikke funnet", "404", "brutte lenker", "manglende sider", "døde lenker", "404-rapport"],
  },
  "store:navigation": {
    title: "Topptekst og bunntekst",
    keywords: ["topptekst", "bunntekst", "logo", "favikon", "nettstedsikon", "header", "footer"],
  },
  "store:headers": { title: "Topptekster", keywords: ["topptekster", "topptekst", "header", "sidebygger"] },
  "store:header.new": { title: "Ny topptekst", keywords: ["ny topptekst", "topptekst", "header"] },
  "store:header": { title: "Topptekst", keywords: ["topptekst", "header", "sidebygger"] },
  "store:header.preview": { title: "Forhåndsvisning av topptekst", keywords: ["forhåndsvisning", "topptekst", "header"] },
  "store:footers": { title: "Bunntekster", keywords: ["bunntekster", "bunntekst", "footer", "sidebygger"] },
  "store:footer.new": { title: "Ny bunntekst", keywords: ["ny bunntekst", "bunntekst", "footer"] },
  "store:footer": { title: "Bunntekst", keywords: ["bunntekst", "footer", "sidebygger"] },
  "store:footer.preview": { title: "Forhåndsvisning av bunntekst", keywords: ["forhåndsvisning", "bunntekst", "footer"] },
  "store:design": { title: "Design", keywords: ["design", "tema", "farger", "skrifttyper", "utseende", "fonter"] },
  "store:design.theme": {
    title: "Tilpass tema",
    keywords: ["tilpass tema", "forhåndsvis tema", "prøv et tema", "hva endres", "installert tema"],
  },
  "store:close": {
    title: "Steng butikken",
    keywords: ["steng butikken", "slett butikken", "arkiver butikken", "legg ned", "slutte å selge", "åpne igjen"],
  },
  "store:domains": { title: "Domener", keywords: ["domener", "domene", "eget domene", "nettadresse", "adresse"] },
  "store:domain.move-in": { title: "Flytt et domene hit", keywords: ["overføre domene hit", "flytte domene hit", "autorisasjonskode", "navnetjenere", "sonefil", "importere dns"] },
  "store:domain.move": { title: "Flytt et domene", keywords: ["flytte domene", "overføre domene", "autorisasjonskode", "navnetjenere", "sonefil", "eksporter dns"] },
  "store:company": {
    title: "Virksomhet",
    keywords: ["virksomhet", "firma", "opplysninger om virksomheten", "adresse", "organisasjonsnummer", "kontaktopplysninger"],
  },
  "store:company.place.new": { title: "Nytt sted", keywords: ["nytt sted", "butikk", "hentested", "legg til sted"] },
  "store:company.place": { title: "Sted", keywords: ["sted", "butikk", "hentested"] },
  "store:integrations": { title: "Integrasjoner", keywords: ["integrasjoner", "zapier", "make", "slack", "webhooks", "fraktselskaper"] },
  "store:integration": { title: "Integrasjon", keywords: ["integrasjon", "koble til", "hendelser", "test"] },
  "store:integrations.shipping": {
    title: "Fraktselskap",
    keywords: ["fraktselskap", "posten", "bring", "postnord", "porterbuddy", "helthjem", "etiketter", "sporing"],
  },
  "store:integrations.google-reviews": { title: "Google-omtaler", keywords: ["google-omtaler", "google", "omtaler", "anmeldelser", "vurdering"] },
  "store:ai": { title: "KI", keywords: ["ki", "kunstig intelligens", "modell", "leverandør", "openai"] },
  "store:features": {
    title: "Funksjoner",
    keywords: ["funksjoner", "moduler", "slå på", "slå av", "nettbutikk", "timebestilling", "abonnementskasser", "selge til bedrifter"],
  },
  "store:cookies": {
    title: "Informasjonskapsler og sporing",
    keywords: ["informasjonskapsler", "cookies", "sporing", "samtykke", "piksel", "samtykkebanner"],
  },
  "store:billing": { title: "Abonnement og faktura", keywords: ["plan", "fakturering", "abonnement", "faktura", "gebyr", "pris"] },
  "store:staff": {
    title: "Team",
    keywords: ["medarbeidere", "team", "brukere", "ansatte", "roller", "inviter", "totrinnsbekreftelse", "tilganger"],
  },
  "store:staff.roles": { title: "Roller", keywords: ["roller", "tilganger", "tilgang", "rettigheter", "skrivebeskyttet"] },
  "store:activity": { title: "Aktivitetslogg", keywords: ["aktivitetslogg", "revisjonslogg", "historikk", "hvem gjorde", "endringer", "logg"] },
  "store:legal": {
    title: "Juridiske sider",
    keywords: ["juridiske sider", "salgsbetingelser", "vilkår", "personvernerklæring", "personvern", "opplysninger om virksomheten", "angrerett"],
  },
  "store:accessibility": {
    title: "Universell utforming",
    keywords: ["tilgjengelighet", "universell utforming", "tilgjengelighetserklæring", "wcag", "kontrast", "skjermleser"],
  },

  // The owner's level
  "account:stores": {
    title: "Kontrollsenter",
    keywords: ["kontrollsenter", "oversikt", "dashbord", "hjem", "alle butikkene mine", "trenger oppmerksomhet"],
  },
  "account:stores.all": { title: "Butikker", keywords: ["butikker", "nettbutikker", "mine butikker", "ny butikk", "dupliser butikk"] },
  "account:stores.copy": { title: "Dupliser en butikk", keywords: ["dupliser", "kopier", "kopier butikk", "klon", "ny butikk fra"] },
  "account:stores.copy.progress": { title: "Kopiering av butikk", keywords: ["kopiering", "fremdrift", "dupliser", "kopi"] },
  "account:account.billing": {
    title: "Abonnement og faktura",
    keywords: ["plan", "abonnement", "faktura", "fakturering", "fornyes", "gebyr", "kostnad"],
  },
  "account:account.appearance": { title: "Utseende", keywords: ["utseende", "farger", "tema", "fargeskjema", "mørk", "lys"] },
  "account:account.domains": {
    title: "Domenene dine",
    keywords: ["domener", "domene", "dns", "forny", "fornyelse", "registrering", "mine domener", "flytt domene", "navnetjenere"],
  },
  "account:account.domains.buy": {
    title: "Kjøp et domene",
    keywords: ["kjøp domene", "registrer domene", "nytt domene"],
  },
  "account:account.domains.move": {
    title: "Flytt et domene",
    keywords: ["flytt domene", "overfør domene", "overføringskode", "autorisasjonskode", "navnetjenere"],
  },
  "account:account.usage": {
    title: "KI-bruk",
    keywords: ["ki-bruk", "tokens", "kostnad", "forbruk", "forespørsler", "modell", "leverandør"],
  },
  "account:account.limits": {
    title: "Bruk og grenser",
    keywords: ["bruk", "grenser", "kvote", "lagring", "båndbredde", "trafikk", "besøk", "kapasitet"],
  },
  "account:account.referrals": {
    title: "Verving",
    keywords: ["verving", "verv", "vervelenke", "vervekode", "provisjon", "kreditt", "inviter", "anbefal"],
  },
  "account:account.wordpress": {
    title: "WordPress",
    keywords: ["wordpress", "utvidelse", "programtillegg", "plugin", "kortkode", "bygg inn", "koble til", "woocommerce"],
  },
  "account:account.wordpress.connect": {
    title: "Koble til et WordPress-nettsted",
    keywords: ["koble til wordpress", "godkjenn", "autoriser", "wordpress"],
  },
  "account:account.themes.try": {
    title: "Prøv et tema i butikken din",
    keywords: ["prøv tema", "temabutikk", "installer tema", "legg til tema"],
  },
  "account:account.support": { title: "Kundestøtte", keywords: ["kundestøtte", "innboks", "livechat", "kundeservice", "samtaler"] },
  "account:account.kaizen_support": {
    title: "Kundestøtte fra Kaizena Flow",
    keywords: ["hjelp", "kontakt kaizena flow", "kundestøtte", "feil", "problem", "spør kaizena flow"],
  },
  "account:account": {
    title: "Din konto",
    keywords: ["konto", "min konto", "profil", "passord", "profilbilde", "mørk modus", "kaizen life"],
  },

  // The platform
  "platform:website": { title: "Nettsted", keywords: ["nettsted", "nettside", "sider", "innhold"] },
  "platform:settings": { title: "Innstillinger", keywords: ["innstillinger", "konfigurasjon", "oppsett"] },
  "platform:overview": { title: "Hjem", keywords: ["hjem", "oversikt", "dashbord", "trenger oppmerksomhet", "status"] },
  "platform:support": {
    title: "Innboks for kundestøtte",
    keywords: ["kundestøtte", "innboks", "livechat", "kundeservice", "samtaler", "henvendelser"],
  },
  "platform:support.reports": {
    title: "Rapporter for kundestøtte",
    keywords: ["kundestøtterapport", "svartid", "kundestøtte", "rapport"],
  },
  "platform:support.stores": {
    title: "Butikkenes kundestøtte",
    keywords: ["butikkenes kundestøtte", "kundestøtte per butikk", "totaler", "kundestøtte"],
  },
  "platform:support.replies": { title: "Lagrede svar", keywords: ["lagrede svar", "ferdige svar", "maler", "snarveier"] },
  "platform:support.settings": {
    title: "Innstillinger for kundestøtte",
    keywords: ["kundestøtte", "støttemodus", "livechat", "åpningstider", "oppfølging på e-post"],
  },
  "platform:requests": {
    title: "Forespørsler om tilgang",
    keywords: ["tilgangsforespørsler", "forespørsler", "registreringer", "venteliste", "godkjenn", "søknader"],
  },
  "platform:customers": { title: "Kunder", keywords: ["kunder", "butikkeiere", "eiere", "planer", "fakturaer"] },
  "platform:customer": { title: "Kunde", keywords: ["kunde", "butikkeier", "eier", "planer", "fakturaer"] },
  "platform:stores": { title: "Butikker", keywords: ["butikker", "nettbutikker", "planer", "abonnement", "gebyr"] },
  "platform:themes": {
    title: "Temaer",
    keywords: ["temaer", "tema", "utseende", "forhåndsinnstilling", "stil", "demobutikk", "innholdspakke"],
  },
  "platform:theme-store-page": { title: "Side i temabutikken", keywords: ["temabutikk", "temaside", "temaer", "side"] },
  "platform:theme-store-page.preview": {
    title: "Forhåndsvisning av side i temabutikken",
    keywords: ["forhåndsvisning", "temabutikk", "temaside"],
  },
  "platform:theme": { title: "Tema", keywords: ["tema", "utstilling", "oppføring", "publiser tema"] },
  "platform:theme.content": {
    title: "Temaets innhold",
    keywords: ["innhold", "demobutikk", "demoinnhold", "eksempelinnhold", "innholdspakke"],
  },
  "platform:theme.settings": {
    title: "Temainnstillinger",
    keywords: ["temainnstillinger", "farger", "skrifttyper", "knapper", "hjørner", "mørk modus"],
  },
  "platform:theme.presets": {
    title: "Temaets forhåndsinnstillinger",
    keywords: ["forhåndsinnstillinger", "variasjoner", "stil", "design for en bransje"],
  },
  "platform:theme.preset": { title: "Forhåndsinnstilling for tema", keywords: ["forhåndsinnstilling", "variasjon", "stil", "tema"] },
  "platform:theme.header": { title: "Temaets topptekst", keywords: ["topptekst", "header", "tema"] },
  "platform:theme.footer": { title: "Temaets bunntekst", keywords: ["bunntekst", "footer", "tema"] },
  "platform:theme.product-layout": { title: "Temaets produktside", keywords: ["produktside", "produktoppsett", "tema"] },
  "platform:theme.css": { title: "Temaets CSS", keywords: ["css", "egen css", "stilark", "tema"] },
  "platform:theme.demo-store": {
    title: "Demobutikk",
    keywords: ["demobutikk", "butikkmal", "innholdspakke", "demoinnhold", "se den live", "publiser utseendet"],
  },
  "platform:theme.demo-store.new": { title: "Ny demobutikk", keywords: ["ny demobutikk", "demobutikk", "live butikk", "utstilling"] },
  "platform:store": { title: "Butikk", keywords: ["butikk", "plan", "gebyr", "rabatt", "bruk tema"] },
  "platform:store.invoice": { title: "Faktura for plan", keywords: ["faktura", "planfaktura", "plan", "betaling"] },
  "platform:plans": { title: "Abonnementer", keywords: ["planer", "priser", "prisnivåer", "abonnement"] },
  "platform:plan-features": {
    title: "Funksjoner i planene",
    keywords: ["sammenlign planer", "funksjoner", "hva er inkludert", "prisnivåer"],
  },
  "platform:discounts": { title: "Rabatter", keywords: ["rabatter", "rabattkoder", "rabattkode", "kupong"] },
  "platform:discount": { title: "Rabatt", keywords: ["rabatt", "rabattkode", "kupong"] },
  "platform:plan-reminders": { title: "Påminnelser om plan", keywords: ["påminnelser", "forlatt kasse", "plan", "e-post"] },
  "platform:plan-reminder.new": { title: "Ny påminnelse om plan", keywords: ["ny påminnelse", "påminnelse", "plan"] },
  "platform:plan-reminder": { title: "Påminnelse om plan", keywords: ["påminnelse", "plan", "e-post"] },
  "platform:referrals": {
    title: "Verving",
    keywords: ["verving", "verv", "vervelenke", "provisjon", "inviter", "kreditt", "verver"],
  },
  "platform:stripe": { title: "Stripe", keywords: ["stripe", "betalingsleverandør", "webhooks", "gebyr", "kasse"] },
  "platform:pages": { title: "Sider", keywords: ["sider", "side", "nettsted", "innhold"] },
  "platform:page.new": { title: "Ny side", keywords: ["ny side", "opprett side", "sidebygger"] },
  "platform:page": { title: "Side", keywords: ["side", "sidebygger", "rediger side", "publiser"] },
  "platform:page.preview": { title: "Forhåndsvisning av side", keywords: ["forhåndsvisning", "side", "utkast"] },
  "platform:page.ai": { title: "Lag en side med KI", keywords: ["lag side med ki", "generer side", "ki-side", "ki"] },
  "platform:page.categories": { title: "Sidekategorier og stikkord", keywords: ["sidekategorier", "kategorier", "stikkord"] },
  "platform:articles": { title: "Blogg", keywords: ["blogg", "innlegg", "artikler", "nyheter"] },
  "platform:content": { title: "Innhold", keywords: ["innholdstyper", "oppføringer", "eget innhold"] },
  "platform:content.new": { title: "Ny innholdstype", keywords: ["ny innholdstype", "innholdstype", "felter"] },
  "platform:content.type": { title: "Oppføringer av en innholdstype", keywords: ["oppføringer", "innholdstype"] },
  "platform:content.type.settings": { title: "Innstillinger for innholdstype", keywords: ["innholdstype", "felter", "navn på nett"] },
  "platform:content.entry.new": { title: "Ny oppføring", keywords: ["ny oppføring", "oppføring"] },
  "platform:content.entry": { title: "Oppføring", keywords: ["oppføring", "publiser", "rediger"] },
  "platform:article.new": { title: "Ny artikkel", keywords: ["ny artikkel", "nytt innlegg", "blogg"] },
  "platform:article": { title: "Artikkel", keywords: ["artikkel", "innlegg", "blogg", "skriv"] },
  "platform:article.preview": { title: "Forhåndsvisning av artikkel", keywords: ["forhåndsvisning", "artikkel", "innlegg"] },
  "platform:article.categories": { title: "Bloggkategorier og stikkord", keywords: ["bloggkategorier", "kategorier", "stikkord", "blogg"] },
  "platform:headers": { title: "Topptekster", keywords: ["topptekster", "topptekst", "header"] },
  "platform:header.new": { title: "Ny topptekst", keywords: ["ny topptekst", "topptekst", "header"] },
  "platform:header": { title: "Topptekst", keywords: ["topptekst", "header", "sidebygger"] },
  "platform:header.preview": { title: "Forhåndsvisning av topptekst", keywords: ["forhåndsvisning", "topptekst", "header"] },
  "platform:footers": { title: "Bunntekster", keywords: ["bunntekster", "bunntekst", "footer"] },
  "platform:footer.new": { title: "Ny bunntekst", keywords: ["ny bunntekst", "bunntekst", "footer"] },
  "platform:footer": { title: "Bunntekst", keywords: ["bunntekst", "footer", "sidebygger"] },
  "platform:footer.preview": { title: "Forhåndsvisning av bunntekst", keywords: ["forhåndsvisning", "bunntekst", "footer"] },
  "platform:media": { title: "Medier", keywords: ["medier", "mediebibliotek", "bilder", "videoer"] },
  "platform:templates": { title: "Maler", keywords: ["maler", "mal", "markedsplass", "lagrede deler", "moderering"] },
  "platform:menus": { title: "Menyer", keywords: ["menyer", "meny", "navigasjon", "lenker"] },
  "platform:navigation": { title: "Topptekst og bunntekst", keywords: ["topptekst", "bunntekst", "logo", "ikon", "menyer"] },
  "platform:fonts": { title: "Skrifttyper", keywords: ["skrifttyper", "fonter", "skrift", "typografi"] },
  "platform:site_themes": { title: "Design", keywords: ["design", "tema", "utseende", "bytt tema", "nettstedets utseende"] },
  "platform:site_themes.theme": {
    title: "Tilpass tema",
    keywords: ["tilpass tema", "forhåndsvis tema", "prøv et tema", "hva endres", "nettstedets tema"],
  },
  "platform:seo": { title: "Søk", keywords: ["søk", "seo", "søkemotorer", "synlighet", "ki-søkeroboter"] },
  "platform:cookies": { title: "Informasjonskapsler", keywords: ["informasjonskapsler", "cookies", "sporing", "samtykke"] },
  "platform:emails": { title: "E-poster", keywords: ["e-poster", "e-post", "sendte e-poster", "e-postoppsett"] },
  "platform:email": { title: "E-post", keywords: ["e-post", "sendt e-post", "melding"] },
  "platform:ai": { title: "KI", keywords: ["ki", "kunstig intelligens", "modell", "leverandør"] },
  "platform:plan-limits": { title: "Grenser", keywords: ["grenser", "kvote", "lagring", "båndbredde", "trafikk", "standardgrenser"] },
  "platform:capacity": {
    title: "Bruk og grenser",
    keywords: ["bruk", "grenser", "kvote", "lagring", "båndbredde", "trafikk", "kapasitet", "last", "database"],
  },
  "platform:ai.usage": {
    title: "KI-bruk",
    keywords: ["ki-bruk", "tokens", "kostnad", "forbruk", "forespørsler", "modell", "leverandør"],
  },
  "platform:languages": { title: "Språk", keywords: ["språk", "oversett", "flerspråklig", "legg til språk", "verdens språk"] },
  "platform:language": { title: "Oversett et språk", keywords: ["oversett", "oversettelse", "grensesnittekst", "gjennomgang", "språk"] },
  "platform:domains": { title: "Domener", keywords: ["domene", "domener", "registrar", "dns", "kjøp domene", "domenepriser", "fornyelse"] },
  "platform:ai.prices": { title: "KI-priser", keywords: ["ki-priser", "pris", "kostnad", "dollar", "modell"] },
  "platform:chat": { title: "Chatassistent", keywords: ["chatassistent", "chatbot", "kunnskapsbase", "chat"] },
  "platform:google-reviews": { title: "Google-omtaler", keywords: ["google-omtaler", "google", "omtaler", "anmeldelser", "attester"] },
  "platform:experiments": { title: "A/B-tester", keywords: ["a/b-tester", "a/b-test", "eksperiment", "splittest", "test", "sikkerhetsgrense"] },
  "platform:retention": {
    title: "Lagringstid",
    keywords: ["oppbevaring", "oppbevaringsplikt", "hvor lenge", "regnskap", "lagringsbegrensning", "anonymisere", "personopplysninger", "gdpr"],
  },
  "platform:vat": {
    title: "Merverdiavgift",
    keywords: ["merverdiavgift", "mva", "satser", "redusert sats", "kategori", "mva på frakt", "oss", "ioss"],
  },
  "platform:duty-rates": { title: "Tollsatser", keywords: ["tollsatser", "toll", "tolltariff", "hs-kode", "grense", "importmva", "bekreft"] },
  "platform:vat.country": { title: "Merverdiavgift per land", keywords: ["merverdiavgift per land", "mva", "satser", "land", "historikk"] },
  "platform:search-test": { title: "Søketest", keywords: ["søketest", "eksperiment", "a/b-test", "søk"] },
  "platform:activity": {
    title: "Aktivitetslogg",
    keywords: ["aktivitetslogg", "revisjonslogg", "historikk", "hvem gjorde", "totrinnsbekreftelse", "sikkerhetshendelser"],
  },
  "platform:assistant": { title: "KI-assistent", keywords: ["ki-assistent", "assistent", "ki", "minne"] },
  "platform:assistant.autopilot": { title: "Autopilot", keywords: ["autopilot", "planer", "mål", "beslutninger"] },
};
