---
title: Rapporter, mål og varsler
summary: Åpne en ferdig rapport eller lag og lagre din egen, last den ned eller få den på e-post, sett mål og les prognosen, og velg hvem som får analysevarsler og statusrapporten med ettrykkshandlingene.
track: owners
section: analytics
kind: how-to
areas: [analytics, settings]
features: [shop]
plans: []
admin: /admin/{store}/analytics/reports
order: 20
checked: 2026-11-04
sources: [D238, D345, D346, D348, D395, D415, D416]
---

## Åpne en ferdig rapport

Åpne **Analyse** og velg [Rapporter](/admin/{store}/analytics/reports). Under **Ferdige rapporter** trykker du på én: Salg per
produkt, Salg per variant og varenummer, Salg per kategori, Salg per land, Salg per valuta, Salg per betalingsmåte, Salg per kanal, Salg
per dag, Nye og gjenkjøpende kunder eller Rabattkoder. Den åpnes med en gang, og du kan endre den og lagre den.

Rapportene du har lagret, ligger under **Dine rapporter**.

## Lag din egen rapport

Trykk **Ny rapport**. Under **Lag rapporten**:

1. **Tall**: opptil seks av Salgsinntekt, Brutto varesalg, Rabatter, Refusjoner, Ordrer, Solgte enheter, Gjennomsnittlig ordreverdi,
   Kunder, Bruttofortjeneste og Merverdiavgift.
2. **Fordelt på**: opptil to av Dag, Uke, Måned, Kvartal, Produkt, Variant, Kategori, Stikkord, Produkttype, Land, Valuta, Kanal,
   Enhet, Rabattkode, Betalingsmåte eller Ny eller gjenkjøpende. **Ingenting: én sum** gir én rad. Ved en fordeling som ikke passer
   til tallene du har valgt, står det *Ikke med tallene som er valgt*.
3. **Bare der**: trykk **Legg til et filter**, velg hva du filtrerer på, og skriv verdiene, skilt med komma.
4. **Periode** og **Sammenlign med**, som i oversikten.
5. **Sorter etter**, **Rader** (opptil 500) og **Vis som**: **Tabell**, **Søyler** eller **Linje**.

Trykk **Vis**. Tabellen slutter med en **Sum**. Med en sammenligning har hvert tall også sin *Før*.

> [!NOTE]
> Beløpene er betalte ordrer ekskl. mva., i hovedvalutaen, regnet ut som på analysesidene, så summen i en rapport stemmer med siden
> tallet kommer fra. Når én ordre eller kunde kan være i flere rader, for eksempel en ordre med to rabattkoder, summeres ikke kolonnen
> til summen, og rapporten sier det. Bruttofortjeneste krever kostpriser: med kostpris for mindre enn 30 % av salget står det *Ikke
> kjent*.

### Lagre, del og last ned

- Under **Lagre rapporten** gir du den et **Navn** og trykker **Lagre rapporten**. Vil du beholde den du åpnet som den var, krysser du
  av for **Lagre som en ny rapport** først.
- **Slett rapporten** fjerner en lagret rapport. Tallene berøres ikke. En butikk kan ha 200 rapporter.
- **Last ned CSV**, under tabellen, gir deg hele tabellen som en fil.
- Adressen til rapporten inneholder alt den viser, så du kan sende lenken til noen i teamet.

For å lagre og laste ned trenger du en rolle som kan endre Analyse.

Du kan også spørre KI-assistenten om tall med dine egne ord. Den svarer ut fra de samme rapportene og kan lagre en for deg.

## Få en rapport på e-post jevnlig

Åpne en lagret rapport. Under **Send rapporten på e-post**:

1. **Hvor ofte**: **Hver dag**, **Hver uke** (velg dagen under **På**) eller **Hver måned** (velg **Dag**, fra 1 til 28).
2. **Klokken**: timen, etter butikkens klokke.
3. **Til**: kryss av for hvem som skal få den, høyst 10. Bare personer som kan lese analyse, står i listen.
4. La **Send den** være krysset av og trykk **Lagre utsending**.

Hver e-post har tallene for rapportens egen periode slik de er den dagen den sendes: de 25 første radene og summen, med hele tabellen
vedlagt som en CSV-fil. Hver person får den på sitt eget språk i administrasjonen. **Slutt å sende den** avslutter utsendingen. En
butikk kan sende opptil 10 rapporter på e-post.

## Mål

### Sett et månedsmål

Eiere setter mål under [Innstillinger for analyse](/admin/{store}/analytics/settings). Under **Mål for salgsinntekt** velger du
**Måned**, skriver **Mål for netto salgsinntekt** og trykker **Lagre målet**. Netto salgsinntekt er salget etter rabatter og
tilbakebetalinger, ekskl. mva. En måned som allerede har et mål, får det nye. **Mål for de neste 12 månedene** viser dem, hvert med
**Fjern**.

### Mål for ordrer, konvertering og mer

Under **Mål for ordrer, konvertering og mer**:

1. **Hva du sikter mot**: Nettosalg, Ordrer, Konverteringsrate eller Gjennomsnittlig ordreverdi.
2. **Periode**: **Uke** (mandag til søndag), **Måned**, **Kvartal** eller **Dager jeg velger**, opptil to år.
3. **En dag i perioden**, eller for dager du velger, **Første dag** og **Siste dag**.
4. **Mål**, og deretter **Lagre målet**.

KI-assistenten kan også sette og vise mål.

### Følg et mål

I oversikten viser **Mål for** inneværende måned netto salgsinntekt hittil denne måneden mot målet, uansett hvilken periode du har
valgt. **Mål som løper nå** viser alle andre mål der perioden omfatter i dag.

