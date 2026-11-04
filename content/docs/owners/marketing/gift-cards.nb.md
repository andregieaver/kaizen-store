---
title: Gavekort
summary: Selg gavekort i butikken, utsted et for hånd, og se hva kundene har til gode, historikken til hvert gavekort og saldoen.
track: owners
section: marketing
kind: how-to
areas: [marketing, products, payments]
features: [gift_cards]
plans: []
admin: /admin/{store}/gift-cards
order: 30
checked: 2026-11-04
sources: [D178, D300, D381]
---

## Slå på gavekort

Gavekort er av til du slår dem på: åpne **Innstillinger**, velg [Funksjoner](/admin/{store}/settings/features) og slå på **Gavekort**.

Slår du dem av senere, kan ingen kjøpe gavekort lenger. Gavekort som allerede er solgt eller utstedt, kan fortsatt brukes og
tilbakebetales, siden pengene er kundens, og siden Gavekort blir stående.

## Selg gavekort

1. Åpne **Produkter** i menyen og trykk **Legg til produkt**.
2. Under **Hva er det?** velger du **Et gavekort**.
3. Gi det én variant for hvert beløp du selger. Prisen på en variant i hvert land er det gavekortet er verdt der.
4. Publiser det som et hvilket som helst annet produkt.

På produktsiden velger kunden beløpet. Skal det gis bort, krysser kunden av for **Send det til noen** og fyller inn mottakerens
e-postadresse og navn, hvem det er fra, en hilsen og dagen det skal sendes, fra i dag og inntil et år fram. Gavekortet sendes til
mottakeren på e-post den dagen, fra kl. 08.00 i butikkens tidssone, og kjøperen får beskjed om at det er på vei. Ellers sendes det til
kjøperen med en gang.

Et gavekort lages når bestillingen er betalt. Koden står bare i e-posten: Kaizena Flow tar bare vare på et fingeravtrykk av den, så
ingen kan lese en kode tilbake, heller ikke de ansatte.

### Hva som er annerledes med et gavekort

- **Ingen mva. ved salget.** Merverdiavgiften beregnes på varene først når gavekortet brukes, og fakturaen sier det.
- **Ingenting trekkes fra.** Kampanjer, rabattkoder, kundegrupperabatter og bonuskreditt gir aldri rabatt på et gavekort, og det teller
  ikke mot et minstebeløp eller mot gratis frakt.
- **Angrerett.** Kjøperen kan angre kjøpet av et gavekort innen 14 dager så lenge ingenting av det er brukt; gavekortet deaktiveres da
  og betales tilbake ([Returer og angrerett](/docs/owners/orders/returns-and-withdrawals)).
- **Testbetalinger.** Gavekort som kjøpes mens butikken tar testbetalinger, er testkort og kan ikke brukes med ekte betalinger.

## Slik bruker kundene dem

I handlekurven og i kassen, ved siden av rabattkoden, skriver kundene inn **Gavekortkode** og trykker **Bruk**. En bestilling kan bruke
opptil tre gavekort.

- Et gavekort betaler som penger. Bestillingens totalbeløp og mva. blir som før; gavekortene betaler først, og resten betales som
  vanlig. Når gavekortene betaler alt, er det ingen betalingsside.
- Et gavekort er i én valuta og betaler bare i den.
- Et gavekort kan ikke betale for et annet gavekort eller et abonnement.
- Når du betaler tilbake en bestilling som er betalt med gavekort, går gavekortets del tilbake på kortet. Kundens andre penger betales
  tilbake først.

En feil kode får bare *Dette gavekortet kan ikke brukes*, aldri om en slik kode finnes.

## Siden Gavekort

Åpne **Produkter** og velg [Gavekort](/admin/{store}/gift-cards). Øverst viser **Kundene har til gode** hva som står på gavekortene nå,
per valuta. Under **Alle gavekort** søker du på de fire siste tegnene i en kode, et bestillingsnummer eller, hvis du har tilgang til
kunder, en person, og filtrerer etter tilstand: *Ikke sendt ennå*, *Aktivt*, *Brukt opp*, *Utløpt* eller *Deaktivert*.

Åpne et gavekort for å se verdien og hva som er igjen, når det utløper, hvordan det ble til, hele historikken og bestillingene det betalte.

### Utsted et gavekort for hånd

1. Trykk **Utsted et gavekort**.
2. Oppgi **Beløp** og **Valuta**, en butikken selger i.
3. Under **Hvem det er til (valgfritt)** oppgir du e-postadressen deres, så sendes koden dit, og navnet deres, en hilsen og språket i
   e-posten.
4. Under **Hvorfor det utstedes** skriver du et notat til deg selv, for eksempel en kompensasjon for en bestilling. Mottakeren ser det
   ikke.
5. Trykk **Utsted gavekortet**.

Koden vises én gang, her: trykk **Kopier koden** hvis du skal gi den videre selv. For å utstede, endre og deaktivere gavekort må du ha
rett til å endre produkter.

### Endre et gavekort

På siden til et gavekort:

- **Endre saldoen**: **Legg til** eller **Trekk fra** et beløp, og skriv **Hvorfor**. Grunnen lagres sammen med endringen. Et gavekort
  går aldri under null.
- **Deaktiver**: gavekortet kan aldri brukes igjen, og det som er igjen på det, forsvinner. Bestillinger det allerede har betalt,
  beholder pengene.
- **En ny kode**, for en kode som er borte eller som noen andre har sett: kryss av for **Stopp den gamle koden og lag en ny** og trykk
  **Send en ny kode**. Den gamle koden slutter å virke med en gang, og saldoen blir stående. Den nye koden sendes på e-post til adressen
  gavekortet gikk til, eller vises én gang for deg, så du kan gi den videre.
- **Prøv å sende det på nytt**, for et kjøpt gavekort der e-posten ikke kom fram.

### Hvor lenge gavekort varer

Under **Hvor lenge gavekort varer** velger du hvor lenge **Nye gavekort varer**: fra 1 til 10 år, eller *Aldri*. Nye butikker starter på
3 år. Et gavekort beholder datoen det ble utstedt med, og det som er igjen på det når det utløper, forsvinner. Mange land forventer minst
tre år: sjekk hva som gjelder for deg.

## I tallene dine

Et solgt gavekort er ikke et salg før det blir brukt. **Analyse**, **Økonomi** holder solgte gavekort utenfor salget og viser hva kundene
har til gode på dem, per valuta, med hva som ble utstedt, brukt, tilbakebetalt til kortet og utløpt i perioden
([Analyse](/docs/owners/analytics/analytics)).
