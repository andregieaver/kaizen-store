/** The kinds of block the owner adds between an email's blocks (D767, email plan M3.4). No imports: the canvas reads it in the browser. */
export const ADDED_BLOCKS = ["heading", "paragraph", "button", "divider"] as const;
export type AddedBlock = (typeof ADDED_BLOCKS)[number];
