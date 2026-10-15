import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { ok, route } from "@/lib/http";
import type { LogAction, LogEntityType, LogEntry } from "@/lib/types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface LogRow {
  id: number;
  group_id: string;
  actor_user_id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  detail_json: string | null;
  created_at: string;
}

function parseDetail(json: string | null): Record<string, unknown> | null {
  if (json === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    // A corrupt detail blob must not take the whole log page down.
    return null;
  }
}

export const GET = route(async (req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  await requireGroupMember(groupId, user);

  const params = new URL(req.url).searchParams;

  let limit = DEFAULT_LIMIT;
  const limitParam = params.get("limit");
  if (limitParam !== null) {
    limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1) {
      throw badRequest('Tham số "limit" phải là số nguyên dương.');
    }
    limit = Math.min(limit, MAX_LIMIT);
  }

  const beforeParam = params.get("before");
  if (beforeParam !== null && !/^\d+$/.test(beforeParam)) {
    throw badRequest('Tham số "before" không hợp lệ.');
  }

  const columns = `id, group_id, actor_user_id, actor_name, action, entity_type, entity_id,
                   summary, detail_json, created_at`;
  const db = getDb();
  const statement =
    beforeParam === null
      ? db
          .prepare(
            `SELECT ${columns} FROM activity_log WHERE group_id = ? ORDER BY id DESC LIMIT ?`,
          )
          .bind(groupId, limit)
      : db
          .prepare(
            `SELECT ${columns} FROM activity_log
             WHERE group_id = ? AND id < ? ORDER BY id DESC LIMIT ?`,
          )
          .bind(groupId, Number(beforeParam), limit);

  const { results } = await statement.all<LogRow>();

  const entries: LogEntry[] = results.map((row) => ({
    id: String(row.id),
    groupId: row.group_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    action: row.action as LogAction,
    entityType: row.entity_type as LogEntityType,
    entityId: row.entity_id,
    summary: row.summary,
    detail: parseDetail(row.detail_json),
    createdAt: row.created_at,
  }));

  // A full page may have more behind it; a short page is the end of the log.
  const last = entries[entries.length - 1];
  const nextBefore = entries.length === limit && last ? last.id : null;

  return ok({ entries, nextBefore });
});
