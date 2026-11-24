/**
 * What a store's Cookies page says while the store recognises companies (D890, `docs/analytics.md` "Companies"), in the hand-written shop
 * languages. Kept out of the catalogues in `src/lib/messages`, which every store page loads, since only this one page of the stores that
 * recognise companies says it (`route-budget.mjs`: the storefront messages' bytes). Another language reads the English.
 */
export const COOKIE_COMPANIES: Readonly<Record<string, string>> = {
  en: "Companies: while this store recognises companies, the network a counted visit comes from is looked up with Leadfeeder (in the EU), which says whether it is a company's own network. Only the company is kept, with the day and the pages it looked at; your IP address is not kept, and a person, a home connection or a phone is never named. If your browser sends Global Privacy Control or Do Not Track, nothing is looked up.",
  nb: "Bedrifter: så lenge denne butikken gjenkjenner bedrifter, slås nettverket et talt besøk kommer fra opp hos Leadfeeder (i EU), som sier om det er en bedrifts eget nettverk. Bare bedriften lagres, med dagen og sidene den så på; IP-adressen din lagres ikke, og en person, en hjemmetilkobling eller en mobil blir aldri navngitt. Sender nettleseren din Global Privacy Control eller Do Not Track, slås ingenting opp.",
  sv: "Företag: så länge den här butiken känner igen företag slås nätverket ett räknat besök kommer från upp hos Leadfeeder (i EU), som säger om det är ett företags eget nätverk. Bara företaget sparas, med dagen och sidorna det tittade på; din IP-adress sparas inte, och en person, en hemanslutning eller en mobil namnges aldrig. Om din webbläsare skickar Global Privacy Control eller Do Not Track slås ingenting upp.",
  da: "Virksomheder: så længe denne butik genkender virksomheder, slås det netværk, et talt besøg kommer fra, op hos Leadfeeder (i EU), som siger, om det er en virksomheds eget netværk. Kun virksomheden gemmes, med dagen og de sider, den så på; din IP-adresse gemmes ikke, og en person, en hjemmeforbindelse eller en mobil navngives aldrig. Hvis din browser sender Global Privacy Control eller Do Not Track, slås intet op.",
};

/** The sentence in a language (`nb`, `nb-NO`), else in English. */
export const cookieCompaniesText = (lang: string): string => COOKIE_COMPANIES[lang.slice(0, 2).toLowerCase()] ?? COOKIE_COMPANIES.en;
