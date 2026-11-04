---
title: Rapporter for mva., OSS og IOSS
summary: Se merverdiavgiften per land og sats, grunnlaget for den kvartalsvise OSS-meldingen og den månedlige IOSS-meldingen, og eksporter CSV-filene regnskapsføreren trenger.
track: owners
section: markets-and-tax
kind: how-to
areas: [tax, analytics]
features: []
plans: []
admin: /admin/{store}/analytics/tax
order: 30
checked: 2026-11-04
sources: [D161, D159, D157]
---

> [!IMPORTANT]
> Dette er dine egne tall, laget av fakturaene og kreditnotaene dine, for deg og regnskapsføreren din. De er ikke en mva-melding eller
> en OSS- eller IOSS-melding, og Kaizena Flow sender ingenting inn.

## Før du starter

Rapportene lages bare av fakturaene og kreditnotaene dine. Er fakturering slått av, slår du den på under Innstillinger,
[Fakturering](/admin/{store}/settings/invoices): se [Fakturaer og kreditnotaer](/docs/owners/orders/invoices-and-credit-notes). En
betalt bestilling uten faktura legges ikke til tallene: den telles, med årsaken, i avstemmingen.

Registreringer i EUs OSS- og IOSS-ordning legges inn under Innstillinger, Avgift: se [Merverdiavgift](/docs/owners/markets-and-tax/vat).

## Åpne rapportene

Åpne **Analyse** i menyen og velg [Merverdiavgift](/admin/{store}/analytics/tax). Siden har tre faner:

- **Mva. per land og sats**, for hvilken som helst periode;
- **Grunnlag for OSS-melding**, per kvartal;
- **Grunnlag for IOSS-melding**, per måned.

## Mva. per land og sats

Velg en periode øverst; siden starter på forrige måned. Kortene viser **Beregnet mva.**, **Kreditert mva.**, **Mva. etter kreditering**,
**Netto salg etter kreditering** og hvor mange fakturaer og kreditnotaer det er, i hovedvalutaen din.

Tabellen **Mva. per land og sats** har én rad for hvert leveringsland, hver sats, hver behandling (*Alminnelig*, *Omvendt avgiftsplikt*,
*Unntatt* eller *IOSS*) og hver valuta. Den siste kolonnen, **Rapporteres i**, sier hvor merverdiavgiften hører hjemme: mva-meldingen i
ditt eget land, en del av OSS-meldingen, IOSS-meldingen, eller ingen melding og hvorfor. Frakt står under satsen den ble belastet med.

Greit å vite:

- En faktura dateres etter betalingsdagen. En kreditnota telles i perioden den utstedes.
- Beløpene skrives med desimalpunktum, slik filene skriver dem, uansett hvilket språk administrasjonen din har.
- En bestilling med både varer og nedlastinger klassifiseres etter varene.

### Avstemming

Under tabellen viser **Avstemming** hvordan rapporten stemmer med [Økonomi](/admin/{store}/analytics/finance) og bestillingene dine, i
hver valuta. Økonomi teller en bestilling den dagen den ble lagt inn, så de to kan avvike; hver forskjell er navngitt og telt. Når alt er
forklart, står det *Lik: hver differanse har et navn.*

## Grunnlag for OSS-melding

Velg **Kvartal** og trykk **Vis**; siden starter på det siste avsluttede kvartalet. Tallene er i euro, satt opp som delene i meldingen:

- **Del 2**: salg per forbruksmedlemsstat og sats (*2a* tjenester, *2b* varer sendt fra identifikasjonsmedlemsstaten din, *2d* varer
  sendt fra en annen medlemsstat);
- **Del 3**: korreksjoner av tidligere perioder;
- **Del 4**: saldo per medlemsstat;
- **Del 5**: å betale, summen av de positive saldoene.

Du bytter mellom to visninger med ett trykk:

- **Melding** viser hva en melding for perioden inneholder: en kreditnota fra samme kvartal reduserer del 2, en senere er en korreksjon i
  del 3 av kvartalet salget hørte til.
- **Regnskap** er bokføringens bilde: hver kreditnota telles i perioden den utstedes, så del 2 kan bli negativ, og det finnes ingen del 3.

Under delene viser **Ikke med i denne meldingen** salgene i perioden som hører hjemme et annet sted, med grunnen, og **Registrering** sier
hva avgiftsprofilen din oppgir. Hver melding viser fristen, merket *Fristen nærmer seg* eller *Fristen er passert* når den nærmer seg
eller er passert.

Er ingen OSS-registrering lagt inn, viser siden likevel tallene en melding ville inneholdt, under en overskrift som sier det.

> [!NOTE]
> En melding spør også etter mva- eller skattenummeret medlemsstaten du sender varer fra, har gitt deg. Det har ikke Kaizena Flow, så du
> fyller det inn selv.

## Grunnlag for IOSS-melding

Det samme, måned for måned, for bestillinger merket med IOSS-nummeret ditt. Det er slått av til Innstillinger, Avgift har et
IOSS-nummer og markedene det gjelder for. Har du oppgitt en representant der, sender vanligvis representanten inn meldingen: filen med
grunnlaget er det du gir dem.

## Eurokurser

Beløpene for OSS og IOSS regnes om til euro med ECBs referansekurs for periodens siste dag, eller for den neste dagen ECB publiserte en.
**Eurokurser** viser hver valuta med kursen og hvor den kom fra.

Mangler en kurs, er meldingen ufullstendig, og filen med grunnlaget tilbys ikke. En eier kan trykke **Hent fra ECB**, eller
**Legg inn en kurs** med en begrunnelse, som da vises overalt der kursen brukes.

## Eksporter filene

Hver visning har CSV-filer til regnskapsføreren, med faste oppsett og på engelsk:

| Fil | Hvor |
|---|---|
| **Eksporter mva. per land og sats (CSV)** | Mva. per land og sats |
| **Eksporter avstemmingen (CSV)** | Avstemming |
| **Eksporter grunnlaget for OSS-meldingen (CSV)**, **Eksporter grunnlaget for IOSS-meldingen (CSV)** | Grunnlag for OSS- og IOSS-melding |
| **Eksporter detaljene om omregningen (CSV)** | Grunnlag for OSS- og IOSS-melding: hver omregning med kursen |

Eksport krever skrivetilgang til Analyse; alle som kan lese Analyse, ser tallene. Hver eksport logges. Endres tallene for en periode etter
at du eksporterte den, sier siden fra med differansen, som hører hjemme i neste melding som en korreksjon hvis du allerede har sendt inn.

## Greit å vite

- Hver bestilling tar vare på landet varene ble sendt fra, landet ditt og OSS-medlemsstaten din slik de var da bestillingen ble lagt inn.
  Endrer du avgiftsinnstillingene senere, flytter det aldri en periode du har rapportert.
- KI-assistenten kan lese disse rapportene for deg; den lager aldri en fil. Se [KI-assistenten](/docs/owners/ai/the-ai-manager).
- La regnskapsføreren sjekke hvordan salgene klassifiseres før du stoler på tallene.
