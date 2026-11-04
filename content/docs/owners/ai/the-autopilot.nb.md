---
title: Autopiloten
summary: Gi KI-assistenten mål, la den jobbe seg gjennom planer i ditt navn mens du er borte, og velg hvor langt den kan gå uten å spørre deg.
track: owners
section: ai
kind: how-to
areas: [ai, analytics]
features: []
plans: []
admin: /admin/{store}/assistant/autopilot
order: 20
checked: 2026-11-04
sources: [D309, D328, D331, D334, D418]
---

Autopiloten er arbeidet [KI-assistenten](/docs/owners/ai/the-ai-manager) gjør på egen hånd: den jobber mot målene dine i planer med
steg, i bakgrunnen, og spør deg når noe trenger ditt ja eller et svar. Åpne KI-assistentens side og velg fanen **Autopilot**, eller
gå til [Autopilot](/admin/{store}/assistant/autopilot). Bare butikkens eiere har den.

## Sett et mål

Fortell KI-assistenten hva du vil oppnå, med dine egne ord: «Jeg vil ha 50 bestillinger i måneden innen juni». Den tar vare på målet
med opptil fem delmål, og måler dem med butikkens egne tall, aldri ved å gjette:

- nettosalg, eller betalte bestillinger, de siste 30 dagene;
- konvertering de siste 30 dagene, så lenge butikken teller besøk;
- at butikken er åpnet innen en dato;
- hvor mange aktive produkter, eller publiserte sider, butikken har.

Nettosalget er uten mva., minus tilbakebetalinger, i butikkens hovedvaluta. Fanen **Mål** viser hvordan det går med hvert mål. Et mål
er *Nådd* når alle delmålene er det; et tall som ikke kan vites, er *Ikke målt*, aldri 0. **Legg bort** legger bort et mål. En butikk
kan ha opptil fem aktive mål.

## Lag en plan og start den

I fanen **Planer** trykker du **Be KI-assistenten om en plan**, eller du spør i en samtale. Den foreslår en plan med opptil 30 steg:
endringer den gjør med ett av verktøyene sine, oppgaver den jobber med, spørsmål til deg, og ventetid til en dato. Les den, og be om
endringer til den er riktig.

Ingenting kjører før du starter planen: godkjenn kortet *Setter i gang arbeid i ditt navn*, eller trykk **Start** i fanen Planer. Du
starter nøyaktig den versjonen du fikk se; endres planen etterpå, venter den på å bli startet igjen.

Så kjører den ett steg om gangen, i ditt navn og med det rollen din kan gjøre. Hver plan har sin egen samtale hos KI-assistenten,
*Autopilot:* og planens tittel, så dine egne samtaler forblir dine. Etter hvert steg sjekker koden at det virket. Et steg som feiler,
prøves igjen; etter tre forsøk blir det et spørsmål med valgene **Prøv igjen**, **Hopp over dette steget** og **Stopp planen**.

Fanen Planer viser hver plan med stegene, hva hvert steg gjorde og hvor mange som er ferdige. **Sett på pause** og **Fortsett** en
plan, eller **Stopp** den for godt; det den allerede har gjort, blir stående. En plan settes på pause av seg selv hvis personen den
kjører for, ikke lenger jobber i butikken.

## Beslutninger: det som venter på deg

**Beslutninger** er den første fanen, og navnet viser hvor mye som venter:

- *Venter på ditt ja*: endringer den har holdt igjen til deg, hver med **Godkjenn** og **Avslå**;
- *Spørsmål*: spørsmål fra en plan, som du svarer på med **Svar**;
- *Bare du kan gjøre dette*: å sette opp betaling, og å velge et abonnement hos Kaizena Flow;
- *Det KI-assistenten skal komme tilbake til*: oppfølgingene, hver med **Avbryt**.

Du får også et varsel hos KI-assistenten, og en e-post høyst én gang om dagen, etter kl. 18 i butikkens tid, når et steg er ferdig
eller noe venter på deg. E-posten sier hva som er gjort og hva som venter, aldri hva en kunde har skrevet.

## Velg hvor langt den kan gå

I fanen **Innstillinger**:

1. **Autopilot på**. Av setter alle planer på pause; ingenting går tapt.
2. **Hva den kan gjøre**: velg et nivå for hvert område (Produkter, Nettsted, Design, Oppsett av butikken, Markedsføring, Meldinger
   til kunder, Penger):
   - **Spør meg først** (slik alle områdene starter): den holder igjen hver endring til du sier ja;
   - **Gjør det og si fra** eller **Bare gjør det**: den gjør endringen selv, og stegets resultat i fanen Planer sier hva den gjorde.
