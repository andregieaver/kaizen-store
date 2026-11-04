---
title: Pakker
summary: Selg flere av produktene dine samlet som ett, priset etter prisene deres minus en prosent eller med en egen pris, med et lager som følger deres.
track: owners
section: products
kind: how-to
areas: [products, stock, orders]
features: []
plans: []
admin: /admin/{store}/products/new
order: 40
checked: 2026-11-04
sources: [D322, D433]
---

## Lag en pakke

En pakke er ett produkt satt sammen av flere av produktene dine, for eksempel to kopper og et handlenett solgt som gavesett. Den har egen
side, eget bilde og egen pris, men ikke eget lager: den er på lager så langt alle produktene i den er det.

1. Åpne **Produkter** og trykk **Legg til produkt**. Skriv tittel og beskrivelse og legg til et bilde, som for alle produkter.
2. Under **Hva er det?** velger du **En pakke**.
3. Under **Hva som er i pakken** skriver du navnet eller varenummeret til et produkt i **Finn et produkt** og trykker **Legg til** ved det
   du vil ha. Legg til de andre på samme måte.
4. Sett **Antall** for hvert. Pilene endrer rekkefølgen; **×** tar ett ut.
5. Velg **Pris** (se under) og trykk **Lagre**.

En pakke kan ha opptil 20 produkter og minst to enheter i alt: to produkter, eller to av ett. Bare varer du sender, kan være i en pakke,
og de må ha samme **Mva.-kategori** som pakken (under **Avansert**).

> [!NOTE]
> Du velger **En pakke** når du lager produktet. Et lagret produkt kan ikke bli en pakke, og en pakke kan ikke bli en annen type produkt.

## Gi pakken en pris

Under **Pris** velger du ett av to:

- **Produktenes priser minus en prosent** (det vanlige valget): skriv inn **Prosent avslag**, 0 til 90. Redigeringen viser hva pakken
  blir i hvert land, ved siden av hva produktene koster hver for seg. Pakkens pris følger prisene deres: når en av dem endres, endres
  pakkens også.
- **En egen pris**: skriv inn pakkens pris for hvert land, som for alle produkter.

Har et produkt i pakken ingen pris i et land, beholder en pakke som er priset etter produktene, prisen den hadde der, og redigeringen sier
fra om det.

## Lager

**Pakker du kan selge** viser hvor mange pakker lageret av produktene gir: det laveste hele tallet. Med 10 kopper og 3 handlenett har en
pakke med to kopper og ett handlenett 3. Du setter aldri lageret for en pakke selv, og en pakke selges aldri i restordre.

En pakke kan ikke selges så lenge et av produktene i den er arkivert eller slått av, eller har en annen mva-kategori enn pakken.
Redigeringen merker produktet i pakkens liste og sier hva du kan gjøre: hente det tilbake, gi dem samme mva-kategori, eller ta det ut. Du
kan fortsatt endre selve produktene: pakken venter bare til det er rettet.

Pakken selges ikke i et land der et av produktene i den ikke selges.

### Pakkens egne opplysninger

Under **Pakkens egne opplysninger** fyller du inn **Varenummer**, **Strekkode (GTIN/EAN)** og **Vekt i gram**.

## Hva kundene ser

En pakke vises og kjøpes som alle andre produkter. Siden viser *Dette er i pakken* over beskrivelsen, med en lenke til hvert produkt som er
til salgs. Kampanjer, rabattkoder, prislister og pris etter antall virker på den som på alle produkter: se
[Antallsregler og pris etter antall](/docs/owners/products/quantity-rules-and-price-breaks).

En pakke er aldri gratisproduktet i en kampanje, og den kan ikke være i en abonnementskasse, et utkast til bestilling eller et bytte.

## Etter salget

- **Bestillingen** viser produktene under linjen for pakken, for eksempel *Inneholder 2 × Kopp, 1 × Handlenett*: på bestillingssiden din,
  på kundens og på pakkseddelen.
- **Plukklisten** teller produktene som skal hentes fra hyllen, aldri pakken.
- **Lager**: lageret av produktene holdes av når bestillingen legges inn, og trekkes når den er betalt. En tilbakebetaling, en
  kansellering eller en retur legger produktene tilbake.
- **Endre bestillingen**: en bestilling med en pakke kan ikke endres ennå. Tilbakebetal eller kanseller den i stedet. Se
  [Tilbakebetaling og bytte](/docs/owners/orders/refunds-and-exchanges).

## Pakker og pris på forespørsel

Et produkt med **Pris på forespørsel** kan bare være i en pakke med **En egen pris**. En pakke som er priset etter produktene, ville vist
og tatt betalt med prisen du bruker som rettesnor for tilbud, så:

- mens **Produktenes priser minus en prosent** er valgt, merker pakkens liste et slikt produkt, og pakken lagres ikke før du gir den en
  egen pris eller viser prisen på det produktet;
- å krysse av for **Pris på forespørsel** på et produkt som er i en slik pakke, blir avvist, og redigeringen sier hvilke pakker det
  gjelder.

En pakke med egen pris kjøpes til den prisen. Produktet med pris på forespørsel selges fortsatt alene bare etter tilbud: se
[Priser](/docs/owners/products/prices).
