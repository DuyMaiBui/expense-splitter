"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import type { Group, Member } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function MembersPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"name" | "username">("name");
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (fresh = false) => {
      try {
        // Same URL the nav bar uses, so this is one request (or none, when cached).
        const data = await api<{ group: Group; members: Member[] }>(`/api/groups/${groupId}`, { fresh });
        setGroup(data.group);
        setMembers(data.members);
        setError(null);
      } catch (e) {
        setError(message(e, "Không tải được thành viên."));
      }
    },
    [groupId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await api<{ member: Member }>(`/api/groups/${groupId}/members`, {
        method: "POST",
        body: mode === "name" ? { name: value } : { username: value },
      });
      setValue("");
      await load();
    } catch (e) {
      setError(message(e, "Không thêm được thành viên."));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(member: Member): Promise<void> {
    if (!window.confirm(`Xóa "${member.name}" khỏi nhóm? Lịch sử chi tiêu vẫn được giữ.`)) {
      return;
    }
    setError(null);
    try {
      await api(`/api/groups/${groupId}/members/${member.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(message(e, "Không xóa được thành viên."));
    }
  }

  async function copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Không sao chép được, hãy chép thủ công.");
    }
  }

  const active = members?.filter((m) => m.removedAt === null) ?? [];
  const removed = members?.filter((m) => m.removedAt !== null) ?? [];

  return (
    <main className="container stack">
      {error && <p className="error">{error}</p>}
      {!members && !error && <div className="spinner" role="status" aria-label="Đang tải" />}

      {group && (
        <div className="card row row-between row-nowrap">
          <span className="meta">
            <Icon name="key" />
            <code style={{ fontSize: "1.25rem", letterSpacing: "0.1em", color: "var(--text)" }}>
              {group.inviteCode}
            </code>
          </span>
          <IconButton
            icon={copied ? "check" : "copy"}
            label="Sao chép mã mời"
            variant="ghost"
            onClick={() => void copyCode(group.inviteCode)}
          />
        </div>
      )}

      {members && (
        <div className="card stack">
          {active.map((member) => (
            <div key={member.id} className="row row-between row-nowrap">
              <span className="row row-nowrap grow">
                <Icon name="user" />
                <strong className="truncate">{member.name}</strong>
                {member.username && <span className="muted truncate">@{member.username}</span>}
                {group?.myMemberId === member.id && (
                  <span className="badge" title="Bạn" aria-label="Bạn">
                    <Icon name="check" size={14} />
                  </span>
                )}
              </span>
              {group?.myMemberId !== member.id && (
                <IconButton
                  icon="trash"
                  label={`Xóa ${member.name}`}
                  variant="danger"
                  onClick={() => void handleRemove(member)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <form className="card stack" onSubmit={handleAdd}>
        <div className="row row-nowrap">
          <IconButton
            icon="user"
            label="Thêm bạn chỉ bằng tên"
            variant={mode === "name" ? "primary" : "default"}
            onClick={() => setMode("name")}
          />
          <IconButton
            icon="at"
            label="Thêm bạn từ tài khoản"
            variant={mode === "username" ? "primary" : "default"}
            onClick={() => setMode("username")}
          />
          <div className="field">
            <Icon name={mode === "name" ? "user" : "at"} />
            <input
              className="input"
              maxLength={mode === "name" ? 50 : 32}
              autoCapitalize="none"
              placeholder={mode === "name" ? "Tên bạn" : "Tên đăng nhập"}
              aria-label={mode === "name" ? "Tên bạn" : "Tên đăng nhập của bạn"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-icon btn-primary" type="submit" disabled={adding} aria-label="Thêm" title="Thêm">
            <Icon name="userPlus" />
          </button>
        </div>
      </form>

      {removed.length > 0 && (
        <div className="card stack">
          {removed.map((member) => (
            <span key={member.id} className="meta">
              <Icon name="userMinus" size={16} />
              {member.name}
            </span>
          ))}
        </div>
      )}
    </main>
  );
}
