"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import { api } from "@/lib/api-client";
import type { Group } from "@/lib/types";

interface Invite {
  groupId: string;
  groupName: string;
  memberCount: number;
  alreadyMember: boolean;
}

/** How long the accept / decline result stays on screen before the redirect. */
const RESULT_MS = 1500;

/**
 * An invite link (/invite/CODE): the group it points at and two choices. Accepting joins and
 * opens the group; declining goes back to the group list. Either way the outcome is shown
 * first, then the page redirects.
 */
export default function InvitePage() {
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "meta"; text: string } | null>(null);

  useEffect(() => {
    api<{ invite: Invite }>(`/api/invites/${encodeURIComponent(code)}`)
      .then((data) => setInvite(data.invite))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Không mở được lời mời."));
  }, [code]);

  function finish(kind: "success" | "meta", text: string, to: string): void {
    setResult({ kind, text });
    window.setTimeout(() => router.replace(to), RESULT_MS);
  }

  async function accept(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { group } = await api<{ group: Group }>("/api/groups/join", {
        method: "POST",
        body: { inviteCode: code },
      });
      finish("success", `Đã tham gia nhóm “${group.name}”. Đang mở nhóm…`, `/groups/${group.id}/expenses`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tham gia được nhóm.");
      setBusy(false);
    }
  }

  function decline(): void {
    setBusy(true);
    finish("meta", "Đã từ chối lời mời. Đang về trang chủ…", "/groups");
  }

  return (
    <main className="container stack">
      {!invite && !error && <div className="spinner" role="status" aria-label="Đang tải" />}

      {!invite && error && (
        <div className="card stack">
          <p className="error">{error}</p>
          <button className="btn" type="button" onClick={() => router.replace("/groups")}>
            <span>Về trang chủ</span>
          </button>
        </div>
      )}

      {invite && (
        <div className="card stack">
          <h1 className="row row-nowrap">
            <Icon name="users" size={26} />
            <span className="truncate">{invite.groupName}</span>
          </h1>
          <p className="meta">
            {invite.alreadyMember
              ? "Bạn đã là thành viên của nhóm này."
              : `Bạn được mời tham gia nhóm (${invite.memberCount} thành viên).`}
          </p>

          {error && <p className="error">{error}</p>}
          {result && (
            <p className={result.kind} role="status">
              {result.text}
            </p>
          )}

          {!result && (
            <div className="row row-between">
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={decline}>
                <Icon name="ban" />
                <span>Từ chối</span>
              </button>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void accept()}>
                <Icon name="check" />
                <span>{invite.alreadyMember ? "Mở nhóm" : "Đồng ý"}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
