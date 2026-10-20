import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import {
  emptyBuckets,
  fillBuckets,
  formatCompactVnd,
  localBucketKey,
  parseStatsQuery,
  statsRangeUtc,
  VN_OFFSET_HOURS,
} from "./stats";

/** Query-string helper: every value is stringified; undefined omits the parameter. */
function query(values: Record<string, string | number | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params;
}

/** A request made at 2026-10-20T03:00:00.000Z, i.e. 10:00 on 2026-10-20 in Vietnam. */
const NOW = new Date("2026-10-20T03:00:00.000Z");

/** Asserts the call throws a 400 VALIDATION with a Vietnamese message naming the parameter. */
function expectValidation(run: () => unknown, parameter: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "VALIDATION", status: 400 });
    expect((error as ApiError).message).toContain(parameter);
    // The message is Vietnamese, not an English placeholder.
    expect((error as ApiError).message).toMatch(/[àáảãạăâđêôơư]/i);
    return;
  }
  throw new Error(`expected a validation error for "${parameter}"`);
}

describe("VN_OFFSET_HOURS", () => {
  it("is a fixed UTC+7", () => {
    expect(VN_OFFSET_HOURS).toBe(7);
  });
});

describe("parseStatsQuery", () => {
  it("defaults to all, with no year or month", () => {
    expect(parseStatsQuery(query({}), NOW)).toEqual({ period: "all", year: null, month: null });
  });

  it("takes an explicit period", () => {
    expect(parseStatsQuery(query({ period: "all" }), NOW)).toEqual({
      period: "all",
      year: null,
      month: null,
    });
    expect(parseStatsQuery(query({ period: "year", year: 2025 }), NOW)).toEqual({
      period: "year",
      year: 2025,
      month: null,
    });
    expect(parseStatsQuery(query({ period: "month", year: 2025, month: 2 }), NOW)).toEqual({
      period: "month",
      year: 2025,
      month: 2,
    });
  });

  it("defaults year and month to the current Vietnam year and month", () => {
    expect(parseStatsQuery(query({ period: "year" }), NOW)).toEqual({
      period: "year",
      year: 2026,
      month: null,
    });
    expect(parseStatsQuery(query({ period: "month" }), NOW)).toEqual({
      period: "month",
      year: 2026,
      month: 10,
    });
  });

  it("reads the default month in Vietnam time, not UTC", () => {
    // 2026-10-31T17:30Z is already 2026-11-01 00:30 in Vietnam: the month rolls over.
    const lateUtc = new Date("2026-10-31T17:30:00.000Z");
    expect(parseStatsQuery(query({ period: "month" }), lateUtc)).toEqual({
      period: "month",
      year: 2026,
      month: 11,
    });

    // Same for the year: 2026-12-31T17:00Z is 2027-01-01 local.
    const newYear = new Date("2026-12-31T17:00:00.000Z");
    expect(parseStatsQuery(query({ period: "year" }), newYear)).toEqual({
      period: "year",
      year: 2027,
      month: null,
    });
  });

  it("keeps the default month for period=month when only the year is given", () => {
    expect(parseStatsQuery(query({ period: "month", year: 2024 }), NOW)).toEqual({
      period: "month",
      year: 2024,
      month: 10,
    });
  });

  it("accepts the documented boundaries", () => {
    expect(parseStatsQuery(query({ period: "year", year: 1970 }), NOW).year).toBe(1970);
    expect(parseStatsQuery(query({ period: "year", year: 2100 }), NOW).year).toBe(2100);
    expect(parseStatsQuery(query({ period: "month", month: 1 }), NOW).month).toBe(1);
    expect(parseStatsQuery(query({ period: "month", month: 12 }), NOW).month).toBe(12);
  });

  it("rejects an unknown period", () => {
    expectValidation(() => parseStatsQuery(query({ period: "week" }), NOW), "period");
    expectValidation(() => parseStatsQuery(query({ period: "" }), NOW), "period");
  });

  it("rejects a year outside 1970..2100 or not a 4-digit number", () => {
    expectValidation(() => parseStatsQuery(query({ period: "year", year: 1969 }), NOW), "year");
    expectValidation(() => parseStatsQuery(query({ period: "year", year: 2101 }), NOW), "year");
    expectValidation(() => parseStatsQuery(query({ period: "year", year: 26 }), NOW), "year");
    expectValidation(() => parseStatsQuery(query({ period: "year", year: "abc" }), NOW), "year");
    expectValidation(() => parseStatsQuery(query({ period: "year", year: 2026.5 }), NOW), "year");
  });

  it("rejects a month outside 1..12 or not an integer", () => {
    expectValidation(() => parseStatsQuery(query({ period: "month", month: 0 }), NOW), "month");
    expectValidation(() => parseStatsQuery(query({ period: "month", month: 13 }), NOW), "month");
    expectValidation(() => parseStatsQuery(query({ period: "month", month: "02x" }), NOW), "month");
    expectValidation(() => parseStatsQuery(query({ period: "month", month: 2.5 }), NOW), "month");
  });

  it("validates a period=all request that carries bad year/month", () => {
    // The values are unused for "all", but a malformed one is still a client bug.
    expectValidation(() => parseStatsQuery(query({ year: 1900 }), NOW), "year");
    expectValidation(() => parseStatsQuery(query({ month: 13 }), NOW), "month");
  });
});

