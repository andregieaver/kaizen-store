---
title: Vanlige problemer
summary: Hva du sjekker når et produkt ikke vises, butikken sier at den ikke er åpen, kassen ikke tar ekte betalinger, en e-post ikke kom fram, et domene ikke virker, KI-assistenten ikke svarer, eller noen i teamet ikke får åpnet en side.
track: owners
section: troubleshooting
kind: troubleshooting
areas: [products, setup, payments, orders, website, ai, team, settings]
features: []
plans: []
admin: /admin/{store}
order: 10
checked: 2026-11-04
sources: [D17, D26, D73, D94, D158, D171, D178, D238, D335, D339, D342, D369, D420]
---

Hvert punkt er noe du kan legge merke til, med det du bør sjekke, det mest sannsynlige først. Siden det lenkes til på slutten av hvert
punkt, forklarer det i sin helhet.

## Et produkt vises ikke i et land

Åpne produktet under **Produkter** og sjekk:

1. **Statusen.** Et produkt med statusen *Utkast (skjult)* er ikke på nettstedet, og det er heller ikke et arkivert produkt. Sett det til
   **Publisert** og trykk **Lagre**.
2. **En pris der.** Et land uten pris selger ikke produktet.
3. **Selges i.** Et land uten hake under **Selges i** selger det ikke, selv om prisen der beholdes. Kryss av igjen og lagre.
4. **Landet.** Butikken må selge til det landet: se [Land](/admin/{store}/settings/countries).
5. **Hva produktet trenger.** En timebestilling, en overnatting eller en utleie, eller et produkt som bare selges som abonnement, vises
   bare mens funksjonen er slått på under **Innstillinger**, **Funksjoner**. Er nettbutikken slått av der, vises ingen produkter.

Vises produktet, men står det *Selges ikke i dette landet nå*, hører det inn under en returordning uten gyldig registrering i det
landet: se [Produsentansvar](/admin/{store}/settings/producer-responsibility). Ser de besøkende bare en landingsside, er hele butikken
privat: se neste punkt.

Mer: [priser](/docs/owners/products/prices), [land, språk og valutaer](/docs/owners/markets-and-tax/countries-languages-currencies),
[produsentansvar](/docs/owners/markets-and-tax/producer-responsibility).

## Butikken sier at den er en forhåndsvisning eller ikke åpen

Det butikken viser, forteller deg hvorfor:

- **Forhåndsvisning: Denne butikken er ikke åpnet ennå.** Oppsettet er ikke ferdig. Åpne [oppsettet](/admin/{store}/setup), gå til
  **Åpne butikken** og trykk **Åpne butikken min**. Først må opplysningene om virksomheten og minst ett land være på plass.
- **Bare en landingsside**, som standard med butikkens navn og *Denne butikken er ikke åpen for besøkende ennå.* Butikken er privat. En ny
  butikk er privat til den åpnes. For å åpne en butikk som allerede er satt opp, går du til **Innstillinger**,
  [Privat modus](/admin/{store}/settings/private) og trykker **Åpne butikken for alle**. De som har passordet, kan komme inn så lenge, og
  med **Forhåndsvis butikken** ser du den uten passord.
- **Privat modus sier at den gratis prøveperioden er over.** Prøveperioden gikk ut uten abonnement. Velg et under
  [Abonnement og faktura](/admin/{store}/billing): butikken er offentlig igjen i løpet av noen minutter. Til da kan den ikke gjøres
  offentlig eller åpnes.
- **Dette er en demobutikk. Ingenting kan kjøpes ennå.** Butikken er åpen, men kan ikke ta imot betalinger: se neste punkt.

Mer: [lag nettbutikken din](/docs/owners/getting-started/create-your-store), [velg et abonnement](/docs/owners/getting-started/choose-a-plan).

## Kassen tar ikke ekte betalinger

Åpne **Innstillinger**, [Betalinger](/admin/{store}/settings/payments). Bare eiere kan endre den.

- **Butikken sier Testmodus: ingen ekte betalinger.** Betalingene er i testmodus. Under **Ekte betalinger** trykker du **Sett opp Stripe**
  og svarer på spørsmålene fra Stripe. Når statusen sier *Klar: butikken kan ta imot betalinger.*, velger du **Live** under **Kassen** og
  trykker **Lagre**. Til Stripe er klar, står det *Live (sett opp Stripe ovenfor først)* ved det valget.
- **Statusen sier at Stripe trenger flere opplysninger, eller kontrollerer dem.** Ekte betalinger venter på Stripe. Svar ferdig på
  spørsmålene; en kontroll tar vanligvis noen minutter, av og til en dag eller to.
- **Butikken sier Dette er en demobutikk.** Kassen er slått av, eller Stripe har ikke gjort kortbetalinger aktive på kontoen din. Kryss av
  for **Kundene kan betale** under **Kassen** og trykk **Lagre**, og sjekk statusen under **Ekte betalinger**.
- **Kundene ser at butikken ikke har åpnet ennå, så den tar ikke imot bestillinger.** En butikk tar ikke imot ekte betalinger før den er
  åpnet. Testbetalinger virker så lenge, med kortet `4242 4242 4242 4242`.
- **Kassen sier Ekte betalinger åpner når Kaizena Flow går live.** Ekte betalinger tilbys ikke ennå: det er ingenting du skal stille
  inn.

En betalingsmetode som er krysset av, men mangler i kassen, er kanskje ikke aktiv på Stripe-kontoen din: **Betalingsmetoder**, på samme
side, viser hva Stripe sier om hver av dem.

