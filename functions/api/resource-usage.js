import { requireSessionResponse } from "../_lib/auth.js";
import { dailyUsage } from "../_lib/resources.js";
import { getDailyLimit, json, requireDb } from "../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);

  const [documents, d1Counts, projectRows, usage] = await Promise.all([
    db.prepare(`
      SELECT purpose, COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes
      FROM documents
      WHERE deleted_at IS NULL
      GROUP BY purpose
    `).all(),
    collectCounts(db),
    db.prepare(`
      SELECT p.id, p.title, p.status,
        COALESCE(l.count, 0) AS literature_count,
        COALESCE(d.bytes, 0) AS bytes
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) AS count FROM literature WHERE deleted_at IS NULL GROUP BY project_id
      ) l ON l.project_id = p.id
      LEFT JOIN (
        SELECT project_id, SUM(size_bytes) AS bytes FROM documents WHERE deleted_at IS NULL GROUP BY project_id
      ) d ON d.project_id = p.id
      WHERE p.deleted_at IS NULL
      ORDER BY bytes DESC, literature_count DESC
      LIMIT 8
    `).all(),
    dailyUsage(db)
  ]);

  const byPurpose = {};
  let totalBytes = 0;
  let totalObjects = 0;
  for (const row of documents.results || []) {
    byPurpose[row.purpose] = { count: Number(row.count || 0), bytes: Number(row.bytes || 0) };
    totalBytes += Number(row.bytes || 0);
    totalObjects += Number(row.count || 0);
  }
  const usedUnits = Object.values(usage).reduce((sum, value) => sum + Number(value || 0), 0);
  const dailyLimit = getDailyLimit(env);

  return json({
    r2: { totalBytes, totalObjects, byPurpose },
    d1: d1Counts,
    today: { usage, usedUnits, dailyLimit, remainingUnits: Math.max(0, dailyLimit - usedUnits) },
    projects: projectRows.results || []
  });
}

async function collectCounts(db) {
  const queries = {
    projects: "SELECT COUNT(*) AS count FROM projects WHERE deleted_at IS NULL",
    literature: "SELECT COUNT(*) AS count FROM literature WHERE deleted_at IS NULL",
    extractions: "SELECT COUNT(*) AS count FROM extractions",
    jobs: "SELECT COUNT(*) AS count FROM jobs",
    documents: "SELECT COUNT(*) AS count FROM documents WHERE deleted_at IS NULL"
  };
  const result = {};
  for (const [key, sql] of Object.entries(queries)) {
    const row = await db.prepare(sql).first();
    result[key] = Number(row?.count || 0);
  }
  return result;
}