describe("statsRangeUtc", () => {
  it("is null for the all-time period", () => {
    expect(statsRangeUtc("all", null, null)).toBeNull();
  });

  it("covers a local calendar year: [Jan 1 00:00, next Jan 1 00:00) Vietnam time", () => {
    expect(statsRangeUtc("year", 2026, null)).toEqual({
      startIso: "2025-12-31T17:00:00.000Z",
      endIso: "2026-12-31T17:00:00.000Z",
    });
  });

  it("covers a local calendar month, ending at the next month's local midnight", () => {
    expect(statsRangeUtc("month", 2026, 1)).toEqual({
      startIso: "2025-12-31T17:00:00.000Z",
      endIso: "2026-01-31T17:00:00.000Z",
    });
    // 30-day month, and the December → January rollover.
    expect(statsRangeUtc("month", 2026, 4)).toEqual({
      startIso: "2026-03-31T17:00:00.000Z",
      endIso: "2026-04-30T17:00:00.000Z",
    });
    expect(statsRangeUtc("month", 2026, 12)).toEqual({
      startIso: "2026-11-30T17:00:00.000Z",
      endIso: "2026-12-31T17:00:00.000Z",
    });
  });

  it("handles a leap February and a common one", () => {
    expect(statsRangeUtc("month", 2028, 2)).toEqual({
      startIso: "2028-01-31T17:00:00.000Z",
      endIso: "2028-02-29T17:00:00.000Z",
    });
    expect(statsRangeUtc("month", 2026, 2)).toEqual({
      startIso: "2026-01-31T17:00:00.000Z",
      endIso: "2026-02-28T17:00:00.000Z",
    });
  });

  it("refuses a range it cannot express instead of guessing", () => {
    expect(() => statsRangeUtc("year", null, null)).toThrow();
    expect(() => statsRangeUtc("month", 2026, null)).toThrow();
  });
});

describe("emptyBuckets", () => {
  it("is empty for all: years come from the data", () => {
    expect(emptyBuckets("all", null, null)).toEqual([]);
  });

  it("is exactly 12 zero months for year", () => {
    const buckets = emptyBuckets("year", 2026, null);
    expect(buckets).toHaveLength(12);
    expect(buckets.map((b) => b.key)).toEqual([
      "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12",
    ]);
    expect(buckets.map((b) => b.label)).toEqual([
      "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12",
    ]);
    expect(buckets.every((b) => b.amount === 0 && b.count === 0)).toBe(true);
  });

  it("is one zero bucket per local day for month", () => {
    const feb2026 = emptyBuckets("month", 2026, 2);
    expect(feb2026).toHaveLength(28);
    expect(feb2026[0]).toEqual({ key: "01", label: "1", amount: 0, count: 0 });
    expect(feb2026[27]).toEqual({ key: "28", label: "28", amount: 0, count: 0 });

    expect(emptyBuckets("month", 2028, 2)).toHaveLength(29); // leap
    expect(emptyBuckets("month", 2026, 4)).toHaveLength(30);
    expect(emptyBuckets("month", 2026, 1)).toHaveLength(31);
    expect(emptyBuckets("month", 2026, 12)).toHaveLength(31);
  });

  it("labels days without a leading zero but keeps keys fixed-width", () => {
    const january = emptyBuckets("month", 2026, 1);
    expect(january[0]?.key).toBe("01");
    expect(january[0]?.label).toBe("1");
    expect(january[30]?.key).toBe("31");
    expect(january[30]?.label).toBe("31");
  });

  it("refuses month without a year and month", () => {
    expect(() => emptyBuckets("month", null, 3)).toThrow();
    expect(() => emptyBuckets("month", 2026, null)).toThrow();
  });
});

