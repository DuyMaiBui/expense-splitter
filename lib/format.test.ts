import { describe, expect, it } from "vitest";

import { formatDateTime, formatVnd, isoToLocalInput, localInputToIso } from "./format";

describe("formatVnd", () => {
  it("groups thousands with dots and appends đ", () => {
    expect(formatVnd(0)).toBe("0đ");
    expect(formatVnd(999)).toBe("999đ");
    expect(formatVnd(1000)).toBe("1.000đ");
    expect(formatVnd(120000)).toBe("120.000đ");
    expect(formatVnd(1234567)).toBe("1.234.567đ");
    expect(formatVnd(999_999_999_999)).toBe("999.999.999.999đ");
  });

  it("keeps the sign for negative balances", () => {
    expect(formatVnd(-5000)).toBe("-5.000đ");
    expect(formatVnd(-1)).toBe("-1đ");
  });

  it("rounds fractional input instead of printing decimals", () => {
    expect(formatVnd(1000.4)).toBe("1.000đ");
    expect(formatVnd(1000.6)).toBe("1.001đ");
  });
});

describe("date formatting (Asia/Ho_Chi_Minh, UTC+7)", () => {
  it("formatDateTime renders dd/MM/yyyy HH:mm in Vietnam time", () => {
    expect(formatDateTime("2026-10-14T03:00:00.000Z")).toBe("14/10/2026 10:00");
  });

  it("rolls the date forward across midnight", () => {
    expect(formatDateTime("2026-10-14T17:30:00.000Z")).toBe("15/10/2026 00:30");
  });

  it("returns unparseable input unchanged", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });

  it("isoToLocalInput gives a datetime-local value in Vietnam time", () => {
    expect(isoToLocalInput("2026-10-14T03:00:00.000Z")).toBe("2026-10-14T10:00");
    expect(isoToLocalInput("nope")).toBe("");
  });

  it("localInputToIso is the inverse of isoToLocalInput", () => {
    expect(localInputToIso("2026-10-14T10:00")).toBe("2026-10-14T03:00:00.000Z");
    expect(localInputToIso("2026-10-15T00:30")).toBe("2026-10-14T17:30:00.000Z");

    const iso = "2026-01-02T23:45:00.000Z";
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
  });

  it("localInputToIso returns '' for malformed input", () => {
    expect(localInputToIso("")).toBe("");
    expect(localInputToIso("14/10/2026 10:00")).toBe("");
  });
});
