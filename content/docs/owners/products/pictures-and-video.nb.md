---
title: Bilder, videoer og 3D
summary: Legg bilder, videoer og 3D-modeller på et produkt, beskriv dem for kunder som ikke kan se dem, og hold orden i mediebiblioteket.
track: owners
section: products
kind: how-to
areas: [products, website]
features: [shop]
plans: []
admin: /admin/{store}/products/{productId}
order: 50
checked: 2026-11-04
sources: [D84, D88, D89, D213, D325, D349, D413]
---

## Legg bilder på et produkt

Åpne produktet og finn **Bilder og videoer**. Trykk **Legg til bilder** og velg én eller flere filer. Store filer går fint: hvert
bilde gjøres mindre i nettleseren før det lastes opp, høyst 1600 piksler bredt, til det er så lite det kan bli mens det fortsatt ser
likt ut. Bare resultatet forlater nettleseren din.

- **Det første elementet er det kundene ser** i lister, i handlekurven og i produktfeedene dine. Trykk **← Fram** eller **Bak →**
  for å endre rekkefølgen.
- **Fjern** tar et element av produktet. Filen blir liggende i mediebiblioteket.
- Trykk **Lagre** for å beholde endringene.

Et produkt kan ha opptil 20 elementer, av dem opptil 5 videoer og 3 3D-modeller. Det står under kortet i redigeringen.

## Beskriv hvert bilde

Under hvert bilde fyller du inn **Beskriv bildet** med noen få ord: hva det viser, for kunder som bruker skjermleser, og for
søkemotorer. Står feltet tomt, brukes produktets tittel.

Selger butikken på flere språk, åpner du **På andre språk** under bildet og skriver beskrivelsen på hvert av dem. Et språk som står
tomt, bruker produktets tittel på det språket. Disse ordene står også i [Oversett butikken](/admin/{store}/translate) sammen med de
andre tekstene dine.

## Legg til en video

Trykk **Legg til en video**, og gjør ett av to:

- **Last opp en video**: en MP4- eller WebM-fil på opptil 50 MB. Den komprimeres i nettleseren, til høyst 1080p, og et bilde fra
  videoen vises før den spilles av.
- **Eller lim inn en adresse fra YouTube eller Vimeo**, velg **Bildet som vises før den spilles av**, og trykk **Legg til videoen**.
  Ingenting hentes fra YouTube eller Vimeo.

På produktsiden starter en video aldri av seg selv: kunden trykker på avspilling. En video fra YouTube eller Vimeo lastes først da.
Skriv noen ord under **Beskriv videoen**.

## Legg til en 3D-modell

Åpne **Mer** og trykk **Legg til en 3D-modell**. Velg **Modellen (GLB-fil)**, opptil 20 MB, og **Bildet som vises før den åpnes**,
og trykk **Legg til modellen**. Eksporter modellen fra 3D-programmet ditt som GLB: en glTF består av flere filer og avvises.

Kundene ser bildet med **Vis i 3D**. Trykker de på den, lastes modellen, og de kan snu den ved å dra og zoome ved å knipe eller rulle.
Fyll inn **Beskriv hva modellen viser**.

## Gi en variant sitt eget bilde

Finnes produktet i flere valg, har hver variant under **Pris og lager** en liten rute ved siden av navnet. Trykk på den og velg et av
produktets bilder, eller **Last opp et bilde**. Når en kunde velger den varianten, viser galleriet bildet først.

## Mediebiblioteket

Alt du laster opp hvor som helst i administrasjonen, blir liggende i mediebiblioteket: åpne **Nettsted** og velg
[Medier](/admin/{store}/media).

- Med **Legg til filer** slipper du inn bilder (JPEG, PNG, WebP, AVIF eller GIF) og videoer (MP4 eller WebM), så mange du vil på én
  gang. Hver fil komprimeres i nettleseren først.
- **Søk i biblioteket** finner filer etter navn eller alternativ tekst, og, når KI-en din er satt opp for det, etter hva et bilde
  viser.
- Åpner du en fil, ser du hvor den brukes. Der kan du trykke **Kopier adressen** eller **Last ned**, eller skrive den alternative
  teksten.
- **Slett** fjerner en fil. Bekreftelsen viser alle steder som bruker den: et bilde der viser ingenting før du velger et annet.
  Sletting kan ikke angres.

Vil du rydde bort gamle filer, trykker du **Velg filer**, så **Velg de som ikke er i bruk**, og sletter dem samtidig.

### Alternative tekster

Et bildes **Alternativ tekst** i biblioteket vises der bildet ikke har en beskrivelse selv, for eksempel på en variants bilde eller
et bilde på en side. Skriv den og trykk **Lagre alternativ tekst**, eller trykk **Skriv med KI**.

Har KI-en din en modell som ser bilder, skriver **Skriv manglende alternative tekster med KI** en tekst for hvert bilde som mangler,
på alle nettstedets språk, og nye bilder får sin innen noen minutter. En kjøring for alle bildene beholder tekstene de ansatte har
skrevet.

## Gjør eldre filer mindre

Filer som ble lastet opp før Kaizena Flow komprimerte dem, kan fortsatt gjøres mindre. Under **Komprimer filer** står det hvor mange
som venter; trykk på knappen for å komprimere alle, eller åpne én fil og trykk **Komprimer**. Hver fil gjøres så liten den kan bli
mens den fortsatt ser lik ut, i nettleseren din, og alle steder som bruker den, flyttes over til den mindre filen.

## Fjern bakgrunnen

Åpne et bilde i mediebiblioteket. Under **Rediger med KI** velger du **Fjern bakgrunnen** og trykker **Rediger bildet**. Det tar
opptil ett minutt. Resultatet blir et nytt bilde i biblioteket; originalen er som den var. **Ny bakgrunn** og **Endre noe** virker på
samme måte, med noen ord fra deg.

I sidebyggeren har hvert bildefelt med et bilde **Fjern bakgrunnen** ved siden av **Lag med KI**.

Redigering av bilder krever en modell som redigerer bilder, valgt i butikkens KI-innstillinger. Til da sier biblioteket det, med en
lenke.

> [!TIP]
> Produktredigeringen legger til bilder fra datamaskinen din. Vil du bruke et redigert bilde på et produkt, trykker du **Last ned**
> på det i biblioteket og legger det til under **Bilder og videoer**.

## Flere valg

- **Lag et bilde med KI.** **Lag med KI**, under **Bilder og videoer**, lager et nytt bilde ut fra ordene dine. Se
  [Tekster og bilder laget med KI](/docs/owners/ai/ai-texts-and-pictures).
- **Produkter er en del av nettbutikken**, som alle nye butikker starter med. Den slås av og på under Innstillinger, Funksjoner.
