---
title: Kundekontoer og kundene dine
summary: Velg om kundene kan, må eller ikke kan ha en konto, og finn, legg til, merk, slå sammen og importer kundene dine.
track: owners
section: customers
kind: how-to
areas: [customers, settings]
features: []
plans: []
admin: /admin/{store}/customers
order: 10
checked: 2026-11-05
sources: [D32, D296, D304, D364, D365, D366, D375, D480]
---

## Velg hvordan kontoer fungerer

Kundene kan opprette en konto i butikken, eller krysse av for å lage en når de går til kassen. **Min konto** åpner med en oversikt
over de siste bestillingene og det som går nå, med faner for **Bestillinger**, **Profil** (opplysningene og de lagrede adressene) og
**Innstillinger** (passord, e-post fra deg og opplysningene butikken har om dem). Du velger om en konto skal være valgfri, påkrevd eller
ikke tilbys i det hele tatt.

1. Åpne **Innstillinger** og velg [Regler i kassen](/admin/{store}/settings/checkout), under Salg.
2. Under **Kundekontoer** velger du ett av disse:
   - **Valgfritt**, som er standard: kundene handler som gjest eller med konto, og kan opprette en konto med bestillingen.
   - **Påkrevd**: kundene logger inn før de går til kassen. Handlekurven viser *Logg inn for å gå til kassen* der kasseknappen ellers
     står, og hver bestilling havner på kundens konto.
   - **Av**: butikken viser ingen innlogging og ingen konto. Lenkene du sender etter et kjøp, for å betale, se en faktura eller skrive
     en omtale, virker fortsatt.
3. Trykk **Lagre**.

> [!NOTE]
> Abonnementer, bonusprogrammet og vervekampanjen trenger kundekontoer, og det gjør bedriftskontoer også. Så lenge en av dem er på,
> eller en bedriftskonto handler i butikken, kan du ikke velge **Av**: meldingen sier hva du må slå av først.

## Finn en kunde

Åpne **Kunder** i menyen. Listen viser alle med en konto eller en betalt bestilling, én per e-postadresse. Gjester som handlet uten
konto, er også med.

- **Søk på navn eller e-post**, og trykk **Søk**.
- **Filtrer på et merke**: velg det i listen ved siden av søket. **Vis alle** fjerner begge.

Åpne en kunde for å se bestillingene, abonnementene, e-postene butikken har sendt, kontaktopplysningene og adressen, stikkordene,
kundegruppen og ønskelisten. Når bonusprogrammet er på, står bonuspoengene der også.

## Legg til eller endre en kunde

Trykk **Legg til kunde**, fyll inn e-postadressen og det andre du vet (navn, telefon, adresse, bedrift), og trykk **Legg til kunde**.

- Kunden får en konto uten passord. De logger inn med en kode som sendes til e-posten deres.
- Ingenting sendes på e-post når du legger dem til, og ingen meldes på markedsføringslisten din.

For å endre en kunde åpner du dem og bruker **Endre opplysninger**, og så **Lagre opplysningene**. En endret e-postadresse må
bekreftes på nytt av kunden; stikkordene og notatene følger med. Har personen handlet som gjest, samler **Gi dem en konto**
opplysningene, stikkordene og bestillingene deres på ett sted.

### Notater til teamet

Under **Notater** skriver du noe teamet bør vite, og trykker **Legg til notat**. Bare de ansatte ser notatene. De er med når kunden ber
om en kopi av opplysningene sine, så ikke skriv noe du ikke ville vist dem.

## Merk kunder med stikkord

På kundesiden skriver du et stikkord under **Stikkord** og trykker **Legg til**. Stikkord gjør det lettere å finne folk og å lage
[segmenter for e-postene dine](/docs/owners/marketing/email-marketing).

Vil du merke mange på en gang, søker eller filtrerer du listen først og bruker så **Merk alle i denne listen**: skriv merket og trykk
**Legg til merket** eller **Ta bort merket**. Det virker for opptil 1 000 personer om gangen.

## Flere valg

### Slå sammen to kunder

Har én person to kontoer, åpner du den du vil beholde, og trykker **Slå sammen med en annen kunde**. Skriv e-postadressen til den andre
kontoen og trykk **Vis hva som flyttes**: du ser bestillingene, abonnementene, ønskelistene, de lagrede adressene, stikkordene,
notatene og bonuspoengene. Trykk **Slå sammen med denne kunden** for å flytte dem. Den andre kontoen slettes og logges ut. Dette kan
ikke angres.

En sammenslåing stoppes før noe endres når noe ville gått tapt, for eksempel når den andre kontoen har gavekort, har skrevet omtaler
eller hører til en bedrift denne kontoen ikke er med i. Meldingen sier hvorfor.

### Importer og eksporter kunder

Bare eiere ser disse knappene i kundelisten.

- **Importer** henter inn kunder fra en CSV-fil, for eksempel kundeeksporten fra Shopify. Sjekk filen først, og importer den så. En rad
  finner kunden sin på e-postadressen; en tom celle beholder det butikken har; stikkord legges til og fjernes aldri. En import setter
  aldri et passord og melder aldri noen på markedsføring.
- **Eksporter** laster ned kundene som et regneark: navn, e-post, telefon, adresse, bedrift, kundegruppe, språk, når de ble kunder,
  hvor mange betalte bestillinger de har og om adressen har meldt seg av.

Flytter du fra en annen nettbutikk? Se [Import og eksport](/docs/owners/products/import-and-export).

### Tilgodelapp

Når du betaler tilbake en bestilling, kan du under **Betal tilbake til** velge **Tilgodelapp** i stedet for den opprinnelige
betalingen. Beløpet blir et gavekort i butikken, sendt til bestillingens e-postadresse, og koden vises deg én gang. Se
[Refusjoner og bytte](/docs/owners/orders/refunds-and-exchanges).

### Lagrede adresser

Innloggede kunder kan ha opptil 20 adresser under **Min konto**, **Profil**, **Lagrede adresser**, med én for levering og én for faktura som kassen
starter med. Kassen tilbyr dem når den spør etter adressen selv; Stripes betalingsside spør etter sin egen. Adressen du skriver under
**Endre opplysninger**, er kundens standardadresse.

### Logg inn med Google

Der Kaizena Flow tilbyr det, viser innloggingen i butikken **Logg inn med Google**. Den logger bare inn en kunde som allerede har en
konto i butikken med samme e-postadresse: den lager ingen ny konto og tar ikke vare på noe fra Google. Den vises ikke når
kundekontoer er **Av**.

### Ønskelister

Kundene lagrer produkter med hjertet, innlogget eller ikke. **Kunder**, [Ønskelister](/admin/{store}/wishlists) viser listene, de mest
ønskede produktene og hva som gikk fra en liste til handlekurven og ble kjøpt.

> [!TIP]
> Hvem som kan se og endre kunder, styres av rollen deres: se [Ansatte og tilgang](/docs/owners/team-and-settings/staff-and-permissions).
> Når noen ber om opplysningene sine eller om å bli slettet, håndterer du det under
> [Personopplysninger](/docs/owners/customers/personal-data).
