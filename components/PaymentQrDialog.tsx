"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { BankLogo } from "@/components/BankPicker";
import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatVnd } from "@/lib/format";
import { canRecordPayment } from "@/lib/permissions";
import type { Expense, Member, Transfer, Viewer } from "@/lib/types";
import { bankByBin, buildVietQrUrl, sanitizeTransferNote } from "@/lib/vietqr";

interface PaymentQrDialogProps {
  groupId: string;
  transfer: Transfer;
  /** The member who owes the money. */
  payer: Member;
  /** The member who receives it. */
  receiver: Member;
  /** The caller relative to this group: decides whether the payment can be recorded. */
  viewer: Viewer;
  /** Dismiss: the caller clears the selected transfer. */
  onClose: () => void;
  /** The payment was recorded: the caller reloads settlement, closes and reports it. */
  onPaid: (notice: string) => void;
}

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** The contract caps a title at 100 characters and names can be 50 each. */
function paymentTitle(payerName: string, receiverName: string): string {
  const full = `Thanh toán: ${payerName} → ${receiverName}`;
  return full.length <= 100 ? full : `${full.slice(0, 99)}…`;
}

/**
 * Why the receiver has no code — and who can do something about it.
 *
 * Bank info belongs to a user's own profile, so a friend added by name has none and cannot get
 * one; a linked account has simply not filled it in yet. Only the receiver themself can fix it.
 */
function missingBankNotice(receiver: Member, viewer: Viewer): string {
  if (receiver.id === viewer.memberId) {
    return "Bạn chưa cài tài khoản nhận tiền";
  }
  if (receiver.userId === null) {
    return `${receiver.name} không có tài khoản trong ứng dụng nên chưa tạo được mã QR`;
  }
  return `${receiver.name} chưa cài tài khoản nhận tiền, hãy nhờ họ cập nhật ở Hồ sơ`;
}

/**
 * One settlement transfer: show the receiver's VietQR code when their profile has one, then
 * record the payment after an explicit confirmation. Recording is the dialog's LAST step, not a
 * separate action on the row: scan, transfer, then confirm here. A payment row is an ordinary
 * payer/receiver split, so settlement drops that debt itself; it records a cash/other-channel
 * payment just as well, so a missing bank never blocks it.
 */
