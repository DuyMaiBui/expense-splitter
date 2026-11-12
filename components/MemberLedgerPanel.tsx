"use client";

import { useState } from "react";

import { MemberFlowChart } from "@/components/charts/MemberFlowChart";
import { WaterfallChart } from "@/components/charts/WaterfallChart";
import { formatDateTime, formatVnd } from "@/lib/format";
import { currentCycle, ledgerTotals } from "@/lib/ledger";
import type { Balance, LedgerEntry, LedgerTotals, MemberLedger } from "@/lib/types";

import styles from "./MemberLedgerPanel.module.css";

/** One member's ledger as the settle page holds it: fetched once, then kept until a refresh. */
export type LedgerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; ledger: MemberLedger };

type LedgerView = "cycle" | "all";

interface MemberLedgerPanelProps {
  /** DOM id, referenced by the row button's aria-controls. */
  id: string;
  /** The settlement row's balance: the flow chart is built from it, so it matches the headline. */
  balance: Balance;
  state: LedgerState | undefined;
  onRetry: () => void;
}

/** Signed VND for a change: "+120.000đ", "−50.000đ", or "0đ" with no sign. */
export function signedVnd(amount: number): string {
  if (amount > 0) {
    return `+${formatVnd(amount)}`;
  }
  if (amount < 0) {
    return `−${formatVnd(-amount)}`;
  }
  return formatVnd(0);
}

function kindLabel(entry: LedgerEntry): string {
  if (entry.kind === "expense") {
    return "Chi tiêu";
  }
  return entry.paid > 0 ? "Đã chuyển đi" : "Đã nhận về";
}

function toneClass(delta: number): string {
  if (delta > 0) {
    return "amount amount-pos";
  }
  if (delta < 0) {
    return "amount amount-neg";
  }
  return "amount";
}

/**
 * Everything one member spent and received, opened under their settlement row. The flow chart
 * always covers the whole history (it is the balance split); the waterfall and the list follow
 * the toggle: since the last "huề" (default) or the full history.
 *
 * Presentational: the page owns fetching and caching, and passes the loaded state down.
 */
export function MemberLedgerPanel({ id, balance, state, onRetry }: MemberLedgerPanelProps) {
  const [view, setView] = useState<LedgerView>("cycle");

  if (state === undefined || state.status === "loading") {
    return (
      <div id={id} className={styles.panel}>
        <p className="meta" role="status">
          Đang tải lịch sử…
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div id={id} className={styles.panel}>
        <p className="error" role="alert">
          {state.message}
        </p>
        <button type="button" className="btn" onClick={onRetry}>
          Thử lại
        </button>
      </div>
    );
  }

  const { ledger } = state;
  if (ledger.entries.length === 0) {
    return (
      <div id={id} className={styles.panel}>
        <p className="empty">Chưa có lần chi hoặc nhận nào.</p>
      </div>
    );
  }

  // The flow chart is the whole-history split, straight from the Balance the row already shows.
  const totals: LedgerTotals = {
    spentPaid: balance.spentPaid,
    spentOwed: balance.spentOwed,
    paymentsOut: balance.paymentsOut,
    paymentsIn: balance.paymentsIn,
    net: balance.net,
  };
  const isCycle = view === "cycle";
  const cycle = currentCycle(ledger.entries);
  const shown = isCycle ? cycle.entries : ledger.entries;
  // Computed from the entries on screen, so the figures always match the list below. Spending and
  // debt transfers stay in separate groups: they are never added together.
  const split = ledgerTotals(shown);
  // The entry just before the cycle is the last "huề" row. Its date is that row's own date, not
  // the moment the balance reached 0.
  const huePoint = cycle.startIndex > 0 ? ledger.entries[cycle.startIndex - 1] : undefined;

  let scopeLine = "Toàn bộ lịch sử từ đầu nhóm";
  if (isCycle) {
    scopeLine = huePoint
      ? `Tính từ sau lần huề trước đó (dòng ghi ngày ${formatDateTime(huePoint.spentAt)})`
      : "Tính từ đầu nhóm";
  }
  const chartTitle = isCycle
    ? "Diễn biến từ lần huề gần nhất"
    : "Diễn biến toàn bộ lịch sử";

  return (
    <div id={id} className={styles.panel}>
      <div className={styles.flow}>
        <h3 className={styles.heading}>Dòng tiền từ đầu nhóm</h3>
        <MemberFlowChart totals={totals} />
      </div>

      <div className={styles.segment} role="group" aria-label="Phạm vi lịch sử">
        <button type="button" aria-pressed={isCycle} onClick={() => setView("cycle")}>
          Từ lần huề gần nhất
        </button>
        <button type="button" aria-pressed={!isCycle} onClick={() => setView("all")}>
          Toàn bộ lịch sử
        </button>
      </div>

      {isCycle && cycle.settled ? (
        <p className="empty">Đã huề, chưa có lần chi hoặc nhận mới.</p>
      ) : (
        <>
          <p className={styles.scope}>{scopeLine}</p>
          <div className={styles.split}>
            <p className={styles.summary}>
              Chi tiêu: đã chi ứng trước {formatVnd(split.spentPaid)} · phần phải chịu{" "}
              {formatVnd(split.spentOwed)}
            </p>
            <p className={styles.summary}>
              Trả nợ: đã chuyển đi {formatVnd(split.paymentsOut)} · đã nhận về{" "}
              {formatVnd(split.paymentsIn)}
            </p>
            <p className={styles.summary}>
              Thay đổi số dư trong giai đoạn này: {signedVnd(split.net)}
            </p>
            <p className={styles.scope}>{shown.length} lần ghi nhận</p>
          </div>
          <WaterfallChart entries={shown} title={chartTitle} />
          <ol className={styles.list}>
            {shown.map((entry) => (
              <li key={entry.expenseId} className={styles.entry}>
                <div className={styles.entryHead}>
                  <time className="meta" dateTime={entry.spentAt}>
                    {formatDateTime(entry.spentAt)}
                  </time>
                  <span className="badge">{kindLabel(entry)}</span>
                </div>
                <strong className={styles.entryTitle}>{entry.title}</strong>
                {entry.kind === "payment" && entry.counterpartyName && (
                  <span className="meta">với {entry.counterpartyName}</span>
                )}
                <dl className={styles.facts}>
                  <div>
                    <dt>Đã chi</dt>
                    <dd>{formatVnd(entry.paid)}</dd>
                  </div>
                  <div>
                    <dt>Phần phải chịu</dt>
                    <dd>{formatVnd(entry.share)}</dd>
                  </div>
                  <div>
                    <dt>Thay đổi</dt>
                    <dd className={toneClass(entry.delta)}>{signedVnd(entry.delta)}</dd>
                  </div>
                  <div>
                    <dt>Số dư sau dòng này</dt>
                    <dd>
                      {signedVnd(entry.runningNet)}
                      {entry.settledAfter ? " · huề" : ""}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