- **Nettosalg og ordrer** holdes mot det som var ventet innen i dag. *Forventet innen i dag* følger de vanlige travle og rolige
  ukedagene dine når det finnes fire uker med historikk; til da teller alle dager likt. Kortet sier **Foran tempoet**, **I rute** eller
  **Bak tempoet**, og hvor perioden ender hvis tempoet holder seg, som et anslag. De tre første dagene er det ingen dom ennå.
- **Gjennomsnittlig ordreverdi** og **konverteringsrate** holdes mot selve målet. Gjennomsnittlig ordreverdi krever 10 betalte ordrer før
  en dom, og konvertering 300 besøk. Konverteringen er ikke kjent hvis ikke besøk ble telt hver dag i perioden.

### Prognosen

**Prognose for** inneværende måned, i oversikten, viser hvor månedens netto salgsinntekt er på vei hvis tempoet fra de siste ukene
holder seg, med et sannsynlig spenn. Den bruker de siste åtte ukene, de vanlige ukedagene dine og, når det finnes et år med historikk,
fjorårets mønster. Månedens betalte ordrer får en prognose på samme måte. En jevn økning eller nedgang forlenges ikke, og prognosen sier
alltid at den er et anslag. Med færre enn 14 dager med salg står det at det er for lite historikk. Med et månedsmål sier den om spennet
når målet.

## Varsler

**Trenger deg i dag**, i oversikten, viser det analysene fant, det mest presserende først. Hvert varsel er merket **Haster**, **Bør
sees på**, **Greit å vite** eller **Gode nyheter**:

- konverteringen faller, salgsinntekten hittil i dag ligger langt under en vanlig dag med samme ukedag (bedømt fra kl. 20), et produkt
  får tilbakebetalinger på over det dobbelte av det vanlige, en ny kunde koster mer i en kanal, et produkt blir utsolgt innen en uke,
  flere kasser blir ikke fullført, andelen ordrer med rabatt øker måned etter måned, månedens mål står i fare, og produktkostnader
  mangler;
- de gode nyhetene: i går var den beste dagen på 90 dager, eller gjenkommende kunder ga mer enn i noen av de siste 12 månedene.

Hver type krever nok ordrer eller besøk først, så noen få salg gir ikke et varsel. Lenken ved et varsel åpner der du bør se. **Tallene
bak** viser hva varselet er regnet ut fra.

Ved noen varsler er det ett steg til, med arbeidet gjort klart:

- **Forbered innkjøp**, når noe snart blir utsolgt: en innkjøpsordre fylt ut ut fra salget den siste tiden.
- **Lag en kampanje**, når gjenkommende kunder ligger på topp: en markedsførings-e-post fra takkemalen.
- **Spør KI-assistenten**: KI-assistenten åpnes med varselets ord og tall som spørsmålet ditt. Spørsmålet ber om et neste steg, og om
  å holde av alle endringer til du sier ja.

En innkjøpsordre lagres, eller en kampanje sendes, først når du trykker på den sidens egen knapp.

### Varsler på e-post

Eiere velger hvem som får dem, under **Innstillinger**, **Varsler**, [Varsler til ansatte](/admin/{store}/settings/notifications/staff):

1. Under **Hvem som får e-post** krysser du av for **Analysevarsler** for hver person. Boksen tilbys bare der personens rolle kan lese
   analyse.
2. Under **Analysevarsler på e-post** velger du **Bare det som haster**, **Det som haster og advarsler** eller **Alt unntatt gode
   nyheter**.
3. Trykk **Lagre**.

Varslene sendes én gang om dagen, etter kl. 20 butikkens tid, hvert varsel én gang per dag, med de samme minstegrensene som siden.
Gode nyheter sendes aldri på e-post. Ingen får dem før du krysser av for dem.

## Statusrapporten

Statusrapporten er en daglig eller ukentlig e-post om butikken. Hjem-siden tilbyr den én gang til en eier, under **Få en statusrapport
på e-post**: trykk **Ukentlig** eller **Daglig**, eller **Ikke nå**.

For å velge hvem som får den og når, åpner du [Varsler til ansatte](/admin/{store}/settings/notifications/staff). Under
**Statusrapport** velger du **Hvor ofte**: **Av**, **Daglig (i går)** eller **Ukentlig (de siste sju dagene)**, deretter **Dag** for en
ukentlig rapport og **Klokkeslett**, etter butikkens klokke. Kryss av for **Statusrapport** for hver person, og trykk **Lagre**.

Den inneholder:

- betalte bestillinger og nettosalg ekskl. mva., hvert ved siden av perioden før, refusjoner og **Fortjeneste før faste kostnader,
  ekskl. mva.** Fortjenesten er merket *anslått* der den bygger på anslag, og utelates så lenge for lite av salget har kostpris;
- meldte og åpne returer, bestillinger som skal sendes, varianter på eller under lagernivået sitt og samtaler som venter i kundestøtten;
- det analysene fant, det butikksjekken fant, og målene dine;
- en merknad skrevet av KI ut fra disse fakta, når butikken har en KI-tekstmodell. Den oppgir ingen tall: sjekk før du handler.

En stille periode, uten betalte bestillinger og uten varsler, gir ingen e-post.

Hvert funn lenker til siden som tar seg av det. Der det finnes et, har det det samme neste steget som i oversikten: **Forbered
innkjøp**, **Lag en kampanje** eller **Spør KI-assistenten**, som åpner hjem-siden med KI-assistenten. Ingen innkjøpsordre lagres og
ingen kampanje sendes fra selve e-posten.

Andre e-poster til ansatte, som nye bestillinger og lavt lager, velges på samme side: se
[varsler](/docs/owners/team-and-settings/notifications).
