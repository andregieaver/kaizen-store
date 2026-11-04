---
title: Logg inn trygt
summary: Slå på totrinnsinnlogging, krev det av alle i butikken, ta vare på gjenopprettingskodene, og vit hva du gjør når et passord har kommet på avveie.
track: owners
section: team-and-settings
kind: how-to
areas: [team, settings]
features: []
plans: []
admin: /admin/account
order: 20
checked: 2026-11-04
sources: [D158, D171, D377, D439]
---

## Slå på totrinnsinnlogging

Med totrinnsinnlogging ber Kaizena Flow om en sekssifret kode fra en app på telefonen i tillegg til passordet eller
innloggingslenken. Den som får tak i passordet ditt, kommer likevel ikke inn.

1. Åpne kontomenyen øverst i administrasjonen og velg [Din konto](/admin/account).
2. Under **Innlogging i to trinn** trykker du **Slå på totrinnsinnlogging**, og så **Sett opp en autentiseringsapp**.
3. Åpne en autentiseringsapp, for eksempel 1Password, Google Authenticator eller Authy, og skann koden på skjermen. Du kan også skrive
   inn nøkkelen under den for hånd.
4. Skriv inn de seks sifrene appen viser nå, og trykk **Slå på totrinnsinnlogging**.
5. Ta vare på de ti gjenopprettingskodene: **Kopier kodene**, **Last ned som fil** eller **Skriv ut**. Dette er den eneste gangen de
   vises. Oppbevar dem et annet sted enn telefonen, kryss av for **Jeg har lagret disse kodene et trygt sted.** og trykk **Fortsett**.

Fra nå av åpner du appen etter passordet eller lenken, og skriver inn koden den viser for Kaizena Flow.

## Krev det av teamet

1. Åpne **Innstillinger** og velg [Team](/admin/{store}/staff), under Konto. Listen viser hvem som har *Totrinns på*.
2. Under **Totrinns innlogging** krysser du av for **Krev totrinns innlogging av alle som arbeider i denne butikken.** Du må ha det på
   selv først.
3. Trykk **Lagre**.

Den som ikke har det, blir sendt til å sette det opp før de kommer inn i butikken. De andre butikkene dine berøres ikke: hver butikk
velger selv.

## Logg inn og ut

- **Logg inn** med e-post og passord, eller trykk **Send meg en innloggingslenke på e-post i stedet**. En lenke virker én gang og
  utløper innen en time: åpne den i samme nettleser.
- **Glemt passordet?** Trykk **Glemt passordet?** på innloggingssiden. Lenken i e-posten logger deg inn og åpner kontoen din, der du
  velger et nytt. Dette virker også om du aldri har hatt et passord.
- **For mange feil passord** stopper innlogging med passord for den adressen i noen minutter. En innloggingslenke virker fortsatt.
- **Logg ut** fra kontomenyen, **Logg ut**.
- **Noe krever at du logger inn på nytt**: å stenge en butikk og å slette kontoen din krever en innlogging fra de siste ti minuttene.

KI-assistenter og apper du har latt arbeide med butikkene dine, beholder tilgangen til du avslutter den: åpne
[Tilkoblede apper og assistenter](/admin/account/connected) og trykk **Koble fra**.

## Hvis passordet har kommet på avveie

1. **Sett et nytt passord.** På [Din konto](/admin/account), under **Passord**, skriver du et **Nytt passord** på minst 12 tegn og
   trykker **Lagre passordet**. Et passord som er for lett å gjette, eller som har dukket opp i et datainnbrudd, kan bli avvist. Blir du
   bedt om det, logger du inn på nytt med en lenke på e-post først.
2. **Koble til appene igjen.** Et nytt passord kobler fra alle KI-assistenter og apper du har koblet til, så de spør på nytt.
3. **Slå på totrinnsinnlogging**, hvis det ikke er på ennå.
4. **Se i [Aktivitetslogg](/admin/{store}/activity)** etter endringer du ikke har gjort.
5. **Var det passordet til noen i teamet?** Trykk **Fjern tilgang** for dem på **Team** til det er byttet, eller krev totrinnsinnlogging
   av alle.

> [!WARNING]
> Kaizena Flow sender deg en e-post når en gjenopprettingskode brukes på kontoen din, og når totrinnsinnloggingen din blir slått av
> eller tilbakestilt. Var det ikke deg, logger du inn, bytter passord med en gang, slår på totrinnsinnlogging igjen og sier fra til
> eieren av butikken.

## Flere valg

### Mistet telefonen

På det andre trinnet i innloggingen trykker du **Bruk en gjenopprettingskode**, skriver inn en av kodene og trykker **Bruk denne
koden**. Hver kode virker én gang. Bruker du en, fjernes totrinnsinnloggingen og du logges ut overalt, og Kaizena Flow sender deg en
e-post om det. Logg så inn igjen og slå den på på nytt. Uten telefonen og uten en kode kan bare en plattformadministrator i Kaizena Flow
tilbakestille totrinnsinnloggingen din.

På **Din konto** ser du hvor mange gjenopprettingskoder du har igjen. **Lag nye gjenopprettingskoder** gir deg et nytt sett, og de
gamle slutter å virke. **Slå av totrinnsinnlogging** slår den av; en butikk som krever den, ber deg slå den på igjen.

### Steng en butikk

En eier kan stenge en butikk under **Innstillinger**, [Steng butikken](/admin/{store}/settings/close). Salget stopper og butikken tas av
nettet; abonnementet avsluttes ved slutten av perioden, butikkens egne domener frigis, og bestillinger som venter på betaling,
kanselleres. Ingenting slettes, og du kan selv åpne butikken igjen i 30 dager. Du kan ikke stenge mens betalte bestillinger venter på å
bli sendt, eller mens abonnementer eller abonnementskasser løper. Under **Ta med deg butikken** på samme side kan du laste ned butikken
som en fil, med produktene, lageret, bestillingene og kundene.

### Slett din egen konto

Med [Slett kontoen din](/admin/account/delete), fra **Din konto**, sletter du innloggingen, navnet, e-postadressen og bildet ditt,
tilgangen til alle butikker, og KI-assistentens samtaler og minner. Det du gjorde i en butikk, blir værende der uten navnet ditt. Det
avvises, med begrunnelse, for eksempel når du er eneste eier av en butikk som ikke er stengt, eller når du har et domene. Det krever en
innlogging fra de siste ti minuttene og at du skriver e-postadressen din på nytt.
