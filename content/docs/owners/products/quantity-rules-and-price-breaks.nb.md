---
title: Antallsregler og pris etter antall
summary: Selg en variant fra et minste antall, opp til et høyeste antall eller i multipler, gi lavere stykkpris fra et visst antall, og velg hvordan kundene velger antall.
track: owners
section: products
kind: how-to
areas: [products, customers]
features: []
plans: []
admin: /admin/{store}/products/{id}
order: 30
checked: 2026-11-04
sources: [D323, D430, D321]
---

## Selg i multipler, eller fra et minste antall

Åpne produktet og gå til **Pris og lager**. Under raden til varianten åpner du **Hvor mange om gangen for …**:

- **Selges i multipler av**: 1 selger et hvilket som helst antall. Med 6 kjøper kundene 6, 12, 18 og så videre.
- **Minst**: det minste antallet på én ordrelinje.
- **Høyst**: det høyeste. La feltet stå tomt for ingen egen grense.

Trykk **Bruk for alle varianter** for å gi alle variantene til produktet samme regel, og så **Lagre**.

Når du endrer **Selges i multipler av**, flyttes minste og høyeste antall til hele multipler av det. Hvert tall er høyst 9 999.

> [!NOTE]
> Uten et høyeste antall kan én ordrelinje ha opptil tjue multipler fra det minste: feltet viser tallet, for eksempel *Ingen grense (20
> per linje)*.

### Hva kundene ser

- **Produktsiden** viser regelen under lagerstatusen, for eksempel *Minst 12*, *Selges i multipler av 6* eller *Høyst 48*.
- **Antallet** starter på det minste og går opp i hele multipler, både på produktsiden og i handlekurven.
- **Handlekurven** avviser et antall regelen ikke tillater. Endrer du en regel etter at en kunde har lagt produktet i handlekurven, står
  det *Endre antallet: …* der, og kunden kan ikke gå til kassen før det er gjort.

Reglene gjelder det kundene kjøper selv. Utkast til bestillinger, endringer i bestillinger og bytter som du gjør, følger dem ikke.

## Gi lavere pris ved kjøp av flere

Pris etter antall gir en lavere stykkpris fra et visst antall enheter på én ordrelinje. Åpne produktet, så **Avansert**, og finn
**Pris etter antall**:

1. Trykk **Legg til pris etter antall**.
2. Har produktet flere varianter, velger du **Variant**: **Alle varianter**, eller én.
3. **Fra antall**: fra hvor mange den lavere prisen gjelder, 2 til 9 999.
4. **Lavere pris som**: **Prosent avslag** (1 til 99 %), eller **Stykkpris med mva.** skrevet inn for hvert land (uten mva. i en butikk
   som bare selger til bedrifter).
5. Trykk **Lagre**.

Et produkt kan ha opptil 10 priser etter antall. En stykkpris du skriver inn, gjelder bare i landene du gir den for. Pakker kan også ha
pris etter antall.

### Hva kundene ser

- **Produktsiden** viser en tabell, *Pris etter antall*, med stykkprisen fra hvert antall, for eksempel *1 eller flere* og *10 eller
  flere*. Et trinn som ikke ville vært billigere enn det før, utelates.
- **Handlekurven** tar den prisen og skriver *Pris ved 10 eller flere* på linjen.
- **Pris etter antall vises aldri som en rabatt**: ingen gjennomstreket pris og ingen 30-dagerspris ved siden av. Det er rett og slett
  prisen ved det antallet.
- Produktkort, lister og feeder viser prisen for én.

Rabatter virker fortsatt i tillegg: en kundegruppes prosent, kampanjer og rabattkoder trekkes fra en linje som er priset etter antall.

> [!NOTE]
> Pris etter antall gjelder enkeltkjøp, ikke abonnement. Et produkt med kjøpsvalg for abonnement viser ingen tabell.

## Hvordan kundene velger antall

Åpne **Innstillinger** og velg [Priser og antall](/admin/{store}/settings/prices). Under **Antall på produktsider** velger du:

- **− og + ved siden av tallet** (det vanlige valget): kundene trykker for å velge antall, eller skriver tallet.
- **En tallboks**: kundene skriver hvor mange.
- **Skjult**: Legg i handlekurven legger til én, eller minste antall varen selges i. Kundene endrer det i handlekurven.

Trykk **Lagre**. Handlekurven har alltid − og +. Knappene følger regelen: + går opp med multippelen, og et tall regelen ikke tillater, blir
til det nærmeste den tillater.

Timeavtaler, opphold, utleie, gavekort og varer som selges én om gangen, viser aldri antall.

### I ett produktoppsett

**Kjøp**-delen i et produktoppsett kan velge noe annet under **Hvor mange å kjøpe**: for eksempel en tallboks i et oppsett for grossister.
Åpne det under [Produktoppsett](/admin/{store}/product-layouts); se [Sidebyggeren](/docs/owners/website/the-page-builder).

## Regler og priser for kundegrupper og bedrifter

En prisliste kan gi sine egne kjøpere egne priser etter antall og egne antallsregler. Åpne [Prislister](/admin/{store}/price-lists) under
Kunder, og så en liste:

- **Pris etter antall for disse kjøperne**: fra et antall enheter, et prosentavslag fra markedsprisen eller en pris med mva. i en valuta.
  Den laveste prisen en kjøper kan få, gjelder.
- **Hvor mange om gangen for disse kjøperne**: **Minst**, **Høyst** og **I multipler av**, brukt for listens kjøpere i stedet for
  variantens egen regel. La en rad stå tom for å bruke variantens egen.

Se [Bedrifter og B2B](/docs/owners/customers/companies-and-b2b).
