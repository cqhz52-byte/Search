import { requireSessionResponse } from "../_lib/auth.js";
import { recordUsage, totalDailyUnits } from "../_lib/resources.js";
import { getBatchLimit, getDailyLimit, json, nowIso, randomId, readJson, requireDb, safeText } from "../_lib/http.js";

const HEAVY_JOB_TYPES = new Set([
  "expand_query",
  "search_abstracts",
  "analyze_abstracts",
  "generate_download_list",
  "download_pdfs",
  "parse_and_analyze_pdfs",
  "generate_analysis_results"
]);

export async function onRequestPost({ request, env }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const body = await readJson(request);
  const type = safeText(body.type, "expand_query");
  if (!HEAVY_JOB_TYPES.has(type)) return json({ error: "不支持的任务类型。" }, 400);
  const projectId = safeText(body.projectId);
  if (!projectId) return json({ error: "缺少项目 ID。" }, 400);

  const project = await db.prepare("SELECT id, status FROM projects WHERE id = ? AND deleted_at IS NULL").bind(projectId).first();
  if (!project) return json({ error: "项目不存在。" }, 404);
  if (project.status === "archived") return json({ error: "项目已归档，不能启动新任务。" }, 409);

  const running = await db
    .prepare("SELECT id FROM jobs WHERE project_id = ? AND status IN ('queued', 'running', 'paused_quota') LIMIT 1")
    .bind(projectId)
    .first();
  if (running) return json({ error: "同一项目一次只允许一个重任务运行。", jobId: running.id }, 409);

  const used = await totalDailyUnits(db);
  const dailyLimit = getDailyLimit(env);
  const status = used >= dailyLimit ? "paused_quota" : "queued";
  const now = nowIso();
  const job = {
    id: randomId("job"),
    projectId,
    type,
    status,
    batchLimit: getBatchLimit(env, body.batchLimit),
    totalCount: Math.max(0, Math.min(Number(body.totalCount || 0), 500))
  };
  await db
    .prepare("INSERT INTO jobs (id, project_id, type, status, batch_limit, total_count, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(job.id, job.projectId, job.type, job.status, job.batchLimit, job.totalCount, JSON.stringify(body.payload || {}), now, now)
    .run();
  await recordUsage(db, `job:${type}:created`, 1, projectId);

  if (env.LIT_QUEUE && status === "queued") {
    await env.LIT_QUEUE.send({ jobId: job.id, projectId, type, batchLimit: job.batchLimit }).catch(() => {});
  }
  return json({ ok: true, job }, 201);
}
