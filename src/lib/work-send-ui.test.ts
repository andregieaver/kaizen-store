import { describe, expect, it } from "vitest";

import { MESSAGE_MAX } from "./work-email";
import { sendFormProblems, sendReason, sentText } from "./work-send-ui";

describe("the send dialog's rules", () => {
  it("wants an address that is one, and a message that is not too long", () => {
    expect(sendFormProblems({ to: "kunde@example.no", message: "", kind: "invoice" })).toEqual([]);
    expect(sendFormProblems({ to: " ", message: "", kind: "invoice" })).toEqual(["Give an email address to send it to."]);
    expect(sendFormProblems({ to: "kunde", message: "", kind: "reminder" })).toEqual(["That is not an email address."]);
    expect(sendFormProblems({ to: "a@b.no", message: "x".repeat(MESSAGE_MAX + 1), kind: "invoice" })).toHaveLength(1);
  });

  it("says what happened, and that a kept email was not sent", () => {
    expect(sentText("invoice", "sent", "a@b.no")).toBe("The invoice was sent to a@b.no.");
    expect(sentText("reminder", "sent", "a@b.no")).toBe("The reminder was sent to a@b.no.");
    expect(sentText("invoice", "logged", "a@b.no")).toContain("not sent");
  });

  it("has a plain message for every reason the server gives", () => {
    for (const code of ["not_found", "not_issued", "not_open", "no_email", "invalid_email", "already_sent", "failed"]) {
      expect(sendReason(code).length, code).toBeGreaterThan(10);
    }
    expect(sendReason("something new")).toContain("could not be sent");
  });
});
