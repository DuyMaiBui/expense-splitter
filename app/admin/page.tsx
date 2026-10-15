"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api, ApiClientError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { AdminUser } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

interface ResetResult {
  user: AdminUser;
  password: string;
  generated: boolean;
}

/** The admin account's only screen: find a user and re-issue their password. */
export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [customPassword, setCustomPassword] = useState("");
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
        if (e instanceof ApiClientError && e.code === "FORBIDDEN") {
          router.replace("/groups"); // a normal account has nothing to do here
          return;
        }
        setError(message(e, "Không tải được danh sách tài khoản."));
      }
    },
    [router],
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

  function startReset(user: AdminUser): void {
    setResetting(user);
    setCustomPassword("");
    setResult(null);
    setCopied(false);
    setError(null);
  }

  async function handleReset(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!resetting) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api<ResetResult>(`/api/admin/users/${resetting.id}/reset-password`, {
        method: "POST",
        body: customPassword === "" ? {} : { password: customPassword },
      });
      setResult(data);
      setResetting(null);
      setCustomPassword("");
    } catch (e) {
      setError(message(e, "Không đặt lại được mật khẩu."));
    } finally {
      setBusy(false);
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
    <main className="container stack">
      <div className="row row-between row-nowrap">
        <h1 className="row row-nowrap">
          <Icon name="key" size={26} />
          <span>Quản trị tài khoản</span>
        </h1>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={() => void load(true)} />
      </div>
      <p className="muted">
        Chỉ dùng để cấp lại mật khẩu cho người dùng. Mật khẩu mới chỉ hiện một lần, hãy gửi cho họ
        qua kênh riêng. Mọi phiên đăng nhập cũ của họ sẽ bị đăng xuất.
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

      {resetting && (
        <form className="card stack" onSubmit={handleReset}>
          <strong className="row row-nowrap">
            <Icon name="lock" />
            <span>
              Cấp lại mật khẩu cho {resetting.displayName} (@{resetting.username})
            </span>
          </strong>
          <label className="label" htmlFor="new-password">
            Mật khẩu mới (để trống để tạo ngẫu nhiên)
          </label>
          <div className="field">
            <Icon name="lock" />
            <input
              id="new-password"
              className="input"
              autoComplete="off"
              minLength={6}
              maxLength={128}
              value={customPassword}
              onChange={(e) => setCustomPassword(e.target.value)}
              placeholder="Ít nhất 6 ký tự"
            />
          </div>
          <div className="row row-between">
            <IconButton icon="x" label="Hủy" showLabel onClick={() => setResetting(null)} />
            <button className="btn btn-primary" type="submit" disabled={busy}>
              <Icon name="key" />
              <span>{busy ? "Đang xử lý…" : "Cấp lại mật khẩu"}</span>
            </button>
          </div>
        </form>
      )}

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

      {!users && !error && <div className="spinner" role="status" aria-label="Đang tải" />}
      {users && visible.length === 0 && <p className="empty">Không có tài khoản nào.</p>}

      {visible.length > 0 && (
        <div className="card stack">
          {visible.map((user) => (
            <div key={user.id} className="row row-between row-nowrap">
              <span className="grow">
                <strong className="truncate">{user.displayName}</strong>
                <span className="muted"> @{user.username}</span>
                <span className="meta">
                  <Icon name="clock" size={14} />
                  {formatDateTime(user.createdAt)}
                </span>
              </span>
              <IconButton
                icon="key"
                label="Cấp lại"
                aria-label={`Cấp lại mật khẩu cho ${user.displayName}`}
                title="Cấp lại mật khẩu"
                showLabel
                onClick={() => startReset(user)}
              />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
