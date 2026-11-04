---
title: Toll og importmva.
summary: Velg for hvert land utenfor tollområdet ditt om kunden betaler toll og importmva. til transportøren ved levering, eller sammen med bestillingen i kassen.
track: owners
section: markets-and-tax
kind: how-to
areas: [tax, shipping, settings]
features: []
plans: []
admin: /admin/{store}/settings/customs
order: 40
checked: 2026-11-04
sources: [D343, D157]
---

## Når det gjelder

Varer som krysser en tollgrense, kan bli ilagt toll og importmva. i landet de kommer til: for eksempel varer sendt fra Norge til et
EU-land. Varer som sendes innenfor ett land, eller mellom to EU-land, krysser ingen tollgrense, og ingenting her gjelder dem.

Kaizena Flow finner ut hvilke av landene dine som ligger over en grense, ut fra hvor varene sendes fra: **Varene sendes fra** på
[Avgift](/admin/{store}/settings/tax), ellers butikkens land. Se [Merverdiavgift](/docs/owners/markets-and-tax/vat).

> [!IMPORTANT]
> Alle beløp her er anslag ut fra Kaizena Flows satstabell, med kilde for hver sats. Det er tollmyndighetene som avgjør hva som skal
> betales. Dette er ikke tollrådgivning.

## Velg hvem som betaler

Åpne **Innstillinger** i menyen og velg [Toll og importmva.](/admin/{store}/settings/customs) under Salg. Der står hvert av landene dine
som varene krysser en grense inn til. For hvert av dem velger du under **Hvem betaler toll og importmva.** og trykker **Lagre**:

- **Kunden betaler transportøren ved levering (DAP)**: standardvalget. Ingenting ekstra belastes i kassen. Handlekurven og bestillingen
  viser et anslag over hva transportøren kan kreve inn, før transportørens egne gebyrer, eller at det ikke kan anslås.
- **Innkreves i kassen sammen med bestillingen (DDP)**: kunden betaler et anslag over toll og importmva. sammen med bestillingen, og du
  gjør opp med tollmyndighetene. Transportøren skal ikke kreve dem inn ved levering.

Ligger ingen av landene dine over en grense, sier siden at det ikke er noe å velge.

## Hva kundene ser

- **Med DAP** står det i handlekurven, på bestillingssiden og i bekreftelsen på e-post at eventuell toll og importavgifter betales til
  transportøren ved levering, med vårt anslag der det finnes et.
- **Med DDP** har handlekurven en rad *Toll og importavgifter*, merket som anslag, og bestillingssiden og bekreftelsen på e-post viser hva
  som ble betalt i kassen.

## Før du velger DDP

DDP krever et anslag for alt i handlekurven. Der det ikke finnes et, kan bestillingen ikke betales:

- **Alle varer som sendes dit, må ha HS-kode.** I redigeringen av produktet åpner du **Strekkode, kostpris, vekt, innhold og toll** på
  hver variant og fyller inn **Tolltariffnummer (HS-kode)** og **Opprinnelsesland**. Så lenge et land står på DDP, viser siden hvor mange
  varer som mangler HS-kode. En kunde som har en slik vare i handlekurven, blir bedt om å fjerne den.
- **Satstabellen må dekke landet.** Der den ikke gjør det ennå, står det under landet, og en bestilling med toll innkrevd i kassen kan
  ikke betales.
- **Satstabellen må ha en sats for varene dine.** Tabellen er fortsatt liten, så mange varer har ingen sats ennå. Kunden får da beskjed
  om at tollen ikke kan beregnes, og om å kontakte deg.

> [!TIP]
> Før du setter et land på DDP, legger du varene dine i en handlekurv for det landet. Kan handlekurven anslå hva transportøren kan kreve
> inn, kan kassen kreve det inn.

## Slik går pengene med DDP

- Tollen belastes ved siden av bestillingens totalbeløp, som en egen linje ved betaling. Den står ikke på fakturaen, og er ikke med i
  mva-rapportene eller salgstallene dine.
- Kaizena Flow tar ikke noe gebyr av den, og et gavekort betaler den aldri.
- Abonnementer, opphold og utleie som eksterne verter legger ut, en del som betales på stedet, og bestillinger med betalingsfrist er alltid
  DAP, uansett hva du velger. Utkast til bestillinger og bytter krever aldri inn toll.

## Flere valg

### Kreve inn landets mva. i kassen

For et land utenfor EU krysser du av for **Jeg er registrert for å kreve inn landets mva. i kassen (som VOEC i Norge)** hvis du er det.
Anslaget følger da den ordningens regler. For EU-land er det IOSS-registreringen din på siden Avgift som avgjør dette.

### Bestille pakker over en grense

En bestilling hos et fraktselskap over en tollgrense har med tollinjene for innholdet (HS-kode, opprinnelse, verdi, vekt). Mangler de,
avviser Kaizena Flow bestillingen før fraktselskapet blir spurt. Med Bring sendes linjene til Brings tolltjeneste. Se
[Fraktselskaper](/docs/owners/shipping/carriers).
