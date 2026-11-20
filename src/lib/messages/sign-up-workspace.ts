import type { PlatformLang } from "../platform-lang";

/**
 * The words a sign-up for extensions without a store (D748 E7) reads where a store's sign-up reads its own: the confirmation page and the
 * emails about the request, which speak of the account and its trials. Kept apart from `platformText()`, which the storefront's layout
 * reaches, so no store page carries them (`scripts/route-budget.mjs`): only the confirmation page, its action and `access-emails.ts` import it.
 */
const en = {
  confirm: {
    title: "Start your free trial",
    body: "Your account for {store} is made when you press the button, with the free trials you chose.",
    button: "Start my free trial",
    done: "Your account for {store} is ready. We have emailed you a link to sign in.",
    doneWithPassword: "Your account for {store} is ready. Sign in with your email address and the password you chose.",
    failed: "We could not make your account just now. We have kept your request and will set it up for you.",
    off: "Signing up on your own is closed just now. We have kept your request and will write to you when your account is ready.",
  },
  emails: {
    received: {
      subject: "We got your request for {store}",
      preview: "We will write to you again when your account is ready.",
      heading: "Thank you, {name}",
      body: "We got your request to start Kaizena Flow for {store}. We read every request, and we write to you again when your account is ready.",
      nothing: "You do not need to do anything now.",
    },
    approved: {
      subject: "Your Kaizena Flow account for {store} is ready",
      preview: "Sign in with this email address to start.",
      heading: "Your account is ready",
      body: "Your account for {store} is set up, with your free trials. Sign in with this email address to start. We have also sent you a sign-in link in an email of its own.",
      button: "Sign in",
    },
    confirm: {
      subject: "Confirm your email to start {store}",
      preview: "One press and your free trials start.",
      heading: "Confirm your email, {name}",
      body: "Press the button to confirm this address. Your account for {store} is made at once, with the free trials you chose. The link works for 24 hours.",
      button: "Confirm and start my free trial",
      ignore: "If you did not sign up, ignore this email: nothing is made unless the button is pressed.",
    },
  },
};

const nb: typeof en = {
  confirm: {
    title: "Start den gratis prøveperioden",
    body: "Kontoen for {store} lages når du trykker på knappen, med de gratis prøveperiodene du valgte.",
    button: "Start gratis prøveperiode",
    done: "Kontoen for {store} er klar. Vi har sendt deg en lenke på e-post for å logge inn.",
    doneWithPassword: "Kontoen for {store} er klar. Logg inn med e-postadressen din og passordet du valgte.",
    failed: "Vi fikk ikke laget kontoen din akkurat nå. Vi har tatt vare på forespørselen og setter den opp for deg.",
    off: "Det er stengt for å registrere seg på egen hånd akkurat nå. Vi har tatt vare på forespørselen og skriver til deg når kontoen er klar.",
  },
  emails: {
    received: {
      subject: "Vi har fått forespørselen din om {store}",
      preview: "Vi skriver til deg igjen når kontoen er klar.",
      heading: "Takk, {name}",
      body: "Vi har fått forespørselen din om å starte Kaizena Flow for {store}. Vi leser hver forespørsel, og vi skriver til deg igjen når kontoen er klar.",
      nothing: "Du trenger ikke gjøre noe nå.",
    },
    approved: {
      subject: "Kaizena Flow-kontoen for {store} er klar",
      preview: "Logg inn med denne e-postadressen for å komme i gang.",
      heading: "Kontoen din er klar",
      body: "Kontoen for {store} er satt opp, med de gratis prøveperiodene dine. Logg inn med denne e-postadressen for å komme i gang. Vi har også sendt deg en innloggingslenke i en egen e-post.",
      button: "Logg inn",
    },
    confirm: {
      subject: "Bekreft e-postadressen din for å starte {store}",
      preview: "Ett trykk, så starter de gratis prøveperiodene.",
      heading: "Bekreft e-postadressen din, {name}",
      body: "Trykk på knappen for å bekrefte denne adressen. Kontoen for {store} lages med en gang, med de gratis prøveperiodene du valgte. Lenken virker i 24 timer.",
      button: "Bekreft og start prøveperioden",
      ignore: "Hvis du ikke har registrert deg, kan du se bort fra denne e-posten: ingenting lages uten at knappen trykkes.",
    },
  },
};

const WORDS: Record<PlatformLang, typeof en> = { en, nb };

/** A sign-up for extensions' words in `lang`. */
export const signUpWorkspaceText = (lang: PlatformLang): typeof en => WORDS[lang];
