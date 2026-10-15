import { nowIso } from "./db";

/**
 * One row of `admin_audit`, returned unexecuted so it joins the same `db.batch` as the action
 * it records (the trail can never disagree with the data). `detail` must never hold a secret.
 */
export function auditStatement(
  db: D1Database,
  entry: {
    adminUserId: string;
    targetUserId?: string | null;
    action: string;
    detail?: object | null;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO admin_audit (admin_user_id, target_user_id, action, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.adminUserId,
      entry.targetUserId ?? null,
      entry.action,
      entry.detail ? JSON.stringify(entry.detail) : null,
      nowIso(),
    );
}
