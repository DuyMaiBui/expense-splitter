import { logStatement } from "@/lib/activity";
import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb, newId, nowIso } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { ok, readJson, route } from "@/lib/http";
import { listPresets, MAX_PRESETS_PER_GROUP, planSync } from "@/lib/presets";
import { bool, obj, str } from "@/lib/validate";

function parseBody(raw: unknown): { sourceGroupId: string; overwrite: boolean } {
  const body = obj(raw, "body");
  return {
    sourceGroupId: str(body.sourceGroupId, "sourceGroupId", { min: 1, max: 64 }),
    overwrite: body.overwrite === undefined ? false : bool(body.overwrite, "overwrite"),
  };
}

/**
 * Copies another group's presets into this one. The caller must be an active member of BOTH
 * groups, so a group id alone never exposes someone else's price list. Existing names are
 * skipped, or only re-priced when `overwrite` is true.
 */
export const POST = route(async (req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);
  const { sourceGroupId, overwrite } = await readJson(req, parseBody);

  if (sourceGroupId === groupId) {
    throw badRequest("Không thể đồng bộ mục mẫu từ chính nhóm này.");
  }
  await requireGroupMember(sourceGroupId, user);

  const db = getDb();
  const [source, target, sourceGroup] = await Promise.all([
    listPresets(db, sourceGroupId),
    listPresets(db, groupId),
    db.prepare("SELECT name FROM groups WHERE id = ?").bind(sourceGroupId).first<{ name: string }>(),
  ]);

  const plan = planSync(source, target, overwrite);
  if (target.length + plan.toAdd.length > MAX_PRESETS_PER_GROUP) {
    throw badRequest(
      `Đồng bộ sẽ vượt quá ${MAX_PRESETS_PER_GROUP} mục mẫu của nhóm. Hãy xóa bớt mục không dùng rồi thử lại.`,
    );
  }

  const changed = plan.toAdd.length + plan.toUpdate.length;
  if (changed === 0) {
    return ok({ added: 0, updated: 0, skipped: plan.skipped, presets: target });
  }

  const now = nowIso();
  const writes: D1PreparedStatement[] = [];

  // One statement per kind however many rows: the rows travel as one JSON parameter, which
  // keeps the batch at three statements and well inside D1's per-query bound-parameter cap.
  if (plan.toAdd.length > 0) {
    const rows = plan.toAdd.map((p) => ({ id: newId(), name: p.name, price: p.unitPrice }));
    writes.push(
      db
        .prepare(
          `INSERT INTO expense_presets (id, group_id, name, unit_price, created_at, updated_at)
           SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.name'),
                  json_extract(value, '$.price'), ?, ?
           FROM json_each(?)
           WHERE true
           ON CONFLICT (group_id, name) DO NOTHING`,
        )
        .bind(groupId, now, now, JSON.stringify(rows)),
    );
  }
  if (plan.toUpdate.length > 0) {
    const rows = plan.toUpdate.map((p) => ({ id: p.id, price: p.unitPrice }));
    writes.push(
      db
        .prepare(
          `UPDATE expense_presets
           SET unit_price = (SELECT json_extract(j.value, '$.price') FROM json_each(?1) j
                             WHERE json_extract(j.value, '$.id') = expense_presets.id),
               updated_at = ?2
           WHERE group_id = ?3
             AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`,
        )
        .bind(JSON.stringify(rows), now, groupId),
    );
  }

  const sourceName = sourceGroup?.name ?? "nhóm khác";
  writes.push(
    logStatement(db, {
      groupId,
      actorUserId: user.id,
      actorName: actor.name,
      action: "preset.sync",
      entityType: "group",
      entityId: groupId,
      summary:
        `${actor.name} đã đồng bộ mục mẫu từ nhóm "${sourceName}": ` +
        `thêm ${plan.toAdd.length}, cập nhật giá ${plan.toUpdate.length}, bỏ qua ${plan.skipped}`,
      detail: {
        sourceGroupId,
        overwrite,
        added: plan.toAdd.map((p) => p.name),
        updated: plan.toUpdate.length,
        skipped: plan.skipped,
      },
    }),
  );

  await db.batch(writes);

  return ok({
    added: plan.toAdd.length,
    updated: plan.toUpdate.length,
    skipped: plan.skipped,
    presets: await listPresets(db, groupId),
  });
});
