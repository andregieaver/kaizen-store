---
title: Utkast til bestillinger og tilbud
summary: Lag en bestilling for en kunde og send en lenke for å betale, registrer en betaling tatt imot på en annen måte, og svar på kunders forespørsler om tilbud.
track: owners
section: orders
kind: how-to
areas: [orders, quotes, payments]
features: [shop]
plans: []
admin: /admin/{store}/orders/drafts
order: 30
checked: 2026-11-04
sources: [D173, D431, D435, D437]
---

## Lag et utkast til bestilling

Et utkast er en bestilling du lager for en kunde, for et salg på telefon, på e-post eller ansikt til ansikt. Utkast til bestillinger
hører til nettbutikken, som slås på under Innstillinger, Funksjoner.

1. På **Bestillinger** trykker du **Lag et utkast til bestilling**.
2. Velg **Land**, **Språk** og **Valuta** bestillingen er for, og trykk **Start utkastet**. De avgjør prisene, merverdiavgiften,
   fraktprisen og språket på kundens side og e-poster.
3. Under **Kunde** bruker du **Finn en kunde** med navn eller e-post, eller skriver inn **E-post**. Legg inn en **Leveringsadresse** for
   varer.
4. Under **Linjer** trykker du **Legg til et produkt** med tittel eller varenummer, eller **Legg til en egen vare** for noe som ikke er i
   katalogen. Skriv inn **Pris per stykk** for å gi din egen pris.
5. Vil du, kan du gi **Rabatt**, en prosent eller et beløp med et navn kjøperen ser, og velge **Frakt**: markedets fraktpris, **Gratis
   frakt** eller **En pris jeg setter**.
6. Trykk **Lagre utkastet**. **Sammendrag** viser totalen med mva., beregnet etter kassens egne regler.

Et utkast holder ikke av noe på lager og får ikke noe bestillingsnummer før du sender det. Du finner utkastene dine under
[Utkast til bestillinger](/admin/{store}/orders/drafts).

## Send det til kunden

Under **Send det** velger du hvor mange dager **Lenken gjelder i**, fra 1 til 30, og trykker **Send til kunden**. Kunden får en e-post
med en lenke til en side som viser bestillingen, og en knapp for å betale på Stripes side. Vil du sende lenken selv, trykker du **Lag en
lenke til å dele** i stedet: den vises bare én gang, så kopier den.

Når du sender, lages bestillingen, den får nummeret sitt, og varene holdes av til lenken utløper. Når kunden betaler, er den en vanlig
bestilling.

- **Utløp lenken uten betaling?** Bestillingen kanselleres og varene frigis; nummeret blir stående på den kansellerte bestillingen.
- **Må du endre et sendt utkast?** Trykk **Åpne igjen for å redigere**. Bestillingen kanselleres, og lenken slutter å virke. Sender du
  igjen, lages en ny bestilling med et nytt nummer.

Antall dager starter på det du har satt under **Utkast til bestillinger** i
[Innstillinger, Bestillinger](/admin/{store}/settings/orders): 7 med mindre du endrer det.

## Betalt på en annen måte

Har kunden betalt deg med bankoverføring, kontant eller på en annen måte, trykker du **Merk som betalt utenom Kaizena Flow**. Velg
**Hvordan ble det betalt?**, dagen pengene ble **Mottatt** (høyst 31 dager tilbake) og eventuelt en **Referanse**, og trykk
**Registrer betalingen**.

Bestillingen lages og er betalt, fakturaen sier at den ble betalt utenom nettkassen, og bekreftelsen sendes til kunden på e-post.
Kaizena Flow tok ikke imot pengene og tar ikke noe salgsgebyr av dem. Dette kan ikke angres: en feil rettes med en tilbakebetaling.

> [!IMPORTANT]
> Kontanter tatt imot når varene overleveres, er kontantsalg etter kassasystemreglene i mange land, og noen land har en grense for hvor
> mye kontanter en virksomhet kan ta imot. Registrer kontanter her bare hvis regnskapsføreren din sier at det er tillatt.

Bare eieren kan registrere en betaling tatt imot på en annen måte, med mindre eieren lar ansatte gjøre det under **Betaling tatt utenfor
Kaizena Flow** i Innstillinger, Bestillinger.

## Forespørsler om tilbud

### La kundene spørre

Under **Be om tilbud** i [Innstillinger, Bestillinger](/admin/{store}/settings/orders) velger du hvem som kan spørre: **Av**
(standard), **For alle** eller **Bare for bedriftskunder**. Der butikken tilbyr tilbud, viser produktsidene **Be om tilbud**, og
handlekurven viser **Be om tilbud på disse varene** når alt i den er varer som sendes i posten og kjøpes én gang.

Et produkt du merker **Pris på forespørsel** i produktet, viser ingen pris noe sted og tilbyr bare tilbud, uansett denne innstillingen.
Se [Priser](/docs/owners/products/prices).

Kunden oppgir navn og e-post, og om de vil, telefon, firma og en melding. De får en e-post om at forespørselen er kommet inn.

### Svar på en forespørsel

Hver forespørsel blir et utkast merket **Tilbud ønsket**, og ansatte som får e-post om nye bestillinger, får beskjed. Under Utkast til
bestillinger viser filteret **Tilbudsforespørsler** dem.

1. Åpne forespørselen. Feltet **Tilbud ønsket** viser **Meldingen deres** og **Bedriften deres**, slik de skrev dem. For å fakturere
   bedriften legger du den inn med organisasjonsnummer under **Fakturaadresse og bedrift**.
2. Sjekk linjene. Et produkt med pris på forespørsel starter uten pris: skriv inn prisen for denne kunden. Listeprisen er bare en
   rettesnor. Tilbudet kan ikke sendes før hver linje har en pris.
3. Trykk **Send tilbud**. Kunden får en e-post med tilbudet og en lenke. Siden den åpner, er formulert som tilbudet deres, og knappen
   heter **Godta og betal**.

Når kunden betaler, er tilbudet godtatt, og bestillingen lages, som for alle utkast.

### Avslå en forespørsel

Trykk **Avslå forespørselen**, skriv **Svaret ditt til kunden** og trykk **Avslå og send svaret**. Kunden får svaret ditt på e-post.
Forespørselen kan ikke lenger sendes, og den slettes 30 dager senere.

> [!TIP]
> [KI-assistenten](/docs/owners/ai/the-ai-manager) kan liste opp forespørslene som venter, skrive inn prisene og avslå en med et kort
> svar. Den sender et tilbud eller et svar bare når du sier ja.

## Hva et utkast ikke gjør

- Kampanjer, rabattkoder, bonuspoeng og kontroll av mva-nummer gjelder ikke: prisene og rabatten er de du setter. Et utkast bruker
  aldri omvendt avgiftsplikt.
- En egen vare kan ikke selges til en privatkunde ennå. Lag utkastet for en bedrift, med bedriftens navn og organisasjonsnummer, eller
  legg tjenesten inn som et produkt.
- Leveringsadressen må være i markedets land.
- Nedlastinger, abonnementer og bookinger kan ikke være i et utkast.
- Et utkast har opptil 100 linjer, og en butikk kan ha opptil 500 åpne utkast.
