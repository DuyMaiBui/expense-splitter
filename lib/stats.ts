import { badRequest } from "./errors";
import type { StatsBucket, StatsPeriod } from "./types";

/**
 * Spending-chart helpers: the query a client sends, the UTC window a period covers, and the
 * buckets a chart is drawn from.
 *
 * Everything here is pure and import-safe on the server and in a client component: the route
 * handler uses these to build its SQL bounds and to fill in zero buckets, and a chart component
 * may import the same labels. The SQL never returns raw rows (docs/CONTRACT.md § STATS), so the
 * bucket key a row falls in has to be reproducible in JS — that is `localBucketKey`.
 */

/**
 * Vietnam is a fixed UTC+7 with no daylight saving, so a row's local instant is its UTC instant
 * shifted by exactly this many hours. No zone database, no DST edge cases.
 */
export const VN_OFFSET_HOURS = 7;

const HOUR_MS = 3_600_000;
const VN_OFFSET_MS = VN_OFFSET_HOURS * HOUR_MS;

/** The validated query of a stats request; `year`/`month` are null exactly when unused. */
export interface StatsQuery {
  period: StatsPeriod;
  /** null when `period` is "all". */
  year: number | null;
  /** 1..12, only when `period` is "month". */
  month: number | null;
}

/** A half-open UTC window `[startIso, endIso)` equivalent to a local calendar range. */
export interface StatsRange {
  startIso: string;
  endIso: string;
}

/** The local (Asia/Ho_Chi_Minh) calendar date of a UTC instant. */
function localDateOf(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** `number` → "01", "12"; every bucket key is fixed-width so text ordering is date ordering. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

/**
 * Reads `period`, `year` and `month` off a query string.
 *
 * Absent `period` means "all". For "year" and "month" the year defaults to the current year and
 * the month to the current month, both in Vietnam time, which is why `now` is injectable. A
 * `year`/`month` pair sent alongside period=all is validated but not used (the contract's
 * response carries nulls for "all"). Every failure is a 400 VALIDATION naming the parameter.
 */
export function parseStatsQuery(params: URLSearchParams, now: Date = new Date()): StatsQuery {
  const period = parsePeriod(params.get("period"));

  // Always validate a present pair, even when the period makes it irrelevant: a malformed
  // parameter is a client bug and silently ignoring it hides the bug.
  const current = localDateOf(now);
  const year = parseYear(params.get("year")) ?? current.year;
  const month = parseMonth(params.get("month")) ?? current.month;

  if (period === "all") {
    return { period, year: null, month: null };
  }
  if (period === "year") {
    return { period, year, month: null };
  }
  return { period, year, month };
}

function parsePeriod(raw: string | null): StatsPeriod {
  if (raw === null) {
    return "all";
  }
  if (raw === "all" || raw === "year" || raw === "month") {
    return raw;
  }
  throw badRequest('Tham số "period" chỉ được là "all", "year" hoặc "month".');
}

/** A year is written in full (`2026`); a shorter number is a typo, not year 26. */
function parseYear(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  if (!/^\d{4}$/.test(raw)) {
    throw badRequest('Tham số "year" phải là số nguyên có 4 chữ số.');
  }
  const year = Number(raw);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw badRequest(`Tham số "year" phải nằm trong khoảng ${MIN_YEAR} đến ${MAX_YEAR}.`);
  }
  return year;
}

function parseMonth(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  if (!/^\d{1,2}$/.test(raw)) {
    throw badRequest('Tham số "month" phải là số nguyên.');
  }
  const month = Number(raw);
  if (month < 1 || month > 12) {
    throw badRequest('Tham số "month" phải nằm trong khoảng 1 đến 12.');
  }
  return month;
}

