import { describe, expect, it } from "vitest";

import { canModifyExpense, canRecordPayment, canRemoveMember } from "./permissions";
import type { Expense, Member, Viewer } from "./types";

/**
 * One test per row of the permission matrix in docs/CONTRACT.md § PERMISSIONS. The matrix is
 * small enough that every cell is listed explicitly: a rule that never fires in these tests is
 * a rule the routes would enforce alone.
 */

const member = (over: Partial<Member> & { id: string }): Member => ({
  groupId: "g1",
  name: over.id,
  userId: null,
  username: null,
  removedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  bank: null,
  isOwner: false,
  ...over,
});

// alice owns the group, bob and chi are plain members, tong is a friend with no account.
const ALICE = member({ id: "m-alice", userId: "u-alice", name: "Alice", isOwner: true });
const BOB = member({ id: "m-bob", userId: "u-bob", name: "Bob" });
const CHI = member({ id: "m-chi", userId: "u-chi", name: "Chi" });
const TONG = member({ id: "m-tong", name: "Tổng" });
const MEMBERS = [ALICE, BOB, CHI, TONG];

const owner: Viewer = { userId: "u-alice", memberId: "m-alice", isOwner: true, isAdmin: false };
const bobViewer: Viewer = { userId: "u-bob", memberId: "m-bob", isOwner: false, isAdmin: false };
const chiViewer: Viewer = { userId: "u-chi", memberId: "m-chi", isOwner: false, isAdmin: false };
const adminViewer: Viewer = { userId: "u-admin", memberId: null, isOwner: false, isAdmin: true };

type ExpenseInput = Pick<Expense, "kind" | "createdByUserId" | "paidByMemberId" | "shares">;

const expense = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
  kind: "expense",
  createdByUserId: "u-alice",
  paidByMemberId: "m-alice",
  shares: [
    { memberId: "m-alice", amount: 500 },
    { memberId: "m-bob", amount: 500 },
  ],
  ...over,
});

/** A settlement: bob paid alice 1000, stored as one share on alice's member row. */
const payment = (over: Partial<ExpenseInput> = {}): ExpenseInput =>
  expense({
    kind: "payment",
    createdByUserId: "u-bob",
    paidByMemberId: "m-bob",
    shares: [{ memberId: "m-alice", amount: 1000 }],
    ...over,
  });

describe("canModifyExpense", () => {
  it("lets the group owner edit anything", () => {
    expect(canModifyExpense(owner, expense(), MEMBERS)).toBe(true);
    expect(canModifyExpense(owner, expense({ createdByUserId: "u-bob" }), MEMBERS)).toBe(true);
  });

  it("lets the admin account edit anything, member row or not", () => {
    expect(canModifyExpense(adminViewer, expense(), MEMBERS)).toBe(true);
    expect(canModifyExpense(adminViewer, payment(), MEMBERS)).toBe(true);
  });

  it("lets the creator edit their own expense", () => {
    expect(canModifyExpense(bobViewer, expense({ createdByUserId: "u-bob", paidByMemberId: "m-alice" }), MEMBERS)).toBe(true);
  });

  it("lets the payer edit the expense they paid, even when someone else created it", () => {
    const paidByChi = expense({ createdByUserId: "u-alice", paidByMemberId: "m-chi" });
    expect(canModifyExpense(chiViewer, paidByChi, MEMBERS)).toBe(true);
  });

  it("lets the receiver of a payment edit it", () => {
    expect(canModifyExpense(chiViewer, payment({ shares: [{ memberId: "m-chi", amount: 1000 }] }), MEMBERS)).toBe(true);
  });

  it("refuses an unrelated member, a friend row and a non-member", () => {
    const placedByAlice = expense({ createdByUserId: "u-alice", paidByMemberId: "m-alice" });
    expect(canModifyExpense(bobViewer, placedByAlice, MEMBERS)).toBe(false);
    expect(canModifyExpense(chiViewer, placedByAlice, MEMBERS)).toBe(false);

    // A friend has no viewer of their own, but a member row with userId null must never match.
    const tongShaped: Viewer = { userId: "u-tong?", memberId: "m-tong", isOwner: false, isAdmin: false };
    expect(canModifyExpense(tongShaped, placedByAlice, MEMBERS)).toBe(false);
  });

  it("lets the payer of a payment edit it even when someone else recorded it", () => {
    // bob paid alice; chi recorded it.
    const bobPaidAlice = payment({ createdByUserId: "u-chi" });
    expect(canModifyExpense(bobViewer, bobPaidAlice, MEMBERS)).toBe(true);
  });

  it("refuses a member who is neither party to a payment", () => {
    // bob paid alice; chi created neither, paid nothing and received nothing.
    const bobPaidAlice = payment({ createdByUserId: "u-alice" });
    expect(canModifyExpense(chiViewer, bobPaidAlice, MEMBERS)).toBe(false);
  });

  it("ignores an unknown payer member instead of throwing", () => {
    const orphan = expense({ createdByUserId: "u-alice", paidByMemberId: "m-gone" });
    expect(canModifyExpense(bobViewer, orphan, MEMBERS)).toBe(false);
  });

  it("a payment with more than one share has no single receiver to match", () => {
    const broken = payment({ shares: [
      { memberId: "m-alice", amount: 500 },
      { memberId: "m-chi", amount: 500 },
    ] });
    expect(canModifyExpense(chiViewer, broken, MEMBERS)).toBe(false);
  });
});

