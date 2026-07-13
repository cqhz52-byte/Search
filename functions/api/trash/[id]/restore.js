import { requireSessionResponse } from "../../../_lib/auth.js";
import { json, nowIso, requireDb } from "../../../_lib/http.js";

export async function onRequestPost({ request, env, params }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const now = nowIso();
  await db.prepare("UPDATE projects SET status = 'active', deleted_at = NULL, updated_at = ? WHERE id = ?").bind(now, params.id).run();
  return json({ ok: true });
}
