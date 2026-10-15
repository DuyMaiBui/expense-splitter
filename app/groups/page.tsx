"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import type { Group } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function GroupsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (fresh = false) => {
    try {
      const data = await api<{ groups: Group[] }>("/api/groups", { fresh });
      setGroups(data.groups);
      setLoadError(null);
    } catch (e) {
      setLoadError(message(e, "Không tải được danh sách nhóm."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent, path: string, body: unknown, fallback: string) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const data = await api<{ group: Group }>(path, { method: "POST", body });
      router.push(`/groups/${data.group.id}/expenses`);
    } catch (e) {
      setFormError(message(e, fallback));
      setBusy(false);
    }
  }

  return (
    <main className="container stack">
      <div className="row row-between">
        <Icon name="users" size={26} />
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={() => void load(true)} />
      </div>

      {loadError && <p className="error">{loadError}</p>}
      {!groups && !loadError && <div className="spinner" role="status" aria-label="Đang tải" />}
      {groups && groups.length === 0 && (
        <p className="empty">
          <Icon name="users" size={32} />
        </p>
      )}

      {groups && groups.length > 0 && (
        <div className="stack">
          {groups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.id}/expenses`}
              prefetch={false}
              className="card row row-between row-nowrap"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              <strong className="truncate">{group.name}</strong>
              <span className="meta">
                <Icon name="users" size={16} />
                {group.memberCount}
              </span>
            </Link>
          ))}
        </div>
      )}

      {formError && <p className="error">{formError}</p>}

      <form
        className="card row row-nowrap"
        onSubmit={(e) => submit(e, "/api/groups", { name }, "Không tạo được nhóm.")}
      >
        <div className="field">
          <Icon name="users" />
          <input
            className="input"
            maxLength={60}
            placeholder="Tên nhóm mới"
            aria-label="Tên nhóm mới"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <button className="btn btn-icon btn-primary" type="submit" disabled={busy} aria-label="Tạo nhóm" title="Tạo nhóm">
          <Icon name="plus" />
        </button>
      </form>

      <form
        className="card row row-nowrap"
        onSubmit={(e) => submit(e, "/api/groups/join", { inviteCode }, "Không tham gia được nhóm.")}
      >
        <div className="field">
          <Icon name="key" />
          <input
            className="input"
            autoCapitalize="characters"
            placeholder="Mã mời"
            aria-label="Mã mời"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
          />
        </div>
        <button className="btn btn-icon" type="submit" disabled={busy} aria-label="Tham gia nhóm" title="Tham gia nhóm">
          <Icon name="login" />
        </button>
      </form>
    </main>
  );
}
