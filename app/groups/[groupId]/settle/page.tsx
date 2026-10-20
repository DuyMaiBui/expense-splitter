"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { PaymentQrDialog } from "@/components/PaymentQrDialog";
import { api } from "@/lib/api-client";
import { formatVnd } from "@/lib/format";
import type { Balance, Member, Transfer } from "@/lib/types";

interface Settlement {
  balances: Balance[];
  transfers: Transfer[];
  totalSpent: number;
}

export default function SettlePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [data, setData] = useState<Settlement | null>(null);
  // Settlement names the parties but carries no bank info, so the members ride along (the
  // same URL the nav bar already asked for, so it is served from the client cache).
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The row the dialog is open for, and whether it opened at the confirm step.
  const [selected, setSelected] = useState<{ transfer: Transfer; atConfirm: boolean } | null>(null);

  const load = useCallback(
    async (fresh = false) => {
      try {
        const [settlement, group] = await Promise.all([
          api<Settlement>(`/api/groups/${groupId}/settlement`, { fresh }),
          api<{ members: Member[] }>(`/api/groups/${groupId}`, { fresh }),
        ]);
        setData(settlement);
        setMembers(group.members);
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
  const memberOf = (id: string) => members?.find((m) => m.id === id) ?? null;

  const payer = selected ? memberOf(selected.transfer.fromMemberId) : null;
  const receiver = selected ? memberOf(selected.transfer.toMemberId) : null;

  function handlePaid(report: string): void {
    setSelected(null);
    setNotice(report);
    setError(null);
    void load(true);
  }

  function handleBankSaved(member: Member): void {
    setMembers((current) =>
      current ? current.map((m) => (m.id === member.id ? member : m)) : current,
    );
  }

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
      {notice && <p className="success">{notice}</p>}
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
                <div key={`${t.fromMemberId}-${t.toMemberId}`} className="stack transfer-row">
                  <div className="row row-between row-nowrap">
                    <span className="row row-nowrap grow">
                      <strong className="truncate">{nameOf(t.fromMemberId)}</strong>
                      <Icon name="arrowRight" size={18} />
                      <strong className="truncate">{nameOf(t.toMemberId)}</strong>
                    </span>
                    <strong className="amount">{formatVnd(t.amount)}</strong>
                  </div>
                  <div className="row row-nowrap">
                    <button
                      className="btn"
                      type="button"
                      disabled={members === null}
                      onClick={() => {
                        setSelected({ transfer: t, atConfirm: false });
                        setNotice(null);
                      }}
                    >
                      <Icon name="qr" />
                      <span>Tạo QR</span>
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={members === null}
                      onClick={() => {
                        setSelected({ transfer: t, atConfirm: true });
                        setNotice(null);
                      }}
                    >
                      <Icon name="check" />
                      <span>Đã thanh toán</span>
                    </button>
                  </div>
                </div>
              ))
            )}
            {data.transfers.length > 0 && (
              <p className="muted">
                "Tạo QR" mở mã chuyển khoản. "Đã thanh toán" hỏi lại một lần rồi ghi khoản vào nhóm;
                công nợ tự giảm theo.
              </p>
            )}
          </section>

          <section className="card stack">
            <h2 className="row row-nowrap">
              <Icon name="scale" />
              <span>Chi tiết từng người</span>
            </h2>
            {/* The net position is the answer a member opens this page for, so it is the figure
                they read first; paid/owed stay as a small line underneath. A 4-column table on a
                phone wrapped every amount and pushed the meaningful column off screen. */}
            {data.balances.length === 0 ? (
              <p className="empty">Nhóm chưa có ai.</p>
            ) : (
              data.balances.map((b) => (
                <div key={b.memberId} className="stack balance-row">
                  <div className="row row-between row-nowrap">
                    <span className="row row-nowrap grow">
                      <strong className="truncate" title={b.name}>
                        {b.name}
                      </strong>
                      {b.removed && <span className="badge">đã xóa</span>}
                    </span>
                    <strong
                      className={
                        b.net > 0 ? "amount amount-pos" : b.net < 0 ? "amount amount-neg" : "amount"
                      }
                    >
                      {b.net > 0
                        ? `+${formatVnd(b.net)} nhận lại`
                        : b.net < 0
                          ? `${formatVnd(b.net)} còn phải trả`
                          : "đã huề"}
                    </strong>
                  </div>
                  <span className="meta">
                    <Icon name="wallet" size={16} />
                    Đã trả {formatVnd(b.paid)} · Phải chịu {formatVnd(b.owed)}
                  </span>
                </div>
              ))
            )}
          </section>
        </>
      )}

      {selected && payer && receiver && (
        <PaymentQrDialog
          groupId={groupId}
          transfer={selected.transfer}
          payer={payer}
          receiver={receiver}
          startAtConfirm={selected.atConfirm}
          onClose={() => setSelected(null)}
          onBankSaved={handleBankSaved}
          onPaid={handlePaid}
        />
      )}
    </main>
  );
}
