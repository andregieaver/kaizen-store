---
title: Fakturaer og kreditnotaer
summary: Alle betalte bestillinger får en faktura og alle tilbakebetalinger en kreditnota, laget for deg. Finn dem, rett det som får en til å vente, sett nummereringen, og gi regnskapsføreren en CSV eller en e-faktura.
track: owners
section: orders
kind: how-to
areas: [orders, tax]
features: [shop]
plans: []
admin: /admin/{store}/invoices
order: 60
checked: 2026-11-04
sources: [D159, D403, D174, D173, D239]
---

## Laget for deg

Når en bestilling er betalt, utsteder Kaizena Flow fakturaen i butikkens egen nummerserie. Når en tilbakebetaling går gjennom, utstedes
en kreditnota i en egen serie. Du lager dem aldri for hånd, og når de er utstedt, kan de ikke endres eller slettes. I en ny butikk er
dette på fra starten.

Kunden finner fakturaen på bestillingssiden sin og i e-postene om bestillingen: ordrebekreftelsen har den med, og PDF-en legges ved når
den er klar. Fakturaer hører til nettbutikken, som slås på under Innstillinger, Funksjoner.

> [!NOTE]
> Dette er ikke skatte- eller regnskapsrådgivning. La regnskapsføreren din lese noen av fakturaene før du stoler på dem.

## Finn en faktura

Åpne **Fakturaer** i menyen, under Bestillinger. [Fakturaer](/admin/{store}/invoices) har tre faner: **Fakturaer**, **Kreditnotaer** og
**Venter**. Søk på nummer, bestilling eller e-post, og velg en periode med **Fra** og **Til**. **Vis** åpner et dokument, og **PDF**
laster det ned.

På siden til en bestilling viser **Faktura og kreditnotaer** dokumentene for den bestillingen, med **Vis**, **PDF**, **E-faktura (XML)**
og **Send til kunden på nytt**.

## Når en faktura venter

En betalt bestilling venter på fakturaen når noe fakturaen må inneholde, mangler. Fanen **Venter** viser hver bestilling med grunnen:

- **Firmaopplysninger mangler**: for eksempel virksomhetens juridiske navn, postadresse eller organisasjonsnummer.
- **Avgiftsprofil mangler**: det er ikke lagret om butikken er registrert i Merverdiavgiftsregisteret.
- **Merverdiavgift tatt, butikken er ikke registrert i Merverdiavgiftsregisteret**.
- **Ingen valutakurs**: for en bestilling i en annen valuta enn din egen.

Betalingen holdes aldri tilbake. Trykk **Rett det** for å komme dit årsaken rettes. Fakturaen lages da innen fem minutter, eller med en
gang med **Sjekk igjen**. Den dateres den dagen og oppgir fortsatt betalingsdagen som leveringsdato.

## Kreditnotaer

Hver tilbakebetaling som går gjennom, får en kreditnota, uansett hvor den ble gjort: på bestillingen, fra en retur eller direkte i
Stripe. En kreditnota er aldri større enn det fakturaen har igjen for hver mva-sats.

- **En endret bestilling** får en kreditnota for det som tas av, og en tilleggsfaktura for det som legges til, begge med henvisning til
  den opprinnelige fakturaen.
- **Et bytte** gir den opprinnelige bestillingen én kreditnota for varene som returneres, og den nye bestillingen sin egen faktura.
- **En bestilling betalt utenfor Kaizena Flow** faktureres også: fakturaen sier at den ble betalt utenom nettkassen.

## Innstillinger

Eiere setter opp fakturering under [Innstillinger, Fakturering](/admin/{store}/settings/invoices).

- **Lag en faktura for hver betalt bestilling** slår fakturering av eller på. Det gjelder fra det øyeblikket det er på: bestillinger
  betalt før faktureres aldri i ettertid. **Før du slår på**, på samme side, viser hva en faktura fortsatt trenger.
- **Send fakturaen med ordrebekreftelsen** er på som standard. Fakturaen står alltid på kundens bestillingsside, uansett hva du velger.
- **Merknad på hvert dokument**: ren tekst som skrives nederst på hver faktura og kreditnota, for eksempel bankopplysningene dine. Den
  oversettes ikke.
- **Fakturanumre** og **Kreditnotanumre**: et **Prefiks** og et **Første nummer**, til den første er utstedt. For å fortsette fra et annet
  system setter du nummeret etter det siste du brukte der. Utstedte numre kan ikke endres, hoppes over eller fjernes.

Mens Kaizena Flow lager fakturaene dine, brukes ikke Stripes egen faktura for bestillinger, så en kunde får aldri to.

## Til regnskapsføreren

### CSV-filen

På fanen **Fakturaer** eller **Kreditnotaer**, under **CSV til regnskapsføreren**, velger du første og siste dag og trykker **Last ned
CSV**. Du får én rad for hvert dokument i perioden: nummer, datoer, bestilling, kjøperens navn, land og mva-nummer, beløpene,
merverdiavgiften for hver sats, og merverdiavgiften i din egen valuta der dokumentet har den. Filen inneholder personopplysninger, så
oppbevar den trygt; hver nedlasting logges. En fil tar opptil 20 000 dokumenter, og bare medlemmer som kan endre bestillinger, kan laste
den ned.

For et regneark over selve bestillingene, linje for linje, kan eieren trykke **Eksporter** på Bestillinger. Tall for mva. og OSS finner
du under **Analyse**: se [Merverdiavgift](/docs/owners/markets-and-tax/vat).

### E-faktura

Hver faktura og kreditnota kan også lastes ned som e-faktura: en XML-fil i EUs standardformat EN 16931 (UBL, med reglene i Peppol BIS
Billing 3.0). Trykk **E-faktura (XML)** på siden til bestillingen, og gi filen til en kjøper eller et system som leser e-fakturaer. Apper
henter den samme filen gjennom Admin-API-et.

Kaizena Flow sender ikke e-fakturaer gjennom Peppol-nettverket: du gir filen videre selv. Mangler et dokument noe formatet krever, som
kjøperens land eller mva-nummeret ditt der det er beregnet merverdiavgift, får du grunnen i stedet for en fil.

## Det som ikke får faktura

- Bestillinger betalt i Stripes testmodus.
- Bestillinger betalt mens fakturering var av.
- Bestillingshistorikk hentet inn fra en annen butikk.

Dokumentene skrives på norsk, svensk, dansk eller engelsk, etter bestillingens språk; andre språk får engelsk. Din egen layout og logo,
korrigerende fakturaer og kreditnotaer laget for hånd finnes ikke.
