"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { AdminGroup } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

interface Props {
  onForbidden: () => void;
}

/** Groups: open any group to view and edit it, rename it, soft-delete and restore it. */
export function GroupsPanel({ onForbidden }: Props) {
  const [groups, setGroups] = useState<AdminGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminGroup | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (fresh = false) => {
      try {
        const data = await api<{ groups: AdminGroup[] }>("/api/admin/groups", { fresh });
        setGroups(data.groups);
        setError(null);
      } catch (e) {
        if (e instanceof Error && "code" in e && e.code === "FORBIDDEN") {
          onForbidden();
          return;
        }
        setError(message(e, "Không tải được danh sách nhóm."));
      }
    },
    [onForbidden],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function rename(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!editing) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/groups/${editing.id}`, { method: "PUT", body: { name } });
      setEditing(null);
      await load(true);
    } catch (e) {
      setError(message(e, "Không đổi được tên nhóm."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleDeleted(group: AdminGroup): Promise<void> {
    const deleting = group.deletedAt === null;
    if (
      deleting &&
      !window.confirm(`Xóa nhóm "${group.name}"? Thành viên sẽ không thấy nhóm nữa, bạn có thể khôi phục sau.`)
    ) {
      return;
    }
    setError(null);
    try {
      await api(`/api/admin/groups/${group.id}/${deleting ? "delete" : "restore"}`, {
        method: "POST",
        body: {},
      });
      await load(true);
    } catch (e) {
      setError(message(e, "Thao tác thất bại."));
    }
  }

  return (
    <section className="stack">
      <p className="muted">
        Mở một nhóm để xem và sửa dữ liệu (chi tiêu, thành viên, mục mẫu). Mọi thay đổi được ghi vào
        nhật ký của nhóm dưới tên &quot;Quản trị viên&quot;. Nhóm bị xóa chỉ bị ẩn và có thể khôi phục.
      </p>

      {error && <p className="error">{error}</p>}

      {editing && (
        <form className="card stack" onSubmit={rename}>
          <strong className="row row-nowrap">
            <Icon name="pencil" />
            <span>Đổi tên nhóm &quot;{editing.name}&quot;</span>
          </strong>
          <div className="field">
            <Icon name="users" />
            <input
              className="input"
              aria-label="Tên nhóm mới"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="row row-between">
            <IconButton icon="x" label="Hủy" showLabel onClick={() => setEditing(null)} />
            <button className="btn btn-primary" type="submit" disabled={busy}>
              <Icon name="check" />
              <span>Lưu tên</span>
            </button>
          </div>
        </form>
      )}

      <div className="row row-between">
        <span className="muted">{groups ? `${groups.length} nhóm` : ""}</span>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={() => void load(true)} />
      </div>

      {!groups && !error && <div className="spinner" role="status" aria-label="Đang tải" />}
      {groups && groups.length === 0 && <p className="empty">Chưa có nhóm nào.</p>}

      {groups && groups.length > 0 && (
        <div className="card stack">
          {groups.map((group) => (
            <div key={group.id} className="stack">
              <div className="row row-between row-nowrap">
                <span className="grow">
                  <strong className="truncate">{group.name}</strong>
                  <span className="meta">
                    <Icon name="users" size={14} />
                    {group.memberCount}
                    <Icon name="receipt" size={14} />
                    {group.expenseCount}
                    <Icon name="clock" size={14} />
                    {formatDateTime(group.createdAt)}
                  </span>
                </span>
                <span className="row row-nowrap">
                  <Link
                    className="btn"
                    href={`/groups/${group.id}/expenses`}
                    prefetch={false}
                    aria-label={`Mở nhóm ${group.name}`}
                    title="Mở nhóm"
                  >
                    <Icon name="arrowRight" />
                    <span>Mở</span>
                  </Link>
                  <IconButton
                    icon="pencil"
                    label="Đổi tên"
                    aria-label={`Đổi tên nhóm ${group.name}`}
                    onClick={() => {
                      setEditing(group);
                      setName(group.name);
                    }}
                  />
                  <IconButton
                    icon={group.deletedAt === null ? "trash" : "refresh"}
                    label={group.deletedAt === null ? "Xóa" : "Khôi phục"}
                    aria-label={`${group.deletedAt === null ? "Xóa" : "Khôi phục"} nhóm ${group.name}`}
                    variant={group.deletedAt === null ? "danger" : "default"}
                    showLabel={group.deletedAt !== null}
                    onClick={() => void toggleDeleted(group)}
                  />
                </span>
              </div>
              {group.deletedAt !== null && (
                <span className="badge">
                  <Icon name="trash" size={12} /> Đã xóa {formatDateTime(group.deletedAt)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
