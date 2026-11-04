---
title: Design og temaer
summary: Endre farger og skrifttyper i butikken, prøv et annet tema på dine egne sider før besøkende ser det, og bytt når du er klar.
track: owners
section: website
kind: how-to
areas: [website, themes]
features: []
plans: []
admin: /admin/{store}/settings/design
order: 20
checked: 2026-11-04
sources: [D59, D60, D99, D100, D241, D243, D244, D245, D247, D256, D273, D286, D306, D340, D344, D385]
---

## Butikkens utseende

Åpne **Nettsted** i menyen og velg [Design](/admin/{store}/settings/design). Utseendet på butikken er et tema: farger, skrifttyper,
knapper og hjørner, lyst og mørkt, en topptekst, en bunntekst, oppsettet for produktsiden og nettstedets CSS. Sidene du bygger, bruker
det også.

Et tema inneholder aldri innholdet ditt. Når du endrer eller bytter tema, røres aldri produktene, sidene, tekstene, bildene, videoene,
menyene, logoen eller firmaopplysningene dine.

## Endre farger og skrifttyper

Lenger ned på Design ligger innstillingene for temaet du har i bruk, i grupper. Endre det du vil; forhåndsvisningen ved siden av viser
det med en gang:

- **Farger**: bakgrunnen, teksten, aksenten (knapper og fremhevinger) og resten, for lyst og for mørkt.
- **Skrifttyper**: én for **Overskrifter** og én for **Brødtekst**. Trykk **Endre** for å velge en hvilken som helst skriftfamilie fra
  Google Fonts.
- **Knapper og hjørner**, **Oppsett** (sidebredden og toppteksten), **Produktkort** og, i en nettbutikk, **Kassens utseende**: hvordan
  Stripes betalingsskjema får fargene, skrifttypen og hjørnene dine.

Trykk deretter **Lagre**. Butikken viser endringene med en gang.

Er en tekst vanskelig å lese på fargen sin, sier en advarsel under **Farger** hvilken det gjelder, og hvor langt den er fra 4,5:1, som er
det du bør sikte mot.

Skrifttypene kopieres til Kaizena Flow når du velger dem, og lastes fra ditt eget nettsted, så de besøkendes nettlesere aldri kontakter
Google.

> [!TIP]
> Ikke fornøyd med det du lagret? **Versjoner** viser de tidligere utseendene til butikken, de 50 nyeste. **Bruk denne versjonen**
> legger et av dem tilbake i redigeringen; butikken endres først når du lagrer. **Tilbakestill til …** starter på nytt fra temaets egne
> innstillinger.

## Lyst og mørkt

Under **Farger** velger du under **Lyst og mørkt** hvordan butikken ser ut: **Følg den besøkendes enhet**, **Alltid lyst** eller **Alltid
mørkt**. Hvert valg har sine egne farger.

Kryss av for **La besøkende velge lyst eller mørkt** for å få en knapp i toppteksten som bytter til de andre fargene, og som den
besøkendes nettleser husker. En topptekst du har bygget selv, trenger komponenten *Lyst eller mørkt* for dette.

Er logoen din mørk, legger du til en lys utgave for mørke bakgrunner under
[Topptekst og bunntekst](/docs/owners/website/menus-header-and-footer).

## Prøv et annet tema

**Legg til et tema** viser Kaizena Flows temaer. Variantene til et tema vises som egne utseender (*Tema · Variant*): det samme temaet med
egne farger, skrifttyper og knapper.

1. Trykk **Forhåndsvis** for å se et tema i et nytt vindu.
2. Trykk **Legg til i temaene mine**. Temaet havner i **Temabibliotek** uten å tas i bruk: besøkende ser ingenting av det.
3. Trykk **Tilpass** på det i temabiblioteket. Der kan du se det med **Forhåndsvis på sidene dine**, lese **Hva endres** for sidene og
   oppsettene dine, endre innstillingene og redigere toppteksten, bunnteksten og produktsiden.
