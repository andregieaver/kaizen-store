---
title: Returer og angrerett
summary: Slik angrer kundene et kjøp innen 14 dager, slik tar du varene tilbake, kontrollerer dem og betaler tilbake i tide, og slik setter du returreglene og returetikettene.
track: owners
section: orders
kind: how-to
areas: [returns, orders]
features: [shop]
plans: []
admin: /admin/{store}/returns
order: 40
checked: 2026-11-05
sources: [D153, D239, D238, D174, D458]
---

## Angringer og returforespørsler

[Returer](/admin/{store}/returns) har to slags returer:

- **Angring**: en forbruker i EU kan ombestemme seg om de fleste kjøp innen 14 dager, uten å oppgi grunn. Du kan ikke nekte, og
  pengene skal tilbake innen 14 dager etter at du fikk beskjed.
- **Returforespørsel**: en retur innenfor ditt eget, lengre returvindu, hvis du gir mer enn 14 dager, eller en som loven ikke gir rett
  til. Du kan godkjenne eller avslå den.

Returer hører til nettbutikken, som slås på under Innstillinger, Funksjoner.

## Slik angrer kunden

Alle bunntekster, bestillingssider og e-poster om bestillinger lenker til butikkens side for angrerett. Kunden oppgir bestillingsnummeret
og e-postadressen sin, velger varene, trykker **Angre avtalen her** og bekrefter deretter. De blir aldri spurt om en grunn.

Kunden får en bekreftelse på e-post med en gang, og angringen kommer under Returer. Mislykkes e-posten, gjelder angringen likevel:
returen viser **Bekreftelsen ble ikke sendt**, og **Send bekreftelsen på nytt** sender den.

### Når de 14 dagene starter

De 14 dagene regnes fra den dagen kunden mottok varene, fra den siste pakken når de kom i flere deler. Til den dagen er registrert, kan
kunden fortsatt angre. Med Posten / Bring registreres den fra sporingen. Ellers trykker du **Merk varene som mottatt av kunden** under
**Returer og angringer** på bestillingen og oppgir dagen.

## Behandle en retur

Åpne **Returer** i menyen. Køen viser hva som er åpent, hva som er **Til godkjenning**, og hva som er **Over fristen for
tilbakebetaling**. Åpne en retur og følg stegene:

1. **Godkjenn eller avslå**, bare for en returforespørsel. Trykk **Godkjenn returen**, med returadresse og instruksjoner, eller **Avslå
   returen** med grunnen. Kunden får e-post i begge tilfeller. En angring godkjennes av seg selv.
2. **Varene.** Trykk **Merk som på vei** når kunden har sendt dem, og **Merk som mottatt** når de kommer. Kunden får e-post om at de er
   kommet.
3. **Kontroller varene.** For hver linje velger du **Tilstand**, hvor mange som legges tilbake på lager, og et eventuelt trekk for
   verdiforringelse med hva det gjelder. Trykk **Lagre kontrollen**.
4. **Tilbakebetaling.** Returen viser hvordan tilbakebetalingen regnes ut. Trykk **Tilbakebetal** med beløpet som vises, så går pengene
   tilbake til kundens betaling gjennom Stripe.
5. **Avslutt** returen når den er ferdig.

> [!IMPORTANT]
> Et trekk gjelder bare håndtering utover det som trengs for å se hva varene er og at de virker, slik som i en butikk. Det er aldri mer
> enn varene er verdt. Du kan sette opp beløpet for en angring, med en begrunnelse, men aldri ned under utregningen.

### Slik regnes tilbakebetalingen ut

Det kunden betalte for varene som returneres, etter alle rabatter, minus trekket du satte da du kontrollerte dem. Angres hele
bestillingen, legges den opprinnelige standardfrakten til. Betaler kunden returfrakten, trekkes den fra.

### Når pengene skal tilbake

