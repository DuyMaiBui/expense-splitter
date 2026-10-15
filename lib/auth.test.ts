import { describe, expect, it, vi } from "vitest";

// auth.ts imports `next/headers` at module scope; the functions under test here are pure
// crypto, so Next's request-scoped cookie store is stubbed out.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

import { SESSION_COOKIE, hashPassword, verifyPassword } from "./auth";

describe("hashPassword", () => {
  it("returns a base64 hash and salt", async () => {
    const { hash, salt } = await hashPassword("matkhau123");

    // 32 derived bytes and a 16-byte salt both encode to base64 without whitespace.
    expect(hash).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(salt).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(hash).not.toBe(salt);
  });

  it("salts each hash, so the same password hashes differently every time", async () => {
    const first = await hashPassword("matkhau123");
    const second = await hashPassword("matkhau123");

    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it("never returns the password in cleartext", async () => {
    const { hash, salt } = await hashPassword("matkhau123");

    expect(hash).not.toContain("matkhau123");
    expect(salt).not.toContain("matkhau123");
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    const { hash, salt } = await hashPassword("matkhau123");

    await expect(verifyPassword("matkhau123", hash, salt)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const { hash, salt } = await hashPassword("matkhau123");

    await expect(verifyPassword("matkhau124", hash, salt)).resolves.toBe(false);
    await expect(verifyPassword("", hash, salt)).resolves.toBe(false);
    await expect(verifyPassword("MATKHAU123", hash, salt)).resolves.toBe(false);
  });

  it("rejects a hash derived from a different salt", async () => {
    const first = await hashPassword("matkhau123");
    const second = await hashPassword("matkhau123");

    await expect(verifyPassword("matkhau123", first.hash, second.salt)).resolves.toBe(false);
  });

  it("is case- and whitespace-sensitive", async () => {
    const { hash, salt } = await hashPassword("matkhau123");

    await expect(verifyPassword(" matkhau123", hash, salt)).resolves.toBe(false);
    await expect(verifyPassword("matkhau123 ", hash, salt)).resolves.toBe(false);
  });
});

describe("session cookie", () => {
  it("uses the contract's cookie name", () => {
    expect(SESSION_COOKIE).toBe("sid");
  });
});
