---
title: Henting og lokal levering
summary: La kundene hente bestillingene i butikkene og på hentestedene dine, lever selv til kunder i nærheten, og lever ut hver bestilling fra siden dens.
track: owners
section: shipping
kind: how-to
areas: [shipping, orders]
features: []
plans: []
admin: /admin/{store}/settings/shipping/pickup
order: 20
checked: 2026-11-04
sources: [D135, D237, D289]
---

## Henting

### Legg inn stedene dine

Kundene henter på dine egne steder. Åpne **Innstillinger**, velg [Virksomhet](/admin/{store}/settings/company) under Butikk, og trykk
**Legg til en butikk** eller **Legg til et hentested** under **Butikker og hentesteder**. Skriv inn adresse og åpningstider: kundene ser
begge i kassen. Et sted må ligge i et land du selger til.

### La kundene hente selv

1. Åpne **Innstillinger**, velg **Frakt** under Salg, og trykk [Henting](/admin/{store}/settings/shipping/pickup).
2. Kryss av for **Kundene kan hente her** ved hvert sted.
3. La **Pris** stå tom for *Gratis*, eller skriv inn hva henting koster, inkl. mva.
4. Under **Vanligvis klar om (timer)** oppgir du hvor fort en bestilling vanligvis er klar. 0 lover ingenting: kundene får beskjed om at du
   sender e-post når den er klar.
5. Skriv **Henteinstruksjoner**, for eksempel hvor de skal spørre og hva de skal vise. De sendes i e-posten *Klar til henting* og vises i
   kassen, på butikkens hovedspråk; oversettelser skrives på siden Oversett butikken.
6. Trykk **Lagre henting**.

I kassen velger kundene under **Hent selv**, med hvert steds adresse, dagens åpningstider, hvor fort det vanligvis er klart og prisen.
Kassen spør ikke om leveringsadresse. Henting blir aldri valgt for kunden.

### Lever ut en bestilling som skal hentes

På bestillingen:

1. Når den er klar, trykker du **Klar til henting**. Kunden får én e-post, på bestillingens språk, med adressen, åpningstidene og
   instruksjonene dine.
2. Når kunden har fått den, setter du datoen ved **Hentet** og trykker **Hentet**. Bestillingen fullføres, og ingen e-post sendes. Den
   dagen starter de 14 dagene med angrerett.

Bestillinger som skal hentes, står aldri under *Skal sendes*. I listen over bestillinger finner du dem under **Forsendelse** i filtrene,
med *Skal leveres ut (henting)*. En feil rettes med **Angre** under **Levert ut** på bestillingen.

## Lokal levering

### Legg til et område

1. Åpne **Innstillinger**, velg **Frakt** under Salg, og trykk [Lokal levering](/admin/{store}/settings/shipping/local).
2. Under **Legg til et område** skriver du **Navn, slik kundene ser det** og velger **Land**.
3. Under **Området** velger du:
   - **Postnumre**: postnumre som 0150, eller prefikser som 01*, skilt med komma, mellomrom eller linjer; eller
   - **En avstand fra et av stedene dine**: velg stedet under **Målt fra** og oppgi **Radius (km)**.
4. Skriv inn **Pris** (tom er *Gratis*), og om du vil, en **Minste handlekurv** og en verdi under **Gratis over**.
5. Skriv **Leveringsinformasjon**, for eksempel dagene og tidene du leverer. Den vises i kassen og i ordrebekreftelsen.
6. La **Tilbys i kassen** være krysset av og trykk **Legg til område**.

Områder kan overlappe: det billigste som dekker kundens postnummer, tilbys. **Sjekk et postnummer**, på samme side, viser hvilke områder
som dekker et postnummer før du lagrer noe.

> [!NOTE]
> En avstand måles mellom postnumrenes midtpunkter, så en adresse nær kanten kan bli regnet med eller ikke, og i en by deler mange
> postnumre ett midtpunkt. Bruk postnumre der du trenger en skarpere grense. Skjemaet sier fra når et land ikke har posisjoner for
> postnumrene, og dermed ingen avstand.

I kassen oppgir kundene postnummeret sitt og ser **Lokal levering** når et område dekker det, med informasjonen din og en *Beskjed til
sjåføren*. En handlekurv under et områdes minstebeløp ser *Lokal levering fra* det beløpet og kan ikke velge den. Stripes skjema spør om
adressen og et telefonnummer.

### Lever bestillingen

På bestillingen:

1. Når den drar, trykker du **Ute for levering**. Bestillingen fullføres, og kunden får e-post.
2. Når den er fremme, setter du datoen ved **Levert** og trykker **Merk som levert**. Den dagen starter de 14 dagene med angrerett. For en
   sjåfør som leverer med en gang, registrerer **Merk som levert** begge stegene på én gang.

Bestillinger med lokal levering står aldri under *Skal sendes*. **Forsendelse** i filtrene i listen over bestillinger finner dem med
*Lokal levering*.

## Flere valg

### Når kortet belastes ved sending

Belaster du kortet når bestillingen sendes (se [Sett opp betalinger](/docs/owners/payments/set-up-payments)), belastes kortet først når
du registrerer utleveringen. Mislykkes det, registreres ingenting.

### Fjerne et sted eller et område

Et sted kan ikke slettes mens betalte bestillinger venter på å bli hentet der: merk dem som hentet, eller kanseller dem, først. Når du
sletter et område for lokal levering, beholder bestillinger som allerede er lagt inn, leveringen sin.

### Andre måter å levere på

- [Fraktpriser](/docs/owners/shipping/shipping-rates): en fast fraktpris per land, og dine egne fraktmetoder med soner og profiler.
- [Fraktselskaper](/docs/owners/shipping/carriers): fraktselskapenes tjenester, med hentesteder, i kassen.
