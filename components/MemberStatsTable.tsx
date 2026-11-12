"use client";

import { useEffect, useRef, useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { type LedgerState, MemberLedgerPanel } from "@/components/MemberLedgerPanel";
import { Modal } from "@/components/Modal";
import {
  type StatRow,
  plainVnd,
  signedPlain,
  statRowsOf,
  statTotalsOf,
  transferSummary,
} from "@/components/settle-table";
import { api } from "@/lib/api-client";
import type { Balance, MemberLedger, Transfer } from "@/lib/types";

import styles from "./MemberStatsTable.module.css";

/** The settlement fields this table reads. The settle page also reads `viewer` from the same URL. */
export interface SettlementData {
  balances: Balance[];
  transfers: Transfer[];
  totalSpent: number;
}

const SETTLEMENT_ERROR = "Không tải được thống kê từng người.";
const LEDGER_ERROR = "Không tải được lịch sử giao dịch. Vui lòng thử lại.";

const WORD_FOR_STANDING = {
  owed: "nhận lại",
  owes: "còn phải trả",
  even: "đã huề",
} as const;

interface StatsTableViewProps {
  balances: Balance[];
  transfers: Transfer[];
  /** Marks the table as a statement. It renders no settlement control in either mode. */
  readOnly?: boolean;
  onOpen: (memberId: string) => void;
}

/**
 * The presentational table: one row per member with the four split figures, the person's own
 * transfer lines under the balance, and a totals row. Pure props in, markup out, so the server
 * render test can exercise it without a fetch.
 */
export function MemberStatsView({ balances, transfers, readOnly = false, onOpen }: StatsTableViewProps) {
  const rows = statRowsOf(balances, transfers);
  const totals = statTotalsOf(balances);

  return (
    <div className="stack" data-readonly={readOnly ? "true" : undefined}>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.name}>
                Tên
              </th>
              <th scope="col">Số dư</th>
              <th scope="col">Đã chi</th>
              <th scope="col">Phải chịu</th>
              <th scope="col">Đã chuyển</th>
              <th scope="col">Đã nhận</th>
              <th scope="col">Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <StatsRow key={row.memberId} row={row} onOpen={onOpen} />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={styles.name}>
                Cả nhóm
              </th>
              <td className={styles.balance}>0</td>
              <td>{plainVnd(totals.spentPaid)}</td>
              <td>{plainVnd(totals.spentOwed)}</td>
              <td>{plainVnd(totals.paymentsOut)}</td>
              <td>{plainVnd(totals.paymentsIn)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={styles.formula}>Số dư = (đã chi − phải chịu) + (đã chuyển − đã nhận).</p>
    </div>
  );
}

function StatsRow({ row, onOpen }: { row: StatRow; onOpen: (memberId: string) => void }) {
  const amountClass =
    row.standing === "owed"
      ? "amount amount-pos"
      : row.standing === "owes"
        ? "amount amount-neg"
        : "amount";
  const summary = transferSummary(row.lines);

  return (
    <tr>
      <th scope="row" className={styles.name}>
        <span className={styles.nameText} title={row.name}>
          {row.name}
        </span>
        {row.removed && <span className="badge">đã xóa</span>}
      </th>
      <td className={styles.balance}>
        <span className={amountClass}>{signedPlain(row.net)}</span>
        <span className={styles.standing}>{WORD_FOR_STANDING[row.standing]}</span>
        {summary && <span className={styles.lines}>{summary}</span>}
      </td>
      <td>{plainVnd(row.spentPaid)}</td>
      <td>{plainVnd(row.spentOwed)}</td>
      <td>{plainVnd(row.paymentsOut)}</td>
      <td>{plainVnd(row.paymentsIn)}</td>
      <td className={styles.detail}>
        <IconButton
          icon="receipt"
          label={`Chi tiết ${row.name}`}
          variant="ghost"
          aria-haspopup="dialog"
          onClick={() => onOpen(row.memberId)}
        />
      </td>
    </tr>
  );
}

interface MemberStatsTableProps {
  groupId: string;
  /**
   * Changing this value re-reads the settlement and clears the cached ledgers. The settle page
   * bumps it after a refresh or a payment; the stats page bumps it on its refresh button.
   */
  reloadKey?: number;
  /** The stats page passes true. The table never renders a settlement control in either mode. */
  readOnly?: boolean;
}

/**
 * "Thống kê từng người": the per-person table, used by the settle page and the stats page. It
 * fetches the settlement itself, reads each member's ledger lazily into one dialog, and caches
 * each ledger once per member until `reloadKey` changes.
 */
export function MemberStatsTable({ groupId, reloadKey = 0, readOnly = false }: MemberStatsTableProps) {
  const [data, setData] = useState<SettlementData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledgers, setLedgers] = useState<Record<string, LedgerState>>({});
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  // Bumped with every cache reset, so a ledger response still in flight from before is dropped.
  const ledgerEpoch = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // The first read may use the client cache; a bumped key asks for the server's current figures.
    api<SettlementData>(`/api/groups/${groupId}/settlement`, { fresh: reloadKey > 0 })
      .then((settlement) => {
        if (!cancelled) {
          setData(settlement);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : SETTLEMENT_ERROR);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, reloadKey]);

  // A new reloadKey drops every cached ledger; the still-open member is re-read by the effect below.
  useEffect(() => {
    ledgerEpoch.current += 1;
    setLedgers({});
  }, [groupId, reloadKey]);

  useEffect(() => {
    if (openMemberId === null || ledgers[openMemberId] !== undefined) {
      return;
    }
    const memberId = openMemberId;
    const epoch = ledgerEpoch.current;
    setLedgers((prev) => ({ ...prev, [memberId]: { status: "loading" } }));
    api<{ ledger: MemberLedger }>(`/api/groups/${groupId}/members/${memberId}/ledger`)
      .then(({ ledger }) => {
        if (epoch === ledgerEpoch.current) {
          setLedgers((prev) => ({ ...prev, [memberId]: { status: "ready", ledger } }));
        }
      })
      .catch(() => {
        if (epoch === ledgerEpoch.current) {
          setLedgers((prev) => ({ ...prev, [memberId]: { status: "error", message: LEDGER_ERROR } }));
        }
      });
  }, [groupId, openMemberId, ledgers]);

  function retryLedger(memberId: string): void {
    setLedgers((prev) => {
      const next = { ...prev };
      delete next[memberId];
      return next;
    });
  }

  const openBalance = data?.balances.find((b) => b.memberId === openMemberId);

  return (
    <section className="card stack">
      <h2 className="row row-nowrap">
        <Icon name="scale" />
        <span>Thống kê từng người</span>
      </h2>
      <p className="meta">Tính từ đầu nhóm. Đơn vị: đồng.</p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <div className="spinner" role="status" aria-label="Đang tải" />}

      {data && data.balances.length === 0 && <p className="empty">Nhóm chưa có ai.</p>}
      {data && data.balances.length > 0 && (
        <MemberStatsView
          balances={data.balances}
          transfers={data.transfers}
          readOnly={readOnly}
          onOpen={setOpenMemberId}
        />
      )}

      <Modal
        open={openBalance !== undefined}
        title={openBalance?.name ?? ""}
        subtitle="Từng lần chi và nhận"
        onClose={() => setOpenMemberId(null)}
      >
        {openBalance && (
          <MemberLedgerPanel
            balance={openBalance}
            state={ledgers[openBalance.memberId]}
            onRetry={() => retryLedger(openBalance.memberId)}
          />
        )}
      </Modal>
    </section>
  );
}
