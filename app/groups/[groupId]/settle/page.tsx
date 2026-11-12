"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { type LedgerState, type MemberView } from "@/components/MemberLedgerPanel";
import { PaymentQrDialog } from "@/components/PaymentQrDialog";
import { type PairsState } from "@/components/PairStatementPanel";
import { SettleBalances } from "@/components/SettleBalances";
import { transferExplanation } from "@/components/pair-text";
import { api, invalidateApiCache } from "@/lib/api-client";
import { formatVnd } from "@/lib/format";
import type {
  Balance,
  Member,
  MemberLedger,
  PairStatement,
  Transfer,
  Viewer,
} from "@/lib/types";

interface Settlement {
  balances: Balance[];
  transfers: Transfer[];
  totalSpent: number;
  /** The caller relative to this group: the row button is shown only to the one who owes. */
  viewer: Viewer;
}

const LEDGER_ERROR = "Không tải được lịch sử giao dịch. Vui lòng thử lại.";
const PAIRS_ERROR = "Không tải được đối chiếu. Vui lòng thử lại.";

/** The pairs endpoint wraps its list with the viewer, which this page does not read. */
interface PairsResponse {
  pairs: PairStatement[];
}

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
  // Per-member ledgers: fetched the first time a member's dialog opens, then kept until a refresh
  // or payment.
  const [ledgers, setLedgers] = useState<Record<string, LedgerState>>({});
  // The member whose dialog is open. One value, so only one dialog can be open.
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  // Which view that dialog shows: the per-row ledger, or the per-counterparty pair statement.
  const [dialogView, setDialogView] = useState<MemberView>("ledger");
  // Per-member pair statements, fetched the first time the pair view opens for that member.
  const [pairs, setPairs] = useState<Record<string, PairsState>>({});
  // Bumped whenever the caches are cleared, so a response still in flight from before is dropped.
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

  // Fetch the open member's ledger exactly once: a missing entry is the only trigger, and the
  // "loading" entry written by loadLedger stops a second request for the same member. After a
  // refresh or payment the cache is empty again, so the still-open member is re-read here.
  useEffect(() => {
    if (openMemberId !== null && dialogView === "ledger" && ledgers[openMemberId] === undefined) {
      void loadLedger(openMemberId);
    }
  }, [openMemberId, dialogView, ledgers, loadLedger]);

  const loadPairs = useCallback(
    async (memberId: string) => {
      const epoch = ledgerEpoch.current;
      setPairs((prev) => ({ ...prev, [memberId]: { status: "loading" } }));
      try {
        const { pairs: statements } = await api<PairsResponse>(
          `/api/groups/${groupId}/members/${memberId}/pairs`,
        );
        if (epoch === ledgerEpoch.current) {
          setPairs((prev) => ({
            ...prev,
            [memberId]: { status: "ready", statements },
          }));
        }
      } catch {
        if (epoch === ledgerEpoch.current) {
          setPairs((prev) => ({ ...prev, [memberId]: { status: "error", message: PAIRS_ERROR } }));
        }
      }
    },
    [groupId],
  );

  // Same once-per-member rule as the ledger, for the pair view.
  useEffect(() => {
    if (openMemberId !== null && dialogView === "pairs" && pairs[openMemberId] === undefined) {
      void loadPairs(openMemberId);
    }
  }, [openMemberId, dialogView, pairs, loadPairs]);

  // Opens one member's dialog on the given view. "Vì sao?" asks for the pair view directly.
  function openDialog(memberId: string, view: MemberView): void {
    setOpenMemberId(memberId);
    setDialogView(view);
  }

  function resetLedgers(): void {
    ledgerEpoch.current += 1;
    setLedgers({});
    setPairs({});
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
                const why = transferExplanation(t, nameOf(t.fromMemberId), nameOf(t.toMemberId));
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
                    <div className="row row-nowrap">
                      <span className="badge">{why.badge}</span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-haspopup="dialog"
                        onClick={() => openDialog(t.fromMemberId, "pairs")}
                      >
                        <span>Vì sao?</span>
                      </button>
                    </div>
                    <span className="meta">{why.sentence}</span>
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
            {data.transfers.length > 0 && (
              <p className="meta">
                <strong>Trả đúng người đã chi</strong>: trả thẳng cho người đã ứng tiền cho bạn.{" "}
                <strong>Bù trừ</strong>: không nợ trực tiếp người nhận, khoản này chỉ để cả nhóm về
                0.
              </p>
            )}
          </section>

          <SettleBalances
            balances={data.balances}
            openMemberId={openMemberId}
            openView={dialogView}
            ledgers={ledgers}
            pairs={pairs}
            onOpen={openDialog}
            onViewChange={setDialogView}
            onClose={() => setOpenMemberId(null)}
            onRetry={(memberId) => void loadLedger(memberId)}
            onRetryPairs={(memberId) => void loadPairs(memberId)}
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
