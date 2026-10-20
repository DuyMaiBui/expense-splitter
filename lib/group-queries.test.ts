import { describe, expect, it } from "vitest";

import { generateInviteCode, sameName, toMember } from "./group-queries";

type MemberRowInput = Parameters<typeof toMember>[0];

const row = (over: Partial<MemberRowInput> = {}): MemberRowInput => ({
  id: "m1",
  group_id: "g1",
  user_id: null,
  name: "Chi",
  removed_at: null,
  created_at: "2026-10-01T00:00:00.000Z",
  username: null,
  bank_bin: null,
  bank_account_no: null,
  bank_account_name: null,
  ...over,
});

describe("sameName", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(sameName("Chi", "  chi ")).toBe(true);
    expect(sameName("HƯNG", "hưng")).toBe(true);
  });

  it("is Vietnamese-aware (SQLite lower() is ASCII-only)", () => {
    expect(sameName("Đạt", "đạt")).toBe(true);
    expect(sameName("Ân", "ân")).toBe(true);
  });

  it("keeps different diacritics distinct", () => {
    expect(sameName("An", "Ân")).toBe(false);
    expect(sameName("Hung", "Hưng")).toBe(false);
  });
});

describe("generateInviteCode", () => {
  it("is 8 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateInviteCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  it("does not repeat across many draws", () => {
    const codes = new Set(Array.from({ length: 500 }, generateInviteCode));
    expect(codes.size).toBe(500);
  });
});

describe("toMember", () => {
  it("maps snake_case rows to the contract's camelCase", () => {
    expect(toMember(row())).toEqual({
      id: "m1",
      groupId: "g1",
      name: "Chi",
      userId: null,
      username: null,
      removedAt: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      bank: null,
    });
  });

  it("carries a fully stored bank account", () => {
    expect(
      toMember(row({ bank_bin: "970436", bank_account_no: "0123456789", bank_account_name: "CHI NGUYEN" }))
        .bank,
    ).toEqual({ bin: "970436", accountNo: "0123456789", accountName: "CHI NGUYEN" });
  });

  it("reads a partially stored account as null instead of a half-filled one", () => {
    expect(toMember(row({ bank_bin: "970436", bank_account_no: null, bank_account_name: "CHI" })).bank).toBeNull();
    expect(toMember(row({ bank_bin: null, bank_account_no: "0123456789", bank_account_name: "CHI" })).bank).toBeNull();
    expect(toMember(row({ bank_bin: "970436", bank_account_no: "0123456789", bank_account_name: null })).bank).toBeNull();
  });
});
