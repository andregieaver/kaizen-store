---
title: KI-assistenten
summary: Spør KI-assistenten om butikken, la den gjøre arbeid i administrasjonen for deg, og si ja til hver endring før den når kundene eller koster penger.
track: owners
section: ai
kind: how-to
areas: [ai, settings]
features: []
plans: []
admin: /admin/{store}/assistant
order: 10
checked: 2026-11-04
sources: [D73, D94, D103, D104, D105, D308, D318, D350, D391]
---

## Åpne den

Trykk **KI-assistent** øverst i administrasjonen, eller trykk ⌘K (Ctrl+K på Windows) på hvilken som helst side i butikkens
administrasjon. Den åpnes som et panel ved siden av siden: siden kan fortsatt brukes, og samtalen fortsetter mens du går fra side til
side. Esc lukker den.

Skriv det du vil med vanlige ord, og trykk **Send**. En ny samtale foreslår noen spørsmål å begynne med, for eksempel *Hva trenger jeg
å se på?*, og hjelp med siden du er på. Trykk **Stopp** for å stoppe et svar; lukker du siden i stedet, blir svaret ferdig og ligger
der når du åpner samtalen igjen.

[KI-assistentens egen side](/admin/{store}/assistant) har alle samtalene, med fanene **Minne**, **Ferdigheter** og **Autopilot**.
**Hel side** i panelet åpner samtalen der.

> [!NOTE]
> Bare butikkens eiere har KI-assistenten. Den bruker butikkens KI og trenger en tekstmodell: mangler den, sier den fra, med en lenke
> for å sette opp en under KI.

## Hva den kan gjøre

KI-assistenten kjenner alle sidene i administrasjonen, og åpner den du trenger. Den svarer ut fra butikkens egne data gjennom
verktøyene sine: den oppgir aldri en pris, et lagertall eller et produkt som et verktøy ikke har gitt den, og tall regnes ut av koden,
aldri av KI-en. Under hvert svar viser *Brukte:* hvilke verktøy den brukte.

Be den for eksempel om å:

- fortelle hvordan det går med salg, bestillinger, produkter, lager og kunder, eller kjøre en rapport;
- finne en bestilling, et produkt eller en kunde, og legge et notat på en bestilling;
- lage eller endre produkter: tekster, priser, bilder og status;
- bygge og endre sider, menyer og standard topptekst og bunntekst, eller legge til et tema og prøve det;
- sette opp butikken: firmaopplysninger, land, språk, valutaer og frakt;
- lage et utkast til et nyhetsbrev, merke kunder, eller lage en rabatt eller en kampanje;
- endre en bestilling, foreslå eller gjennomføre et bytte, eller betale tilbake;
- lese kundestøttesamtalene, legge et notat på en, eller svare kunden;
- invitere, endre eller fjerne ansatte, og bytte eller si opp abonnementet.

En side den bygger, lages etter svaret, og bildene ett og ett. Til den er ferdig, står den under *Lages av KI* i listen over sider.

Noe kan bare du gjøre: koble til betaling, velge ditt første abonnement (betales med kort på Stripes side, se
[Velg et abonnement](/docs/owners/getting-started/choose-a-plan)) og inngå en avtale med en fraktleverandør. Den modererer ikke
produktanmeldelser: ordene i en anmeldelse sendes aldri til KI-en.

## Hva den ber om ditt ja til

Utkast, og det bare du ser, endrer den med en gang, slik du ville gjort i redigeringen. En endring som når kundene, nettstedet eller
pengene dine, blir i stedet holdt igjen: et kort under svaret sier hva den vil gjøre, med **Godkjenn** og **Avslå**. Bare
**Godkjenn** gjør endringen, og bare én gang. Hvert kort sier hva slags endring det er:

| Kortet sier | For eksempel |
|---|---|
| *Sender noe i butikkens navn* | en e-post til en kunde, et nyhetsbrev, et svar i kundestøtten |
| *Endrer det nettstedet viser* | publisering av en side, en endring av et publisert produkt, en rabatt |
| *Koster penger* | en tilbakebetaling, en endring av en bestilling, et gavekort, et tema som koster penger, abonnementet ditt |
| *Endrer hvem som jobber i butikken og hva de kan gjøre* | å invitere eller fjerne ansatte |
| *Endrer domenet ditt: hvor det peker, e-posten eller fornyelsen* | en endring av domenets oppføringer |
| *Setter i gang arbeid i ditt navn* | å starte en plan for autopiloten |

Mens butikken settes opp, endrer den innstillingene i oppsettet med en gang; når butikken er åpnet, venter også de på ditt ja. Å
åpne butikken venter alltid.

Du kan også si ja med ord, skrevet eller muntlig. Det teller bare når din egen melding tydelig sier ja, og bare for en endring som
allerede ventet. Et kort ingen svarer på, faller bort etter sju dager: *Ingen svar på sju dager, så det ble ikke gjort.*

Hver endring den gjør, står i **Aktivitetslogg** (Innstillinger, Konto) under ditt navn, merket *gjennom KI-assistenten*.

## Varsler