/** The local window of a period, as UTC ISO bounds the route binds against `spent_at`. */
function localWindow(year: number, month: number | null): StatsRange {
  // Local wall clock → UTC instant is a subtraction of the fixed offset, so Date.UTC (which
  // accepts an out-of-range month and rolls it into the next year) is enough.
  const startMs = Date.UTC(year, month === null ? 0 : month - 1, 1) - VN_OFFSET_MS;
  const endMs = Date.UTC(year, month === null ? 12 : month, 1) - VN_OFFSET_MS;
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

/**
 * The UTC bounds `[startIso, endIso)` of a period's local calendar range, or null for "all".
 *
 * `spent_at` is stored as canonical ISO 8601 UTC with ms (`lib/validate.ts#isoDate`), so the SQL
 * compares it as text: `spent_at >= ? AND spent_at < ?`. Text order equals chronological order
 * because the format is fixed-width.
 */
export function statsRangeUtc(
  period: StatsPeriod,
  year: number | null,
  month: number | null,
): StatsRange | null {
  if (period === "all") {
    return null;
  }
  if (year === null) {
    throw new Error(`statsRangeUtc: period "${period}" requires a year`);
  }
  if (period === "month" && month === null) {
    throw new Error('statsRangeUtc: period "month" requires a month');
  }
  return localWindow(year, period === "month" ? month : null);
}

/** Days in a local calendar month, leap years included (arithmetic only: no time zone here). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function zeroBucket(key: string, label: string): StatsBucket {
  return { key, label, amount: 0, count: 0 };
}

/**
 * The bucket set a chart draws before any row is known.
 *
 * "all" has no fixed axis — its years come from the data — so it starts empty. "year" is exactly
 * 12 zero buckets keyed "01".."12" labelled "T1".."T12". "month" is one zero bucket per day of
 * that local month (28..31), keyed "01".."31" and labelled without the leading zero ("1".."31").
 */
export function emptyBuckets(
  period: StatsPeriod,
  year: number | null,
  month: number | null,
): StatsBucket[] {
  if (period === "all") {
    return [];
  }
  if (period === "year") {
    return Array.from({ length: 12 }, (_, index) => {
      const monthNumber = index + 1;
      return zeroBucket(pad2(monthNumber), `T${monthNumber}`);
    });
  }
  if (year === null || month === null) {
    throw new Error('emptyBuckets: period "month" requires a year and a month');
  }
  return Array.from({ length: daysInMonth(year, month) }, (_, index) =>
    zeroBucket(pad2(index + 1), String(index + 1)),
  );
}

/** One grouped row as the SQL returns it: a bucket key plus that bucket's totals. */
export interface BucketRow {
  key: string;
  amount: number;
  count: number;
}

/**
 * Merges the SQL's grouped rows into a period's bucket set.
 *
 * "all" is built from the rows themselves, ascending by key, with no zero fill (a year with no
 * spending has no column). "year" and "month" merge into the zero-filled set and DROP any key
 * outside it: an out-of-range key means the SQL and `localBucketKey` disagree, and inventing a
 * column for it would draw a wrong chart.
 */
export function fillBuckets(
  period: StatsPeriod,
  year: number | null,
  month: number | null,
  rows: readonly BucketRow[],
): StatsBucket[] {
  if (period === "all") {
    return [...rows]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((row) => ({ key: row.key, label: row.key, amount: row.amount, count: row.count }));
  }

  const buckets = emptyBuckets(period, year, month);
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const row of rows) {
    const bucket = byKey.get(row.key);
    if (!bucket) {
      continue;
    }
    bucket.amount += row.amount;
    bucket.count += row.count;
  }
  return buckets;
}

/**
 * The bucket key a stored `spent_at` falls in — the JS oracle for the SQL's GROUP BY. The SQL
 * equivalent, per period, is (fmt → example key):
 *
 *   all    strftime('%Y', datetime(spent_at, '+7 hours'))  → "2026"
 *   year   strftime('%m', datetime(spent_at, '+7 hours'))  → "03"
 *   month  strftime('%d', datetime(spent_at, '+7 hours'))  → "31"
 *
 * Throws on an unparseable timestamp: stored rows are written through `isoDate`, so anything
 * else is a corrupt row and must not silently land in a made-up bucket.
 */
export function localBucketKey(spentAtIso: string, period: StatsPeriod): string {
  const parsed = new Date(spentAtIso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`localBucketKey: invalid spent_at "${spentAtIso}"`);
  }
  const { year, month, day } = localDateOf(parsed);

  if (period === "all") {
    return String(year);
  }
  if (period === "year") {
    return pad2(month);
  }
  return pad2(day);
}

/** Biggest unit first: the loop below picks the largest one that fits, then may promote. */
const COMPACT_UNITS = [
  { value: 1_000_000_000, suffix: "tỷ" },
  { value: 1_000_000, suffix: "tr" },
  { value: 1_000, suffix: "k" },
] as const;

/**
 * A compact VND figure for a chart axis: "350k", "1,2tr", "1tỷ" (Vietnamese decimal comma, one
 * decimal at most, trailing ",0" dropped). Amounts under 1.000đ stay exact. Rounding that would
 * reach 1000 of a unit promotes to the next one ("999.999đ" → "1tr", never "1000k").
 */
export function formatCompactVnd(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  if (absolute < 1_000) {
    return `${sign}${absolute}`;
  }

  let unitIndex = COMPACT_UNITS.findIndex((unit) => absolute >= unit.value);
  let scaled = Math.round((absolute / COMPACT_UNITS[unitIndex]!.value) * 10) / 10;
  if (scaled >= 1_000 && unitIndex > 0) {
    unitIndex -= 1;
    scaled = Math.round((absolute / COMPACT_UNITS[unitIndex]!.value) * 10) / 10;
  }

  const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1).replace(".", ",");
  return `${sign}${text}${COMPACT_UNITS[unitIndex]!.suffix}`;
}
