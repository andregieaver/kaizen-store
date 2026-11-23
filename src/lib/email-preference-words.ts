/**
 * The words of the page a marketing email's foot links to, and of that link itself (email plan M4.2, D882), in each storefront language.
 * Apart from `src/lib/messages` so the store layout's catalogues carry none of them: only the page, its action and the email builder
 * import this. A language without its own words reads English's.
 */

const en = {
  choose: "Choose what you get or unsubscribe",
  prefsIntro: "Choose what you get from us.",
  topicsLegend: "What you get",
  often: "How often",
  oftenAll: "Everything we send",
  oftenWeekly: "At most once a week",
  oftenMonthly: "At most once a month",
  save: "Save",
  saved: "Saved. From now on you get what you chose.",
  pauseHeading: "Need a break?",
  pauseText: "Get nothing from us for a month. After that, you get what you chose again.",
  pauseButton: "Pause for a month",
  resting: (date: string) => `Your emails are paused until ${date}.`,
  resume: "Start again now",
  leaveHeading: "Unsubscribe from everything",
};

export type PreferenceWords = typeof en;

const WORDS: Record<string, PreferenceWords> = {
  en,
  nb: {
    choose: "Velg hva du får, eller meld deg av",
    prefsIntro: "Velg hva du vil få fra oss.",
    topicsLegend: "Hva du får",
    often: "Hvor ofte",
    oftenAll: "Alt vi sender",
    oftenWeekly: "Høyst én gang i uken",
    oftenMonthly: "Høyst én gang i måneden",
    save: "Lagre",
    saved: "Lagret. Fra nå av får du det du valgte.",
    pauseHeading: "Trenger du en pause?",
    pauseText: "Få ingenting fra oss i en måned. Etterpå får du det du valgte igjen.",
    pauseButton: "Ta en pause i en måned",
    resting: (date: string) => `E-postene dine er satt på pause til ${date}.`,
    resume: "Start igjen nå",
    leaveHeading: "Meld deg av alt",
  },
  sv: {
    choose: "Välj vad du får eller avsluta prenumerationen",
    prefsIntro: "Välj vad du vill få från oss.",
    topicsLegend: "Vad du får",
    often: "Hur ofta",
    oftenAll: "Allt vi skickar",
    oftenWeekly: "Högst en gång i veckan",
    oftenMonthly: "Högst en gång i månaden",
    save: "Spara",
    saved: "Sparat. Från och med nu får du det du valde.",
    pauseHeading: "Behöver du en paus?",
    pauseText: "Få ingenting från oss på en månad. Efter det får du det du valde igen.",
    pauseButton: "Pausa i en månad",
    resting: (date: string) => `Dina e-postmeddelanden är pausade till ${date}.`,
    resume: "Börja igen nu",
    leaveHeading: "Avsluta allt",
  },
  da: {
    choose: "Vælg, hvad du får, eller afmeld dig",
    prefsIntro: "Vælg, hvad du vil have fra os.",
    topicsLegend: "Hvad du får",
    often: "Hvor tit",
    oftenAll: "Alt, vi sender",
    oftenWeekly: "Højst én gang om ugen",
    oftenMonthly: "Højst én gang om måneden",
    save: "Gem",
    saved: "Gemt. Fra nu af får du det, du valgte.",
    pauseHeading: "Brug for en pause?",
    pauseText: "Få ingenting fra os i en måned. Bagefter får du det, du valgte, igen.",
    pauseButton: "Hold pause i en måned",
    resting: (date: string) => `Dine e-mails er sat på pause til ${date}.`,
    resume: "Start igen nu",
    leaveHeading: "Afmeld alt",
  },
};

/** The words in a storefront language (`nb`, `sv`, `da`, `en`), English for any other. */
export const preferenceWords = (lang: string): PreferenceWords => WORDS[lang] ?? en;
