import { nowIso, randomId } from "./http.js";

export async function recordUsage(db, kind, units = 1, projectId = null) {
  await db
    .prepare("INSERT INTO usage_events (id, project_id, kind, amount, units, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(randomId("use"), projectId, kind, 1, units, nowIso())
    .run();
}

export async function dailyUsage(db) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .prepare("SELECT kind, COALESCE(SUM(units), 0) AS units FROM usage_events WHERE created_at >= ? GROUP BY kind")
    .bind(today.toISOString())
    .all();
  return Object.fromEntries((rows.results || []).map((row) => [row.kind, Number(row.units || 0)]));
}

export async function totalDailyUnits(db) {
  const usage = await dailyUsage(db);
  return Object.values(usage).reduce((sum, value) => sum + Number(value || 0), 0);
}

export async function deleteDocuments(db, r2, filters, limit = 100) {
  const clauses = ["deleted_at IS NULL"];
  const binds = [];
  if (filters.projectId) {
    clauses.push("project_id = ?");
    binds.push(filters.projectId);
  }
  if (filters.purpose) {
    clauses.push("purpose = ?");
    binds.push(filters.purpose);
  }
  if (filters.expiredBefore) {
    clauses.push("expires_at IS NOT NULL AND expires_at <= ?");
    binds.push(filters.expiredBefore);
  }
  if (filters.status) {
    clauses.push("status = ?");
    binds.push(filters.status);
  }
  const rows = await db
    .prepare(`SELECT id, r2_key, size_bytes FROM documents WHERE ${clauses.join(" AND ")} LIMIT ?`)
    .bind(...binds, limit)
    .all();
  const now = nowIso();
  let deletedCount = 0;
  let releasedBytes = 0;
  for (const row of rows.results || []) {
    if (r2) await r2.delete(row.r2_key).catch(() => {});
    await db.prepare("UPDATE documents SET deleted_at = ?, status = 'released' WHERE id = ?").bind(now, row.id).run();
    deletedCount += 1;
    releasedBytes += Number(row.size_bytes || 0);
  }
  return { deletedCount, releasedBytes };
}
