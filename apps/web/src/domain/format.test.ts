import {
  formatCalendarDate,
  formatPublication,
  formatRetrievedAt,
  readPublicationInstant,
} from "./format";

describe("formatPublication", () => {
  it("shows a known-zone timestamp with the original offset and a separate local display", () => {
    const display = formatPublication({
      timestamp: "2026-03-03T14:30:00-05:00",
      date: null,
      raw: "3 Mar 2026, 2:30 PM ET",
      precision: "timestamp",
      timezone_status: "known",
      evidence_id: null,
    });

    expect(display.kind).toBe("timestamp");
    expect(display.hasKnownInstant).toBe(true);
    expect(display.isTimeUncertain).toBe(false);
    expect(display.offsetLabel).toBe("UTC-05:00");
    expect(display.compactText).toContain("UTC-05:00");
    expect(display.zoneNote).toContain("UTC-05:00");
    expect(display.localNote).not.toBeNull();
    expect(display.rawText).toBe("3 Mar 2026, 2:30 PM ET");
    expect(display.timeNote).toBeNull();
  });

  it("keeps a date-only value honest instead of inventing midnight", () => {
    const display = formatPublication({
      timestamp: null,
      date: "2026-03-03",
      raw: "Tuesday, March 3",
      precision: "date",
      timezone_status: "unknown",
      evidence_id: null,
    });

    expect(display.kind).toBe("date");
    expect(display.isTimeUncertain).toBe(true);
    expect(display.hasKnownInstant).toBe(false);
    expect(display.headline).toBe(formatCalendarDate("2026-03-03"));
    expect(display.timeNote).toBe("Time unavailable");
    expect(display.zoneNote).toBe("Time zone not reported");
    expect(display.compactText).toContain("Time unavailable");
    expect(display.compactText).not.toMatch(/\b12:00\b/);
    expect(readPublicationInstant({
      timestamp: null,
      date: "2026-03-03",
      raw: null,
      precision: "date",
      timezone_status: "unknown",
      evidence_id: null,
    })).toBeNull();
  });

  it("labels an unknown time zone without applying the browser time zone", () => {
    const display = formatPublication({
      timestamp: "2026-03-03T23:15:00",
      date: null,
      raw: "3 March 2026, 11:15 PM",
      precision: "timestamp",
      timezone_status: "unknown",
      evidence_id: null,
    });

    expect(display.kind).toBe("unknown_timezone");
    expect(display.isTimeUncertain).toBe(true);
    expect(display.timeNote).toBe("Time zone not reported");
    expect(display.zoneNote).toContain("no browser time-zone conversion");
    expect(display.localNote).toBeNull();
    expect(display.offsetLabel).toBeNull();
    expect(display.compactText).toContain("Time zone not reported");
    expect(display.compactText).not.toContain("UTC+");
    expect(display.compactText).not.toContain("UTC-");
  });

  it("states that publication time is unavailable and preserves raw source text", () => {
    const display = formatPublication({
      timestamp: null,
      date: null,
      raw: "last Tuesday evening, according to the clipping",
      precision: "unknown",
      timezone_status: "unknown",
      evidence_id: null,
    });

    expect(display.kind).toBe("unknown");
    expect(display.isTimeUncertain).toBe(true);
    expect(display.headline).toBe("Publication time unavailable");
    expect(display.rawText).toBe(
      "last Tuesday evening, according to the clipping",
    );
    expect(display.compactText).toContain("Publication time unavailable");
  });

  it("formats retrieval time separately and does not call it publication time", () => {
    const retrieved = formatRetrievedAt("2026-11-14T12:00:00+00:00");
    expect(retrieved).not.toBe("Retrieval time unavailable");
    expect(retrieved).not.toMatch(/publication/i);
    expect(retrieved).toMatch(/2026/);
  });

  it("rejects malformed calendar dates rather than normalizing them", () => {
    expect(formatCalendarDate("2026-02-30")).toBe("2026-02-30");
  });
});
