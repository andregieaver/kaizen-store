---
title: Se hvordan det går med butikken
summary: Les oversikten for en hvilken som helst periode, følg butikken akkurat nå, se fortjenesten under Økonomi og på hver ordre, gå dypere i kunder, produkter, lager, markedsføring, trafikk og hastighet, og gi fortjenesten det den trenger.
track: owners
section: analytics
kind: how-to
areas: [analytics, settings]
features: [shop]
plans: []
admin: /admin/{store}/analytics
order: 10
checked: 2026-11-04
sources: [D152, D178, D336, D347, D415]
---

## Åpne oversikten

Åpne **Analyse** i menyen. [Oversikt](/admin/{store}/analytics) svarer på tre spørsmål: tjener du penger, hvorfor endrer salget seg,
og er det noe å gjøre i dag? Hvert tall lenker til siden som forklarer det.

Alle beløp er i butikkens hovedvaluta ekskl. mva. Hvert tall regnes ut fra dine egne ordrer, aldri gjettet. Et tall som ikke kan være
kjent, vises aldri som 0: det står hva som mangler og hvordan du legger det inn.

### Velg perioden

Øverst trykker du **I dag**, **I går**, **Siste 7 dager**, **Siste 30 dager**, **Denne måneden**, **Forrige måned** eller **I år**. Vil
du ha andre dager, fyller du inn **Fra** og **Til** og trykker **Bruk perioden**.

Under **Sammenlign med** velger du **Forrige periode**, **Samme periode i fjor** eller **Ingen sammenligning** og trykker **Oppdater**.
Da viser hvert tall hvor mye det gikk opp eller ned. Perioden står i sidens adresse, så en lenke åpner den samme visningen.

### Hva oversikten viser

Ovenfra og ned:

- **Trenger deg i dag**: det som er verdt å se på nå, det mest presserende først. Se
  [varsler](/docs/owners/analytics/reports-targets-and-alerts).
- **Tjener vi penger?**: tolv tall. Salgsinntekt, Netto salgsinntekt, Ordrer, Konverteringsrate, Gjennomsnittlig ordreverdi,
  Bruttofortjeneste, Bruttofortjeneste i %, Nye kunder, Gjenkommende kunder, Andel tilbakebetalt, Besøk og Salgsinntekt per besøkende.
- **Hvorfor endret salget seg?**: endringen i salgsinntekt delt opp i trafikk, konvertering og gjennomsnittlig ordre, det stedet som
  endret seg mest (en enhet, en kanal, et land eller et produkt) og hvor du bør se videre. Med få ordrer står det at endringen kan være
  tilfeldig.
- **Salg og fortjeneste over tid**: netto salgsinntekt og dekningsbidrag per dag, uke eller måned. Den stiplede linjen er
  sammenligningen.
- **Fra besøk til kjøp**: hvor mange besøkende som ser på et produkt, legger i handlekurven, kommer til kassen og kjøper.
- **Bestselgere**: de fem produktene som ga mest, og de fem som ga mest igjen etter kostnaden.
- **Hvor salget kommer fra**: kanalene som ga mest salgsinntekt.
- **Mål** og **Prognose** for måneden: se [mål](/docs/owners/analytics/reports-targets-and-alerts).

Hvert diagram har en **Datatabell** med tallene. Hjem-siden viser de tre øverste punktene fra **Trenger deg i dag** under **Verdt å se
på i Analyse**, med **Se alt**.

> [!NOTE]
> **Salgsinntekt** er betalte ordrer ekskl. mva., etter rabatter, med fraktinntekter. Tilbakebetalinger er ikke trukket fra her.
> **Netto salgsinntekt** er salgsinntekten minus tilbakebetalingene gjort i perioden. Ubetalte ordrer telles ikke.

## Se hva som skjer akkurat nå

[Akkurat nå](/admin/{store}/analytics/live) leser tallene på nytt hvert 10. sekund mens siden er åpen:

- **Besøkende nå**: besøkende som åpnet en side de siste 5 minuttene, og **Hvor de besøkende er nå**, per land.
- **Besøk i dag**.
- **Ordrer i dag** og **Omsetning i dag**: betalte ordrer siden midnatt i butikkens tidssone, og omsetningen fra dem ekskl. mva.
- **Handlekurver i bruk**: handlekurver med noe i som er endret de siste 30 minuttene.
- **Kasser i gang**: ordrer som venter på betaling, lagt inn de siste 30 minuttene.

