"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { BarChart } from "@/components/charts/BarChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { RangePicker } from "@/components/charts/RangePicker";
import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatVnd } from "@/lib/format";
import { VN_OFFSET_HOURS } from "@/lib/stats";
import type { GroupStats, StatsPeriod } from "@/lib/types";

/**
 * The "Thống kê" tab: spending over the whole history, a year, or a month.
 *
 * `period=all` is the only response that names the years WITH data (the contract does not
 * zero-fill it), so it is fetched once to seed the stepper's bounds and the defaults. The visible
 * period is a separate request; the client cache serves it instantly when the user flips back.
 */

const HOUR_MS = 3_600_000;

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: "all", label: "Tổng" },
  { value: "year", label: "Năm" },
  { value: "month", label: "Tháng" },
];

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** The year/month on the Vietnamese clock: a fixed UTC+7, so UTC shifted by that much. */
function vnNow(): { year: number; month: number } {
  const shifted = new Date(Date.now() + VN_OFFSET_HOURS * HOUR_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/** The years the `period=all` buckets carry, ascending; empty for any other period. */
function yearsWithData(stats: GroupStats): number[] {
  if (stats.period !== "all") {
    return [];
  }
  return stats.buckets
    .map((bucket) => Number(bucket.key))
    .filter((value) => Number.isInteger(value))
    .sort((a, b) => a - b);
}

export default function StatsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [period, setPeriod] = useState<StatsPeriod>("all");
  // Null until the first `all` response names the default year and the current month.
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped by the refresh button. The flag is consumed by the request it triggers, so later
  // period switches still read the cache instead of billing a request each time.
  const [reloadToken, setReloadToken] = useState(0);
  const freshOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;

    api<{ stats: GroupStats }>(`/api/groups/${groupId}/stats?period=all`)
      .then((data) => {
        if (cancelled) {
          return;
        }
        const known = yearsWithData(data.stats);
        const now = vnNow();
        setYears(known);
        // The latest year that holds data, else the current year: an empty group should still
        // open on a range that makes sense once it has spending.
        setYear(known.at(-1) ?? now.year);
        setMonth(now.month);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(message(e, "Không tải được thống kê."));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  useEffect(() => {
    // "Tổng" needs no year; "Năm"/"Tháng" wait for the defaults above.
    if (period !== "all" && (year === null || month === null)) {
      return;
    }

    let cancelled = false;
    const query = new URLSearchParams({ period });
    if (period !== "all" && year !== null) {
      query.set("year", String(year));
    }
    if (period === "month" && month !== null) {
      query.set("month", String(month));
    }

    const fresh = freshOnce.current;
    freshOnce.current = false;
    setLoading(true);

    api<{ stats: GroupStats }>(`/api/groups/${groupId}/stats?${query.toString()}`, { fresh })
      .then((data) => {
        if (cancelled) {
          return;
        }
        setStats(data.stats);
        setError(null);
        if (data.stats.period === "all") {
          setYears(yearsWithData(data.stats));
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(message(e, "Không tải được thống kê."));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [groupId, period, year, month, reloadToken]);

  const refresh = useCallback(() => {
    freshOnce.current = true;
    setReloadToken((token) => token + 1);
  }, []);

  const handleRange = useCallback((next: { year: number; month: number }) => {
    setYear(next.year);
    setMonth(next.month);
  }, []);

  // Read off the RESPONSE, not the controls: while a new range loads, the figures on screen still
  // belong to the previous range, and the heading has to name them honestly.
  const title = !stats
    ? "Chi tiêu"
    : stats.period === "all"
      ? "Chi tiêu theo năm"
      : stats.period === "year"
        ? `Chi tiêu theo tháng · ${stats.year}`
        : `Chi tiêu theo ngày · T${stats.month}/${stats.year}`;

  return (
    <main className="container stack" aria-busy={loading}>
      <div className="row row-between row-nowrap">
        <span className="meta">
          <Icon name="coins" />
          <span>Tổng chi tiêu</span>
          <strong className="amount">{stats ? formatVnd(stats.total) : "…"}</strong>
          {stats && <span>· {stats.count} khoản</span>}
        </span>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={refresh} />
      </div>

      <div className="segmented" role="group" aria-label="Khoảng thời gian">
        {PERIODS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={period === item.value}
            onClick={() => setPeriod(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {period !== "all" && year !== null && month !== null && (
        <RangePicker
          years={years}
          year={year}
          month={month}
          showMonth={period === "month"}
          onChange={handleRange}
        />
      )}

      {error && <p className="error">{error}</p>}
      {!stats && !error && <div className="spinner" role="status" aria-label="Đang tải" />}

      {stats && (
        <div className={loading ? "stack chart-busy" : "stack"}>
          {stats.total === 0 ? (
            <section className="card stack">
              <h2 className="row row-nowrap">
                <Icon name="chart" />
                <span>{title}</span>
              </h2>
              <p className="empty">Chưa có chi tiêu trong khoảng này.</p>
            </section>
          ) : (
            <>
              <section className="card stack">
                <h2 className="row row-nowrap">
                  <Icon name="chart" />
                  <span>{title}</span>
                </h2>
                <BarChart buckets={stats.buckets} title={title} />
              </section>

              <section className="card stack">
                <h2 className="row row-nowrap">
                  <Icon name="users" />
                  <span>Chia theo thành viên</span>
                </h2>
                <DonutChart members={stats.members} />
              </section>
            </>
          )}
        </div>
      )}
    </main>
  );
}
