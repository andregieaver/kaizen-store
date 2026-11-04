---
title: Bedrifter, kundegrupper og prislister
summary: Selg til bedrifter med priser vist uten mva., gi grupper av kunder en fast rabatt eller egne priser, og la bedrifter handle med ansatte, lokasjoner og godkjenning.
track: owners
section: customers
kind: how-to
areas: [customers, tax, payments]
features: [business]
plans: []
admin: /admin/{store}/companies
order: 20
checked: 2026-11-04
sources: [D63, D108, D178, D293, D321, D323]
---

## Velg hvem du selger til

For å selge til bedrifter slår en eier på **Salg til bedrifter** under **Innstillinger**, [Funksjoner](/admin/{store}/settings/features).
Åpne så **Innstillinger**, [Virksomhet](/admin/{store}/settings/company), og velg under **Kunder** hvem **Butikken selger til**:

- **Forbrukere**: prisene vises og legges inn med merverdiavgift.
- **Bedrifter**: prisene vises og legges inn uten merverdiavgift, og hver bestilling krever firmanavn og organisasjonsnummer.
- **Forbrukere og bedrifter**: kundene velger *Privat* eller *Bedrift* i toppteksten, og bedrifter ser prisene uten merverdiavgift.
  Kryss av for **Spør førstegangsbesøkende** for å spørre hver nye besøkende hva de er.

Trykk **Lagre kunder**. Bare eiere kan endre dette.

> [!IMPORTANT]
> Hver bestilling belastes med merverdiavgift, også når en bedrift kjøper: bedrifter *ser* bare prisene uten. Se
> [Merverdiavgift](/docs/owners/markets-and-tax/vat).

I en butikk som selger til begge, kan hvert produkt være for **Alle**, **Bare privatkunder** eller **Bare bedrifter**: velg det under
**Kunder** i produktredigeringen. Bare bedriftskunder kan legge et produkt som bare er for bedrifter, i handlekurven, og en bestilling
med et slikt produkt krever bedriftens navn og organisasjonsnummer. Organisasjonsnumre sjekkes for Norge, Sverige, Danmark og Finland.

## Gi en gruppe fast rabatt

En kundegruppe gir kundene sine en fast prosent i rabatt, for eksempel *Grossist* med 10 %.

1. Åpne **Kunder** i menyen og velg [Kundegrupper](/admin/{store}/customer-groups).
2. Fyll inn **Navn** og **Rabatt, prosent** under **Ny gruppe**, og trykk **Lag gruppe**.
3. Åpne gruppen og legg til folk under **Legg til en kunde med e-post**. Den som ikke har en konto, får en laget, og rabatten venter til
   de logger inn. Du kan også velge **Kundegruppe** på kundesiden.

Rabatten trekkes fra alt som kjøpes én gang, før en eventuell rabattkode. Den gjelder ikke abonnementer, oppstartsgebyrer eller frakt.
En kunde som også er med i en bedrift, får den beste av de to rabattene. Slår du av en gruppe på siden dens, stopper rabatten med en
gang; bestillinger som allerede er lagt inn, beholder det de fikk.

## Bedriftskontoer

En bedriftskonto lar en bedrift handle med flere personer: en hovedkonto og de ansatte, alle med bedriftens rabatt. Den krever at
**Salg til bedrifter** er slått på.

1. Åpne **Kunder**, [Bedrifter](/admin/{store}/companies), og fyll ut **Ny bedrift**:
   - **Bedriftens navn**, og **Organisasjonsnummer** hvis du har det: med det handler bedriftens kontoer som en bedrift, med nummeret
     fylt ut.
   - **Kundegruppe**: rabatten bedriften får.
   - **Ansatte får, prosent av rabatten**: 100 gir dem hele, 50 halvparten. Hovedkontoen får alltid hele.
   - **Flest kontoer**: hvor mange personer bedriften kan ha, ventende invitasjoner medregnet.
   - **Hovedkonto, e-post**: personen som inviterer bedriftens ansatte.
2. Trykk **Lag bedrift**.

