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
        <span className="meta" title="Tổng chi tiêu của nhóm">
          <Icon name="coins" />
          <strong className="amount">{data ? formatVnd(data.totalSpent) : "…"}</strong>
        </span>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={() => void load(true)} />
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && <div className="spinner" role="status" aria-label="Đang tải" />}

      {data && (
        <>
          <section className="card stack" aria-label="Ai trả ai">
            {data.transfers.length === 0 ? (
              <p className="empty" aria-label="Mọi người đã huề, không ai nợ ai">
                <Icon name="handshake" size={40} />
              </p>
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

          <section className="card" aria-label="Chi tiết từng người">
            <table className="table">
              <thead>
                <tr>
                  <th title="Thành viên" aria-label="Thành viên">
                    <Icon name="user" size={18} />
                  </th>
                  <th title="Đã trả" aria-label="Đã trả">
                    <Icon name="wallet" size={18} />
                  </th>
                  <th title="Phải chịu" aria-label="Phải chịu">
                    <Icon name="receipt" size={18} />
                  </th>
                  <th title="Chênh lệch (dương: được nhận lại, âm: còn phải trả)" aria-label="Chênh lệch">
                    <Icon name="scale" size={18} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.balances.map((b) => (
                  <tr key={b.memberId}>
                    <td>
                      {b.name}
                      {b.removed && (
                        <span className="badge" title="Đã xóa khỏi nhóm" aria-label="Đã xóa khỏi nhóm">
                          <Icon name="userMinus" size={14} />
                        </span>
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
          </section>
        </>
      )}
    </main>
  );
}
