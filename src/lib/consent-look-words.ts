/**
 * The *Cookie popup* card's words in English (D883): the theme editor reads them when no words are handed down
 * (`useHandedText("consentLook")`), so they are not in the design catalogue every builder screen loads. Imports nothing.
 */
export const CONSENT_LOOK_WORDS = {
  title: "Cookie popup",
  sub: { site: "Like the site", light: "Always light", dark: "Always dark" },
  intro: "The cookie banner and its settings popup sit over the whole page. Choose the colours they take; everything else follows the theme.",
  scheme: "Colours",
  schemeHint: "Like the site takes the site's light or dark colours. Choose Dark if the popup should be dark on a light site, or the other way round.",
  schemes: { site: "Like the site", light: "Light", dark: "Dark" },
  customise: "Customise the cookie popup",
  colours: "Colours",
  colourChoices: { theme: "The theme's colours", own: "Colours of its own" },
  colourNames: {
    background: "Background",
    text: "Text",
    muted: "Secondary text",
    border: "Lines",
    button: "Main button",
    buttonText: "Text on the main button",
    secondary: "Other buttons",
    secondaryText: "Text on other buttons",
  },
  inLight: "In light colours",
  inDark: "In dark colours",
  pick: "Choose the popup's {colour} in {set} colours",
  corners: "Box corners",
  buttonCorners: "Button corners",
  cornersTheme: "Like the theme",
  heading: "Heading font",
  headings: { heading: "The headings' font", body: "The body text's font" },
  shadow: "Shadow",
  shadows: { none: "None", soft: "Soft", strong: "Strong" },
  followTheme: "Follow the theme again",
  following: "Everything here follows the theme.",
  /** What `themeWarnings()` names for the popup's own colours. */
  readability: {
    consentText: "The cookie popup's text",
    consentMuted: "The cookie popup's secondary text",
    consentButton: "The cookie popup's main button",
    consentSecondary: "The cookie popup's other buttons",
  },
  sample: {
    heading: "We use cookies",
    text: "Statistics help us make the site better.",
    more: "You can change your choice at any time.",
    reject: "Reject all",
    accept: "Accept all",
    save: "Save choices",
  },
};

export type ConsentLookWords = typeof CONSENT_LOOK_WORDS;
