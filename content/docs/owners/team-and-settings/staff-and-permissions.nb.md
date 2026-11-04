---
title: Ansatte og tilgang
summary: Inviter folk til å arbeide i butikken, velg hva hver rolle kan se og endre, gi et byrå tilgang for en periode, og se hvem som endret hva.
track: owners
section: team-and-settings
kind: how-to
areas: [team, settings]
features: []
plans: []
admin: /admin/{store}/staff
order: 10
checked: 2026-11-04
sources: [D107, D158, D314]
---

## Inviter noen

1. Åpne **Innstillinger** og velg [Team](/admin/{store}/staff), under Konto. Bare eiere kan åpne siden.
2. Under **Inviter noen** skriver du inn **E-post** og velger en **Rolle**.
3. Trykk **Inviter**.

Kaizena Flow sender ingen invitasjon på e-post: be personen logge inn på innloggingssiden til administrasjonen, `/admin/sign-in`, med
den e-postadressen. De kan be om en innloggingslenke på e-post, og sette et passord etterpå under **Din konto**. Ansatte beholder
tilgangen til du fjerner den.

Rollene du kan gi, er:

- **Eier**: alt, også teamet og abonnementet. En butikk kan ha flere eiere.
- **Administrator (alt unntatt teamet og abonnementet)**.
- En av butikkens roller, nedenfor.

> [!TIP]
> Abonnementet ditt kan begrense hvor mange som arbeider i butikken. Se [Velg et abonnement](/docs/owners/getting-started/choose-a-plan).

## Rollene du starter med

Hver butikk starter med disse rollene, som du kan endre eller slette:

| Rolle | Hva den kan gjøre |
|---|---|
| Ordre | Håndterer ordre og returer, og kan slå opp kunder og produkter. |
| Produkter | Holder katalogen i orden: produkter, priser, lager og oppsett. |
| Markedsføring | Kjører kampanjer, rabattkoder, tester og e-poster, og leser tallene. |
| Innhold | Skriver og utformer nettstedet: sider, blogg, menyer, bilder og oversettelser. |
| Analyse | Leser tallene og det som ligger bak dem. |
| Kundestøtteagent | Svarer kunder i innboksen for kundestøtte, og kan slå opp ordrene, kontoene og produktene deres. |
| Kun lesetilgang | Kan se på alt unntatt abonnement og faktura og teamet, og endre ingenting. |

I teamlisten velger du en ny rolle ved siden av en person og trykker **Endre rolle**, eller trykker **Fjern tilgang** for å ta bort
tilgangen. Du kan ikke fjerne din egen tilgang.

## Lag din egen rolle

1. Trykk **Roller** på **Team**.
2. Gi rollen et **Navn** under **Lag en rolle**.
3. Velg **Ingen tilgang**, **Kan se** eller **Kan endre** for hver del av administrasjonen (Ordre, Produkter, Kunder, Markedsføring,
   Analyse, Nettsted, Bookinger, Kundestøtte, Innstillinger). *Kan endre* gir også *kan se*. Ved teamet og abonnementet står det *Bare
   eiere: en rolle kan ikke gi dette*.
4. Trykk **Lag rollen**.

En side rollen ikke kan åpne, er skjult i menyen til den som har rollen. Endrer du en rolle, endres det alle som har den kan gjøre, med
en gang. En rolle kan bare slettes når ingen har den.

## Gi et byrå tilgang for en periode

En samarbeidspartner, for eksempel et byrå eller en frilanser, får en rolle og en sluttdato. En samarbeidspartner er aldri eier og ser
aldri teamet eller abonnementet.

1. Under **Inviter en samarbeidspartner** på **Team** skriver du inn **E-post** og velger en **Rolle**.
2. Sett **Tilgangen varer (dager)**: 1 til 365.
3. Trykk **Inviter samarbeidspartner**.

Teamlisten viser *Samarbeidspartner til* sluttdatoen. Skriv et tall i **Dager fra i dag** og trykk **Forleng** for å gi mer tid, eller
fjern tilgangen før. Når tiden er ute, slutter tilgangen av seg selv.

## Se hvem som endret hva

Åpne **Innstillinger** og velg [Aktivitetslogg](/admin/{store}/activity), under Konto. Den viser hva folk har endret i butikken, og
når: produkter, priser, sider, rabattkoder, frakt, teamet og betalingsinnstillingene. Endringer KI-assistenten gjorde for noen, er merket
med det.

- Filtrer på **Person**, **Område**, **Handling** og dagene **Fra** og **Til**, og trykk **Filtrer**.
- Eiere ser alle oppføringer. Alle andre ser sine egne oppføringer og dem fra de delene av administrasjonen de kan åpne.
- Oppføringene tas vare på i 24 måneder og kan ikke endres.
- Eiere kan laste ned loggen: velg **Første dag** og **Siste dag** under **Last ned som regneark (CSV)** og trykk **Last ned CSV**. Én
  fil har plass til 50 000 oppføringer.

## Flere valg

### Arbeid i flere butikker

Hver butikk har sitt eget team og sine egne roller, så en person kan være eier i én butikk og ha en rolle i en annen. Du logger inn på
samme måte for alle.

- **Som eier** åpner administrasjonen på [Kontrollsenter](/admin): alle butikkene du arbeider i, i et blikk, hva som trenger deg først,
  ukens salg og de siste bestillingene. **Butikker** viser butikkene dine, der du kan lage eller kopiere en.
- **Som ansatt** åpner administrasjonen på butikken din, eller på listen over butikker når du arbeider i flere.
- Bytt mellom butikker med velgeren øverst i administrasjonen.

Hver butikk har sitt eget abonnement. **Abonnement og faktura** på kontoen din viser abonnementet til hver butikk du eier, og
[Bruk og grenser](/admin/account/limits) hva hver har brukt. Krav om totrinnsinnlogging velges butikk for butikk: se
[Sikkerhet](/docs/owners/team-and-settings/security).
