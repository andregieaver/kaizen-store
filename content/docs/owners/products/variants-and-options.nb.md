---
title: Varianter og valg
summary: Selg et produkt i størrelser, farger eller andre valg, gi hver variant eget varenummer, egen pris, eget lager og egen vekt, og slå av dem du ikke selger.
track: owners
section: products
kind: how-to
areas: [products, stock]
features: []
plans: []
admin: /admin/{store}/products/{id}
order: 10
checked: 2026-11-04
sources: [D320, D82, D84, D79]
---

## Valg og varianter

Et **valg** er det kunden velger, for eksempel *Farge* eller *Størrelse*. Hvert valg har **verdier**, som *Hvit, Svart* eller *S, M, L*.
En **variant** er én kombinasjon av verdier, for eksempel *Hvit, M*: det du faktisk har på lager og sender. Et produkt kan ha opptil tre
valg.

Et produkt uten valg har én variant, så det har likevel et varenummer, en pris og et lager.

## Gi et produkt valg

1. Åpne produktet (**Produkter**, så produktet) og gå til **Pris og lager**.
2. Kryss av for **Produktet finnes i flere valg, som størrelser eller farger**.
3. Under **Valg** skriver du **Navn på valget**, for eksempel *Farge*, og **Verdier**, skilt med komma: *Hvit, Svart*.
4. Trykk **Legg til et valg til** for et andre eller tredje valg, for eksempel *Størrelse* med *S, M, L*.

Hver kombinasjon av verdiene blir en rad i variant-tabellen under: to farger og tre størrelser gir seks varianter. En ny kombinasjon
starter med prisene til den første varianten, så du slipper å skrive inn hver pris på nytt.

## Fyll ut hver variant

Hver rad i tabellen har:

- **Variant**: verdiene, med bildet.
- **Varenummer**: din egen kode for varianten. Hver variant må ha et varenummer, og to varianter i butikken kan ikke ha samme.
- **Lager**: hvor mange du har.
- **En pris for hvert land** du selger i, med mva. Se [Priser](/docs/owners/products/prices).
- **Til salgs**: krysset av så lenge du selger den.

Trykk **Lagre** når du er ferdig. Mangler noe, for eksempel et varenummer, lagres ingenting, og redigeringen viser hva du må rette.

### Et bilde for hver variant

Trykk på den lille ruten ved navnet til varianten (et **+** til den har et bilde). Velg et av produktets bilder, eller
**Last opp et bilde** bare for den varianten. Når en kunde velger varianten, viser bildegalleriet på produktsiden bildet.

### Mer om en variant

Under hver rad er det tre linjer du kan åpne:

- **Lagerregler for …**: fortsett å selge når varen er utsolgt, og et varsel når lageret er lavt. Se
  [Lager og lagersteder](/docs/owners/stock/stock-and-locations) og [Forhåndsbestilling og restordre](/docs/owners/stock/pre-orders-and-backorders).
- **Hvor mange om gangen for …**: et minste antall, et høyeste antall og pakker. Se
  [Antallsregler og pris etter antall](/docs/owners/products/quantity-rules-and-price-breaks).
- **Strekkode, kostpris, vekt, innhold og toll for …**: **Strekkode (GTIN/EAN)**, **Kostpris per enhet** (ekskl. mva.),
  **Vekt i gram**, **Tolltariffnummer (HS-kode)**, **Opprinnelsesland**, og innholdet for en pris per kg eller liter.

## Slutt å selge en variant

Fjern haken for **Til salgs** på raden og lagre. Kundene ser den ikke lenger, og lageret og prisene beholdes til du krysser av igjen. Et
produkt må ha minst én variant til salgs før det kan publiseres.

En variant slettes aldri. Fjerner du en verdi eller et valg, slås variantene som hadde det, av når du lagrer: bestillingene og
prishistorikken viser fortsatt til dem.

> [!TIP]
> Finnes ikke alle kombinasjonene? Fjern haken for **Til salgs** på dem du ikke lager, for eksempel en stor størrelse i én farge. Da kan
> kundene bare velge kombinasjoner som er til salgs.

## Hva kundene ser

- **På produktkort** vises den laveste prisen, med *Fra* foran når variantene har ulike priser.
- **Med færre enn 12 varianter** har produktsiden én liste, *Velg variant*, med bilde, lager og pris for hver variant. En variant som ikke
  kan kjøpes nå, kan ikke velges.
- **Med 12 varianter eller flere** får hvert valg sin egen liste: først fargen, så størrelsen. En verdi som ikke kan kjøpes sammen med
  verdiene som allerede er valgt, merkes *Ikke tilgjengelig*, og velger kunden en verdi, går siden til den nærmeste varianten som kan
  kjøpes.

En variant kan kjøpes når den er på lager, selges i restordre eller er en nedlasting. En variant som er slått av, ikke har pris i kundens
land eller ikke selges der, vises ikke i det hele tatt.

## Flere muligheter

### Store produkter

Et produkt kan ha opptil 2 048 varianter til salgs. Varianter som er slått av, teller ikke. Med 13 varianter eller flere viser
redigeringen **Vis variantene med** over tabellen: velg en verdi for et valg, for eksempel *Svart*, for å se bare de variantene. Linjen
ved siden av sier hvor mange som vises, for eksempel *Viser 48 av 240 varianter*.

### Sett mange varianter på en gang

Med to varianter eller flere trykker du **Sett for alle som vises**. Det endrer alle variantene tabellen viser (alle sammen, eller dem
filteret ditt lar stå igjen):

- **Pris i** hvert land,
- **Lager** og **Vekt (g)**,
- **Til salgs**: *Som de er*, *Ja* eller *Nei*,
- **Mønster for SKU**: ord i krøllparentes fylles ut for hver variant, med store bokstaver. `{handle}` er produktets nettadresse, `{n}`
  plassen i listen, og navnet på et valg verdien. `{handle}-{Farge}-{Størrelse}` gir varenumre som *T-SKJORTE-SVART-M*.

Bare feltene du fyller ut, blir satt, og lager og vekt bare på varianter du sender. Trykk **Sett**, og lagre så produktet med
**Lagre** for å beholde endringen. Ville to varianter fått samme varenummer, eller er et ord i krøllparentes ikke navnet på et valg, sier redigeringen fra
før noe blir satt.

### Varianter som leveres ulikt

Under **Hvordan leveres det?** krysser du av for **Variantene leveres ulikt (for eksempel en innbundet bok og en e-bok)**. Tabellen får
da en kolonne **Levering**, så hver variant er *Fysisk* eller *Digitalt*. Digitale varianter har ikke lager.

### Når listene på produktsiden deler seg

Antallet varianter der hvert valg får sin egen liste, er 12 hvis du ikke endrer det. Du endrer det i et produktoppsett: åpne
**Kjøp**-delen under [Produktoppsett](/admin/{store}/product-layouts) og sett **Hvert alternativ i egen liste fra**. Se
[Sidebyggeren](/docs/owners/website/the-page-builder).

### Mange produkter på en gang

For å endre varenumre, priser og lager for flere produkter i én tabell krysser du dem av under [Produkter](/admin/{store}/products) og
trykker **Rediger i rutenett**. Vil du jobbe i et regneark, se [Import og eksport](/docs/owners/products/import-and-export).