KI-assistenten kan gjøre ting ferdig mens du er borte: en side den bygde, en oppfølging den svarte på, en endring som venter på ditt
ja, et spørsmål eller en rapport fra autopiloten. Et tall på **KI-assistent**-knappen teller de nye. **Varsler**, øverst i panelet,
viser dem, og hvert varsel åpner sin samtale eller side. [Varsler fra KI-assistenten](/admin/account/notices), i kontomenyen, viser
varslene fra alle butikkene dine. Varsler tas vare på i 60 dager.

## Oppfølginger

Be den komme tilbake til noe senere: «På fredag, sjekk om bestilling 1042 er sendt», eller «Hver mandag, si hva jeg bør se på». Da
gjør den oppgaven i den samme samtalen, med det rollen din kan gjøre den dagen, og sender deg en e-post om at svaret ligger der;
selve svaret står aldri i e-posten. En oppfølging kan gjentas hver dag eller hver uke, til samme tid på dagen. Den sier aldri ja for
deg: en endring venter fortsatt på ditt ja.

Oppfølgingene som venter, står på [Autopilot](/admin/{store}/assistant/autopilot)-siden, i fanen **Beslutninger**, under *Det
KI-assistenten skal komme tilbake til*, hver med **Avbryt**. Du kan også be KI-assistenten vise eller avbryte dem.

En oppfølging ligger minst fem minutter og høyst ett år fram i tid, og du kan ha 20 som venter i en butikk. En som feiler tre ganger,
stopper.

*Spør KI-assistenten* er også en knapp ved et analysevarsel, og en handling i en ordreregel under
[Automatisering](/admin/{store}/settings/automation).

## Flere valg

### Minne

KI-assistenten husker det du ber den huske («Husk at vi aldri sender på fredager»), og lærer hvordan du jobber fra samtalene dine og
fra tomlene du gir svarene. Fanen **Minne** viser *Hva den vet om deg*: endre et minne, **Glem** ett, **Glem alt**, eller **Last ned
som fil**. Fjern haken ved **Lær av samtalene mine** for å beholde bare det du forteller den.

Minnene er dine: bare du og KI-assistenten din ser dem. Den husker aldri kunders opplysninger eller passord. Det den har lært og ikke
bruker, blekner med tiden; det du har fortalt den, blir stående.

### Ferdigheter

En ferdighet er en måte å gjøre en jobb du kommer tilbake til, med dine egne ord. Trykk **Lagre som ferdighet** under noe du har
spurt om, eller be KI-assistenten lagre en. I fanen **Ferdigheter** gir du den et **Navn**, **Når den brukes** og **Steg**, ett steg
per linje, høyst 2 000 tegn, aldri et passord eller en kundes opplysninger. Be om en ferdighet ved navn, eller så bruker
KI-assistenten den når jobben dukker opp. Fanen viser også oppskriftene den kan fra før, under **Innebygd**.

**Del med butikkens ansatte** lar andre bruke den, med sine egne tillatelser. En ferdighet lar aldri noen gjøre mer enn de har lov
til, og hopper aldri over et ja.

### Tale

Trykk på mikrofonen ved siden av **KI-assistent**-knappen, eller **Talemodus** i en samtale, og snakk: den lytter, svarer høyt og
lytter igjen, og du kan snakke i munnen på den for å avbryte. Har butikkens KI en modell for *Direkte stemme*, blir talemodus en
samtale i stedet: den hører deg mens den snakker. Talemodus trenger KI-innstillingenes *Tale til tekst*, *Tekst til tale* og en
*Stemme*, eller en modell for direkte stemme. **Les opp** leser skrevne svar høyt.

### Hvor lenge samtalene lagres

Samtalene inneholder det verktøyene leste, blant annet kunders navn og e-postadresser, så meldingene slettes 12 måneder etter at de
ble skrevet. En eier kan velge fra 1 til 60 måneder under Innstillinger, KI, **Samtaler med KI-assistenten**: skriv antall måneder i
**Ta vare på i (måneder)** og trykk **Lagre**, eller la feltet stå tomt for 12. En samtale som blir tom, slettes også, med mindre en
plan for autopiloten, en oppfølging eller en endring som venter på ditt ja, fortsatt bruker den.

Du kan slette en samtale selv når du vil. Sletter du kontoen din, slettes samtalene dine med KI-assistenten, minnene, varslene og de
lagrede ferdighetene.

KI-assistenten svarer på opptil 300 meldinger om dagen i en butikk; etter det er den tilbake neste dag.

### KI-en og nøkkelen din

KI-assistenten bruker den samme KI-en som resten av butikken: Kaizena Flows, som er med i abonnementet, med mindre en eier velger
butikkens egen leverandør under [Innstillinger, KI](/admin/{store}/settings/ai). Der tar **Din egen KI-leverandør** imot
leverandøren, API-nøkkelen og modellene; **Bruk min egen KI** lagrer dem, og **Gå tilbake til Kaizena Flows KI** går tilbake. Din
egen leverandør betaler du på din egen konto hos dem, og produktene og kundenes søk sendes da dit, så sørg for at avtalen med dem
dekker personopplysninger. Nøkkelen lagres kryptert og sendes bare til den leverandøren.

KI fra Kaizena Flow teller mot abonnementets grense for KI ([Velg et abonnement](/docs/owners/getting-started/choose-a-plan)). Eiere
ser hva KI-en har brukt under [KI-bruk](/admin/account/usage).
