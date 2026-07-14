const APP_VERSION = "2026.07.14.2";

const state = {
  usage: null,
  projects: [],
  trash: [],
  users: [],
  detail: null,
  selectedId: "",
  message: "",
  loading: false,
  busy: {},
  mobileTab: localStorage.getItem("lit_mobile_tab") || "workflow",
  updateNotice: localStorage.getItem("lit_seen_version") !== APP_VERSION,
  executionMode: localStorage.getItem("lit_execution_mode") || "local",
  localJobs: loadLocalJobs(),
  localTimers: {},
  loginOpen: false
};

const jobLabels = {
  expand_query: "AI 扩充检索内容",
  search_abstracts: "检索摘要",
  analyze_abstracts: "AI 分析摘要",
  generate_download_list: "生成下载列表",
  download_pdfs: "开始下载全文",
  parse_and_analyze_pdfs: "解析全文并 AI 分析",
  generate_analysis_results: "生成分析结果"
};

const jobNotes = {
  expand_query: "扩展 PICO、同义词、MeSH/关键词和布尔逻辑。",
  search_abstracts: "按小批量检索题录与摘要，只保存必要元数据。",
  analyze_abstracts: "根据纳入/排除标准聚焦到候选文献。",
  generate_download_list: "整理 DOI、PMID、开放全文入口和失败待办。",
  download_pdfs: "仅下载开放或已授权来源，避免反复重试。",
  parse_and_analyze_pdfs: "LlamaParse 识别解析，DeepSeek 结构化提取。",
  generate_analysis_results: "生成证据表、限制说明和结论草稿。"
};

const app = document.querySelector("#app");

