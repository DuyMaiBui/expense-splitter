import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import { EMAIL_MAX_LENGTH, parseEmail } from "./validate";

/** Every parseEmail failure must be a VALIDATION ApiError (HTTP 400) naming its field. */
function expectValidationError(run: () => unknown, field = "email"): void {
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

/** `local + "@" + domain` padded to exactly `length` characters with a legal-looking address. */
function addressOfLength(length: number): string {
  const domain = "@example.com";
  return `${"a".repeat(length - domain.length)}${domain}`;
}

describe("parseEmail", () => {
  it("accepts a valid address unchanged", () => {
    expect(parseEmail("an@example.com")).toBe("an@example.com");
  });

  it("trims and lowercases a mixed-case address with surrounding whitespace", () => {
    expect(parseEmail("  An.Nguyen@Example.COM  ")).toBe("an.nguyen@example.com");
    expect(parseEmail("\tan@example.com\n")).toBe("an@example.com");
  });

  it("accepts dots, plus signs and hyphens inside the parts", () => {
    expect(parseEmail("first.last+tag@mail.example.co")).toBe("first.last+tag@mail.example.co");
  });

  it("accepts a 2-letter TLD and an address exactly at the length ceiling", () => {
    expect(parseEmail("an@example.io")).toBe("an@example.io");
    expect(parseEmail(addressOfLength(EMAIL_MAX_LENGTH))).toHaveLength(EMAIL_MAX_LENGTH);
  });

  it("rejects a missing @", () => {
    expectValidationError(() => parseEmail("an.example.com"));
  });

  it("rejects two @", () => {
    expectValidationError(() => parseEmail("an@@example.com"));
    expectValidationError(() => parseEmail("an@ex@ample.com"));
  });

  it("rejects a domain without a dot", () => {
    expectValidationError(() => parseEmail("an@example"));
  });

  it("rejects a 1-character TLD", () => {
    expectValidationError(() => parseEmail("an@example.c"));
  });

  it("rejects a numeric TLD", () => {
    expectValidationError(() => parseEmail("an@example.c0m"));
  });

  it("rejects an empty address", () => {
    expectValidationError(() => parseEmail(""));
    expectValidationError(() => parseEmail("   "));
  });

  it("rejects an address over the length ceiling", () => {
    expectValidationError(() => parseEmail(addressOfLength(EMAIL_MAX_LENGTH + 1)));
  });

  it("measures the ceiling after trimming, not before", () => {
    // Padded past the ceiling, still valid once the surrounding whitespace is gone.
    expect(parseEmail(`  ${addressOfLength(EMAIL_MAX_LENGTH)}  `)).toHaveLength(EMAIL_MAX_LENGTH);
  });

  it("rejects internal whitespace", () => {
    expectValidationError(() => parseEmail("an nguyen@example.com"));
    expectValidationError(() => parseEmail("an@exa mple.com"));
    expectValidationError(() => parseEmail("an\tnguyen@example.com"));
  });

  it("rejects consecutive dots", () => {
    expectValidationError(() => parseEmail("an..nguyen@example.com"));
    expectValidationError(() => parseEmail("an@example..com"));
  });

  it("rejects an empty local part", () => {
    expectValidationError(() => parseEmail("@example.com"));
  });

  it("rejects a null email, which the route — not the parser — turns into a clear", () => {
    expectValidationError(() => parseEmail(null));
    expectValidationError(() => parseEmail(undefined));
  });

  it("rejects non-string values", () => {
    expectValidationError(() => parseEmail(42));
    expectValidationError(() => parseEmail({ email: "an@example.com" }));
    expectValidationError(() => parseEmail(["an@example.com"]));
  });

  it("names the field it was given", () => {
    expectValidationError(() => parseEmail("", "recoveryEmail"), "recoveryEmail");
  });
});
