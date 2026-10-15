"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { api } from "@/lib/api-client";
import type { Group } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function GroupsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [inviteCode, setInviteCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ groups: Group[] }>("/api/groups");
      setGroups(data.groups);
      setLoadError(null);
    } catch (e) {
      setLoadError(message(e, "Không tải được danh sách nhóm."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const data = await api<{ group: Group }>("/api/groups", { method: "POST", body: { name } });
      router.push(`/groups/${data.group.id}/expenses`);
    } catch (e) {
      setCreateError(message(e, "Không tạo được nhóm."));
      setCreating(false);
    }
  }

  async function handleJoin(event: FormEvent): Promise<void> {
    event.preventDefault();
    setJoining(true);
    setJoinError(null);
    try {
      const data = await api<{ group: Group }>("/api/groups/join", {
        method: "POST",
        body: { inviteCode },
      });
      router.push(`/groups/${data.group.id}/expenses`);
    } catch (e) {
      setJoinError(message(e, "Không tham gia được nhóm."));
      setJoining(false);
    }
  }

  return (
    <main className="container stack">
      <h1>Chọn nhóm</h1>

      {loadError && <p className="error">{loadError}</p>}
      {!groups && !loadError && <p className="muted">Đang tải…</p>}
      {groups && groups.length === 0 && (
        <p className="empty">Bạn chưa ở trong nhóm nào. Tạo nhóm mới hoặc nhập mã mời bên dưới.</p>
      )}
      {groups && groups.length > 0 && (
        <div className="stack">
          {groups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.id}/expenses`}
              className="card row row-between"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              <strong>{group.name}</strong>
              <span className="muted">{group.memberCount} thành viên</span>
            </Link>
          ))}
        </div>
      )}

      <form className="card stack" onSubmit={handleCreate}>
        <h2>Tạo nhóm mới</h2>
        <div>
          <label className="label" htmlFor="group-name">
            Tên nhóm
          </label>
          <input
            id="group-name"
            className="input"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        {createError && <p className="error">{createError}</p>}
        <button className="btn btn-primary" type="submit" disabled={creating}>
          {creating ? "Đang tạo…" : "Tạo nhóm"}
        </button>
      </form>

      <form className="card stack" onSubmit={handleJoin}>
        <h2>Tham gia bằng mã mời</h2>
        <div>
          <label className="label" htmlFor="invite-code">
            Mã mời
          </label>
          <input
            id="invite-code"
            className="input"
            autoCapitalize="characters"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
          />
        </div>
        {joinError && <p className="error">{joinError}</p>}
        <button className="btn" type="submit" disabled={joining}>
          {joining ? "Đang tham gia…" : "Tham gia nhóm"}
        </button>
      </form>
    </main>
  );
}
