import { requireSessionResponse } from "../_lib/auth.js";
import { daysFromNow, json, nowIso, randomId, readJson, requireDb, safeText } from "../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get("deleted") === "1";
  const rows = await db.prepare(`
    SELECT p.*,
      COALESCE(l.count, 0) AS literature_count,
      COALESCE(d.bytes, 0) AS bytes
    FROM projects p
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS count FROM literature WHERE deleted_at IS NULL GROUP BY project_id
    ) l ON l.project_id = p.id
    LEFT JOIN (
      SELECT project_id, SUM(size_bytes) AS bytes FROM documents WHERE deleted_at IS NULL GROUP BY project_id
    ) d ON d.project_id = p.id
    WHERE ${includeDeleted ? "p.deleted_at IS NOT NULL" : "p.deleted_at IS NULL"}
    ORDER BY p.updated_at DESC
    LIMIT 100
  `).all();
  return json({ projects: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const body = await readJson(request);
  const title = safeText(body.title, "未命名项目").slice(0, 120) || "未命名项目";
  const now = nowIso();
  const id = randomId("prj");
  const settings = {
    batchLimit: Number(env.DEFAULT_BATCH_LIMIT || 15),
    pdfRetentionDays: Number(env.PDF_RETENTION_DAYS || 30),
    parseRetentionDays: Number(env.PARSE_RETENTION_DAYS || 30),
    maxPdfBytes: Number(env.MAX_PDF_BYTES || 15728640)
  };
  await db
    .prepare("INSERT INTO projects (id, title, question, status, created_by, settings_json, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)")
    .bind(id, title, safeText(body.question).slice(0, 2000), auth.session.phone, JSON.stringify(settings), now, now)
    .run();

  if (body.seedDemo === true) await seedDemoLiterature(db, id, now);
  return json({ ok: true, project: { id, title, question: safeText(body.question), status: "active", created_at: now, updated_at: now } }, 201);
}

async function seedDemoLiterature(db, projectId, now) {
  const samples = [
    ["AI assisted screening in systematic reviews", "10.0000/demo1", "PubMed", 2024],
    ["Large language models for evidence extraction", "10.0000/demo2", "Crossref", 2025],
    ["Open access full text retrieval workflow", "10.0000/demo3", "Europe PMC", 2023]
  ];
  for (const [title, doi, source, year] of samples) {
    const id = randomId("lit");
    await db
      .prepare("INSERT INTO literature (id, project_id, title, doi, source, year, abstract, screening_status, pdf_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'not_requested', ?, ?)")
      .bind(id, projectId, title, doi, source, year, "示例摘要，用于验证分页、初筛和资源释放流程。", now, now)
      .run();
  }
  await db
    .prepare("INSERT INTO documents (id, project_id, r2_key, kind, purpose, size_bytes, content_type, status, created_at, expires_at) VALUES (?, ?, ?, 'artifact', 'export', ?, 'text/csv', 'active', ?, ?)")
    .bind(randomId("doc"), projectId, `exports/${projectId}/demo.csv`, 2048, now, daysFromNow(7))
    .run();
}
