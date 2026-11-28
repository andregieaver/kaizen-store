/**
 * What a version changes, in English (bloat review step 2.50): beside `version-difference-words.ts`, whose `differenceLine()` the AI manager's
 * A/B test tools say with no language, so the `builder` catalogue takes its `differences` and `blockNames` from here and those tools bring no
 * catalogue. Imports nothing.
 */

export const DIFFERENCES_EN = {
  fields: {
    title: "The title changed.",
    slug: "The address changed.",
    excerpt: "The excerpt changed.",
    seo: "The search texts changed.",
    thumbnail: "The page's picture changed.",
    css: "The page's own CSS changed.",
    terms: "Its categories or tags changed.",
    markets: "The countries it is for changed.",
    search: "Whether search engines or AI assistants may read it changed.",
  },
  text: "{label}: “{before}” became “{after}”",
  textAdded: "{label}: “{after}” added",
  textRemoved: "{label}: “{before}” taken out",
  rowAdded: "A row added at place {row}.",
  rowRemoved: "The row at place {row} taken out.",
  rowMoved: "The row at place {from} moved to place {to}.",
  blockAdded: "A {block} added in row {row}.",
  blockRemoved: "A {block} taken out of row {row}.",
  settingsRow: "Row {row}'s settings changed.",
  settingsColumn: "A column's settings changed in row {row}.",
  settingsBlock: "The settings of a {block} changed in row {row}.",
  none: "Nothing differs.",
};

export const BLOCK_NAMES_EN = {
  richText: "Rich text",
  columns: "Columns",
  heading: "Heading",
  image: "Image",
  beforeAfter: "Before and after",
  animation: "Animation",
  timeline: "Timeline",
  cards: "Cards",
  appPreview: "App preview",
  button: "Button",
  contentGrid: "Content grid",
  product: "Product",
  site: "Site",
  menu: "Menu",
  search: "Search",
  plans: "Plans",
  extensions: "Extensions",
  domainSearch: "Domain search",
  themeStore: "Theme store",
  customField: "Custom fields",
  fieldLoop: "Field loop",
  storePart: "Shop page",
  separator: "Separator line",
  dualButton: "Dual button",
  accordion: "Accordion",
  tabs: "Tabs",
  faq: "FAQs",
  video: "Video",
  html: "HTML",
  testimonials: "Testimonials",
  socialLinks: "Social media",
  iconList: "Icon list",
  table: "Table",
  brands: "Brands",
  gallery: "Gallery",
  emailForm: "Email form",
  newsletter: "Newsletter",
  form: "Form",
  instagram: "Instagram feed",
  countdown: "Countdown",
  stats: "Animated stats",
};

/** Both, as `differenceLine()` reads them. */
export const VERSION_DIFFERENCE_EN = { differences: DIFFERENCES_EN, blockNames: BLOCK_NAMES_EN };
