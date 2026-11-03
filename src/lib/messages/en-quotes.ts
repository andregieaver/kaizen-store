/**
 * Request a quote and the product question (D431): the price-on-request words of cards and product pages, the request's button and form
 * (the product page's buy part, the cart, the product layout's question part) and what the shopper is told. Read by `t()` on the server, which
 * hands the form its words as props (D212: never the whole of `t()` in a visitor's browser). Written by hand in nb, sv, da and en; other
 * languages come from the AI catalogue.
 */
export const enQuotes = {
  priceOnRequest: "Price on request",
  wishlist: "Request a quote on the product page.",
  request: "Request a quote",
  requestCart: "Request a quote for these items",
  heading: "Request a quote",
  intro: "Tell us what you need, and we will email you a quote.",
  cartIntro: "We will email you a quote for what is in your cart.",
  close: "Close",
  variant: "Variant",
  quantity: "Quantity",
  asking: "You are asking about",
  name: "Name",
  email: "Email",
  emailHint: "We send the quote to this address.",
  phone: "Phone",
  company: "Company",
  note: "Message",
  notePlaceholder: "Anything we should know: sizes, delivery, a date …",
  optional: "optional",
  send: "Send the request",
  sending: "Sending …",
  sent: "Thank you. We have your request and will email you a quote.",
  privacy: "We use these details only to answer your request.",
  problems: {
    required: "Fill in this field.",
    invalid: "Check what is written here.",
    too_long: "This is too long.",
    too_many_lines: "This has too many lines.",
  },
  invalidEmail: "Enter a whole email address.",
  invalidPhone: "Enter a valid phone number.",
  busy: "Too many requests. Try again later.",
  failed: "The request could not be sent. Try again in a moment.",
  notOffered: "A quote cannot be asked for these items.",
  question: {
    heading: "Ask about this product",
    button: "Send the question",
    message: "Your question",
    sent: "Thank you. We have your question and will answer by email.",
    product: "Product",
    /** `{product}` is the product's title (a template, not a function: the words reach a client component, D212). */
    subject: "Question about {product}",
  },
};

export type QuotesMessages = typeof enQuotes;
