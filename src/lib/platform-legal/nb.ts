import type { PlatformLegalWords } from "../platform-legal";

/**
 * Kaizena Flow's own legal pages in Norwegian (bokmål, D312 P5), section for section the same as `en.ts`. Hand-written, never by a
 * model or translated by machine; the words for personal data and VAT are the glossary's (`src/lib/i18n-glossary.ts`) and the rights
 * are named and cited as personvernforordningen names them. Published as written by the owner's decision, without a lawyer's review.
 */
export const NB: PlatformLegalWords = {
  lang: "nb",
  updated: (date) => `Sist oppdatert: ${date}`,
  missing: {
    legalName: "[selskapsnavn legges til]",
    organisationNumber: "[organisasjonsnummer legges til]",
    postalAddress: "[adresse legges til]",
    contactEmail: "[e-postadresse legges til]",
  },
  links: { terms: "/no/terms", privacy: "/no/privacy", dpa: "/no/data-processing-agreement", cookies: "/no/cookies" },
  docs: (f) => ({
    terms: {
      title: "Vilkår for bruk",
      description: "Vilkårene for virksomheter som driver nettbutikker på Kaizena Flow.",
      sections: [
        {
          topic: "about",
          heading: "1. Om disse vilkårene",
          body: `Kaizena Flow leveres av ${f.legalName}, organisasjonsnummer ${f.organisationNumber}, ${f.postalAddress} («Kaizena Flow», «vi», «oss»). Du når oss på ${f.contactEmail}.

Vilkårene gjelder mellom oss og virksomheten som bruker Kaizena Flow til å drive én eller flere nettbutikker («du»). De gjelder fra forespørselen din om tilgang blir godkjent, eller fra du først tar tjenesten i bruk. [Databehandleravtalen](${f.links.dpa}) og prisene som vises for abonnementet ditt, er en del av vilkårene.

Kaizena Flow er bare for næringsdrivende. Du bekrefter at du handler som ledd i næringsvirksomhet, og at den som godtar vilkårene, kan forplikte virksomheten.`,
        },
        {
          topic: "service",
          heading: "2. Tjenesten",
          body: `Kaizena Flow er en driftet plattform for å drive en nettbutikk: butikken kundene ser, administrasjonen, sidebyggeren og temaene, varer, bestillinger og kunder, betaling gjennom betalingsleverandører du kobler til, e-post, analyser, verktøy for kundestøtte og funksjoner som bruker kunstig intelligens (KI).

Vi utvikler tjenesten hele tiden og kan legge til, endre og fjerne funksjoner. Fjerner eller svekker vi vesentlig en funksjon du betaler for, sier vi fra minst 30 dager før, med mindre endringen kreves av lov eller av sikkerhetshensyn.`,
        },
        {
          topic: "account",
          heading: "3. Kontoen din og dine ansatte",
          body: `Du gir oss riktige opplysninger om virksomheten og holder dem oppdatert. Du holder innloggingsopplysninger hemmelige og bruker totrinnsinnlogging der administrasjonen ber om det.

Du bestemmer hvem i virksomheten som har tilgang, og med hvilken rolle. Du står ansvarlig for det de du gir tilgang, gjør i butikkene dine, som om du hadde gjort det selv. Si fra til oss straks hvis du tror en konto er misbrukt.`,
        },
        {
          topic: "stores",
          heading: "4. Butikken din og kundene dine",
          body: `Du er selgeren i butikken din. Avtalene med kundene dine inngås mellom deg og dem; vi er ikke part i dem.

Du er ansvarlig for varene og tjenestene dine, prisene og merverdiavgiften, tekstene og bildene du publiserer, salgsbetingelsene, personvernerklæringen og de andre juridiske sidene dine, og for å følge reglene om forbrukere, markedsføring, avgift og annet som gjelder for salget ditt i hvert land du selger til.

Kaizena Flow tilbyr utkast til juridiske sider og annen hjelp. De er bare et utgangspunkt: du må lese dem, tilpasse dem til virksomheten din og selv avgjøre om du vil bruke dem.`,
        },
        {
          topic: "payments",
          heading: "5. Betaling fra kundene dine",
          body: `Kundene dine betaler gjennom en betalingsleverandør du kobler til, for eksempel Stripe eller Mollie, etter din egen avtale med leverandøren. Leverandøren foretar utbetalingen til deg. Vi holder aldri kundenes penger.

Tilbakebetalinger, tilbakeføringer og tvister avgjøres mellom deg, kunden og betalingsleverandøren. Kaizena Flow gir deg verktøy til å følge dem opp, men avgjør dem ikke.`,
        },
        {
          topic: "fees",
          heading: "6. Priser og betaling til oss",
          body: `Du betaler prisen for abonnementet du velger og gebyret per salg som gjelder for butikken din, slik det vises i administrasjonen når du velger eller bytter abonnement. Gebyret per salg er nå ${f.saleFee} av hver betaling, med mindre abonnementet eller avtalen din sier noe annet, og trekkes som et gebyr på betalingen gjennom betalingsleverandøren din. Premiumtemaer betales én gang per butikk, til prisen som vises før du tar dem i bruk.

Alle priser vises uten merverdiavgift, som kommer i tillegg der den gjelder. Vi fakturerer gjennom Stripe; abonnementer betales forskuddsvis for hver periode.

Betales ikke en faktura innen betalingsfristen, kan vi sende purring og kreve forsinkelsesrente etter loven som gjelder. Er den fortsatt ikke betalt 14 dager etter purringen, kan vi stenge de berørte butikkene midlertidig til den er betalt.

Vi kan endre prisene med minst 30 dagers varsel. En endring gjelder fra neste faktureringsperiode etter varselet; godtar du den ikke, kan du avslutte abonnementet før den trer i kraft.`,
        },
        {
          topic: "use",
          heading: "7. Akseptabel bruk",
          body: `Du kan ikke bruke Kaizena Flow til å:

- selge varer eller tjenester som er ulovlige der de selges eller sendes, eller som en betalingsleverandør du bruker, ikke tillater
- publisere innhold som krenker andres rettigheter eller er ulovlig, villedende eller hatefullt
- sende e-post til folk som ikke har sagt ja til å få den, der det kreves forutgående samtykke
- spre skadevare, angripe, overbelaste eller teste tjenesten eller andre butikker, eller omgå grensene og sikkerheten i den
- kopiere, videreselge eller dekompilere tjenesten, utover det loven tillater

Vi kan fjerne innhold og stenge en butikk eller en konto som bryter disse reglene, som beskrevet i punkt 12.`,
        },
        {
          topic: "ai",
          heading: "8. Funksjoner som bruker KI",
          body: `Noen funksjoner bruker KI-modeller til å foreslå tekster, oversettelser, bilder, svar og handlinger. Det en modell skriver, kan være feil. Forslagene skal du kontrollere før du bruker dem; endringer KI-assistenten foreslår i butikken din, gjøres bare når du godkjenner dem, unntatt der administrasjonen sier noe annet mens butikken settes opp.

Når du bruker KI-funksjoner gjennom Kaizena Flows egen tilkobling, behandles tekstene og bildene du sender, av KI-leverandøren vi bruker, slik det står i [personvernerklæringen](${f.links.privacy}) og [databehandleravtalen](${f.links.dpa}). Kobler du til din egen KI-leverandør, gjelder din egen avtale med den for det som sendes dit. Vi kan sette grenser for hvor mye KI et abonnement omfatter.`,
        },
        {
          topic: "content",
          heading: "9. Innhold og rettigheter",
          body: `Du beholder alle rettigheter til innholdet ditt: tekster, bilder, varer, kundeopplysninger og annet du legger inn i Kaizena Flow. Du gir oss rett til å lagre, kopiere, vise og behandle det så langt det trengs for å levere tjenesten til deg og kundene dine, og til å gjøre det tilgjengelig når du deler eller publiserer det.

Vi og våre lisensgivere beholder alle rettigheter til tjenesten, programvaren, utformingen og temaene. Så lenge abonnementet varer, kan du bruke temaene og delene vi tilbyr, i dine egne butikker. Bilder vi eller en KI-modell lager for deg, kan brukes i butikkene dine; du er ansvarlig for hvordan du bruker dem.

Sender du oss ideer eller tilbakemeldinger, kan vi bruke dem fritt.`,
        },
        {
          topic: "data",
          heading: "10. Personopplysninger",
          body: `For personopplysningene vi behandler om deg og dine ansatte for å ivareta kundeforholdet med deg, er vi behandlingsansvarlig, slik det står i [personvernerklæringen](${f.links.privacy}).

For personopplysningene om kundene dine og andre som vi behandler i butikkene dine på dine vegne, er du behandlingsansvarlig og vi databehandler. [Databehandleravtalen](${f.links.dpa}) gjelder for den behandlingen og er en del av disse vilkårene.`,
        },
        {
          topic: "availability",
          heading: "11. Tilgjengelighet og hjelp",
          body: `Vi arbeider for at Kaizena Flow alltid skal være tilgjengelig og sikker, men lover ikke at tjenesten er uten avbrudd eller feil. Vi kan utføre vedlikehold, helst når trafikken er lav, og sier fra på forhånd der vi kan.

Du kan be om hjelp gjennom «Kontakt kundestøtten i Kaizena Flow» i kontomenyen i administrasjonen eller på e-post til ${f.contactEmail}.`,
        },
        {
          topic: "termination",
          heading: "12. Stenging og opphør",
          body: `Du kan avslutte abonnementet når som helst; det løper da ut perioden du har betalt for. Du kan stenge en butikk i innstillingene for den.

Vi kan straks stenge en butikk eller en konto midlertidig hvis du bryter vilkårene på en måte som skader andre eller setter tjenesten i fare, hvis lov eller myndigheter krever det, eller som beskrevet i punkt 6 for ubetalte fakturaer. Der vi kan, sier vi fra først og gir deg mulighet til å rette forholdet. Vi kan si opp vilkårene med 30 dagers varsel, eller med umiddelbar virkning hvis du vesentlig bryter dem og ikke retter det innen 14 dager etter varselet vårt.

Før butikkene dine stenges for godt, kan du hente ut dataene dine fra administrasjonen. Bestillinger, fakturaer og andre opplysninger vi etter loven må oppbevare, beholdes så lenge loven krever, slik det står i [personvernerklæringen](${f.links.privacy}).`,
        },
        {
          topic: "liability",
          heading: "13. Ansvar",
          body: `Tjenesten leveres slik den til enhver tid er. Vi er ikke ansvarlige for indirekte tap eller følgetap, som tapt fortjeneste, tapt salg, tapt omdømme eller tap av data du kunne ha gjenopprettet fra dine egne eksporter.

Vårt samlede ansvar for alle krav i en periode på 12 måneder er begrenset til gebyrene du betalte oss de 12 månedene før hendelsen som ga grunnlag for kravet.

Begrensningene gjelder ikke tap vi har voldt ved grov uaktsomhet eller forsett, eller der loven ikke tillater at ansvaret begrenses.`,
        },
        {
          topic: "indemnity",
          heading: "14. Krav fra andre",
          body: `Du holder oss skadesløse for krav fra kundene dine, myndigheter og andre som skyldes varene og tjenestene dine, salget ditt, innholdet ditt eller ditt brudd på vilkårene eller loven, også rimelige saksomkostninger.`,
        },
        {
          topic: "changes",
          heading: "15. Endringer i vilkårene",
          body: `Vi kan endre disse vilkårene. Vesentlige endringer varsler vi på e-post eller i administrasjonen minst 30 dager før de trer i kraft. Fortsetter du å bruke tjenesten etter det, gjelder de nye vilkårene. Godtar du dem ikke, kan du avslutte abonnementet før de trer i kraft.`,
        },
        {
          topic: "law",
          heading: "16. Lovvalg og tvister",
          body: `Vilkårene reguleres av norsk rett. Vi vil først forsøke å løse uenighet ved å snakke med deg. Lykkes ikke det, avgjøres tvister av de alminnelige domstolene der vi har vårt forretningskontor.`,
        },
        {
          topic: "contact",
          heading: "17. Kontakt",
          body: `${f.legalName}
${f.postalAddress}
Organisasjonsnummer ${f.organisationNumber}
${f.contactEmail}`,
        },
      ],
    },
    privacy: {
      title: "Personvernerklæring",
      description: "Hvordan Kaizena Flow behandler personopplysninger om besøkende, butikkeiere og deres ansatte.",
      sections: [
        {
          topic: "controller",
          heading: "1. Hvem som er ansvarlig",
          body: `${f.legalName}, organisasjonsnummer ${f.organisationNumber}, ${f.postalAddress}, er behandlingsansvarlig for behandlingen som beskrives i denne erklæringen. Kontakt oss om personvern på ${f.contactEmail}.`,
        },
        {
          topic: "scope",
          heading: "2. Hva erklæringen gjelder",
          body: `Erklæringen gjelder personopplysningene vi behandler om dem som besøker Kaizena Flows eget nettsted, ber om tilgang, driver eller arbeider i butikker på Kaizena Flow, og kontakter oss.

Den gjelder ikke det butikkene gjør med opplysninger om sine egne kunder. Hver butikk er behandlingsansvarlig for sine kunder og besøkende og har sin egen personvernerklæring; vi behandler de opplysningene på butikkens vegne etter [databehandleravtalen](${f.links.dpa}) vår.`,
        },
        {
          topic: "purposes",
          heading: "3. Hva vi behandler, hvorfor og med hvilket behandlingsgrunnlag",
          body: `- **Forespørsler om tilgang:** navnet ditt, e-postadressen, butikken du vil åpne, det du skriver til oss og språket du skriver på, for å vurdere forespørselen og svare deg. Grunnlag: tiltak du ber om før en avtale inngås (personvernforordningen artikkel 6 nr. 1 bokstav b).
- **Kontoen din:** navn, e-postadresse, passord (lagret bare som en beskyttet hash hos innloggingsleverandøren vår), profilbilde, faktorer for totrinnsinnlogging og gjenopprettingskoder (lagret som hasher) og valgene dine av språk og utseende, for å gi deg tilgang til administrasjonen. Grunnlag: avtalen vår med deg eller arbeidsgiveren din (artikkel 6 nr. 1 bokstav b og f).
- **Sikkerhet og aktivitetsloggen:** innlogginger og endringene som gjøres i hver butikk, med hvem som gjorde dem og når, for å holde tjenesten og butikkene sikre og la eierne se hva som er gjort. Grunnlag: berettiget interesse i sikkerhet (artikkel 6 nr. 1 bokstav f).
- **Fakturering:** opplysninger om virksomheten din, abonnementet, fakturaer og betalinger, for å ta betalt for tjenesten og føre regnskap. Grunnlag: avtalen vår (artikkel 6 nr. 1 bokstav b) og vår plikt til å føre regnskap (artikkel 6 nr. 1 bokstav c og bokføringsloven).
- **Kundestøtte og KI-assistenten:** det du skriver til Kaizena Flows kundestøtte og til KI-assistenten, og det KI-assistenten husker for deg (som du kan se, endre og slå av), for å hjelpe deg. Grunnlag: avtalen vår (artikkel 6 nr. 1 bokstav b).
- **E-post vi sender:** e-postene vi sender deg og om de kom fram, for å sende det tjenesten må fortelle deg. Grunnlag: avtalen vår og berettiget interesse (artikkel 6 nr. 1 bokstav b og f).
- **Nettstedet vårt:** informasjonskapslene som trengs for at nettstedet skal virke. Informasjonskapsler for statistikk eller markedsføring, og informasjonskapselen til vervekampanjen, settes bare hvis du samtykker, og valget ditt lagres i 12 måneder. Grunnlag: samtykke (artikkel 6 nr. 1 bokstav a). Se [siden om informasjonskapsler](${f.links.cookies}).
- **Vervekampanjen:** hvem som vervet en butikk og kreditten som er opptjent, for å betale den som vervet. Grunnlag: avtalen vår med den som vervet (artikkel 6 nr. 1 bokstav b).`,
        },
        {
          topic: "recipients",
          heading: "4. Hvem vi deler opplysninger med",
          body: `Vi bruker disse leverandørene til å drive Kaizena Flow. De behandler personopplysninger bare etter våre instrukser:

- **Vercel** (drift; funksjonene våre kjører i Dublin, Irland)
- **Supabase** (database, innlogging og fillagring, i Irland)
- **Resend** (utsending av e-post)
- **OpenAI** (KI-funksjoner, når Kaizena Flows egen KI-tilkobling brukes)
- **Stripe** (fakturering og betaling av gebyrene våre; Stripe er også selv behandlingsansvarlig for betalingsopplysningene den behandler etter sine egne vilkår)

Vi deler også opplysninger der loven krever det, for eksempel med skattemyndighetene, og med en virksomhet som overtar hele eller deler av vår, som da må følge denne erklæringen.`,
        },
        {
          topic: "transfers",
          heading: "5. Overføring ut av EØS",
          body: `Databasen og funksjonene våre er i EU. Noen av leverandørene våre holder til i USA eller kan nå opplysninger derfra. Slike overføringer skjer etter rammeverket for personvern mellom EU og USA (Data Privacy Framework) der leverandøren er sertifisert, og ellers etter standard personvernbestemmelser vedtatt av Europakommisjonen (personvernforordningen artikkel 45 og 46).`,
        },
        {
          topic: "retention",
          heading: "6. Hvor lenge vi lagrer opplysningene",
          body: `- Forespørsler om tilgang: til forespørselen er avgjort, og deretter så lenge det trengs for å svare på spørsmål om den.
- Kontoer: så lenge kontoen finnes. Ber du oss slette den, gjør vi det, med mindre kontoen fortsatt trengs for en butikk du er ansvarlig for.
- Aktivitetsloggen: 24 måneder.
- Regnskapsopplysninger, som fakturaer: fem år etter utgangen av regnskapsåret (bokføringsloven § 13).
- Samtaler med kundestøtten: så lenge det er satt for kundestøtten, og deretter anonymisert.
- Valgene dine om informasjonskapsler: 12 måneder.`,
        },
        {
          topic: "rights",
          heading: "7. Dine rettigheter",
          body: `Du har rett til å:

- få innsyn i personopplysningene vi har om deg (personvernforordningen artikkel 15)
- få uriktige opplysninger rettet (artikkel 16)
- få opplysninger slettet (artikkel 17)
- få behandlingen begrenset (artikkel 18)
- få opplysningene dine i et maskinlesbart format og overført til en annen behandlingsansvarlig (dataportabilitet, artikkel 20)
- protestere mot behandling som bygger på vår berettigede interesse (artikkel 21)
- trekke tilbake samtykket ditt når som helst, uten at det påvirker det som er gjort før (artikkel 7 nr. 3)

Skriv til ${f.contactEmail}. Mange av opplysningene dine kan du endre selv under «Din konto» i administrasjonen. Vi svarer innen én måned (artikkel 12 nr. 3).`,
        },
        {
          topic: "complaint",
          heading: "8. Klage",
          body: `Mener du at vi behandler opplysningene dine i strid med loven, kan du klage til en tilsynsmyndighet, særlig i landet der du bor eller arbeider (artikkel 77). I Norge er det Datatilsynet, datatilsynet.no. Vi setter pris på om du tar kontakt med oss først.`,
        },
        {
          topic: "obligation",
          heading: "9. Må du gi oss opplysninger?",
          body: `Du må gi oss navn og e-postadresse for å få en konto, og opplysninger om virksomheten for å kjøpe et abonnement. Alt annet bestemmer du selv.`,
        },
        {
          topic: "automated",
          heading: "10. Automatiserte avgjørelser",
          body: `Vi treffer ingen avgjørelser utelukkende basert på automatisert behandling som har rettsvirkning eller på tilsvarende måte i betydelig grad påvirker deg (artikkel 22). KI-funksjonene foreslår; et menneske bestemmer.`,
        },
        {
          topic: "security",
          heading: "11. Sikkerhet",
          body: `Opplysningene krypteres på vei til og fra Kaizena Flow. Passord, gjenopprettingskoder og tilgangsnøkler lagres bare som hasher, og hemmeligheter som nøkler til integrasjoner er kryptert. Ansatte logger inn med totrinnsinnlogging der administrasjonen ber om det, og hver butikks opplysninger holdes atskilt fra andre butikkers.`,
        },
        {
          topic: "changes",
          heading: "12. Endringer",
          body: `Vi oppdaterer erklæringen når det vi gjør, endres. Datoen øverst viser når den sist ble endret. Vesentlige endringer varsler vi kontoinnehavere om på e-post eller i administrasjonen.`,
        },
      ],
    },
    dpa: {
      title: "Databehandleravtale",
      description: "Databehandleravtalen mellom en butikk på Kaizena Flow og Kaizena Flow som databehandler.",
      sections: [
        {
          topic: "parties",
          heading: "1. Partene og hva avtalen gjelder",
          body: `Avtalen gjelder mellom virksomheten som driver en butikk på Kaizena Flow (den behandlingsansvarlige, «du») og ${f.legalName}, organisasjonsnummer ${f.organisationNumber} (databehandleren, «vi»). Den er en del av [vilkårene for bruk](${f.links.terms}) og gjelder så lenge vi behandler personopplysninger på dine vegne.

Den oppfyller kravene i personvernforordningen artikkel 28 nr. 3. Er den i strid med vilkårene for bruk om behandling av personopplysninger, gjelder denne avtalen.`,
        },
        {
          topic: "processing",
          heading: "2. Behandlingen",
          body: `- **Gjenstand og formål:** drift av butikkene dine og verktøyene i administrasjonen, slik at du kan selge, levere, fakturere, gi kundestøtte og markedsføre overfor kundene dine.
- **Art:** lagring, organisering, visning, utsending, analyse, oversettelse og sletting av opplysninger, etter hvordan du bruker tjenesten.
- **Varighet:** så lenge du har butikker på Kaizena Flow, og til opplysningene er slettet eller tilbakelevert etter punkt 11.
- **De registrerte:** kundene dine og de som handler hos deg, de som melder seg på listene dine, fyller ut skjemaene dine, bestiller time hos deg eller kontakter deg, og de du gir tilgang til administrasjonen.
- **Typer personopplysninger:** navn, e-postadresser, telefonnumre og postadresser, opplysninger om virksomheter, bestillinger, bookinger, returer og fakturaer, betalingsreferanser (aldri kortnumre, som bare betalingsleverandøren ser), meldinger og samtaler med kundestøtten, omtaler, registreringer av samtykke og påmeldinger, og de egendefinerte feltene du velger å legge til.

Du bestemmer om særlige kategorier av personopplysninger behandles, og i så fall hvilke. Tjenesten er ikke laget for dem, og du bør ikke samle dem inn i den uten at du har behandlingsgrunnlag og har vurdert risikoen.`,
        },
        {
          topic: "instructions",
          heading: "3. Dine instrukser",
          body: `Vi behandler personopplysninger bare etter dokumenterte instrukser fra deg: denne avtalen, vilkårene for bruk og innstillingene og handlingene du og dine ansatte velger i administrasjonen. Vi behandler dem ikke for egne formål, unntatt for å føre regnskap over gebyrene våre og der loven krever det. Krever loven at vi behandler dem på en annen måte, sier vi fra først, med mindre loven forbyr det.

Vi sier fra straks hvis vi mener en instruks er i strid med personvernlovgivningen.`,
        },
        {
          topic: "confidentiality",
          heading: "4. Taushetsplikt",
          body: `Alle i Kaizena Flow som kan nå personopplysningene dine, har taushetsplikt og når dem bare så langt det trengs for å drive, gi hjelp med og sikre tjenesten. Kaizena Flows plattformadministratorer leser ikke butikkenes samtaler med kundestøtten.`,
        },
        {
          topic: "security",
          heading: "5. Sikkerhet",
          body: `Vi treffer de tekniske og organisatoriske tiltakene personvernforordningen artikkel 32 krever, blant annet:

- kryptering av opplysninger på vei til og fra tjenesten, og av lagrede hemmeligheter
- passord, gjenopprettingskoder og nøkler lagret bare som hasher
- hver butikks opplysninger atskilt fra andre butikkers, med tilgangskontroll ved hver forespørsel
- roller og tillatelser for dine ansatte, totrinnsinnlogging og en aktivitetslogg over endringer
- sikkerhetskopier av databasen og mulighet til å gjenopprette den
- drift i datasentre i EU med egen fysisk sikring

Vi gjennomgår og forbedrer tiltakene etter hvert som risiko og teknologi endrer seg.`,
        },
        {
          topic: "subprocessors",
          heading: "6. Underdatabehandlere",
          body: `Du gir oss generell tillatelse til å bruke underdatabehandlere. Disse bruker vi i dag:

- **Vercel** (drift; funksjoner i Dublin, Irland)
- **Supabase** (database, innlogging og fillagring, i Irland)
- **Resend** (utsending av e-postene butikken din sender)
- **OpenAI** (KI-funksjoner, når Kaizena Flows egen KI-tilkobling brukes)

Vi sier fra minst 30 dager før vi legger til eller bytter en underdatabehandler. Protesterer du på rimelig grunnlag og vi ikke kan imøtekomme protesten, kan du avslutte den berørte tjenesten før endringen trer i kraft. Vi pålegger hver underdatabehandler de samme pliktene om personvern som i denne avtalen og står ansvarlige for at de følges.

Tjenester du selv kobler til, er ikke våre underdatabehandlere: betalingsleverandører som Stripe og Mollie, fraktselskaper, din egen KI-leverandør, Slack og verktøy for analyse og markedsføring. Dine egne avtaler med dem gjelder.`,
        },
        {
          topic: "transfers",
          heading: "7. Overføring ut av EØS",
          body: `Butikkenes opplysninger lagres i EU. Der en underdatabehandler kan nå opplysninger fra et land utenfor EØS, skjer overføringen etter rammeverket for personvern mellom EU og USA (Data Privacy Framework) der underdatabehandleren er sertifisert, og ellers etter standard personvernbestemmelser vedtatt av Europakommisjonen (personvernforordningen artikkel 45 og 46).`,
        },
        {
          topic: "rights",
          heading: "8. Hjelp med de registrertes rettigheter",
          body: `I administrasjonen kan du selv svare på forespørsler fra de registrerte: du kan finne, rette og hente ut opplysningene om en kunde og slette eller anonymisere dem, mens bestillinger du etter loven må oppbevare, beholdes med begrenset behandling. Kontakter en registrert oss direkte om butikken din, sender vi forespørselen videre til deg uten ugrunnet opphold og svarer ikke selv, med mindre du ber oss om det.`,
        },
        {
          topic: "assistance",
          heading: "9. Annen bistand",
          body: `Ut fra behandlingens art og opplysningene vi har tilgang til, hjelper vi deg med å oppfylle pliktene dine etter personvernforordningen artikkel 32 til 36: sikkerhet, melding om brudd, vurdering av personvernkonsekvenser og forhåndsdrøftinger.`,
        },
        {
          topic: "breach",
          heading: "10. Brudd på personopplysningssikkerheten",
          body: `Vi varsler deg uten ugrunnet opphold, og senest 48 timer etter at vi ble kjent med det, om et brudd på personopplysningssikkerheten som berører butikkene dine. Varselet beskriver det som har skjedd så langt vi kjenner det, hvilke opplysninger og personer som trolig er berørt, de sannsynlige konsekvensene og hva vi gjør med det, og følges opp etter hvert som vi vet mer. Du avgjør om tilsynsmyndigheten og de berørte skal varsles (personvernforordningen artikkel 33 og 34).`,
        },
        {
          topic: "end",
          heading: "11. Når behandlingen opphører",
          body: `Før du stenger en butikk, kan du hente ut opplysningene i den fra administrasjonen. Etter at butikken er stengt for godt, sletter eller anonymiserer vi personopplysningene i den innen 90 dager, unntatt det loven krever at oppbevares, som bestillinger og fakturaer etter regnskapsreglene. Det beholdes med begrenset behandling i den tiden som kreves, og anonymiseres deretter.`,
        },
        {
          topic: "audits",
          heading: "12. Informasjon og revisjon",
          body: `Vi gjør tilgjengelig den informasjonen som trengs for å vise at vi oppfyller avtalen. Du kan revidere at vi gjør det, selv eller gjennom en uavhengig revisor med taushetsplikt, med minst 30 dagers varsel, én gang i året, med mindre et brudd eller en myndighet gir grunn til mer. Hver part bærer sine egne kostnader.`,
        },
        {
          topic: "liability",
          heading: "13. Ansvar og lovvalg",
          body: `Ansvaret mellom oss følger vilkårene for bruk, uten å begrense det personvernforordningen artikkel 82 gir de registrerte. Avtalen reguleres av norsk rett, som vilkårene for bruk.`,
        },
      ],
    },
  }),
};
