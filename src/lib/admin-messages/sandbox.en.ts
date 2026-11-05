/**
 * The page builder's sandbox (D456, `docs/builder-sandbox.md`), in English: the start screen at `/admin/try`, the bar every sandbox page
 * has, the sandbox's home and what it says when a sandbox has ended. `{name}`-style placeholders are filled by `fillWords()`; a count is a
 * `{ one, many }` pair read by `countWords()`, with `{n}` the number.
 */
export const sandboxEn = {
  start: {
    title: "Try the page builder",
    lead: "Build pages in the real page builder, on a store of your own. No sign-up and nothing to install.",
    private: "Only you can see your store. It stays for 7 days after your last visit, then it is deleted.",
    button: "Start building",
    back: "Back to your store",
    off: "The sandbox is closed right now. Try again later.",
    busy: "Many sandboxes were started from your network just now. Try again in an hour.",
    full: "The sandbox is full for today. Try again tomorrow.",
    failed: "Your store could not be made. Try again.",
  },
  bar: {
    label: "Sandbox",
    home: "Your store",
    privateNote: "Only you can see this store.",
    daysLeft: { one: "{n} day left", many: "{n} days left" },
    lastDay: "Last day",
    startOver: "Start over",
    startOverConfirm: "Start again from a fresh store? This one is closed and what you made here is gone.",
  },
  home: {
    title: "Your store",
    lead: "Change anything you like: the words, the pictures, the look. Press Publish to see a page as your store would show it.",
    editFront: "Edit the front page",
    pages: "Pages",
    headers: "Headers",
    footers: "Footers",
    newPage: "New page",
    newHeader: "New header",
    newFooter: "New footer",
    edit: "Edit",
    preview: "Preview",
    front: "Front page",
    draft: "Draft",
    none: "None yet.",
    untitled: "Untitled",
  },
  ended: {
    title: "This sandbox has ended",
    lead: "A sandbox lasts 7 days after the last visit and opens only in the browser that started it. Start a new one to try again.",
    startAgain: "Start a new one",
  },
  templatePreview: {
    notice: "Preview: nothing is saved or copied",
    by: "By {publisher}",
  },
  refused: {
    gone: "This sandbox has ended. Start a new one to go on.",
    notHere: "That is not part of the sandbox.",
  },
};

export type SandboxMessages = typeof sandboxEn;
