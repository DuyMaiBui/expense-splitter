"use client";

import { useMemo } from "react";

import { Icon, IconButton } from "@/components/Icon";

/**
 * The year / month stepper above the charts: arrows over a strong figure, bounded to the years
 * that actually hold data. A month arrow that crosses a year boundary moves the year with it.
 *
 * The bounds are not "any year ever": stepping into an empty year would only ever show zeros, so
 * the two ranges are the same set of years the `period=all` buckets named.
 */

interface RangePickerProps {
  /** Years that hold data, ascending. The selected year is added if it is not among them. */
  years: number[];
  year: number;
  /** 1..12, shown and stepped only when `showMonth`. */
  month: number;
  showMonth: boolean;
  onChange: (next: { year: number; month: number }) => void;
}

export function RangePicker({ years, year, month, showMonth, onChange }: RangePickerProps) {
  const options = useMemo(() => {
    const set = new Set(years);
    set.add(year);
    return [...set].sort((a, b) => a - b);
  }, [years, year]);

  const yearIndex = options.indexOf(year);
  const first = options[0] ?? year;
  const last = options[options.length - 1] ?? year;
  const monthIndex = year * 12 + (month - 1);

  function stepYear(delta: -1 | 1): void {
    const next = options[yearIndex + delta];
    if (typeof next === "number") {
      onChange({ year: next, month });
    }
  }

  function stepMonth(delta: -1 | 1): void {
    const index = monthIndex + delta;
    if (index < first * 12 || index > last * 12 + 11) {
      return;
    }
    onChange({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  }

  return (
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
            disabled={yearIndex <= 0}
            onClick={() => stepYear(-1)}
          />
          <strong className="amount">{year}</strong>
          <IconButton
            icon="arrowRight"
            label="Năm sau"
            variant="ghost"
            disabled={yearIndex < 0 || yearIndex >= options.length - 1}
            onClick={() => stepYear(1)}
          />
        </span>
      </div>

      {showMonth && (
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
              disabled={monthIndex <= first * 12}
              onClick={() => stepMonth(-1)}
            />
            <strong className="amount">Tháng {month}</strong>
            <IconButton
              icon="arrowRight"
              label="Tháng sau"
              variant="ghost"
              disabled={monthIndex >= last * 12 + 11}
              onClick={() => stepMonth(1)}
            />
          </span>
        </div>
      )}
    </section>
  );
}