Som standard kan du vente til varene er tilbake, eller kunden viser at de er sendt, men aldri forbi fristen: 14 dager etter at du fikk
beskjed om angringen. Køen merker returer der fristen snart går ut eller er passert.

Angret kunden før noe ble sendt, er det ingenting å sende tilbake: hold de varene utenfor pakken, og pengene skal tilbake så snart du
har sjekket det.

## En angring på e-post, i brev eller på telefon

En tydelig beskjed om at kunden angrer, gjelder også. Åpne bestillingen, og under **Returer og angringer** trykker du **Registrer en
angring kunden gjorde utenfor skjemaet**. Oppgi hvordan og når kunden sa fra, og hva de angrer. Den registreres slik skjemaet ville
gjort, og kunden får bekreftelsen.

## Returreglene dine

Eiere setter dem under [Innstillinger, Returer](/admin/{store}/settings/returns). Standardvalgene er lovens.

| Innstilling | Hva den gjør |
|---|---|
| **Returvindu (dager)** | 14 til 100. Dager utover 14 er ditt eget tilbud: kundene sender en returforespørsel du kan avslå. |
| **Fraktid (dager)** | 0 til 14. Ditt anslag over hvor lang tid leveringen tar, vist som et anslag så lenge ingen mottaksdag er registrert. |
| **Returfrakt** | Kunden betaler (standard, hvis du sier det før de kjøper), eller butikken betaler. Hver bestilling beholder valget den ble lagt inn med. |
| **Når tilbakebetalinger skjer** | Når varene er tilbake eller vist å være sendt (standard), eller så snart kunden ber om det. |
| **Hva som kan komme tilbake** | Godta også varer loven unntar, og returforespørsler fra bedrifter, som forespørsler du kan avslå. |
| **Hvor varer sendes tilbake** | Tomt betyr butikkens postadresse. |
| **Instruksjoner til kundene** | Hvordan varene pakkes og sendes tilbake, på hvert av språkene dine. Praktisk hjelp, ikke juridiske løfter. |

Varer som loven unntar, som varer laget etter bestilling eller åpnede hygieneprodukter, merkes i hvert produkt under **Angrerett**.

## Returetiketter

Med en transportør som bestiller returetiketter koblet til (se [Transportører](/docs/owners/shipping/carriers)): Posten / Bring, PostNord,
Instabox, UPS eller DHL Paket, velger du den som **Transportør** under **Returetiketter** i Innstillinger, Returer, med **Returtjeneste**
eller transportørens standard. Kryss av for **Bestill returetiketter for angringer automatisk**, som
er av som standard, for å få en etikett bestilt for hver angring i løpet av noen minutter.

For å bestille en selv åpner du returen og trykker **Bestill en returetikett hos** transportøren under **Returfrakt**. Kunden får en
e-post med en knapp for å skrive den ut, og finner den på siden for returen sin.

Betaler kunden returfrakten, trekkes ingenting fra når etiketten bestilles. Ved tilbakebetalingen trykker du **Pakken kom med etiketten:
trekk fra …** bare hvis den kom tilbake med den etiketten: da trekkes kostnaden, aldri mer, fra. En testetikett trekkes aldri fra.

Du kan også lime inn en lenke til en etikett i returinstruksjonene, eller la kunden sende varene selv.

## Flere valg

- **Bytte** lar returens tilgode betale for andre varer i stedet for penger tilbake: se
  [Tilbakebetaling, kansellering og bytte](/docs/owners/orders/refunds-and-exchanges).
- En returforespørsel kunden ikke lenger vil gjennomføre, kanselleres med **Kanseller returen**. En angring kanselleres aldri: kommer
  varene aldri tilbake, avslutter du den uten tilbakebetaling og skriver hvorfor i notatet.
- Hvem i teamet som får e-post om nye returforespørsler og forfalte tilbakebetalinger, velger du under Varsler til ansatte: se
  [Varsler](/docs/owners/team-and-settings/notifications).
