"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Icon, IconButton, type IconName } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { LogAction, LogEntry } from "@/lib/types";

const PAGE_SIZE = 50;

/** One glyph per action so the log scans without reading. Typed: a new LogAction fails to compile here. */
const ACTION_ICON: Record<LogAction, IconName> = {
  "group.create": "users",
  "member.add": "userPlus",
  "member.join": "login",
  "member.remove": "userMinus",
  "expense.create": "plus",
  "expense.update": "pencil",
  "expense.delete": "trash",
  "preset.create": "tag",
  "preset.update": "pencil",
  "preset.delete": "trash",
  "preset.sync": "swap",
};

interface LogPage {
  entries: LogEntry[];
  nextBefore: string | null;
}

export default function LogPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (before: string | null, fresh = false): Promise<LogPage> => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) {
        query.set("before", before);
      }
      return api<LogPage>(`/api/groups/${groupId}/log?${query}`, { fresh });
    },
    [groupId],
  );

  const loadFirst = useCallback(
    async (fresh = false) => {
      try {
        const page = await fetchPage(null, fresh);
        setEntries(page.entries);
        setNextBefore(page.nextBefore);
        setLoaded(true);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được nhật ký.");
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  async function loadMore(): Promise<void> {
    if (!nextBefore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextBefore);
      setEntries((current) => [...current, ...page.entries]);
      setNextBefore(page.nextBefore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải thêm được.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="container stack">
      <div className="row row-between row-nowrap">
        <h1 className="row row-nowrap">
          <Icon name="clock" size={26} />
          <span>Nhật ký hoạt động</span>
        </h1>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={() => void loadFirst(true)} />
      </div>

      {error && <p className="error">{error}</p>}
      {!loaded && !error && <div className="spinner" role="status" aria-label="Đang tải" />}
      {loaded && entries.length === 0 && (
        <p className="empty">Chưa có hoạt động nào.</p>
      )}

      {entries.map((entry) => (
        <div key={entry.id} className="card stack">
          <div className="row row-nowrap">
            <Icon name={ACTION_ICON[entry.action] ?? "info"} />
            <span className="grow">{entry.summary}</span>
          </div>
          <div className="meta">
            <Icon name="clock" size={16} />
            {formatDateTime(entry.createdAt)}
          </div>
          {entry.detail && (
            <details>
              <summary className="muted">
                <Icon name="info" size={16} /> Chi tiết
              </summary>
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.8rem" }}>
                {JSON.stringify(entry.detail, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}

      {nextBefore && (
        <IconButton
          icon="chevronDown"
          label={loadingMore ? "Đang tải…" : "Tải thêm"}
          showLabel
          onClick={() => void loadMore()}
          disabled={loadingMore}
        />
      )}
    </main>
  );
}
