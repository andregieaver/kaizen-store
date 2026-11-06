import { describe, expect, it } from "vitest";

import {
  checkPage,
  emptyPlan,
  emptySeen,
  newRun,
  noteHomes,
  ownersOf,
  planImport,
  planTotal,
  readActivity,
  readDeal,
  readNote,
  readOrganization,
  readPerson,
  readStage,
  readUser,
  runOf,
  toMinor,
  type PdAccount,
} from "./pipedrive";

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
        stage_change_time: "2026-10-15T09:00:00Z",
        owner_id: 4,
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
      stageEnteredAt: "2026-10-15T09:00:00.000Z",
      ownerId: "4",
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
        { id: "21", title: "Totes", status: "open", pipelineId: "1", stageId: "3", personId: "11", orgId: null, valueMinor: null, currency: null, expectedCloseOn: null, lostReason: null, closedAt: null, addedAt: null, stageEnteredAt: null, ownerId: null },
        { id: "22", title: "Aprons", status: "won", pipelineId: "1", stageId: "3", personId: "12", orgId: "7", valueMinor: 100, currency: "NOK", expectedCloseOn: null, lostReason: null, closedAt: null, addedAt: null, stageEnteredAt: null, ownerId: null },
        { id: "23", title: "Nobody", status: "lost", pipelineId: "1", stageId: "3", personId: "12", orgId: null, valueMinor: null, currency: null, expectedCloseOn: null, lostReason: null, closedAt: null, addedAt: null, stageEnteredAt: null, ownerId: null },
        { id: "24", title: "Lost stage", status: "open", pipelineId: "99", stageId: "9", personId: "11", orgId: null, valueMinor: null, currency: null, expectedCloseOn: null, lostReason: null, closedAt: null, addedAt: null, stageEnteredAt: null, ownerId: null },
      ],
      activities: [
        { id: "31", kind: "call", originalType: null, title: "Call", dueOn: "2026-11-09", dueTime: "", durationMinutes: null, done: false, doneAt: null, dealId: "21", personId: null, orgId: null, note: null, ownerId: null },
        { id: "32", kind: "task", originalType: null, title: "No day", dueOn: null, dueTime: "", durationMinutes: null, done: false, doneAt: null, dealId: "21", personId: null, orgId: null, note: null, ownerId: null },
        { id: "33", kind: "task", originalType: null, title: "Nobody", dueOn: "2026-11-09", dueTime: "", durationMinutes: null, done: false, doneAt: null, dealId: "23", personId: "12", orgId: null, note: null, ownerId: null },
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

describe("a run, page by page", () => {
  it("counts what came over before as already here, and lets what is here carry the rest", () => {
    const seen = emptySeen();
    const plan = emptyPlan();
    // Kunde AS came over in an earlier run; Nye AS comes now.
    expect(checkPage("organizations", [{ id: "7", name: "Kunde AS", address: null }, { id: "8", name: "Nye AS", address: null }], seen, plan, new Set(["7"]))).toBe(1);
    expect(plan.companies).toBe(1);
    expect(checkPage("persons", [{ id: "11", name: "Kari", email: "kari@kunde.no", phone: null, orgId: "7" }], seen, plan)).toBe(0);
    expect(checkPage("pipelines", [{ id: "1", name: "Sales", order: 1 }], seen, plan)).toBe(0);
    expect(checkPage("stages", [{ id: "3", pipelineId: "1", name: "New", order: 1, probability: null }, { id: "4", pipelineId: "2", name: "Other", order: 1, probability: null }], seen, plan)).toBe(0);
    const deal = { title: "x", status: "open" as const, pipelineId: "1", valueMinor: null, currency: null, expectedCloseOn: null, lostReason: null, closedAt: null, addedAt: null, stageEnteredAt: null, ownerId: null };
    checkPage("deals", [{ ...deal, id: "21", stageId: "3", personId: null, orgId: "8" }, { ...deal, id: "22", stageId: "4", personId: "11", orgId: null }], seen, plan);
    // A note on a deal about Nye AS, which has nobody here: no one to keep it on. One on Kunde AS goes on Kari.
    const note = { text: "x", personId: null, addedAt: null };
    checkPage("notes", [{ ...note, id: "41", dealId: "21", orgId: null }, { ...note, id: "42", dealId: null, orgId: "7" }], seen, plan);
    expect(plan).toMatchObject({ companies: 1, customers: 1, pipelines: 1, stages: 1, deals: { open: 1 }, notes: 1, skipped: { deal_no_stage: 1, note_no_one: 1 } });
    expect(planTotal(plan)).toBe(6);
    expect(Object.keys(seen.deal)).toEqual(["21"]);
  });

  it("keeps a note on its person, else its deal's, else someone of its organisation", () => {
    const here = { deal: new Map([["21", { personId: "12", orgId: "8" }]]) };
    expect(noteHomes({ id: "1", text: "x", dealId: "21", personId: "11", orgId: "7", addedAt: null }, here)).toEqual({ persons: ["11", "12"], orgs: ["8", "7"] });
    expect(noteHomes({ id: "2", text: "x", dealId: "99", personId: null, orgId: null, addedAt: null }, here)).toEqual({ persons: [], orgs: [] });
  });

  it("matches Pipedrive's users to the team by email, and reads a kept run leniently", () => {
    expect(readUser({ id: 4, name: "Lisa", email: "Lisa@HumanWeb.no", active_flag: true })).toEqual({ id: "4", email: "lisa@humanweb.no" });
    expect(readUser({ id: 5, email: "gone@humanweb.no", active_flag: false })).toBeNull();
    expect(ownersOf([{ id: "4", email: "lisa@humanweb.no" }, { id: "6", email: "else@x.no" }], [{ accountId: "a-1", email: "LISA@humanweb.no" }])).toEqual({ "4": "a-1" });
    const run = newRun("check", "a-1", new Date("2026-11-06T12:00:00Z"));
    expect(runOf(JSON.parse(JSON.stringify(run)))).toMatchObject({ mode: "check", status: "running", feed: "users", seen: emptySeen() });
    expect(runOf({})).toBeNull();
    expect(runOf({ ...run, feed: "invoices" })).toBeNull();
  });
});
