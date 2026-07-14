import { requireSessionResponse } from "../../../_lib/auth.js";
import { json, nowIso, randomId, readJson, requireDb, safeText } from "../../../_lib/http.js";
import { recordUsage } from "../../../_lib/resources.js";

const DEEPSEEK_KEY = "provider:deepseek_api_key";
const STEP_TYPES = new Set([
  "expand_query",
  "search_abstracts",
  "analyze_abstracts",
  "generate_download_list",
  "download_pdfs",
  "parse_and_analyze_pdfs",
  "generate_analysis_results"
]);

export async function onRequestPost({ request, env, params }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const body = await readJson(request);
  const type = safeText(body.type);
  if (!STEP_TYPES.has(type)) return json({ error: "不支持的流程步骤。" }, 400);

  const project = await db.prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL").bind(params.id).first();
  if (!project) return json({ error: "项目不存在。" }, 404);
  if (project.status === "archived") return json({ error: "项目已归档，不能执行流程。" }, 409);

  const context = { request, env, db, project, type, now: nowIso() };
  const artifact = await runStep(context);
  const literatureCount = await db.prepare("SELECT COUNT(*) AS count FROM literature WHERE project_id = ? AND deleted_at IS NULL").bind(project.id).first();
  const job = await saveCompletedJob(context, artifact, Number(literatureCount?.count || 0));
  await recordUsage(db, `job:${type}:completed`, aiStep(type) ? 5 : 2, project.id);
  return json({ ok: true, job, artifact });
}

async function runStep(context) {
  const runners = {
    expand_query: runExpandQuery,
    search_abstracts: runSearchAbstracts,
    analyze_abstracts: runAnalyzeAbstracts,
    generate_download_list: runGenerateDownloadList,
    download_pdfs: runDownloadPdfs,
    parse_and_analyze_pdfs: runParseAndAnalyzePdfs,
    generate_analysis_results: runGenerateAnalysisResults
  };
  return runners[context.type](context);
}

async function runExpandQuery(context) {
  const key = await getDeepseekKey(context.db);
  const prompt = [
    "你是循证医学文献检索专家。任务是“检索词扩充”，不是翻译。请基于研究问题识别 PICO 后，为每个核心概念扩展同义词、近义词、缩写、全称、旧称、商品名/设备名、技术变体、MeSH/自由词、中文常用别名和英文常用别名。",
    "关键要求：不能只给原词和直译；每个核心概念尽量给 6-15 个可检索变体；如果术语有缩写或临床俗称必须列出。",
    "示例：不可逆电穿孔不能只翻译成 irreversible electroporation，还应扩展 IRE、pulsed electric field、PEF、electric field ablation、electrical field ablation、NanoKnife、steep pulse、陡脉冲、脉冲电场、电场消融、脉冲电场消融、纳米刀等。",
    "请输出紧凑 JSON，不要输出 Markdown。",
    "JSON schema: {\"pico\":{\"P\":\"\",\"I\":\"\",\"C\":\"\",\"O\":\"\"},\"concepts\":[{\"name\":\"\",\"role\":\"P|I|C|O|other\",\"en\":[],\"zh\":[],\"mesh\":[],\"freeText\":[]}],\"terms\":{\"en\":[],\"zh\":[]},\"queries\":{\"pubmed\":\"\",\"europePmc\":\"\",\"cn\":\"\"},\"notes\":[]}",
    `项目名称：${context.project.title}`,
    `研究问题：${context.project.question || context.project.title}`
  ].join("\n");
  const data = await deepseekJson(key, prompt);
  const conceptRows = Array.isArray(data.concepts) ? data.concepts.map((item) => ({
    "概念": item.name || "-",
    "角色": item.role || "-",
    "英文扩展": asList(item.en).join("; "),
    "中文扩展": asList(item.zh).join("；"),
    "MeSH/主题词": asList(item.mesh).join("; ")
  })) : [];
  const sections = [
    { title: "PICO 拆解", rows: Object.entries(data.pico || {}).map(([keyName, value]) => ({ "维度": keyName, "内容": value || "-" })) },
    ...(conceptRows.length ? [{ title: "按概念扩展的检索词", rows: conceptRows }] : []),
    { title: "英文扩展词", items: asList(data.terms?.en) },
    { title: "中文扩展词", items: asList(data.terms?.zh) },
    { title: "Europe PMC 检索式", code: data.queries?.europePmc || data.queries?.pubmed || context.project.question || context.project.title },
    { title: "PubMed 检索式", code: data.queries?.pubmed || data.queries?.europePmc || context.project.question || context.project.title },
    { title: "中文数据库检索式", code: data.queries?.cn || "" }
  ];
  return { type: context.type, status: "completed", summary: "DeepSeek 已生成真实检索扩充策略。", data, sections };
}

