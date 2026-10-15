"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { api } from "@/lib/api-client";
import type { Group, Member } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function MembersPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<"name" | "username">("name");
  const [value, setValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ group: Group; members: Member[] }>(`/api/groups/${groupId}`);
      setGroup(data.group);
      setMembers(data.members);
      setLoadError(null);
    } catch (e) {
      setLoadError(message(e, "Không tải được thành viên."));
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      await api<{ member: Member }>(`/api/groups/${groupId}/members`, {
        method: "POST",
        body: mode === "name" ? { name: value } : { username: value },
      });
      setValue("");
      await load();
    } catch (e) {
      setAddError(message(e, "Không thêm được thành viên."));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(member: Member): Promise<void> {
    if (!window.confirm(`Xóa "${member.name}" khỏi nhóm? Lịch sử chi tiêu vẫn được giữ.`)) {
      return;
    }
    setActionError(null);
    try {
      await api(`/api/groups/${groupId}/members/${member.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setActionError(message(e, "Không xóa được thành viên."));
    }
  }

  const active = members?.filter((m) => m.removedAt === null) ?? [];
  const removed = members?.filter((m) => m.removedAt !== null) ?? [];

  return (
    <main className="container stack">
      <h1>Thành viên</h1>

      {loadError && <p className="error">{loadError}</p>}
      {!members && !loadError && <p className="muted">Đang tải…</p>}

      {group && (
        <div className="card stack">
          <span className="label">Mã mời nhóm</span>
          <div className="row">
            <code style={{ fontSize: "1.25rem", letterSpacing: "0.1em" }}>{group.inviteCode}</code>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(group.inviteCode)}
            >
              Sao chép
            </button>
          </div>
          <p className="muted">Gửi mã này cho bạn bè có tài khoản để họ tự tham gia nhóm.</p>
        </div>
      )}

      {members && (
        <div className="card stack">
          {actionError && <p className="error">{actionError}</p>}
          {active.length === 0 && <p className="empty">Chưa có thành viên.</p>}
          {active.map((member) => (
            <div key={member.id} className="row row-between">
              <span>
                <strong>{member.name}</strong>{" "}
                {member.username ? (
                  <span className="muted">@{member.username}</span>
                ) : (
                  <span className="badge">chưa có tài khoản</span>
                )}
                {group?.myMemberId === member.id && <span className="badge">bạn</span>}
              </span>
              {group?.myMemberId !== member.id && (
                <button className="btn btn-danger" type="button" onClick={() => handleRemove(member)}>
                  Xóa
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <form className="card stack" onSubmit={handleAdd}>
        <h2>Thêm bạn</h2>
        <div className="row">
          <button
            type="button"
            className={mode === "name" ? "btn btn-primary" : "btn"}
            onClick={() => setMode("name")}
          >
            Chỉ nhập tên
          </button>
          <button
            type="button"
            className={mode === "username" ? "btn btn-primary" : "btn"}
            onClick={() => setMode("username")}
          >
            Từ tài khoản
          </button>
        </div>
        <div>
          <label className="label" htmlFor="member-value">
            {mode === "name" ? "Tên bạn bè" : "Tên đăng nhập của bạn bè"}
          </label>
          <input
            id="member-value"
            className="input"
            maxLength={mode === "name" ? 50 : 32}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </div>
        {addError && <p className="error">{addError}</p>}
        <button className="btn btn-primary" type="submit" disabled={adding}>
          {adding ? "Đang thêm…" : "Thêm"}
        </button>
      </form>

      {removed.length > 0 && (
        <div className="card stack">
          <h2>Đã xóa</h2>
          {removed.map((member) => (
            <p key={member.id} className="muted">
              {member.name}
            </p>
          ))}
        </div>
      )}
    </main>
  );
}