describe("fillBuckets", () => {
  it("all: builds from rows ascending by key, no zero fill", () => {
    const buckets = fillBuckets("all", null, null, [
      { key: "2026", amount: 500, count: 2 },
      { key: "2024", amount: 100, count: 1 },
    ]);
    expect(buckets).toEqual([
      { key: "2024", label: "2024", amount: 100, count: 1 },
      { key: "2026", label: "2026", amount: 500, count: 2 },
    ]);
  });

  it("all: no rows gives no buckets", () => {
    expect(fillBuckets("all", null, null, [])).toEqual([]);
  });

  it("year: merges into the zero-filled twelve months", () => {
    const buckets = fillBuckets("year", 2026, null, [
      { key: "03", amount: 250_000, count: 2 },
      { key: "12", amount: 75_000, count: 1 },
    ]);
    expect(buckets).toHaveLength(12);
    expect(buckets[2]).toEqual({ key: "03", label: "T3", amount: 250_000, count: 2 });
    expect(buckets[11]).toEqual({ key: "12", label: "T12", amount: 75_000, count: 1 });
    expect(buckets[0]).toEqual({ key: "01", label: "T1", amount: 0, count: 0 });
    expect(buckets.reduce((sum, b) => sum + b.amount, 0)).toBe(325_000);
  });

  it("year: drops a key outside the axis", () => {
    const buckets = fillBuckets("year", 2026, null, [
      { key: "03", amount: 10, count: 1 },
      { key: "13", amount: 999, count: 9 },
      { key: "2026", amount: 999, count: 9 },
    ]);
    expect(buckets).toHaveLength(12);
    expect(buckets.reduce((sum, b) => sum + b.amount, 0)).toBe(10);
  });

  it("month: keeps every day of the month, zero-filled", () => {
    const buckets = fillBuckets("month", 2026, 2, [
      { key: "01", amount: 40_000, count: 1 },
      { key: "28", amount: 60_000, count: 2 },
    ]);
    expect(buckets).toHaveLength(28);
    expect(buckets[0]).toEqual({ key: "01", label: "1", amount: 40_000, count: 1 });
    expect(buckets[27]).toEqual({ key: "28", label: "28", amount: 60_000, count: 2 });
    expect(buckets[10]?.amount).toBe(0);
  });

  it("month: drops a day the month does not have", () => {
    const buckets = fillBuckets("month", 2026, 2, [
      { key: "29", amount: 999, count: 9 },
      { key: "05", amount: 1, count: 1 },
    ]);
    expect(buckets).toHaveLength(28);
    expect(buckets.reduce((sum, b) => sum + b.amount, 0)).toBe(1);
  });

  it("month: fills a 31-day month's last day", () => {
    const buckets = fillBuckets("month", 2026, 1, [{ key: "31", amount: 7, count: 1 }]);
    expect(buckets).toHaveLength(31);
    expect(buckets[30]).toEqual({ key: "31", label: "31", amount: 7, count: 1 });
  });

  it("does not mutate the rows it was given", () => {
    const rows = [{ key: "03", amount: 10, count: 1 }];
    fillBuckets("year", 2026, null, rows);
    expect(rows).toEqual([{ key: "03", amount: 10, count: 1 }]);
  });
});