async function runSearchAbstracts(context) {
  const latest = await latestArtifact(context.db, context.project.id, "expand_query");
  const query = latest?.data?.queries?.europePmc || latest?.data?.queries?.pubmed || context.project.question || context.project.title;
  const records = await searchEuropePmc(query, 15);
  let inserted = 0;
  for (const record of records) {
    if (await upsertLiterature(context.db, context.project.id, record, context.now)) inserted += 1;
  }
  const rows = records.map((item) => ({ "题名": item.title, "来源": item.source || "Europe PMC", "年份": item.year || "-", "摘要": item.abstract || "无摘要" }));
  return {
    type: context.type,
    status: "completed",
    summary: `已真实检索 Europe PMC，获得 ${records.length} 条摘要，新增 ${inserted} 条题录。`,
    data: { query, count: records.length, inserted },
    sections: [
      { title: "实际检索式", code: query },
      { title: "摘要结果", rows }
    ]
  };
}

async function runAnalyzeAbstracts(context) {
  const key = await getDeepseekKey(context.db);
  const literature = await getLiterature(context.db, context.project.id, 20);
  if (!literature.length) return emptyArtifact(context.type, "还没有题录，请先执行“检索摘要”。");
  const compact = literature.map((item) => ({ id: item.id, title: item.title, abstract: item.abstract, year: item.year, source: item.source }));
  const prompt = [
    "你是系统综述初筛助手。请仅输出 JSON。",
    "JSON schema: {\"decisions\":[{\"id\":\"\",\"decision\":\"include|maybe|exclude\",\"reason\":\"\"}],\"summary\":\"\"}",
    `研究问题：${context.project.question || context.project.title}`,
    `题录摘要：${JSON.stringify(compact).slice(0, 12000)}`
  ].join("\n");
  const data = await deepseekJson(key, prompt);
  const decisions = Array.isArray(data.decisions) ? data.decisions : [];
  for (const decision of decisions) {
    const status = ["include", "maybe", "exclude"].includes(decision.decision) ? decision.decision : "maybe";
    await context.db.prepare("UPDATE literature SET screening_status = ?, updated_at = ? WHERE id = ? AND project_id = ?")
      .bind(status, context.now, safeText(decision.id), context.project.id)
      .run();
  }
  return {
    type: context.type,
    status: "completed",
    summary: data.summary || `DeepSeek 已真实分析 ${decisions.length} 条摘要。`,
    data,
    sections: [
      { title: "AI 初筛判断", rows: decisions.map((item) => ({ "题录ID": item.id, "判断": item.decision, "理由": item.reason || "" })) }
    ]
  };
}

async function runGenerateDownloadList(context) {
  const rows = await getCandidateLiterature(context.db, context.project.id, 50);
  for (const row of rows) {
    await context.db.prepare("UPDATE literature SET pdf_status = ?, updated_at = ? WHERE id = ?")
      .bind(row.pmcid ? "listed" : "manual_required", context.now, row.id)
      .run();
  }
  return {
    type: context.type,
    status: "completed",
    summary: `已基于纳入/待定文献生成 ${rows.length} 条真实下载清单。`,
    data: { count: rows.length },
    sections: [
      { title: "全文下载清单", rows: rows.map((item) => ({ "题名": item.title, "DOI": item.doi || "-", "PMCID": item.pmcid || "-", "状态": item.pmcid ? "可尝试开放全文" : "需人工下载" })) }
    ]
  };
}

async function runDownloadPdfs(context) {
  const rows = (await getCandidateLiterature(context.db, context.project.id, 10)).filter((item) => item.pmcid);
  const results = [];
  for (const item of rows.slice(0, 3)) {
    const result = await tryDownloadOpenPdf(context, item);
    results.push({ "题名": item.title, "PMCID": item.pmcid, "下载": result });
  }
  return {
    type: context.type,
    status: "completed",
    summary: `已小批量尝试下载开放获取 PDF：${results.length} 条。`,
    data: { attempted: results.length },
    sections: [{ title: "PDF 下载结果", rows: results }]
  };
}

