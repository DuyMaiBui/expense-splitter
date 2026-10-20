"use client";

import { useEffect, useId, useRef, useState } from "react";

import { BankInfoForm } from "@/components/BankInfoForm";
import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatVnd } from "@/lib/format";
import type { Expense, Member, Transfer } from "@/lib/types";
import { bankByBin, buildVietQrUrl, sanitizeTransferNote } from "@/lib/vietqr";

interface PaymentQrDialogProps {
  groupId: string;
  transfer: Transfer;
  /** The member who owes the money. */
  payer: Member;
  /** The member who receives it. */
  receiver: Member;
  /** Dismiss: the caller clears the selected transfer. */
  onClose: () => void;
  /** The receiver's account was just saved, so the caller's member list is stale. */
  onBankSaved: (member: Member) => void;
  /** The payment was recorded: the caller reloads settlement, closes and reports it. */
  onPaid: (notice: string) => void;
  /**
   * Open straight at the confirm step ("Đã thanh toán" on the row). The QR stays above it, so
   * the payer can still scan; without a bank account the dialog starts at the bank form.
   */
  startAtConfirm?: boolean;
}

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** The contract caps a title at 100 characters and names can be 50 each. */
function paymentTitle(payerName: string, receiverName: string): string {
  const full = `Thanh toán: ${payerName} → ${receiverName}`;
  return full.length <= 100 ? full : `${full.slice(0, 99)}…`;
}

/**
 * One settlement transfer: show the receiver's VietQR code, let the receiver's account be
 * filled in first when it is missing, then record the payment after an explicit confirmation.
 * A payment row is an ordinary payer/receiver split, so settlement drops that debt itself.
 */
export function PaymentQrDialog({
  groupId,
  transfer,
  payer,
  receiver,
  onClose,
  onBankSaved,
  onPaid,
  startAtConfirm = false,
}: PaymentQrDialogProps) {
  const titleId = useId();
  // The account can be filled in from here, so the receiver is local state from the start.
  const [payee, setPayee] = useState<Member>(receiver);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(startAtConfirm && receiver.bank !== null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bank = payee.bank;
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

  // A removed member cannot be part of a new expense, so the API would refuse the payment:
  // say so up front instead of failing after the scan.
  const blockReason =
    payee.removedAt !== null
      ? `${payee.name} đã rời nhóm nên chưa ghi nhận được khoản thanh toán trong ứng dụng.`
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

  function handleBankSaved(member: Member): void {
    setPayee(member);
    setError(null);
    onBankSaved(member);
  }

  async function handlePay(): Promise<void> {
    setPaying(true);
    setError(null);
    try {
      await api<{ expense: Expense }>(`/api/groups/${groupId}/expenses`, {
        method: "POST",
        body: {
          title: paymentTitle(payer.name, payee.name),
          amount: transfer.amount,
          paidByMemberId: payer.id,
          participantMemberIds: [payee.id],
          kind: "payment",
        },
      });
      onPaid(`Đã ghi nhận thanh toán ${formatVnd(transfer.amount)} từ ${payer.name} cho ${payee.name}.`);
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
            <strong className="truncate">{payee.name}</strong>
          </span>
          <strong className="amount dialog-amount">{formatVnd(transfer.amount)}</strong>
        </div>

        {/* Only this band scrolls, so the actions below never sit below the fold on a phone. */}
        <div className="stack dialog-body">
          {!bank ? (
            <div className="stack">
              <p className="muted">
                {payee.name} chưa có tài khoản nhận tiền. Điền thông tin ngân hàng để tạo mã QR.
              </p>
              {payee.removedAt === null ? (
                <BankInfoForm
                  groupId={groupId}
                  memberId={payee.id}
                  initial={null}
                  submitLabel="Lưu và tạo mã QR"
                  onSaved={handleBankSaved}
                />
              ) : (
                <p className="empty">Không thể thêm tài khoản cho thành viên đã rời nhóm.</p>
              )}
            </div>
          ) : (
            <div className="stack">
              {qrUrl && (
                <img
                  className="qr-image"
                  src={qrUrl}
                  alt={`Mã VietQR nhận ${formatVnd(transfer.amount)} cho ${payee.name}`}
                  width={300}
                  height={300}
                />
              )}

              <div className="stack">
                <span className="meta">
                  <Icon name="bank" size={16} />
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
        ) : confirming ? (
          <div className="stack dialog-actions">
            <p className="muted">
              Xác nhận bạn đã chuyển {formatVnd(transfer.amount)} cho {payee.name}? Khoản này được ghi
              vào nhóm và trừ vào công nợ.
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
          <div className="row row-between dialog-actions">
            <IconButton icon="x" label="Đóng" showLabel onClick={onClose} />
            <button
              className="btn btn-primary"
              type="button"
              disabled={!bank}
              title={bank ? undefined : "Cần tài khoản nhận tiền trước"}
              onClick={() => setConfirming(true)}
            >
              <Icon name="check" />
              <span>Đã thanh toán</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
