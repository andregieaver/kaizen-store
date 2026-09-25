import { z } from "zod";

import type { EmailBlock, EmailContent } from "./email-layout";
import { formatMoney } from "./money";

/**
 * Reminders about carts left at checkout (D33). The texts, their checks
 * and the email itself need no database, so the admin's preview shows
 * exactly what shoppers get.
 */

export type ReminderText = { subject: string; heading: string; body: string; button: string };

export type ReminderStep = {
  id: string;
  delayMinutes: number;
  active: boolean;
  discountCodeId: string | null;
  /** Per locale, e.g. `nb-NO`. */
  content: Record<string, ReminderText>;
};

export type ReminderLine = {
  variantId: string;
  sellingPlanId: string | null;
  title: string;
  quantity: number;
  unitPriceMinor: number;
};

export const MIN_DELAY_MINUTES = 30;
export const MAX_DELAY_MINUTES = 30 * 24 * 60;

/** Texts to start from, per language; `{store}` and `{code}` are filled in. */
const DEFAULTS: Record<string, [ReminderText, ReminderText, ReminderText]> = {
  nb: [
    {
      subject: "Glemte du noe hos {store}?",
      heading: "Handlekurven din venter",
      body: "Du la noen varer i handlekurven, men fullførte ikke kjøpet. Vi har tatt vare på dem for deg.",
      button: "Fullfør kjøpet",
    },
    {
      subject: "Varene dine hos {store} venter fortsatt",
      heading: "Fortsatt interessert?",
      body: "Handlekurven din er lagret. Lagerbeholdningen kan endre seg, så fullfør gjerne mens varene er på lager.",
      button: "Gå til handlekurven",
    },
    {
      subject: "Siste påminnelse om handlekurven din",
      heading: "Siste påminnelse",
      body: "Dette er siste gang vi minner deg på handlekurven din hos {store}.",
      button: "Fullfør kjøpet",
    },
  ],
  sv: [
    {
      subject: "Glömde du något hos {store}?",
      heading: "Din varukorg väntar",
      body: "Du lade några varor i varukorgen men slutförde inte köpet. Vi har sparat dem åt dig.",
      button: "Slutför köpet",
    },
    {
      subject: "Dina varor hos {store} väntar fortfarande",
      heading: "Fortfarande intresserad?",
      body: "Din varukorg är sparad. Lagersaldot kan ändras, så slutför gärna köpet medan varorna finns i lager.",
      button: "Till varukorgen",
    },
    {
      subject: "Sista påminnelsen om din varukorg",
      heading: "Sista påminnelsen",
      body: "Det här är sista gången vi påminner dig om din varukorg hos {store}.",
      button: "Slutför köpet",
    },
  ],
  da: [
    {
      subject: "Glemte du noget hos {store}?",
      heading: "Din kurv venter",
      body: "Du lagde nogle varer i kurven, men gennemførte ikke købet. Vi har gemt dem til dig.",
      button: "Gennemfør købet",
    },
    {
      subject: "Dine varer hos {store} venter stadig",
      heading: "Stadig interesseret?",
      body: "Din kurv er gemt. Lagerbeholdningen kan ændre sig, så gennemfør gerne købet, mens varerne er på lager.",
      button: "Gå til kurven",
    },
    {
      subject: "Sidste påmindelse om din kurv",
      heading: "Sidste påmindelse",
      body: "Det er sidste gang, vi minder dig om din kurv hos {store}.",
      button: "Gennemfør købet",
    },
  ],
  en: [
    {
      subject: "Forgot something at {store}?",
      heading: "Your cart is waiting",
      body: "You put a few things in your cart but did not finish checking out. We have kept them for you.",
      button: "Finish your purchase",
    },
    {
      subject: "Your items at {store} are still waiting",
      heading: "Still interested?",
      body: "Your cart is saved. Stock can change, so finish your purchase while the items are available.",
      button: "Go to your cart",
    },
    {
      subject: "Last reminder about your cart",
      heading: "Last reminder",
      body: "This is the last time we remind you about your cart at {store}.",
      button: "Finish your purchase",
    },
  ],
};

/** The three reminders a store starts with: after an hour, a day and three days. */
export function defaultSteps(locales: string[]): Omit<ReminderStep, "id">[] {
  return [60, 24 * 60, 3 * 24 * 60].map((delayMinutes, i) => ({
    delayMinutes,
    active: true,
    discountCodeId: null,
    content: Object.fromEntries(locales.map((locale) => [locale, defaultText(locale, i)])),
  }));
}

