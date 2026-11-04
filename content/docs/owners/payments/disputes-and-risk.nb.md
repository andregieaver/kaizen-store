---
title: Tilbakeføringer og risikable betalinger
summary: Se hvordan en bestilling ble betalt og når Stripe vurderer den som risikabel, hold igjen risikable bestillinger før de sendes, og svar på en tilbakeføring med bevis skrevet ut fra bestillingen.
track: owners
section: payments
kind: how-to
areas: [payments, orders, customers]
features: []
plans: []
admin: /admin/{store}/orders
order: 40
checked: 2026-11-04
sources: [D288, D417]
---

## Hvordan en bestilling ble betalt

Kortet **Betaling** på hver bestilling viser hvordan den ble betalt, slik Stripe oppga det: betalingsmetoden, og for et kort hvilket
kortmerke og eventuell lommebok. Kaizena Flow leser det fra Stripe kort tid etter betalingen; til da står det *Ukjent (ikke lest fra
Stripe ennå)*. Ingenting gjettes. Betalinger gjennom Mollie har ingen av disse opplysningene.

## Betalinger Stripe vurderer som risikable

Stripe vurderer risikoen ved hver kortbetaling. Kaizena Flow viser den bare når den er forhøyet:

- kortet **Betaling** på bestillingen sier *Stripe: forhøyet risiko* eller *Stripe: høyeste risiko*, med Stripes poengsum av 100;
- listen **Bestillinger** merker bestillingen *Forhøyet risiko* eller *Høyeste risiko*;
- under **Betaling** i listens filtre viser *Forhøyet risiko (Stripe)* bare disse bestillingene.

Se på en slik bestilling før du sender den.

### Hold igjen risikable bestillinger automatisk

1. Åpne **Innstillinger**, velg [Automatisering](/admin/{store}/settings/automation) under Salg, og trykk **Ny regel**.
2. Legg til betingelsen **Stripes risiko er**, med *Forhøyet eller høyest* eller *Høyest*.
3. Legg til handlingen **Hold tilbake**, skriv hvorfor den holdes igjen, og lagre regelen.

En bestilling som er satt på vent, kan ikke sendes eller leveres ut før noen trykker **Frigi** på siden dens. Regelen leser Stripes risiko
før den avgjør, og en bestilling der risikoen ikke er kjent, passer ikke.

## Når en betaling kreves tilbakeført

En tilbakeføring, også kalt tvist eller chargeback, er at kunden ber banken sin om å ta tilbake en betaling. Stripe holder beløpet til
banken har avgjort saken.

- Du får en e-post når en tilbakeføring åpnes, og igjen tre dager før fristen. Eierne får disse e-postene, med mindre du velger andre
  under Innstillinger, Varsler, [Varsler til ansatte](/admin/{store}/settings/notifications/staff).
- Bestillingen merkes *Tvist* i listen over bestillinger, og *Tvist om betalingen* under **Betaling** i filtrene finner alle.
- Kortet **Betaling** på bestillingen viser grunnen, statusen og **Bevis innen**, med **Åpne i Stripe**.

Statusen er *Trenger svar*, *Under behandling*, *Vunnet*, *Tapt* eller *Avverget*. En forespørsel fra banken før en tilbakeføring står som
*Forespørsel: trenger svar*.

> [!WARNING]
> Uten bevis tapes tilbakeføringen. Svar før dagen som står ved **Bevis innen**.

## Svar med hjelp fra Kaizena Flow

1. Trykk **Forbered bevisene** på kortet **Betaling** på bestillingen. **Svar på tilbakeføringen** åpnes.
2. Kaizena Flow har fylt ut Stripes bevisfelt fra bestillingen: hvem som kjøpte og adressene, hva som ble kjøpt, pakkene med fraktselskap
   og sporing, hvordan den ble levert, vilkårene kunden godtok i kassen, angrefristen, tilbakebetalinger, kundens tidligere bestillinger
   og tilbakeføringer, og meldingene kunden har sendt deg. Et felt uten noe bak seg står tomt.
3. Feltene en bank ser på først ved denne grunnen, kommer først. **Alt annet Stripe tar imot** har resten.
4. Les hvert felt, endre det som ikke stemmer, og legg til det bare du vet. **Hvorfor ingen refusjon skyldtes** skriver du alltid selv.
   **Bestillingens historie** går til banken slik den står, så skriv den på engelsk.
5. Trykk **Lagre utkast** når du vil.
6. Når alt stemmer, krysser du av for *Jeg har lest bevisene, og de er sanne. Når de er sendt, kan de ikke endres.* og trykker **Send til
   Stripe**.

Banken avgjør, og utfallet vises på bestillingen når Stripe sier fra til Kaizena Flow.

> [!IMPORTANT]
> Stripe tar imot ett svar per tilbakeføring, og det er endelig. Filer som en kvittering eller en signatur legger du til i
> Stripe-dashbordet: bruk **Åpne i Stripe** på bestillingen.

Greit å vite:

- Bevis sendes bare når et menneske trykker **Send til Stripe**, aldri av KI-assistenten eller autopiloten.
- Alle som kan lese bestillinger, kan åpne siden; bare ansatte som kan endre bestillinger, kan sende.
- En tilbakeføring gjennom Mollie svarer du på i Mollie-dashbordet.
- En tilbakeføring i testmodus sender det du skriver, til Stripes testmodus.

## Hvis tilbakeføringen tapes

En tapt tilbakeføring er penger ut. [Økonomi](/admin/{store}/analytics/finance) viser den som **Tapte tvister** i perioden den ble
avsluttet, uten mva. og med Stripes gebyr der det er kjent, og kortet **Fortjeneste** på bestillingen viser en linje *Tapt tvist*. Det er ikke en
tilbakebetaling: ingen kreditnota utstedes, og ingenting legges tilbake på lager.

## Kunder som returnerer mye

En kunde der minst tre av de betalte bestillingene det siste året har en retur eller en tilbakebetaling, og det er minst halvparten av
dem, får merket *Returnerer ofte*, med hvor mange: på bestillingene, abonnementene og ønskelistene sine, på kundesiden og på siden med
bevisene.