describe("localBucketKey (the JS oracle for the SQL GROUP BY)", () => {
  it("rolls into the next year at local midnight", () => {
    // 2026-12-31T17:00:00.000Z is exactly 2027-01-01 00:00 in Vietnam.
    expect(localBucketKey("2026-12-31T17:00:00.000Z", "all")).toBe("2027");
    expect(localBucketKey("2026-12-31T16:59:59.999Z", "all")).toBe("2026");
  });

  it("rolls into the next month at local midnight", () => {
    expect(localBucketKey("2026-01-31T17:00:00.000Z", "year")).toBe("02");
    expect(localBucketKey("2026-01-31T16:59:59.999Z", "year")).toBe("01");
  });

  it("rolls into the next day at local midnight", () => {
    expect(localBucketKey("2026-03-31T17:00:00.000Z", "month")).toBe("01"); // 1 April local
    expect(localBucketKey("2026-03-31T16:59:59.999Z", "month")).toBe("31");
  });

  it("keeps a UTC evening in the same local day", () => {
    // 10:00 UTC on 14 Oct is 17:00 local on 14 Oct.
    expect(localBucketKey("2026-10-14T10:00:00.000Z", "month")).toBe("14");
    expect(localBucketKey("2026-10-14T10:00:00.000Z", "year")).toBe("10");
    expect(localBucketKey("2026-10-14T10:00:00.000Z", "all")).toBe("2026");
  });

  it("agrees with the range bounds: the last instant in a range is inside it", () => {
    const year = statsRangeUtc("year", 2026, null)!;
    expect(localBucketKey(year.startIso, "all")).toBe("2026");
    expect(localBucketKey("2026-12-31T16:59:59.999Z", "all")).toBe("2026");
    expect(localBucketKey(year.endIso, "all")).toBe("2027");
    expect(localBucketKey("2025-12-31T16:59:59.999Z", "all")).toBe("2025");
  });

  it("agrees with the range bounds for a 31-day month and a leap February", () => {
    const january = statsRangeUtc("month", 2026, 1)!;
    expect(localBucketKey(january.startIso, "month")).toBe("01");
    expect(localBucketKey("2026-01-31T16:59:59.999Z", "month")).toBe("31");
    expect(localBucketKey(january.endIso, "month")).toBe("01"); // 1 Feb local, outside the range

    const leapFeb = statsRangeUtc("month", 2028, 2)!;
    expect(localBucketKey("2028-02-29T16:59:59.999Z", "month")).toBe("29");
    expect(localBucketKey(leapFeb.endIso, "month")).toBe("01");
  });

  it("throws on a timestamp it cannot parse", () => {
    expect(() => localBucketKey("not-a-date", "all")).toThrow();
  });

  it("matches emptyBuckets' keys, so every oracle key is drawable", () => {
    const keys = new Set(emptyBuckets("month", 2026, 4).map((b) => b.key));
    for (let day = 1; day <= 30; day += 1) {
      // Noon UTC is evening in Vietnam, still the same local day.
      const noonUtc = new Date(Date.UTC(2026, 3, day, 12)).toISOString();
      expect(keys.has(localBucketKey(noonUtc, "month"))).toBe(true);
    }
  });
});

describe("formatCompactVnd", () => {
  it("leaves amounts under a thousand exact", () => {
    expect(formatCompactVnd(0)).toBe("0");
    expect(formatCompactVnd(350)).toBe("350");
    expect(formatCompactVnd(999)).toBe("999");
  });

  it("uses k below a million", () => {
    expect(formatCompactVnd(1_000)).toBe("1k");
    expect(formatCompactVnd(350_000)).toBe("350k");
    expect(formatCompactVnd(999_400)).toBe("999,4k");
  });

  it("uses tr with a Vietnamese decimal comma", () => {
    expect(formatCompactVnd(1_200_000)).toBe("1,2tr");
    expect(formatCompactVnd(1_000_000)).toBe("1tr");
    expect(formatCompactVnd(15_000_000)).toBe("15tr");
  });

  it("uses tỷ above a billion", () => {
    expect(formatCompactVnd(1_000_000_000)).toBe("1tỷ");
    expect(formatCompactVnd(2_500_000_000)).toBe("2,5tỷ");
  });

  it("promotes instead of printing a thousand of a smaller unit", () => {
    expect(formatCompactVnd(999_999)).toBe("1tr");
    expect(formatCompactVnd(999_999_999)).toBe("1tỷ");
  });

  it("keeps the sign and rounds to one decimal", () => {
    expect(formatCompactVnd(-1_200_000)).toBe("-1,2tr");
    expect(formatCompactVnd(1_250_000)).toBe("1,3tr");
    expect(formatCompactVnd(1_049_000)).toBe("1tr");
  });
});
