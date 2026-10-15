"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import { formatVnd } from "@/lib/format";
import type { Balance, Transfer } from "@/lib/types";

interface Settlement {
  balances: Balance[];
  transfers: Transfer[];
  totalSpent: number;
}

export default function SettlePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [data, setData] = useState<Settlement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Settlement>(`/api/groups/${groupId}/settlement`)
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Không tải được dữ liệu tất toán."),
      );
  }, [groupId]);

  const nameOf = (id: string) => data?.balances.find((b) => b.memberId === id)?.name ?? "?";

  return (
    <main className="container stack">
      <h1>Tất toán</h1>

      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Đang tải…</p>}

      {data && (
        <>
          <p className="muted">
            Tổng chi tiêu của nhóm: <strong>{formatVnd(data.totalSpent)}</strong>
          </p>

          <section className="card stack">
            <h2>Ai trả ai</h2>
            {data.transfers.length === 0 ? (
              <p className="empty">Mọi người đã huề, không ai nợ ai.</p>
            ) : (
              data.transfers.map((t) => (
                <div key={`${t.fromMemberId}-${t.toMemberId}`} className="row row-between">
                  <span>
                    <strong>{nameOf(t.fromMemberId)}</strong> trả{" "}
                    <strong>{nameOf(t.toMemberId)}</strong>
                  </span>
                  <strong>{formatVnd(t.amount)}</strong>
                </div>
              ))
            )}
          </section>

          <section className="card stack">
            <h2>Chi tiết từng người</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Thành viên</th>
                  <th>Đã trả</th>
                  <th>Phải chịu</th>
                  <th>Chênh lệch</th>
                </tr>
              </thead>
              <tbody>
                {data.balances.map((b) => (
                  <tr key={b.memberId}>
                    <td>
                      {b.name}
                      {b.removed && <span className="badge">đã xóa</span>}
                    </td>
                    <td>{formatVnd(b.paid)}</td>
                    <td>{formatVnd(b.owed)}</td>
                    <td
                      style={{
                        fontWeight: 600,
                        color: b.net > 0 ? "var(--success)" : b.net < 0 ? "var(--danger)" : undefined,
                      }}
                    >
                      {b.net > 0 ? "+" : ""}
                      {formatVnd(b.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">Số dương: được nhận lại. Số âm: còn phải trả.</p>
          </section>
        </>
      )}
    </main>
  );
}
