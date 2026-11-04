---
title: Betalingsmetoder
summary: Se hvilke betalingsmetoder kassen tilbyr, slå av en metode for et land, og la kundene betale med lommebok fra produktsiden eller handlekurven.
track: owners
section: payments
kind: how-to
areas: [payments, markets, customers]
features: []
plans: []
admin: /admin/{store}/settings/payments
order: 20
checked: 2026-11-04
sources: [D291, D293, D357, D373, D387]
---

## Hva kundene kan betale med

Stripe viser hver kunde betalingsmetodene som passer landet og valutaen deres, blant dem som er slått på for landet. Kaizena Flow ber
Stripe om disse metodene på kontoen din, og alle er slått på fra start:

| Metode | Hvor |
|---|---|
| Kort, Apple Pay og Google Pay | Overalt, alltid på |
| Klarna | Det meste av Europa |
| Link | Overalt |
| MobilePay | Danmark og Finland |
| iDEAL | Nederland, i euro |
| Bancontact | Belgia, i euro |
| EPS | Østerrike, i euro |
| Przelewy24 | Polen |
| BLIK | Polen, i złoty |
| SEPA Direct Debit | Euroland |

En metode Stripe ikke har gjort aktiv på kontoen din, vises aldri for kundene, uansett hva som er krysset av. Stripes andre metoder styrer
du i Stripe-dashbordet, som det er lenke til fra samme kort.

## Slå av en metode for et land

1. Åpne **Innstillinger** i menyen og velg [Betalinger](/admin/{store}/settings/payments), under Salg.
2. Under **Betalingsmetoder** har tabellen en kolonne for hvert land du selger til. Fjern haken ved en metode i kolonnen til et land for å
   ta den ut av kassen i det landet.
3. Trykk **Lagre**. Nye kasser tilbyr metodene som er krysset av.

Kort kan ikke slås av: raden deres sier *Alltid*. Bare eiere kan endre tabellen.

### Hva Stripe sier om hver metode

Kolonnen **Hos Stripe** viser hver metodes status på kontoen din: *Aktiv*, *Stripe kontrollerer*, *Bedt om*, *Ikke tilgjengelig* eller
*Ikke lest ennå*. *Ikke tilgjengelig* kommer med grunnen fra Stripe, for eksempel *Stripe tilbyr den ikke i landet ditt*. Tabellen leser
livekontoen din når du har en, og testkontoen før det.

### Betalinger som tar flere dager

Med SEPA Direct Debit kommer pengene noen dager etter bestillingen. Bestillingen venter med varene reservert, i opptil 21 dager, til
Stripe sier at pengene har kommet; da er bestillingen betalt. Mislykkes betalingen, kanselleres bestillingen og varene frigjøres. Både
bestillingen i administrasjonen og kundens bestillingsside sier at den venter.

### Abonnementer og abonnementsbokser

Abonnementer tar bare metodene Stripe tillater for gjentakende betaling, som kort og SEPA Direct Debit. Abonnementsbokser tar kort.

### MobilePay

MobilePay tilbys kunder i Danmark og Finland når Stripe har gjort den aktiv på kontoen din. Du slår den av for et land som enhver annen
metode. En betaling med MobilePay står som det på bestillingen, og en tilbakebetaling går tilbake gjennom Stripe som alle andre.

## Lommebøker og rask betaling

Apple Pay, Google Pay, Link og Klarna vises bare på nettadresser som er registrert på Stripe-kontoen din. Kaizena Flow registrerer hver
adresse kundene dine betaler på. Kortet **Lommebøker og rask betaling** på Betalinger viser hver lommeboks status på kontoen din og på hver
adresse: *Aktiv*, *Ikke aktiv*, *Slått av*, *Ikke registrert* eller *Ikke lest ennå*.

Er en lommebok ikke aktiv på en adresse, trykker du **Sjekk igjen**: da registreres adresser som mangler, og svaret fra Stripe leses på
nytt. Bare eiere kan trykke på den.

### Knappen for rask betaling

Kundene ser **Rask betaling** på produktsider og i handlekurven, med knappen **Betal med lommebok** for lommebøkene enheten deres tilbyr.
På en produktside legger knappen produktet kunden har valgt, i handlekurven og betaler for hele handlekurven; det står der når
handlekurven har mer i seg. Bestillingen går gjennom kassen din som alle andre, så prisen, mva., leveringen, rabattene og vilkårene dine
er de samme.

Den tilbys for varer som sendes med post, kjøpes én gang og er på lager. Den tilbys ikke:

- for nedlastinger, abonnementer, bookinger, gavekort og vertenes oppføringer, som trenger svar en lommebok ikke kan gi;
- til kunder som handler for en bedrift;
- til kunder som ikke er logget inn, når butikken krever konto;
- når kassen stiller egne spørsmål (regler i kassen);
- når butikken tar imot betalinger gjennom Mollie.

### Klarnas linje under prisene

Der Klarna er aktiv på Stripe-kontoen din og slått på for landet, viser produktsidene og handlekurven Stripes linje om å betale med Klarna
under prisen, i landene og valutaene Stripes linje støtter. Vil du fjerne den for et land, fjerner du haken ved Klarna der.

## Flere valg

### Hold en metode utenfor for noen handlekurver

En [regel i kassen](/admin/{store}/settings/checkout) kan **Hold betalingsmåter utenfor** når handlekurven passer det du velger: landet,
verdien eller vekten, produktene, kategoriene eller merkene, eller kundegruppen. Kort tilbys alltid. Åpne **Innstillinger** og velg
**Regler i kassen**, under Salg.

### Betal med faktura for bedrifter

Når **Salg til bedrifter** er slått på under Innstillinger, Funksjoner, kan en bedrift under **Kunder**, **Bedrifter** få
**Betalingsvilkår** på 15, 30 eller 60 dager og en valgfri **Kredittgrense**: det bedriften kan skylde på én gang. Kontoene dens ser da
*Betal med faktura* i kassen, ved siden av å betale nå, for varer som kjøpes én gang.

Bestillingen bekreftes med en gang, og fakturaen forfaller etter de dagene. Den regnes som et salg først når den er betalt. Kunden betaler
fra bestillingssiden sin, eller du registrerer penger betalt utenfor Kaizena Flow på bestillingen, alt på én gang eller i deler.
Påminnelser går tre dager før forfallsdagen og dagen etter. [Bedrifter og B2B](/docs/owners/customers/companies-and-b2b) har resten.
