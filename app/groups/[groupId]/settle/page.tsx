"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { MemberStatsTable, type SettlementData } from "@/components/MemberStatsTable";
import { PaymentQrDialog } from "@/components/PaymentQrDialog";
import { api, invalidateApiCache } from "@/lib/api-client";
import { formatVnd } from "@/lib/format";
import type { Member, Transfer, Viewer } from "@/lib/types";

/** The settlement as this page reads it: the table's fields plus the caller, for the payment button. */
interface SettlePageData extends SettlementData {
  viewer: Viewer;
}

/**
 * The settle page: the total, "Ai trả ai" with the payment button for whoever owes, and the
 * per-person statistics table. The table fetches and caches its own data; this page only bumps
 * `reloadKey` after a refresh or a payment so the table re-reads the server.
 */
export default function SettlePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [data, setData] = useState<SettlePageData | null>(null);
  // Settlement names the parties but carries no bank info, so the members ride along (the
  // same URL the nav bar already asked for, so it is served from the client cache).
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The row the payment dialog is open for.
  const [selected, setSelected] = useState<Transfer | null>(null);
  // Bumped after a refresh or a payment; the statistics table watches it and re-reads.
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(
    async (fresh = false) => {
      try {
        const [settlement, group] = await Promise.all([
          api<SettlePageData>(`/api/groups/${groupId}/settlement`, { fresh }),
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

  const payer = selected ? memberOf(selected.fromMemberId) : null;
  const receiver = selected ? memberOf(selected.toMemberId) : null;

  function handlePaid(report: string): void {
    setSelected(null);
    setNotice(report);
    setError(null);
    setReloadKey((key) => key + 1);
    void load(true);
  }

  // The refresh button also drops the client-side copies, so the table re-reads everything.
  function refresh(): void {
    invalidateApiCache(`/api/groups/${groupId}/members/`);
    setReloadKey((key) => key + 1);
    void load(true);
  }

  return (
    <main className="container stack">
      <div className="row row-between row-nowrap">
        <span className="meta">
          <Icon name="coins" />
          <span>Tổng chi tiêu</span>
          <strong className="amount">{data ? formatVnd(data.totalSpent) : "…"}</strong>
        </span>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={refresh} />
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}
      {!data && !error && <div className="spinner" role="status" aria-label="Đang tải" />}

      {data && (
        <section className="card stack">
          <h2 className="row row-nowrap">
            <Icon name="handshake" />
            <span>Ai trả ai</span>
          </h2>
          {data.transfers.length === 0 ? (
            <p className="empty">Mọi người đã huề, không ai nợ ai.</p>
          ) : (
            data.transfers.map((t) => {
              // Only the member who has to transfer gets the button.
              const debtor = data.viewer.memberId === t.fromMemberId;
              return (
                <div key={`${t.fromMemberId}-${t.toMemberId}`} className="row row-nowrap transfer-row">
                  <span className="row row-nowrap grow">
                    <strong className="truncate">{nameOf(t.fromMemberId)}</strong>
                    <Icon name="arrowRight" size={18} />
                    <strong className="truncate">{nameOf(t.toMemberId)}</strong>
                  </span>
                  <strong className="amount">{formatVnd(t.amount)}</strong>
                  {debtor && (
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={members === null}
                      onClick={() => {
                        setSelected(t);
                        setNotice(null);
                      }}
                    >
                      <Icon name="qr" />
                      <span>Thanh toán</span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </section>
      )}

      {data && (
        <MemberStatsTable groupId={groupId} reloadKey={reloadKey} />
      )}

      {selected && payer && receiver && data && (
        <PaymentQrDialog
          groupId={groupId}
          transfer={selected}
          payer={payer}
          receiver={receiver}
          onClose={() => setSelected(null)}
          onPaid={handlePaid}
        />
      )}

      <p className="meta">
        <Icon name="info" size={16} />
        <span className="grow">
          Người nhận chưa có mã QR thì vào <Link href="/profile" prefetch={false}>Hồ sơ</Link> để cài
          tài khoản nhận tiền.
        </span>
      </p>
    </main>
  );
}
