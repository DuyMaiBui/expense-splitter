"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { IpBan, IpSuspect } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Duration choices; the value is hours, "" means until lifted by hand. */
const DURATIONS: { value: string; label: string }[] = [
  { value: "24", label: "24 giờ" },
  { value: "168", label: "7 ngày" },
  { value: "", label: "Vĩnh viễn" },
];

interface Props {
  onForbidden: () => void;
}

/** Addresses: active bans (manual and automatic), suspects, and a form to ban by hand. */
export function IpPanel({ onForbidden }: Props) {
  const [bans, setBans] = useState<IpBan[] | null>(null);
  const [suspects, setSuspects] = useState<IpSuspect[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (fresh = false) => {
      try {
        const data = await api<{ bans: IpBan[]; suspects: IpSuspect[] }>("/api/admin/ip-bans", { fresh });
        setBans(data.bans);
        setSuspects(data.suspects);
        setError(null);
      } catch (e) {
        if (e instanceof Error && "code" in e && e.code === "FORBIDDEN") {
          onForbidden();
          return;
        }
        setError(message(e, "Không tải được danh sách IP."));
      }
    },
    [onForbidden],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function ban(address: string, why: string, duration: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/ip-bans", {
        method: "POST",
        body: {
          ip: address,
          reason: why,
          ...(duration === "" ? {} : { hours: Number(duration) }),
        },
      });
      setIp("");
      setReason("");
      await load(true);
    } catch (e) {
      setError(message(e, "Không chặn được địa chỉ IP."));
    } finally {
      setBusy(false);
    }
  }

  async function lift(address: string): Promise<void> {
    setError(null);
    try {
      await api(`/api/admin/ip-bans?ip=${encodeURIComponent(address)}`, { method: "DELETE" });
      await load(true);
    } catch (e) {
      setError(message(e, "Không bỏ chặn được địa chỉ IP."));
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    void ban(ip, reason, hours);
  }

  return (
    <section className="stack">
      <p className="muted">
        Địa chỉ bị chặn không dùng được API (kể cả đăng nhập). Hệ thống tự chặn 24 giờ khi từ 3 tài
        khoản khác nhau cùng một địa chỉ vượt giới hạn thao tác liên tiếp. Lưu ý: nhiều người có thể
        dùng chung một địa chỉ (cùng wifi, mạng di động), hãy kiểm tra trước khi chặn.
      </p>

      {error && <p className="error">{error}</p>}

      <form className="card stack" onSubmit={submit}>
        <strong className="row row-nowrap">
          <Icon name="ban" />
          <span>Chặn một địa chỉ IP</span>
        </strong>
        <div className="field">
          <Icon name="globe" />
          <input
            className="input"
            aria-label="Địa chỉ IP"
            placeholder="Ví dụ 203.0.113.7"
            autoComplete="off"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <Icon name="note" />
          <input
            className="input"
            aria-label="Lý do"
            placeholder="Lý do (không bắt buộc)"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="row row-between">
          <select
            className="input"
            aria-label="Thời hạn chặn"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          >
            {DURATIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <button className="btn btn-danger" type="submit" disabled={busy}>
            <Icon name="ban" />
            <span>Chặn</span>
          </button>
        </div>
      </form>

      <div className="row row-between">
        <strong className="row row-nowrap">
          <Icon name="shield" />
          <span>Đang bị chặn</span>
        </strong>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={() => void load(true)} />
      </div>

      {!bans && !error && <div className="spinner" role="status" aria-label="Đang tải" />}
      {bans && bans.length === 0 && <p className="empty">Không có địa chỉ nào đang bị chặn.</p>}
      {bans && bans.length > 0 && (
        <div className="card stack">
          {bans.map((b) => (
            <div key={b.ip} className="row row-between row-nowrap">
              <span className="grow">
                <strong className="truncate">{b.ip}</strong>
                <span className="muted"> {b.source === "auto" ? "(tự động)" : "(thủ công)"}</span>
                <span className="meta">
                  <Icon name="clock" size={14} />
                  {b.expiresAt === null ? "Vĩnh viễn" : `Hết hạn ${formatDateTime(b.expiresAt)}`}
                </span>
                <span className="muted">{b.reason}</span>
              </span>
              <IconButton
                icon="check"
                label="Bỏ chặn"
                aria-label={`Bỏ chặn ${b.ip}`}
                showLabel
                onClick={() => void lift(b.ip)}
              />
            </div>
          ))}
        </div>
      )}

      <strong className="row row-nowrap">
        <Icon name="info" />
        <span>Nghi vấn spam (24 giờ qua)</span>
      </strong>
      {suspects.length === 0 ? (
        <p className="empty">Chưa có địa chỉ nào bị ghi nhận spam.</p>
      ) : (
        <div className="card stack">
          {suspects.map((s) => (
            <div key={s.ip} className="row row-between row-nowrap">
              <span className="grow">
                <strong className="truncate">{s.ip}</strong>
                <span className="meta">
                  <Icon name="users" size={14} />
                  {s.accounts}
                  <Icon name="info" size={14} />
                  {s.events}
                  <Icon name="clock" size={14} />
                  {formatDateTime(s.lastAt)}
                </span>
              </span>
              <IconButton
                icon="ban"
                label="Chặn"
                aria-label={`Chặn ${s.ip}`}
                variant="danger"
                showLabel
                disabled={busy}
                onClick={() => void ban(s.ip, "Nghi vấn spam", "24")}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
