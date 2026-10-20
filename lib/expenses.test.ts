import { describe, expect, it } from "vitest";

import { assertMembersAllowed, assertPaymentShape, parseExpenseInput, type ExpenseInput } from "./expenses";
import type { Expense, Member } from "./types";

const valid = {
  title: "Ăn trưa",
  amount: 120000,
  paidByMemberId: "m1",
  participantMemberIds: ["m1", "m2"],
};

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};

describe("parseExpenseInput", () => {
  it("accepts a minimal body and defaults optional fields", () => {
    expect(parseExpenseInput(valid)).toEqual({ ...valid, spentAt: null, note: null, kind: "expense" });
  });

  it("defaults kind to expense and keeps an explicit payment", () => {
    expect(parseExpenseInput(valid).kind).toBe("expense");
    expect(
      parseExpenseInput({ ...valid, kind: "payment", participantMemberIds: ["m2"] }).kind,
    ).toBe("payment");
  });

  it.each([
    ["an unknown kind", { ...valid, kind: "transfer" }],
    ["a non-string kind", { ...valid, kind: 1 }],
  ])("rejects %s with VALIDATION", (_label, body) => {
    expect(codeOf(() => parseExpenseInput(body))).toBe("VALIDATION");
  });

  it("enforces the payment shape: exactly one receiver, never the payer", () => {
    expect(codeOf(() => parseExpenseInput({ ...valid, kind: "payment" }))).toBe("VALIDATION");
    expect(
      codeOf(() =>
        parseExpenseInput({ ...valid, kind: "payment", participantMemberIds: ["m1"] }),
      ),
    ).toBe("VALIDATION");
    expect(
      codeOf(() =>
        parseExpenseInput({ ...valid, kind: "payment", participantMemberIds: ["m1", "m2"] }),
      ),
    ).toBe("VALIDATION");
    expect(
      codeOf(() => parseExpenseInput({ ...valid, kind: "payment", participantMemberIds: ["m2"] })),
    ).toBeUndefined();
  });

  it("trims the title and canonicalises spentAt to UTC ISO", () => {
    const parsed = parseExpenseInput({
      ...valid,
      title: "  Cà phê  ",
      spentAt: "2026-10-14T10:00:00+07:00",
    });
    expect(parsed.title).toBe("Cà phê");
    expect(parsed.spentAt).toBe("2026-10-14T03:00:00.000Z");
  });

  it("collapses duplicate participants", () => {
    const parsed = parseExpenseInput({ ...valid, participantMemberIds: ["m2", "m1", "m2"] });
    expect(parsed.participantMemberIds).toEqual(["m2", "m1"]);
  });

  it("turns a blank or null note into null and keeps real text", () => {
    expect(parseExpenseInput({ ...valid, note: "   " }).note).toBeNull();
    expect(parseExpenseInput({ ...valid, note: null }).note).toBeNull();
    expect(parseExpenseInput({ ...valid, note: " lẩu " }).note).toBe("lẩu");
  });

  it.each([
    ["non-object body", "text"],
    ["missing title", { ...valid, title: undefined }],
    ["empty title", { ...valid, title: "   " }],
    ["title over 100 chars", { ...valid, title: "x".repeat(101) }],
    ["zero amount", { ...valid, amount: 0 }],
    ["negative amount", { ...valid, amount: -5 }],
    ["fractional amount", { ...valid, amount: 12.5 }],
    ["string amount", { ...valid, amount: "100000" }],
    ["amount over 1e12", { ...valid, amount: 1_000_000_000_001 }],
    ["missing payer", { ...valid, paidByMemberId: undefined }],
    ["empty participants", { ...valid, participantMemberIds: [] }],
    ["non-array participants", { ...valid, participantMemberIds: "m1" }],
    ["non-string participant", { ...valid, participantMemberIds: [1] }],
    ["bad spentAt", { ...valid, spentAt: "yesterday" }],
    ["note over 500 chars", { ...valid, note: "n".repeat(501) }],
  ])("rejects %s with VALIDATION", (_label, body) => {
    expect(codeOf(() => parseExpenseInput(body))).toBe("VALIDATION");
  });
});

