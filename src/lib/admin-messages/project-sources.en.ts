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
  /** The title written in advance: a number the system made, never a name (a customer's, a deal's title), since titles reach the AI manager. */
  suggested: {
    order: "Follow up order {label}",
    return: "Follow up return {label}",
    review: "Answer the review",
    conversation: "Follow up the conversation",
    customer: "Follow up the customer",
    deal: "Next step for the deal",
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
  /** A task's person told it is theirs (D904 P8.3d): the tasks given since the last email, who gave each, and a link to its list. */
  assignedEmail: {
    subjectOne: "{giver} gave you a task: {title}",
    subjectMany: "You have {n} new tasks in {store}",
    preview: { one: "A task in {store} is yours now.", many: "{n} tasks in {store} are yours now." },
    heading: { one: "A task is yours", many: "{n} tasks are yours" },
    line: "{title}, in {list}, from {giver}",
    buttonOne: "Open the task's list",
    buttonMany: "See your tasks",
    why: "You get this because someone on {store}'s team gave you a task in Projects. You hear about each task once.",
  },
  /** A reminder's email and notification (P4.3), to the task's or the list's person. */
  reminderEmail: {
    subjectTask: "Reminder: {title}",
    subjectList: "Reminder: {list}",
    task: "{title}, in {list}.",
    due: "It is due {when}.",
    list: { one: "{n} task is open in {list}.", many: "{n} tasks are open in {list}." },
    button: "Open the list",
    why: "You get this because a reminder was set in {store}'s Projects. Remove it on the task or the list to stop it.",
  },
  /** A Work assignment's checklists (P8.3d): the card on its page, the lists whose time goes to it. */
  work: {
    heading: "Checklists",
    hint: "Time logged on these lists' tasks comes here.",
    open: { one: "{n} open task", many: "{n} open tasks" },
  },
};

export type ProjectSourcesMessages = Widen<typeof projectSourcesEn>;
