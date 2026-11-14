import type { Publication } from "../generated/newsTraceContracts";

const EXPLICIT_OFFSET_PATTERN = /(?:[Zz]|[+-]\d{2}:\d{2})$/;
const OFFSET_PATTERN = /([+-])(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_CLOCK_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2}))?/;

export type PublicationDisplayKind =
  | "timestamp"
  | "date"
  | "unknown_timezone"
  | "unknown";

export interface PublicationDisplay {
  kind: PublicationDisplayKind;
  isTimeUncertain: boolean;
  hasKnownInstant: boolean;
  headline: string;
  timeNote: string | null;
  zoneNote: string | null;
  localNote: string | null;
  rawText: string | null;
  offsetLabel: string | null;
  precisionLabel: string;
  compactText: string;
}

interface OffsetInfo {
  label: string;
  minutes: number;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parseDateParts(value: string): DateParts | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function utcDateFromParts({
  year,
  month,
  day,
}: DateParts): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function readOffsetInfo(timestamp: string): OffsetInfo | null {
  if (!EXPLICIT_OFFSET_PATTERN.test(timestamp)) {
    return null;
  }

  if (/[Zz]$/.test(timestamp)) {
    return { label: "UTC+00:00", minutes: 0 };
  }

  const match = OFFSET_PATTERN.exec(timestamp);
  if (!match) {
    return null;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  const totalMinutes = sign * (hours * 60 + minutes);
  const signLabel = totalMinutes < 0 ? "-" : "+";
  return {
    label: `UTC${signLabel}${match[2]}:${match[3]}`,
    minutes: totalMinutes,
  };
}

export function hasExplicitTimezone(timestamp: string): boolean {
  return readOffsetInfo(timestamp) !== null;
}

/**
 * A "known instant" requires both an RFC 3339 timestamp and a reported time
 * zone. Date-only and unknown-zone values remain uncertain and never get a
 * synthesized midnight or browser-zone conversion.
 */
export function readPublicationInstant(
  publication: Publication,
): number | null {
  if (
    publication.precision !== "timestamp" ||
    publication.timezone_status !== "known" ||
    typeof publication.timestamp !== "string" ||
    readOffsetInfo(publication.timestamp) === null
  ) {
    return null;
  }

  const instant = Date.parse(publication.timestamp);
  return Number.isFinite(instant) ? instant : null;
}

export function formatCalendarDate(value: string): string {
  const parts = parseDateParts(value);
  if (!parts) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(utcDateFromParts(parts));
}

function formatWallClockInOffset(
  timestamp: string,
  offsetMinutes: number,
): string | null {
  const instant = Date.parse(timestamp);
  if (!Number.isFinite(instant)) {
    return null;
  }

  // Shift the instant into the source's reported offset and format it as a
  // UTC wall clock. This keeps the reported calendar time without relying on
  // the browser's time zone.
  const shifted = new Date(instant + offsetMinutes * 60_000);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(shifted);
}

function formatLocalInstant(instant: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(instant));
}

function formatWallClockWithoutZone(timestamp: string): string | null {
  const match = WALL_CLOCK_PATTERN.exec(timestamp);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second),
  );
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function compact(parts: Array<string | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

export function formatPublication(
  publication: Publication,
): PublicationDisplay {
  const rawText =
    typeof publication.raw === "string" && publication.raw.trim().length > 0
      ? publication.raw.trim()
      : null;

  if (
    publication.precision === "timestamp" &&
    typeof publication.timestamp === "string"
  ) {
    const offset = readOffsetInfo(publication.timestamp);
    const instant = Date.parse(publication.timestamp);

    if (
      publication.timezone_status === "known" &&
      offset !== null &&
      Number.isFinite(instant)
    ) {
      const wallClock =
        formatWallClockInOffset(publication.timestamp, offset.minutes) ??
        publication.timestamp;
      const headline = `${wallClock} (${offset.label})`;

      return {
        kind: "timestamp",
        isTimeUncertain: false,
        hasKnownInstant: true,
        headline,
        timeNote: null,
        zoneNote: `Source offset ${offset.label}`,
        localNote: formatLocalInstant(instant),
        rawText,
        offsetLabel: offset.label,
        precisionLabel: "Timestamp",
        compactText: headline,
      };
    }

    if (publication.timezone_status === "unknown") {
      const wallClock =
        formatWallClockWithoutZone(publication.timestamp) ??
        publication.timestamp;
      return {
        kind: "unknown_timezone",
        isTimeUncertain: true,
        hasKnownInstant: false,
        headline: wallClock,
        timeNote: "Time zone not reported",
        zoneNote:
          "The source did not report a time zone, so no browser time-zone conversion has been applied.",
        localNote: null,
        rawText,
        offsetLabel: null,
        precisionLabel: "Timestamp",
        compactText: compact([wallClock, "Time zone not reported"]),
      };
    }
  }

  if (
    publication.precision === "date" &&
    typeof publication.date === "string" &&
    parseDateParts(publication.date)
  ) {
    const dateText = formatCalendarDate(publication.date);
    return {
      kind: "date",
      isTimeUncertain: true,
      hasKnownInstant: false,
      headline: dateText,
      timeNote: "Time unavailable",
      zoneNote: "Time zone not reported",
      localNote: null,
      rawText,
      offsetLabel: null,
      precisionLabel: "Date only",
      compactText: compact([dateText, "Time unavailable"]),
    };
  }

  if (
    publication.timezone_status === "unknown" &&
    typeof publication.timestamp === "string"
  ) {
    const wallClock =
      formatWallClockWithoutZone(publication.timestamp) ??
      publication.timestamp;
    if (wallClock !== publication.timestamp) {
      return {
        kind: "unknown_timezone",
        isTimeUncertain: true,
        hasKnownInstant: false,
        headline: wallClock,
        timeNote: "Time zone not reported",
        zoneNote:
          "The source did not report a time zone, so no browser time-zone conversion has been applied.",
        localNote: null,
        rawText,
        offsetLabel: null,
        precisionLabel: "Timestamp",
        compactText: compact([wallClock, "Time zone not reported"]),
      };
    }
  }

  return {
    kind: "unknown",
    isTimeUncertain: true,
    hasKnownInstant: false,
    headline: "Publication time unavailable",
    timeNote: null,
    zoneNote: null,
    localNote: null,
    rawText,
    offsetLabel: null,
    precisionLabel: "Unknown",
    compactText: "Publication time unavailable",
  };
}

export function formatRetrievedAt(value: string): string {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) {
    return "Retrieval time unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(instant));
}

export function publicationIsTimeUncertain(
  publication: Publication,
): boolean {
  return readPublicationInstant(publication) === null;
}
