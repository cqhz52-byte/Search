import { requireSessionResponse } from "../../_lib/auth.js";
import { json, nowIso, requireDb } from "../../_lib/http.js";

export async function onRequestGet({ request, env, params }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const project = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(params.id).first();
  if (!project) return json({ error: "项目不存在。" }, 404);
  const literature = await db
    .prepare("SELECT id, title, doi, pmid, source, year, screening_status, pdf_status, parse_status, extraction_status FROM literature WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500")
    .bind(params.id)
    .all();
  const jobs = await db.prepare("SELECT * FROM jobs WHERE project_id = ? ORDER BY updated_at DESC LIMIT 20").bind(params.id).all();
  return json({ project, literature: literature.results || [], jobs: jobs.results || [] });
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const now = nowIso();
  await db.prepare("UPDATE projects SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, params.id).run();
  await db.prepare("UPDATE jobs SET status = 'paused', paused_at = ?, updated_at = ? WHERE project_id = ? AND status IN ('queued', 'running')").bind(now, now, params.id).run();
  return json({ ok: true, deletedAt: now });
}
