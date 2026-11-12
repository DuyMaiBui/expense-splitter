"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { SettleBalances } from "@/components/SettleBalances";
import { type LedgerState } from "@/components/MemberLedgerPanel";
import { PaymentQrDialog } from "@/components/PaymentQrDialog";
import { api, invalidateApiCache } from "@/lib/api-client";
import { formatVnd } from "@/lib/format";
import type { Balance, Member, MemberLedger, Transfer, Viewer } from "@/lib/types";

interface Settlement {
  balances: Balance[];
  transfers: Transfer[];
  totalSpent: number;
  /** The caller relative to this group: the row button is shown only to the one who owes. */
  viewer: Viewer;
}

const LEDGER_ERROR = "Không tải được lịch sử giao dịch. Vui lòng thử lại.";

export default function SettlePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [data, setData] = useState<Settlement | null>(null);
  // Settlement names the parties but carries no bank info, so the members ride along (the
  // same URL the nav bar already asked for, so it is served from the client cache).
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The row the dialog is open for. Recording the payment happens inside that dialog now, so
  // there is no "start at the confirm step" variant to carry alongside it.
  const [selected, setSelected] = useState<Transfer | null>(null);
  // Per-member ledgers: fetched the first time a row opens, then kept until a refresh or payment.
  const [ledgers, setLedgers] = useState<Record<string, LedgerState>>({});
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  // Bumped whenever the cache is cleared, so a response still in flight from before is dropped.
  const ledgerEpoch = useRef(0);

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

  const loadLedger = useCallback(
    async (memberId: string) => {
      const epoch = ledgerEpoch.current;
      setLedgers((prev) => ({ ...prev, [memberId]: { status: "loading" } }));
      try {
        const { ledger } = await api<{ ledger: MemberLedger }>(
          `/api/groups/${groupId}/members/${memberId}/ledger`,
        );
        if (epoch === ledgerEpoch.current) {
          setLedgers((prev) => ({ ...prev, [memberId]: { status: "ready", ledger } }));
        }
      } catch {
        if (epoch === ledgerEpoch.current) {
          setLedgers((prev) => ({ ...prev, [memberId]: { status: "error", message: LEDGER_ERROR } }));
        }
      }
    },
    [groupId],
  );

  // Fetch each open row's ledger exactly once: a missing entry is the only trigger, and the
  // "loading" entry written by loadLedger stops a second request for the same member.
  useEffect(() => {
    for (const memberId of openIds) {
      if (ledgers[memberId] === undefined) {
        void loadLedger(memberId);
      }
    }
  }, [openIds, ledgers, loadLedger]);

  function toggleLedger(memberId: string): void {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }

  function resetLedgers(): void {
    ledgerEpoch.current += 1;
    setLedgers({});
  }

  const nameOf = (id: string) => data?.balances.find((b) => b.memberId === id)?.name ?? "?";
  const memberOf = (id: string) => members?.find((m) => m.id === id) ?? null;

  const payer = selected ? memberOf(selected.fromMemberId) : null;
  const receiver = selected ? memberOf(selected.toMemberId) : null;

  function handlePaid(report: string): void {
    setSelected(null);
    setNotice(report);
    setError(null);
    resetLedgers();
    void load(true);
  }

  // The refresh button also drops the client-side ledger copies, so open rows re-read them.
  function refresh(): void {
    invalidateApiCache(`/api/groups/${groupId}/members/`);
    resetLedgers();
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
        <>
          <section className="card stack">
            <h2 className="row row-nowrap">
              <Icon name="handshake" />
              <span>Ai trả ai</span>
            </h2>
            {data.transfers.length === 0 ? (
              <p className="empty">Mọi người đã huề, không ai nợ ai.</p>
            ) : (
              data.transfers.map((t) => {
                // Only the member who has to transfer gets the button; everyone else reads the
                // row alone.
                const debtor = data.viewer.memberId === t.fromMemberId;
                return (
                  <div key={`${t.fromMemberId}-${t.toMemberId}`} className="stack transfer-row">
                    <div className="row row-between row-nowrap">
                      <span className="row row-nowrap grow">
                        <strong className="truncate">{nameOf(t.fromMemberId)}</strong>
                        <Icon name="arrowRight" size={18} />
                        <strong className="truncate">{nameOf(t.toMemberId)}</strong>
                      </span>
                      <strong className="amount">{formatVnd(t.amount)}</strong>
                    </div>
                    {/* Only the person who owes the money gets a button: the QR and the payment
                        confirmation both live in the dialog, in the order they do them. */}
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

          <SettleBalances
            balances={data.balances}
            openIds={openIds}
            ledgers={ledgers}
            onToggle={toggleLedger}
            onRetry={(memberId) => void loadLedger(memberId)}
          />
        </>
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
