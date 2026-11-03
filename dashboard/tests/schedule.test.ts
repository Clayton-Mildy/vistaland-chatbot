import { it, expect } from "vitest";
import { groupVisits, shiftDate, STATUS_STYLE, weekDates, wibClock, wibDay } from "@/lib/schedule";
import type { VisitRow } from "@/lib/api/visits";

const row = (id: string, salesAgentId: string, startsAt: string): VisitRow => ({
  id,
  leadId: "lead",
  salesAgentId,
  salesName: salesAgentId,
  projectId: 1,
  projectName: "Zetira",
  customerName: "Sari",
  startsAt,
  status: "scheduled",
});

it("weekDates gives the Monday to Sunday of the WIB week", () => {
  const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
  expect(weekDates("2026-11-05")).toEqual(week);
  expect(weekDates("2026-11-02")).toEqual(week);
  expect(weekDates("2026-11-08")).toEqual(week);
  expect(weekDates("2026-12-31")[0]).toBe("2026-12-28");
});

it("shiftDate moves a date by days across months", () => {
  expect(shiftDate("2026-11-30", 1)).toBe("2026-12-01");
  expect(shiftDate("2026-11-02", -7)).toBe("2026-10-26");
});

it("reads the WIB day and time of an instant", () => {
  // 17.30 UTC is already the next day, 00.30, in WIB.
  expect(wibDay("2026-11-06T17:30:00Z")).toBe("2026-11-07");
  expect(wibClock("2026-11-06T17:30:00Z")).toBe("00.30");
});

it("groupVisits sorts by time within a day and groups by agent then date", () => {
  const late = row("late", "a1", "2026-11-07T07:00:00Z");
  const early = row("early", "a1", "2026-11-07T02:00:00Z");
  const other = row("other", "a2", "2026-11-03T03:00:00Z");
  const stray = row("stray", "gone", "2026-11-03T03:00:00Z");
  const g = groupVisits([late, other, early, stray], ["a1", "a2"], ["2026-11-03", "2026-11-07"]);
  expect(g.get("a1")!.get("2026-11-07")!.map((v) => v.id)).toEqual(["early", "late"]);
  expect(g.get("a2")!.get("2026-11-03")!.map((v) => v.id)).toEqual(["other"]);
  expect(g.get("a1")!.get("2026-11-03")).toEqual([]);
  expect(g.has("gone")).toBe(false);
});

it("styles every visit status, striking out the ones that no longer stand", () => {
  expect(Object.keys(STATUS_STYLE).sort()).toEqual(["awaiting_confirmation", "cancelled", "confirmed", "no_show", "rescheduled", "scheduled", "visited"]);
  expect(STATUS_STYLE.cancelled).toContain("line-through");
  expect(STATUS_STYLE.rescheduled).toContain("line-through");
  expect(STATUS_STYLE.scheduled).toContain("blue");
  expect(STATUS_STYLE.no_show).toContain("red");
});