async function api(path, options = {}) {
  try {
    const response = await fetch(path, {
      credentials: "include",
      headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers,
      ...options
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } catch (error) {
    if (location.hostname === "127.0.0.1" || location.hostname === "localhost") return demoResponse(path, options);
    throw error;
  }
}

const Api = {
  session: () => api("/api/auth/session"),
  login: (phone, password) => api("/api/auth/login", { method: "POST", body: JSON.stringify({ phone, password }) }),
  resourceUsage: () => api("/api/resource-usage"),
  projects: (deleted = false) => api(`/api/projects${deleted ? "?deleted=1" : ""}`),
  createProject: (title, question) => api("/api/projects", { method: "POST", body: JSON.stringify({ title, question, seedDemo: true }) }),
  project: (id) => api(`/api/projects/${id}`),
  archiveProject: (id) => api(`/api/projects/${id}/archive`, { method: "POST" }),
  deleteProject: (id) => api(`/api/projects/${id}`, { method: "DELETE" }),
  releasePdfs: (id) => api(`/api/projects/${id}/release-pdfs`, { method: "POST" }),
  releaseParseArtifacts: (id) => api(`/api/projects/${id}/release-parse-artifacts`, { method: "POST" }),
  cleanupTemp: () => api("/api/resource-cleanup/temp", { method: "POST" }),
  createJob: (projectId, type) => api("/api/jobs", { method: "POST", body: JSON.stringify({ projectId, type, batchLimit: 15, totalCount: 120 }) }),
  pauseJob: (id) => api(`/api/jobs/${id}/pause`, { method: "POST" }),
  resumeJob: (id) => api(`/api/jobs/${id}/resume`, { method: "POST" }),
  restore: (id) => api(`/api/trash/${id}/restore`, { method: "POST" }),
  permanentDelete: (id) => api(`/api/trash/${id}/permanent`, { method: "DELETE" })
  ,
  users: () => api("/api/admin/users"),
  saveUser: (payload) => api("/api/admin/users", { method: "POST", body: JSON.stringify(payload) }),
  deleteUser: (phone) => api(`/api/admin/users?phone=${encodeURIComponent(phone)}`, { method: "DELETE" })
};


function loadLocalJobs() {
  try {
    return JSON.parse(localStorage.getItem("lit_local_jobs") || "[]");
  } catch {
    return [];
  }
}

function saveLocalJobs() {
  localStorage.setItem("lit_local_jobs", JSON.stringify(state.localJobs.slice(0, 200)));
}

function mergeLocalJobs(detail) {
  if (!detail || !detail.project || !detail.project.id) return detail;
  const localJobs = state.localJobs.filter((job) => job.project_id === detail.project.id);
  const serverJobs = detail.jobs || [];
  const seen = new Set(localJobs.map((job) => job.id));
  detail.jobs = localJobs.concat(serverJobs.filter((job) => !seen.has(job.id)));
  return detail;
}

function setExecutionMode(mode) {
  state.executionMode = mode === "cloud" ? "cloud" : "local";
  localStorage.setItem("lit_execution_mode", state.executionMode);
  state.message = state.executionMode === "local" ? "\u5df2\u5207\u6362\u4e3a\u672c\u673a\u5904\u7406\u6a21\u5f0f" : "\u5df2\u5207\u6362\u4e3a Cloudflare \u4efb\u52a1\u6a21\u5f0f";
  render();
}

function createPipelineJob(projectId, type) {
  if (state.executionMode === "cloud") return Api.createJob(projectId, type);
  const job = normalizeJob({
    id: "local_" + Date.now() + "_" + Math.random().toString(16).slice(2),
    project_id: projectId,
    type,
    status: "running",
    batch_limit: 15,
    processed_count: 0,
    total_count: localJobTotal(type),
    local: true,
    updated_at: new Date().toISOString()
  });
  state.localJobs = [job].concat(state.localJobs.filter((item) => item.id !== job.id));
  saveLocalJobs();
  startLocalJobTimer(job.id);
  return Promise.resolve({ ok: true, job });
}

function localJobTotal(type) {
  const totals = {
    expand_query: 6,
    search_abstracts: 20,
    analyze_abstracts: 30,
    generate_download_list: 10,
    download_pdfs: 12,
    parse_and_analyze_pdfs: 15,
    generate_analysis_results: 8
  };
  return totals[type] || 10;
}

function startLocalJobTimer(jobId) {
  if (state.localTimers[jobId]) clearInterval(state.localTimers[jobId]);
  state.localTimers[jobId] = setInterval(() => {
    const job = state.localJobs.find((item) => item.id === jobId);
    if (!job || job.status !== "running") {
      clearInterval(state.localTimers[jobId]);
      delete state.localTimers[jobId];
      return;
    }
    job.processed_count = Math.min(job.total_count, job.processed_count + Math.max(1, Math.ceil(job.total_count / 8)));
    job.updated_at = new Date().toISOString();
    if (job.processed_count >= job.total_count) {
      job.status = "completed";
      clearInterval(state.localTimers[jobId]);
      delete state.localTimers[jobId];
    }
    saveLocalJobs();
    if (state.detail && state.detail.project && state.detail.project.id === job.project_id) {
      state.detail = mergeLocalJobs(state.detail);
      render();
    }
  }, 800);
}

function executionPanel() {
  const localActive = state.executionMode === "local";
  const title = localActive ? "\u672c\u673a\u5904\u7406\u6a21\u5f0f" : "Cloudflare \u4efb\u52a1\u6a21\u5f0f";
  const note = localActive
    ? "\u4efb\u52a1\u5728\u5f53\u524d\u624b\u673a/\u7535\u8111\u6d4f\u89c8\u5668\u5185\u6267\u884c\uff1bCloudflare \u53ea\u8d1f\u8d23\u767b\u5f55\u3001\u540c\u6b65\u548c\u5b58\u50a8\u3002"
    : "\u4efb\u52a1\u4f1a\u5199\u5165 Cloudflare D1/Queue\uff1b\u9002\u5408\u4ee5\u540e\u9700\u8981\u4e91\u7aef\u4ee3\u8dd1\u65f6\u4f7f\u7528\u3002";
  return '<div class="execution-panel">' +
    '<div>' + icon("zap") + '<span><strong>' + title + '</strong><small>' + note + '</small></span></div>' +
    '<div class="mode-toggle">' +
    '<button class="' + (localActive ? "" : "secondary") + '" data-mode="local">\u672c\u673a\u5904\u7406</button>' +
    '<button class="' + (localActive ? "secondary" : "") + '" data-mode="cloud">\u4e91\u7aef\u4efb\u52a1</button>' +
    '</div></div>';
}

async function refresh(nextSelectedId = state.selectedId) {
  state.loading = true;
  render();
  try {
    const [usageData, projectData, trashData, userData] = await Promise.all([
      Api.resourceUsage(),
      Api.projects(),
      Api.projects(true),
      Api.users().catch(() => ({ users: [] }))
    ]);
    state.usage = usageData;
    state.projects = projectData.projects || [];
    state.trash = trashData.projects || [];
    state.users = userData.users || [];
    state.selectedId = nextSelectedId || state.projects[0]?.id || "";
    state.detail = state.selectedId ? mergeLocalJobs(await Api.project(state.selectedId)) : null;
  } catch (error) {
    state.message = error.message || "\u52a0\u8f7d\u5931\u8d25";
    if (state.message.includes("\u767b\u5f55")) state.loginOpen = true;
  } finally {
    state.loading = false;
    render();
  }
}

async function runAction(label, action, key = label) {
  state.busy[key] = label;
  const minimumVisible = new Promise((resolve) => setTimeout(resolve, 700));
  state.message = `${label}...`;
  render();
  try {
    const result = await action();
    if (result?.job && state.detail?.project?.id === (result.job.projectId || result.job.project_id)) {
      state.detail.jobs = [normalizeJob(result.job), ...(state.detail.jobs || []).filter((job) => job.id !== result.job.id)];
      render();
    }
    const released = result?.releasedBytes ? `\uff0c\u91ca\u653e ${formatBytes(result.releasedBytes)}` : "";
    state.message = `${label}\u5b8c\u6210${released}`;
    await refresh(state.selectedId);
  } catch (error) {
    state.message = error.message || `${label}\u5931\u8d25`;
    render();
  } finally {
    await minimumVisible;
    delete state.busy[key];
    render();
  }
}

function render() {
  const usage = state.usage;
  const selectedProject = state.detail?.project || state.projects.find((project) => project.id === state.selectedId);
  const quotaPercent = usage ? Math.min(100, Math.round((usage.today.usedUnits / Math.max(1, usage.today.dailyLimit)) * 100)) : 0;
  const activeCount = Object.keys(state.busy).length;
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="brand">${icon("shield")} 文献证据工作台 <small class="version-badge">v${APP_VERSION}</small></div>
          <p>免费额度优先：小批次任务、可暂停、可清理、可释放原始文件。</p>
        </div>
        <div class="top-actions">
          <button class="icon-button" data-action="refresh" title="刷新">${state.loading ? icon("loader", "spin") : icon("refresh")}</button>
          <button class="secondary" data-action="open-login">${icon("unlock")} 登录</button>
        </div>
      </header>
      ${state.updateNotice ? updateBanner() : ""}
      ${state.message ? `<div class="toast">${escapeHtml(state.message)}</div>` : ""}
      ${state.loading || activeCount ? `<div class="activity-bar"><span></span><strong>${state.loading ? "正在刷新数据" : `正在执行 ${activeCount} 个操作`}</strong></div>` : ""}
      <main class="layout">
        <section class="resource-panel mobile-tab-panel ${state.mobileTab === "resources" ? "is-active" : ""}">
          ${sectionTitle("gauge", "资源中心", `<button data-action="cleanup" ${busyAttr("cleanup")}>${busyIcon("recycle", "cleanup")} ${isBusy("cleanup") ? "\u6e05\u7406\u4e2d" : "\u6e05\u7406\u4e34\u65f6\u6587\u4ef6"}</button>`)}
          <div class="metric-grid">
            ${metric("R2 对象", usage ? usage.r2.totalObjects : "-", usage ? formatBytes(usage.r2.totalBytes) : "读取中")}
            ${metric("D1 题录", usage ? usage.d1.literature || 0 : "-", `${usage?.d1.projects || 0} 个项目`)}
            ${metric("今日任务", usage ? `${usage.today.usedUnits}/${usage.today.dailyLimit}` : "-", `剩余 ${usage?.today.remainingUnits ?? "-"} units`)}
          </div>
          <div class="quota-line"><span style="width:${quotaPercent}%"></span></div>
          ${purposeBars(usage)}
          ${executionPanel()}
        </section>

        <section class="project-panel mobile-tab-panel ${state.mobileTab === "projects" ? "is-active" : ""}">
          ${sectionTitle("database", "项目", createProjectMarkup())}
          <div class="project-list">
            ${state.projects.length ? state.projects.map(projectRow).join("") : empty("还没有项目，先创建一个研究问题。")}
          </div>
        </section>

        <section class="detail-panel desktop-panel">
          ${sectionTitle("drive", selectedProject?.title || "项目详情", selectedProject ? projectActions(selectedProject) : "")}
          ${state.detail ? `${taskLauncher(state.detail.project.id)}${jobsMarkup(state.detail.jobs || [])}${literatureTable(state.detail.literature || [])}` : empty("选择项目后查看题录、任务和证据提取状态。")}
        </section>

        <section class="workflow-panel mobile-tab-panel ${state.mobileTab === "workflow" ? "is-active" : ""}">
          ${sectionTitle("play", "执行流程", selectedProject ? `<span class="mobile-project-name">${escapeHtml(selectedProject.title)}</span>` : "")}
          ${state.detail ? taskLauncher(state.detail.project.id) : empty("请先在项目页选择一个项目。")}
        </section>

        <section class="task-status-panel mobile-tab-panel ${state.mobileTab === "tasks" ? "is-active" : ""}">
          ${sectionTitle("drive", "任务状态", selectedProject ? projectActions(selectedProject) : "")}
          ${state.detail ? `${jobsMarkup(state.detail.jobs || [])}${literatureTable(state.detail.literature || [])}` : empty("请先在项目页选择一个项目。")}
        </section>
        <section class="trash-panel mobile-tab-panel ${state.mobileTab === "manage" ? "is-active" : ""}">
          ${sectionTitle("trash", "回收站", "")}
          <div class="trash-list">
            ${state.trash.length ? state.trash.map(trashRow).join("") : empty("没有待释放项目。")}
          </div>
        </section>

        <section class="users-panel mobile-tab-panel ${state.mobileTab === "manage" ? "is-active" : ""}">
          ${sectionTitle("users", "授权用户", userFormMarkup())}
          <div class="user-list">
            ${state.users.length ? state.users.map(userRow).join("") : empty("管理员登录后可管理授权用户。")}
          </div>
        </section>
      </main>
      ${mobileTabbar()}
      ${state.loginOpen ? loginDialog() : ""}
    </div>
  `;
  bindEvents();
}

function bindEvents() {
  document.querySelector("[data-action='refresh']")?.addEventListener("click", () => refresh());
  document.querySelector("[data-action='dismiss-update']")?.addEventListener("click", dismissUpdateNotice);
  document.querySelectorAll("[data-mobile-tab]").forEach((button) => button.addEventListener("click", () => setMobileTab(button.dataset.mobileTab)));
  document.querySelector("[data-action='open-login']")?.addEventListener("click", () => {
    state.loginOpen = true;
    render();
  });
  document.querySelector("[data-action='cleanup']")?.addEventListener("click", () => runAction("\u6e05\u7406\u4e34\u65f6\u6587\u4ef6", Api.cleanupTemp, "cleanup"));
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setExecutionMode(button.dataset.mode)));
  document.querySelectorAll("[data-select-project]").forEach((button) => button.addEventListener("click", () => refresh(button.dataset.selectProject)));
  document.querySelector("[data-create-project]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await Api.createProject(form.get("title") || "\u65b0\u8bc1\u636e\u9879\u76ee", form.get("question") || "");
    await refresh(result.project.id);
  });
  document.querySelectorAll("[data-project-action]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.projectId;
    const action = button.dataset.projectAction;
    const map = {
      releasePdfs: ["\u91ca\u653e PDF", () => Api.releasePdfs(id)],
      releaseParse: ["\u91ca\u653e\u89e3\u6790\u4ea7\u7269", () => Api.releaseParseArtifacts(id)],
      archive: ["\u5f52\u6863\u9879\u76ee", () => Api.archiveProject(id)],
      delete: ["\u5220\u9664\u9879\u76ee", () => Api.deleteProject(id)]
    };
    runAction(map[action][0], map[action][1], `project:${action}:${id}`);
  }));
  document.querySelectorAll("[data-job-type]").forEach((button) => button.addEventListener("click", () => {
    const key = `job:${button.dataset.projectId}:${button.dataset.jobType}`;
    runAction(`\u542f\u52a8${jobLabels[button.dataset.jobType]}`, () => createPipelineJob(button.dataset.projectId, button.dataset.jobType), key);
  }));
  document.querySelectorAll("[data-job-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.jobAction === "pause" ? Api.pauseJob : Api.resumeJob;
    const label = button.dataset.jobAction === "pause" ? "\u6682\u505c\u4efb\u52a1" : "\u6062\u590d\u4efb\u52a1";
    runAction(label, () => action(button.dataset.jobId), `job-action:${button.dataset.jobAction}:${button.dataset.jobId}`);
  }));
  document.querySelectorAll("[data-trash-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.trashAction === "restore" ? Api.restore : Api.permanentDelete;
    const label = button.dataset.trashAction === "restore" ? "\u6062\u590d\u9879\u76ee" : "\u6c38\u4e45\u91ca\u653e";
    runAction(label, () => action(button.dataset.projectId), `trash:${button.dataset.trashAction}:${button.dataset.projectId}`);
  }));
  document.querySelector("[data-user-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction("\u4fdd\u5b58\u6388\u6743\u7528\u6237", () => Api.saveUser({
      phone: form.get("phone"),
      name: form.get("name"),
      role: form.get("role"),
      password: form.get("password")
    }), "user:save");
  });
  document.querySelectorAll("[data-delete-user]").forEach((button) => button.addEventListener("click", () => {
    runAction("\u5220\u9664\u6388\u6743\u7528\u6237", () => Api.deleteUser(button.dataset.deleteUser), `user:delete:${button.dataset.deleteUser}`);
  }));
  document.querySelector("[data-login-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await Api.login(form.get("phone"), form.get("password"));
      state.loginOpen = false;
      state.message = "\u767b\u5f55\u6210\u529f";
      await refresh();
    } catch (error) {
      document.querySelector(".form-error").textContent = error.message || "\u767b\u5f55\u5931\u8d25";
    }
  });
  document.querySelector("[data-close-login]")?.addEventListener("click", () => {
    state.loginOpen = false;
    render();
  });
}

function updateBanner() {
  return '<div class="update-banner"><div><strong>已更新到 v' + APP_VERSION + '</strong><span>新增手机端底部多标签布局，流程按钮和执行状态分开查看。</span></div><button data-action="dismiss-update">知道了</button></div>';
}

function mobileTabbar() {
  const tabs = [
    ["workflow", "play", "流程"],
    ["tasks", "drive", "任务"],
    ["projects", "database", "项目"],
    ["resources", "gauge", "资源"],
    ["manage", "users", "管理"]
  ];
  return '<nav class="mobile-tabbar">' + tabs.map(([id, iconName, label]) =>
    '<button class="' + (state.mobileTab === id ? 'active' : '') + '" data-mobile-tab="' + id + '">' + icon(iconName) + '<span>' + label + '</span></button>'
  ).join('') + '</nav>';
}

function setMobileTab(tab) {
  state.mobileTab = tab;
  localStorage.setItem("lit_mobile_tab", tab);
  render();
}

function dismissUpdateNotice() {
  state.updateNotice = false;
  localStorage.setItem("lit_seen_version", APP_VERSION);
  render();
}

function sectionTitle(iconName, title, action) {
  return `<div class="section-title"><h2>${icon(iconName)}${escapeHtml(title)}</h2>${action || ""}</div>`;
}

function metric(title, value, note) {
  return `<div class="metric"><span>${escapeHtml(title)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(note)}</small></div>`;
}

function purposeBars(usage) {
  const purposes = usage?.r2.byPurpose || {};
  const rows = ["pdf", "parse", "export"].map((key) => ({ key, count: purposes[key]?.count || 0, bytes: purposes[key]?.bytes || 0 }));
  const max = Math.max(1, ...rows.map((row) => row.bytes));
  return `<div class="purpose-bars">${rows.map((row) => `
    <div class="purpose-row">
      <label>${purposeName(row.key)}</label>
      <div><span style="width:${Math.round((row.bytes / max) * 100)}%"></span></div>
      <small>${row.count} 个 · ${formatBytes(row.bytes)}</small>
    </div>`).join("")}</div>`;
}

function createProjectMarkup() {
  return `<form class="create-form" data-create-project>
    <input name="title" placeholder="项目名称" required>
    <textarea name="question" placeholder="PICO/研究问题"></textarea>
    <button type="submit">${icon("plus")} 创建</button>
  </form>`;
}

function projectRow(project) {
  return `<button class="project-row ${project.id === state.selectedId ? "active" : ""}" data-select-project="${escapeAttr(project.id)}">
    <span><strong>${escapeHtml(project.title)}</strong><small>${project.status} · ${project.literature_count || 0} 条题录 · ${formatBytes(project.bytes || 0)}</small></span>
  </button>`;
}

function projectActions(project) {
  const releasePdfKey = `project:releasePdfs:${project.id}`;
  const releaseParseKey = `project:releaseParse:${project.id}`;
  const archiveKey = `project:archive:${project.id}`;
  const deleteKey = `project:delete:${project.id}`;
  return `<div class="toolbar">
    <button data-project-action="releasePdfs" data-project-id="${escapeAttr(project.id)}" ${busyAttr(releasePdfKey)}>${busyIcon("file", releasePdfKey)} ${isBusy(releasePdfKey) ? "\u91ca\u653e\u4e2d" : "\u91ca\u653e PDF"}</button>
    <button data-project-action="releaseParse" data-project-id="${escapeAttr(project.id)}" ${busyAttr(releaseParseKey)}>${busyIcon("recycle", releaseParseKey)} ${isBusy(releaseParseKey) ? "\u91ca\u653e\u4e2d" : "\u91ca\u653e\u89e3\u6790"}</button>
    <button class="secondary" data-project-action="archive" data-project-id="${escapeAttr(project.id)}" ${busyAttr(archiveKey)}>${busyIcon("archive", archiveKey)} ${isBusy(archiveKey) ? "\u5f52\u6863\u4e2d" : "\u5f52\u6863"}</button>
    <button class="danger" data-project-action="delete" data-project-id="${escapeAttr(project.id)}" ${busyAttr(deleteKey)}>${busyIcon("trash", deleteKey)} ${isBusy(deleteKey) ? "\u5220\u9664\u4e2d" : "\u5220\u9664"}</button>
  </div>`;
}

function taskLauncher(projectId) {
  return `<div class="task-launcher pipeline">${Object.entries(jobLabels).map(([type, label], index) => {
    const key = `job:${projectId}:${type}`;
    const busy = isBusy(key);
    return `<button class="pipeline-step ${busy ? "is-busy" : ""}" data-job-type="${type}" data-project-id="${escapeAttr(projectId)}" ${busyAttr(key)}>
      <span class="step-number">${index + 1}</span>
      <span><strong>${busy ? "\u542f\u52a8\u4e2d..." : label}</strong><small>${jobNotes[type]}</small></span>
      ${busyIcon("play", key)}
    </button>`;
  }).join("")}</div>`;
}

function jobsMarkup(jobs) {
  return `<div class="jobs">${jobs.length ? jobs.map((rawJob) => {
    const job = normalizeJob(rawJob);
    const total = job.total_count || 0;
    const localBadge = job.local ? `<span class="local-badge">\u672c\u673a</span>` : "";
    const processed = job.processed_count || 0;
    const percent = total ? Math.round((processed / total) * 100) : 0;
    return `<div class="job-row status-${escapeAttr(job.status)}">
      <div>
        <div class="job-title-line"><strong>${escapeHtml(jobLabels[job.type] || job.type)}</strong><span class="job-pills">${localBadge}${statusPill(job.status)}</span></div>
        <small>${processed}/${total || "-"} · \u6279\u91cf ${job.batch_limit || 15}</small>
        <div class="job-progress ${isActiveJob(job.status) ? "active" : ""}"><span style="width:${percent || (isActiveJob(job.status) ? 18 : 0)}%"></span></div>
      </div>
      <div class="row-actions">
        <button class="secondary icon-only" title="\u6682\u505c" data-job-action="pause" data-job-id="${escapeAttr(job.id)}" ${busyAttr(`job-action:pause:${job.id}`)}>${busyIcon("pause", `job-action:pause:${job.id}`)}</button>
        <button class="secondary icon-only" title="\u6062\u590d" data-job-action="resume" data-job-id="${escapeAttr(job.id)}" ${busyAttr(`job-action:resume:${job.id}`)}>${busyIcon("play", `job-action:resume:${job.id}`)}</button>
      </div>
    </div>`;
  }).join("") : empty("\u6ca1\u6709\u8fd0\u884c\u4e2d\u7684\u4efb\u52a1\u3002")}</div>`;
}

function literatureTable(items) {
  if (!items.length) return empty("还没有题录。");
  return `<div class="table-wrap"><table>
    <thead><tr><th>题名</th><th>来源</th><th>初筛</th><th>PDF</th><th>解析</th><th>证据</th></tr></thead>
    <tbody>${items.map((item) => `<tr>
      <td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.doi || item.pmid || "无 DOI/PMID")}</small></td>
      <td>${escapeHtml(item.source || "-")} ${escapeHtml(String(item.year || ""))}</td>
      <td>${badge(item.screening_status)}</td>
      <td>${badge(item.pdf_status)}</td>
      <td>${badge(item.parse_status)}</td>
      <td>${badge(item.extraction_status)}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function trashRow(project) {
  return `<div class="trash-row">
    <span><strong>${escapeHtml(project.title)}</strong><small>${formatBytes(project.bytes || 0)} · 7 天内可恢复</small></span>
    <div class="row-actions">
      <button class="secondary" data-trash-action="restore" data-project-id="${escapeAttr(project.id)}">恢复</button>
      <button class="danger" data-trash-action="delete" data-project-id="${escapeAttr(project.id)}">释放</button>
    </div>
  </div>`;
}

function userFormMarkup() {
  return `<form class="user-form" data-user-form>
    <input name="phone" placeholder="账号/手机号" required>
    <input name="name" placeholder="姓名/备注">
    <select name="role">
      <option value="researcher">研究者</option>
      <option value="project_admin">项目管理员</option>
      <option value="viewer">只读成员</option>
      <option value="super_admin">超级管理员</option>
    </select>
    <input name="password" type="password" placeholder="新用户必填，修改可留空">
    <button type="submit">${icon("plus")} 保存</button>
  </form>`;
}

function userRow(user) {
  return `<div class="user-row">
    <span><strong>${escapeHtml(user.phone)}</strong><small>${escapeHtml(user.name || "-")} · ${escapeHtml(user.role)} · ${user.enabled === 0 ? "停用" : "启用"}</small></span>
    <button class="danger icon-only" title="删除用户" data-delete-user="${escapeAttr(user.phone)}">${icon("trash")}</button>
  </div>`;
}

function loginDialog() {
  return `<div class="dialog-backdrop">
    <form class="dialog" data-login-form>
      <h2>${icon("unlock")} 授权登录</h2>
      <p>首次部署时，第一个登录账号会成为超级管理员。</p>
      <label>账号/手机号<input name="phone" required></label>
      <label>密码<input name="password" type="password" required></label>
      <div class="form-error"></div>
      <div class="row-actions">
        <button type="submit">登录</button>
        <button class="secondary" type="button" data-close-login>关闭</button>
      </div>
    </form>
  </div>`;
}

function badge(value = "") {
  return `<span class="badge ${escapeAttr(value)}">${escapeHtml(value.replace("_", " "))}</span>`;
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function icon(name, className = "") {
  const paths = {
    shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
    refresh: "M21 12a9 9 0 0 1-15.3 6.4M3 12A9 9 0 0 1 18.3 5.6M3 5v6h6M21 19v-6h-6",
    unlock: "M7 11V8a5 5 0 0 1 9.9-1M5 11h14v10H5z",
    gauge: "M4 14a8 8 0 1 1 16 0M12 14l4-4M7 18h10",
    recycle: "M7 19H5l2-3M17 5h2l-2 3M7.7 7.7 2-3.4 2 3.4M16.3 16.3l-2 3.4-2-3.4M9.7 4.3a8 8 0 0 1 8 5.7M14.3 19.7a8 8 0 0 1-8-5.7",
    database: "M4 6c0-2 16-2 16 0s-16 2-16 0v12c0 2 16 2 16 0V6M4 12c0 2 16 2 16 0",
    drive: "M5 5h14l2 7v7H3v-7l2-7ZM7 17h.01M11 17h6",
    trash: "M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15",
    zap: "M13 2 4 14h7l-2 8 9-12h-7l2-8Z",
    plus: "M12 5v14M5 12h14",
    file: "M14 2H6v20h12V8l-4-6ZM14 2v6h4",
    archive: "M3 7h18M5 7v13h14V7M9 11h6",
    play: "M8 5v14l11-7-11-7Z",
    pause: "M8 5v14M16 5v14",
    loader: "M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"
    ,
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
  };
  return `<svg class="${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] || paths.shield}"/></svg>`;
}

function isBusy(key) {
  return Boolean(state.busy[key]);
}

function busyAttr(key) {
  return isBusy(key) ? 'disabled aria-busy="true"' : "";
}

function busyIcon(name, key) {
  return isBusy(key) ? icon("loader", "spin") : icon(name);
}

function normalizeJob(job) {
  return {
    ...job,
    project_id: job.project_id || job.projectId || state.selectedId,
    batch_limit: job.batch_limit || job.batchLimit || 15,
    processed_count: job.processed_count || 0,
    total_count: job.total_count || 0,
    updated_at: job.updated_at || new Date().toISOString()
  };
}

function isActiveJob(status) {
  return ["queued", "running", "paused_quota"].includes(status);
}

function statusPill(status) {
  const labels = {
    queued: "排队中",
    running: "运行中",
    paused: "已暂停",
    paused_quota: "额度暂停",
    completed: "已完成",
    failed: "失败"
  };
  return `<span class="status-pill ${escapeAttr(status)}">${escapeHtml(labels[status] || status || "未知")}</span>`;
}

function purposeName(key) {
  return key === "pdf" ? "PDF 原文" : key === "parse" ? "解析产物" : key === "export" ? "导出文件" : key;
}

function formatBytes(value) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(value);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function demoResponse(path, options = {}) {
  if (path.includes("/resource-usage")) {
    return {
      r2: {
        totalBytes: 23855104,
        totalObjects: 28,
        byPurpose: {
          pdf: { count: 12, bytes: 18350080 },
          parse: { count: 10, bytes: 4456448 },
          export: { count: 6, bytes: 1048576 }
        }
      },
      d1: { projects: 2, literature: 486, extractions: 31, jobs: 7, documents: 28 },
      today: { usage: { "job:expand_query:created": 1, "job:analyze_abstracts:created": 2, "job:parse_and_analyze_pdfs:resume": 2 }, usedUnits: 46, dailyLimit: 800, remainingUnits: 754 },
      projects: [
        { id: "prj_demo", title: "糖尿病远程干预证据综述", status: "active", literature_count: 286, bytes: 17825792 },
        { id: "prj_arch", title: "术后康复管理", status: "archived", literature_count: 200, bytes: 6029312 }
      ]
    };
  }
  if (path === "/api/projects?deleted=1") {
    return { projects: [{ id: "prj_deleted", title: "已删除的示例项目", status: "deleted", literature_count: 34, bytes: 1048576, deleted_at: new Date().toISOString() }] };
  }
  if (path.startsWith("/api/projects/") && !path.includes("release") && !path.includes("archive") && options.method !== "DELETE") {
    return {
      project: { id: "prj_demo", title: "糖尿病远程干预证据综述", status: "active", literature_count: 286, bytes: 17825792 },
      literature: [
        { id: "lit1", title: "Telemedicine intervention for glycemic control", doi: "10.0000/demo1", source: "PubMed", year: 2024, screening_status: "include", pdf_status: "downloaded", parse_status: "parsed", extraction_status: "done" },
        { id: "lit2", title: "Mobile health coaching in type 2 diabetes", doi: "10.0000/demo2", source: "Europe PMC", year: 2023, screening_status: "maybe", pdf_status: "listed", parse_status: "not_requested", extraction_status: "not_requested" }
      ],
      jobs: [{ id: "job_demo", project_id: "prj_demo", type: "parse_and_analyze_pdfs", status: "paused_quota", batch_limit: 15, processed_count: 30, total_count: 120, updated_at: new Date().toISOString() }]
    };
  }
  if (path.startsWith("/api/projects")) return { projects: [{ id: "prj_demo", title: "糖尿病远程干预证据综述", status: "active", literature_count: 286, bytes: 17825792 }] };
  if (path.startsWith("/api/admin/users")) return { users: [{ id: "usr_demo", phone: "admin", name: "超级管理员", role: "super_admin", enabled: 1 }] };
  return { ok: true, project: { id: "prj_demo", title: "新证据项目", status: "active" }, job: { id: `job_${Date.now()}`, type: "expand_query", status: "queued" }, releasedBytes: 1048576, deletedCount: 1 };
}

Api.session().catch(() => {
  state.loginOpen = true;
}).finally(() => refresh());

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
}
