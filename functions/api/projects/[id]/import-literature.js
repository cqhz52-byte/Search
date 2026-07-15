import { requireSessionResponse } from "../../../_lib/auth.js";
import { json, nowIso, randomId, readJson, requireDb, safeText } from "../../../_lib/http.js";

export async function onRequestPost({ request, env, params }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;

  const db = requireDb(env);
  const project = await db.prepare("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL").bind(params.id).first();
  if (!project) return json({ error: "项目不存在。" }, 404);

  const body = await readJson(request);
  const source = safeText(body.source || "CNKI/知网").slice(0, 80);
  const records = Array.isArray(body.records) ? body.records.slice(0, 500) : [];
  if (!records.length) return json({ error: "没有可导入的题录。" }, 400);

  const now = nowIso();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const item of records) {
    const record = normalizeImportedRecord(item, source);
    if (!record.title) {
      skipped += 1;
      continue;
    }

    const existing = await db.prepare(`
      SELECT id FROM literature
      WHERE project_id = ?
        AND deleted_at IS NULL
        AND (
          (doi <> '' AND doi = ?)
          OR (pmid <> '' AND pmid = ?)
          OR (pmcid <> '' AND pmcid = ?)
          OR lower(title) = lower(?)
        )
      LIMIT 1
    `).bind(params.id, record.doi || "__none__", record.pmid || "__none__", record.pmcid || "__none__", record.title).first();

    if (existing) {
      await db.prepare("UPDATE literature SET title = ?, doi = ?, pmid = ?, pmcid = ?, source = ?, year = ?, journal = ?, abstract = ?, updated_at = ? WHERE id = ?")
        .bind(record.title, record.doi, record.pmid, record.pmcid, record.source, record.year, record.journal, record.abstract, now, existing.id)
        .run();
      updated += 1;
    } else {
      await db.prepare("INSERT INTO literature (id, project_id, title, doi, pmid, pmcid, source, year, journal, abstract, screening_status, pdf_status, parse_status, extraction_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'not_requested', 'not_requested', 'not_requested', ?, ?)")
        .bind(randomId("lit"), params.id, record.title, record.doi, record.pmid, record.pmcid, record.source, record.year, record.journal, record.abstract, now, now)
        .run();
      inserted += 1;
    }
  }

  return json({ ok: true, inserted, updated, skipped, total: records.length });
}

function normalizeImportedRecord(item, source) {
  const title = safeText(item.title || item["题名"] || item["标题"] || item["篇名"] || item.TI || item.Title).slice(0, 500);
  const abstract = safeText(item.abstract || item["摘要"] || item.AB || item.Abstract).replace(/\s+/g, " ").slice(0, 4000);
  const journal = safeText(item.journal || item["来源"] || item["刊名"] || item["期刊"] || item.JO || item.JF).slice(0, 200);
  const yearValue = safeText(item.year || item["年份"] || item["年"] || item.PY || item.Year);
  const year = Number((yearValue.match(/\d{4}/) || [0])[0]) || null;
  return {
    title,
    abstract,
    journal,
    year,
    source: safeText(item.source || source).slice(0, 80),
    doi: safeText(item.doi || item.DOI).slice(0, 200),
    pmid: safeText(item.pmid || item.PMID).slice(0, 80),
    pmcid: safeText(item.pmcid || item.PMCID).replace(/^PMC/i, "PMC").slice(0, 80)
  };
}
