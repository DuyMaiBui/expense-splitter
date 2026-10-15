"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
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

  const load = useCallback(
    async (fresh = false) => {
      try {
        setData(await api<Settlement>(`/api/groups/${groupId}/settlement`, { fresh }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được dữ liệu tất toán.");
      }
    },
    [groupId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (id: string) => data?.balances.find((b) => b.memberId === id)?.name ?? "?";

  return (
    <main className="container stack">
      <div className="row row-between row-nowrap">
        <span className="meta">
          <Icon name="coins" />
          <span>Tổng chi tiêu</span>
          <strong className="amount">{data ? formatVnd(data.totalSpent) : "…"}</strong>
        </span>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={() => void load(true)} />
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && <div className="spinner" role="status" aria-label="Đang tải" />}

      {data && (
        <>
          <section className="card stack">
            <h2 className="row row-nowrap">
              <Icon name="handshake" />
              <span>Ai trả ai</span>
            </h2>
            {data.transfers.length === 0 ? (
              <p className="empty">Mọi người đã huề, không ai nợ ai.</p>
            ) : (
              data.transfers.map((t) => (
                <div key={`${t.fromMemberId}-${t.toMemberId}`} className="row row-between row-nowrap">
                  <span className="row row-nowrap grow">
                    <strong className="truncate">{nameOf(t.fromMemberId)}</strong>
                    <Icon name="arrowRight" size={18} />
                    <strong className="truncate">{nameOf(t.toMemberId)}</strong>
                  </span>
                  <strong className="amount">{formatVnd(t.amount)}</strong>
                </div>
              ))
            )}
          </section>

          <section className="card stack">
            <h2 className="row row-nowrap">
              <Icon name="scale" />
              <span>Chi tiết từng người</span>
            </h2>
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
                      {b.removed && (
                        <span className="badge">đã xóa</span>
                      )}
                    </td>
                    <td>{formatVnd(b.paid)}</td>
                    <td>{formatVnd(b.owed)}</td>
                    <td className={b.net > 0 ? "amount amount-pos" : b.net < 0 ? "amount amount-neg" : "amount"}>
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
