"use client";

import { useId, useState } from "react";

import { Icon } from "@/components/Icon";
import { signedVnd } from "@/components/MemberLedgerPanel";
import { formatDateTime, formatVnd } from "@/lib/format";
import type { PairEvent, PairRemovedRevision, PairRevision, PairStatement } from "@/lib/types";

import {
  AFTER_PAYMENT_LEGEND,
  balanceSentence,
  isQuietStatement,
  netSentence,
  paymentWarning,
  revisionSentence,
} from "./pair-text";
import styles from "./PairStatementPanel.module.css";

/** One member's pair statements as the settle page holds them: fetched once, kept until a refresh. */
export type PairsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; statements: PairStatement[] };

interface PairStatementPanelProps {
  state: PairsState | undefined;
  onRetry: () => void;
}

/** Tone class for a signed change: green when the viewer gains, red when it drops. */
function toneClass(amount: number): string {
  if (amount > 0) {
    return "amount amount-pos";
  }
  if (amount < 0) {
    return "amount amount-neg";
  }
  return "amount";
}

/** A revision line: the sentence, plus the warning badge when the edit came after a payment. */
function RevisionLine({ revision }: { revision: PairRevision | PairRemovedRevision }) {
  const warning = paymentWarning(revision.afterLaterPayment);
  return (
    <div className={styles.revision}>
      <span>{revisionSentence(revision)}</span>
      {warning && <span className={styles.warning}>{warning}</span>}
    </div>
  );
}

function EventItem({ event, counterpartyName }: { event: PairEvent; counterpartyName: string }) {
  const kind = event.kind === "expense" ? "Chi tiêu" : "Thanh toán";
  return (
    <li className={styles.event}>
      <div className={styles.eventHead}>
        <time className="meta" dateTime={event.spentAt}>
          Ngày chi {formatDateTime(event.spentAt)}
        </time>
        <span className="badge">{kind}</span>
      </div>
      <strong className={styles.eventTitle}>{event.title}</strong>
      <span className="meta">
        Người chi: {event.paidByName} · ghi vào app {formatDateTime(event.createdAt)}
      </span>
      <dl className={styles.facts}>
        <div>
          <dt>Phần của bạn</dt>
          <dd>{formatVnd(event.memberShare)}</dd>
        </div>
        <div>
          <dt>Phần của {counterpartyName}</dt>
          <dd>{formatVnd(event.counterpartyShare)}</dd>
        </div>
        <div>
          <dt>Thay đổi</dt>
          <dd className={toneClass(event.delta)}>{signedVnd(event.delta)}</dd>
        </div>
        <div>
          <dt>Số dư sau dòng này</dt>
          <dd className={toneClass(event.runningNet)}>{signedVnd(event.runningNet)}</dd>
        </div>
      </dl>
      {event.revisions.map((revision) => (
        <RevisionLine key={`${revision.at}-${revision.action}`} revision={revision} />
      ))}
    </li>
  );
}

/** One counterparty: the net in plain words, expandable to the timeline and removed revisions. */
function PairCard({ statement }: { statement: PairStatement }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const revisionCount =
    statement.removedRevisions.length +
    statement.events.reduce((count, event) => count + event.revisions.length, 0);
  const netClass =
    statement.net > 0
      ? styles.netPositive
      : statement.net < 0
        ? styles.netNegative
        : styles.netEven;

  return (
    <section className={styles.card}>
      <button
        type="button"
        className={styles.cardHead}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.cardTitle}>
          <strong className={styles.name}>{statement.counterpartyName}</strong>
          {statement.removed && <span className="badge">đã xóa</span>}
          {revisionCount > 0 && (
            <span className={styles.count}>{revisionCount} lần sửa/xóa</span>
          )}
        </span>
        <span className={`${styles.net} ${netClass}`}>
          {netSentence(statement.counterpartyName, statement.net)}
        </span>
        <span className={open ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron}>
          <Icon name="chevronDown" size={18} />
        </span>
      </button>
      <div id={bodyId} className={styles.body} hidden={!open}>
        <ol className={styles.timeline}>
          {statement.events.map((event) => (
            <EventItem
              key={event.expenseId}
              event={event}
              counterpartyName={statement.counterpartyName}
            />
          ))}
        </ol>
        {statement.removedRevisions.length > 0 && (
          <section className={styles.removed}>
            <h4 className={styles.subheading}>Khoản đã xóa/sửa khỏi cặp này</h4>
            {statement.removedRevisions.map((revision) => (
              <div key={`${revision.expenseId}-${revision.at}`} className={styles.removedItem}>
                <strong className={styles.eventTitle}>{revision.title}</strong>
                <RevisionLine revision={revision} />
              </div>
            ))}
          </section>
        )}
      </div>
    </section>
  );
}

/**
 * The "Đối chiếu từng người" view of the member dialog: one sentence that answers why the viewer
 * is owed or owes, then a card per counterparty. Presentational: the page owns the fetch.
 */
export function PairStatementPanel({ state, onRetry }: PairStatementPanelProps) {
  if (state === undefined || state.status === "loading") {
    return (
      <div className={styles.panel}>
        <p className="meta" role="status">
          Đang tải đối chiếu…
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={styles.panel}>
        <p className="error" role="alert">
          {state.message}
        </p>
        <button type="button" className="btn" onClick={onRetry}>
          Thử lại
        </button>
      </div>
    );
  }

  const { statements } = state;
  if (statements.length === 0) {
    return (
      <div className={styles.panel}>
        <p className="empty">Chưa có khoản chi nào liên quan đến ai.</p>
      </div>
    );
  }

  const active = statements.filter((statement) => !isQuietStatement(statement));
  const quiet = statements.filter(isQuietStatement);

  return (
    <div className={styles.panel}>
      <p className={styles.summary}>{balanceSentence(statements)}</p>
      <p className={styles.legend}>{AFTER_PAYMENT_LEGEND}</p>

      {active.map((statement) => (
        <PairCard key={statement.counterpartyMemberId} statement={statement} />
      ))}

      {quiet.length > 0 && (
        <section className={styles.quiet}>
          <h3 className={styles.subheading}>Đã huề</h3>
          <ul className={styles.quietList}>
            {quiet.map((statement) => (
              <li key={statement.counterpartyMemberId}>{statement.counterpartyName}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