Hovedkontoen inviterer ansatte på e-post fra **Min konto**, **Mitt firma** i butikken, opptil 20 adresser om gangen og 50 om dagen.
Hver invitasjon åpner en side med en knapp, og ingenting endres før den trykkes. Du kan også sende invitasjoner selv fra bedriftens side
med **Inviter ansatte på vegne av butikken**, og **Trekk tilbake** en som fortsatt er åpen. En konto hører til høyst én bedrift.

Slår du av en bedrift på siden dens, får kontoene ingen rabatt, og bedriften inviterer ingen. En bedrift kan bare slettes når den ikke
har noen kontoer.

## Flere valg

### Lokasjoner, kjøpere og godkjenning

På bedriftens side kan du legge til **Lokasjoner** (opptil 50), hver med en leveringsadresse og en fakturaadresse. Under **Hvem som
kjøper her** gir du hvert medlem en rolle: **Bestiller**, eller **Bestiller og godkjenner**. Medlemmene velger lokasjon i kassen.
Hovedkontoen godkjenner på alle lokasjoner. En bedrift uten lokasjoner handler som før.

Under **Kjøpsregler**:

- Kryss av for **Innkjøpsordrenummer kreves på hver ordre** for at kjøperne skal skrive inn bedriftens innkjøpsordrenummer. Det står på
  bestillingen, fakturaen og kreditnotaene, og søket i bestillinger finner det.
- Sett en **Godkjenningsgrense**. En bestilling over grensen fra en som bare bestiller, venter i inntil sju dager på en godkjenner.
  Ingenting belastes mens den venter. Godkjenneren finner den under **Ordrer til godkjenning** i **Mitt firma**; når den er godkjent,
  betaler kjøperen, og bestillingen sendes. En bestilling som avslås, eller ikke avgjøres i tide, kanselleres. Godkjennerne og kjøperen
  får e-post.

Trykk **Lagre kjøpsregler**.

### Prislister

En prisliste gir kundegrupper og bedrifter egne priser.

1. Åpne **Kunder**, [Prislister](/admin/{store}/price-lists). Skriv et **Navn** under **Ny prisliste** og, om du vil, en **Prosent av
   markedsprisen (valgfritt)**. Trykk **Lag prisliste**.
2. Velg **Hvem den gjelder for** på listens side: kundegrupper, og bedrifter (som krever **Salg til bedrifter**). Trykk **Lagre hvem den
   gjelder for**.
3. Velg **Hva prosenten gjelder**: kategorier eller produkter. Er ingenting valgt, gjelder den alle produkter.
4. Legg til **Faste priser** hvis du vil ha det: finn et produkt, og skriv en pris med mva. for en variant i valutaen til et av landene
   dine.

En kjøper betaler den laveste prisen listene gir, aldri mer enn butikkens egen pris, og ser den som *Din pris*, ikke som et avslag. En
linje som prises av en liste, får ingen grupperabatt i tillegg. Lister priser varer og avtaler som kjøpes én gang, aldri et abonnement,
et opphold eller en utleie, eller et gavekort. Bestillinger som alt er lagt inn, beholder prisene de ble belastet.

En prisliste kan også ha **Pris etter antall for disse kjøperne** og **Hvor mange om gangen for disse kjøperne**. De virker som
[pris etter antall og antallsregler](/docs/owners/products/quantity-rules-and-price-breaks) på et produkt, men bare for listens kjøpere.

### Produkter bare noen kjøpere ser

Kryss av for **Bare disse produktene for disse kjøperne** i prislistens innstillinger. Produktene og kategoriene som er valgt under
**Hva prosenten gjelder**, tilbys da bare listens kjøpere, under **Din katalog** på kontoen deres. Alle andre ser dem ingen steder i
butikken. Er ingenting valgt, skjules ingenting.

### Betalingsvilkår

På bedriftens side velger du **15 dager**, **30 dager** eller **60 dager** under **Betalingsvilkår**, og om du vil, en
**Kredittgrense**: det bedriften kan skylde på én gang. Trykk **Lagre vilkårene**. Bedriftens kontoer kan da velge *Betal med faktura*
i kassen for varer som kjøpes én gang: bestillingen bekreftes med en gang, og fakturaen forfaller etter dagene du valgte. Påminnelser
går tre dager før forfallsdagen og dagen etter. Se [Fakturaer og kreditnotaer](/docs/owners/orders/invoices-and-credit-notes).
