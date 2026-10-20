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
  // A settlement transfer is stored as an ordinary paid/share row (kind "payment"), so counting it
  // here would report money that moved between two members as money the group spent. The list
  // below still shows those rows with their "Thanh toán" badge; only this total and its count
  // leave them out, so the two figures describe the same set.
  const spending = expenses?.filter((e) => e.kind !== "payment") ?? null;
  const total = spending?.reduce((sum, e) => sum + e.amount, 0) ?? 0;

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
          {expenses.map((expense) => (
            <div key={expense.id} className="card stack">
              <div className="row row-between row-nowrap">
                <span className="row row-nowrap grow">
                  <strong className="truncate">{expense.title}</strong>
                  {/* A settlement transfer is stored as an ordinary paid/share row; the badge
                      keeps it from reading as a shared cost. */}
                  {expense.kind === "payment" && <span className="badge">Thanh toán</span>}
                </span>
                <strong className="amount">{formatVnd(expense.amount)}</strong>
              </div>
              <div className="meta">
                <Icon name="clock" size={16} />
                {formatDateTime(expense.spentAt)}
              </div>
              <div className="meta">
                <Icon name="wallet" size={16} />
                {nameOf(expense.paidByMemberId)} trả
              </div>
              <div className="meta">
                <Icon name="users" size={16} />
                Chia cho: {expense.shares.map((s) => `${nameOf(s.memberId)} ${formatVnd(s.amount)}`).join(" · ")}
              </div>
              {expense.note && (
                <div className="meta">
                  <Icon name="note" size={16} />
                  {expense.note}
                </div>
              )}
              <div className="row">
                <Link className="btn" href={`/groups/${groupId}/expenses/${expense.id}/edit`} prefetch={false}>
                  <Icon name="pencil" />
                  <span>Sửa</span>
                </Link>
                <IconButton
                  icon="trash"
                  label="Xóa"
                  variant="danger"
                  showLabel
                  onClick={() => void handleDelete(expense)}
                />
              </div>
            </div>
          ))}
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
