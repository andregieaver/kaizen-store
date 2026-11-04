---
title: Menyer, topptekst og bunntekst
summary: Lag menyene kundene finner fram med, velg hvilke topptekst og bunntekst viser, legg inn logo og ikon, og bygg din egen topptekst.
track: owners
section: website
kind: how-to
areas: [website, settings]
features: []
plans: []
admin: /admin/{store}/menus
order: 40
checked: 2026-11-04
sources: [D30, D62, D80, D85, D87]
---

## Endre en meny

En meny er en liste med lenker. Butikken starter med én til toppteksten og én til bunnteksten, og du kan lage så mange flere du vil.

1. Åpne **Nettsted** i menyen og velg [Menyer](/admin/{store}/menus).
2. Under **Velg en meny å redigere:** velger du menyen. Vil du lage en ny, trykker du **lag en ny meny**, skriver **Menyens navn** og
   trykker **Lag menyen**.
3. Under **Legg til menypunkter** åpner du en liste (**Sider**, **Produkter**, **Produktkategorier**, **Bloggartikler** og andre), krysser
   av for det du vil ha, og trykker **Legg til i menyen**. **Butikkens lenker** har forsiden, alle produkter, bloggen, Min konto og
   handlekurven. **Egen lenke** tar en hvilken som helst **Nettadresse** med **Lenketekst**.
4. Under **Menyens oppbygning** drar du lenkene i den rekkefølgen du vil ha. Dra en lenke mot høyre for å legge den under lenken over.
5. Trykk **Lagre menyen**. Nettstedet viser den med en gang.

Vil du endre ordene på en lenke, åpner du den med pilen og skriver **Menytekst**, på hvert av butikkens språk. Der kan du også la den
**Åpne lenken i en ny fane**, flytte den med **Flytt**-knappene, eller **Fjern** den.

En meny har plass til 100 lenker, i tre nivåer. En lenke til en side, en artikkel, en kategori eller et stikkord vises bare så lenge den
er publisert, og følger med når adressen endres.

### Hvor en meny vises

En meny vises der du velger den: i standardtoppteksten eller -bunnteksten (se
[Logo, ikon og standardmenyene](#logo-ikon-og-standardmenyene)), eller der du plasserer en **Meny**-komponent i en side, en topptekst
eller en bunntekst. **Hvor den vises** i menyredigeringen viser disse stedene.

**Slett menyen** spør først og sier hvor menyen brukes: de stedene viser da ingen meny.

### En megameny

Åpne en lenke på øverste nivå og kryss av for **Megameny**: lenkene under den åpnes side om side over hele sidens bredde, i **Kolonner**,
hver med et **Bilde** over seg. Et liggende bilde (4:3) passer best. På telefoner vises de som en vanlig liste.

## Logo, ikon og standardmenyene

Åpne **Innstillinger** i menyen og velg [Topptekst og bunntekst](/admin/{store}/settings/navigation), under Nettsted.

- **Logo**: vises i toppteksten i stedet for navnet på butikken, opptil 40 piksler høy. En bred PNG med gjennomsiktig bakgrunn passer
  best. Uten logo viser toppteksten navnet.
- **Logo for mørke bakgrunner**: en lys utgave, som vises der bakgrunnen er mørk, som i en svart topptekst eller i mørk modus.
- **Ikon (favicon)**: vises i fanene og bokmerkene i nettleseren og på startskjermen på telefoner. Et kvadratisk bilde på minst 512
  piksler passer best: et enkelt merke heller enn hele logoen. Uten ikon vises ikonet til Kaizena Flow.
- **Menyer**: hvilken meny standardtoppteksten viser (**Hovedmeny**), og hvilken standardbunnteksten viser (**Bunnmeny**).

Trykk **Lagre**. **Se butikken** åpner butikken så du kan se resultatet.

Standardtoppteksten har alltid handlekurven, Min konto og valget av land, så menyen trenger ingen lenker til dem. På telefoner skyves
hovedmenyen inn fra en menyknapp.

Bunnteksten viser alltid firmaopplysningene dine, slik loven krever: firmanavn, organisasjonsnummer, adresse og e-postadresse for kontakt
fra [Virksomhet](/admin/{store}/settings/company) under Innstillinger.

## Bygg din egen topptekst eller bunntekst

Standardtoppteksten og -bunnteksten passer de fleste butikker. Vil du ha ditt eget oppsett:

1. Åpne **Nettsted** og velg [Topptekster](/admin/{store}/headers) eller [Bunntekster](/admin/{store}/footers). Trykk *New header* eller
   *New footer*: den starter som en kopi av standarden.
2. Bygg den i sidebyggeren. I tillegg til de vanlige komponentene har **Nettstedet** logoen, menyer, søk, handlekurven, valget av land og
   mer; en bunntekst beholder alltid firmaopplysningene og lenken til informasjonskapsler.
3. Trykk **Publiser**.
4. Tilbake på listen velger du den under **Toppteksten som brukes** (eller **Bunnteksten som brukes**) og trykker **Lagre**.

Til du velger en, vises standardtoppteksten og -bunnteksten. Avpubliserer du den som er i bruk, vises standarden til du publiserer den
igjen. Logoen er den under Topptekst og bunntekst, og Meny-komponentene viser menyene du lager under Menyer.

> [!TIP]
> En topptekst kan ligge oppå toppen av en side der den første raden har et bilde, en video eller en farge, gjennomsiktig til den
> besøkende ruller. I innstillingene for toppteksten, under **Over siden**, velger du **Hvor toppteksten skal ligge**: oppå hver side,
> oppå forsiden eller oppå sider i bestemte kategorier eller stikkord.
