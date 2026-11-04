---
title: Kategorier og stikkord
summary: Sorter produktene i kategorier, merk dem med stikkord, gi en kategori sin egen side, og velg standardkategorien som kundenes filtre og Google leser.
track: owners
section: products
kind: how-to
areas: [products]
features: [shop]
plans: []
admin: /admin/{store}/products/categories
order: 60
checked: 2026-11-04
sources: [D50, D79, D160, D168, D319, D327]
---

## Kort om kategorier og stikkord

- **Kategorier** samler produktene dine, for eksempel *Kaffe* og *Te*. En kategori kan ha underkategorier, for eksempel *Grønn te*
  inni *Te*. Et rutenett som viser en kategori, viser også produktene i underkategoriene.
- **Stikkord** merker produkter på tvers av kategorier, for eksempel *Økologisk*. Stikkordene er én flat liste.

Et produkt kan ligge i flere kategorier og ha flere stikkord. Kundene finner produktene gjennom dem i menyene, innholdsrutenettene og
filtrene dine, og hver kategori og hvert stikkord har sin egen side i butikken.

## Velg kategorier og stikkord for et produkt

Åpne produktet. Under **Kategorier og stikkord** krysser du av for dem det hører til, og trykker **Lagre**.

Vil du lage en ny underveis, skriver du navnet i feltet under listen (**Ny kategori** eller **Nytt stikkord**) og trykker **Legg til**.
Den lages og krysses av med en gang. En kategori du lager her, legges øverst; flytt den inn i en annen på kategorisiden.

## Administrer dem

Åpne **Produkter** og trykk **Kategorier og stikkord**, eller åpne [Kategorier og stikkord](/admin/{store}/products/categories)
herfra. Siden har ett kort for kategorier og ett for stikkord.

1. **Legg til.** Skriv et navn under **Ny kategori** eller **Nytt stikkord**. For en underkategori velger du kategorien den skal ligge
   i, under **Inni**. Trykk **Legg til kategori** eller **Legg til stikkord**.
2. **Endre.** Trykk **Endre** for å gi den nytt navn, flytte den under **Inni** eller endre **Adresse**. Endrer du adressen, sender
   den gamle adressen videre til den nye. Trykk **Lagre**.
3. **Slett.** Trykk **Slett**, og så **Slett** igjen for å bekrefte, eller **Behold**. Underkategoriene til en slettet kategori
   flyttes opp.

### En kategoris egen side

Hver kategori og hvert stikkord har en side i butikken som viser produktene. Trykk **Endre** og fyll inn **Egen side**:

- et bilde (**Legg til et bilde**) og en **Beskrivelse**, som vises over produktene og, uten en egen søketekst, i søkeresultater;
- navnet og beskrivelsen på de andre språkene dine. Tomt bruker teksten på hovedspråket.

Trykk **Sorter produktene** for å sette produktene i den rekkefølgen du vil: dra dem, eller bruk pilene, og trykk **Lagre
rekkefølgen**. Sidens første sortering, *Anbefalt*, følger denne rekkefølgen. Produkter som legges til senere, kommer sist til du
plasserer dem.

### Fylles etter regler

En kategori eller et stikkord kan fylle seg selv i stedet for at du krysser av på hvert produkt. Trykk **Endre** og kryss av for
**Fyll denne automatisk**. Velg om **Produktene oppfyller** alle disse vilkårene eller ett av dem, og trykk **Legg til et vilkår**: i
en kategori eller et stikkord, pris, på lager, produsent, variantvalg, eget felt, type produkt eller nyheter. Siden teller produktene
som passer, mens du holder på.

Produkter som oppfyller reglene, kommer med av seg selv og faller ut når de ikke lenger gjør det. Slår du på regler, tas produktene som
er lagt inn for hånd, ut når du lagrer. Slår du dem av, kan du krysse av for **Behold produktene som passer nå, lagt inn for hånd**. En
kategori som fylles etter regler, kan ikke krysses av på et produkt, og siden viser de nyeste produktene først.

## Standardkategorien for produktet

Ved siden av dine egne kategorier kan et produkt ha en kategori fra en felles liste som markedsplasser og Google leser: Shopifys åpne
standard produkttaksonomi. Kundene ser den ikke som sider i butikken.

1. Åpne produktet, så **Avansert**, og finn **Produktkategori**.
2. Under **Hva er det?** skriver du et ord eller to, for eksempel *t-skjorte* eller *kaffekvern*, og velger fra listen. Eller trykk
   **Foreslå med KI**: den foreslår en kategori ut fra produktets tittel og beskrivelse, og du trykker **Bruk den** for å ta den.
   Ingenting velges av seg selv.
3. Under **Egenskaper** krysser du av for det som passer, for eksempel farge eller materiale. Kategorien bestemmer hvilke egenskaper
   den har.
4. Trykk **Lagre**.

Dette gjør den:

- **Filtre.** Lister med produkter i butikken kan filtreres på disse egenskapene. En liste viser opptil åtte av dem, de flest av
  produktene har, med navn på kundens språk.
- **Feeder.** Produktfeedene dine sender Googles produktkategori, og farge, materiale og mønster fra egenskapene.
- **Søkemotorer** leser kategorien på produktsiden.
- **Produktfiler.** Shopifys kolonne *Product Category* setter den ved import. Se
  [Import og eksport](/docs/owners/products/import-and-export).

Navnene i listen finnes på engelsk, norsk, svensk og dansk; en side på et annet språk viser de engelske navnene.

## Et oppsett for en kategori

Oppsettet på en produktside kan følge kategorien eller stikkordet. Under [Produktoppsett](/admin/{store}/product-layouts) trykker du
*Where it's used* ved et oppsett, krysser av for kategoriene og stikkordene det skal gjelde, og trykker **Lagre**. Et produkt bruker
først sitt eget oppsett (**Sideoppsett** under **Kategorier og stikkord** i produktredigeringen), ellers nærmeste kategoris, ellers et
av stikkordenes, ellers butikkens standardoppsett. En kategoris oppsett gjelder også kategoriene under den som ikke har sitt eget. Hvordan
du bygger et oppsett, står i [Sidebyggeren](/docs/owners/website/the-page-builder).

## Flere valg

- **Mange produkter samtidig.** Kryss av produkter under [Produkter](/admin/{store}/products) og trykk **Legg til i en kategori eller
  et stikkord** eller **Fjern fra en kategori eller et stikkord**.
- **Søkeresultater.** Under **Endre** gir **Søkeresultater** en kategori eller et stikkord sin egen tittel og beskrivelse for
  søkemotorer, på hvert språk.
- **Pris per kg eller liter.** Kryss av for **Produkter i denne kategorien trenger en pris per kg eller liter** når du legger til eller
  endrer en kategori. Produktene i den, og i underkategoriene, trenger da mengden sin for hver variant som sendes og er til salgs.
  Ingenting endres i butikken med en gang: siden teller de aktive produktene som fortsatt mangler den (**Vis dem**), og et slikt
  produkt avvises neste gang det lagres. Mengden settes per variant: se [Varianter og valg](/docs/owners/products/variants-and-options).
- **Kategorier og stikkord er en del av nettbutikken**, som alle nye butikker starter med. Den slås av og på under Innstillinger,
  Funksjoner.