export function PaymentQrDialog({
  groupId,
  transfer,
  payer,
  receiver,
  viewer,
  onClose,
  onPaid,
}: PaymentQrDialogProps) {
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bank = receiver.bank;
  const bankEntry = bank ? bankByBin(bank.bin) : undefined;
  const note = sanitizeTransferNote(payer.name) || "Thanh toan";
  // buildVietQrUrl rejects an amount outside 1..1e12: an absurd settlement is shown without a
  // code rather than crashing the page during render.
  const qrUrl = (() => {
    if (!bank) {
      return null;
    }
    try {
      return buildVietQrUrl({
        bin: bank.bin,
        accountNo: bank.accountNo,
        accountName: bank.accountName,
        amount: transfer.amount,
        addInfo: note,
      });
    } catch {
      return null;
    }
  })();

  // The route refuses a recording by anyone but the two parties, the owner or the admin: say so
  // up front instead of failing after the scan.
  const mayRecord = canRecordPayment(viewer, payer.id, receiver.id);

  // A removed member cannot be part of a new expense, so the API would refuse the payment too.
  const blockReason =
    receiver.removedAt !== null
      ? `${receiver.name} đã rời nhóm nên chưa ghi nhận được khoản thanh toán trong ứng dụng.`
      : payer.removedAt !== null
        ? `${payer.name} đã rời nhóm nên chưa ghi nhận được khoản thanh toán trong ứng dụng.`
        : null;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !paying) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, paying]);

  // Focus moves into the dialog while it is open and returns to the row button after it
  // closes: a keyboard user is never left behind the backdrop.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  async function copyAccountNo(): Promise<void> {
    if (!bank) {
      return;
    }
    try {
      await navigator.clipboard.writeText(bank.accountNo);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Không sao chép được, hãy chép thủ công.");
    }
  }

  async function handlePay(): Promise<void> {
    setPaying(true);
    setError(null);
    try {
      await api<{ expense: Expense }>(`/api/groups/${groupId}/expenses`, {
        method: "POST",
        body: {
          title: paymentTitle(payer.name, receiver.name),
          amount: transfer.amount,
          paidByMemberId: payer.id,
          participantMemberIds: [receiver.id],
          kind: "payment",
        },
      });
      onPaid(
        `Đã ghi nhận thanh toán ${formatVnd(transfer.amount)} từ ${payer.name} cho ${receiver.name}.`,
      );
    } catch (e) {
      setError(message(e, "Không ghi nhận được thanh toán."));
      setConfirming(false);
      setPaying(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !paying && onClose()}>
      <div
        ref={panelRef}
        className="dialog stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="row row-between row-nowrap dialog-head">
          <h2 id={titleId} className="row row-nowrap">
            <Icon name="qr" />
            <span>Chuyển khoản</span>
          </h2>
          <IconButton icon="x" label="Đóng" variant="ghost" disabled={paying} onClick={onClose} />
        </div>

        <div className="stack dialog-head">
          <span className="row row-nowrap">
            <strong className="truncate">{payer.name}</strong>
            <Icon name="arrowRight" size={18} />
            <strong className="truncate">{receiver.name}</strong>
          </span>
          <strong className="amount dialog-amount">{formatVnd(transfer.amount)}</strong>
        </div>

        {/* Only this band scrolls, so the actions below never sit below the fold on a phone. */}
        <div className="stack dialog-body">
          {!bank ? (
            <div className="stack">
              <p className="muted">{missingBankNotice(receiver, viewer)}</p>
              {/* Only the receiver themself can add the account, and only on their profile. */}
              {receiver.id === viewer.memberId && (
                <Link className="btn btn-primary self-start" href="/profile" prefetch={false}>
                  <Icon name="bank" />
                  <span>Cài ở Hồ sơ</span>
                </Link>
              )}
            </div>
          ) : (
            <div className="stack">
              {qrUrl ? (
                <img
                  className="qr-image"
                  src={qrUrl}
                  alt={`Mã VietQR nhận ${formatVnd(transfer.amount)} cho ${receiver.name}`}
                  width={300}
                  height={300}
                />
              ) : (
                <p className="muted">
                  Số tiền này nằm ngoài giới hạn tạo mã QR, hãy chuyển khoản theo thông tin bên dưới.
                </p>
              )}

              <div className="stack">
                <span className="meta">
                  <BankLogo entry={bankEntry ?? null} size={20} />
                  <span>{bankEntry ? bankEntry.shortName : `Ngân hàng (BIN ${bank.bin})`}</span>
                </span>
                <div className="row row-between row-nowrap">
                  <span className="meta account-no-line">
                    <Icon name="wallet" size={16} />
                    <span className="account-no">{bank.accountNo}</span>
                  </span>
                  {/* Short visible label; the accessible name still says what is copied. */}
                  <button
                    type="button"
                    className="btn btn-ghost account-copy"
                    aria-label={copied ? "Đã sao chép số tài khoản" : "Sao chép số tài khoản"}
                    title={copied ? "Đã sao chép số tài khoản" : "Sao chép số tài khoản"}
                    onClick={() => void copyAccountNo()}
                  >
                    <Icon name={copied ? "check" : "copy"} />
                    <span>{copied ? "Đã sao chép" : "Sao chép"}</span>
                  </button>
                </div>
                <span className="meta">
                  <Icon name="user" size={16} />
                  <span>{bank.accountName}</span>
                </span>
                <span className="meta">
                  <Icon name="note" size={16} />
                  <span>Nội dung: {note}</span>
                </span>
                {bankEntry && <p className="muted">{bankEntry.name}</p>}
              </div>
            </div>
          )}
        </div>

        {error && <p className="error dialog-actions">{error}</p>}

        {blockReason ? (
          <p className="muted dialog-actions">{blockReason}</p>
        ) : !mayRecord ? (
          <p className="muted dialog-actions">
            Chỉ người trả, người nhận hoặc chủ nhóm ghi nhận được.
          </p>
        ) : confirming ? (
          <div className="stack dialog-actions">
            <p className="muted">
              Xác nhận bạn đã chuyển {formatVnd(transfer.amount)} cho {receiver.name}? Khoản này được
              ghi vào nhóm và trừ vào công nợ.
            </p>
            <div className="row row-between">
              <IconButton
                icon="x"
                label="Hủy"
                showLabel
                disabled={paying}
                onClick={() => setConfirming(false)}
              />
              <button className="btn btn-primary" type="button" disabled={paying} onClick={() => void handlePay()}>
                <Icon name="check" />
                <span>{paying ? "Đang lưu…" : "Xác nhận"}</span>
              </button>
            </div>
          </div>
        ) : (
          /* The primary action sits in the sticky footer under the QR: after the transfer, this
             IS the next step, and it stays reachable without scrolling the code back. */
          <div className="row row-between dialog-actions">
            <IconButton icon="x" label="Đóng" showLabel onClick={onClose} />
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => setConfirming(true)}
              title="Ghi nhận chuyển khoản hoặc trả tiền mặt"
            >
              <Icon name="check" />
              <span>Đã chuyển khoản xong</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
