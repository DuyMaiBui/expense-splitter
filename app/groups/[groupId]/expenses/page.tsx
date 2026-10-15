"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatDateTime, formatVnd } from "@/lib/format";
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
  const total = expenses?.reduce((sum, e) => sum + e.amount, 0) ?? 0;

  return (
    <main className="container stack">
      <div className="row row-between row-nowrap">
        <span className="meta" title="Tổng chi tiêu">
          <Icon name="coins" />
          <strong className="amount">{formatVnd(total)}</strong>
          {expenses && <span className="muted">· {expenses.length}{data?.hasMore ? "+" : ""}</span>}
        </span>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={() => void load(true)} />
      </div>

      {loadError && <p className="error">{loadError}</p>}
      {actionError && <p className="error">{actionError}</p>}
      {!expenses && !loadError && <div className="spinner" role="status" aria-label="Đang tải" />}
      {expenses && expenses.length === 0 && (
        <p className="empty" aria-label="Chưa có chi tiêu nào">
          <Icon name="receipt" size={40} />
        </p>
      )}

      {expenses && expenses.length > 0 && (
        <div className="stack">
          {expenses.map((expense) => (
            <div key={expense.id} className="card stack">
              <div className="row row-between row-nowrap">
                <strong className="truncate">{expense.title}</strong>
                <strong className="amount">{formatVnd(expense.amount)}</strong>
              </div>
              <div className="meta">
                <Icon name="clock" size={16} />
                {formatDateTime(expense.spentAt)}
              </div>
              <div className="meta" title="Người trả">
                <Icon name="wallet" size={16} />
                {nameOf(expense.paidByMemberId)}
              </div>
              <div className="meta" title="Chia cho">
                <Icon name="users" size={16} />
                {expense.shares.map((s) => `${nameOf(s.memberId)} ${formatVnd(s.amount)}`).join(" · ")}
              </div>
              {expense.note && (
                <div className="meta">
                  <Icon name="note" size={16} />
                  {expense.note}
                </div>
              )}
              <div className="row">
                <Link
                  className="btn btn-icon"
                  href={`/groups/${groupId}/expenses/${expense.id}/edit`}
                  prefetch={false}
                  aria-label="Sửa chi tiêu"
                  title="Sửa chi tiêu"
                >
                  <Icon name="pencil" />
                </Link>
                <IconButton
                  icon="trash"
                  label="Xóa chi tiêu"
                  variant="danger"
                  onClick={() => void handleDelete(expense)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {data?.hasMore && (
        <p className="meta" title="Chỉ hiển thị các khoản mới nhất">
          <Icon name="info" size={16} />
          {expenses?.length}+
        </p>
      )}

      <Link
        className="fab"
        href={`/groups/${groupId}/expenses/new`}
        prefetch={false}
        aria-label="Thêm chi tiêu"
        title="Thêm chi tiêu"
      >
        <Icon name="plus" size={28} />
      </Link>
    </main>
  );
}
