---
title: Skriv en blogg
summary: Skriv artikler i sidebyggeren, publiser dem nå eller senere, og styr bloggene, forfatterne og kommentarene fra besøkende.
track: owners
section: website
kind: how-to
areas: [website, marketing]
features: []
plans: []
admin: /admin/{store}/articles
order: 30
checked: 2026-11-04
sources: [D50, D57, D340, D341]
---

## Skriv en artikkel

Åpne **Nettsted** i menyen og velg [Blogg](/admin/{store}/articles). Trykk *New article* og gi artikkelen en tittel.

En artikkel bygges i den samme sidebyggeren som sidene dine, med rader, kolonner og komponenter:
[Bygg sider i sidebyggeren](/docs/owners/website/the-page-builder) forklarer hvordan. Bloggen ligger på `/blog`, med de nyeste artiklene
først, og hver artikkel på `/blog/` etterfulgt av adressen sin.

I innstillingene for artikkelen, til høyre:

- **Forfatter**: velg en av forfatterne dine, eller skriv et navn under **Skrevet av**. Det vises under tittelen sammen med datoen og
  oppgis til søkemotorer. Står det tomt, vises butikken som forfatter.
- **Kategorier og stikkord**: sorter artiklene. Hver bloggkategori og hvert stikkord har sin egen liste over artikler på nettstedet.
- **Bilde**: vises øverst i artikkelen, i lister og når artikkelen deles.
- **Utdrag**: en kort tekst til lister over artikler. Står det tomt, brukes søkebeskrivelsen, og så starten av teksten.

## Publiser den

Linjen nederst er den samme som for sider: **Lagre utkast** tar vare på arbeidet, **Publiser** legger artikkelen ut i bloggen, og
**Avpubliser** tar den ut igjen. Publiserer du endringer senere, beholder artikkelen datoen den først ble publisert.

### Publiser den senere

Når artikkelen er lagret, trykker du **Planlegg** ved siden av Publiser. Velg **Dag** og **Klokkeslett** etter butikkens klokke: utkastet
slik det er da, blir publisert innen fem minutter etter det tidspunktet. Så lenge butikken ikke er åpnet, venter planen. Bloggens liste
viser når hver artikkel skal publiseres, og sier fra hvis en ikke ble publisert.

## Flere blogger

De fleste butikker trenger én blogg. Vil du ha en til, for eksempel nyheter ved siden av oppskrifter, trykker du **Blogger** på bloggens
liste og deretter **Legg til en blogg**:

- **Navn**, på hvert av butikkens språk. Står det tomt, heter bloggen Blogg på kundens språk.
- **Adresse**: bloggen ligger på `/blogs/` etterfulgt av den.
- **Kommentarer**: hvordan kommentarer fra besøkende vises (se [Kommentarer](#kommentarer)).
- **Hva adressen viser**: listen over artiklene, eller en av de publiserte sidene dine.

Trykk **Lagre bloggen**. En butikk kan ha opptil 20 blogger.

Når du har mer enn én, velger du bloggen til en artikkel under **I bloggen** i innstillingene. Den første bloggen ligger alltid på
`/blog`, så lenkene til den endres aldri, og den kan ikke slettes. En annen blogg kan slettes når artiklene i den er flyttet til en annen
blogg.

Hver blogg har en feed som lesere kan følge i en feedleser, med de 50 nyeste publiserte artiklene: adressen står under **Feed** på siden
Blogger.

> [!TIP]
> Vil du bygge siden til den første bloggen i sidebyggeren, velger du en under *Special pages* på listen over
> [Sider](/admin/{store}/pages).

## Forfattere

På siden Blogger trykker du **Forfattere** og deretter **Legg til en forfatter**: **Navn**, et **Bilde** fra mediebiblioteket, **Noen ord
om forfatteren** og en **Lenke** til en side om forfatteren. Trykk **Lagre forfatteren**.

Velg forfatteren under **Forfatter** i innstillingene for en artikkel. Artikkelen viser da forfatteren under seg, med bilde og tekst, og
oppgir navnet til søkemotorer. En butikk kan ha opptil 100 forfattere. Sletter du en, viser artiklene deres navnet som er skrevet på dem.

## Kommentarer

Hver blogg har sin egen innstilling under **Kommentarer**:

- **Av**: ikke noe kommentarfelt, og ingen kommentarer vises.
- **Venter til du har lest dem**: en kommentar vises når du har godkjent den. En ny blogg starter med dette, det trygge valget.
- **Vises med en gang**: kommentarer som består søppelpostkontrollen, vises med en gang; resten venter på deg.

**Kommentarer** på bloggens liste viser hvor mange som venter. Åpne den for å lese dem under **Venter**, **Vises**, **Søppelpost** og
**Avvist**. For hver kommentar trykker du **Godkjenn**, **Avvis**, **Søppelpost** eller **Slett**. Har søppelpostkontrollen funnet noe,
står det ved kommentaren.

En kommentar vises som ren tekst: lenker og kode i den følges ikke. Avviste kommentarer og søppelpost slettes etter 30 dager.

> [!NOTE]
> Kommentarer er personopplysninger. Når noen ber om en kopi av opplysningene sine, eller om at de slettes, er kommentarene deres med:
> [Personopplysninger](/docs/owners/customers/personal-data) forklarer slike forespørsler.

## Flere valg

- **Land.** I en butikk som selger i flere land, kan en artikkel holdes til noen av dem, slik en side kan.
- *Categories and tags* på bloggens liste styrer kategoriene og stikkordene i bloggen. Et innholdsrutenett på en hvilken som helst side
  kan vise artikler, og en meny kan lenke til bloggen, en artikkel eller en bloggkategori: se
  [Menyer, topptekst og bunntekst](/docs/owners/website/menus-header-and-footer).
