---
title: Chatassistenten
summary: Sett en KI-chatassistent i butikken som svarer kundene ut fra det butikken publiserer, og gir dem videre til teamet ditt når det trengs et menneske.
track: owners
section: ai
kind: how-to
areas: [ai, customers, website]
features: []
plans: []
admin: /admin/{store}/chat
order: 30
checked: 2026-11-04
sources: [D81, D216, D334, D382, D391, D428]
---

## Slå den på

1. Åpne **Kundestøtte** i menyen og velg [Chatassistent](/admin/{store}/chat).
2. Under **Agenten** krysser du av for **Vis chatten på nettstedet** og gir den et **Navn**. Vil du, legger du til et bilde, en
   **Stilling** (for eksempel *Kundeservice*) og en **Hilsen** for hvert språk; står hilsenen tom, presenterer den seg med navn.
3. Under **Veiledning for agenten** skriver du med dine egne ord hvilken tone den skal ha og hva den skal trekke fram, for eksempel
   *Vennlig og kort. Foreslå gaveinnpakning til presanger.* Den følger veiledningen innenfor sine egne regler.
4. Trykk **Lagre**.

Da vises chatten i hjørnet av hver side i butikken. Butikkens KI må ha en tekstmodell: til den har det, står det på siden *På, men
skjult til nettstedet har en KI-tekstmodell.*

## Hva den svarer ut fra

Chatassistenten svarer bare om butikken din, ut fra det butikken publiserer:

- de publiserte sidene og artiklene dine, og innholdsoppføringene nettstedet viser;
- produktene dine, med priser og lager, og frakt, land og kontaktopplysninger;
- dokumentene i **Kunnskapsbase**.

Den oppgir produkter, priser, lager og vilkår bare slik butikken gir dem: KI-en finner dem aldri på. Produkter den finner, vises som
kort som butikken tegner, med butikkens egne priser. Den kan åpne sider i butikken for kunden mens dere snakker: et produkt, en side,
en artikkel, et søk eller handlekurven.

Alt sidene, artiklene eller kunnskapsbasen din handler om, er innenfor temaet, også en sammenligning med et annet selskap: den søker
før den sier at den bare kan hjelpe med butikken din, og sier ingenting om det andre selskapet som sidene dine ikke sier. Alt annet
avviser den. Setninger med miljøpåstander, falsk hast eller påstander om laveste pris fjernes fra svarene.

### Gi den mer kunnskap

Kunnskapsbasen har det den bør vite utover sidene dine: levering og retur i detalj, vedlikeholdsråd, størrelser, åpningstider, svar
på vanlige spørsmål.

1. Under **Legg til et dokument** gir du det en **Tittel**.
2. Velg en fil (tekst, Markdown, PDF eller Word, opptil 4 MB), eller lim inn teksten under **Eller teksten**.
3. Trykk **Legg til i kunnskapsbasen**.

Skriv bare det som kan sies til hvem som helst: assistenten kan sitere det for kundene. Legg aldri inn personopplysninger. En
kunnskapsbase har plass til 100 dokumenter. Sidene dine leses på nytt innen fem minutter etter at de er publisert.

## Hva kundene får vite

Chatten sier at den er en *AI-assistent*. Under meldingsfeltet leser kundene at svarene lages av KI og kan inneholde feil, og at de
ikke skal dele personopplysninger i chatten, og deretter hvor lenge samtalen tas vare på. Med KI-en først og teamet ditt bak (se
under) står det: *Du chatter med* assistentens navn*, en AI-assistent. Du kan når som helst be om å snakke med en person.*

Når kundestøtten lar KI-en lese tonen i kundenes meldinger, eller lage sammendrag av samtaler til teamet ditt, sier meldingen det
også, før kunden skriver. **Innstillinger for kundestøtte** viser hvilke av de to som er på, og at kundene får vite det.

## Gi videre til mennesker

Hvem som svarer kundene, velger du i [Innstillinger for kundestøtte](/admin/{store}/support/settings) (Kundestøtte,
Innstillinger), under **Hvem som svarer kundene dine**:

| Valg | Hva som skjer |
|---|---|
| **Kundeservice av – chat-assistenten alene** | Chatassistenten svarer selv. Ingen tar over, og samtaler tas vare på i en dag etter at de er avsluttet. |
| **KI-en først, så teamet ditt** | Assistenten svarer først. En kunde kan trykke *Snakk med en person* når som helst, og assistenten gir videre når den ikke kan hjelpe. |
| **Bare teamet ditt** | Folkene dine svarer på alle samtaler. KI-en skriver aldri til kundene dine. |

Med KI-en først går en samtale også til teamet ditt når KI-en ikke svarer, når chattens meldinger for dagen er brukt opp, eller når
tonen til en kunde faller forbi grensen du har satt. Samtaler som venter på et menneske, ligger i
[Innboks for kundestøtte](/admin/{store}/support), og fanen Kundestøtte viser hvor mange som venter. Åpne en og trykk **Ta over** for
å svare; **Gi tilbake til KI-en** gir den tilbake.

For en kunde som logger inn i chatten, kan KI-en først slå opp kundens egne bestillinger, pakker, returer, timer og abonnementer. Den
kan tilby handlingene du tillater under **Hva KI-en kan gjøre for kundene**, for eksempel å flytte en time eller sende
ordrebekreftelsen på nytt: ingenting skjer før kunden trykker *Bekreft*. Alt annet, som en tilbakebetaling, å kansellere en betalt
bestilling eller en ny adresse, sender den videre til teamet ditt som en forespørsel under [Forespørsler](/admin/{store}/support/requests);
kunden får beskjed når du har avgjort den. KI-en gir aldri selv en tilbakebetaling, en kode eller kreditt, og den gjennomfører aldri en
angring eller en endring av en bestilling.

## Flere valg

- **La besøkende snakke**: kundene trykker på mikrofonen og snakker, og assistenten svarer høyt i tillegg. Den trenger talemodeller og
  en stemme i butikkens [KI-innstillinger](/admin/{store}/settings/ai); til da skrives chatten bare.
- **Meldinger per dag**: etter så mange hviler chatten til neste dag, så kostnaden har et tak. Med KI-en først går samtalene til
  teamet ditt i stedet.
- **Bilderamme**: bakgrunn, kantlinje og skygge rundt assistentens bilde.
- **Ta vare på samtalene i** 30, 60 eller 90 dager etter at en samtale er avsluttet (90 til å begynne med, eierens valg), under
  Innstillinger for kundestøtte, Avansert. Deretter slettes ordene, og bare antall tas vare på.
- **Denne butikken håndterer helseopplysninger eller andre sensitive opplysninger.** Når dette er på, leser ingen KI det kundene
  skriver: folk, ikke KI-en, svarer i chatten og på e-post, og samtalene lagres i høyst 30 dager.
- Meldinger fra kontaktskjemaene dine kan komme inn i innboksen mens kundestøtten er på. KI-en leser eller svarer aldri på dem.
- **Kundeservice på e-post**: videresend kundeserviceadressen din til innboksen, så blir hver e-post en samtale der. Med KI-en først
  svarer assistenten på generelle spørsmål på e-post; alt om en bestilling går til et menneske, og hvert svar fra KI-en sier at det er
  KI-ens.
