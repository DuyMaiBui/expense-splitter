import { describe, expect, it } from "vitest";

import { generateTempPassword, parseResetBody, TEMP_PASSWORD_LENGTH } from "./admin";

describe("generateTempPassword", () => {
  it("has the fixed length and only unambiguous characters", () => {
    for (let i = 0; i < 200; i += 1) {
      const password = generateTempPassword();
      expect(password).toHaveLength(TEMP_PASSWORD_LENGTH);
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/); // no 0 O 1 I l
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateTempPassword()));
    expect(seen.size).toBe(500);
  });
});

describe("parseResetBody", () => {
  it("treats a missing or empty password as 'generate one'", () => {
    expect(parseResetBody({})).toEqual({});
    expect(parseResetBody({ password: "" })).toEqual({});
  });

  it("keeps a typed password verbatim, spaces included", () => {
    expect(parseResetBody({ password: " abc 123 " })).toEqual({ password: " abc 123 " });
  });

  it("applies the registration bounds", () => {
    expect(() => parseResetBody({ password: "12345" })).toThrow();
    expect(() => parseResetBody({ password: "x".repeat(129) })).toThrow();
    expect(() => parseResetBody({ password: 123456 })).toThrow();
    expect(() => parseResetBody(null)).toThrow();
  });
});