async function runParseAndAnalyzePdfs(context) {
  const key = await getDeepseekKey(context.db);
  const literature = await getCandidateLiterature(context.db, context.project.id, 10);
  if (!literature.length) return emptyArtifact(context.type, "还没有纳入/待定文献，请先执行摘要分析。");
  const prompt = [
    "请基于以下文献题名和摘要做结构化证据提取。仅输出 JSON。",
    "JSON schema: {\"rows\":[{\"id\":\"\",\"purpose\":\"\",\"intervention\":\"\",\"outcomes\":\"\",\"limitations\":\"\"}],\"summary\":\"\"}",
    JSON.stringify(literature.map((item) => ({ id: item.id, title: item.title, abstract: item.abstract }))).slice(0, 12000)
  ].join("\n");
  const data = await deepseekJson(key, prompt);
  const rows = Array.isArray(data.rows) ? data.rows : [];
  for (const item of rows) {
    const lit = literature.find((row) => row.id === item.id);
    if (!lit) continue;
    await context.db.prepare("INSERT INTO extractions (id, project_id, literature_id, status, confidence, compact_json, source_refs_json, created_at, updated_at) VALUES (?, ?, ?, 'draft', 0.7, ?, '[]', ?, ?)")
      .bind(randomId("ext"), context.project.id, lit.id, JSON.stringify(item), context.now, context.now)
      .run();
    await context.db.prepare("UPDATE literature SET extraction_status = 'done', parse_status = CASE WHEN parse_status = 'not_requested' THEN 'abstract_only' ELSE parse_status END, updated_at = ? WHERE id = ?")
      .bind(context.now, lit.id)
      .run();
  }
  return {
    type: context.type,
    status: "completed",
    summary: data.summary || "DeepSeek 已基于摘要/可用全文字段生成结构化提取。",
    data,
    sections: [{ title: "结构化提取", rows: rows.map((item) => ({ "题录ID": item.id, "研究目的": item.purpose, "干预方式": item.intervention, "结局指标": item.outcomes, "证据限制": item.limitations })) }]
  };
}

async function runGenerateAnalysisResults(context) {
  const key = await getDeepseekKey(context.db);
  const literature = await getCandidateLiterature(context.db, context.project.id, 30);
  const prompt = [
    "请基于候选文献生成系统综述证据链草稿。仅输出 JSON。",
    "JSON schema: {\"conclusion\":\"\",\"evidenceChain\":[],\"limitations\":[],\"nextSteps\":[]}",
    `研究问题：${context.project.question || context.project.title}`,
    JSON.stringify(literature.map((item) => ({ title: item.title, abstract: item.abstract, screening: item.screening_status }))).slice(0, 12000)
  ].join("\n");
  const data = await deepseekJson(key, prompt);
  return {
    type: context.type,
    status: "completed",
    summary: data.conclusion || "DeepSeek 已生成分析结果草稿。",
    data,
    sections: [
      { title: "初步结论", body: data.conclusion || "" },
      { title: "证据链", items: data.evidenceChain || [] },
      { title: "证据限制", items: data.limitations || [] },
      { title: "下一步", items: data.nextSteps || [] }
    ]
  };
}

async function saveCompletedJob(context, artifact, totalCount) {
  const id = randomId("job");
  await context.db
    .prepare("INSERT INTO jobs (id, project_id, type, status, batch_limit, processed_count, total_count, cost_units, payload_json, created_at, updated_at, completed_at) VALUES (?, ?, ?, 'completed', 15, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, context.project.id, context.type, totalCount, totalCount, aiStep(context.type) ? 5 : 2, JSON.stringify({ artifact }), context.now, context.now, context.now)
    .run();
  return { id, project_id: context.project.id, type: context.type, status: "completed", batch_limit: 15, processed_count: totalCount, total_count: totalCount, payload_json: JSON.stringify({ artifact }), updated_at: context.now };
}

async function getDeepseekKey(db) {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(DEEPSEEK_KEY).first();
  const key = safeText(row?.value);
  if (!key) throw new Error("请先在管理页配置 DeepSeek API Key。");
  return key;
}

async function deepseekJson(apiKey, prompt) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "你只输出合法 JSON，不输出 Markdown。" },
        { role: "user", content: prompt }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`DeepSeek 调用失败：${response.status} ${text.slice(0, 120)}`);
  const data = JSON.parse(text);
  const content = data.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content);
}

