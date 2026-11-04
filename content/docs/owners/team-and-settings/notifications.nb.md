---
title: E-poster og varsler
summary: Velg hvilke e-poster kundene får om bestillinger og returer, skriv dem med dine egne ord, velg hvem i teamet som får beskjed om hva, og se alle e-postene butikken har sendt.
track: owners
section: team-and-settings
kind: how-to
areas: [settings, orders, integrations]
features: []
plans: []
admin: /admin/{store}/settings/notifications
order: 30
checked: 2026-11-04
sources: [D26, D101, D238, D348, D361]
---

## E-postene kundene dine får

Butikken sender kundene e-post av seg selv når noe skjer med bestillingen eller returen deres. E-postene sendes i butikkens navn, på
bestillingens språk, og svar går til butikkens kontaktadresse under **Innstillinger**, **Virksomhet**.

Åpne **Innstillinger** og velg [Varsler](/admin/{store}/settings/notifications), under Salg. E-postene står i tre grupper:
**Bestillinger**, **Henting og lokal levering** og **Returer**. Hver viser når den sendes, og om den er **På**, **Av**, **Alltid på**
eller **Fast**. Trykk **Slå av** eller **Slå på** for å endre en.

- **Alltid på**, fordi loven eller pengene krever det: *Ordrebekreftelse*, *Fornyet abonnement*, *Endret bestilling*, *Retur godkjent*,
  *Retur avslått*, *Bytte: betaling bedt om* og *Bytte fullført*.
- **Fast**, sendes alltid og kan ikke endres: *Kvittering for bruk av angreretten*, som tas vare på som bevis, og *Gavekort*, det
  eneste stedet kortets kode gis.
- **Av til du slår dem på**: *Ute for levering (transportør)* og *Levert (transportør)*.
- **På til du slår dem av**: alle de andre, for eksempel *Bestilling sendt*, *Refusjon* og *Bestilling kansellert*.

Slår du av en e-post, fjernes også haken ved **Varsle kunden** der ansatte sender, refunderer eller kansellerer en bestilling. Med
*Refusjon* slått av sendes kreditnotaen for en refusjon likevel.

> [!NOTE]
> E-postene om henting og lokal levering sendes først når butikken tilbyr henting eller levering med egen sjåfør. Se
> [Henting og lokal levering](/docs/owners/shipping/pickup-and-local-delivery).

## Skriv en e-post med dine egne ord

1. Trykk **Rediger** ved e-posten, og velg språk.
2. Fyll inn **Emne**, **Overskrift** og **Tekst**. Et felt som står tomt, bruker standardteksten. En tom linje starter et nytt avsnitt.
3. Legg til **Plassholdere** som `{order_number}` eller `{customer_first_name}`: de fylles inn for hver bestilling.
4. Trykk **Forhåndsvis** for å se den med en oppdiktet bestilling, eller **Send en test til meg** for å få den i din egen innboks.
5. Trykk **Lagre**.

Ordene dine erstatter bare emnet, overskriften og den første teksten. Kaizena Flow legger alltid til ordrelinjene, totalene,
opplysningen om merverdiavgift, lenken til fakturaen, sporing, opplysninger om henting og angreretten, på bestillingens eget språk og i
dens egen valuta. Nettadresser er ikke tillatt (e-postens knapper lenker til bestillingen), og en e-post om en bestilling skal ikke ha
tilbud: da er den markedsføring. **Bruk standardteksten** fjerner ordene dine igjen. Tekst du skriver selv, er ditt ansvar.

De som har en rolle som kan se **Innstillinger**, men ikke endre dem, kan lese e-postene, men ikke redigere dem.

## Gi teamet beskjed

Eiere velger hvem i teamet som får e-post. Trykk [Varsler til ansatte](/admin/{store}/settings/notifications/staff) på **Varsler**.
Kryss av for hver person, eller for butikkens kontaktadresse, hvilke varsler de skal få:

| Varsel | Sendes når |
|---|---|
| Ny bestilling | En bestilling er betalt. |
| Retur ønsket | En kunde vil returnere noe. |
| Refusjon forsinket | En refusjon er forsinket. |
| Lavt lager | Lageret begynner å bli lavt. |
| Tilbakeføring | En betaling blir bestridt. |
| Betaling forfalt | En bestilling på betalingsvilkår er ikke betalt i tide. |
| Automatisering | En av automatiseringsreglene dine sier at de ansatte skal få beskjed. |
| Statusrapport | Daglig eller ukentlig, med butikkens tall. |
| Analysevarsler | Én gang om dagen, når analysene finner noe. |

En boks vises bare der personens rolle kan lese det e-posten viser. E-poster til ansatte nevner bestillingen eller returen og hva som
ble kjøpt, aldri kundens navn, e-postadresse, telefonnummer eller adresse. Til du lagrer siden, får eierne nye bestillinger,
returønsker, lavt lager, tilbakeføringer og forfalte betalinger, og forsinkede refusjoner går til butikkens kontaktadresse.

Under **Statusrapport** velger du **Hvor ofte** (**Daglig (i går)** eller **Ukentlig (de siste sju dagene)**), dag og klokkeslett.
Under **Analysevarsler på e-post** velger du hvor mye du vil høre. Trykk **Lagre**, og **Send en test** for å se en i innboksen din.

## Se alle e-postene som er sendt

Åpne **Bestillinger** i menyen og velg [E-poster](/admin/{store}/emails). Hver e-post viser hvem den gikk til, emnet og om den kom fram:
*Sendes*, *Sendt*, *Levert*, *Mislyktes*, *Avvist (adressen tar ikke imot e-post)* eller *Merket som søppelpost av mottakeren*. Åpne
en for å lese den nøyaktig slik kunden fikk den. Siden til en bestilling og siden til en kunde viser også sine egne e-poster.

## Flere valg

### Varsler på telefonen

Administrasjonen kan legges på Hjem-skjermen på telefonen som en app. På **Din konto**, under **Varsler på denne enheten**, trykker du
**Slå på** ved en butikk og tillater varsler når nettleseren spør. Du får da et varsel på enheten for hver nye bestilling: bare
nummeret og summen, ingenting om kunden. På iPhone eller iPad legger du først Kaizena Flow til på Hjem-skjermen (Del, så Legg til på
Hjem-skjerm). Bare butikker der du kan lese bestillingene, står på listen, og under **Enheter som får dem** fjerner du en enhet med **Fjern**.

### Slack

Eiere kan la butikken skrive i en Slack-kanal når en bestilling er betalt, sendt, kansellert eller refundert, og ved nye kunder og
abonnementer. Åpne **Innstillinger**, [Integrasjoner](/admin/{store}/integrations), velg Slack og trykk **Legg til i Slack** (Slack spør
hvilken kanal), eller lim inn en webhook-adresse du har laget selv. Trykk **Send en test** for å se en melding komme fram. Meldingene
nevner kunden og hva de kjøpte, aldri e-postadressen eller adressen, og alle i kanalen ser dem: sørg for at avtalen din med Slack dekker
personopplysninger.
