"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatDateTime, formatVnd } from "@/lib/format";
import { summarizeSplit } from "@/lib/split-label";
import type { Expense, Member } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

interface ExpenseList {
  expenses: Expense[];
  members: Member[];
  /** True when the server capped the list and older expenses exist. */
  hasMore: boolean;
}

export default function ExpensesPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [data, setData] = useState<ExpenseList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // One request returns expenses AND members, so the page costs a single Worker invocation.
  const load = useCallback(
    async (fresh = false) => {
      try {
        setData(await api<ExpenseList>(`/api/groups/${groupId}/expenses`, { fresh }));
        setLoadError(null);
      } catch (e) {
        setLoadError(message(e, "Không tải được danh sách chi tiêu."));
      }
    },
    [groupId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (id: string) => data?.members.find((m) => m.id === id)?.name ?? "?";

  async function handleDelete(expense: Expense): Promise<void> {
    if (!window.confirm(`Xóa chi tiêu "${expense.title}" (${formatVnd(expense.amount)})?`)) {
      return;
    }
    setActionError(null);
    try {
      await api(`/api/groups/${groupId}/expenses/${expense.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setActionError(message(e, "Không xóa được chi tiêu."));
    }
  }

  const expenses = data?.expenses ?? null;
  // A settlement transfer is stored as an ordinary paid/share row (kind "payment"), so counting it
  // here would report money that moved between two members as money the group spent. The list
  // below still shows those rows with their "Thanh toán" badge; only this total and its count
  // leave them out, so the two figures describe the same set.
  const spending = expenses?.filter((e) => e.kind !== "payment") ?? null;
  const total = spending?.reduce((sum, e) => sum + e.amount, 0) ?? 0;
  // Who would be "everyone" for an expense that splits across the whole group.
  const activeMemberIds =
    data?.members.filter((m) => m.removedAt === null).map((m) => m.id) ?? [];

  return (
    <main className="container stack has-fab">
      <div className="row row-between row-nowrap">
        <span className="meta">
          <Icon name="coins" />
          <span>Tổng</span>
          <strong className="amount">{formatVnd(total)}</strong>
          {spending && <span className="muted">· {spending.length}{data?.hasMore ? "+" : ""}</span>}
        </span>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={() => void load(true)} />
      </div>

      {loadError && <p className="error">{loadError}</p>}
      {actionError && <p className="error">{actionError}</p>}
      {!expenses && !loadError && <div className="spinner" role="status" aria-label="Đang tải" />}
      {expenses && expenses.length === 0 && (
        <p className="empty">Chưa có chi tiêu nào. Bấm "Thêm chi tiêu" để bắt đầu.</p>
      )}

      {expenses && expenses.length > 0 && (
        <div className="stack">
          {expenses.map((expense) => {
            // A settlement transfer is stored as an ordinary paid/share row; the badge keeps it
            // from reading as a shared cost, and its title is read as `payer → receiver` so the
            // "Thanh toán:" prefix is not printed twice.
            const isPayment = expense.kind === "payment";
            const split = summarizeSplit(expense.shares, nameOf, activeMemberIds);
            const payerName = nameOf(expense.paidByMemberId);
            const receiverName = expense.shares[0] ? nameOf(expense.shares[0].memberId) : "?";

            return (
              <div key={expense.id} className="card stack">
                <div className="row row-between row-nowrap">
                  <span className="row row-nowrap grow">
                    <strong className="truncate">
                      {isPayment ? `${payerName} → ${receiverName}` : expense.title}
                    </strong>
                    {isPayment && <span className="badge">Thanh toán</span>}
                  </span>
                  <strong className="amount">{formatVnd(expense.amount)}</strong>
                </div>

                {/* Payer and time share one line: three stacked meta lines cost a phone a card
                    that no longer fits on screen. For a transfer the payer is already in the
                    title, so only the time is left to say. */}
                <div className="meta">
                  <Icon name={isPayment ? "clock" : "wallet"} size={16} />
                  <span className="grow">
                    {isPayment
                      ? formatDateTime(expense.spentAt)
                      : `${payerName} trả · ${formatDateTime(expense.spentAt)}`}
                  </span>
                </div>

                {/* A payment has exactly one receiver, already named by the title. */}
                {!isPayment && (
                  <div className="meta">
                    <Icon name="users" size={16} />
                    <span className="grow">
                      {split.equal
                        ? split.everyone
                          ? "Chia đều cả nhóm"
                          : `Chia cho: ${split.names.join(", ")}`
                        : `Chia cho: ${split.entries
                            .map((entry) => `${entry.name} ${formatVnd(entry.amount)}`)
                            .join(" · ")}`}
                    </span>
                  </div>
                )}

                {expense.note && (
                  <div className="meta">
                    <Icon name="note" size={16} />
                    <span className="grow">{expense.note}</span>
                  </div>
                )}

                {/* Icon-only, right-aligned, 40px targets; the accessible name carries the row. */}
                <div className="row card-actions">
                  {!isPayment && (
                    <Link
                      className="btn btn-icon btn-ghost"
                      href={`/groups/${groupId}/expenses/${expense.id}/edit`}
                      prefetch={false}
                      aria-label={`Sửa ${expense.title}`}
                      title={`Sửa ${expense.title}`}
                    >
                      <Icon name="pencil" />
                    </Link>
                  )}
                  <IconButton
                    icon="trash"
                    label={isPayment ? "Xóa khoản thanh toán" : `Xóa ${expense.title}`}
                    variant="danger"
                    onClick={() => void handleDelete(expense)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data?.hasMore && (
        <p className="meta">
          <Icon name="info" size={16} />
          Chỉ hiển thị {expenses?.length} khoản mới nhất.
        </p>
      )}

      <Link className="btn btn-primary fab" href={`/groups/${groupId}/expenses/new`} prefetch={false}>
        <Icon name="plus" size={22} />
        <span>Thêm chi tiêu</span>
      </Link>
    </main>
  );
}
