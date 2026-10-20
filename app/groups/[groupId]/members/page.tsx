"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { BankInfoForm } from "@/components/BankInfoForm";
import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import type { Group, Member } from "@/lib/types";
import { bankByBin } from "@/lib/vietqr";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function MembersPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [mode, setMode] = useState<"name" | "username">("name");
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);

  // The member whose bank account is open for editing, by id (one at a time).
  const [editingBank, setEditingBank] = useState<string | null>(null);

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
    setNotice(null);
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
    setNotice(null);
    try {
      await api(`/api/groups/${groupId}/members/${member.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(message(e, "Không xóa được thành viên."));
    }
  }

  function handleBankSaved(member: Member): void {
    // The PATCH returned the stored member, so the row updates without another request.
    setMembers((current) =>
      current ? current.map((m) => (m.id === member.id ? member : m)) : current,
    );
    setEditingBank(null);
    setError(null);
    setNotice(`Đã lưu tài khoản nhận tiền của ${member.name}.`);
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
      {notice && <p className="success">{notice}</p>}
      {!members && !error && <div className="spinner" role="status" aria-label="Đang tải" />}

      {group && (
        <div className="card row row-between row-nowrap">
          <span className="meta">
            <Icon name="key" />
            <span>Mã mời</span>
            <code style={{ fontSize: "1.25rem", letterSpacing: "0.1em", color: "var(--text)" }}>
              {group.inviteCode}
            </code>
          </span>
          <IconButton
            icon={copied ? "check" : "copy"}
            label={copied ? "Đã chép" : "Sao chép"}
            variant="ghost"
            showLabel
            onClick={() => void copyCode(group.inviteCode)}
          />
        </div>
      )}

      {members && (
        <div className="card stack">
          {active.map((member) => {
            const bankEntry = member.bank ? bankByBin(member.bank.bin) : undefined;
            return (
              <div key={member.id} className="stack member-row">
                <div className="row row-between row-nowrap">
                  <span className="row row-nowrap grow">
                    <Icon name="user" />
                    <strong className="truncate">{member.name}</strong>
                    {member.username && (
                      <span className="muted truncate" title={`@${member.username}`}>
                        @{member.username}
                      </span>
                    )}
                    {group?.myMemberId === member.id && (
                      <span className="badge">Bạn</span>
                    )}
                  </span>
                  <span className="row row-nowrap">
                    <IconButton
                      icon="bank"
                      label={member.bank ? "Sửa tài khoản" : "Thêm tài khoản"}
                      title={
                        member.bank
                          ? `Sửa tài khoản nhận tiền của ${member.name}`
                          : `Thêm tài khoản nhận tiền cho ${member.name}`
                      }
                      variant="ghost"
                      onClick={() => {
                        setEditingBank(editingBank === member.id ? null : member.id);
                        setNotice(null);
                      }}
                    />
                    {group?.myMemberId !== member.id && (
                      <IconButton
                        icon="trash"
                        label="Xóa"
                        title={`Xóa ${member.name}`}
                        variant="danger"
                        onClick={() => void handleRemove(member)}
                      />
                    )}
                  </span>
                </div>

                <span className="meta">
                  <Icon name="bank" size={16} />
                  {member.bank ? (
                    <>
                      <span>{bankEntry ? bankEntry.shortName : `BIN ${member.bank.bin}`}</span>
                      <span className="account-no">{member.bank.accountNo}</span>
                      <span className="truncate">{member.bank.accountName}</span>
                    </>
                  ) : (
                    <span>Chưa có tài khoản nhận tiền</span>
                  )}
                </span>

                {editingBank === member.id && (
                  <div className="stack bank-edit">
                    <strong className="row row-nowrap">
                      <Icon name="bank" size={18} />
                      <span>Tài khoản nhận tiền của {member.name}</span>
                    </strong>
                    <BankInfoForm
                      groupId={groupId}
                      memberId={member.id}
                      initial={member.bank}
                      submitLabel="Lưu tài khoản"
                      onSaved={handleBankSaved}
                      onCancel={() => setEditingBank(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <form className="card stack" onSubmit={handleAdd}>
        <strong className="row row-nowrap">
          <Icon name="userPlus" />
          <span>Thêm bạn</span>
        </strong>
        <div className="row">
          <IconButton
            icon="user"
            label="Chỉ có tên"
            title="Thêm bạn chỉ bằng tên (không cần tài khoản)"
            variant={mode === "name" ? "primary" : "default"}
            showLabel
            onClick={() => setMode("name")}
          />
          <IconButton
            icon="at"
            label="Có tài khoản"
            title="Thêm bạn đã đăng ký tài khoản"
            variant={mode === "username" ? "primary" : "default"}
            showLabel
            onClick={() => setMode("username")}
          />
        </div>
        <div className="row row-nowrap">
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
          <button className="btn btn-primary" type="submit" disabled={adding}>
            <Icon name="userPlus" />
            <span>Thêm</span>
          </button>
        </div>
      </form>

      {removed.length > 0 && (
        <div className="card stack">
          <span className="meta">
            <Icon name="userMinus" size={16} />
            <span>Đã rời nhóm</span>
          </span>
          {removed.map((member) => (
            <span key={member.id} className="meta">
              <Icon name="userMinus" size={16} />
              <span className="truncate">{member.name}</span>
            </span>
          ))}
        </div>
      )}
    </main>
  );
}
