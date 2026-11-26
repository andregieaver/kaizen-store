import type { Widen } from "./common.en";

/**
 * Tasks from an order, a return, a review or a support conversation (D904, `docs/projects.md` P8.3a), in English: the card on the source's
 * page. `{name}`-style placeholders are filled by `fillWords()`. Only the server reads them (`SERVER_AREAS`) and hands them to the card.
 */
export const projectSourcesEn = {
  heading: "Tasks",
  none: "No tasks yet.",
  make: "Make a task",
  title: "Task",
  list: "List",
  /** The store's list for follow-ups, made the first time a task goes to no chosen list. */
  followUps: "Follow-ups",
  newList: "{name} (new list)",
  save: "Add task",
  cancel: "Cancel",
  inList: "In {list}",
  tick: "Tick off {title}",
  suggested: {
    order: "Follow up order {label}",
    return: "Follow up return {label}",
    review: "Answer the review from {label}",
    conversation: "Follow up the conversation with {label}",
  },
  /** After a task is made from a conversation, where the inbox has no room for its list. */
  added: "Task added to {list}.",
  /** A deal's projects (P8.3b): the card on a deal's page, and starting one when the deal is won. */
  deal: {
    heading: "Projects",
    none: "No project yet.",
    start: "Start a project",
    hint: "Named after the deal and linked to it.",
    from: "Start from",
    empty: "An empty project",
    go: "Start project",
  },
  openLists: "See your checklists",
};

export type ProjectSourcesMessages = Widen<typeof projectSourcesEn>;
