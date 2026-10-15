"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { AdminUser, AdminUserRef } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

interface ResetResult {
  user: AdminUserRef;
  password: string;
  generated: boolean;
}

type Dialog = { kind: "reset" | "ban"; user: AdminUser };

interface Props {
  onForbidden: () => void;
}

/** Accounts: re-issue a password, ban and unban. */
export function UsersPanel({ onForbidden }: Props) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (fresh = false) => {
      try {
        const data = await api<{ users: AdminUser[] }>("/api/admin/users", { fresh });
        setUsers(data.users);
        setError(null);
      } catch (e) {
        if (e instanceof Error && "code" in e && e.code === "FORBIDDEN") {
          onForbidden();
          return;
        }
        setError(message(e, "Không tải được danh sách tài khoản."));
      }
    },
    [onForbidden],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    if (!users || needle === "") {
      return users ?? [];
    }
    return users.filter(
      (u) =>
        u.username.toLocaleLowerCase("vi").includes(needle) ||
        u.displayName.toLocaleLowerCase("vi").includes(needle),
    );
  }, [users, query]);

  function open(kind: Dialog["kind"], user: AdminUser): void {
    setDialog({ kind, user });
    setText("");
    setResult(null);
    setCopied(false);
    setError(null);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!dialog) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (dialog.kind === "reset") {
        const data = await api<ResetResult>(`/api/admin/users/${dialog.user.id}/reset-password`, {
          method: "POST",
          body: text === "" ? {} : { password: text },
        });
        setResult(data);
      } else {
        await api(`/api/admin/users/${dialog.user.id}/ban`, { method: "POST", body: { reason: text } });
        await load(true);
      }
      setDialog(null);
      setText("");
    } catch (e) {
      setError(message(e, "Thao tác thất bại."));
    } finally {
      setBusy(false);
    }
  }

  async function unban(user: AdminUser): Promise<void> {
    setError(null);
    try {
      await api(`/api/admin/users/${user.id}/unban`, { method: "POST", body: {} });
      await load(true);
    } catch (e) {
      setError(message(e, "Không mở khóa được tài khoản."));
    }
  }

  async function copyPassword(password: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Không sao chép được, hãy chép thủ công.");
    }
  }

  return (
    <section className="stack">
      <p className="muted">
        Cấp lại mật khẩu hoặc khóa tài khoản. Mật khẩu mới chỉ hiện một lần, hãy gửi cho họ qua kênh
        riêng. Cả hai thao tác đều đăng xuất mọi phiên đang mở của họ.
      </p>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="card stack" role="status">
          <strong className="row row-nowrap">
            <Icon name="check" />
            <span>
              Đã cấp lại mật khẩu cho {result.user.displayName} (@{result.user.username})
            </span>
          </strong>
          <div className="row row-between row-nowrap">
            <code style={{ fontSize: "1.25rem", letterSpacing: "0.05em", wordBreak: "break-all" }}>
              {result.password}
            </code>
            <IconButton
              icon={copied ? "check" : "copy"}
              label={copied ? "Đã chép" : "Sao chép"}
              showLabel
              onClick={() => void copyPassword(result.password)}
            />
          </div>
          <p className="muted">
            {result.generated ? "Mật khẩu được tạo ngẫu nhiên. " : ""}
            Sẽ không hiển thị lại sau khi bạn đóng thông báo này.
          </p>
          <div className="row">
            <IconButton icon="x" label="Đóng" showLabel onClick={() => setResult(null)} />
          </div>
        </div>
      )}

      {dialog && (
        <form className="card stack" onSubmit={submit}>
          <strong className="row row-nowrap">
            <Icon name={dialog.kind === "reset" ? "lock" : "ban"} />
            <span>
              {dialog.kind === "reset" ? "Cấp lại mật khẩu cho" : "Khóa tài khoản"}{" "}
              {dialog.user.displayName} (@{dialog.user.username})
            </span>
          </strong>
          <label className="label" htmlFor="dialog-text">
            {dialog.kind === "reset" ? "Mật khẩu mới (để trống để tạo ngẫu nhiên)" : "Lý do (không bắt buộc)"}
          </label>
          <div className="field">
            <Icon name={dialog.kind === "reset" ? "lock" : "note"} />
            <input
              id="dialog-text"
              className="input"
              autoComplete="off"
              minLength={dialog.kind === "reset" && text !== "" ? 6 : undefined}
              maxLength={dialog.kind === "reset" ? 128 : 200}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={dialog.kind === "reset" ? "Ít nhất 6 ký tự" : "Ví dụ: spam, đăng ký hàng loạt"}
            />
          </div>
          <div className="row row-between">
            <IconButton icon="x" label="Hủy" showLabel onClick={() => setDialog(null)} />
            <button
              className={dialog.kind === "ban" ? "btn btn-danger" : "btn btn-primary"}
              type="submit"
              disabled={busy}
            >
              <Icon name={dialog.kind === "reset" ? "key" : "ban"} />
              <span>
                {busy ? "Đang xử lý…" : dialog.kind === "reset" ? "Cấp lại mật khẩu" : "Khóa tài khoản"}
              </span>
            </button>
          </div>
        </form>
      )}

      <div className="row row-nowrap">
        <div className="field">
          <Icon name="user" />
          <input
            className="input"
            placeholder="Tìm theo tên hoặc tên đăng nhập"
            aria-label="Tìm tài khoản"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={() => void load(true)} />
      </div>

      {!users && !error && <div className="spinner" role="status" aria-label="Đang tải" />}
      {users && visible.length === 0 && <p className="empty">Không có tài khoản nào.</p>}

      {visible.length > 0 && (
        <div className="card stack">
          {visible.map((user) => (
            <div key={user.id} className="stack">
              <div className="row row-between row-nowrap">
                <span className="grow">
                  <strong className="truncate">{user.displayName}</strong>
                  <span className="muted"> @{user.username}</span>
                  <span className="meta">
                    <Icon name="clock" size={14} />
                    {formatDateTime(user.createdAt)}
                  </span>
                </span>
                <span className="row row-nowrap">
                  {user.bannedAt === null && (
                    <IconButton
                      icon="key"
                      label="Cấp lại"
                      aria-label={`Cấp lại mật khẩu cho ${user.displayName}`}
                      title="Cấp lại mật khẩu"
                      showLabel
                      onClick={() => open("reset", user)}
                    />
                  )}
                  {user.bannedAt === null ? (
                    <IconButton
                      icon="ban"
                      label="Khóa"
                      aria-label={`Khóa tài khoản ${user.displayName}`}
                      title="Khóa tài khoản"
                      variant="danger"
                      showLabel
                      onClick={() => open("ban", user)}
                    />
                  ) : (
                    <IconButton
                      icon="check"
                      label="Mở khóa"
                      aria-label={`Mở khóa tài khoản ${user.displayName}`}
                      title="Mở khóa tài khoản"
                      showLabel
                      onClick={() => void unban(user)}
                    />
                  )}
                </span>
              </div>
              {(user.bannedAt !== null || user.recentAbuse > 0) && (
                <div className="row">
                  {user.bannedAt !== null && (
                    <span className="badge">
                      <Icon name="ban" size={12} /> Đã khóa {formatDateTime(user.bannedAt)}
                      {user.banReason ? `: ${user.banReason}` : ""}
                    </span>
                  )}
                  {user.recentAbuse > 0 && (
                    <span className="badge">
                      <Icon name="info" size={12} /> Spam 24 giờ qua: {user.recentAbuse}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
