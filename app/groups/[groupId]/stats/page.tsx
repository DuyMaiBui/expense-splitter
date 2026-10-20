"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BarChart } from "@/components/charts/BarChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatVnd } from "@/lib/format";
import { VN_OFFSET_HOURS } from "@/lib/stats";
import type { GroupStats, StatsPeriod } from "@/lib/types";

/**
 * The "Thống kê" tab: spending over the whole history, a year, or a month.
 *
 * The `period=all` response is the only place the years WITH data come from (the contract does not
 * zero-fill it), so it is fetched once to seed the year picker and the defaults. The visible period
 * is then a separate request, which the client cache serves instantly when the user flips back.
 */

const HOUR_MS = 3_600_000;

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: "all", label: "Tổng" },
  { value: "year", label: "Năm" },
  { value: "month", label: "Tháng" },
];

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** The current year/month on the Vietnamese clock: a fixed UTC+7, so UTC shifted by that much. */
function vnNow(): { year: number; month: number } {
  const shifted = new Date(Date.now() + VN_OFFSET_HOURS * HOUR_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/** The years the `period=all` buckets carry, ascending. Empty for any other period. */
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
  // null until the first `all` response names the default year and the current month.
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped by the refresh button; the flag is consumed once so later period switches still use
  // the cache instead of billing a request each time.
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

  // Only years that hold data, plus the selected one (the current year before any data exists).
  const yearOptions = useMemo(() => {
    const set = new Set(years);
    if (year !== null) {
      set.add(year);
    }
    return [...set].sort((a, b) => a - b);
  }, [years, year]);

  const yearIndex = year === null ? -1 : yearOptions.indexOf(year);
  const canPrevYear = yearIndex > 0;
  const canNextYear = yearIndex >= 0 && yearIndex < yearOptions.length - 1;

  const monthIndex = year !== null && month !== null ? year * 12 + (month - 1) : null;
  const firstYear = yearOptions.length > 0 ? yearOptions[0] : null;
  const lastYear = yearOptions.length > 0 ? yearOptions[yearOptions.length - 1] : null;
  const canPrevMonth = monthIndex !== null && firstYear !== null && monthIndex > firstYear * 12;
  const canNextMonth = monthIndex !== null && lastYear !== null && monthIndex < lastYear * 12 + 11;

  function stepYear(delta: -1 | 1): void {
    if (year === null) {
      return;
    }
    const next = yearOptions[yearOptions.indexOf(year) + delta];
    if (typeof next === "number") {
      setYear(next);
    }
  }

  // The month arrows change the year when they cross a boundary, and stop at the edges of the
  // years that hold data: there is nothing to show past them.
  function stepMonth(delta: -1 | 1): void {
    if (year === null || month === null || firstYear === null || lastYear === null) {
      return;
    }
    const index = year * 12 + (month - 1) + delta;
    if (index < firstYear * 12 || index > lastYear * 12 + 11) {
      return;
    }
    setYear(Math.floor(index / 12));
    setMonth((index % 12) + 1);
  }

  // Read off the RESPONSE, not the controls: while a new period loads, the figures on screen are
  // still the previous period's and the heading must name them honestly.
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

      {period !== "all" && year !== null && (
        <section className="card stack">
          <div className="row row-between row-nowrap">
            <span className="meta">
              <Icon name="clock" />
              <span>Năm</span>
            </span>
            <span className="row row-nowrap">
              <IconButton
                icon="arrowLeft"
                label="Năm trước"
                variant="ghost"
                disabled={!canPrevYear}
                onClick={() => stepYear(-1)}
              />
              <strong className="amount">{year}</strong>
              <IconButton
                icon="arrowRight"
                label="Năm sau"
                variant="ghost"
                disabled={!canNextYear}
                onClick={() => stepYear(1)}
              />
            </span>
          </div>

          {period === "month" && month !== null && (
            <div className="row row-between row-nowrap">
              <span className="meta">
                <Icon name="clock" />
                <span>Tháng</span>
              </span>
              <span className="row row-nowrap">
                <IconButton
                  icon="arrowLeft"
                  label="Tháng trước"
                  variant="ghost"
                  disabled={!canPrevMonth}
                  onClick={() => stepMonth(-1)}
                />
                <strong className="amount">Tháng {month}</strong>
                <IconButton
                  icon="arrowRight"
                  label="Tháng sau"
                  variant="ghost"
                  disabled={!canNextMonth}
                  onClick={() => stepMonth(1)}
                />
              </span>
            </div>
          )}
        </section>
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
