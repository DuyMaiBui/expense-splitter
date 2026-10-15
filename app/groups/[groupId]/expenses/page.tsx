"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import { formatDateTime, formatVnd } from "@/lib/format";
import type { Expense, Group, Member } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function ExpensesPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, group] = await Promise.all([
        api<{ expenses: Expense[] }>(`/api/groups/${groupId}/expenses`),
        api<{ group: Group; members: Member[] }>(`/api/groups/${groupId}`),
      ]);
      setExpenses(list.expenses);
      setMembers(group.members);
      setLoadError(null);
    } catch (e) {
      setLoadError(message(e, "Không tải được danh sách chi tiêu."));
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";

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

  const total = expenses?.reduce((sum, e) => sum + e.amount, 0) ?? 0;

  return (
    <main className="container stack">
      <div className="row row-between">
        <h1>Chi tiêu</h1>
        <Link className="btn btn-primary" href={`/groups/${groupId}/expenses/new`}>
          + Thêm chi tiêu
        </Link>
      </div>

      {loadError && <p className="error">{loadError}</p>}
      {actionError && <p className="error">{actionError}</p>}
      {!expenses && !loadError && <p className="muted">Đang tải…</p>}
      {expenses && expenses.length === 0 && <p className="empty">Chưa có chi tiêu nào.</p>}

      {expenses && expenses.length > 0 && (
        <>
          <p className="muted">
            {expenses.length} khoản · tổng <strong>{formatVnd(total)}</strong>
          </p>
          <div className="stack">
            {expenses.map((expense) => (
              <div key={expense.id} className="card stack">
                <div className="row row-between">
                  <strong>{expense.title}</strong>
                  <strong>{formatVnd(expense.amount)}</strong>
                </div>
                <div className="muted">
                  {formatDateTime(expense.spentAt)} · {nameOf(expense.paidByMemberId)} trả
                </div>
                <div className="muted">
                  Chia cho:{" "}
                  {expense.shares
                    .map((s) => `${nameOf(s.memberId)} (${formatVnd(s.amount)})`)
                    .join(", ")}
                </div>
                {expense.note && <div>{expense.note}</div>}
                <div className="row">
                  <Link className="btn" href={`/groups/${groupId}/expenses/${expense.id}/edit`}>
                    Sửa
                  </Link>
                  <button className="btn btn-danger" type="button" onClick={() => handleDelete(expense)}>
                    Xóa
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
