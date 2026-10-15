"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { LogEntry } from "@/lib/types";

const PAGE_SIZE = 50;

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
    async (before: string | null): Promise<LogPage> => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) {
        query.set("before", before);
      }
      return api<LogPage>(`/api/groups/${groupId}/log?${query}`);
    },
    [groupId],
  );

  useEffect(() => {
    fetchPage(null)
      .then((page) => {
        setEntries(page.entries);
        setNextBefore(page.nextBefore);
        setLoaded(true);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Không tải được nhật ký."));
  }, [fetchPage]);

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
      <h1>Nhật ký hoạt động</h1>

      {error && <p className="error">{error}</p>}
      {!loaded && !error && <p className="muted">Đang tải…</p>}
      {loaded && entries.length === 0 && <p className="empty">Chưa có hoạt động nào.</p>}

      {entries.map((entry) => (
        <div key={entry.id} className="card stack">
          <div>{entry.summary}</div>
          <div className="muted">{formatDateTime(entry.createdAt)}</div>
          {entry.detail && (
            <details>
              <summary className="muted">Chi tiết</summary>
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.8rem" }}>
                {JSON.stringify(entry.detail, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}

      {nextBefore && (
        <button className="btn" type="button" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Đang tải…" : "Tải thêm"}
        </button>
      )}
    </main>
  );
}