Tallene for besøkende krever [telling av besøk](#tell-besok). Mens den er slått av, står det det i stedet for 0.

## Fortjeneste

### Gi fortjenesten kostnadene dine

Fortjenesten må vite hva varene koster deg. I produktredigeringen har hver variant **Kostpris per enhet**, i hovedvalutaen og ekskl.
mva. Kostprisen lagres på hver ordrelinje når den selges, så en senere endring skriver aldri om tidligere salg.

- **Kostpris for alt salg**: fortjenesten er nøyaktig.
- **Kostpris for 30 % av salget eller mer**: fortjenesten anslås ut fra det salget, og hvert tall sier hvor stor del av salget det
  bygger på.
- **Kostpris for mindre enn 30 %**: ingen fortjeneste vises. Siden ber deg legge inn kostprisene som mangler.

### Økonomi

[Økonomi](/admin/{store}/analytics/finance) går steg for steg fra **Bruttosalg** til det som er igjen: rabatter, fraktinntekter,
refusjoner, varekostnad, betalingsgebyrer, plattformgebyrer, fraktkostnader, markedsføring og tapte tvister gir **Dekningsbidrag**, og
de faste kostnadene dine gir deretter **Driftsresultat (anslag)**. En linje som bygger på dine egne anslag, sier det. Betalingsgebyrene
er Stripes egne der Stripe har oppgitt dem, ellers anslaget ditt.

Økonomi viser også **Betalinger etter betalingsmetode**, inkl. mva., slik pengene gikk. Hva Stripe har betalt til banken din, står
under Utbetalinger, som er beskrevet i [utbetalinger og gebyrer](/docs/owners/payments/payouts-and-fees). Mva.-rapportene er beskrevet i
[OSS og IOSS](/docs/owners/markets-and-tax/oss-and-ioss).

### Fortjeneste på hver ordre

**Fortjeneste per ordre**, under Økonomi, viser periodens ordrer med fortjenesten i snitt, hvor mange som gikk med tap, og hvor mange
som venter på en kostpris. **Minst lønnsomme ordrer** lenker til hver av de ti dårligste.

Hver ordre har et eget kort, **Fortjeneste**, på ordresiden: det ordren ga deg etter varekostnad, betalingsgebyr, Kaizena Flows gebyr og
frakt, før annonser og faste kostnader. Frakten er prisen på en bestilt fraktetikett der den er kjent, ellers anslaget ditt. **Slik
regnes den** viser hver linje. Mangler en vare kostpris, er fortjenesten ikke kjent ennå, og **Legg inn kostpriser** tar deg dit.

## Gå dypere

Disse sidene har perioden og sammenligningen fra oversikten, unntatt Lager, som alltid viser hvordan det er nå.

| Side | Hva den viser |
|---|---|
| [Kunder](/admin/{store}/analytics/customers) | Nye og gjenkommende kunder, gjenkjøp, livstidsverdi, grupper (VIP, Lojale, Lovende, Nye, I faresonen, Tapte) og kohorter |
| [Produkter](/admin/{store}/analytics/products) | Hva som selger, hva som tjener, hva som betales tilbake, og hvert produkts andel av salget |
| [Lager](/admin/{store}/analytics/inventory) | Lageret og verdien av det, hvor mange dager det rekker, hva som snart går tomt og hva som ikke er solgt på 90 dager |
| [Markedsføring](/admin/{store}/analytics/marketing) | Kanaler med besøk, ordrer, salgsinntekt, konvertering, hva det koster å vinne en kunde (CAC) og avkastning på annonser (ROAS); annonsekostnader; rabatter og rabattkoder; kampanjer |
| [Abonnementer](/admin/{store}/analytics/subscriptions) | Faste månedlige inntekter og hvordan de endrer seg, frafall og fornyelser som feilet, mens Abonnementer er slått på |
| [Trafikk](/admin/{store}/analytics/traffic) | Veien fra besøk til kjøp, enheter, land og byer, søk, salg per ukedag og time, og refusjoner og returer nederst |

Under **Annonsekostnader** på Markedsføring legger du inn hva du har betalt for annonser: **Dag**, **Kanal**, **Kampanje (valgfritt)**,
**Beløp** ekskl. mva. og **Notat (valgfritt)**, og trykker **Legg til kostnad**. CAC og ROAS kommer bare fra det du legger inn. Ett beløp
lagres for hver dag, kanal og kampanje: legger du det inn igjen, erstattes det forrige.

Tabellene har **Last ned CSV** for dem som har en rolle som kan endre Analyse.

## Tell besøk

Besøk, konvertering, trakten, kanaler, enheter og hastighet krever telling av besøk. Den er slått av til en eier slår den på: åpne
[Innstillinger for analyse](/admin/{store}/analytics/settings) og trykk **Slå på telling av besøk** under **Telling av besøk**.

Hva som telles, slik siden sier det:

- Én linje per besøkende per dag, uten navn, kontaktopplysninger, IP-adresse eller nettleseropplysninger.
- Ingen informasjonskapsler og ingenting lagret i den besøkendes nettleser, så det vises ikke noe samtykkebanner.
- Den besøkende er en hashet id laget med en nøkkel som endres hver dag, så den besøkende kan ikke følges fra én dag til den neste. Id-en
  er ikke tilfeldig: den samme besøkende har den samme id-en resten av dagen.
- Roboter telles ikke, og heller ikke besøkende der nettleseren sender Global Privacy Control eller Do Not Track.
- Når noe legges i handlekurven samme dag, knyttes besøket til den handlekurven og til ordren som lages av den. Slik får et salg kanal
  og enhet.

> [!IMPORTANT]
> Mens tellingen er på, beskriver butikkens side om informasjonskapsler den på hvert av språkene dine. Nevn den i
> personvernerklæringen også, og at et besøk knyttes til en handlekurv og ordren: den teksten skriver du selv.

Tellingen starter den dagen du slår den på, og tidligere dager kan ikke fylles inn. Telte besøk slettes etter 25 måneder. Tellingen er
ikke sikret mot manipulering, så se nærmere på et plutselig hopp før du stoler på det.

## Hastighet

[Hastighet](/admin/{store}/analytics/speed) viser hvor raskt sidene lastes for dem som åpner dem, målt i nettleserne deres mens besøk
telles. For forsiden, produktsider, kategori- og stikkordsider, lister og andre sider, på telefon og på datamaskin, gir den fire tall
slik Google definerer dem: Largest Contentful Paint, Interaction to Next Paint, Cumulative Layout Shift og Time to First Byte. Tre av fire
sidelastinger de siste 28 dagene var like raske som tallet, eller raskere. Hvert tall får karakteren **Bra**, **Kan bli bedre** eller
**Dårlig**.

Et tall krever 20 sidelastinger. Med færre står det hvor mange det er. **Hva du bør se på først** sier hva som vanligvis gjør et tall
dårlig, og hvor du endrer det. Handlekurven, kassen og ordresidene måles aldri.

## Flere valg

### Innstillinger for analyse

Bare eiere åpner [Innstillinger for analyse](/admin/{store}/analytics/settings). I tillegg til telling av besøk og
[mål](/docs/owners/analytics/reports-targets-and-alerts) har siden:

- **Hva produktene koster**: hvor mange varianter til salgs som har en kostpris, med en lenke til produktene. **Bruk kostnadene på
  tidligere ordrer** gir ordrelinjer som ble solgt før varianten hadde en kostpris, den kostprisen varianten har i dag. Det gjøres én
  gang, med dagens kostpriser, og kan ikke angres i ett steg. En linje som allerede har en kostpris, endres aldri.
- **Gebyrer og kostnader vi ikke ser**: **Betalingsgebyr, prosent av hver ordre**, **Betalingsgebyr, fast beløp per ordre**,
  **Fraktkostnad per ordre** og **Faste kostnader per måned**, og deretter **Lagre anslagene**. De brukes bare i fortjenestetallene, som
  sier at de er anslått, og de endrer aldri en ordre. Det Kaizena Flow tar på hvert salg, er kjent nøyaktig og trenger ikke å legges inn.
- **Kundens levetid**: **År en kunde fortsetter å kjøpe**, mellom 1 og 10, for den beregnede livstidsverdien. Til du setter det, brukes
  3 år.

### Hvem som ser hva

Rollen til en i teamet trenger *Kan se* for Analyse for å åpne disse sidene, og *Kan endre* for å laste ned CSV-filer. Se
[ansatte og tilganger](/docs/owners/team-and-settings/staff-and-permissions).

Salgssidene er en del av nettbutikken. Er nettbutikken slått av under **Innstillinger**, **Funksjoner**, er bare Trafikk, Hastighet og
Innstillinger for analyse igjen.
