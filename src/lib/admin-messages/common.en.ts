/**
 * The admin's words every area shares (D312 A0, `docs/platform-admin-i18n.md` 3.3): the account menu, the language choice. English is
 * the type, so a language without a key does not compile. Read on the server with `adminText(lang, "common")` (`src/lib/admin-text.ts`)
 * and in a client part with `useAdminText("common")`; a slice that reaches the browser holds strings only (a choice by number goes through
 * `src/lib/icu-lite.ts`). Legal and financial words come only from the glossary (`src/lib/i18n-glossary.ts`).
 */
import { ORDER_STATUS_LABELS } from "../order-status";

export const commonEn = {
  /** An order's status as the admin's lists show it (D312 A3): `ORDER_STATUS_LABELS`, in each language. */
  orderStatus: { ...ORDER_STATUS_LABELS },
  accountMenu: {
    yourAccount: "Your account",
    contactSupport: "Contact Kaizena Flow support",
    colours: "Colours",
    toDark: "Switch to dark colours",
    toLight: "Switch to light colours",
    language: "Language",
    kaizenLife: "Kaizen Life",
    signOut: "Sign out",
  },
  /** A store feature's name (D178, `STORE_FEATURES`), what it needs in a sentence, and what a page says while it is off (`FeatureOff`, D312 A8). */
  features: {
    labels: {
      shop: "Online shop",
      subscriptions: "Subscriptions",
      boxes: "Subscription boxes",
      appointments: "Appointments",
      bookings: "Stays and rentals",
      gift_cards: "Gift cards",
      countries: "Several countries",
      languages: "Several languages",
      currencies: "Several currencies",
      business: "Sell to businesses",
      bonus: "Bonus program",
      referrals: "Referral program",
      reviews: "Product reviews",
      sales: "Deals",
    },
    /** A feature that another needs, in a sentence: "needs the online shop". */
    need: {
      shop: "the online shop",
      subscriptions: "the subscriptions",
      boxes: "the subscription boxes",
      appointments: "the appointments",
      bookings: "the stays and rentals",
      gift_cards: "the gift cards",
      countries: "the several countries",
      languages: "the several languages",
      currencies: "the several currencies",
      business: "the sell to businesses",
      bonus: "the bonus program",
      referrals: "the referral program",
      reviews: "the product reviews",
      sales: "the deals",
    },
    or: " or ",
    off: { one: "{label} is switched off", many: "{label} are switched off" },
    /** What a server action says when a stale page asks for something of a feature that is off (`featureOffText()`). */
    offUnder: { one: "{label} is switched off under Settings, Features.", many: "{label} are switched off under Settings, Features." },
    asleep: "{label} needs {need}, which is switched off.",
    hidden: "This page is hidden while the feature is off. Nothing has been deleted: switch it on and everything is as it was.",
    goTo: "Go to Features",
    onlyOwner: "Only an owner can switch features on or off, under Settings → Features.",
    noteOff: "{label} is switched off, so this is hidden.",
    noteSwitch: "Switch it on under Features",
    noteOwner: "An owner can switch it on under Settings, Features",
  },
  /** What forms say on their own (`SubmitButton`, `PasswordField`). */
  form: {
    working: "Working …",
    show: "Show",
    hide: "Hide",
    delete: "Delete",
    deleting: "Deleting …",
  },
  language: {
    title: "Language",
    description: "The language the admin is shown in for you. Your stores' shoppers see the languages chosen for each store.",
    saving: "Saving …",
    kept: "Kept with your account, so the admin is in the same language on every device you sign in on.",
    partly: "Parts of the admin not yet written in your language are shown in English.",
  },
  /** The buttons of a list of export jobs (D165): a finished one's files, or the job's page. */
  jobs: { download: "Download", open: "Open" },
  /** The shared dialog, floating panel and upload buttons (D88, D213). */
  ui: {
    close: "Close",
    movePanel: "Move the panel",
    movePanelHint: "Focus this and press the arrow keys to move the panel; Shift and the arrow keys resize it",
    uploadsOff: "Uploads are not set up on this server.",
    compressingUploading: "Compressing and uploading …",
    compressing: "Compressing …",
    compressingPercent: "Compressing … {percent} %",
    uploading: "Uploading …",
    videoHint: "MP4 or WebM. It is made smaller in your browser before it is uploaded, and plays without sound, on a loop.",
    videoType: "Use an MP4 or WebM video.",
    videoTooLarge: "That video is too large. Use one under {mb} MB.",
    videoTooLargeCompressed: "That video is too large, even compressed. Use one under 50 MB, or a shorter one.",
    notUploaded: "{name} could not be uploaded. Try again.",
    saved: "Saved {size} ({percent}%)",
    unreadable: "{name} could not be read as a picture. Use a JPEG, PNG, WebP or AVIF.",
  },
  /** The data pages' jobs (D165): their state, progress, files and the recent list, on every import and export page. */
  dataJobs: {
    statuses: {
      uploaded: "File received",
      checking: "Checking the file",
      checked: "Checked, ready to import",
      queued: "Waiting to start",
      running: "Working",
      done: "Done",
      failed: "Stopped with a problem",
      cancelled: "Cancelled",
      expired: "Files removed",
    },
    saving: {
      product_import: "Saving products",
      redirect_import: "Saving redirects",
      inventory_import: "Saving stock",
      customer_import: "Saving customers",
      order_history_import: "Saving orders",
    } as Record<string, string>,
    assembling: "Putting the file together",
    preparing: "Preparing your file",
    units: {
      product_import: "products",
      product_export: "products",
      order_export: "rows",
      customer_export: "customers",
      redirect_import: "redirects",
      redirect_export: "redirects",
      inventory_import: "rows",
      inventory_export: "rows",
      customer_import: "rows",
      order_history_import: "rows",
    },
    kinds: {
      product_import: "Product import",
      product_export: "Product export",
      order_export: "Order export",
      customer_export: "Customer export",
      redirect_import: "Redirect import",
      redirect_export: "Redirect export",
      inventory_import: "Stock import",
      inventory_export: "Stock export",
      customer_import: "Customer import",
      order_history_import: "Order history import",
    },
    doneOf: "{done} of {total} {unit}",
    count: "{n} {unit}",
    expired: "expired",
    expiresDays: { one: "expires in {n} day", many: "expires in {n} days" },
    expiresHours: { one: "expires in {n} hour", many: "expires in {n} hours" },
    leave: "You can leave this page. The work goes on, and the job is here when you come back.",
    lost: "This page lost touch with the job. It keeps going on its own: reload the page to see where it is.",
    files: "Files",
    ready: { one: "Your file is ready", many: "Your {n} files are ready" },
    rows: "{n} rows",
    rowsAndSize: "{rows} rows, {size}",
    linkNote: "The download link is made when you press the button and works for a minute.",
    recent: "Recent exports",
    recentLabel: "Recent exports of this store, newest first",
    noRows: "No rows yet",
  },
  /**
   * The VAT categories the platform added beside the three built-in ones (D157, the tax engine's migration), as they are written there:
   * shown in the admin's language wherever a category is chosen. A category a platform admin adds later keeps the words it was given.
   */
  vatCategories: {
    food: { label: "Food and drink", hint: "Food and drink for people, where the country has a reduced rate." },
    books: { label: "Books", hint: "Printed books, and e-books where the country applies the reduced rate." },
    periodicals: { label: "Newspapers and periodicals", hint: "Newspapers, magazines and periodicals, where the country has a reduced rate." },
    medicines: { label: "Medicines and medical aids", hint: "Medicines and medical aids, where the country has a reduced rate." },
    culture_events: { label: "Culture and events", hint: "Admission to cultural events, cinemas and attractions, where the country has a reduced rate." },
    children_goods: { label: "Children's goods", hint: "Children's clothing, footwear and car seats, where the country has a reduced rate." },
  } as Record<string, { label: string; hint: string }>,
  /** The search snippet fields (`SearchSnippetFields`): a product, a page, a category, the store's and Kaizena Flow's front page. */
  snippet: {
    count: "{length} of about {advice} characters",
    cut: ": search engines may cut the end",
    title: "Title in search results",
    description: "Description in search results",
    preview: "Preview in search results",
  },
};

export type Widen<T> = T extends (...args: infer A) => infer R ? (...args: A) => R : T extends object ? { [K in keyof T]: Widen<T[K]> } : string;

export type CommonMessages = Widen<typeof commonEn>;
