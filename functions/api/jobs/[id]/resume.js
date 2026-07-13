import { requireSessionResponse } from "../../../_lib/auth.js";
import { recordUsage, totalDailyUnits } from "../../../_lib/resources.js";
import { getDailyLimit, json, nowIso, requireDb } from "../../../_lib/http.js";

export async function onRequestPost({ request, env, params }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(params.id).first();
  if (!job) return json({ error: "任务不存在。" }, 404);

  const used = await totalDailyUnits(db);
  const dailyLimit = getDailyLimit(env);
  const nextStatus = used >= dailyLimit ? "paused_quota" : "queued";
  const now = nowIso();
  await db.prepare("UPDATE jobs SET status = ?, paused_at = NULL, updated_at = ? WHERE id = ?").bind(nextStatus, now, params.id).run();
  await recordUsage(db, `job:${job.type}:resume`, 1, job.project_id);

  if (env.LIT_QUEUE && nextStatus === "queued") {
    await env.LIT_QUEUE.send({ jobId: job.id, projectId: job.project_id, type: job.type, batchLimit: job.batch_limit }).catch(() => {});
  }
  return json({ ok: true, status: nextStatus });
}
