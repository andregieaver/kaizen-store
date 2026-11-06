import { describe, expect, it } from "vitest";

import { planImport, readActivity, readDeal, readNote, readOrganization, readPerson, readStage, toMinor, type PdAccount } from "./pipedrive";

describe("Pipedrive's records, read", () => {
  it("reads organisations and persons in API v2's shapes, the primary email and phone first", () => {
    expect(readOrganization({ id: 7, name: " Kunde AS ", address: { value: "Storgata 1, Oslo" }, owner_id: 1 })).toEqual({ id: "7", name: "Kunde AS", address: "Storgata 1, Oslo" });
    expect(readOrganization({ id: 8, name: "Gone AS", is_deleted: true })).toBeNull();
    expect(
      readPerson({
        id: 11,
        name: "Kari Nordmann",
        emails: [{ value: "kari@privat.no", primary: false }, { value: "Kari@Kunde.no", primary: true, label: "work" }],
        phones: [{ value: "+47 900 00 000", primary: true }],
        org_id: 7,
      }),
    ).toEqual({ id: "11", name: "Kari Nordmann", email: "kari@kunde.no", phone: "+47 900 00 000", orgId: "7" });
    expect(readPerson({ id: 12, first_name: "Ola", last_name: "Hansen", emails: [] })).toMatchObject({ name: "Ola Hansen", email: null });
  });

  it("reads deals with their value in minor units, and leaves deleted ones out", () => {
    expect(
      readDeal({
        id: 21,
        title: "Tote bags",
        status: "won",
        pipeline_id: 1,
        stage_id: 3,
        person_id: 11,
        org_id: 7,
        value: 12500.5,
        currency: "nok",
        expected_close_date: "2026-12-01",
        won_time: "2026-11-02T10:00:00Z",
        add_time: "2026-10-01T08:00:00Z",
      }),
    ).toEqual({
      id: "21",
      title: "Tote bags",
      status: "won",
      pipelineId: "1",
      stageId: "3",
      personId: "11",
      orgId: "7",
      valueMinor: 1250050,
      currency: "NOK",
      expectedCloseOn: "2026-12-01",
      lostReason: null,
      closedAt: "2026-11-02T10:00:00.000Z",
      addedAt: "2026-10-01T08:00:00.000Z",
    });
    expect(readDeal({ id: 22, title: "x", status: "deleted" })).toBeNull();
    expect(toMinor(0, "NOK")).toBeNull();
    expect(toMinor("1000", "SEK")).toBe(100000);
    expect(toMinor(1000, "XYZ")).toBeNull();
  });

  it("reads activities as calls, meetings and tasks, keeping Pipedrive's own type and a meeting's length", () => {
    expect(readActivity({ id: 31, type: "meeting", subject: "Visit", due_date: "2026-11-09", due_time: "13:00", duration: "01:30", done: false, deal_id: 21 })).toMatchObject({
      kind: "meeting",
      originalType: null,
      dueTime: "13:00",
      durationMinutes: 90,
      dealId: "21",
    });
    expect(readActivity({ id: 32, type: "email", subject: "", due_date: "2026-11-09", done: true, marked_as_done_time: "2026-11-09 09:00:00", person_id: 11, note: "<p>Sent the <b>price</b></p>" })).toMatchObject({
      kind: "task",
      originalType: "email",
      title: "email",
      dueTime: "",
      durationMinutes: null,
      done: true,
      doneAt: "2026-11-09T09:00:00.000Z",
      note: "Sent the price",
    });
    expect(readStage({ id: 3, pipeline_id: 1, name: "Quote sent", order_nr: 3, deal_probability: 60 })).toEqual({ id: "3", pipelineId: "1", name: "Quote sent", order: 3, probability: 60 });
    expect(readNote({ id: 41, content: "<p>Met at the fair.</p>", org_id: 7, add_time: "2026-10-02 12:00:00" })).toEqual({ id: "41", text: "Met at the fair.", dealId: null, personId: null, orgId: "7", addedAt: "2026-10-02T12:00:00.000Z" });
  });
});

describe("an import's dry run", () => {
  it("counts what comes over and says why the rest does not", () => {
    const account: PdAccount = {
      organizations: [{ id: "7", name: "Kunde AS", address: null }],
      persons: [
        { id: "11", name: "Kari", email: "kari@kunde.no", phone: null, orgId: "7" },
        { id: "12", name: "Ola", email: null, phone: null, orgId: null },
      ],
      pipelines: [{ id: "1", name: "Sales", order: 1 }],
      stages: [
        { id: "3", pipelineId: "1", name: "Quote sent", order: 3, probability: 60 },
        { id: "9", pipelineId: "99", name: "Elsewhere", order: 1, probability: null },
      ],
      deals: [
        { id: "21", title: "Totes", status: "open", pipelineId: "1", stageId: "3", personId: "11", orgId: null, valueMinor: null, currency: null, expectedCloseOn: null, lostReason: null, closedAt: null, addedAt: null },
        { id: "22", title: "Aprons", status: "won", pipelineId: "1", stageId: "3", personId: "12", orgId: "7", valueMinor: 100, currency: "NOK", expectedCloseOn: null, lostReason: null, closedAt: null, addedAt: null },
        { id: "23", title: "Nobody", status: "lost", pipelineId: "1", stageId: "3", personId: "12", orgId: null, valueMinor: null, currency: null, expectedCloseOn: null, lostReason: null, closedAt: null, addedAt: null },
        { id: "24", title: "Lost stage", status: "open", pipelineId: "99", stageId: "9", personId: "11", orgId: null, valueMinor: null, currency: null, expectedCloseOn: null, lostReason: null, closedAt: null, addedAt: null },
      ],
      activities: [
        { id: "31", kind: "call", originalType: null, title: "Call", dueOn: "2026-11-09", dueTime: "", durationMinutes: null, done: false, doneAt: null, dealId: "21", personId: null, orgId: null, note: null },
        { id: "32", kind: "task", originalType: null, title: "No day", dueOn: null, dueTime: "", durationMinutes: null, done: false, doneAt: null, dealId: "21", personId: null, orgId: null, note: null },
        { id: "33", kind: "task", originalType: null, title: "Nobody", dueOn: "2026-11-09", dueTime: "", durationMinutes: null, done: false, doneAt: null, dealId: "23", personId: "12", orgId: null, note: null },
      ],
      notes: [
        { id: "41", text: "Met at the fair.", dealId: null, personId: null, orgId: "7", addedAt: null },
        { id: "42", text: "About Ola.", dealId: null, personId: "12", orgId: null, addedAt: null },
      ],
    };
    expect(planImport(account)).toEqual({
      companies: 1,
      customers: 1,
      pipelines: 1,
      stages: 1,
      deals: { open: 1, won: 1, lost: 0 },
      activities: 1,
      notes: 1,
      skipped: { person_no_email: 1, deal_no_one: 1, deal_no_stage: 1, activity_no_day: 1, activity_no_one: 1, note_no_one: 1 },
    });
  });
});
