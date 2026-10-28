import { describe, expect, it } from "vitest";

import { MADE_PICTURE_RULES } from "./picture-direction";
import { EDIT_ACTIONS, editPrompt, editedFileName, isEditAction, needsBrief } from "./picture-edit";

describe("editing a library picture (D349)", () => {
  it("knows its three edits, and which need words", () => {
    expect(EDIT_ACTIONS).toEqual(["remove_background", "new_background", "change"]);
    expect(isEditAction("change")).toBe(true);
    expect(isEditAction("draw")).toBe(false);
    expect(needsBrief("remove_background")).toBe(false);
    expect(needsBrief("new_background")).toBe(true);
    expect(needsBrief("change")).toBe(true);
  });

  it("asks for the change, keeps the subject and carries the rules of every made picture", () => {
    const removed = editPrompt("remove_background");
    expect(removed).toMatch(/^Remove the background/);
    expect(removed).toContain("Keep the main subject exactly as it is");
    expect(removed).toContain(MADE_PICTURE_RULES);
    const background = editPrompt("new_background", "  a  wooden table by a window ");
    expect(background).toContain("Replace the background with this: a wooden table by a window.");
    expect(background).toContain(MADE_PICTURE_RULES);
    const change = editPrompt("change", "Make the mug blue!");
    expect(change).toMatch(/^Make the mug blue! Change nothing else/);
    expect(editPrompt("change", "x".repeat(5000)).length).toBeLessThanOrEqual(4000);
  });

  it("names the edit after its original, never stacking marks", () => {
    expect(editedFileName("mug.png")).toBe("mug-edited.webp");
    expect(editedFileName("mug-edited.webp")).toBe("mug-edited.webp");
    expect(editedFileName(".webp")).toBe("picture-edited.webp");
  });
});
