/**
 * Plain-Vietnamese sentences for the pair statement and the "Ai trả ai" rows. Pure: no React, so
 * the wording is unit-tested in isolation. Every number goes through formatVnd and every time
 * through formatDateTime, so the screens and these sentences always agree on the format.
 */

import { formatDateTime, formatVnd } from "@/lib/format";
import type { PairRevision, PairStatement, Transfer } from "@/lib/types";

/** The fields a revision sentence reads. A PairRemovedRevision carries the same ones. */
export type RevisionFields = Pick<
  PairRevision,
  | "at"
  | "actorName"
  | "action"
  | "beforeAmount"
  | "afterAmount"
  | "beforeMemberShare"
  | "afterMemberShare"
>;

/** Shown beside a revision whose edit came after money had already moved between the pair. */
export const AFTER_PAYMENT_BADGE = "Sửa sau khi đã thanh toán";

/** The legend under the pair view: why an after-payment edit is the usual cause of a wrong amount. */
export const AFTER_PAYMENT_LEGEND =
  "Sửa sau khi đã thanh toán là nguyên nhân thường gặp nhất khiến người ta trả thừa hoặc thiếu: " +
  "khoản đã chuyển trước đó không tự đổi theo lần sửa.";

/** How many names a sentence spells out before it counts the rest. */
const NAMES_SHOWN = 2;

/** "Tên nợ bạn 120.000đ" for money owed to the viewer, or "Bạn nợ Tên 120.000đ" the other way. */
export function netSentence(name: string, net: number): string {
  if (net > 0) {
    return `${name} nợ bạn ${formatVnd(net)}`;
  }
  if (net < 0) {
    return `Bạn nợ ${name} ${formatVnd(-net)}`;
  }
  return `Đã huề với ${name}`;
}

/** "A", "A và B", "A, B và C". */
function joinNatural(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  return `${items.slice(0, -1).join(", ")} và ${items[items.length - 1]}`;
}

/** The first names spelled out, then a count of the rest: "A, B và 2 người khác". */
function topWithRest(items: readonly string[]): string {
  if (items.length <= NAMES_SHOWN) {
    return joinNatural(items);
  }
  const shown = items.slice(0, NAMES_SHOWN).join(", ");
  return `${shown} và ${items.length - NAMES_SHOWN} người khác`;
}

/**
 * The one sentence at the top of the pair view: why the viewer is owed, or owes, the total. The
 * largest counterparties are named first; the opposite side, if any, follows as "Ngược lại".
 */
export function balanceSentence(statements: readonly PairStatement[]): string {
  if (statements.length === 0) {
    return "Bạn chưa có khoản chi nào liên quan đến ai.";
  }

  const incoming = statements.filter((s) => s.net > 0).sort((a, b) => b.net - a.net);
  const outgoing = statements.filter((s) => s.net < 0).sort((a, b) => a.net - b.net);
  if (incoming.length === 0 && outgoing.length === 0) {
    return "Bạn đã huề với mọi người.";
  }

  const total = statements.reduce((sum, s) => sum + s.net, 0);
  const incomingPhrases = incoming.map((s) => `${s.counterpartyName} nợ bạn ${formatVnd(s.net)}`);
  const outgoingPhrases = outgoing.map((s) => `${s.counterpartyName} ${formatVnd(-s.net)}`);

  if (total === 0) {
    return "Bạn đã huề với mọi người, tổng được nhận bằng tổng phải trả.";
  }
  if (total > 0) {
    const head = `Bạn đang được nhận ${formatVnd(total)}, chủ yếu vì ${topWithRest(incomingPhrases)}.`;
    return outgoing.length === 0
      ? head
      : `${head} Ngược lại, bạn nợ ${joinNatural(outgoingPhrases)}.`;
  }
  const head = `Bạn còn phải trả ${formatVnd(-total)}, chủ yếu vì bạn nợ ${topWithRest(outgoingPhrases)}.`;
  return incoming.length === 0
    ? head
    : `${head} Ngược lại, ${joinNatural(incomingPhrases)}.`;
}

/** A counterparty with nothing to explain: net 0 and no event or removed revision behind it. */
export function isQuietStatement(statement: PairStatement): boolean {
  return (
    statement.net === 0 &&
    statement.removedRevisions.length === 0 &&
    statement.events.every((event) => event.revisions.length === 0)
  );
}

/** The warning badge text for a revision, or null when the edit came before any payment. */
export function paymentWarning(afterLaterPayment: boolean): string | null {
  return afterLaterPayment ? AFTER_PAYMENT_BADGE : null;
}

function amountOrRemoved(amount: number | null): string {
  return amount === null ? "đã xóa" : formatVnd(amount);
}

/**
 * "Sửa lúc {at} bởi {actor}: {before} -> {after}, phần của bạn {before} -> {after}". A delete reads
 * the same with "đã xóa" on the after side. Amounts are the row's own; the share is the viewer's.
 */
export function revisionSentence(revision: RevisionFields): string {
  const verb = revision.action === "delete" ? "Xóa" : "Sửa";
  const when = `${verb} lúc ${formatDateTime(revision.at)} bởi ${revision.actorName}`;
  const amounts = `${formatVnd(revision.beforeAmount)} -> ${amountOrRemoved(revision.afterAmount)}`;
  const shares = `phần của bạn ${formatVnd(revision.beforeMemberShare)} -> ${amountOrRemoved(revision.afterMemberShare)}`;
  return `${when}: ${amounts}, ${shares}`;
}

/** Badge and sentence for one "Ai trả ai" row. `from` pays `to`; `to` is the one who spent. */
export function transferExplanation(
  transfer: Transfer,
  fromName: string,
  toName: string,
): { badge: string; sentence: string } {
  if (transfer.basis === "direct") {
    return {
      badge: "Trả đúng người đã chi",
      sentence: `${toName} đã chi cho ${fromName}. Nợ trực tiếp ${formatVnd(transfer.directDebt)}.`,
    };
  }
  const base =
    `${fromName} không nợ trực tiếp ${toName} số này. ` +
    `Phần còn lại sau khi đã trả đúng người chi, chuyển cho ${toName} để cả nhóm về 0.`;
  const beyondDirect =
    transfer.directDebt > 0
      ? ` Phần bù chỉ là phần vượt quá khoản nợ trực tiếp ${formatVnd(transfer.directDebt)}.`
      : "";
  return { badge: "Bù trừ", sentence: `${base}${beyondDirect}` };
}
