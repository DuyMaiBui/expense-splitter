import type { Expense, Member, Viewer } from "./types";

/**
 * Who may do what inside a group.
 *
 * Pure and import-safe on the server (routes) and in client components (pages), so a route and
 * the button it backs up can never disagree about a rule. Groups have an owner
 * (`groups.created_by`); the admin account counts as owner-level everywhere. Every function
 * takes the caller as a `Viewer`, which the group routes build once per request.
 */

/** The caller owns this group (by `groups.created_by`). */
function isOwnerLevel(viewer: Viewer): boolean {
  return viewer.isAdmin || viewer.isOwner;
}

const DENIED_UNRELATED = "Bạn không có quyền thực hiện thao tác này.";
const DENIED_OWNER = "Không thể xóa chủ nhóm khỏi nhóm.";
const DENIED_LEAVE_OTHER = "Bạn chỉ có thể tự rời nhóm, không thể xóa thành viên khác.";

/**
 * Whether the caller may edit or delete an expense.
 *
 * Allowed iff the caller is the admin, owns the group, created the expense, is the member who
 * paid it, or — for a settlement payment — is the single receiver whose share it is.
 */
export function canModifyExpense(
  viewer: Viewer,
  expense: Pick<Expense, "kind" | "createdByUserId" | "paidByMemberId" | "shares">,
  members: readonly Member[],
): boolean {
  if (isOwnerLevel(viewer) || expense.createdByUserId === viewer.userId) {
    return true;
  }
  // `memberId` is null for the admin (already covered above), so a plain member is left.
  if (viewer.memberId === null) {
    return false;
  }

  const payer = members.find((member) => member.id === expense.paidByMemberId);
  if (payer && payer.userId === viewer.userId) {
    return true;
  }

  if (expense.kind !== "payment" || expense.shares.length !== 1) {
    return false;
  }
  const receiver = members.find((member) => member.id === expense.shares[0]!.memberId);
  return receiver !== undefined && receiver.userId === viewer.userId;
}

/**
 * Whether the caller may create this expense.
 *
 * A payment moves money between two people, so only the payer, the receiver, the owner or the
 * admin may record it. An ordinary expense stays open to any active group member.
 */
export function canRecordPayment(
  viewer: Viewer,
  payerMemberId: string,
  receiverMemberId: string,
): boolean {
  if (isOwnerLevel(viewer)) {
    return true;
  }
  if (viewer.memberId === null) {
    return false;
  }
  return viewer.memberId === payerMemberId || viewer.memberId === receiverMemberId;
}

/** A refusal: `code` maps to the contract's error (`OWNER_PROTECTED` is a 409, the rest a 403). */
export type RemoveMemberVerdict =
  | { ok: true }
  | { ok: false; code: "OWNER_PROTECTED" | "FORBIDDEN"; message: string };

/**
 * Whether the caller may remove `target` (a soft delete; removing your own row is how you leave).
 *
 * The owner can never be removed, by anyone. The owner and the admin remove anyone else; every
 * other member may remove only their own row.
 */
export function canRemoveMember(viewer: Viewer, target: Member): RemoveMemberVerdict {
  if (target.isOwner) {
    return { ok: false, code: "OWNER_PROTECTED", message: DENIED_OWNER };
  }
  if (isOwnerLevel(viewer)) {
    return { ok: true };
  }
  if (viewer.memberId !== null && target.id === viewer.memberId) {
    return { ok: true };
  }
  return { ok: false, code: "FORBIDDEN", message: DENIED_LEAVE_OTHER };
}
