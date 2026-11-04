---
title: Fraktpriser
summary: Sett en fast fraktpris for hvert land, gjør den gratis over en handlekurvverdi, og legg til fraktmetoder priset etter vekt eller handlekurvverdi, med soner og profiler.
track: owners
section: shipping
kind: how-to
areas: [shipping, markets]
features: []
plans: []
admin: /admin/{store}/settings/shipping
order: 10
checked: 2026-11-04
sources: [D237, D402]
---

## Start med en fast fraktpris

Åpne **Innstillinger** i menyen og velg [Frakt](/admin/{store}/settings/shipping), under Salg. Under **Fast fraktpris per land** har hvert
land du selger til, en rad:

1. Skriv inn **Fraktpris**, inkl. mva.
2. Skal frakten være gratis fra en viss handlekurvverdi, skriver du den under **Gratis fra handlekurvverdi**. La feltet stå tomt for
   *Aldri gratis*.
3. Trykk **Lagre faste fraktpriser**.

Mange butikker trenger ikke mer. Den faste fraktprisen er standardprisen, og det som tas betalt når ingen av fraktmetodene dine passer
handlekurven. Abonnementer, abonnementsbokser og ordreutkast betaler alltid denne.

> [!IMPORTANT]
> Et land uten fast fraktpris har ingen egen frakt: en handlekurv som ingen fraktmetode priser der, kan ikke kjøpes. Behold en fast
> fraktpris for hvert land, også når du legger til fraktmetoder.

Alle priser under Frakt er inkl. mva., i landets valuta.

## Legg til fraktmetoder

Fraktmetoder er navngitte måter å sende på i ett land, som Standard og Ekspress, hver med sin egen pris.

1. Under **Fraktmetoder** trykker du på landet. [Fraktmetoder](/admin/{store}/settings/shipping/methods) åpnes for det.
2. Trykk **Legg til en fraktmetode**.
3. Under **Fraktmetoden** skriver du **Navn, slik kundene ser det**, og om du vil, en leveringstid i dager og en verdi under **Gratis
   over**.
4. Under **Priser** velger du hvordan den prises: **Fast**, **Etter vekt** eller **Etter handlekurvverdi**.
5. La **Tilbys i kassen** være krysset av og trykk **Legg til fraktmetode**.

Kundene ser fraktmetodene som priser handlekurven, billigst først, med leveringstiden når du har oppgitt en. Når ingen fraktmetode priser
handlekurven, tas den faste fraktprisen. Når to fraktmetoder koster det samme, vises den som står høyest i listen din, først: bruk
**Opp** og **Ned** for å endre rekkefølgen.

### Priser etter vekt eller handlekurvverdi

En fraktmetode priset **Etter vekt** eller **Etter handlekurvverdi** har trinn. Hvert trinn gjelder fra sitt **Fra** og opp til, men ikke
med, sitt **Opp til**; la det siste trinnets **Opp til** stå tomt for *og over*. Trinnene følger etter hverandre uten opphold. Vekt skrives
i kilo, som 2 eller 0,5. Trykk **Legg til et trinn** for et nytt.

**Gratis over** sammenlignes med handlekurvens verdi slik den vises, før rabatter.

Varer uten egen vekt regnes med **Standardvekt** per enhet, 500 g til du endrer den nederst under Frakt. Oversikten varsler når varianter
mangler vekt.

## Soner: andre priser for deler av et land

En sone er en gruppe postnumre i et land, slik at en fraktmetode kan koste mer til noen steder enn til andre.

1. Åpne Frakt og trykk **Soner**, og velg landet.
2. Under **Legg til en sone** skriver du et **Navn** og **Postnumre og prefikser**: postnumre som 0150, eller prefikser som 01* for alle
   postnumre som begynner på 01, skilt med komma, mellomrom eller linjer. Et tallområde skrives som prefikser: 015* til 019* for 0150 til
   0199.
3. Trykk **Legg til sone**.
4. Åpne hver fraktmetode og gi sonen en pris. En fraktmetode uten pris for en sone tilbys ikke der.

Postnumre som ikke er i noen sone, er *Resten av landet*. Et postnummer hører til sonen med det mest presise mønsteret. **Sjekk et
postnummer** viser hvilken sone et postnummer er i, og hvilke fraktmetoder som har en pris der.

I et land med soner oppgir kundene postnummeret før de betaler, og handlekurven viser *Fra* en pris til de har gjort det. Viser det seg at
leveringsadressen har et annet postnummer enn det som ble priset, står det på bestillingen, så du kan sjekke leveringen før du sender;
beløpet endres aldri. I listen over bestillinger finner du disse under **Forsendelse** i filtrene, med *Postnummeret stemmer ikke med
adressen*.

## Profiler: egne priser for noen produkter

En profil samler produkter som sendes annerledes, som store eller skjøre varer, slik at de får egne priser på hver fraktmetode.

1. Åpne Frakt og trykk **Profiler**.
2. Under **Legg til en profil** skriver du et **Navn** og trykker **Legg til profil**.
3. Velg produktene, ved å søke, og trykk **Lagre profil**. Du kan også velge profilen til et produkt i produktredigeringen.
4. Åpne hver fraktmetode og gi profilen en pris.

Alle andre produkter er *Generelt*. En handlekurv med produkter fra flere profiler får bare tilbud om en fraktmetode når hver av dem har en
pris på den, og betaler summen av prisene.

## Flere valg

### Endre leveringspriser med regler i kassen

En [regel i kassen](/admin/{store}/settings/checkout) kan **Prissett leveringsvalg** når handlekurven passer det du velger: landet,
verdien eller vekten, produktene, kategoriene eller merkene, eller kundegruppen. Valgene den nevner, blir **Gratis**, eller koster **En
prosent mer eller mindre** (fra −100 til 300) eller **Et beløp mer eller mindre**, skrevet i hver valuta butikken viser.

- Et negativt tall senker prisen. En levering koster aldri mindre enn ingenting, og en som er gratis over en handlekurvverdi, forblir
  gratis.
- Andre regler kan skjule et leveringsvalg, gi et nytt navn eller vise noen først.
- Nye regler lagres avslått: slå en på når den er riktig. Handlekurven og kassen tar da samme pris, og bestillingen tar vare på regelen.

Åpne **Innstillinger** og velg **Regler i kassen**, under Salg.

### Bør sees på

Øverst under Frakt står det du bør se på, under **Bør sees på**: et land med fraktmetoder men uten fast fraktpris, soner der ingen
fraktmetode priser *Resten av landet*, abonnementer uten fast fraktpris å betale, og varianter uten vekt.

### Henting, lokal levering og fraktselskaper

- [Henting og lokal levering](/docs/owners/shipping/pickup-and-local-delivery): la kundene hente selv, eller lever i nærheten selv.
- [Fraktselskaper](/docs/owners/shipping/carriers): tilby Posten / Bring, PostNord, Porterbuddy eller Helthjem i kassen.