async function searchEuropePmc(query, pageSize) {
  const clean = safeText(query).replace(/\[[^\]]+\]/g, "").replace(/[“”]/g, "\"").slice(0, 500) || "systematic review";
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=${pageSize}&query=${encodeURIComponent(clean)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Europe PMC 检索失败：${response.status}`);
  const data = await response.json();
  return (data.resultList?.result || []).map((item) => ({
    title: safeText(item.title, "Untitled").slice(0, 500),
    doi: safeText(item.doi),
    pmid: safeText(item.pmid),
    pmcid: safeText(item.pmcid),
    source: "Europe PMC",
    year: Number(item.pubYear || 0) || null,
    journal: safeText(item.journalTitle).slice(0, 200),
    abstract: safeText(item.abstractText).replace(/<[^>]+>/g, " ").slice(0, 4000)
  }));
}

async function upsertLiterature(db, projectId, item, now) {
  const existing = await db.prepare("SELECT id FROM literature WHERE project_id = ? AND ((doi <> '' AND doi = ?) OR (pmid <> '' AND pmid = ?) OR (pmcid <> '' AND pmcid = ?)) LIMIT 1")
    .bind(projectId, item.doi || "__none__", item.pmid || "__none__", item.pmcid || "__none__")
    .first();
  if (existing) {
    await db.prepare("UPDATE literature SET title = ?, source = ?, year = ?, journal = ?, abstract = ?, updated_at = ? WHERE id = ?")
      .bind(item.title, item.source, item.year, item.journal, item.abstract, now, existing.id)
      .run();
    return false;
  }
  await db.prepare("INSERT INTO literature (id, project_id, title, doi, pmid, pmcid, source, year, journal, abstract, screening_status, pdf_status, parse_status, extraction_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'not_requested', 'not_requested', 'not_requested', ?, ?)")
    .bind(randomId("lit"), projectId, item.title, item.doi, item.pmid, item.pmcid, item.source, item.year, item.journal, item.abstract, now, now)
    .run();
  return true;
}

async function latestArtifact(db, projectId, type) {
  const row = await db.prepare("SELECT payload_json FROM jobs WHERE project_id = ? AND type = ? AND status = 'completed' ORDER BY updated_at DESC LIMIT 1").bind(projectId, type).first();
  try {
    return JSON.parse(row?.payload_json || "{}").artifact || null;
  } catch {
    return null;
  }
}

async function getLiterature(db, projectId, limit) {
  const rows = await db.prepare("SELECT * FROM literature WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?").bind(projectId, limit).all();
  return rows.results || [];
}

async function getCandidateLiterature(db, projectId, limit) {
  const rows = await db.prepare("SELECT * FROM literature WHERE project_id = ? AND deleted_at IS NULL AND screening_status IN ('include', 'maybe') ORDER BY updated_at DESC LIMIT ?").bind(projectId, limit).all();
  return rows.results || [];
}

async function tryDownloadOpenPdf(context, item) {
  if (!context.env.LIT_R2) return "未绑定 R2，已保留下载清单";
  const url = `https://europepmc.org/articles/${encodeURIComponent(item.pmcid)}?pdf=render`;
  try {
    const response = await fetch(url);
    if (!response.ok) return `失败 ${response.status}`;
    const size = Number(response.headers.get("content-length") || 0);
    const max = Number(context.env.MAX_PDF_BYTES || 15728640);
    if (size && size > max) return "超过单文件大小限制";
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > max) return "超过单文件大小限制";
    const key = `pdf/${context.project.id}/${item.id}.pdf`;
    await context.env.LIT_R2.put(key, buffer, { httpMetadata: { contentType: "application/pdf" } });
    await context.db.prepare("INSERT OR REPLACE INTO documents (id, project_id, literature_id, r2_key, kind, purpose, size_bytes, content_type, status, created_at, last_accessed_at, expires_at) VALUES (?, ?, ?, ?, 'pdf', 'pdf', ?, 'application/pdf', 'active', ?, ?, ?)")
      .bind(randomId("doc"), context.project.id, item.id, key, buffer.byteLength, context.now, context.now, context.now)
      .run();
    await context.db.prepare("UPDATE literature SET pdf_status = 'downloaded', updated_at = ? WHERE id = ?").bind(context.now, item.id).run();
    return `已下载 ${Math.round(buffer.byteLength / 1024)} KB`;
  } catch (error) {
    return `失败：${error.message}`;
  }
}

function emptyArtifact(type, summary) {
  return { type, status: "completed", summary, data: {}, sections: [{ title: "提示", body: summary }] };
}

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => safeText(item)).filter(Boolean);
  const text = safeText(value);
  return text ? [text] : [];
}

function aiStep(type) {
  return ["expand_query", "analyze_abstracts", "parse_and_analyze_pdfs", "generate_analysis_results"].includes(type);
}
