import { requireSessionResponse } from "../../_lib/auth.js";
import { json, requireDb } from "../../_lib/http.js";

export async function onRequestGet({ request, env, params }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(params.id).first();
  if (!job) return json({ error: "任务不存在。" }, 404);
  return json({ job });
}
