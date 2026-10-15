/**
 * Display formatting for the Vietnamese UI: currency, timestamps and the conversions needed to
 * bind a timestamp to <input type="datetime-local">.
 */

/** Every user-facing timestamp is rendered in Vietnam time regardless of the viewer's clock. */
export const APP_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Integer VND with "." thousands separators, e.g. 120000 → "120.000đ". */
export function formatVnd(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped}đ`;
}

interface ZonedParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function zoneFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hourCycle: "h23",
    ...options,
  });
}

function partsOf(date: Date, options: Intl.DateTimeFormatOptions): ZonedParts {
  const parts = zoneFormatter(options).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * An ISO timestamp as `dd/MM/yyyy HH:mm` in Vietnam time.
 * Unparseable input is returned unchanged rather than rendering a misleading date.
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const { day, month, year, hour, minute } = partsOf(date, DATE_TIME_OPTIONS);
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

/** An ISO timestamp as a `datetime-local` value (`YYYY-MM-DDTHH:mm`) in Vietnam time. */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const { year, month, day, hour, minute } = partsOf(date, DATE_TIME_OPTIONS);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/** Milliseconds to add to a UTC instant to get the local wall clock at that instant. */
function zoneOffsetMs(date: Date): number {
  const { year, month, day, hour, minute, second } = partsOf(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const asIfUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  return asIfUtc - date.getTime();
}

/**
 * A `datetime-local` value (`YYYY-MM-DDTHH:mm`, Vietnam wall clock) as an ISO 8601 UTC instant.
 * Returns "" when the value cannot be parsed.
 */
export function localInputToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!match) {
    return "";
  }

  const [, year, month, day, hour, minute, second] = match;
  const wallClockAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? "0"),
  );

  // Interpret the wall clock in APP_TIME_ZONE: the instant is the wall clock minus the zone's
  // offset at that instant. Re-checked once in case the first guess landed on the other side of
  // a daylight-saving transition.
  const offset = zoneOffsetMs(new Date(wallClockAsUtc));
  let timestamp = wallClockAsUtc - offset;
  const refinedOffset = zoneOffsetMs(new Date(timestamp));
  if (refinedOffset !== offset) {
    timestamp = wallClockAsUtc - refinedOffset;
  }

  return new Date(timestamp).toISOString();
}
