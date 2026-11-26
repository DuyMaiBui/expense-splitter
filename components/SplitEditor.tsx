"use client";

import { useState } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { formatVnd } from "@/lib/format";
import {
  ADJUST_STEP,
  MAX_ADJUST,
  MIN_ADJUST,
  clampAdjust,
  formatAdjust,
  parseAdjustInput,
  splitWeighted,
} from "@/lib/split-weight";
import type { Member } from "@/lib/types";

interface SplitEditorProps {
  amount: number;
  participantIds: readonly string[];
  members: readonly Member[];
  /** Non-zero adjustments only (percent on top of a normal share); empty = equal split. */
  adjustments: ReadonlyMap<string, number>;
  onChange: (adjustments: Map<string, number>) => void;
}

/** The text an adjustment shows in its field: "0", "+10", "-20". */
function fieldText(adjust: number): string {
  return adjust > 0 ? `+${adjust}` : String(adjust);
}

/**
 * Per-person adjustment editor. Everyone starts at 0% (a normal share); "+10%" means this
 * person pays 10% more than someone at 0%. The amount column is the live result of the same
 * `splitWeighted` the server stores with, so what is shown is what gets saved.
 */
export function SplitEditor({ amount, participantIds, members, adjustments, onChange }: SplitEditorProps) {
  // Half-typed text ("+" or "") stays in the field until it parses or the field loses focus.
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());

  // Rows follow the member list order (the chips above), not the id order the maths uses.
  const chosen = new Set(participantIds);
  const ids = members.filter((m) => chosen.has(m.id)).map((m) => m.id);
  const adjustOf = (id: string) => adjustments.get(id) ?? 0;
  const nobodyPays = ids.every((id) => adjustOf(id) === MIN_ADJUST);
  const validAmount = Number.isFinite(amount) && amount >= 1 && !nobodyPays;
  const amounts = new Map(
    validAmount ? splitWeighted(amount, ids, adjustments).map((s) => [s.memberId, s.amount] as const) : [],
  );
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
  const adjustedCount = ids.filter((id) => adjustOf(id) !== 0).length;

  function setDraft(id: string, text: string | null): void {
    setDrafts((current) => {
      const next = new Map(current);
      if (text === null) {
        next.delete(id);
      } else {
        next.set(id, text);
      }
      return next;
    });
  }

  function setAdjust(id: string, adjust: number): void {
    const next = new Map(adjustments);
    if (adjust === 0) {
      next.delete(id);
    } else {
      next.set(id, adjust);
    }
    onChange(next);
  }

  return (
    <div className="split-editor stack">
      {/* Fixed text and an always-present button: this row must not change height on the first
          tap, or every row below moves under the finger between two taps of − / +. */}
      <div className="row row-between row-nowrap">
        <span className="meta">
          <Icon name="info" size={16} />
          <span>0% là mức bình thường; +10% là trả nhiều hơn người 0% đúng 10%.</span>
        </span>
        <IconButton
          icon="refresh"
          label="Chia đều lại"
          variant="ghost"
          showLabel
          disabled={adjustedCount === 0}
          onClick={() => onChange(new Map())}
        />
      </div>

      {ids.map((id) => {
        const adjust = adjustOf(id);
        const draft = drafts.get(id);
        return (
          <div key={id} className={`split-row${adjust !== 0 ? " split-row-pinned" : ""}`}>
            <strong className="truncate split-name">{nameOf(id)}</strong>
            <div className="split-row-controls">
              <IconButton
                icon="minus"
                label={`Giảm ${nameOf(id)} ${ADJUST_STEP}%`}
                className="split-step"
                disabled={adjust <= MIN_ADJUST}
                onClick={() => setAdjust(id, clampAdjust(adjust - ADJUST_STEP))}
              />
              <div className="field split-percent">
                <input
                  className="input"
                  inputMode="numeric"
                  aria-label={`Điều chỉnh của ${nameOf(id)} (%)`}
                  value={draft ?? fieldText(adjust)}
                  onChange={(e) => {
                    setDraft(id, e.target.value);
                    const parsed = parseAdjustInput(e.target.value);
                    if (Number.isFinite(parsed)) {
                      setAdjust(id, parsed);
                    }
                  }}
                  onBlur={() => setDraft(id, null)}
                />
                <span className="split-percent-sign">%</span>
              </div>
              <IconButton
                icon="plus"
                label={`Tăng ${nameOf(id)} ${ADJUST_STEP}%`}
                className="split-step"
                disabled={adjust >= MAX_ADJUST}
                onClick={() => setAdjust(id, clampAdjust(adjust + ADJUST_STEP))}
              />
              <span className="split-amount">
                <span className="amount">{validAmount ? formatVnd(amounts.get(id) ?? 0) : "—"}</span>
                {adjust !== 0 && (
                  <span className={`badge ${adjust > 0 ? "badge-up" : "badge-down"}`}>{formatAdjust(adjust)}</span>
                )}
              </span>
            </div>
          </div>
        );
      })}

      {nobodyPays ? (
        <p className="error">Phải có ít nhất một người trả tiền (không thể để tất cả −100%).</p>
      ) : (
        validAmount && (
          <div className="meta">
            <Icon name="scale" size={16} />
            <span>Tổng {formatVnd(amount)}</span>
          </div>
        )
      )}
    </div>
  );
}