describe("canRecordPayment", () => {
  it("lets the owner and the admin record any payment", () => {
    expect(canRecordPayment(owner, "m-bob", "m-chi")).toBe(true);
    expect(canRecordPayment(adminViewer, "m-bob", "m-chi")).toBe(true);
  });

  it("lets the payer record it, and the receiver record it", () => {
    expect(canRecordPayment(bobViewer, "m-bob", "m-chi")).toBe(true);
    expect(canRecordPayment(chiViewer, "m-bob", "m-chi")).toBe(true);
  });

  it("refuses an unrelated member", () => {
    expect(canRecordPayment(chiViewer, "m-bob", "m-alice")).toBe(false);
    expect(canRecordPayment(bobViewer, "m-alice", "m-chi")).toBe(false);
  });

  it("allows a payment between friends nobody in it is signed in for, when the caller owns the group", () => {
    expect(canRecordPayment(owner, "m-tong", "m-bob")).toBe(true);
  });
});

describe("canRemoveMember", () => {
  it("protects the owner from everyone, the admin included", () => {
    for (const viewer of [owner, bobViewer, chiViewer, adminViewer]) {
      expect(canRemoveMember(viewer, ALICE)).toEqual({
        ok: false,
        code: "OWNER_PROTECTED",
        message: expect.any(String),
      });
    }
  });

  it("lets the owner and the admin remove anyone else", () => {
    for (const viewer of [owner, adminViewer]) {
      for (const target of [BOB, CHI, TONG]) {
        expect(canRemoveMember(viewer, target)).toEqual({ ok: true });
      }
    }
  });

  it("lets a plain member remove only their own row (leaving the group)", () => {
    expect(canRemoveMember(bobViewer, BOB)).toEqual({ ok: true });
    expect(canRemoveMember(bobViewer, CHI)).toEqual({ ok: false, code: "FORBIDDEN", message: expect.any(String) });
    expect(canRemoveMember(bobViewer, TONG)).toEqual({ ok: false, code: "FORBIDDEN", message: expect.any(String) });
  });

  it("refuses a caller with no member row, other than the admin", () => {
    const noRow: Viewer = { userId: "u-ghost", memberId: null, isOwner: false, isAdmin: false };
    expect(canRemoveMember(noRow, BOB)).toEqual({ ok: false, code: "FORBIDDEN", message: expect.any(String) });
  });

  it("writes its refusals in Vietnamese", () => {
    const ownerRefusal = canRemoveMember(bobViewer, ALICE);
    const forbidden = canRemoveMember(bobViewer, CHI);
    expect(ownerRefusal.ok ? "" : ownerRefusal.message).toMatch(/chủ nhóm/);
    expect(forbidden.ok ? "" : forbidden.message).toMatch(/tự rời nhóm/);
  });
});
