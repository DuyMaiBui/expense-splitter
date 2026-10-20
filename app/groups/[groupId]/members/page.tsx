"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { canRemoveMember } from "@/lib/permissions";
import type { Group, Member, Viewer } from "@/lib/types";
import { bankByBin } from "@/lib/vietqr";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * Who a member's bank line describes. A friend added by name has no account at all, so there is
 * nothing to configure; a linked account simply has not filled its profile in yet.
 */
function bankHint(member: Member): string {
  return member.userId === null
    ? "Không có tài khoản trong ứng dụng"
    : "Chưa cài tài khoản nhận tiền";
}

export default function MembersPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [mode, setMode] = useState<"name" | "username">("name");
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (fresh = false) => {
      try {
        // Same URL the nav bar uses, so this is one request (or none, when cached). The envelope
        // carries the caller's `viewer`, which is what the permission helpers below evaluate.
        const data = await api<{ group: Group; members: Member[]; viewer: Viewer }>(
          `/api/groups/${groupId}`,
          { fresh },
        );
        setGroup(data.group);
        setMembers(data.members);
        setViewer(data.viewer);
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
    const isMe = viewer?.memberId === member.id;
    const question = isMe
      ? `Rời nhóm "${group?.name ?? ""}"? Lịch sử chi tiêu của bạn vẫn được giữ.`
      : `Xóa "${member.name}" khỏi nhóm? Lịch sử chi tiêu vẫn được giữ.`;
    if (!window.confirm(question)) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await api(`/api/groups/${groupId}/members/${member.id}`, { method: "DELETE" });
      if (isMe) {
        // Leaving the group: this page (and every tab of it) is now forbidden.
        router.replace("/groups");
        return;
      }
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
            const isMe = viewer?.memberId === member.id;
            // The owner's own row is protected from everyone (including the owner), and only the
            // owner, the admin or the member themself may remove a row — the same rule the route
            // enforces, evaluated from the one shared helper.
            const verdict = viewer ? canRemoveMember(viewer, member) : { ok: false as const };
            // Leaving is the member's own row, so it reads differently from removing someone else.
            const canLeave = isMe && !member.isOwner;
            const canRemoveOther = verdict.ok && !isMe;

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
                    {member.isOwner && (
                      <span className="badge badge-owner" title="Người tạo nhóm">
                        Chủ nhóm
                      </span>
                    )}
                    {isMe && <span className="badge">Bạn</span>}
                  </span>
                  <span className="row row-nowrap">
                    {canLeave && (
                      <IconButton
                        icon="logout"
                        label="Rời nhóm"
                        title="Rời nhóm này"
                        variant="danger"
                        onClick={() => void handleRemove(member)}
                      />
                    )}
                    {canRemoveOther && (
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
                    <span>{bankHint(member)}</span>
                  )}
                </span>

                {/* Bank info belongs to the account holder's profile, so it is read-only here:
                    only the member themself can change it, on their own profile page. */}
                {isMe && (
                  <Link className="btn btn-ghost self-start" href="/profile" prefetch={false}>
                    <Icon name="pencil" />
                    <span>Cập nhật ở Hồ sơ</span>
                  </Link>
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
        {mode === "name" && (
          <p className="muted">
            Bạn thêm bằng tên thì người đó chưa có tài khoản trong ứng dụng, nên chưa có mã QR.
          </p>
        )}
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
