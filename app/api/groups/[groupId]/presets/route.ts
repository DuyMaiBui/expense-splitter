import { logStatement } from "@/lib/activity";
import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb, newId, nowIso } from "@/lib/db";
import { badRequest, conflict } from "@/lib/errors";
import { formatVnd } from "@/lib/format";
import { sameName } from "@/lib/group-queries";
import { ok, readJson, route } from "@/lib/http";
import { listPresets, MAX_PRESETS_PER_GROUP, parsePresetBody } from "@/lib/presets";
import type { Preset } from "@/lib/types";

export const GET = route(async (_req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  await requireGroupMember(groupId, user);

  return ok({ presets: await listPresets(getDb(), groupId) });
});

export const POST = route(async (req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);
  const input = await readJson(req, parsePresetBody);

  const db = getDb();
  const existing = await listPresets(db, groupId);
  if (existing.length >= MAX_PRESETS_PER_GROUP) {
    throw badRequest(`Mỗi nhóm chỉ có tối đa ${MAX_PRESETS_PER_GROUP} mục mẫu.`);
  }
  if (existing.some((p) => sameName(p.name, input.name))) {
    throw conflict(`Nhóm đã có mục mẫu tên "${input.name}".`);
  }

  const now = nowIso();
  const preset: Preset = {
    id: newId(),
    groupId,
    name: input.name,
    unitPrice: input.unitPrice,
    createdAt: now,
    updatedAt: now,
  };

  await db.batch([
    db
      .prepare(
        `INSERT INTO expense_presets (id, group_id, name, unit_price, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(preset.id, groupId, preset.name, preset.unitPrice, now, now),
    logStatement(db, {
      groupId,
      actorUserId: user.id,
      actorName: actor.name,
      action: "preset.create",
      entityType: "preset",
      entityId: preset.id,
      summary: `${actor.name} đã thêm mục mẫu "${preset.name}" ${formatVnd(preset.unitPrice)}`,
      detail: { after: preset },
    }),
  ]);

  return ok({ preset }, 201);
});
