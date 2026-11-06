/**
 * Kaizena Flow's plans in Norwegian (D142, D312): each plan's line and each feature's category, name and description in the plan comparison,
 * by the English words they are written in (`commerce.plans`, `commerce.plan_features`), read by `plansIn()`. Hand-written, in the admin's
 * words for the same things; plan names are names and stay as they are. A text changed in the platform's admin shows in English until its
 * Norwegian is written here, never a stale translation; `src/db/plan-words.test.ts` fails for a feature in the migrations with no Norwegian
 * here, so a new feature brings its words too.
 */
export const PLAN_WORDS_NB: Record<string, string> = {
  // Categories (a word the same in both languages is listed too, so every text is known).
  "Storefront and catalogue": "Butikk og katalog",
  "Checkout and selling": "Kasse og salg",
  "Design and content": "Design og innhold",
  International: "Internasjonalt",
  AI: "KI",
  Operations: "Drift",
  Kaizen: "Kaizena Flow",
  "Kaizena Flow": "Kaizena Flow",
  Data: "Data",
  // Plans' lines.
  "For startups and entrepreneurs": "For oppstartsbedrifter og gründere",
  "For small teams": "For små team",
  "For global reach": "For global rekkevidde",
  "For complex businesses": "For komplekse virksomheter",
  // Storefront and catalogue.
  "Products with variants and prices per market": "Produkter med varianter og priser per marked",
  "Sizes, colours and any options, priced in each country you sell to.": "Størrelser, farger og alle slags valg, priset i hvert land du selger til.",
  "Digital products and downloads": "Digitale produkter og nedlastinger",
  "Files sold as downloads, with download limits.": "Filer som selges som nedlastinger, med grenser for antall nedlastinger.",
  "Subscription products": "Abonnementsprodukter",
  "Recurring orders with a chosen interval, trial and discount.": "Gjentakende bestillinger med valgt intervall, prøveperiode og rabatt.",
  "Appointments and bookings": "Timebestillinger og bookinger",
  "Sell time with staff, a calendar, deposits and reminders.": "Selg tid med ansatte, med kalender, depositum og påminnelser.",
  "Stays and rentals": "Opphold og utleie",
  "Nights, days or hours, with seasons and calendar sync.": "Netter, dager eller timer, med sesonger og synkronisering av kalendere.",
  "Custom fields": "Egendefinerte felt",
  "Your own groups of fields on products, pages, categories and more.": "Dine egne grupper av felt på produkter, sider, kategorier og mer.",
  "Categories, tags and product layouts": "Kategorier, stikkord og produktoppsett",
  "Organise the catalogue and design each product page.": "Organiser katalogen og utform hver produktside.",
  "Search by meaning and filters": "Søk etter mening og filtre",
  "Keyword and AI search, with sorting and filters on every list.": "Søk på nøkkelord og med KI, med sortering og filtre på alle lister.",
  "Customer reviews from Google": "Kundeomtaler fra Google",
  "Show Google reviews on the store.": "Vis Google-omtaler i butikken.",
  "Accessibility checks": "Tilgjengelighetssjekker",
  "A list of accessibility issues in a page before it is published (pictures without text, heading order, empty links, low contrast) and a draft accessibility statement.":
    "En liste over tilgjengelighetsproblemer på en side før den publiseres (bilder uten tekst, rekkefølgen på overskrifter, tomme lenker, lav kontrast), og et utkast til tilgjengelighetserklæring.",
  // Checkout and selling.
  "Checkout with cards and local payment methods": "Kasse med kort og lokale betalingsmåter",
  "Stripe Checkout on your own Stripe account.": "Stripe Checkout på din egen Stripe-konto.",
  // Storefront and catalogue.
  "Redirects and 404 report": "Omdirigeringer og 404-rapport",
  "Redirects are made when a product, category or tag changes address, and added by hand or imported from a CSV file; a report of the addresses shoppers and search engines could not find, with a one-click redirect; up to 100,000 manual redirects.":
    "Omdirigeringer lages når et produkt, en kategori eller et stikkord bytter adresse, og legges til for hånd eller hentes inn fra en CSV-fil; en rapport over adressene kunder og søkemotorer ikke fant, med omdirigering med ett klikk; opptil 100 000 manuelle omdirigeringer.",
  "SEO title and description for categories and tags": "SEO-tittel og -beskrivelse for kategorier og stikkord",
  "Search-result title and description for every category and tag in every language of the store.":
    "Tittel og beskrivelse i søkeresultatene for hver kategori og hvert stikkord, på hvert av butikkens språk.",
  // Checkout and selling.
  "Discount codes": "Rabattkoder",
  "Percentage and fixed-amount codes with limits.": "Koder med prosent eller fast beløp, med begrensninger.",
  Campaigns: "Kampanjer",
  "Offers without a code: percentage off, buy N pay for M, free gifts.": "Tilbud uten kode: prosentrabatt, kjøp N betal for M, gratis gaver.",
  "Customer groups and company accounts": "Kundegrupper og bedriftskontoer",
  "Group discounts, business buyers and company employees.": "Grupperabatter, bedriftskunder og ansatte i bedrifter.",
  "Selling to businesses": "Salg til bedrifter",
  "Prices without VAT for companies and company details at checkout.": "Priser uten mva. for bedrifter, og bedriftsopplysninger i kassen.",
  "Abandoned cart reminders": "Påminnelser om forlatte handlekurver",
  "Emails that bring shoppers back, with an optional code.": "E-poster som får kundene tilbake, med en kode hvis du vil.",
  "Subscription boxes": "Abonnementskasser",
  "Weekly deliveries from a standing list, charged when sent.": "Ukentlige leveranser fra en fast liste, belastet når de sendes.",
  "Bonus credits": "Bonuskreditt",
  "Customers earn credits on orders and use them later.": "Kundene tjener kreditt på bestillinger og bruker den senere.",
  "Customer referrals": "Verving av kunder",
  "Customers refer friends: a welcome discount and credits for the referrer.":
    "Kundene verver venner: en velkomstrabatt og kreditt til den som verver.",
  // Design and content.
  "Page builder": "Sidebygger",
  "Rows, columns and blocks for every page, with draft and publish.": "Rader, kolonner og blokker på hver side, med utkast og publisering.",
  "Headers, footers and menus": "Toppfelt, bunnfelt og menyer",
  "Build the top and bottom of the site and its menus.": "Bygg toppen og bunnen av nettstedet og menyene.",
  "A/B tests of pages": "A/B-tester av sider",
  "Show two versions of a page to real visitors and keep the one that sells more.":
    "Vis to versjoner av en side til ekte besøkende, og behold den som selger mest.",
  "Design themes and fonts": "Designtemaer og skrifter",
  "Colours, buttons, cards and self-hosted Google Fonts.": "Farger, knapper, kort og Google Fonts levert fra våre egne servere.",
  "Motion effects": "Bevegelseseffekter",
  "Entrances, hover, scroll and background effects.": "Effekter når noe kommer til syne, ved peking, ved rulling og i bakgrunnen.",
  // Checkout and selling.
  "EU VAT: reduced rates, VAT number check, reverse charge and IOSS marking":
    "EU-mva.: reduserte satser, sjekk av mva-nummer, omvendt avgiftsplikt og IOSS-merking",
  "Reduced-rate categories per country, the shopper's EU VAT number checked against VIES for reverse charge, and the store's OSS and IOSS registration.":
    "Kategorier med redusert sats per land, kundens EU-mva-nummer sjekket mot VIES for omvendt avgiftsplikt, og butikkens OSS- og IOSS-registrering.",
  "Invoices and credit notes for orders": "Fakturaer og kreditnotaer for bestillinger",
  "A legal invoice for every paid order in the store's own numbered series, a credit note for every refund and return, VAT per rate with reverse charge and IOSS stated, a PDF for the shopper and for the accountant, and a CSV export.":
    "En faktura etter regelverket for hver betalte bestilling i butikkens egen nummerserie, en kreditnota for hver refusjon og retur, mva. per sats med omvendt avgiftsplikt og IOSS oppgitt, en PDF til kunden og til regnskapsføreren, og en CSV-eksport.",
  "Unit price (price per kg, litre, metre)": "Enhetspris (pris per kg, liter, meter)",
  "The price per kilogram, litre, metre, square metre or piece beside each price on product pages, listings, cart, checkout, orders and emails, kept on the order, with a check that products which need a content are not sold without one.":
    "Prisen per kilo, liter, meter, kvadratmeter eller stykk ved siden av hver pris på produktsider, i lister, handlekurv, kasse, bestillinger og e-poster, lagret på bestillingen, med en sjekk av at produkter som trenger en innholdsmengde, ikke selges uten.",
  "VAT, OSS and IOSS reports": "Rapporter for mva., OSS og IOSS",
  "VAT per country and rate from the store's own invoices and credit notes, the quarterly OSS and monthly IOSS return data in euro at the ECB's rate, a reconciliation against the order totals, and CSV exports for the owner's accountant. Reports only: nothing is filed.":
    "Mva. per land og sats fra butikkens egne fakturaer og kreditnotaer, tallene til den kvartalsvise OSS-meldingen og den månedlige IOSS-meldingen i euro etter ECBs kurs, en avstemming mot ordretotalene, og CSV-eksporter til regnskapsføreren. Bare rapporter: ingenting sendes inn.",
  // Design and content.
  "Pop-ups": "Popup-vinduer",
  "Modals opened by a click, a timer or exit intent.": "Vinduer som åpnes av et klikk, etter en viss tid eller når den besøkende er på vei ut.",
  Blog: "Blogg",
  "Articles with categories and tags.": "Artikler med kategorier og stikkord.",
  Templates: "Maler",
  "Save rows and whole pages and share them with your other stores.": "Lagre rader og hele sider, og del dem med de andre butikkene dine.",
  "Custom CSS and code": "Egen CSS og kode",
  "Your own CSS and scripts on the site.": "Din egen CSS og dine egne skript på nettstedet.",
  "Forms and newsletter sign-up": "Skjemaer og påmelding til nyhetsbrev",
  "Contact forms and sign-ups with email confirmation.": "Kontaktskjemaer og påmeldinger med bekreftelse på e-post.",
  "Media library": "Mediebibliotek",
  "Every picture and video in one place, searchable.": "Alle bilder og videoer på ett sted, søkbare.",
  "Own domain": "Eget domene",
  "Your store at your own web address.": "Butikken din på din egen nettadresse.",
  "Legal page starters": "Utkast til juridiske sider",
  "Draft terms, privacy, shipping, returns, withdrawal information and imprint pages written from the store's own facts, and the terms shown at checkout with a record of what the shopper accepted.":
    "Utkast til vilkår, personvern, frakt, retur, informasjon om angrerett og opplysninger om virksomheten, skrevet ut fra butikkens egne opplysninger, og vilkårene vist i kassen med en oversikt over hva kunden godtok.",
  // International.
  "Several countries and VAT": "Flere land og mva.",
  "Sell to many EU countries with the right VAT.": "Selg til mange EU-land med riktig mva.",
  "Languages and currencies": "Språk og valutaer",
  "Show the store in several languages and currencies.": "Vis butikken på flere språk og i flere valutaer.",
  "AI translation of the whole store": "KI-oversettelse av hele butikken",
  "Translations suggested by AI and checked by you.": "Oversettelser foreslått av KI og sjekket av deg.",
  // AI.
  "AI manager": "KI-butikksjef",
  "An assistant in the admin that answers from your data and acts with your yes.":
    "En assistent i adminpanelet som svarer ut fra dataene dine og handler når du sier ja.",
  "Chat assistant for shoppers": "Chatassistent for kunder",
  "A chat agent that answers from your store and its documents.": "En chatagent som svarer ut fra butikken din og dokumentene dens.",
  "AI product texts": "KI-produkttekster",
  "Suggested product descriptions in your words.": "Forslag til produktbeskrivelser med dine ord.",
  "AI page studio": "KI-sidestudio",
  "Describe a page and get a first draft.": "Beskriv en side og få et første utkast.",
  "Make my page cool": "Gjør siden min kul",
  "One click adds motion design to a page.": "Ett klikk gir en side bevegelse og liv.",
  "Picture descriptions by AI": "Bildebeskrivelser med KI",
  "Alt texts written for your pictures.": "Alternativ tekst skrevet til bildene dine.",
  "Your own AI provider": "Din egen KI-leverandør",
  "Use your own AI account and models.": "Bruk din egen KI-konto og dine egne modeller.",
  "Product recommendations": "Produktanbefalinger",
  "Upsells, cross-sells and complements picked for each shopper on product pages, articles and lists, with the AI re-ranking the best.":
    "Mersalg, krysssalg og tilbehør valgt for hver kunde på produktsider, i artikler og i lister, der KI rangerer de beste på nytt.",
  // Operations.
  "Orders, returns and refunds": "Bestillinger, returer og refusjoner",
  "Fulfil, refund and follow every order.": "Send, refunder og følg hver bestilling.",
  "Order search, filters, saved views and bulk actions": "Ordresøk, filtre, lagrede visninger og massehandlinger",
  "Search orders by number, customer, product, tag or tracking number; filter by payment, fulfilment, date and market; 30 saved views per store; tag, archive or mark as sent up to 250 orders at once; print packing slips.":
    "Søk i bestillinger etter nummer, kunde, produkt, stikkord eller sporingsnummer; filtrer etter betaling, forsendelse, dato og marked; 30 lagrede visninger per butikk; legg til stikkord, arkiver eller merk som sendt opptil 250 bestillinger på én gang; skriv ut pakksedler.",
  "Order tags and archive": "Stikkord på bestillinger og arkiv",
  "Staff-only tags on orders (up to 250 of 40 characters each) and archiving that hides finished orders from the list and queues without deleting anything; optional automatic archiving after a number of days.":
    "Stikkord på bestillinger som bare de ansatte ser (opptil 250, på 40 tegn hver), og arkivering som skjuler ferdige bestillinger fra listen og køene uten å slette noe; automatisk arkivering etter et antall dager hvis du vil.",
  "Draft orders and payment links": "Utkast til bestillinger og betalingslenker",
  "Write an order for a customer and email a pay link valid 1 to 30 days that opens on your store's own page; custom items and prices, a staff discount, or record a payment taken outside Kaizena Flow. Goods are held from the send.":
    "Skriv en bestilling for en kunde og send en betalingslenke på e-post, gyldig i 1 til 30 dager, som åpnes på butikkens egen side; egne varer og priser, en ansatterabatt, eller registrer en betaling tatt imot utenfor Kaizena Flow. Varene holdes av fra utsendelsen.",
  "Gift messages": "Gavemeldinger",
  "Shoppers can mark an order as a gift and write a name, a sender and a message of up to 300 characters. It is shown on a price-free packing slip and never sent to anyone but the buyer. Off until you switch it on.":
    "Kundene kan merke en bestilling som gave og skrive et navn, en avsender og en melding på opptil 300 tegn. Den vises på en pakkseddel uten priser og sendes aldri til andre enn kjøperen. Av til du slår den på.",
  "Order editing after purchase": "Endring av bestillinger etter kjøp",
  "Staff add, remove or reduce items on a paid order before anything is sent; kept items keep their price and discounts. A lower total is refunded at once; a higher one applies when the customer pays it through a pay link valid 7 days. With invoicing on, a credit note and an additional invoice.":
    "Ansatte legger til, fjerner eller reduserer varer på en betalt bestilling før noe er sendt; varer som blir, beholder pris og rabatter. En lavere sum refunderes med en gang; en høyere gjelder når kunden betaler den via en betalingslenke som er gyldig i 7 dager. Med fakturering slått på: en kreditnota og en tilleggsfaktura.",
  "Partial fulfilment": "Delvis sending",
  "Send an order in several parcels: choose the items and quantities of each, with its own carrier, tracking number and email to the customer. The order shows Partly sent until everything not withdrawn is sent, and the customer's order page lists each parcel.":
    "Send en bestilling i flere pakker: velg varene og antallet i hver, med egen transportør, eget sporingsnummer og egen e-post til kunden. Bestillingen står som Delvis sendt til alt som ikke er angret, er sendt, og kundens ordreside viser hver pakke.",
  "Pick lists": "Plukklister",
  "A printable list of what to take off the shelves for up to 100 orders, by product and SKU or order by order, counting only what is still to send. Packing slips for one parcel or for what is left. No prices, names or addresses.":
    "En liste du kan skrive ut over hva som skal tas fra hyllene for opptil 100 bestillinger, etter produkt og varenummer eller bestilling for bestilling, der bare det som gjenstår å sende, telles. Pakksedler for én pakke eller for det som er igjen. Ingen priser, navn eller adresser.",
  Exchanges: "Bytte",
  "Offer replacement goods on a return: the difference is worked out as at checkout, the customer confirms the exchange on a page you email them, and it becomes a new order paid by the return's credit, with any rest refunded or paid by a link.":
    "Tilby erstatningsvarer ved en retur: differansen regnes ut som i kassen, kunden bekrefter byttet på en side du sender på e-post, og det blir en ny bestilling betalt med returens kreditt, der resten refunderes eller betales via en lenke.",
  "Return labels from your carrier": "Returetiketter fra transportøren din",
  "Book a return label with your carrier (Posten / Bring in Norway, PostNord, Instabox, UPS or DHL Paket), by hand or automatically for withdrawals. The customer prints it from the email or the return's page; if they pay return shipping, its cost is taken off the refund, never more than it cost.":
    "Bestill en returetikett hos transportøren din (Posten / Bring i Norge, PostNord, Instabox, UPS eller DHL Paket), for hånd eller automatisk når noen angrer et kjøp. Kunden skriver den ut fra e-posten eller returens side; betaler kunden returfrakten, trekkes kostnaden fra refusjonen, aldri mer enn den kostet.",
  "Stock in several locations": "Beholdning på flere steder",
  "Stock levels per location.": "Lagerbeholdning per lokasjon.",
  "Inventory page, stock history, backorders and low-stock warnings": "Lagerside, lagerhistorikk, restordre og varsler om lav beholdning",
  "On hand, committed and available per variant and location, with ranked locations; every change kept 24 months with its reason; selling on backorder with a stated delivery time; counted stock by CSV file; a warning level per variant.":
    "Fysisk beholdning, reservert og tilgjengelig per variant og lokasjon, med rangerte lokasjoner; hver endring tatt vare på i 24 måneder med årsak; salg på restordre med oppgitt leveringstid; opptalt beholdning via CSV-fil; et varslingsnivå per variant.",
  "Shipping methods, zones and profiles": "Fraktmåter, soner og profiler",
  "Named shipping methods per country, priced flat, by weight or by basket value in tiers, per zone of postal codes and per profile of products; a mixed basket pays the sum. Free above a basket value. The flat rate stays as the fallback.":
    "Navngitte fraktmåter per land, med fast pris, etter vekt eller i trinn etter handlekurvens verdi, per sone av postnumre og per profil av produkter; en blandet handlekurv betaler summen. Gratis over en viss handlekurvverdi. Fastprisen blir stående som reserve.",
  "Local pickup": "Lokal henting",
  "Customers collect at the store's own shops and pickup places, free or at a price, with a usual ready time and instructions. Ready for pickup emails the customer once; Collected completes the order.":
    "Kundene henter i butikkens egne butikker og hentesteder, gratis eller mot betaling, med vanlig tid til varene er klare og instruksjoner. Klar til henting sender kunden én e-post; Hentet fullfører bestillingen.",
  "Local delivery": "Lokal levering",
  "Delivery by the store's own drivers to areas of postal codes or within a radius of a place (up to 160 km, measured between postal-code centres), with a price, a minimum basket and free delivery above a value.":
    "Levering med butikkens egne sjåfører til områder av postnumre eller innenfor en radius fra et sted (opptil 160 km, målt mellom postnummerområdenes midtpunkter), med en pris, en minste handlekurv og gratis levering over en viss verdi.",
  "Customer accounts and wish lists": "Kundekontoer og ønskelister",
  "Shoppers sign in, see their orders and save products.": "Kundene logger inn, ser bestillingene sine og lagrer produkter.",
  "Emails to customers": "E-post til kunder",
  "Order emails in your shoppers' languages.": "Ordre-e-poster på kundenes språk.",
  "Editable customer emails": "Redigerbare e-poster til kunder",
  "Your own subject, heading and text for each order and return email in each of your languages, with placeholders, a preview and a test email. Lines, totals, VAT and the right of withdrawal are always added. Required emails, such as the order confirmation, are always sent.":
    "Ditt eget emne, din egen overskrift og tekst for hver ordre- og retur-e-post på hvert av språkene dine, med plassholdere, forhåndsvisning og en test-e-post. Linjer, summer, mva. og angreretten legges alltid til. Påkrevde e-poster, som ordrebekreftelsen, sendes alltid.",
  "Delivery tracking on the order page": "Sporing på ordresiden",
  "The carrier's events for each parcel on the customer's order page, followed every few minutes for parcels of carriers you connect.":
    "Transportørens hendelser for hver pakke på kundens ordreside, fulgt med noen få minutters mellomrom for pakker fra transportører du kobler til.",
  "Delivery emails from carrier events": "Leverings-e-poster fra transportørens hendelser",
  "Out for delivery and Delivered emails from Posten / Bring's events, once per parcel, when you switch them on. A delivery Bring reports records when the customer received the goods.":
    "E-postene Ute for levering og Levert, fra Posten / Brings hendelser, én gang per pakke, når du slår dem på. En levering Bring melder, registrerer når kunden mottok varene.",
  "Staff order alerts and summaries": "Ordrevarsler og oppsummeringer til ansatte",
  "An email to the staff you choose for each new order and return, overdue refunds and low stock, and a daily or weekly summary. No customer's name, address or phone in them.":
    "En e-post til de ansatte du velger for hver ny bestilling og retur, forsinkede refusjoner og lav beholdning, og en daglig eller ukentlig oppsummering. Ingen kunders navn, adresse eller telefonnummer i dem.",
  "Order automation rules": "Automatiske regler for bestillinger",
  "Rules for paid orders: when the total, country, buyer, products, delivery, source or tags match, tag the order, notify staff or hold it from being sent. Every run is logged.":
    "Regler for betalte bestillinger: når sum, land, kjøper, produkter, levering, kilde eller stikkord stemmer, legg til et stikkord, varsle ansatte eller hold bestillingen tilbake fra sending. Hver kjøring logges.",
  "Staff accounts": "Ansattkontoer",
  "Invite staff to help run the store.": "Inviter ansatte til å hjelpe deg med å drive butikken.",
  "Hosts and commissions": "Verter og provisjoner",
  "List stays and rentals for other hosts and pay them.": "Legg ut opphold og utleie for andre verter, og betal dem.",
  "Work: time, tasks and invoicing": "Arbeid: tid, oppgaver og fakturering",
  "Clients, time tracking and invoices for your own services.": "Klienter, timeføring og fakturaer for dine egne tjenester.",
  "Integrations and Slack": "Integrasjoner og Slack",
  "Webhooks and Slack messages for store events.": "Webhooks og Slack-meldinger ved hendelser i butikken.",
  "Duplicate a store": "Dupliser en butikk",
  "Copy a store with the pages, products and settings you choose.": "Kopier en butikk med sidene, produktene og innstillingene du velger.",
  "Analytics and cookie consent": "Analyse og samtykke til informasjonskapsler",
  "Your analytics tools, loaded only after consent.": "Analyseverktøyene dine, lastet først etter samtykke.",
  "Staff roles and permissions": "Roller og tilganger for ansatte",
  "Roles for the people who work in the store (orders, products, marketing, content, analytics, read-only) with the sections each may open and change, and agency collaborators whose access ends on a date.":
    "Roller for dem som jobber i butikken (bestillinger, produkter, markedsføring, innhold, analyse, bare lesing) med delene hver kan åpne og endre, og samarbeidspartnere fra byråer med tilgang som utløper på en dato.",
  "Two-step sign-in for staff": "Totrinnsinnlogging for ansatte",
  "An authenticator app as a second step when signing in to the admin, with recovery codes; required for platform admins and optional for a store.":
    "En autentiseringsapp som andre steg når du logger inn i adminpanelet, med gjenopprettingskoder; påkrevd for plattformadministratorer og valgfritt for en butikk.",
  "Activity log": "Aktivitetslogg",
  "Who changed what and when in the admin, filtered by person, area and period, with a CSV export for owners.":
    "Hvem som endret hva og når i adminpanelet, filtrert etter person, område og periode, med CSV-eksport for eiere.",
  "GDPR data export and erasure and a data retention schedule": "GDPR: eksport og sletting av data, og en plan for oppbevaring",
  "A customer's data as one downloadable file for staff and for the shopper, erasure that keeps what bookkeeping law requires and then anonymises it, a log of privacy requests with the one-month clock, and a retention schedule with its sources.":
    "En kundes data som én fil å laste ned for ansatte og for kunden, sletting som beholder det bokføringsloven krever og deretter anonymiserer det, en logg over personvernforespørsler med fristen på én måned, og en oppbevaringsplan med kildene.",
  // Kaizen.
  "Refer other store owners": "Verv andre butikkeiere",
  "Earn credit on your plan from stores you refer.": "Tjen kreditt på abonnementet ditt fra butikker du verver.",
  // Data.
  "Product CSV import and export": "Import og eksport av produkter som CSV",
  "Export every product and variant as a CSV file and import Kaizena Flow's own file or a Shopify product file: a check that lists every row's problem before anything is written, then a resumable import. Never deletes a product or changes a web address. Up to 5,000 products and 15 MB a file.":
    "Eksporter alle produkter og varianter som en CSV-fil, og importer Kaizena Flows egen fil eller en produktfil fra Shopify: en sjekk som viser problemet i hver rad før noe skrives, og deretter en import som kan gjenopptas. Sletter aldri et produkt og endrer aldri en nettadresse. Opptil 5 000 produkter og 15 MB per fil.",
  "Order and customer CSV export": "Eksport av bestillinger og kunder som CSV",
  "The owner downloads orders (one row for each line, VAT split out, in the order's currency and the store's) and customers as CSV files for bookkeeping. Large files are made in the background and downloaded from the admin, never emailed, and deleted after 7 days.":
    "Eieren laster ned bestillinger (én rad per linje, mva. skilt ut, i bestillingens og butikkens valuta) og kunder som CSV-filer til bokføringen. Store filer lages i bakgrunnen og lastes ned fra adminpanelet, sendes aldri på e-post og slettes etter 7 dager.",
  "Bulk product editing": "Masseredigering av produkter",
  "Tick products in the list to set status, archive, change categories and tags, change prices by a percentage or an amount, or set stock, or edit price, SKU, stock and cost in a grid. Every change is shown first, written in one confirmed step and can be undone for 7 days.":
    "Huk av produkter i listen for å sette status, arkivere, endre kategorier og stikkord, endre priser med en prosent eller et beløp eller sette beholdning, eller rediger pris, varenummer, beholdning og kostpris i et rutenett. Hver endring vises først, skrives i ett bekreftet steg og kan angres i 7 dager.",
  "CSV for every analytics table": "CSV for hver analysetabell",
  "Download any table or chart on the analytics pages as a CSV file for the period and comparison on the page, in the store's main currency without VAT.":
    "Last ned hvilken som helst tabell eller graf på analysesidene som en CSV-fil for perioden og sammenligningen på siden, i butikkens hovedvaluta uten mva.",
};
