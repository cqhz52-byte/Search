import { requireSessionResponse } from "../../../_lib/auth.js";
import { json, nowIso, readJson, requireDb, safeText } from "../../../_lib/http.js";

const SCREENING_STATUSES = new Set(["include", "maybe", "exclude", "pending"]);

export async function onRequestPost({ request, env, params }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const body = await readJson(request);
  const status = safeText(body.status);
  if (!SCREENING_STATUSES.has(status)) return json({ error: "不支持的初筛状态。" }, 400);

  const now = nowIso();
  const existing = await db
    .prepare("SELECT id, project_id FROM literature WHERE id = ? AND deleted_at IS NULL")
    .bind(params.id)
    .first();
  if (!existing) return json({ error: "题录不存在。" }, 404);

  await db
    .prepare("UPDATE literature SET screening_status = ?, updated_at = ? WHERE id = ?")
    .bind(status, now, params.id)
    .run();
  return json({ ok: true, id: params.id, projectId: existing.project_id, status, updatedAt: now });
}
