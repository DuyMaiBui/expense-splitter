/**
 * Pure arithmetic and wording for the per-person statistics table ("Thống kê từng người"). No
 * React, so the rows, the per-person transfer lines and the totals are unit-tested in isolation.
 * Every number goes through formatVnd, so the table and the rest of the app agree on the format.
 */

import { formatVnd } from "@/lib/format";
import type { Balance, Transfer } from "@/lib/types";

/** Whether a member is owed money, owes money, or is settled ("huề"). */
export type Standing = "owes" | "owed" | "even";

/**
 * One transfer as it touches one member. `pay` is money this member must send to the counterparty;
 * `receive` is money the counterparty must send to this member.
 */
export interface TransferLine {
  direction: "pay" | "receive";
  counterpartyId: string;
  counterpartyName: string;
  amount: number;
}

/** One table row: the four split figures from the balance, plus who this member pays or receives from. */
export interface StatRow {
  memberId: string;
  name: string;
  removed: boolean;
  standing: Standing;
  net: number;
  spentPaid: number;
  spentOwed: number;
  paymentsOut: number;
  paymentsIn: number;
  lines: TransferLine[];
}

/** The column sums under the table. Each field is the sum over every balance row. */
export interface StatTotals {
  spentPaid: number;
  spentOwed: number;
  paymentsOut: number;
  paymentsIn: number;
  net: number;
}

/** A VND amount as digits with "." thousands separators and no currency suffix: 47814 → "47.814". */
export function plainVnd(amount: number): string {
  return formatVnd(amount).replace(/đ$/u, "");
}

/** A signed change for a balance cell: "+84.000", "−47.814", or "0". */
export function signedPlain(amount: number): string {
  if (amount > 0) {
    return `+${plainVnd(amount)}`;
  }
  if (amount < 0) {
    return `−${plainVnd(-amount)}`;
  }
  return "0";
}

/** Whether a net position means the member is owed, owes, or is settled. */
export function standingOf(net: number): Standing {
  if (net > 0) {
    return "owed";
  }
  if (net < 0) {
    return "owes";
  }
  return "even";
}

/**
 * The transfers that touch one member, in the order the settlement lists them. A transfer the
 * member sends becomes `pay`; one the member receives becomes `receive`; any other is skipped.
 */
export function transferLinesFor(
  memberId: string,
  transfers: Transfer[],
  nameOf: (id: string) => string,
): TransferLine[] {
  const lines: TransferLine[] = [];
  for (const transfer of transfers) {
    if (transfer.fromMemberId === memberId) {
      lines.push({
        direction: "pay",
        counterpartyId: transfer.toMemberId,
        counterpartyName: nameOf(transfer.toMemberId),
        amount: transfer.amount,
      });
    } else if (transfer.toMemberId === memberId) {
      lines.push({
        direction: "receive",
        counterpartyId: transfer.fromMemberId,
        counterpartyName: nameOf(transfer.fromMemberId),
        amount: transfer.amount,
      });
    }
  }
  return lines;
}

/** The muted line under a balance: "trả mike 47.814 · trả trunkk 3.356", or "" when there are none. */
export function transferSummary(lines: TransferLine[]): string {
  return lines
    .map((line) =>
      line.direction === "pay"
        ? `trả ${line.counterpartyName} ${plainVnd(line.amount)}`
        : `nhận từ ${line.counterpartyName} ${plainVnd(line.amount)}`,
    )
    .join(" · ");
}

/** One row per balance, in the order the server sent them, each with its own transfer lines. */
export function statRowsOf(balances: Balance[], transfers: Transfer[]): StatRow[] {
  const names = new Map(balances.map((b) => [b.memberId, b.name]));
  const nameOf = (id: string) => names.get(id) ?? "?";

  return balances.map((b) => ({
    memberId: b.memberId,
    name: b.name,
    removed: b.removed,
    standing: standingOf(b.net),
    net: b.net,
    spentPaid: b.spentPaid,
    spentOwed: b.spentOwed,
    paymentsOut: b.paymentsOut,
    paymentsIn: b.paymentsIn,
    lines: transferLinesFor(b.memberId, transfers, nameOf),
  }));
}

/** Sums every balance's split, so the totals row sits under the rows it adds up. */
export function statTotalsOf(balances: Balance[]): StatTotals {
  return balances.reduce<StatTotals>(
    (total, b) => ({
      spentPaid: total.spentPaid + b.spentPaid,
      spentOwed: total.spentOwed + b.spentOwed,
      paymentsOut: total.paymentsOut + b.paymentsOut,
      paymentsIn: total.paymentsIn + b.paymentsIn,
      net: total.net + b.net,
    }),
    { spentPaid: 0, spentOwed: 0, paymentsOut: 0, paymentsIn: 0, net: 0 },
  );
}