4. Når det er klart, trykker du **Bytt til «…»**. Temaet tas i bruk med en gang.

Temaet du bytter bort fra, blir liggende i biblioteket med alle endringene du har gjort i det, så du kan bytte tilbake med **Bytt til**.
**Fjern** tar et tema du ikke lenger vil ha, ut av biblioteket.

**Se alle temaene i temabutikken** åpner Kaizena Flows [temabutikk](/themes). På et temas side der legger *Har du allerede en nettbutikk?
Legg temaet til i nettbutikken din* temaet i biblioteket til en av butikkene dine, uten å ta det i bruk.

> [!NOTE]
> **Ta i bruk** på et tema under Legg til et tema tar det i bruk med en gang. Først sier det nøyaktig hva som endres: temaets topptekst,
> bunntekst og produktside legges til som nye sider og brukes (dine egne blir liggende, uten å være valgt), og butikkens egen CSS
> erstattes. Utseendet du hadde, blir liggende i temabiblioteket.

### Premiumtemaer

Et tema merket *Premium* har en pris, som vises før du godtar den. Det koster ingenting å legge det til for å prøve. Før butikken åpner,
betales ingenting før den åpner med temaet i bruk; når butikken er åpen, belastes prisen én gang gjennom faktureringen din hos Kaizena
Flow når du bytter til temaet.

### Bytt på et bestemt tidspunkt

På siden **Tilpass** for et tema tar **Ta det i bruk senere** temaet i bruk til et tidspunkt etter butikkens klokke, og kan sette temaet
fra før tilbake på et annet tidspunkt. Det virker når butikken er åpnet. Et premiumtema butikken ikke har ennå, må du ta i bruk selv én
gang først.

## Flere valg

### Temaoppdateringer

Når Kaizena Flow publiserer en ny versjon av et tema du har installert, kan det oppdatere seg selv eller vente på deg: velg under **Slik
oppdateres hvert tema**. En oppdatering beholder dine egne innstillinger og din egen CSS. En topptekst, bunntekst eller produktside du har
redigert, forblir din, med den nye lagt til som utkast ved siden av. **Oppdater nå** oppdaterer et tema som venter, og en oppdatering kan
angres en stund etterpå.

### La sidene følge temaet

Sider som ble laget før temaer kunne byttes, kan gjenta innstillinger fra temaet, som størrelsen på en overskrift. Trykk **Tell
innstillingene** og deretter **La sidene følge temaet**: hver side ser ut akkurat som før, og følger fra da av temaet du bytter til.
Innstillinger som skiller seg fra temaet, er dine og blir stående.

### Din egen CSS

I sidebyggeren åpner **Egen CSS** i linjen nederst et panel med to faner:

- **Denne siden**: bare på denne siden, lagres med den og blir synlig når du publiserer.
- **Hele nettstedet**: på alle sider i butikken, også toppteksten og bunnteksten. Den blir synlig når du trykker **Lagre CSS for hele
  nettstedet**, ikke sammen med siden.

Gi deler stil med id-ene og klassene du gir dem under **Avansert** i innstillingene deres. Bilder og skrifter kan bare komme fra ditt
eget nettsted eller mediebiblioteket. Hver CSS kan ha opptil 50 000 tegn. **Versjoner** i panelet tar vare på de 50 siste lagringene av
CSS-en for hele nettstedet.

Er du logget inn, åpner **Egen CSS** ved siden av **Rediger tekst** på nettstedet det samme panelet over siden.

Et installert tema som ikke er i bruk, har sin egen CSS, under **Egen CSS** på siden Tilpass.

### Del utseendet ditt som et tema

**Del dette utseendet som et tema** tilbyr butikkens utseende til andre Kaizena Flow-butikker, gratis, i temabutikken. Kaizena Flow går
gjennom det først. Produktene dine deles aldri, og sidene dine bare hvis du velger å sende dem.
