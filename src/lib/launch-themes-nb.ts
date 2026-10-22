import type { ListingWords } from "./theme-store";

/**
 * Kaizena Flow's launch themes' own words in Norwegian (D312 P3), written by hand: each theme's summary, description and highlights' words,
 * by its key. `launchListing()` puts them in the theme's listing, so the Norwegian theme store shows them; the theme's English words are its
 * details. A launch theme without an entry here is shown in Norwegian with its English words marked as such.
 */
export const LAUNCH_WORDS_NB: Readonly<Record<string, ListingWords>> = {
  calm: {
    summary: "Rolig og nøytral, med god luft.",
    description:
      "Svart og hvitt med myke grånyanser, systemskrifttyper og avrundede knapper. God avstand mellom seksjonene lar produktene og bildene tale for seg selv. Følger besøkendes lyse eller mørke modus.",
    highlights: {
      devices: { title: "Rolig på alle skjermer", text: "Den samme rolige utformingen på en datamaskin og en mobil, med menyen samlet bort på små skjermer." },
      collage: { title: "God luft", text: "Romslig avstand og tydelig tekst lar produktene og fortellingene komme først." },
      closeup: { title: "Enkle produktsider", text: "Pris, valg og knappen for å legge i handlekurven står samlet, med detaljene under." },
    },
  },
  hearth: {
    summary: "Varm og klassisk, for håndverk, mat og hjem.",
    description:
      "Kremfarget papir og terrakotta, overskrifter i Playfair Display over Lora, kort med myke hjørner og kantlinje, og logoen midt på. Sitater settes store i overskriftsskriften.",
    highlights: {
      devices: { title: "Varm på alle skjermer", text: "Hearths varme farger og vennlige skrift følger med fra datamaskinen til mobilen." },
      collage: { title: "Laget for fortellinger", text: "Seksjoner for historien din, utvalget ditt og stedet ditt, i Hearths varme farger." },
      closeup: { title: "Produkter med karakter", text: "Store bilder og tydelige priser gir hvert produkt plass på sin side." },
    },
  },
  signal: {
    summary: "Dristig og moderne, med høy kontrast og skarpe hjørner.",
    description:
      "Et svart toppfelt, skarpe hjørner, en klar oransje aksentfarge, overskrifter i Archivo med store, sperrede bokstaver og produktbilder fra kant til kant. Seksjonene ligger tett.",
    highlights: {
      devices: { title: "Dristig på alle skjermer", text: "Kraftig skrift og høy kontrast holder sammen på en datamaskin og en mobil." },
      collage: { title: "Seksjoner som skiller seg ut", text: "Kraftige overskrifter og tydelige blokker markerer hver del av siden." },
      closeup: { title: "En tydelig vei til kjøp", text: "En stor tittel, prisen og knappen for å legge i handlekurven, side om side." },
    },
  },
  fjord: {
    summary: "Kjølig og klar, i blågrått og friskt.",
    description:
      "Blågrå farger med en dyp sjøblå aksentfarge, Inter overalt, avrundede knapper og produktkort som løfter seg. Lys om dagen og mørk om kvelden, slik besøkendes enhet er innstilt.",
    highlights: {
      devices: { title: "Klar på alle skjermer", text: "Fjords kjølige farger og åpne utforming er lette å lese på en datamaskin og en mobil." },
      collage: { title: "Rolige, åpne seksjoner", text: "Lyse bakgrunner og myke linjer lar bildene komme først." },
      closeup: { title: "Detaljene med ett blikk", text: "Bilder, pris og valg lagt tydelig ut på hver produktside." },
    },
  },
  orbit: {
    summary: "Et tema for nattehimmelen: det dype rommet, stjernelysgull og plass til å undre seg.",
    description:
      "Laget fra bunnen av for nettbutikker med sans for det store. Sider under et stjernefelt som sakte driver, de brede bokstavene i Unbounded over Manrope, stjernelysgull for knappen som teller, et toppfelt som ligger over toppbanneret, produktkort som glass, og en produktside som setter hvert bilde i en myk glød ved siden av en kjøpsboks som blir værende synlig. Demobutikken, Far Light, selger trykk av nattehimmelen.",
    highlights: {
      devices: { title: "Et vindu ut i rommet", text: "Orbits stjernehimmel, brede bokstaver og gylne knapper på en datamaskin og en mobil." },
      collage: { title: "Seksjoner som får deg til å undre deg", text: "Et toppbanner over en planets soloppgang, samlinger som fliser, nummererte steg og historien ved siden av bildet." },
      closeup: { title: "En produktside som gløder", text: "Bildet i en myk glød, med prisen og knappen for å legge i handlekurven alltid synlig." },
    },
  },
  atelier: {
    summary: "Stillferdig luksus for skapere: varm puss, fine serifbokstaver og god luft.",
    description:
      "Laget fra bunnen av for verksteder og skapere med sans for håndverk. Varme pussfargede sider med en fin papirstruktur, de fine bokstavene i Cormorant Garamond over Jost, et toppfelt i to rader med navnet ditt i midten, kapitéler og tynne linjer, samlinger vist som bilder med tekst under, romertall for hvordan ting blir laget, og en produktside som gir gjenstanden den største halvdelen. Demobutikken, Ostra Studio, selger dreid steintøy.",
    highlights: {
      devices: { title: "En lookbook for butikken din", text: "Atelier sine pussfargede sider, fine serifbokstaver og stille knapper på en datamaskin og en mobil." },
      collage: { title: "Plass til hver gjenstand", text: "Et stilleben å åpne med, et utsagn, samlinger som bilder med tekst under og historien ved siden av verkstedet." },
      closeup: { title: "Gjenstanden kommer først", text: "Den største halvdelen til bildet, med prisen og knappen for å legge i handlekurven synlig ved siden av." },
    },
  },
  arcade: {
    summary: "En spillehall om natten: lysende neonoverskrifter, pikselmerker og skjermer som lyser opp.",
    description:
      "Laget fra bunnen av for butikker med en leken side. Nesten svarte sider med svake skannelinjer, overskrifter i Tilt Neon som gløder som bøyd glass og tennes slik et skilt gjør, pikselmerker med en blinkende markør, knallrosa for knappen som teller og cyan for det som svarer på pekeren, produktkort som opplyste skjermer, nivåer for hvordan ting blir laget, og en produktside der bildet står i en lysende ramme. Demobutikken, Neon Alley, selger LED-neonskilt.",
    highlights: {
      devices: { title: "Opplyst på alle skjermer", text: "Arcades lysende overskrifter, pikselmerker og neonknapper på en datamaskin og en mobil." },
      collage: { title: "Seksjoner som gløder", text: "Et synthwave-toppbanner, samlinger som opplyste skjermer, nivåer for hvordan ting lages og en vegg av skilt til slutt." },
      closeup: { title: "Et produkt i rampelyset", text: "Bildet i en lysende ramme, med prisen og knappen for å legge i handlekurven på et panel ved siden av." },
    },
  },
  botanica: {
    summary: "En plantebutikk på papir: myke serifbokstaver, buede bilder og plass til å vokse.",
    description:
      "Laget fra bunnen av for butikker som får ting til å gro. Varme kremfargede sider med papirstruktur, de myke bokstavene i Fraunces med ett kursivt ord i hver overskrift over DM Sans, et toppfelt som svever som en avrundet stripe, bilder formet som buer og myke flater, en bregnekvist som vaier ved toppbanneret, samlinger på avrundede kort, stell forklart med små ikoner, og et bånd av blader til slutt. Demobutikken, Fernhouse, selger stueplanter.",
    highlights: {
      devices: { title: "Rolig på alle skjermer", text: "Botanicas papirsider, myke serifbokstaver og avrundede knapper på en datamaskin og en mobil." },
      collage: { title: "Seksjoner som puster", text: "Et buet bilde ved siden av teksten, samlinger på kort, stell med små ikoner og et bånd av blader til slutt." },
      closeup: { title: "En produktside med plass", text: "Bildet med myke hjørner ved siden av prisen og knappen for å legge i handlekurven, alltid synlig." },
    },
  },
  kinetic: {
    summary: "Et sportsmerke i bevegelse: kraftige kursive versaler, et toppbanner like bredt som skjermen og ord som løper.",
    description:
      "Laget fra bunnen av for sports- og friluftsmerker. Krithvite sider, Barlow Condensed i kraftige kursive versaler over Inter, et toppfelt som ligger over et toppbanner like bredt som skjermen, et bånd av ord som løper over siden, utstyr for kvinner og menn side om side som to høye bilder, firkantede knapper med en pil, bilder med et avskåret hjørne, konturtall og et flomlyst bånd til slutt. Demobutikken, Halden Athletic, selger løpe- og treningstøy for kvinner og menn.",
    highlights: {
      devices: { title: "Laget for fart på alle skjermer", text: "Kinetics kraftige kursive versaler, toppbanner i full bredde og firkantede knapper på datamaskin og mobil." },
      collage: { title: "Seksjoner med driv", text: "Et toppbanner like bredt som skjermen, ord som løper over siden, utstyr for kvinner og menn og et flomlyst bånd." },
      closeup: { title: "En produktside som kommer til saken", text: "Bildet med et avskåret hjørne ved siden av prisen og knappen for å legge i handlekurven, alltid synlig." },
    },
  },
  meridian: {
    summary: "Et rådgivningsfirma som er hjemme i styrerommet: lette serifer, dyp marineblå og messing, og tjenester som bestilles på nett.",
    description:
      "Laget fra bunnen av for rådgivningsfirmaer, rådgivere og andre profesjonelle virksomheter. Elfenbensfargede sider og dyp marineblå, Newsreader i lette visningsstørrelser med vendingen i et uttrykk i kursiv messing over Hanken Grotesk, et toppfelt som ligger over et toppbanner like bredt som skjermen, fire prinsipper delt med fine linjer, tre fagområder som høye bilder, tjenester som bestilles på nett, en nummerert arbeidsmåte, et sitat i stor kursiv og et marineblått bånd til slutt. Demobutikken, Aldren Partners, er et rådgivningsfirma innen strategi og ledelse.",
    highlights: {
      devices: { title: "Samlet på alle skjermer", text: "Meridians lette serifer, marineblå toppbanner og detaljer i messing på en datamaskin og en mobil." },
      collage: { title: "Seksjoner med tyngde", text: "Et toppbanner i full bredde, prinsipper delt med fine linjer, fagområder som høye bilder og et marineblått bånd." },
      closeup: { title: "En tjenesteside som tar bestillinger", text: "Bildet i en fin ramme ved siden av prisen og tidene du kan bestille, alltid synlig." },
    },
  },
};
