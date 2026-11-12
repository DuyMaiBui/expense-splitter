import { Icon } from "@/components/Icon";
import {
  type LedgerState,
  type MemberView,
  MemberLedgerPanel,
  MemberViewToggle,
  signedVnd,
} from "@/components/MemberLedgerPanel";
import { Modal } from "@/components/Modal";
import { type PairsState, PairStatementPanel } from "@/components/PairStatementPanel";
import { formatVnd } from "@/lib/format";
import type { Balance, LedgerTotals } from "@/lib/types";

interface SettleBalancesProps {
  balances: Balance[];
  /** The member whose dialog is open, or null. At most one dialog is open at a time. */
  openMemberId: string | null;
  /** Which view the open dialog shows. The page sets it: "Vì sao?" opens the pair view. */
  openView: MemberView;
  /** Per-member ledger state held by the page; a missing entry means "not fetched yet". */
  ledgers: Readonly<Record<string, LedgerState>>;
  /** Per-member pair statements held by the page; a missing entry means "not fetched yet". */
  pairs: Readonly<Record<string, PairsState>>;
  onOpen: (memberId: string, view: MemberView) => void;
  onViewChange: (view: MemberView) => void;
  onClose: () => void;
  onRetry: (memberId: string) => void;
  onRetryPairs: (memberId: string) => void;
}

/** Sums every member's split, so the group-wide totals sit above the per-member rows. */
function groupTotalsOf(balances: Balance[]): LedgerTotals {
  return balances.reduce<LedgerTotals>(
    (total, b) => ({
      spentPaid: total.spentPaid + b.spentPaid,
      spentOwed: total.spentOwed + b.spentOwed,
      paymentsOut: total.paymentsOut + b.paymentsOut,
      paymentsIn: total.paymentsIn + b.paymentsIn,
      net: total.net + b.net,
    }),
    { spentPaid: 0, spentOwed: 0, paymentsOut: 0, paymentsIn: 0, net: 0 },
  );
}

/**
 * The "Chi tiết từng người" card: the group summary, then one row per member with the net,
 * the spending and debt-transfer split, and a button that opens that member's ledger in a dialog
 * over the page. The dialog is rendered once, here, so only one can be open.
 */
export function SettleBalances({
  balances,
  openMemberId,
  openView,
  ledgers,
  pairs,
  onOpen,
  onViewChange,
  onClose,
  onRetry,
  onRetryPairs,
}: SettleBalancesProps) {
  const group = groupTotalsOf(balances);
  const openBalance = balances.find((b) => b.memberId === openMemberId);

  return (
    <section className="card stack">
      <h2 className="row row-nowrap">
        <Icon name="scale" />
        <span>Chi tiết từng người</span>
      </h2>
      <p className="meta">Số dư = (đã chi − phải chịu) + (đã chuyển − đã nhận).</p>
      <div className="stack">
        <strong>Cả nhóm</strong>
        <div className="row row-between row-nowrap">
          <span className="meta">Tổng chi tiêu</span>
          <span className="amount">{formatVnd(group.spentPaid)}</span>
        </div>
        <div className="row row-between row-nowrap">
          <span className="meta">Tổng phần phải chịu</span>
          <span className="amount">{formatVnd(group.spentOwed)}</span>
        </div>
        <div className="row row-between row-nowrap">
          <span className="meta">Đã chuyển đi / đã nhận về</span>
          <span className="amount">
            {formatVnd(group.paymentsOut)} / {formatVnd(group.paymentsIn)}
          </span>
        </div>
        <div className="row row-between row-nowrap">
          <span className="meta">Tổng số dư (phải bằng 0)</span>
          <span className="amount">{signedVnd(group.net)}</span>
        </div>
      </div>
      {/* The net position is the answer a member opens this page for, so it is the figure they
          read first; the split lines stay as small text underneath. A 4-column table on a phone
          wrapped every amount and pushed the meaningful column off screen. */}
      {balances.length === 0 ? (
        <p className="empty">Nhóm chưa có ai.</p>
      ) : (
        balances.map((b) => {
          return (
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
                <span>
                  Chi tiêu: đã chi ứng trước {formatVnd(b.spentPaid)} · phần phải chịu{" "}
                  {formatVnd(b.spentOwed)}
                </span>
              </span>
              <span className="meta">
                <Icon name="swap" size={16} />
                <span>
                  Trả nợ: đã chuyển đi {formatVnd(b.paymentsOut)} · đã nhận về{" "}
                  {formatVnd(b.paymentsIn)}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                aria-haspopup="dialog"
                onClick={() => onOpen(b.memberId, "ledger")}
              >
                <Icon name="receipt" />
                <span>Xem từng lần chi/nhận</span>
              </button>
            </div>
          );
        })
      )}
      <Modal
        open={openBalance !== undefined}
        title={openBalance?.name ?? ""}
        subtitle={openView === "pairs" ? "Đối chiếu từng người" : "Từng lần chi và nhận"}
        onClose={onClose}
      >
        {openBalance && (
          <div className="stack">
            <MemberViewToggle view={openView} onChange={onViewChange} />
            {openView === "pairs" ? (
              <PairStatementPanel
                state={pairs[openBalance.memberId]}
                onRetry={() => onRetryPairs(openBalance.memberId)}
              />
            ) : (
              <MemberLedgerPanel
                balance={openBalance}
                state={ledgers[openBalance.memberId]}
                onRetry={() => onRetry(openBalance.memberId)}
              />
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
