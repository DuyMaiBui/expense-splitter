import { sameName } from "./group-queries";
import type { Preset } from "./types";
import { int, obj, str } from "./validate";

/**
 * Expense presets ("mục mẫu"): a named unit price a group multiplies by a quantity when adding
 * an expense. Everything here is client-safe (types and pure functions plus reads that take the
 * database as a parameter), so the expense form shares `presetAmount` with the server.
 */

/** Hard cap per group: bounds every read and the single-statement sync write. */
export const MAX_PRESETS_PER_GROUP = 100;
export const MAX_PRESET_PRICE = 1_000_000_000;
export const MAX_QUANTITY = 99_999;

interface PresetRow {
  id: string;
  group_id: string;
  name: string;
  unit_price: number;
  created_at: string;
  updated_at: string;
}

const PRESET_SELECT =
  "SELECT id, group_id, name, unit_price, created_at, updated_at FROM expense_presets";

function toPreset(row: PresetRow): Preset {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    unitPrice: row.unit_price,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A group's presets, A to Z (served by the UNIQUE (group_id, name) index, bounded by the cap). */
export async function listPresets(db: D1Database, groupId: string): Promise<Preset[]> {
  const { results } = await db
    .prepare(`${PRESET_SELECT} WHERE group_id = ? ORDER BY name ASC LIMIT ?`)
    .bind(groupId, MAX_PRESETS_PER_GROUP)
    .all<PresetRow>();
  return results.map(toPreset);
}

export interface PresetInput {
  name: string;
  unitPrice: number;
}

export function parsePresetBody(raw: unknown): PresetInput {
  const body = obj(raw, "body");
  return {
    name: str(body.name, "name", { min: 1, max: 50 }),
    unitPrice: int(body.unitPrice, "unitPrice", { min: 1, max: MAX_PRESET_PRICE }),
  };
}

/**
 * Total for `quantity` units. NaN when either input is not a positive integer within range, so
 * a half-typed quantity never produces a bogus amount.
 */
export function presetAmount(unitPrice: number, quantity: number): number {
  const valid =
    Number.isInteger(unitPrice) &&
    unitPrice >= 1 &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= MAX_QUANTITY;
  return valid ? unitPrice * quantity : Number.NaN;
}

export interface SyncPlan {
  toAdd: PresetInput[];
  /** Existing target presets whose price changes. The target keeps its own name. */
  toUpdate: Array<{ id: string; unitPrice: number }>;
  /** Source presets left alone: same name already present and nothing to change. */
  skipped: number;
}

/**
 * What copying `source` into `target` does. Names match Vietnamese-aware and case-insensitively.
 * A name the target already has is never replaced silently: with `overwrite` false it is
 * skipped, with `overwrite` true only its price is taken from the source.
 */
export function planSync(source: Preset[], target: Preset[], overwrite: boolean): SyncPlan {
  const plan: SyncPlan = { toAdd: [], toUpdate: [], skipped: 0 };

  for (const item of source) {
    const existing = target.find((t) => sameName(t.name, item.name));

    if (existing) {
      if (overwrite && existing.unitPrice !== item.unitPrice) {
        plan.toUpdate.push({ id: existing.id, unitPrice: item.unitPrice });
      } else {
        plan.skipped += 1;
      }
      continue;
    }

    // Two source presets differing only by case collapse into one added row.
    if (plan.toAdd.some((added) => sameName(added.name, item.name))) {
      plan.skipped += 1;
      continue;
    }
    plan.toAdd.push({ name: item.name, unitPrice: item.unitPrice });
  }

  return plan;
}
