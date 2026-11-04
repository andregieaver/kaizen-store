---
title: Merverdiavgift
summary: Registrer mva-registreringen og mva-nummeret ditt, legg hvert produkt i riktig mva.-kategori, og se hvordan merverdiavgiften beregnes hjemme, i utlandet og ved salg til bedrifter.
track: owners
section: markets-and-tax
kind: how-to
areas: [tax, settings, products]
features: []
plans: []
admin: /admin/{store}/settings/tax
order: 20
checked: 2026-11-04
sources: [D157, D65, D63, D178]
---

## Slik fungerer merverdiavgiften i butikken

- **Prisene er inkl. mva.** Prisen du skriver inn for et land, er det en kunde der betaler. Merverdiavgiften i den regnes ut med landets
  sats.
- **Hvert salg belastes merverdiavgiften i landet varene går til**, på hvert salg til forbrukere.
- **Frakt** belastes med mottakerlandets alminnelige sats, med mindre Kaizena Flow har kontrollert en annen regel for landet.

> [!IMPORTANT]
> Kaizena Flow beregner merverdiavgift slik det står her. Det er ikke skatterådgivning. Siden Avgift slutter med **Les dette sammen
> med regnskapsføreren din**: les det sammen med din før du selger til utlandet.

## Registrer mva-registreringen din

Åpne **Innstillinger** i menyen og velg [Avgift](/admin/{store}/settings/tax) under Salg. Bare en eier kan åpne siden.

1. Kryss av for **Butikken er registrert i Merverdiavgiftsregisteret**.
2. Skriv inn **Mva-nummer**. Det må være et nummer fra butikkens eget land: i Norge organisasjonsnummeret på ni sifre etterfulgt av
   MVA; ellers med landskoden først.
3. Under **Varene sendes fra** lar du feltet stå tomt hvis du sender fra butikkens land. Ellers skriver du landets to bokstaver, for
   eksempel NO eller CN.
4. Trykk **Lagre innstillingene for merverdiavgift**.
5. Under **Kontroller mva-nummeret** trykker du **Kontroller nå**. Et norsk nummer kontrolleres i Enhetsregisteret
   (Brønnøysundregistrene), andre i VIES, EUs register. Siden viser hva registeret fant, med registrert navn og adresse, så du kan se at
   det er virksomheten din.

Når du er registrert, vises mva-nummeret på butikkens dokumenter. Lagrer du et annet nummer, nullstilles kontrollen: trykk
**Kontroller nå** igjen.

### Hva som er på

Øverst på siden Avgift, under **Hva som er på**, står det én linje for hver av **Registrering for merverdiavgift**, **Omvendt
avgiftsplikt**, **OSS** og **IOSS**. Hver sier *På* eller *Av*, og hva som fortsatt mangler.

## Legg hvert produkt i en mva.-kategori

De fleste produkter har alminnelig sats, og der starter et nytt produkt. Har et produkt en annen sats, åpner du redigeringen og velger
**Mva.-kategori** under **Avgift, retur og gjenvinning**.

| Mva.-kategori | For |
|---|---|
| **Alminnelig sats** | De fleste varer og tjenester. |
| **Overnatting** | Hotellrom, feriehus og camping: en redusert sats der landet har en. Bare for opphold og utleie. |
| **Unntatt fra merverdiavgift** | Uten mva., som helsetjenester. Sjekk med regnskapsføreren din at det gjelder deg. |

Listen har også kategoriene Kaizena Flow holder for reduserte satser, for eksempel *Food and drink*, *Books* og *Children's goods*
(navnene vises foreløpig på engelsk).

Under feltet viser hvert av landene dine satsen produktet har der nå. Står det *ingen redusert sats kjent her: den alminnelige satsen
gjelder*, har Kaizena Flow ingen redusert sats for kategorien i det landet, og den alminnelige satsen beregnes.

## Salg til bedrifter

