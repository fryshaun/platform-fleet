import { describe, expect, it } from "vitest";

import {
  formatServicedOn,
  parseServiceEventDraft,
  serviceEventsForComponent,
  serviceIntervalLabel,
  serviceProgressLabel,
  serviceStatusLabel,
  serviceStatusRank,
  serviceSummary,
  statusForComponent,
} from "@/lib/servicing";

import {
  COMPONENT_ID,
  formDataOf,
  serviceEventRow,
  serviceStatusRow,
} from "../helpers/fixtures";

describe("the service form", () => {
  it("reads a service off the form", () => {
    expect(
      parseServiceEventDraft(
        formDataOf({
          component_id: COMPONENT_ID,
          serviced_on: "2026-03-04",
          notes: "Seals replaced",
        }),
      ),
    ).toEqual({
      draft: {
        component_id: COMPONENT_ID,
        serviced_on: "2026-03-04",
        notes: "Seals replaced",
      },
    });
  });

  it("asks for the part and the day", () => {
    expect(parseServiceEventDraft(formDataOf({ serviced_on: "2026-03-04" }))).toEqual(
      { error: "Choose the part that was serviced." },
    );
    expect(
      parseServiceEventDraft(formDataOf({ component_id: COMPONENT_ID })),
    ).toEqual({ error: "Choose the day the service happened." });
  });
});

describe("how a status reads", () => {
  it("says it in words", () => {
    expect(serviceStatusLabel("ok")).toBe("OK");
    expect(serviceStatusLabel("due_soon")).toBe("Due soon");
    expect(serviceStatusLabel("overdue")).toBe("Overdue");
  });

  it("puts the urgent ones first", () => {
    expect(serviceStatusRank("overdue")).toBeLessThan(
      serviceStatusRank("due_soon"),
    );
    expect(serviceStatusRank("due_soon")).toBeLessThan(serviceStatusRank("ok"));
  });
});

describe("the interval a part is counted against", () => {
  it("reads the coalesced zeros as not measured", () => {
    // The view coalesces every interval to 0, so 0 must never read "every 0 km".
    expect(
      serviceIntervalLabel(
        serviceStatusRow({ interval_days: 0, interval_km: 0, interval_hours: 0 }),
      ),
    ).toBe("No interval set");
    expect(
      serviceIntervalLabel(
        serviceStatusRow({ interval_days: 90, interval_km: 0, interval_hours: 0 }),
      ),
    ).toBe("every 90 days");
  });

  it("shows only the measures that count", () => {
    const hoursOnly = serviceStatusRow({
      interval_days: 0,
      interval_km: 0,
      interval_hours: 50,
      hours_since: 42,
      days_since: 30,
      km_since: 0,
    });

    expect(serviceProgressLabel(hoursOnly)).toBe("42 / 50 hours");

    expect(
      serviceProgressLabel(
        serviceStatusRow({
          interval_days: 90,
          interval_km: 200,
          interval_hours: 0,
          days_since: 88,
          km_since: 180.5,
          hours_since: 0,
        }),
      ),
    ).toBe("88 / 90 days · 180.5 / 200 km");

    expect(
      serviceProgressLabel(
        serviceStatusRow({ interval_days: 0, interval_km: 0, interval_hours: 0 }),
      ),
    ).toBe("No interval set");
  });
});

describe("a unit's service list", () => {
  it("finds the row for one part", () => {
    const rows = [
      serviceStatusRow(),
      serviceStatusRow({
        component_id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
      }),
    ];

    expect(statusForComponent(rows, COMPONENT_ID)?.component_id).toBe(
      COMPONENT_ID,
    );
    // A part without a kind has no row at all, which is why the tab shows
    // "No interval set" rather than inventing one.
    expect(statusForComponent(rows, "nope")).toBeNull();
  });

  it("lists a part's services, newest first", () => {
    const older = serviceEventRow({ id: "s1", serviced_on: "2025-12-01" });
    const newer = serviceEventRow({ id: "s2", serviced_on: "2026-02-01" });
    const elsewhere = serviceEventRow({
      id: "s3",
      component_id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
    });

    expect(
      serviceEventsForComponent(
        [older, elsewhere, newer],
        COMPONENT_ID,
      ).map((event) => event.id),
    ).toEqual(["s2", "s1"]);
  });

  it("summarises only what needs a decision", () => {
    expect(serviceSummary([])).toBe("No part has a service interval yet.");
    expect(
      serviceSummary([
        serviceStatusRow({ status: "ok" }),
        serviceStatusRow({
          component_id: "b1",
          status: "ok",
        }),
      ]),
    ).toBe("Nothing due · 2 parts counting");
    expect(
      serviceSummary([
        serviceStatusRow({ status: "overdue" }),
        serviceStatusRow({ component_id: "b1", status: "due_soon" }),
        serviceStatusRow({ component_id: "b2", status: "ok" }),
      ]),
    ).toBe("1 overdue · 1 due soon · 1 OK");
  });

  it("formats a service date in UTC", () => {
    expect(formatServicedOn("2026-03-04")).toBe("Mar 4, 2026");
  });
});
