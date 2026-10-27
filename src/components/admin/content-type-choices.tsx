"use client";

import { createContext, useContext, type ReactNode } from "react";

/** A content type an entry field can take entries of (D326): its fixed key and its name. */
export type ContentTypeChoice = { key: string; name: string };

const Choices = createContext<readonly ContentTypeChoice[]>([]);

/** Gives the field dialogs below the owner's content types, for an entry field's choice of type. */
export function ContentTypeChoices({ types, children }: { types: readonly ContentTypeChoice[]; children: ReactNode }) {
  return <Choices.Provider value={types}>{children}</Choices.Provider>;
}

export const useContentTypeChoices = () => useContext(Choices);
