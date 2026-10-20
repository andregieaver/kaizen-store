/**
 * The English interface text a visitor's browser needs (D212): what its client components read through `browserText()`.
 * Kept apart so a page's scripts carry these few texts in each language, never the whole of `en.ts`, which spreads them in.
 * A new text a visitor's client component reads goes here and in `nb-browser.ts`, `sv-browser.ts` and `da-browser.ts`.
 */
export const enBrowser = {
gift: {
  title: "This is a gift",
  to: "To",
  from: "From",
  message: "Message",
  counter: (left: number) => `${left} ${left === 1 ? "character" : "characters"} left`,
  // legal: needs review
  note: {
    printed: "The message is printed on the order's packing slip. The store does not send it to the recipient.",
    yourMessage: "Your gift message",
    tooLong: (over: number) => `The message is ${over} ${over === 1 ? "character" : "characters"} too long.`,
    tooManyLines: (max: number) => `The message can have at most ${max} lines.`,
    nameTooLong: (max: number) => `A name can have at most ${max} characters.`,
    saveFailed: "The gift message was not saved. Try again.",
  },
  slip: {
    heading: (name: string) => `A gift for ${name}`,
    anonymous: "A gift",
    from: (name: string) => `From ${name}`,
  },
},
/**
 * The page a buyer opens from a pay link a store sent (wave 3, run 2, D173): what the order is, who sells it, the right of withdrawal, and what became of the link.
 * The terms sentence and the button are the checkout's own (`terms`, `payNow`). Hand-written only; needs human legal review before real use.
 */
// legal: needs review
galleryLabel: "Pictures",
playVideo: "Play video",
playsFrom: (source: string) => `Plays from ${source}`,
htmlFromElsewhere: "Content from another website. It may set cookies once shown.",
embeddedContent: "Embedded content",
showContent: "Show content",
ratedOutOf5: (stars: number) => `${stars} out of 5 stars`,
carouselPrevious: "Previous",
carouselNext: "Next",
carousel: "Carousel",
carouselPages: "Slides",
carouselGoTo: (page: number, pages: number) => `Go to slide ${page} of ${pages}`,
carouselPause: "Pause the carousel",
carouselPlay: "Play the carousel",
galleryClose: "Close",
galleryOf: (n: number, total: number) => `${n} of ${total}`,
savingChange: "Saving …",
form: {
  name: "Name",
  email: "Email",
  phone: "Phone",
  message: "Message",
  optional: "optional",
  choose: "Choose …",
  send: "Send",
  subscribe: "Sign me up",
  sending: "Sending …",
  sent: "Thank you! Your message has been sent.",
  emailPlaceholder: "Your email address",
  newsletterConsent: "Yes, email me the newsletter. I can unsubscribe at any time.",
  subscribed: "Thank you! You are signed up.",
  checkEmail: "Almost done: we have sent you an email. Open the link in it to confirm your sign-up.",
  confirmed: "Thank you! Your email address is confirmed and you are signed up.",
  expired: "The link has expired or was already used. Sign up again if you like.",
  required: "Fill in this field.",
  invalidEmail: "Enter a valid email address.",
  invalidPhone: "Enter a valid phone number.",
  tooLong: "The text is too long.",
  consentNeeded: "Tick the box to go on.",
  failed: "It could not be sent. Try again in a moment.",
  busy: "Too many tries. Try again later.",
  preview: "The form sends from the site, not from here.",
  confirmSubject: (site: string) => `Confirm your sign-up to the newsletter from ${site}`,
  confirmHeading: "Confirm your email address",
  confirmText: (site: string) =>
    `Someone, hopefully you, signed this address up to the newsletter from ${site}. Press the button to confirm. If it was not you, ignore this email: nothing more will happen.`,
  confirmButton: "Confirm my sign-up",
  confirmValid: "The link works for 7 days.",
  messageSubject: (site: string) => `New message from ${site}`,
  messageHeading: "A new message from the form on your site",
  replyHint: "Reply to this email to answer the sender.",
  subscriberSubject: (site: string) => `New newsletter sign-up from ${site}`,
  subscriberHeading: "A new newsletter sign-up",
  subscriberText: "Add the address to your newsletter list. The consent and when it was given are below.",
  page: "Page",
  consent: "Consent",
  consentedAt: "Consented",
  confirmedAt: "Confirmed",
  yes: "Yes",
  no: "No",
},
  // legal: needs review. The exchange wish on a return's status page (D239 2.1): asked only after the withdrawal, never part of it.
  exchangeWish: {
    heading: "Would you like something else instead of your money back?",
    label: "What would you like instead?",
    hint: "For example another size or colour. This is only a wish: until you confirm a proposal from the store, you get your money back as usual.",
    button: "Ask for an exchange",
    working: "One moment …",
    sent: "Your wish is sent. The store will send you a proposal; until you confirm one, you will get your money back as usual.",
    empty: "Write what you would like instead.",
    tooLong: (over: number) => `${over} characters too many.`,
    tooManyLines: (max: number) => `Write at most ${max} lines.`,
    counter: (left: number) => `${left} characters left`,
    failed: "Your wish could not be sent. Try again in a moment.",
  },
  // legal: needs review. Back in stock (D298, docs/wave-5-marketing.md 6.4): the request on a sold-out variant.
  backInStock: {
    prompt: "Get an email when it is back",
    label: "Your email",
    button: "Email me when it is back",
    working: "One moment …",
    waiting: "We will email you once when it is back.",
    check: "We sent you an email. Open its link to confirm, and we will tell you when it is back.",
    invalid: "Write a whole email address.",
    busy: "Too many tries. Try again later.",
    failed: "It did not work. Try again.",
    note: "We email you once about this product, nothing else.",
  },
};

export type BrowserMessages = typeof enBrowser;
