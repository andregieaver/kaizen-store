---
title: Priser
summary: Gi et produkt en pris i hvert land, sett den ned til et salg, slutt å selge det i ett land, gi det pris på forespørsel, og velg hvordan kundene ser prisene.
track: owners
section: products
kind: how-to
areas: [products, markets, tax, quotes]
features: []
plans: []
admin: /admin/{store}/products/{id}
order: 20
checked: 2026-11-04
sources: [D335, D429, D431, D63]
---

## Gi produktet priser

Åpne produktet og gå til **Pris og lager**. Variant-tabellen har en kolonne for hvert land du selger i, med valutaen og *inkl. mva.*
øverst. Skriv inn en pris for hver variant i hvert land og trykk **Lagre**.

- **Prisene er inkludert mva.** Det du skriver inn, er det kundene betaler. Merverdiavgiften i prisen regnes ut fra produktets
  mva-kategori og landet; se [Mva.](/docs/owners/markets-and-tax/vat).
- **Hvert land har sin egen pris, i sin egen valuta.** Ingenting regnes om når du skriver den inn.
- **Et land uten pris selger ikke produktet.** Det vises ikke for kundene der.

Har produktet størrelser og farger, har hver variant sin egen pris: se [Varianter og valg](/docs/owners/products/variants-and-options).

## Sett ned en pris til et salg

Skriv inn den lavere prisen og lagre. Kaizena Flow tar vare på historikken til hver pris, så kundene ser den nye prisen med *Laveste pris
siste 30 dager* ved siden av, slik EU-reglene krever. Den linjen vises bare når den nye prisen er lavere enn den laveste prisen de 30
dagene før, så en prisøkning viser ingen rabatt.

Det finnes ingen egen «før»-pris å skrive inn: en rabatt måles alltid mot prishistorikken. En sammenligningspris i en importert fil brukes
aldri.

- **Mange produkter på en gang:** kryss dem av under [Produkter](/admin/{store}/products) og trykk **Endre pris**, med en prosent eller
  et beløp. **Se over** viser de første nye prisene før noe endres. Som standard endres bare prisene i hovedlandet ditt.
- **Et tilbud uten å endre prisen**, for eksempel 20 % på en kategori i en helg eller en kode: se
  [Rabattkoder og kampanjer](/docs/owners/marketing/discount-codes-and-campaigns).
- **En lavere pris når kunden kjøper flere:** se [Antallsregler og pris etter antall](/docs/owners/products/quantity-rules-and-price-breaks).

## Slutt å selge i ett land

Når du selger i flere land, har **Selges i** under variant-tabellen en hake for hvert. Fjern haken for et land for å slutte å selge
produktet der. Prisen der beholdes til du krysser av igjen.

For mange produkter krysser du dem av under [Produkter](/admin/{store}/products) og trykker **Slutt å selge i** eller **Selg i**. Et land
uten pris forblir usolgt til det får en.

> [!NOTE]
> Redigeringen stopper et helt produkt i et land. Vil du stoppe bare én variant der, bruker du kolonnen `not_sold_in` i produktfilen
> ([Import og eksport](/docs/owners/products/import-and-export)) eller spør KI-assistenten. **Selges i** viser da variantene som ikke selges
> i alle land.

## Pris på forespørsel

For varer der prisen avhenger av bestillingen, krysser du av for **Pris på forespørsel** øverst i **Pris og lager**. Kundene ser da
*Pris på forespørsel* i stedet for en pris, og trykker *Be om tilbud* i stedet for *Legg i handlekurven*. Produktet legges aldri i en
handlekurv, og det holdes utenfor produktfeedene.

Prisene du har skrevet inn, beholdes som en rettesnor når du priser et tilbud. De vises aldri. Forespørslene kommer som utkast til
bestillinger: se [Utkast til bestillinger og tilbud](/docs/owners/orders/draft-orders-and-quotes).

Pris på forespørsel gjelder varer som kjøpes én gang. Det tilbys ikke for et produkt som selges som abonnement. Et produkt med pris på
forespørsel kan likevel være en del av en pakke med egen pris: se [Pakker](/docs/owners/products/bundles).

## Hvordan kundene ser prisene

Åpne **Innstillinger** og velg [Priser og antall](/admin/{store}/settings/prices), under Salg.

- **Desimaler.** **Vis alltid desimalene**, eller **Dropp ,00 på hele beløp**: da vises 499,00 kr som 499 kr, mens 499,50 kr beholder
  desimalene. Ingenting rundes av. Alle priser kundene ser, følger valget, også i handlekurven, i kassen og i e-postene dine til dem.
  Fakturaer, kreditnotaer, rapporter og administrasjonen beholder desimalene.
- **Ord rundt en vares pris.** Korte ord **Før prisen** og **Etter prisen**, som *Kun* eller */stk*. **Kundene ser** viser resultatet.
  Ordene står overalt der en vares pris vises, aldri ved linjene eller summene i handlekurven, på fakturaer eller i feeder.

Trykk **Lagre**. Butikken viser prisene på den nye måten med en gang.

> [!IMPORTANT]
> Hvert ord kan ha høyst 24 tegn med vanlig tekst. Prosenter og ord som kan villede kundene, som en påstand om beste pris, hastverk eller
> et lagernivå, blir avvist: butikken viser selv en rabatt, mot den laveste prisen de siste 30 dagene.

### Flere muligheter

- **Desimaler per land**, under **Avansert**: et land kan avvike fra butikkens valg, for eksempel uten desimaler i Norge og med desimaler
  i Tyskland.
- **Ord på de andre språkene dine**, under **Avansert**: kryss av for **Egne ord på …** for et språk. Et språk uten egne ord bruker ordene
  på hovedspråket.
- **Egne ord for ett produkt**: åpne **Avansert** i produktets redigering og velg under **Ord rundt prisen**: **Butikkens ord**,
  **Ingen** eller **Egne ord**.

## Priser for bedrifter

I en butikk som selger både til privatkunder og bedrifter, ser en kunde som handler for en bedrift, de samme prisene uten mva., merket
*ekskl. mva.*; merverdiavgiften tas likevel. En butikk som bare selger til bedrifter, skriver inn prisene uten mva. i redigeringen, og
kolonnene viser *ekskl. mva.*. Se [Bedrifter og B2B](/docs/owners/customers/companies-and-b2b).

## Regn ut et lands priser fra et annet

Med **Flere land** slått på (Innstillinger, Funksjoner) og mer enn ett land åpner du **Innstillinger** og velger
[Land](/admin/{store}/settings/countries). Under **Priser i hvert land** velger du for hvert land etter det første **Skrives inn for
hånd**, eller **Regnes ut fra** et annet land:

- **Endring, i %**: for eksempel 10 eller -5; 0 gir samme pris.
- **Mva.**: **Behold prisen uten mva. lik** eller **Behold prisen med mva. lik**, for land med ulike mva-satser.
- **Rund av til** og **Prisslutt (valgfritt)**, for eksempel 9 eller 0,90: prisene slutter slik, rundet opp.

Trykk **Vis fem priser** for å se hva fem produkter ville kostet, og så **Lagre**. Når en pris i grunnlandet endres, følger prisene
regelen har laget, etter. Mellom to valutaer trenger begge en valutakurs under Språk og valutaer.

I produktredigeringen står det *Etter landets prisregel* under en pris regelen har regnet ut. En pris du skriver inn der selv, er din:
regelen lar den være. **Skriv inn for hånd igjen** avslutter regelen og beholder prisene den har laget. Se
[Land, språk og valutaer](/docs/owners/markets-and-tax/countries-languages-currencies).
