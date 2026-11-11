/** The register's reasons (`PERSONAL_DATA` in `personal-data.ts`) in Norwegian bokmål, by table, for the admin in Norwegian (D312). Written by hand from the English; `personal-data.nb.test.ts` holds that every table has one. */

/** The register's shared sentences (`LAW`, `OWN`, `PSEUDO`, `KEEP_ORDER` in `personal-data.ts`). `LAW` always follows a colon, so it starts in lower case. */
const LAW = "beholdes fordi bokføringsreglene krever det til oppbevaringstiden er ute, og deretter erstattes feltene med personopplysninger med en markør; brukes ikke til noe annet.";
const OWN = "Ikke en kundes opplysninger: dette er butikkens egne, en verts, en ansatts eller plattformens, som er en annen registrert (docs/wave-1g-gdpr.md avsnitt 7).";
const PSEUDO = "Lagres under en tilfeldig ID for nettleseren eller fanen og kan ikke knyttes til en person; har sin egen oppbevaringstid.";
const KEEP_ORDER = "Ingen egne felt med personopplysninger; knyttes til en person bare gjennom bestillingen, og følger bestillingens begrensning og anonymisering.";
const WORK = "Eierens eget regnskap (D122). ";

export const PERSONAL_DATA_REASONS_NB: Readonly<Record<string, string>> = {
  // Personen
  customers: "Kontoen slettes; passordet og opplysningene om pålogging slettes med den.",
  "storage:avatars": "Bildet fjernes fra lagringen etter at kontoen er slettet.",

  // Bestillinger og det som henger på dem
  orders:
    "Et salg beholdes på grunn av bokføringsplikten (begrenset overfor personen, deretter anonymisert); en ubetalt eller kopiert bestilling anonymiseres med en gang. Beskjeden til sjåføren ved lokal levering (D237) er kjøperens egne ord: den eksporteres, og tømmes når bestillingen anonymiseres. Grunnen til at en bestilling holdes tilbake (D238), når en person har skrevet den, er de ansattes egen tekst (den kan inneholde et navn): den eksporteres med bestillingen og erstattes med en markør når bestillingen anonymiseres; grunnen fra en regel er eierens ord om regelen.",
  order_lines: KEEP_ORDER,
  payments: "En betalings beløp og status; ingen felt med personopplysninger (kortet ligger hos Stripe, ikke hos butikken). " + KEEP_ORDER,
  payout_lines:
    "Hva en utbetaling fra Stripe gjorde opp (D290): beløp, Stripes type og ID-er, knyttet til betalingen, tilbakebetalingen eller tvisten og bestillingen den gjelder; ingen felt med personopplysninger. " +
    KEEP_ORDER,
  payment_disputes: "En tvist om en betaling slik Stripe meldte den (D288): beløp, Stripes årsakskode, status og datoer; ingen felt med personopplysninger. " + KEEP_ORDER,
  dispute_evidence:
    "Bevisene i en tvist (D417), laget ut fra bestillingen og endret av ansatte: kjøperens navn, e-post og adresser, pakkene og kjøperens egne meldinger til butikken, beholdt så butikken kan svare banken og vise hva den sendte. Knyttet til bestillingen gjennom tvisten; eksporteres med bestillingen, og tømmes av en trigger når bestillingen anonymiseres (raden blir stående som dokumentasjon på at bevis ble sendt, og når).",
  refunds:
    "Beløp og status beholdes; grunnen er tekst ansatte skrev (den kan inneholde et navn), så den eksporteres og erstattes med en markør når bestillingen anonymiseres. " + KEEP_ORDER,
  shipments:
    "En pakkes fraktselskap og sporingsnummer, knyttet til en person bare gjennom bestillingen. Beholdes med den. Grunnen ansatte oppga for å angre en forsendelse (D174, oppfølging), er deres egen tekst (den kan inneholde et navn): den eksporteres med pakken og erstattes med en markør når bestillingen anonymiseres.",
  carrier_labels:
    "En fraktetikett et fraktselskap gir bare én gang (DHL Express, D458): en PDF med mottakerens navn og adresse, beholdt så ansatte kan skrive den ut. Slettes 30 dager etter at pakken ble booket (oppbevaringstypen carrier_labels) og når personens opplysninger slettes; eksporteres ikke (pakken og adressen dens eksporteres, med bestillingen).",
  marketplace_orders:
    "En ordre en kjøper la på en markedsplass som eBay (D555): kjøperens navn, adressen markedsplassen ga å sende til og, der den er oppgitt, en e-postadresse. Et salg i butikken, beholdt under bokføringsplikten; markedsplassen har kjøperens konto og svarer på kjøperens egne forespørsler.",
  supplier_orders:
    "Det en leverandør med direktelevering ble bedt om å sende for en ordre (D551): status, tidspunkter og hashen av lenken til siden dens; ordene leverandøren ga når den ikke kunne sende (dens egen tekst, som kan nevne kunden), eksporteres med ordren og beholdes med den. Leveringsadressen er ordrens, lest når leverandøren får e-post og på siden dens mens noe gjenstår å sende, aldri kopiert hit. Ingen egne personopplysninger utover dette; knyttet til en person bare gjennom ordren, og følger ordrens begrensning og anonymisering.",
  supplier_order_lines:
    "Hvilke ordrelinjer og enheter en leverandør ble bedt om å sende (D551); ingen personopplysninger. Knyttet til en person bare gjennom ordren, og følger ordrens begrensning og anonymisering.",
  shipment_tracking:
    "Fraktselskapets hendelser for en pakke (D238): tidspunkter, koder og fraktselskapets egne beskrivelser og steder, som kan navngi hvem som kvitterte for den. Eksporteres med pakken, og tømmes når bestillingen anonymiseres (commerce.anonymise_order(), en oppdatering) og 90 dager etter at pakken sluttet å bli fulgt.",
  order_rule_runs:
    "En automatiseringsregels kjøring for en bestilling (D238): regelens navn, ID-er og hvilke betingelser og handlinger som holdt, aldri en persons opplysninger; slettes 12 måneder etter kjøringen. " +
    KEEP_ORDER,
  bookings: "Et tidsrom for en avtalt time, et opphold eller en utleie. " + KEEP_ORDER,
  shipment_lines: "Hvilke enheter av en bestilling som gikk i hvilken pakke (D174); ID-er og antall, ingen felt med personopplysninger. " + KEEP_ORDER,
  order_edits:
    "En endring ansatte gjorde i en bestilling etter kjøpet (D174): beløp, ID-er og datoer, ingen felt med personopplysninger (de ansattes notat ligger bare i historikkhendelsens data.note, som anonymiseringen fjerner; betalingslenken beholdes bare som en hash). " +
    KEEP_ORDER,
  order_edit_lines: "Varene en endring la til eller tok bort (D174): titler, varenumre, antall og beløp, ingen felt med personopplysninger. " + KEEP_ORDER,
  unsent_closures:
    "Enheter av en bestillingslinje som ansatte tok bort fra det som gjensto å sende (D174): ID-er, antall og ansattkontoen som gjorde det, ingen felt med kundens personopplysninger. " +
    KEEP_ORDER,
  order_payment_terms:
    "En bestilling kjøpt på betalingsbetingelser (D293): bedriftens ID, betingelsene, forfallsdatoen og når purringer ble sendt og den ble betalt; ingen felt med personopplysninger. " +
    KEEP_ORDER,
  order_terms: "Registreringen av hvilke vilkår som ble godtatt, og når; ingen felt med personopplysninger. " + KEEP_ORDER,
  legal_snapshots: "Butikkens egen sidetekst slik den var da den ble godtatt, aldri en persons opplysninger.",
  order_events:
    "Hendelsene inneholder typer, ID-er og datoer, bortsett fra fritekst ansatte skrev (data.reason ved en kansellering eller tilbakebetaling, data.note i et notat) og de to postnumrene i en order.delivery_mismatch-hendelse (data.priced, det leveringen ble prissatt for, og data.address, adressens; D237). Friteksten eksporteres som hendelsens; de to postnumrene er kopier av bestillingens delivery.postalCode og leveringsadresse, og eksporteres med bestillingen. Alle fire fjernes når bestillingen anonymiseres, noe regelen om at hendelser bare kan legges til, tillater for disse nøklene alene (postnumrene bare i den hendelsen).",
  order_downloads: "Ingen felt med personopplysninger; sletting avslutter lenken (utløpstiden dens), fordi den åpner et kjøp uten pålogging.",
  order_tags:
    "Et stikkord er tekst ansatte skrev på en bestilling (det kan inneholde et navn): det eksporteres i bestillingens del og beholdes med bestillingen, og slettes deretter av den daglige oppryddingen når bestillingen er anonymisert (SQL-funksjonen som anonymiserer, sletter ingenting). " +
    KEEP_ORDER,
  draft_orders:
    "Et utkast er en handlekurv ansatte laget for en kjøper, ennå ikke en bestilling: det inneholder kontaktopplysningene ansatte skrev inn, eller, for en forespørsel om tilbud (D431), navnet, e-posten, telefonnummeret, bedriften og notatet kunden skrev, og de ansattes svar da de avslo den. Utkastene til en kundekonto slettes med den (aldri funnet via en adresse ansatte skrev, bare via kontoen); andre utkast slettes av den daglige oppryddingen 90 dager etter siste endring (åpne), og 30 dager etter at de ble avsluttet eller en forespørsel ble avslått. Bestillingen et utkast ble til, er en bestilling.",
  draft_order_lines: "Linjene i et bestillingsutkast; ingen egne felt med personopplysninger, slettes med utkastet.",
  inventory_reservations: "Lager holdt av til en handlekurv eller bestilling; ingen felt med personopplysninger.",
  host_commissions: OWN,
  document_deliveries: "En kobling mellom et dokument og e-posten som sendte det; ingen felt med personopplysninger.",

  // Dokumenter
  invoices: "En faktura er et regnskapsdokument: " + LAW + " Bare commerce.anonymise_expired_documents() endrer den.",
  credit_notes: "En kreditnota er et regnskapsdokument: " + LAW + " Bare commerce.anonymise_expired_documents() endrer den.",
  "storage:documents": "PDF-en av en faktura eller kreditnota inneholder de samme opplysningene som dokumentet og fjernes når dokumentet anonymiseres.",
  "storage:exports":
    "En fil med alle butikkens kunder eller bestillinger som en eier laget (D165), er ikke én persons del av eksporten, så den er ikke med i den: den inneholder personopplysninger om mange personer, slettes etter 7 dager, og når en persons opplysninger slettes, slettes butikkens ferdige filer; eieren eksporterer på nytt hvis de trenger en fil uten personen.",

  // Angrerett og returer
  withdrawal_requests: "En bekreftet bruk av angreretten er rettslig dokumentasjon av avtalen: " + LAW,
  withdrawal_request_lines: "Antallene i en bestillings linjer. " + KEEP_ORDER,
  returns:
    "En retur er historikk som aldri slettes: " +
    LAW +
    " Kundens ønske om bytte (D239) er kundens egne ord: det eksporteres med returen og tømmes når bestillingen anonymiseres. Kolonnene for den bookede etiketten inneholder fraktselskapets numre og en adresse hos fraktselskapet som ikke navngir noen person.",
  return_exchanges:
    "Et bytte ved en retur (D239): ID-er, beløp, datoer og leveringsadressen til den nye bestillingen. En del av bestillingenes bokføring, beholdt med bestillingen; adressen erstattes med markøren når bestillingen anonymiseres (commerce.anonymise_order()), og betalingslenken beholdes bare som en hash. De ansattes notat om en registrert avtale ligger bare i historikkhendelsens data.note, som anonymiseringen fjerner. " +
    KEEP_ORDER,
  return_exchange_lines: "Erstatningsvarene i et bytte (D239): titler, varenumre, antall og priser, ingen felt med personopplysninger. " + KEEP_ORDER,
  return_lines: "Antall, varenes tilstand og et notat fra ansatte om varene, ikke om personen. " + KEEP_ORDER,
  withdrawal_attempts: "Hashede nøkler fra gjetninger mot angrefunksjonen, beholdt én dag for å begrense misbruk; de kan ikke knyttes til en person.",

  // Abonnementer og faste lister
  subscriptions:
    "Abonnementet avsluttes med en gang (uten tilbakebetaling), og e-posten og adressen erstattes med en markør; fornyelsesbestillingene begrenses som bestillinger.",
  subscription_lines: "Produktlinjene i et abonnement; ingen felt med personopplysninger.",
  standing_orders: "Den faste listen slettes, og det lagrede kortet kobles fra hos Stripe.",
  standing_order_lines: "Linjene i den faste listen slettes med den.",
  standing_deliveries: "Oppføringen om hver levering slettes med den faste listen; bestillingen den laget, er en bestilling.",
  checkout_accounts: "Passordet som ble valgt i kassen; slettes (eksporteres aldri: en hemmelighet).",

  // Pålogging
  customer_sessions: "Påloggede nettlesere: slettes (eksporteres aldri: en sikkerhetsoppføring).",
  customer_codes: "Påloggingskoder denne adressen ba om; slettes.",
  lead_decisions: "Hva ansatte bestemte om en person som ba om noe før de ble kunde (D475): avvist, eller gjort til en avtale; slettes.",
  customer_sign_in_links: "Påloggingslenker; slettes.",

  // Ønskelister og handlekurver
  wishlists: "Listene slettes.",
  wishlist_items: "Oppføringene slettes med listen.",
  wishlist_cart_adds: "Hva som ble lagt i en handlekurv fra en liste; personen og listens navn fjernes.",
  carts:
    "Raden for handlekurven blir stående (en bestilling kan peke på den); personen og bedriftsopplysningene fjernes, og det samme gjelder postnummeret en levering ble prissatt for, beskjeden til sjåføren (D237) og svarene på butikkens felt i kassen (D357).",
  cart_lines: "Produktlinjene i en handlekurv; ingen felt med personopplysninger.",
  cart_gift_cards: "Gavekortene en handlekurv skal betales med (D300 F3), bare med kortets ID (aldri koden); ingen felt med personopplysninger.",
  delivery_quotes: "Postnummeret en levering ble prissatt for, fjernes.",
  abandoned_checkouts: "E-posten og linjene tømmes; oppføringen om reservasjon blir stående.",

  // Lojalitet
  gift_cards:
    "Et gavekort (D300) er penger som står på kortet: sletting fjerner hvem som kjøpte det og hvem det var til, og ordene som fulgte med, og beholder kortet og saldoen, som den som har koden, fortsatt kan bruke.",
  gift_card_entries: "Et gavekorts posteringer (D300): beløp og bestillingene de betalte, ingen felt med personopplysninger. " + KEEP_ORDER,
  discount_code_items:
    "Koden til en bonusbelønning en kunde løste inn (D401): eksporteres med bonusopplysningene; når kontoen slettes, brytes koblingen (fremmednøkkelen setter den til null), og koden og bruken av den forblir butikkens.",
  bonus_entries: "Posteringene slettes med kontoen: bonuskreditten går tapt (personen får vite det før de bekrefter).",
  bonus_allocations: "Hvilken kreditt som betalte for hva; slettes med posteringene.",
  affiliates: "Vervekoden og oppføringen for den slettes med kontoen.",
  affiliate_attributions: "Radene blir stående for den andre personens belønning; begge kunde-ID-ene settes til null (fremmednøklene gjør det).",
  referral_visits: PSEUDO,
  creators:
    "En skapers søknad og oppføring (D386): eksporteres med vervingene; ved sletting tømmes navnet, kanalen og koblingen til kunden, og skaperen stoppes, og raden blir stående uten å navngi noen, fordi butikkens regnskap beholder provisjonene og utbetalingene den har krav på.",
  creator_attributions:
    "Hvilken bestilling en skapers kode ble brukt på (D386): bestillingen og skaperen med ID, ingen felt med personopplysninger. " + KEEP_ORDER,
  creator_commissions: "En skapers provisjonsposteringer (D386): beløp og bestillingene de kom fra, ingen felt med personopplysninger. " + KEEP_ORDER,

  // Bedrift
  customer_companies: "Bedriftsopplysningene tilhører bedriften og blir værende med de andre medlemmene; forhåndsvisningen varsler når personen er hovedkontoen.",
  company_location_buyers: "Hvor personen kjøper for bedriften sin, og i hvilken rolle (D321 C.2): slettes med medlemskapet.",
  company_invites: "Invitasjoner til adressen eller kontoen slettes.",

  // E-post og samtykke
  email_messages:
    "Adressen, emnet og innholdet tømmes, og raden beholdes (idempotensnøkkelen hindrer at en webhook som spilles av på nytt, sender igjen); bekreftelsen på bruk av angreretten venter på bestillingen sin.",
  marketing_subscribers:
    "Abonnentlisten (D295): en adresse som ba om butikkens markedsførings-e-post, med ordlyden den godtok, når og hvordan. Finnes via kontoen eller kontoens bekreftede e-post, eksporteres med historikken og slettes med den når personens opplysninger slettes (personen ba om mer enn bare å slippe e-post). En påmelding der lenken har gått ut, slettes 30 dager senere.",
  customer_addresses: "En kundes lagrede adresser (D304): eksporteres, og slettes med kontoen.",
  signup_incentives:
    "Velkomstkoder som påmeldingsskjemaer ga en person (D304 J3), knyttet til adressen: eksporteres med markedsføringsopplysningene og slettes når personens opplysninger slettes.",
  customer_notes:
    "De ansattes notater om en person (D366), knyttet til adressen: eksporteres med markedsføringsopplysningene (ordene og når) og slettes når personens opplysninger slettes.",
  deals:
    "Ansattes salgsmuligheter med en person (D464): hva de kan kjøpe, steg og verdi, og hvorfor den ble tapt; eksporteres med personens notater og slettes når personen slettes (en bedrifts salgsmulighet beholder bedriften og mister personen).",
  activities:
    "De ansattes samtaler, møter og oppgaver om en person (D468): hva og når, og det som ble skrevet om dem; eksporteres med personens notater og slettes når personen slettes (en aktivitet om en bedrift eller en avtale beholder den og mister personen).",
  customer_tags: "De ansattes stikkord på en person (D296), knyttet til adressen: eksporteres med markedsføringsopplysningene og slettes når personens opplysninger slettes.",
  broadcast_recipients:
    "Adressene en utsendelse gikk til (D297), låst da sendingen startet: listes i eksporten av markedsføringsopplysninger, og slettes når personens opplysninger slettes og 90 dager etter at sendingen var ferdig (tallene beholdes).",
  automation_sends:
    "Hvilke automatiske e-poster (D298) som gikk til en abonnent, og når: listes i eksporten av markedsføringsopplysninger, og slettes med abonnenten når personens opplysninger slettes, og etter 90 dager.",
  product_reviews:
    "En produktomtale personen skrev (D301): stjernene, ordene og navnet de valgte, funnet via kontoen; eksporteres, og slettes når personens opplysninger slettes (ordene er deres, og produktets gjennomsnitt regnes om).",
  review_pictures:
    "Bildene i en omtale (D301 G4): hvilke det er, størrelsen og om ansatte skjuler et av dem; listes med omtalen i eksporten (hvert med adressen som viser det til forfatteren) og slettes med omtalen.",
  "storage:review-pictures":
    "Filene til bildene i en omtale (D301 G4) i den private lagringsbøtten: fjernes etter at omtalen er slettet (av forfatteren eller ved sletting av personens opplysninger), og ryddes daglig når en rad er borte.",
  review_requests:
    "At en e-post med forespørsel om omtale (D301 G3) ble sendt for en bestilling, og når, med hashen av lenken (selve e-posten ligger under e-poster i eksporten): slettes når kjøperens opplysninger slettes, og 400 dager etter at den ble laget.",
  stock_requests:
    "En forespørsel om å få beskjed én gang når en utsolgt variant er tilbake (D298): adressen, produktet og statusen, eksporteres med markedsføringsopplysningene og slettes når personens opplysninger slettes; ubekreftede slettes når lenken går ut, ventende etter 180 dager, sendte etter 30.",
  marketing_consent_events:
    "En abonnents samtykkehistorikk (D295): hver forespørsel, påmelding og avmelding med kilde og ordlyd; eksporteres med abonnenten og slettes med den.",
  email_opt_outs:
    "En oppføring om reservasjon mot e-post: beholdes så butikken ikke sender personen e-post igjen (personens eget ønske); å slette den ville oppheve reservasjonen.",
  blog_comments:
    "En kommentar personen skrev til en artikkel (D341): navnet de valgte, e-posten de oppga (vises aldri) og ordene deres, funnet via de bekreftede adressene deres; eksporteres, og slettes når personens opplysninger slettes. Avviste kommentarer og søppelkommentarer slettes 30 dager etter at de ble sendt inn.",
  form_submissions: "Påmeldinger og meldinger sendt fra denne adressen slettes.",
  consents: "Samtykke til informasjonskapsler lagres under en tilfeldig nettleser-ID og kan ikke knyttes til en person; dette står i filens notIncluded.",
  visits: PSEUDO,
  product_views: "Antall visninger per produkt og dag; ingen person.",
  experiment_exposures: PSEUDO,
  experiment_events: PSEUDO,
  experiment_carts: PSEUDO,
  search_queries:
    "Det som ble skrevet i søkefeltet, beholdt i 90 dager; mens butikken teller besøk, beholder den dagens besøk (en hashet ID som endres daglig, D347), som en handlekurv og bestillingen dens kan nås gjennom, så når personens opplysninger slettes, slettes søkene fra besøkene til personens handlekurver.",
  search_clicks: PSEUDO,
  recommendation_events: PSEUDO,
  recommendation_adds: PSEUDO,
  chat_usage: "Antall samtalerunder og kontroller per hashet nøkkel; ingen person.",

  // Kundeservice (D216, docs/support.md 3.5)
  support_conversations:
    "En kundeservicesamtale anonymiseres: meldingene og handlingene slettes, og feltene med personopplysninger tømmes; datoene og tallene blir stående for kundeservicens rapporter, og slettes etter 24 måneder. En samtale på e-post (D332) hører til avsenderadressen og anonymiseres med den når personens opplysninger slettes; den eksporteres aldri, siden avsenderen av en e-post ikke beviser hvem noen er.",
  filed_emails: "E-post teamet kopierte eller videresendte til butikkens arkivadresse om personen (D476): ordene og adressene; slettes.",
  support_inbound_emails:
    "E-poster mottatt til en kundeservice (D332): avsenderen og emnet, beholdt i 30 dager for å telle dem og samle dem i tråder, og slettes når personens opplysninger slettes; ordene er samtalens meldinger.",
  support_messages:
    "Meldingene i en kundeservicesamtale slettes med utskriften, etter kundeservicens periode (når kundeservice er av: én dag etter at samtalen er slutt) eller når personens opplysninger slettes; de ansattes notater og partnerens hjelp eksporteres aldri.",
  support_actions:
    "Det KI-en foreslo eller ba ansatte avgjøre for en kunde, slettes med samtalens utskrift; utfallet står i samtalens meldinger, som eksporten tar med.",
  docs_guide_conversations:
    "En samtale med dokumentasjonens KI-veileder, lagret under en hash av et tilfeldig token som bare leserens fane har, så den kan ikke knyttes til en person eller finnes for noen; oppbevares som samtalene i plattformens chat: tokenet og siden tømmes og meldingene slettes etter perioden til Kaizena Flows kundeservice (én dag mens kundeservice er av), og datoene og tallene slettes etter 24 måneder.",
  docs_guide_messages:
    "Hva en leser spurte dokumentasjonens KI-veileder om, og hva den svarte (tokener, nøkler og passord fjernes før de lagres). Ikke knyttet til noe annet enn fanens token; slettes med samtalens utskrift.",

  // Felt
  field_values: "Felt ansatte fylte ut om kunden, slettes med kontoen; en bestillings felt slettes når bestillingen anonymiseres.",

  // Skatt og avgift
  vat_checks: "Svaret fra kontrollen av mva-nummeret til en kjøpers bedrift: " + LAW,

  // Databehandlernes køer
  api_idempotency_keys:
    "Et svar fra Admin-API-et, lagret under klientens Idempotency-Key så en gjentatt forespørsel får det igjen (PSI DATA-03); det kan inneholde det en rute returnerte om en kunde (forsendelsen av en bestilling, en kundes stikkord). Slettes 24 timer etter forespørselen av jobbfordeleren (pruneApiIdempotency()), uansett hva personen ber om.",
  api_app_idempotency_keys:
    "En apps svar fra Admin-API-et, lagret under appens Idempotency-Key per installasjon (D441), som api_idempotency_keys: det kan inneholde det en rute returnerte om en kunde. Slettes 24 timer etter forespørselen av jobbfordeleren (pruneApiIdempotency()), uansett hva personen ber om.",
  webhook_events:
    "En hendelse fra en betalingsleverandør inneholder et navn, en e-post og en adresse; innholdet tømmes 90 dager etter at hendelsen ble behandlet, og raden blir stående så ID-en hindrer duplikater.",
  integration_deliveries:
    "En kø av hendelser sendt til butikkens tilkoblede tjenester, slettes etter 30 dager; tjenestene beholder sine egne kopier (dette står i filens notIncluded).",
  privacy_requests:
    "Dokumentasjonen på at en forespørsel ble besvart i tide: adressen fjernes 30 dager etter at forespørselen ble besvart, raden (bare tall og datoer) etter 24 måneder.",
  idempotency_keys: "En ubrukt tabell; den har en forespørselsnøkkel og et svar, men ingenting skrives til den.",

  // Eierens eget regnskap
  work_clients:
    "Arbeid er eierens eget regnskap (D122), som oppbevares etter bokføringsplikten og gjelder en annen registrert; forhåndsvisningen varsler når personen er en klient i Arbeid.",
  work_assignments: WORK + OWN,
  work_credit_notes: WORK + OWN,
  work_events: WORK + OWN,
  work_invoices: WORK + OWN,
  ledger_entries: "Butikkens eget regnskap (D478): et bilags tekst kan nevne en klient i Arbeid, og oppbevares etter bokføringsplikten. " + OWN,
  ledger_lines: "Butikkens eget regnskap (D478): en posterings tekst, som oppbevares etter bokføringsplikten. " + OWN,
  bank_lines: "Butikkens egen kontoutskrift i regnskapet (D486): en linje navngir hvem som betalte eller fikk betalt, slik banken skrev det, og oppbevares etter bokføringsplikten. " + OWN,
  bank_statements: "Butikkens egne kontoutskrifter (D486): filens navn slik den ble lastet opp, oppbevart med linjene. " + OWN,
  ledger_vouchers: "Bilagene i butikkens eget regnskap (D490), som kvitteringen for et kjøp: filens navn slik den ble lastet opp, og filen i det private dokumentlageret, oppbevart for bokføringsplikten med posteringen den dokumenterer. " + OWN,
  suppliers: "Butikkens egne leverandører (D492): hvem som sender den regninger, med navn og organisasjonsnummer (et enkeltpersonforetaks navn er en persons), oppbevart med regningene under bokføringsplikten. " + OWN,
  supplier_invoices: "Butikkens egne regninger (D492): hva hver var, slik eieren skrev det eller leverandørens navn og nummer, ført i regnskapet under bokføringsplikten. " + OWN,
  recurring_costs: "Butikkens egne abonnementer (D503): det den betaler for igjen og igjen og ordene trekket har i banken, eierens egen liste. " + OWN,
  books_inbox: "Kvitteringer og fakturaer sendt til butikkens regnskapsadresse (D504): hvem som sendte hver og emnet, beholdt som regnskapets dokumenter mens de venter på banklinjen og etterpå, under bokføringsplikten. " + OWN,
  work_recurring_invoices: WORK + OWN,
  work_time_entries: WORK + OWN,

  // Ansatte, verter, eiere, søkere, plattformen
  accounts:
    OWN +
    " Når personen sletter sin egen konto (D377, `eraseOwnAccount()`), beholdes raden (mange tabeller bruker den til å vise hvem som handlet), og den gjøres anonym: en adresse som ikke finnes, uten navn eller bilde, uten pålogging, slått av.",
  push_subscriptions:
    "En ansatts enhet som får varsler om nye bestillinger i en butikk (D361): push-adressen og et navn; fjernes av personen, når push-tjenesten sier at den er borte, og når personen ikke lenger kan lese butikkens bestillinger. " +
    OWN,
  status_subscribers:
    "Personer som ba om e-post om driftshendelser hos Kaizena Flow (D360): en adresse og et språk. Å melde seg av (lenken i hver e-post) sletter raden, og en som aldri ble bekreftet, slettes etter en uke. " +
    OWN,
  content_reports:
    "Meldinger om ulovlig innhold i en butikk (DSA art. 16, D411): avsenderens navn, adresse og begrunnelse, beholdt så meldingen kan avgjøres og besvares. Navnet og adressen tømmes 12 måneder etter avgjørelsen av oppbevaringsregelen content_report_senders (runRetention, pruneContentReports()); meldingen og avgjørelsen blir stående som dokumentasjon på hvordan den ble behandlet. KI-ens vurdering (`ai_reading`, `ai_note`, D411 del 2) oppsummerer meldingen og navngir aldri avsenderen. " +
    OWN,
  access_requests:
    "Personer som søkte om å åpne en butikk: plattformens søkere. " +
    OWN +
    " Når personen sletter sin egen konto (D377, `eraseOwnAccount()`), tømmes søkerens e-post, navn og melding, og i en avgjort søknad tømmes de 12 måneder etter avgjørelsen (PSI REG-05). Hvor de først kom fra (D522: kanalen, kilden og kampanjen for deres første besøk på Kaizena Flows nettsted) lagres bare når de tillot statistikk-informasjonskapsler, aldri et besøk. Annonseplattformenes ID-er nettleseren hadde da de registrerte seg (D523: Metas, Googles, TikToks og Pinterests) lagres bare når de tillot markedsføringsinformasjonskapsler, for å sende registreringen og deres første betalte abonnement som konverteringer (bare en hash av e-posten, og bare på nivået Utvidet), og slettes 90 dager etter søknaden, eller sammen med personen.",
  abandoned_plan_checkouts: "En butikkeiers uferdige kjøp av et abonnement. " + OWN,
  platform_integration_deliveries:
    "Kaizena Flows egne hendelser på vei til Slack, Zapier eller Make (D465): innholdet for en forespørsel nevner personen som spurte (navn og e-postadresse; meldingen til Slack aldri e-postadressen). " +
    OWN +
    " Slettes 30 dager etter hendelsen, som butikkenes; når forespørselen tømmes (oppbevaringsregelen eller kontoens egen sletting), tømmes innholdet i alle hendelser om den med en gang.",
  accessibility_settings: "Butikkens egen kontakt for tilgjengelighetserklæringen. " + OWN,
  assistant_memories:
    "KI-assistentens minne om en ansatt; en oppbevaringstid er opp til eieren av KI-assistenten (docs/wave-1g-gdpr.md avsnitt 7); slettes når personen sletter sin egen konto (D377). Personen laster ned minnene sine som en fil fra minnesiden og sletter noen av dem eller alle; et minne beholder aldri kontaktopplysninger eller numre som identifiserer noen (`NEVER_KEPT`), og et minne som navngir en kunde, slettes når kundens opplysninger slettes (PSI AGT-07).",
  assistant_messages:
    "KI-assistentens samtaler inneholder det verktøyene returnerte; slettes 12 måneder etter at de ble skrevet eller etter butikkeierens egen periode (D391, runRetention: assistant_conversations), og når personen sletter sin egen konto (D377); når en kundes opplysninger slettes, tømmes kundens e-post, fulle navn og telefonnummer i dem (PSI REG-03).",
  assistant_notices:
    "Det KI-assistenten gjorde ferdig eller venter på for en ansatt (D350): en tittel eller et sammendrag av den ansattes eget arbeid, aldri en kundes opplysninger; slettes med kontoen og etter 60 dager.",
  assistant_skills:
    "Ferdigheter en ansatt lagret for KI-assistenten med egne ord (D350), avvist når de inneholder en e-postadresse, et langt tall eller et passord; slettes med kontoen.",
  store_drafts: "En butikk laget som utkast fra en eiers beskrivelse av sin egen virksomhet (D351), aldri en kundes opplysninger; slettes med butikken.",
  dream_runs:
    "En kjøring i Dream Factory (D409): eierens beskrivelse av sin egen virksomhet og briefen som ble lest ut av den, med virksomhetens egne opplysninger; aldri en kundes; slettes med butikken.",
  assistant_follow_ups: "Oppfølginger en ansatt ba KI-assistenten om, med egne ord; slettes med kontoen eller samtalen.",
  kaizen_life_handoffs: "Oppgaver en persons assistenter i Kaizena Flow og Kaizen Life ga hverandre over kontokoblingen, med personens og assistentenes egne ord; slettes med kontoen, og etter at de er avsluttet, etter KI-assistentens lagringstid.",
  assistant_goals: "Eierens mål for virksomheten med egne ord (D309); butikkens, ikke en kundes.",
  assistant_plans: "Autopilotens planer (D309), kjørt i en ansatts navn; slettes med kontoen eller samtalen.",
  autopilot_reports: "Det autopiloten fortalte en ansatt: antall, titlene på planenes steg og tall, aldri en kunde (D309).",
  autopilot_events:
    "Det autopiloten reagerte på: samtalen, testen eller varselet med ID og tall, og en setning om hva det førte til, med beskjed om aldri å navngi en kunde; ryddes bort etter 90 dager (D331).",
  autopilot_reviews: "Autopilotens gjennomganger av eierens mål: planen den laget og en setning om hva den førte til, aldri en kunde (D328).",
  brand_profiles: "Hvordan virksomheten beskriver merkevaren sin (D330), aldri en kunde.",
  research_notes: "Det butikkens KI fant på nettet for virksomheten, og hvor (D329), aldri en kunde.",
  research_sources: "Offentlige nettsider butikkens KI søkte i eller leste for undersøkelsene sine (D329), aldri en kunde; beholdes i 90 dager.",
  legal_ai_settings: "Hvem som slo på KI-ens juridiske sider for en butikk, og når, aldri en kunde (D311).",
  legal_ai_writes: "Hvem som ba KI-en skrive en juridisk side, og siden den laget, bygd på butikkens forretningsopplysninger, aldri en kunde (D311).",
  page_looks: "Hvem som ba om en gjennomgang av en side, og hva den fant på siden, aldri en kunde; beholdes i 30 dager (D310).",
  assistant_plan_steps: "Stegene i en plan: hva autopiloten gjorde og spurte om, og eierens svar (D309); slettes med planen.",
  audit_log:
    "Aktivitetsloggen inneholder ID-er, antall og typer, aldri en e-post eller et navn (en test sjekker den); beholdes i 24 måneder som dokumentasjon på hvem som gjorde hva.",
  booking_resources: "En ansatt, et rom eller en verts eiendom. " + OWN,
  economic_operators: "Butikkens egne opplysninger om produsent eller importør. " + OWN,
  host_stripe_accounts: OWN,
  host_tax_details: "En verts skatteopplysninger (DAC7). " + OWN,
  hosts: OWN,
  blog_authors: "Forfatterne av butikkens artikler (D341), navngitt og beskrevet av butikken for dens egen blogg. " + OWN,
  wordpress_connections: "Et WordPress-nettsted en eier koblet til (D169): adressen og navnet, en hash av tokenet, aldri selve tokenet. " + OWN,
  referral_entries: "Vervekreditt mellom butikkeiere (D131). " + OWN,
  return_settings: "Butikkens egen returadresse. " + OWN,
  store_locations: "Butikkens egne steder. " + OWN,
  store_roles: OWN,
  stores: "Selve butikken. " + OWN,
  store_business_changes: "Virksomhetene bak butikken over tid (D473): navnet, numrene og adressen til hver fra dens dag, og hva butikken var før. " + OWN,
  domain_purchases:
    "Hva en butikk eller en person betalte Kaizena Flow for et domene (D315, D317): navnet, prisene og fakturaen, og for en kjøper uten butikk om de kjøpte som privatperson, bedriftens mva-nummer og samtykket de ga. " +
    OWN,
  domain_registrants:
    "Hvem butikkens domener er registrert på (D315): eieren eller selskapet deres, sendt til registraren og registeret fordi en registrering krever det. " + OWN,
  products: "Et produkt kan tilhøre en vert. " + OWN,
};

/** The orders' row of an erasure plan that no register entry says (`buildPlan()` in `erasure-plan.ts`: the orders made anonymous now). */
export const ORDERS_ANONYMISED_REASON_NB =
  "En bestilling som aldri ble betalt, en som ble kopiert fra en annen butikk, eller et salg der bokføringsperioden er over, får navnet, adressen og e-posten erstattet med en markør.";

/** An erasure plan (`ErasurePlan`) with each row's reason in Norwegian, for the admin in Norwegian; a table without one keeps its English. */
export function planReasonsNb<T extends { rows: readonly { table: string; action: string; reason: string }[] }>(plan: T): T {
  return {
    ...plan,
    rows: plan.rows.map((row) => ({
      ...row,
      reason: row.table === "orders" && row.action === "anonymised" ? ORDERS_ANONYMISED_REASON_NB : (PERSONAL_DATA_REASONS_NB[row.table] ?? row.reason),
    })),
  };
}
