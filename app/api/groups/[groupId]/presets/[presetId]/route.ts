import { logStatement } from "@/lib/activity";
import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb, nowIso } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { formatVnd } from "@/lib/format";
import { sameName } from "@/lib/group-queries";
import { ok, readJson, route } from "@/lib/http";
import { listPresets, parsePresetBody } from "@/lib/presets";
import type { Preset } from "@/lib/types";

export const PUT = route(async (req, ctx) => {
  const { groupId, presetId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);
  const input = await readJson(req, parsePresetBody);

  const db = getDb();
  const all = await listPresets(db, groupId);
  const before = all.find((p) => p.id === presetId);
  if (!before) {
    throw notFound("Không tìm thấy mục mẫu.");
  }
  if (all.some((p) => p.id !== presetId && sameName(p.name, input.name))) {
    throw conflict(`Nhóm đã có mục mẫu tên "${input.name}".`);
  }

  const after: Preset = {
    ...before,
    name: input.name,
    unitPrice: input.unitPrice,
    updatedAt: nowIso(),
  };

  await db.batch([
    db
      .prepare(
        "UPDATE expense_presets SET name = ?, unit_price = ?, updated_at = ? WHERE id = ? AND group_id = ?",
      )
      .bind(after.name, after.unitPrice, after.updatedAt, presetId, groupId),
    logStatement(db, {
      groupId,
      actorUserId: user.id,
      actorName: actor.name,
      action: "preset.update",
      entityType: "preset",
      entityId: presetId,
      summary: `${actor.name} đã sửa mục mẫu "${after.name}" ${formatVnd(after.unitPrice)}`,
      detail: { before, after },
    }),
  ]);

  return ok({ preset: after });
});

/** Hard delete: expenses keep only their own title and total, so no history refers to a preset. */
export const DELETE = route(async (_req, ctx) => {
  const { groupId, presetId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);

  const db = getDb();
  const before = (await listPresets(db, groupId)).find((p) => p.id === presetId);
  if (!before) {
    throw notFound("Không tìm thấy mục mẫu.");
  }

  await db.batch([
    db.prepare("DELETE FROM expense_presets WHERE id = ? AND group_id = ?").bind(presetId, groupId),
    logStatement(db, {
      groupId,
      actorUserId: user.id,
      actorName: actor.name,
      action: "preset.delete",
      entityType: "preset",
      entityId: presetId,
      summary: `${actor.name} đã xóa mục mẫu "${before.name}"`,
      detail: { before },
    }),
  ]);

  return ok({});
});