describe("assertMembersAllowed", () => {
  const member = (id: string, removedAt: string | null = null): Member => ({
    id,
    groupId: "g1",
    name: `Member ${id}`,
    userId: null,
    username: null,
    removedAt,
    createdAt: "2026-10-01T00:00:00.000Z",
    bank: null,
    isOwner: false,
  });
  const members = [member("m1"), member("m2"), member("gone", "2026-10-10T00:00:00.000Z")];
  const input = (over: Partial<ExpenseInput>): ExpenseInput => ({
    title: "t",
    amount: 100,
    paidByMemberId: "m1",
    participantMemberIds: ["m1", "m2"],
    spentAt: null,
    note: null,
    kind: "expense",
    ...over,
  });
  const existing = {
    paidByMemberId: "gone",
    shares: [
      { memberId: "gone", amount: 50 },
      { memberId: "m1", amount: 50 },
    ],
  } as Expense;

  it("accepts active members", () => {
    expect(codeOf(() => assertMembersAllowed(members, input({}), null))).toBeUndefined();
  });

  it("rejects an unknown payer or participant", () => {
    expect(codeOf(() => assertMembersAllowed(members, input({ paidByMemberId: "zzz" }), null))).toBe(
      "VALIDATION",
    );
    expect(
      codeOf(() => assertMembersAllowed(members, input({ participantMemberIds: ["m1", "zzz"] }), null)),
    ).toBe("VALIDATION");
  });

  it("rejects a removed member on a new expense", () => {
    expect(
      codeOf(() => assertMembersAllowed(members, input({ participantMemberIds: ["gone"] }), null)),
    ).toBe("VALIDATION");
    expect(codeOf(() => assertMembersAllowed(members, input({ paidByMemberId: "gone" }), null))).toBe(
      "VALIDATION",
    );
  });

  it("lets an edit keep a removed member who is already in that expense", () => {
    const edit = input({ paidByMemberId: "gone", participantMemberIds: ["gone", "m1"] });
    expect(codeOf(() => assertMembersAllowed(members, edit, existing))).toBeUndefined();
  });

  it("still rejects adding a removed member who was NOT in the expense", () => {
    const other = [...members, member("gone2", "2026-10-11T00:00:00.000Z")];
    const edit = input({ participantMemberIds: ["m1", "gone2"] });
    expect(codeOf(() => assertMembersAllowed(other, edit, existing))).toBe("VALIDATION");
  });
});

describe("assertPaymentShape", () => {
  it("accepts one receiver who is not the payer", () => {
    expect(
      codeOf(() =>
        assertPaymentShape({ kind: "payment", paidByMemberId: "m1", participantMemberIds: ["m2"] }),
      ),
    ).toBeUndefined();
  });

  it("rejects zero or several receivers", () => {
    expect(
      codeOf(() =>
        assertPaymentShape({ kind: "payment", paidByMemberId: "m1", participantMemberIds: [] }),
      ),
    ).toBe("VALIDATION");
    expect(
      codeOf(() =>
        assertPaymentShape({ kind: "payment", paidByMemberId: "m1", participantMemberIds: ["m2", "m3"] }),
      ),
    ).toBe("VALIDATION");
  });

  it("rejects the payer paying themselves", () => {
    expect(
      codeOf(() =>
        assertPaymentShape({ kind: "payment", paidByMemberId: "m1", participantMemberIds: ["m1"] }),
      ),
    ).toBe("VALIDATION");
  });

  it("leaves an ordinary expense unconstrained", () => {
    expect(
      codeOf(() =>
        assertPaymentShape({ kind: "expense", paidByMemberId: "m1", participantMemberIds: ["m1", "m2"] }),
      ),
    ).toBeUndefined();
  });
});
