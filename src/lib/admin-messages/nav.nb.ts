/**
 * The admin's navigation in Norwegian (D312 A2): every section's name and introduction, every sidebar heading and every page's label and
 * card line in the store's, the owner's and the platform's navigation (`store-nav.ts`, `owner-nav.ts`, `platform-nav.ts`), by the English
 * words they are written in there, read by `navWord()`. Hand-written; legal, tax, payment and privacy words from the glossary.
 * `admin-nav-words.test.ts` fails for an English text of the navigation with no Norwegian here, so a new page brings its words too.
 */
export const NAV_NB: Record<string, string> = {
  // Store: Orders
  Orders: "Bestillinger",
  "Everything that is bought: orders, returns and withdrawals, subscriptions and the emails the store sent about them.":
    "Alt som kjøpes: bestillinger, returer og bruk av angreretten, abonnementer og e-postene butikken har sendt om dem.",
  "Every order: search and filter them, save views, tag, archive, send and print in bulk, open one to fulfil or refund it.":
    "Alle bestillinger: søk og filtrer, lagre visninger, merk, arkiver, send og skriv ut mange samtidig, og åpne én for å sende den eller betale tilbake.",
  "Draft orders": "Utkast til bestillinger",
  "Orders you make for a customer: products, custom items and prices, a discount and shipping, sent as a pay link or recorded as paid outside Kaizena Flow.":
    "Bestillinger du lager for en kunde: produkter, egne varer og priser, rabatt og frakt, sendt som en betalingslenke eller registrert som betalt utenfor Kaizena Flow.",
  Returns: "Returer",
  "Customers' withdrawals and return requests: approve, receive, inspect and refund them in time.":
    "Kunders bruk av angreretten og ønsker om retur: godkjenn, ta imot, kontroller og betal tilbake i tide.",
  Invoices: "Fakturaer",
  "Invoices and credit notes for orders, the orders waiting for one, and a CSV for the accountant.":
    "Fakturaer og kreditnotaer for bestillinger, bestillingene som venter på en, og en CSV-fil til regnskapsføreren.",
  Subscriptions: "Abonnementer",
  "Customers' recurring subscriptions and their payments.": "Kundenes faste abonnementer og betalingene for dem.",
  "Subscription boxes": "Abonnementskasser",
  "Weekly delivery days, cutoffs, and the lists customers have set up.": "Ukentlige leveringsdager, frister og listene kundene har satt opp.",
  Emails: "E-poster",
  "Every email the store sent to customers and staff, and whether it arrived.": "Alle e-poster butikken har sendt til kunder og ansatte, og om de kom fram.",

  // Store: Products
  Products: "Produkter",
  "What the store sells: the products, how their pages look and what more is said about them.":
    "Det butikken selger: produktene, hvordan sidene deres ser ut og hva mer som sies om dem.",
  "The catalogue: prices, stock, variants, pictures, categories and tags.": "Sortimentet: priser, lager, varianter, bilder, kategorier og stikkord.",
  Inventory: "Lager",
  "Stock for each variant and location: on hand, held by checkouts and owed on backorder, with counts, adjustments with a reason, history and files.":
    "Lager for hver variant og hvert sted: på lager, holdt av utsjekkinger og skyldt på restordre, med opptellinger, justeringer med begrunnelse, historikk og filer.",
  "Gift cards": "Gavekort",
  "Cards customers buy or you issue: what they hold, each card's history, issuing and changing one.":
    "Kort kundene kjøper eller du utsteder: hva de har igjen, hvert korts historikk, utstedelse og endring.",
  Reviews: "Omtaler",
  "What buyers say about your products: check new reviews, publish or hide them and answer.":
    "Hva kjøperne sier om produktene dine: se over nye omtaler, publiser eller skjul dem og svar.",
  "Product layouts": "Produktoppsett",
  "How a product's page is laid out, for all products, a category, a tag or one product.":
    "Hvordan en produktside er satt opp, for alle produkter, en kategori, et stikkord eller ett produkt.",
  "Custom fields": "Egendefinerte felt",
  "Your own groups of fields for products, pages, customers and more.": "Dine egne grupper av felt for produkter, sider, kunder og mer.",

  // Store: Customers
  Customers: "Kunder",
  "The people and companies who buy from the store.": "Personene og bedriftene som kjøper fra butikken.",
  "Everyone with an account, their orders and details.": "Alle med en konto, bestillingene deres og opplysningene om dem.",
  "Customer groups": "Kundegrupper",
  "Groups with a fixed discount, such as members or resellers.": "Grupper med fast rabatt, for eksempel medlemmer eller forhandlere.",
  "Price lists": "Prislister",
  "Prices of their own for customer groups and companies: a percentage off or fixed prices.": "Egne priser for kundegrupper og bedrifter: en prosent avslag eller faste priser.",
  Companies: "Bedrifter",
  "Company accounts with their employees and a group's discount.": "Bedriftskontoer med sine ansatte og en gruppes rabatt.",
  Wishlists: "Ønskelister",
  "What customers have saved, and what they added to the cart from it.": "Det kundene har lagret, og hva de la i handlekurven derfra.",
  "Privacy requests": "Personvernforespørsler",
  "People's requests for a copy of their data or for it to be erased, with the one-month clock.":
    "Forespørsler om innsyn i eller sletting av personopplysninger, med fristen på én måned.",

  // Store: Marketing
  Marketing: "Markedsføring",
  "Ways to get people to buy, and to come back.": "Måter å få folk til å kjøpe, og til å komme tilbake.",
  Campaigns: "Kampanjer",
  "Offers without a code, for a time: a percentage off, buy N pay for M, a free product.":
    "Tilbud uten kode, for en periode: prosent avslag, kjøp N betal for M, et gratis produkt.",
  Coupons: "Rabattkoder",
  "Discount codes customers type at checkout.": "Rabattkoder kundene skriver inn i kassen.",
  Recommendations: "Anbefalinger",
  "What the store suggests to each shopper, and how well it works.": "Det butikken foreslår for hver kunde, og hvor godt det virker.",
  "A/B tests": "A/B-tester",
  "Try two versions of a page on real visitors and keep the one that works better.": "Prøv to versjoner av en side på ekte besøkende og behold den som virker best.",
  "Email automations": "Automatiske e-poster",
  "Ads and conversions": "Annonser og konverteringer",
  "Product feeds": "Produktfeeder",
  "Your products for Google Shopping, Meta, TikTok and Pinterest, at a secret address.": "Produktene dine for Google Shopping, Meta, TikTok og Pinterest, på en hemmelig adresse.",
  "Checkouts and purchases sent to your ad platforms from the server, for shoppers who allowed marketing.": "Kasser og kjøp sendt til annonseplattformene dine fra serveren, for kunder som har tillatt markedsføring.",
  "Emails that go by themselves: a welcome, after a purchase, win-back, and back in stock.":
    "E-poster som går av seg selv: velkommen, etter et kjøp, for å vinne kunder tilbake og tilbake på lager.",
  Broadcasts: "Nyhetsbrev",
  "Emails with news and offers to everyone who wants them, or to a segment, with what happened after.":
    "E-poster med nyheter og tilbud til alle som vil ha dem, eller til et segment, med hva som skjedde etterpå.",
  Segments: "Segmenter",
  "Groups of customers and subscribers by what they did, counted as you open them.":
    "Grupper av kunder og abonnenter etter hva de har gjort, telt opp når du åpner dem.",
  Subscribers: "Abonnenter",
  "People who asked for your emails with news and offers, with what they agreed to and when.":
    "Personer som har bedt om e-poster med nyheter og tilbud, med hva de samtykket til og når.",
  "Cart reminders": "Påminnelser om handlekurv",
  "Emails to people who left items in their cart.": "E-poster til folk som har lagt igjen varer i handlekurven.",
  "Bonus credits": "Bonuspoeng",
  "Credits customers earn on what they pay and use as a price reduction.": "Kreditt kundene tjener på det de betaler, og bruker som prisavslag.",
  "Referral program": "Vervekampanje",
  "Customers who refer their friends, and what both get.": "Kunder som verver vennene sine, og hva begge får.",

  // Store: Analytics
  Analytics: "Analyse",
  "How the store is doing: sales and profit, why they change, which customers and products drive them, and what needs doing today.":
    "Hvordan det går med butikken: salg og fortjeneste, hvorfor de endrer seg, hvilke kunder og produkter som driver dem, og hva som må gjøres i dag.",
  Overview: "Oversikt",
  "The store's main figures against the last period and last year, its funnel, best sellers, channels and what needs you today.":
    "Butikkens hovedtall mot forrige periode og i fjor, salgstrakten, bestselgerne, kanalene og hva som trenger deg i dag.",
  Finance: "Økonomi",
  "From gross sales to profit: discounts, refunds, costs, fees, marketing and what is left.":
    "Fra bruttosalg til fortjeneste: rabatter, tilbakebetalinger, kostnader, gebyrer, markedsføring og det som er igjen.",
  Payouts: "Utbetalinger",
  "What Stripe paid to your bank, what each payout settles and whether it adds up.":
    "Hva Stripe har betalt til banken din, hva hver utbetaling gjelder og om det stemmer.",
  VAT: "Merverdiavgift",
  "VAT by country and rate, the quarterly OSS and monthly IOSS return data, and how they agree with your invoices and Finance.":
    "Merverdiavgift per land og sats, tallene til EUs OSS-ordning hvert kvartal og EUs IOSS-ordning hver måned, og hvordan de stemmer med fakturaene og Økonomi.",
  "New and returning customers, repeat purchases, lifetime value, segments and cohorts.":
    "Nye og tilbakevendende kunder, gjenkjøp, livstidsverdi, segmenter og kohorter.",
  "What sells, what earns, what is refunded, and how fast each product moves.": "Hva som selger, hva som tjener, hva som betales tilbake, og hvor fort hvert produkt går.",
  "Stock, its value, how many days it lasts, what is about to run out and what does not sell.":
    "Lageret, verdien av det, hvor mange dager det rekker, hva som snart går tomt og hva som ikke selger.",
  "Channels, ad spend, cost to win a customer, return on ad spend, discounts and coupons.":
    "Kanaler, annonsekostnader, hva det koster å vinne en kunde, avkastning på annonser, rabatter og rabattkoder.",
  "Monthly recurring revenue, how it moves, churn and failed renewals.": "Faste månedlige inntekter, hvordan de endrer seg, frafall og fornyelser som feilet.",
  Traffic: "Trafikk",
  "Visits, the way from visit to purchase, devices, countries, searches and the busiest hours.":
    "Besøk, veien fra besøk til kjøp, enheter, land, søk og de travleste timene.",
  Speed: "Hastighet",
  "How fast your pages load for your visitors, measured in their browsers, and what to fix.":
    "Hvor raskt sidene lastes for de besøkende, målt i nettleserne deres, og hva du kan rette.",
  "Analytics settings": "Innstillinger for analyse",
  "Costs, fees and targets that turn sales into profit, and whether visits are counted.":
    "Kostnader, gebyrer og mål som gjør salg om til fortjeneste, og om besøk telles.",

  // Store: Website
  Website: "Nettsted",
  "Everything that makes the store's site: its pages and blog, pictures, menus, header, footer, look and translations.":
    "Alt som utgjør butikkens nettsted: sidene og bloggen, bilder, menyer, topptekst, bunntekst, utseende og oversettelser.",
  Pages: "Sider",
  "The store's own pages, built in the page builder: draft, publish, and choose the front page and special pages.":
    "Butikkens egne sider, laget i sidebyggeren: utkast, publisering, og valg av forside og spesialsider.",
  Blog: "Blogg",
  "The store's blog: articles, their categories and tags.": "Butikkens blogg: artikler, kategoriene og stikkordene deres.",
  Content: "Innhold",
  "Your own kinds of content, such as team members or locations: entries listed on pages, each with a page if you like.": "Dine egne typer innhold, som ansatte eller steder: oppføringer som vises på sider, og en egen side for hver om du vil.",
  Media: "Medier",
  "Pictures and videos for the store, searchable, with alt texts.": "Bilder og videoer for butikken, søkbare, med alternative tekster.",
  Menus: "Menyer",
  "Lists of links for the header, footer and pages.": "Lister med lenker til toppteksten, bunnteksten og sider.",
  Redirects: "Omdirigeringer",
  "Redirects for addresses that changed and a report of the addresses shoppers could not find.":
    "Omdirigeringer for adresser som er endret, og en rapport over adressene kundene ikke fant.",
  Headers: "Topptekster",
  "Headers built from components; choose the one the store shows.": "Topptekster bygget av komponenter; velg den butikken viser.",
  Footers: "Bunntekster",
  "Footers built from components; choose the one the store shows.": "Bunntekster bygget av komponenter; velg den butikken viser.",
  Design: "Design",
  "The store's look: template, colours, fonts, buttons and corners.": "Butikkens utseende: mal, farger, skrifter, knapper og hjørner.",
  "Translate the store": "Oversett butikken",
  "Have AI suggest translations of the whole store, and read them before they are used.":
    "La KI foreslå oversettelser av hele butikken, og les dem før de tas i bruk.",

  // Store: Bookings
  Bookings: "Bookinger",
  "Appointments, stays and rentals: the calendar, who does them, and the rooms and items.":
    "Timeavtaler, opphold og utleie: kalenderen, hvem som utfører dem, og rommene og gjenstandene.",
  Calendar: "Kalender",
  "Every booking by week, with what can be done about it.": "Alle bookinger uke for uke, med hva som kan gjøres med dem.",
  "Staff and hours": "Ansatte og åpningstider",
  "The people who do appointments, their opening hours and capacity.": "Personene som tar timeavtaler, åpningstidene deres og kapasiteten.",
  "Stays and rentals": "Opphold og utleie",
  "Products booked by night or day, with seasons and fees.": "Produkter som bookes per natt eller dag, med sesonger og gebyrer.",
  "Rooms and items": "Rom og gjenstander",
  "The rooms and items stays and rentals are booked on, and their calendars.": "Rommene og gjenstandene opphold og utleie bookes på, og kalenderne deres.",
  Hosts: "Verter",
  "Outside hosts who list stays and rentals in the store, and the DAC7 report.": "Eksterne verter som legger ut opphold og utleie i butikken, og DAC7-rapporten.",

  // Store: Support
  Support: "Kundestøtte",
  "Conversations with the store's customers: the inbox, and the chat assistant that answers them first.":
    "Samtaler med butikkens kunder: innboksen, og chatassistenten som svarer dem først.",
  Inbox: "Innboks",
  "Every conversation with the store's customers as it happens: who is waiting, who is talking to the assistant, and what was said.":
    "Alle samtaler med butikkens kunder mens de pågår: hvem som venter, hvem som snakker med assistenten, og hva som ble sagt.",
  Requests: "Forespørsler",
  "What the chat assistant passed to your team (a refund, cancelling an order, a new address, an exception): decide each, and the customer is told.":
    "Det chatassistenten har sendt videre til teamet ditt (en tilbakebetaling, kansellering av en bestilling, en ny adresse, et unntak): avgjør hver, så får kunden beskjed.",
  Reports: "Rapporter",
  "How the store's conversations went: how many, how many the AI handled alone, how long customers waited, ratings, tone and topics.":
    "Hvordan butikkens samtaler gikk: hvor mange, hvor mange KI-en tok alene, hvor lenge kundene ventet, vurderinger, tone og emner.",
  "Saved replies": "Lagrede svar",
  "Texts your team puts in an answer with / in the inbox, filled in with the customer's and the person's names and the store's.":
    "Tekster teamet ditt setter inn i et svar med / i innboksen, fylt ut med kundens, personens og butikkens navn.",
  "Chat assistant": "Chatassistent",
  "The store's chat assistant for shoppers, and the knowledge it answers from.": "Butikkens chatassistent for kunder, og kunnskapen den svarer ut fra.",
  Settings: "Innstillinger",
  "Who answers the store's customers (the assistant alone, the AI first, or people only), opening hours, email follow-up and how long conversations are kept.":
    "Hvem som svarer butikkens kunder (bare assistenten, KI først eller bare mennesker), åpningstider, oppfølging på e-post og hvor lenge samtaler lagres.",

  // Store: Settings
  "How the store is set up: its company, markets, payments, delivery, tools and team.":
    "Hvordan butikken er satt opp: virksomheten, markedene, betalinger, levering, verktøy og team.",
  Store: "Butikk",
  Company: "Virksomhet",
  "The business details, places and contact information shoppers and invoices show.":
    "Opplysningene om virksomheten, stedene og kontaktinformasjonen som kundene og fakturaene viser.",
  Domains: "Domener",
  "The addresses the store is reached at.": "Adressene butikken nås på.",
  Countries: "Land",
  "The countries the store sells to, and its own country.": "Landene butikken selger til, og dens eget land.",
  "Languages and currencies": "Språk og valutaer",
  "The languages and currencies the store offers, and the exchange rates.": "Språkene og valutaene butikken tilbyr, og valutakursene.",
  Features: "Funksjoner",
  "Switch the online shop and the store's features on or off: subscriptions, bookings, countries, languages, selling to businesses and more.":
    "Slå nettbutikken og butikkens funksjoner av eller på: abonnementer, bookinger, land, språk, salg til bedrifter og mer.",
  "Close store": "Steng butikken",
  "Stop sales and take the shop off the web. Nothing is deleted, and you can reopen it for thirty days.":
    "Stopp salget og ta butikken av nettet. Ingenting slettes, og du kan åpne den igjen i tretti dager.",
  Selling: "Salg",
  Payments: "Betalinger",
  "Take payments through Stripe, and the methods shoppers can use.": "Ta imot betalinger gjennom Stripe, og betalingsmetodene kundene kan bruke.",
  Shipping: "Frakt",
  "Flat rates, shipping methods with zones and profiles, pickup at your places, local delivery and carriers.":
    "Faste priser, fraktmetoder med soner og profiler, henting på stedene dine, lokal levering og fraktselskaper.",
  "Gift messages at checkout, automatic archiving, how long a draft order's pay link lasts and who may record a payment taken outside Kaizena Flow.":
    "Gavehilsener i kassen, automatisk arkivering, hvor lenge betalingslenken til et utkast varer og hvem som kan registrere en betaling tatt utenfor Kaizena Flow.",
  Notifications: "Varsler",
  "The emails customers get about their orders and returns: which are sent, your own wording in each language, and who on the team is told of new orders.":
    "E-postene kundene får om bestillinger og returer: hvilke som sendes, din egen ordlyd på hvert språk, og hvem i teamet som får beskjed om nye bestillinger.",
  Automation: "Automatisering",
  "Rules that tag, hold or tell staff about paid orders that match conditions you choose, and the log of what they did.":
    "Regler som merker, holder igjen eller varsler ansatte om betalte bestillinger som oppfyller vilkår du velger, og loggen over hva de gjorde.",
  "How long customers have to return goods, who pays for sending them back, when refunds are made and the instructions they get.":
    "Hvor lenge kundene har på å returnere varer, hvem som betaler for å sende dem tilbake, når tilbakebetaling skjer og instruksjonene de får.",
  "Legal pages": "Juridiske sider",
  "Starter drafts of the terms, privacy statement, returns and shipping policies, withdrawal information and imprint, and what checkout says about the terms.":
    "Utkast til salgsbetingelser, personvernerklæring, retur- og fraktvilkår, opplysninger om angrerett og opplysninger om virksomheten, og hva kassen sier om vilkårene.",
  Tax: "Avgift",
  "VAT registration and number, OSS and IOSS, and how the store charges VAT.":
    "Registrering i Merverdiavgiftsregisteret og organisasjonsnummer, EUs OSS- og IOSS-ordning, og hvordan butikken beregner merverdiavgift.",
  Invoicing: "Fakturering",
  "Switch on invoices, the numbering, the note printed on every invoice and credit note.":
    "Slå på fakturaer, nummereringen og merknaden som skrives på hver faktura og kreditnota.",
  Integrations: "Integrasjoner",
  "Connect shipping carriers, Slack, accounting and other services.": "Koble til fraktselskaper, Slack, regnskap og andre tjenester.",
  Site: "Nettsted",
  "Header and footer": "Topptekst og bunntekst",
  "The store's logos, icon, business details and which menus its standard header and footer show.":
    "Butikkens logoer, ikon, opplysninger om virksomheten og hvilke menyer standard topptekst og bunntekst viser.",
  "SEO & Reach": "SEO og synlighet",
  "How search engines and AI crawlers see the store.": "Hvordan søkemotorer og KI-roboter ser butikken.",
  "Cookies and tracking": "Informasjonskapsler og sporing",
  "The cookies the store sets, its tracking tools and consents.": "Informasjonskapslene butikken setter, sporingsverktøyene og samtykkene.",
  Accessibility: "Universell utforming",
  "What has been checked against the accessibility requirements, and a draft accessibility statement for the site.":
    "Hva som er kontrollert mot kravene til universell utforming, og et utkast til tilgjengelighetserklæring for nettstedet.",
  Tools: "Verktøy",
  Search: "Søk",
  "How the store's search works: keywords, meaning and what shoppers searched for.": "Hvordan butikkens søk virker: søkeord, betydning og hva kundene har søkt etter.",
  AI: "KI",
  "The AI provider and models the store uses, or its own key.": "KI-leverandøren og modellene butikken bruker, eller dens egen nøkkel.",
  Account: "Konto",
  Billing: "Abonnement og faktura",
  "The store's plan, what it costs and its invoices.": "Butikkens abonnement, hva det koster og fakturaene.",
  Team: "Team",
  "Who can work in the store's admin, their roles, collaborators with an end date, and two-step sign-in.":
    "Hvem som kan arbeide i butikkens administrasjon, rollene deres, samarbeidspartnere med sluttdato og totrinnsinnlogging.",
  "Activity log": "Aktivitetslogg",
  "Who changed what and when: products, prices, pages, discounts, shipping, staff and payment settings.":
    "Hvem som endret hva og når: produkter, priser, sider, rabatter, frakt, ansatte og betalingsinnstillinger.",

  // Platform
  "Kaizena Flow's own pages, built in the page builder: draft, publish, and choose the front page, blog page and 404 page.":
    "Kaizena Flows egne sider, laget i sidebyggeren: utkast, publisering, og valg av forside, bloggside og 404-side.",
  "Kaizena Flow's blog: articles, their categories and tags.": "Kaizena Flows blogg: artikler, kategoriene og stikkordene deres.",
  "Kaizena Flow's own kinds of content: entries listed on its pages, each with a page if you like.": "Kaizena Flows egne innholdstyper: oppføringer som vises på sidene, hver med en egen side om du vil.",
  "Pictures and videos for Kaizena Flow's pages, searchable, with alt texts.": "Bilder og videoer til Kaizena Flows sider, søkbare, med alternative tekster.",
  Templates: "Maler",
  "The marketplace's templates, store owners' and Kaizena Flow's own: hide one from every store's list, or show it again.":
    "Markedsplassens maler, butikkeiernes og Kaizena Flows egne: skjul en fra alle butikkers liste, eller vis den igjen.",
  "Lists of links for Kaizena Flow's header, footer and pages.": "Lister med lenker til Kaizena Flows topptekst, bunntekst og sider.",
  Header: "Topptekst",
  "Headers built from components; choose the one Kaizena Flow's site shows.": "Topptekster bygget av komponenter; velg den Kaizena Flows nettsted viser.",
  Footer: "Bunntekst",
  "Footers built from components; choose the one Kaizena Flow's site shows.": "Bunntekster bygget av komponenter; velg den Kaizena Flows nettsted viser.",
  Fonts: "Skrifttyper",
  "The self-hosted fonts Kaizena Flow's pages use.": "Skrifttypene Kaizena Flows sider bruker, lagret hos oss selv.",
  "The themes installed on Kaizena Flow's own site: add a published theme, switch the site to it and back.":
    "Temaene som er installert på Kaizena Flows eget nettsted: legg til et publisert tema, bytt nettstedet til det og tilbake.",
  Editor: "Redigering",
  "Kaizena Flow's plans, their prices and fees, synced to Stripe.": "Kaizena Flows abonnementer, prisene og gebyrene deres, synkronisert med Stripe.",
  "Every feature with a tick for each plan that includes it: the comparison stores see.":
    "Hver funksjon med en hake for hvert abonnement som har den: sammenligningen butikkene ser.",
  Reminders: "Påminnelser",
  "Emails to owners who left a plan checkout.": "E-poster til eiere som forlot kjøpet av et abonnement.",
  Discounts: "Rabatter",
  "Discount codes for stores' plans.": "Rabattkoder for butikkenes abonnementer.",
  Referrals: "Verving",
  "Kaizena Flow's referral program: commission, referrers, referred stores.": "Kaizena Flows vervekampanje: provisjon, ververe og vervede butikker.",
  "Kaizena Flow's support desk: conversations with visitors of Kaizena Flow's site and owners asking Kaizena Flow, live.":
    "Kaizena Flows kundestøtte: samtaler med besøkende på Kaizena Flows nettsted og eiere som spør Kaizena Flow, mens de pågår.",
  "How Kaizena Flow's own desk did: conversations, the AI alone, waiting times, ratings and topics.":
    "Hvordan det gikk med Kaizena Flows egen kundestøtte: samtaler, det KI-en tok alene, ventetider, vurderinger og emner.",
  Stores: "Butikker",
  "Each store's support in figures: counts and rates only, never a conversation.": "Hver butikks kundestøtte i tall: bare antall og andeler, aldri en samtale.",
  "Texts Kaizena Flow's people put in an answer with / in the inbox, filled in with names.":
    "Tekster Kaizena Flows folk setter inn i et svar med / i innboksen, fylt ut med navn.",
  "Kaizena Flow's public site chat assistant and its knowledge base.": "Chatassistenten på Kaizena Flows offentlige nettsted og kunnskapsbasen dens.",
  "Who answers Kaizena Flow's visitors (the assistant alone, the AI first, or people only), opening hours, email follow-up and how long conversations are kept.":
    "Hvem som svarer Kaizena Flows besøkende (bare assistenten, KI først eller bare mennesker), åpningstider, oppfølging på e-post og hvor lenge samtaler lagres.",
  "Kaizena Flow's logos, icon, business details and which menus its standard header and footer show.":
    "Kaizena Flows logoer, ikon, opplysninger om virksomheten og hvilke menyer standard topptekst og bunntekst viser.",
  "Every store's A/B tests: what is running, what needs a look and what waits for a decision.":
    "Alle butikkers A/B-tester: hva som pågår, hva som bør ses på og hva som venter på en avgjørelse.",
  "The search experiment: keyword against hybrid search.": "Søkeeksperimentet: søkeord mot hybridsøk.",
  SEO: "SEO",
  "How search engines and AI crawlers see Kaizena Flow's site.": "Hvordan søkemotorer og KI-roboter ser Kaizena Flows nettsted.",
  Cookies: "Informasjonskapsler",
  "Kaizena Flow's cookies, tracking tools and consents.": "Kaizena Flows informasjonskapsler, sporingsverktøy og samtykker.",
  "VAT categories and rates per country with history, the rates nobody has verified yet, and how shipping is taxed.":
    "Kategorier og satser for merverdiavgift per land med historikk, satsene ingen har bekreftet ennå, og hvordan frakt avgiftsberegnes.",
  "Data retention": "Lagringstid",
  "How long each kind of personal data is kept, where each period comes from, and what the daily job removed.":
    "Hvor lenge hver type personopplysninger lagres, hvor hver periode kommer fra, og hva den daglige jobben har fjernet.",
  "Google reviews": "Google-omtaler",
  "Kaizena Flow's own Google reviews for testimonials.": "Kaizena Flows egne Google-omtaler til anbefalinger.",
  Stripe: "Stripe",
  "Kaizena Flow's Stripe webhooks per mode, the default fee per sale and the checkout's look.":
    "Kaizena Flows Stripe-webhooks per modus, standardgebyret per salg og utseendet på kassen.",
  "Kaizena Flow's default AI provider and models.": "Kaizena Flows standard KI-leverandør og modeller.",
  "AI usage": "KI-bruk",
  "Usage and limits": "Bruk og grenser",
  "Your domains": "Domenene dine",
  "Every domain you hold, which store uses it, renewal, DNS and moving it.": "Alle domenene du har, hvilken butikk som bruker dem, fornyelse, DNS og flytting.",
  "Domains stores buy through Kaizena Flow: prices per currency, which stores may buy, registrations and purchases that need a look.":
    "Domener butikker kjøper gjennom Kaizena Flow: priser per valuta, hvilke butikker som kan kjøpe, registreringer og kjøp som må ses på.",
  Limits: "Grenser",
  "What each plan includes of storage, products, staff, domains, emails, AI and traffic, and the default for stores without a plan.":
    "Hva hvert abonnement inkluderer av lagring, produkter, ansatte, domener, e-post, KI og trafikk, og standarden for butikker uten abonnement.",
  "What each store you own has used this month, against what its plan includes.": "Hva hver butikk du eier har brukt denne måneden, mot det abonnementet inkluderer.",
  "What every store used this month against its limits: storage, products, staff, visits, emails and AI.":
    "Hva hver butikk har brukt denne måneden mot grensene sine: lagring, produkter, ansatte, besøk, e-poster og KI.",
  "What every store, owner and Kaizena Flow itself used of the AI.": "Hva hver butikk, hver eier og Kaizena Flow selv har brukt av KI-en.",
  "AI prices": "KI-priser",
  "What each model costs per million tokens, per picture, per audio minute and per million characters, so the usage pages can show cost.":
    "Hva hver modell koster per million tokens, per bilde, per lydminutt og per million tegn, så sidene om bruk kan vise kostnaden.",
  "Every email Kaizena Flow and the stores sent, and email setup.": "Alle e-poster Kaizena Flow og butikkene har sendt, og oppsettet for e-post.",
  Languages: "Språk",
  "The languages stores can offer, and where each one's interface text stands.": "Språkene butikkene kan tilby, og hvor langt grensesnittekstene på hvert har kommet.",
  "What platform admins and the platform did: two-step sign-in events, approvals and settings, with who did it and when.":
    "Hva plattformadministratorene og plattformen har gjort: hendelser med totrinnsinnlogging, godkjenninger og innstillinger, med hvem som gjorde det og når.",
  "Everything that makes Kaizena Flow's own site: build its pages and blog, keep its pictures, menus, header, footer and fonts.":
    "Alt som utgjør Kaizena Flows eget nettsted: lag sidene og bloggen, og ta vare på bildene, menyene, toppteksten, bunnteksten og skrifttypene.",
  "How Kaizena Flow's site is found, what it sets, how it takes payment, its AI, emails and languages.":
    "Hvordan Kaizena Flows nettsted blir funnet, hva det lagrer, hvordan det tar betalt, KI-en, e-postene og språkene.",
  Home: "Hjem",
  Themes: "Temaer",
  Plans: "Abonnementer",

  // The owner's level
  "Your account": "Din konto",
  "Your name, picture, password, light or dark, and Kaizen Life.": "Navnet ditt, bildet, passordet, lyst eller mørkt, og Kaizen Life.",
  Appearance: "Utseende",
  "Light or dark and the admin's colour scheme, with every scheme shown side by side.":
    "Lyst eller mørkt og fargeskjemaet til administrasjonen, med alle skjemaene vist side om side.",
  "Kaizena Flow support": "Kundestøtte fra Kaizena Flow",
  "Ask Kaizena Flow for help with your stores or your account, and read the answers.":
    "Be Kaizena Flow om hjelp med butikkene dine eller kontoen din, og les svarene.",
  "The plan of each store you own, what it costs and when it renews.": "Abonnementet til hver butikk du eier, hva det koster og når det fornyes.",
  "What the AI used for the stores you own, with what it cost.": "Hva KI-en har brukt for butikkene du eier, med hva det kostet.",
  "Your referral link, the stores that opened through it and your credit.": "Vervelenken din, butikkene som åpnet gjennom den og kreditten din.",
  WordPress: "WordPress",
  "The WordPress plugin, and the sites connected to show your products.": "WordPress-utvidelsen, og nettstedene som er koblet til for å vise produktene dine.",
  Work: "Arbeid",
};
