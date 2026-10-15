import { nowIso } from "./db";
import type { LogEntityType, LogAction } from "./types";

/**
 * Activity-log writes.
 *
 * The log row is returned as an unexecuted statement so the caller can add it to the same
 * `db.batch([...])` as its mutation — D1 applies a batch atomically, which is what keeps the
 * audit trail in lockstep with the data it describes.
 */

export interface LogStatementInput {
  groupId: string;
  actorUserId: string;
  actorName: string;
  action: LogAction;
  entityType: LogEntityType;
  entityId: string;
  summary: string;
  detail?: object | null;
}

export function logStatement(db: D1Database, entry: LogStatementInput): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activity_log
         (group_id, actor_user_id, actor_name, action, entity_type, entity_id, summary, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.groupId,
      entry.actorUserId,
      entry.actorName,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.summary,
      entry.detail === undefined || entry.detail === null ? null : JSON.stringify(entry.detail),
      nowIso(),
    );
}