3. Trykk **Lagre**.

Utkast og det bare du ser, er alltid greit; nivåene gjelder det kundene ser eller mottar, og det som koster penger.

> [!IMPORTANT]
> Noen endringer spør alltid, uansett hva du velger: hvem som jobber i butikken, domenene dine, en utsendelse til listen din,
> tilbakebetalinger og endringer i bestillinger, kreditt og gavekort, abonnementet ditt hos Kaizena Flow, funksjoner og åpning av
> butikken. Et tema som koster penger, spør også alltid.

### Grenser

Under **Grenser** stopper eller spør autopiloten ved grensen du setter:

| Grense | Starter på | Hva den gjør |
|---|---|---|
| **KI-kostnad i måneden (USD)** | 5 | Hva autopilotens egen KI kan koste i en måned, bilder og bygging av sider medregnet. Er den nådd, settes planene på pause. Tomt: ingen egen grense. |
| **Største rabatt (%)** | 20 | En rabattkode eller kampanje som går dypere enn dette, spør alltid. |
| **Største prisendring (%)** | 10 | En prisendring større enn dette spør alltid. |
| **E-poster til kunder i uken** | 5 | E-poster til én kunde og svar i kundeservice den kan sende selv på sju dager; utover dette spør den. 0: alle spør. |

Butikkens eiere får en e-post når autopiloten har brukt 80 % av KI-kostnaden for måneden, og en til når den er brukt opp.

## Ukerapporten og hva den gjorde

Hver mandag fra kl. 08 i butikkens tid får de som har planer som har kjørt, en ukerapport på e-post: nettosalg og bestillinger de siste
sju dagene ved siden av de sju før, delmålene som er nådd, stegene som er gjort, og det som venter. Noen setninger om hva den ser,
skrives av KI-en, uten egne tall. Den siste rapporten står også i fanen Beslutninger, under *Den siste ukerapporten din*.

Fanen **Resultater**, *Det KI gjorde*, måler hver endring autopiloten gjorde selv, to uker etter at den ble gjort: en endring av et
produkt mot produktets salg, alt annet mot butikkens salg, de 14 dagene før og de 14 etter, ved siden av butikkens eget salg de samme
dagene. Det er en sammenligning av før og etter, ikke bevis for at endringen var årsaken. Den første i hver måned får de som har
planer som har kjørt, *Det KI gjorde i* måneden på e-post, når det er noe å fortelle.

Hver endring autopiloten gjør, står i **Aktivitetslogg** under planens person, merket *gjennom autopiloten*.

## Flere valg

### Fortsett å jobbe mot målene mine

Av til å begynne med. Slå på **Fortsett å jobbe mot målene mine**, så ser autopiloten på målet igjen når en plan for det er ferdig, og
med noen dagers mellomrom, og lager neste plan. Under den:

- **En plan den lager for et mål**: **Venter på ja fra meg** (slik den starter), eller **Starter med en gang**;
- **Se på hvert mål igjen hver (dager)**: 7 til å begynne med;
- **Planer den kan starte selv i en uke**: 3 til å begynne med; over dette venter en ny plan på ja fra deg.

En plan den starter selv, følger likevel nivåene og grensene dine. Fanen Mål viser når den sist så på hvert mål, og hva det ble til.

### Reager på det som skjer

Av til å begynne med. Med **Reager på det som skjer** slått på ser autopiloten på det med en gang når:

- en kunde har ventet på et menneske lenger enn **Minutter en kunde venter før den ser på det** (15 til å begynne med): den legger
  igjen et notat med forslag til svar til den som svarer, aldri et ord til kunden;
- en A/B-test avsluttes av seg selv: den velger vinneren slik nivåene dine tillater;
- et viktig varsel kommer: den planlegger hva som skal gjøres, og planen starter slik **En plan den lager for et mål** sier.

Fanen Beslutninger viser *Det autopiloten har reagert på*.

> [!NOTE]
> Kaizena Flow kan sette all KI som jobber på egen hånd, på pause på hele plattformen. Planene dine venter da, og fortsetter der de
> var når pausen er over. Dine egne samtaler med KI-assistenten settes aldri på pause.
