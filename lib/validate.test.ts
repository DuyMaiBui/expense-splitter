import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import { int, isoDate, obj, str, strArray } from "./validate";

/** Every validator failure must be a VALIDATION ApiError (HTTP 400). */
function expectValidationError(run: () => unknown, field: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe("VALIDATION");
    expect(apiError.status).toBe(400);
    expect(apiError.message).toContain(field);
    return;
  }
  throw new Error(`expected a validation error naming "${field}", but nothing was thrown`);
}

describe("str", () => {
  it("returns a string unchanged", () => {
    expect(str("An trưa", "title")).toBe("An trưa");
  });

  it("trims by default", () => {
    expect(str("  An trưa  ", "title")).toBe("An trưa");
  });

  it("can preserve surrounding whitespace", () => {
    expect(str("  x  ", "title", { trim: false })).toBe("  x  ");
  });

  it("measures length after trimming", () => {
    // Six spaces trim to the empty string, which is below min: 1.
    expectValidationError(() => str("      ", "title", { min: 1 }), "title");
  });

  it("enforces min and max", () => {
    expect(str("abc", "username", { min: 3, max: 32 })).toBe("abc");
    expectValidationError(() => str("ab", "username", { min: 3 }), "username");
    expectValidationError(() => str("a".repeat(33), "username", { max: 32 }), "username");
  });

  it("rejects non-strings", () => {
    expectValidationError(() => str(12, "name"), "name");
    expectValidationError(() => str(null, "name"), "name");
    expectValidationError(() => str(undefined, "name"), "name");
    expectValidationError(() => str(["a"], "name"), "name");
    expectValidationError(() => str({ a: 1 }, "name"), "name");
  });
});

describe("int", () => {
  it("accepts integers in range", () => {
    expect(int(120000, "amount", { min: 1, max: 1e12 })).toBe(120000);
    expect(int(0, "amount")).toBe(0);
    expect(int(-5, "amount", { min: -10 })).toBe(-5);
  });

  it("rejects non-integers", () => {
    expectValidationError(() => int(1.5, "amount"), "amount");
    expectValidationError(() => int(Number.NaN, "amount"), "amount");
    expectValidationError(() => int(Number.POSITIVE_INFINITY, "amount"), "amount");
  });

  it("rejects non-numbers", () => {
    expectValidationError(() => int("100", "amount"), "amount");
    expectValidationError(() => int(null, "amount"), "amount");
  });

  it("enforces min and max inclusively", () => {
    expectValidationError(() => int(0, "amount", { min: 1 }), "amount");
    expectValidationError(() => int(1e12 + 1, "amount", { max: 1e12 }), "amount");
    expect(int(1e12, "amount", { max: 1e12 })).toBe(1e12);
  });
});

describe("isoDate", () => {
  it("accepts an ISO timestamp and returns it in canonical form", () => {
    expect(isoDate("2026-10-15T08:30:00.000Z", "spentAt")).toBe("2026-10-15T08:30:00.000Z");
  });

  it("canonicalises an offset timestamp to UTC", () => {
    // +07:00 is Vietnam time; 15:30 local is 08:30 UTC.
    expect(isoDate("2026-10-15T15:30:00+07:00", "spentAt")).toBe("2026-10-15T08:30:00.000Z");
  });

  it("canonicalises a date without a time component", () => {
    expect(isoDate("2026-10-15", "spentAt")).toBe("2026-10-15T00:00:00.000Z");
  });

  it("rejects unparseable or non-string values", () => {
    expectValidationError(() => isoDate("khong-phai-ngay", "spentAt"), "spentAt");
    expectValidationError(() => isoDate("", "spentAt"), "spentAt");
    expectValidationError(() => isoDate(1_700_000_000_000, "spentAt"), "spentAt");
    expectValidationError(() => isoDate(null, "spentAt"), "spentAt");
  });
});

describe("strArray", () => {
  it("returns an array of strings unchanged", () => {
    expect(strArray(["a", "b"], "participantMemberIds")).toEqual(["a", "b"]);
  });

  it("accepts an empty array when no minimum is set", () => {
    expect(strArray([], "participantMemberIds")).toEqual([]);
  });

  it("enforces min and max", () => {
    expect(strArray(["a"], "participantMemberIds", { min: 1 })).toEqual(["a"]);
    expectValidationError(
      () => strArray([], "participantMemberIds", { min: 1 }),
      "participantMemberIds",
    );
    expectValidationError(
      () => strArray(["a", "b"], "participantMemberIds", { max: 1 }),
      "participantMemberIds",
    );
  });

  it("rejects non-arrays", () => {
    expectValidationError(() => strArray("a", "participantMemberIds"), "participantMemberIds");
    expectValidationError(() => strArray(null, "participantMemberIds"), "participantMemberIds");
  });

  it("rejects an array containing non-strings", () => {
    expectValidationError(() => strArray(["a", 2], "participantMemberIds"), "participantMemberIds");
  });
});

describe("obj", () => {
  it("returns a plain object unchanged", () => {
    expect(obj({ name: "Nhóm" }, "body")).toEqual({ name: "Nhóm" });
  });

  it("rejects null, arrays and primitives", () => {
    expectValidationError(() => obj(null, "body"), "body");
    expectValidationError(() => obj([], "body"), "body");
    expectValidationError(() => obj(["a"], "body"), "body");
    expectValidationError(() => obj("body", "body"), "body");
    expectValidationError(() => obj(42, "body"), "body");
  });
});