En butikk kan selge til forbrukere, til bedrifter eller til begge. Slå på **Salg til bedrifter** under Innstillinger,
[Funksjoner](/admin/{store}/settings/features), og velg deretter under **Butikken selger til** på
[Virksomhet](/admin/{store}/settings/company).

- Prisene lagres og belastes alltid med merverdiavgift. Bedrifter ser dem uten.
- En butikk som bare selger til bedrifter, legger inn og viser prisene uten merverdiavgift.
- Bedrifter oppgir firmanavn og organisasjonsnummer i kassen.

Se [Bedrifter og B2B](/docs/owners/customers/companies-and-b2b) om bedriftskontoer og produkter bare for bedrifter.

### Omvendt avgiftsplikt

En virksomhet i et annet EU-land kan kjøpe uten merverdiavgift når den oppgir et gyldig mva-nummer. Kjøperen beregner og betaler da
avgiften i sitt eget land (omvendt avgiftsplikt). Kaizena Flow bruker omvendt avgiftsplikt bare når alt dette stemmer:

- butikken er etablert i en medlemsstat i EU, er registrert i Merverdiavgiftsregisteret, og det egne nummeret er kontrollert som gyldig
  med **Kontroller nå**;
- kjøperen skriver inn et mva-nummer i handlekurven og kontrollerer det, og EUs register sier at det er gyldig for landet varene går til;
- varene sendes fra et annet EU-land enn kjøperens (nedlastinger sendes ikke, så de avhenger ikke av dette);
- handlekurven har ingen booking og ikke noe abonnement.

Ellers beregnes merverdiavgift. Svarer ikke registeret, beregnes merverdiavgift, og salget går videre. En butikk utenfor EU, som en
butikk i Norge, bruker aldri omvendt avgiftsplikt.

På en bestilling med omvendt avgiftsplikt står det *Omvendt avgiftsplikt* på kundens bestillingsside og i bekreftelsen, med begge
mva-numrene. På bestillingen i administrasjonen viser panelet *VAT treatment* hvordan merverdiavgiften ble behandlet og hvorfor, med
det registeret svarte.

> [!WARNING]
> Et gyldig svar fra registeret sier at et nummer er registrert. Det sier ikke at salget er fritatt: du har fortsatt ansvaret.

## Flere valg: OSS og IOSS

Siden Avgift registrerer også EUs ordninger for én kontaktflate. Kaizena Flow sender ingenting inn: registreringene brukes til å merke
bestillinger og til å lage grunnlaget i [Rapporter for mva., OSS og IOSS](/docs/owners/markets-and-tax/oss-and-ioss).

**EUs OSS-ordning (One Stop Shop).** Velg **Ordning**: **Ikke registrert i EUs OSS-ordning**, **OSS for butikker i EU («Union
scheme»)** eller **OSS for butikker utenfor EU («Non-Union scheme»)**, som gjelder tjenester til private kjøpere i EU. Oppgi deretter
**Medlemsstaten registreringen gjelder**, dagen under **Registrert**, og for ordningen utenfor EU **OSS-nummer («Non-Union scheme»)**.
Merverdiavgiften i mottakerlandet beregnes som før.

**EUs IOSS-ordning (Import One Stop Shop).** For en butikk som sender varer fra land utenfor EU til private kjøpere i EU. Oppgi
**IOSS-nummer**, eventuell **Representant**, dagen under **Registrert**, og kryss av for **Markeder IOSS gjelder for**. En sending på
høyst 150 EUR til disse markedene belastes mottakerlandets merverdiavgift i kassen og merkes med IOSS-nummeret ditt. Over 150 EUR er
bestillingen ikke et IOSS-salg, og kjøperen kan måtte betale importmerverdiavgift på grensen: se
[Toll og importmva.](/docs/owners/markets-and-tax/customs-and-duties).

Trykk **Lagre innstillingene for merverdiavgift** når du er ferdig.