Mer: [sett opp betalinger](/docs/owners/payments/set-up-payments), [betalingsmetoder](/docs/owners/payments/payment-methods).

## En e-post kom ikke fram

**En e-post til en kunde.** Åpne **Bestillinger**, [E-poster](/admin/{store}/emails). Der står e-postene butikken har sendt, de nyeste
først, hver med adressen den gikk til og **Status**:

- *Sendes*, *Sendt* eller *Levert*: den gikk ut. Sjekk adressen den gikk til.
- *Mislyktes*: den kunne ikke sendes. For en ordrebekreftelse har en betalt bestilling **Send bekreftelsen på nytt** på siden sin.
- *Avvist (adressen tar ikke imot e-post)*: adressen virker ikke. Er den feil på bestillingen, retter du den der.
- *Merket som søppelpost av mottakeren*: kunden merket den som søppelpost.
- *Ikke sendt (e-post er ikke satt opp)*: utsending av e-post er ikke satt opp hos Kaizena Flow, så ingenting gikk ut.

Åpne en e-post for å lese nøyaktig hva som ble sendt. En e-post som er slått av under **Innstillinger**,
[Varsler](/admin/{store}/settings/notifications), sendes ikke i det hele tatt; de som er merket *Alltid på*, sendes alltid.

**En e-post til deg eller teamet.** Bare dem som er krysset av for den under
[Varsler til ansatte](/admin/{store}/settings/notifications/staff), får den, og en boks tilbys bare der personens rolle kan lese det
e-posten viser. Statusrapporten sender ingenting for en stille periode, uten betalte bestillinger og uten varsler. Analysevarsler sendes
én gang om dagen, etter kl. 20 butikkens tid.

Mer: [varsler](/docs/owners/team-and-settings/notifications), [rapporter, mål og varsler](/docs/owners/analytics/reports-targets-and-alerts).

## Mitt eget domene virker ikke

Åpne **Innstillinger**, [Domener](/admin/{store}/settings/domains), og finn domenet under **Dine egne domener**:

- **Venter på DNS.** Postene som vises, er ikke alle på plass. Lag dem hos selskapet der du styrer domenets DNS, og fjern andre A-, AAAA-
  eller CNAME-poster på samme navn. **Funnet** viser hvilke som er der. Trykk **Sjekk nå**: det kan ta opptil noen timer før
  DNS-endringer vises.
- **Status** nevner alt annet som er galt: domenet peker ikke til butikken ennå, posten som viser at domenet er ditt, mangler, en
  CAA-post stopper https-sertifikatet, domenet har gått ut, eller innehaveren har ikke bekreftet e-postadressen sin.
- **Siden sier at domenene dine er endret.** Kaizena Flow legger endringen ut, noe som tar noen minutter. Siden oppdaterer seg selv.

Når postene er på plass, blir domenet butikkens adresse, med sertifikat for https, og de andre adressene dine fører dit. Bare en eier
kan legge til domener.

Mer: [SEO, videresendinger og domener](/docs/owners/website/seo-redirects-and-domains).

## KI-assistenten svarer ikke

- **Den sier at den trenger en tekstmodell.** Trykk **Sett opp en under KI**, eller åpne **Innstillinger**, [KI](/admin/{store}/settings/ai).
  Med din egen KI velger du en tekstmodell for den der. Med Kaizena Flows KI kan abonnementets KI for måneden være brukt opp: se **Bruk
  denne måneden** under [Abonnement og faktura](/admin/{store}/billing). KI med din egen leverandørs nøkkel begrenses aldri av
  abonnementet.
- **Den sier at den har svart på mange meldinger i dag.** Den svarer på et fast antall meldinger per butikk hver dag, og er tilbake
  dagen etter.
- **Du finner den ikke.** KI-assistenten er for butikkens eiere, og er ikke der mens butikken er stengt.

Mer: [KI-assistenten](/docs/owners/ai/the-ai-manager), [velg et abonnement](/docs/owners/getting-started/choose-a-plan).

## Noen i teamet får ikke åpnet en side

En side som rollen til en person ikke kan åpne, er tatt ut av menyen deres, og adressen svarer som om siden ikke fantes. Sjekk:

1. **Rollen.** [Team](/admin/{store}/staff) viser rollen til hver person, og [Roller](/admin/{store}/staff/roles) hva den gir i hvert
   område: *Ingen tilgang*, *Kan se* eller *Kan endre*. Velg en annen rolle og trykk **Endre rolle**, eller endre selve rollen. En
   endring gjelder med en gang.
2. **Sider for eiere.** Team, Abonnement og faktura, Innstillinger for analyse, Varsler til ansatte og KI-assistenten er for eiere, uansett
   hva rollen sier.
3. **Sluttdatoen til en samarbeidspartner.** Tilgangen til en samarbeidspartner slutter på datoen sin. Før det gir **Forleng** flere
   dager. Etterpå står de under **Tilgangen er avsluttet**: inviter dem igjen under **Inviter en samarbeidspartner**.
4. **Totrinns innlogging.** Når butikken krever det, blir den som ikke har det, sendt til å sette det opp før de kommer inn i butikken.
5. **En stengt butikk.** Mens butikken er stengt eller suspendert, kan alle bare lese og ta seg av det som allerede har skjedd.

[Aktivitetsloggen](/admin/{store}/activity) noterer hver gang noen ble nektet noe rollen ikke gir tilgang til.

Mer: [ansatte og tilganger](/docs/owners/team-and-settings/staff-and-permissions), [sikkerhet](/docs/owners/team-and-settings/security).
