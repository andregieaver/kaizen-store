---
title: Utbetalinger og gebyrer
summary: Se hva Stripe har betalt inn til banken din, hva hver utbetaling gjør opp og om den stemmer, og hva Stripe og Kaizena Flow tar av hvert salg.
track: owners
section: payments
kind: how-to
areas: [payments, analytics]
features: []
plans: []
admin: /admin/{store}/analytics/payouts
order: 30
checked: 2026-11-04
sources: [D17, D288, D289, D290]
---

## Slik kommer pengene til deg

Kundene betaler inn på butikkens egen Stripe-konto. Stripes gebyr og Kaizena Flows gebyr trekkes av hver betaling, og Stripe betaler
resten ut til banken din etter sin egen plan. Hver overføring til banken er en utbetaling. Bankkontoen er den du oppga til Stripe da du
[satte opp betalinger](/docs/owners/payments/set-up-payments); du endrer den under **Virksomhets- og bankopplysninger** på Betalinger.

## Se utbetalingene

Åpne **Analyse** i menyen og velg [Utbetalinger](/admin/{store}/analytics/payouts). Velg perioden øverst. Hver utbetaling som kommer i
perioden, har en rad:

- **Kommer**: dagen den kommer inn på kontoen din.
- **Status**: *Venter*, *På vei*, *Betalt*, *Mislyktes* eller *Kansellert*.
- **Beløp** og **Stripes gebyrer**.
- **Gjør opp**: hva den inneholder, som betalinger, refusjoner og tvister.
- **Avstemming**: om den stemmer med ordrene dine.

Hver utbetaling står i sin egen valuta, slik Stripe betalte den; summene er de betalte utbetalingene i butikkens hovedvaluta.
Testutbetalinger er listet, men ikke med i summene. En utbetaling vises når Stripe melder den, så en ny kan bruke litt tid på å dukke opp.

**Last ned CSV** gir deg periodens utbetalinger som en fil til regnskapet.

### Stemmer det?

Kolonnen **Avstemming** sier for hver utbetaling:

- *Stemmer*: betalingene, refusjonene, tvistene og gebyrene i den blir det som kom inn på kontoen.
- *Stemmer ikke*, og med hvor mye.
- *Penger uten ordre*: en betaling tatt direkte i Stripe, eller en Kaizena Flow ikke har registrert.
- *Manuell utbetaling*: gjort manuelt i Stripe, som ikke lister hva den gjør opp.
- *Ikke lest ennå*: hva den gjør opp, leses når den er betalt. Sjekk igjen senere.
- *For mange posteringer til å lese*: Stripes egen utbetalingsrapport har alle.

Når en utbetaling ikke stemmer, sier en merknad under listen fra. Åpne den for å se posteringene.

### Én utbetaling

Trykk på datoen til en utbetaling under **Kommer** for å se hva den gjør opp, postering for postering: hver **Betaling**, **Refusjon**,
**Tvist**, **Stripe-gebyr** eller **Justering**, med ordren den gjelder, **Brutto**, **Gebyr** og **Netto**, og Stripes referanse. En
postering som ikke kunne knyttes til en ordre, sier det.

## Gebyrene

### Stripes gebyr

Stripe setter sin egen pris for hver betaling. Kaizena Flow leser gebyret Stripe faktisk tok for hver betaling.

Analyse, [Økonomi](/admin/{store}/analytics/finance) viser **Betalingsgebyrer** for perioden. For hver ordre der alle betalingene har
fått gebyret sitt fra Stripe, er det det gebyret. For resten er det ditt eget anslag, fra **Betalingsgebyr, prosent av hver ordre** og
**Betalingsgebyr, fast beløp per ordre** i [Innstillinger for analyse](/admin/{store}/analytics/settings), og linjen heter da
*Betalingsgebyrer (anslått)*. Har du ikke lagt inn noe anslag, regnes de ordrene uten gebyr.

### Kaizena Flows gebyr

Kaizena Flow tar et gebyr av hvert salg: en andel av det kunden betaler, trukket fra betalingen når kunden betaler. Hvor stort det er,
avhenger av abonnementet ditt. **Abonnement og faktura** viser det som **Kaizena Flows gebyr**, og hvert abonnements kort viser sitt; se
[Velg et abonnement](/docs/owners/getting-started/choose-a-plan).

Hva Kaizena Flow har tatt, ser du som **Plattformgebyrer** under Økonomi, og som **Kaizena Flows gebyr** på kortet **Fortjeneste** på en
bestilling.

- På en utbetaling er **Gebyr** på en postering og utbetalingens **Stripes gebyrer** med Kaizena Flows gebyr i tillegg til Stripes.
- Når du belaster mindre enn det som er reservert på et kort, tas Kaizena Flows gebyr av det du belaster.
- En betaling du registrerer som tatt utenfor Kaizena Flow, for eksempel en bankoverføring eller kontanter, har ikke noe gebyr: Kaizena
  Flow har ikke rørt pengene.
- På en Mollie-betaling gis ikke Kaizena Flows gebyr tilbake når du gjør en tilbakebetaling.

## Flere valg

### Betalinger etter betalingsmetode

Økonomi har også **Betalinger etter betalingsmetode**: hva periodens betalte ordrer ble betalt med, antall betalinger, pengene mottatt
inkl. mva., refusjoner og gebyrer, og en CSV-fil. En merknad sier fra når betalingsmetoden for en betaling ikke er kjent ennå: Kaizena Flow
leser den fra Stripe kort tid etter betalingen.

### Tapte tvister

En tvist banken avgjør mot deg, er penger ut, og vises under Økonomi som **Tapte tvister**. Se
[Tilbakeføringer og risiko](/docs/owners/payments/disputes-and-risk).
