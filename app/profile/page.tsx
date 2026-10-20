"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { BankLogo } from "@/components/BankPicker";
import { Icon, IconButton } from "@/components/Icon";
import { ProfileBankForm } from "@/components/ProfileBankForm";
import { api } from "@/lib/api-client";
import type { User } from "@/lib/types";
import { bankByBin } from "@/lib/vietqr";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * The caller's own profile: who they are, and the ONE receiving account the whole app uses for
 * them. A group member's `bank` is derived from this row, so saving here updates every QR the
 * other members can scan — and because the write has no id parameter, nobody else can change it.
 */
export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ user: User }>("/api/auth/me");
      setUser(data.user);
      setLoadError(null);
    } catch (e) {
      setLoadError(message(e, "Không tải được hồ sơ."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bankEntry = user?.bank ? bankByBin(user.bank.bin) : undefined;

  return (
    <main className="container stack">
      <div className="row row-between row-nowrap">
        <h1 className="row row-nowrap">
          <Icon name="user" size={26} />
          <span>Hồ sơ</span>
        </h1>
        <Link className="btn btn-ghost" href="/groups" prefetch={false}>
          <Icon name="arrowLeft" />
          <span>Về nhóm</span>
        </Link>
      </div>

      {loadError && <p className="error">{loadError}</p>}
      {notice && <p className="success">{notice}</p>}
      {!user && !loadError && <div className="spinner" role="status" aria-label="Đang tải" />}

      {user && (
        <>
          <section className="card stack">
            <div className="row row-between row-nowrap">
              <strong className="truncate" title={user.displayName}>
                {user.displayName}
              </strong>
            </div>
            <span className="meta">
              <Icon name="at" size={16} />
              <span className="truncate">{user.username}</span>
            </span>
          </section>

          <section className="card stack">
            <h2 className="row row-nowrap">
              <Icon name="bank" />
              <span>Tài khoản nhận tiền</span>
            </h2>
            <p className="muted">
              Tài khoản này dùng để tạo mã QR cho người khác quét khi trả tiền cho bạn. Chỉ bạn
              thay đổi được, thành viên khác chỉ xem.
            </p>

            {user.bank && (
              <span className="meta">
                <Icon name="check" size={16} />
                <BankLogo entry={bankEntry ?? null} size={24} />
                <span>{bankEntry ? bankEntry.shortName : `BIN ${user.bank.bin}`}</span>
                <span className="account-no">{user.bank.accountNo}</span>
                <span className="truncate">{user.bank.accountName}</span>
              </span>
            )}

            {user.role === "admin" ? (
              <p className="muted">Tài khoản quản trị không dùng tài khoản nhận tiền.</p>
            ) : (
              <ProfileBankForm
                // A saved profile replaces the form's initial state, so a clear/save round-trip
                // starts from what the server just stored.
                key={user.bank ? "has-bank" : "no-bank"}
                initial={user.bank}
                onSaved={(savedUser, outcome) => {
                  setUser(savedUser);
                  setNotice(
                    outcome === "cleared"
                      ? "Đã xóa tài khoản nhận tiền."
                      : "Đã lưu tài khoản nhận tiền.",
                  );
                }}
              />
            )}
          </section>

          <p className="meta">
            <Icon name="info" size={16} />
            <span className="grow">
              Bạn thêm nhóm bằng tên thì người đó chưa có tài khoản trong ứng dụng, nên chưa có mã QR.
            </span>
          </p>
        </>
      )}
    </main>
  );
}