/** A starting text for a new reminder in this locale; the nth default, or the last. */
export function defaultText(locale: string, n = 0): ReminderText {
  const texts = DEFAULTS[locale.split("-")[0]] ?? DEFAULTS.en;
  return texts[Math.min(n, texts.length - 1)];
}

/** The words around a reminder, in the shopper's language. */
const WORDS: Record<string, { total: string; codeAdded: (code: string) => string; stop: string; stopLink: string }> = {
  nb: {
    total: "Sum",
    codeAdded: (code) => `Rabattkoden ${code} legges i handlekurven når du går tilbake til den.`,
    stop: "Vil du ikke ha flere påminnelser om handlekurven?",
    stopLink: "Meld deg av",
  },
  sv: {
    total: "Summa",
    codeAdded: (code) => `Rabattkoden ${code} läggs i varukorgen när du går tillbaka till den.`,
    stop: "Vill du inte ha fler påminnelser om varukorgen?",
    stopLink: "Avregistrera dig",
  },
  da: {
    total: "I alt",
    codeAdded: (code) => `Rabatkoden ${code} lægges i kurven, når du går tilbage til den.`,
    stop: "Vil du ikke have flere påmindelser om kurven?",
    stopLink: "Afmeld",
  },
  en: {
    total: "Total",
    codeAdded: (code) => `The discount code ${code} is added to your cart when you go back to it.`,
    stop: "No more reminders about your cart?",
    stopLink: "Unsubscribe",
  },
};

const fill = (text: string, values: { store: string; code: string }) =>
  text.replaceAll("{store}", values.store).replaceAll("{code}", values.code);

/**
 * The reminder as sent: the store's text, the cart with its prices, the
 * discount code if the step has one, the way back, and the way out.
 */
export function buildReminderEmail(input: {
  text: ReminderText;
  locale: string;
  currency: string;
  storeName: string;
  footer: string[];
  lines: ReminderLine[];
  code: string | null;
  restoreUrl: string;
  unsubscribeUrl: string;
}): EmailContent {
  const lang = input.locale.split("-")[0];
  const words = WORDS[lang] ?? WORDS.en;
  const values = { store: input.storeName, code: input.code ?? "" };
  const money = (minor: number) => formatMoney(minor, input.currency, input.locale);
  const total = input.lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
  const blocks: EmailBlock[] = [
    { type: "heading", text: fill(input.text.heading, values) },
    ...fill(input.text.body, values)
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((text): EmailBlock => ({ type: "paragraph", text })),
    {
      type: "lines",
      rows: [
        ...input.lines.map((line) => ({ label: `${line.quantity} × ${line.title}`, value: money(line.unitPriceMinor * line.quantity) })),
        { label: words.total, value: money(total), strong: true },
      ],
    },
    ...(input.code ? [{ type: "code", text: input.code } as EmailBlock, { type: "paragraph", text: words.codeAdded(input.code) } as EmailBlock] : []),
    { type: "button", text: fill(input.text.button, values), url: input.restoreUrl },
  ];
  return {
    subject: fill(input.text.subject, values),
    preview: fill(input.text.heading, values),
    lang,
    blocks,
    footer: input.footer,
    unsubscribe: { text: words.stop, linkText: words.stopLink, url: input.unsubscribeUrl },
  };
}

/** "1 hour", "3 days": how long after the email was typed, in English for the admin. */
export function describeDelay(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? "1 day" : `${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return `${minutes} minutes`;
}

const text = z.object({
  subject: z.string().trim().min(1, "Give each language a subject.").max(150),
  heading: z.string().trim().min(1, "Give each language a heading.").max(150),
  body: z.string().trim().min(1, "Give each language a message.").max(3000),
  button: z.string().trim().min(1, "Give each language a button text.").max(60),
});

/** A reminder as the admin sends it. */
export const reminderStepInput = z.object({
  delayMinutes: z.coerce
    .number()
    .int()
    .min(MIN_DELAY_MINUTES, "Wait at least 30 minutes: the shopper may still be paying.")
    .max(MAX_DELAY_MINUTES, "Send it within 30 days."),
  active: z.boolean().default(true),
  discountCodeId: z.uuid().nullable().default(null),
  content: z.record(z.string(), text),
});

export type ReminderStepInput = z.input<typeof reminderStepInput>;
