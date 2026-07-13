import { requireSessionResponse } from "../../../_lib/auth.js";
import { json, requireDb } from "../../../_lib/http.js";

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const docs = await db.prepare("SELECT r2_key FROM documents WHERE project_id = ? AND deleted_at IS NULL LIMIT 500").bind(params.id).all();
  for (const doc of docs.results || []) {
    if (env.LIT_R2) await env.LIT_R2.delete(doc.r2_key).catch(() => {});
  }
  await db.prepare("DELETE FROM projects WHERE id = ?").bind(params.id).run();
  return json({ ok: true, deletedObjects: (docs.results || []).length });
}
