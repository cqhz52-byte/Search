const APP_VERSION = "2026.07.15.11";

const state = {
  usage: null,
  projects: [],
  trash: [],
  users: [],
  settings: null,
  detail: null,
  selectedId: "",
  editingProjectId: "",
  message: "",
  loading: false,
  busy: {},
  mobileTab: localStorage.getItem("lit_mobile_tab") || "workflow",
  updateNotice: localStorage.getItem("lit_seen_version") !== APP_VERSION,
  executionMode: localStorage.getItem("lit_execution_mode") || "local",
  desktopPanels: loadDesktopPanels(),
  workspaceStep: localStorage.getItem("lit_workspace_step") || "",
  localJobs: loadLocalJobs(),
  stepArtifacts: loadStepArtifacts(),
  activeStepDetail: null,
  localTimers: {},
  loginOpen: false
};

const jobLabels = {
  expand_query: "AI 扩充检索内容",
  search_abstracts: "检索摘要",
  analyze_abstracts: "AI 分析摘要",
  generate_download_list: "生成下载列表",
  download_pdfs: "获取全文",
  parse_and_analyze_pdfs: "解析全文并 AI 分析",
  generate_analysis_results: "生成分析结果"
};

const jobNotes = {
  expand_query: "扩展 PICO、同义词、MeSH/关键词和布尔逻辑。",
  search_abstracts: "按小批量检索题录与摘要，只保存必要元数据。",
  analyze_abstracts: "根据纳入/排除标准聚焦到候选文献。",
  generate_download_list: "整理 DOI、PMID、开放全文入口和失败待办。",
  download_pdfs: "优先保存开放全文 XML，PDF 作为可选附件，避免反复重试。",
  parse_and_analyze_pdfs: "文本型全文抽取，DeepSeek 结构化提取；扫描版再考虑 OCR。",
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
  createProject: (title, question) => api("/api/projects", { method: "POST", body: JSON.stringify({ title, question }) }),
  project: (id) => api(`/api/projects/${id}`),
  updateProject: (id, payload) => api(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  importLiterature: (id, payload) => api(`/api/projects/${id}/import-literature`, { method: "POST", body: JSON.stringify(payload) }),
  updateScreening: (id, status) => api(`/api/literature/${id}/screening`, { method: "POST", body: JSON.stringify({ status }) }),
  runStep: (projectId, type) => api(`/api/projects/${projectId}/run-step`, { method: "POST", body: JSON.stringify({ type }) }),
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
  settings: () => api("/api/admin/settings"),
  saveSettings: (payload) => api("/api/admin/settings", { method: "POST", body: JSON.stringify(payload) }),
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

function loadStepArtifacts() {
  try {
    return JSON.parse(localStorage.getItem("lit_step_artifacts") || "{}");
  } catch {
    return {};
  }
}

function saveStepArtifacts() {
  localStorage.setItem("lit_step_artifacts", JSON.stringify(state.stepArtifacts));
}

function loadDesktopPanels() {
  try {
    return { resource: false, projects: false, ...JSON.parse(localStorage.getItem("lit_desktop_panels") || "{}") };
  } catch {
    return { resource: false, projects: false };
  }
}

function saveDesktopPanels() {
  localStorage.setItem("lit_desktop_panels", JSON.stringify(state.desktopPanels));
}

function projectArtifacts(projectId) {
  return state.stepArtifacts[projectId] || {};
}

function writeStepArtifact(projectId, type, artifact) {
  const existing = projectArtifacts(projectId);
  state.stepArtifacts[projectId] = {
    ...existing,
    [type]: {
      type,
      updatedAt: new Date().toISOString(),
      ...artifact
    }
  };
  saveStepArtifacts();
}

function openStepDetail(projectId, type, view) {
  state.activeStepDetail = {
    projectId,
    type,
    view: view === "result" ? "result" : "input"
  };
  render();
}

function closeStepDetail() {
  state.activeStepDetail = null;
  render();
}

function mergeLocalJobs(detail) {
  if (!detail || !detail.project || !detail.project.id) return detail;
  mergeServerArtifacts(detail);
  const localJobs = state.localJobs.filter((job) => job.project_id === detail.project.id);
  const serverJobs = detail.jobs || [];
  const seen = new Set(localJobs.map((job) => job.id));
  detail.jobs = localJobs.concat(serverJobs.filter((job) => !seen.has(job.id)));
  return detail;
}

function mergeServerArtifacts(detail) {
  const projectId = detail.project.id;
  const artifacts = { ...(state.stepArtifacts[projectId] || {}) };
  for (const job of detail.jobs || []) {
    try {
      const artifact = JSON.parse(job.payload_json || "{}").artifact;
      if (artifact?.type && (!artifacts[artifact.type]?.updatedAt || String(job.updated_at || "") >= String(artifacts[artifact.type].updatedAt || ""))) {
        artifacts[artifact.type] = { ...artifact, updatedAt: job.updated_at || artifact.updatedAt || new Date().toISOString() };
      }
    } catch {}
  }
  state.stepArtifacts[projectId] = artifacts;
}

function setExecutionMode(mode) {
  state.executionMode = mode === "cloud" ? "cloud" : "local";
  localStorage.setItem("lit_execution_mode", state.executionMode);
  state.message = state.executionMode === "local" ? "\u5df2\u5207\u6362\u4e3a\u672c\u673a\u5904\u7406\u6a21\u5f0f" : "\u5df2\u5207\u6362\u4e3a Cloudflare \u4efb\u52a1\u6a21\u5f0f";
  render();
}

function createPipelineJob(projectId, type) {
  if (state.executionMode === "cloud" || !["127.0.0.1", "localhost"].includes(location.hostname)) return Api.runStep(projectId, type);
  writeStepArtifact(projectId, type, {
    status: "running",
    summary: "本机正在生成本步骤结果，完成后会在这里显示可核查的数据。"
  });
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
      completeLocalStep(job);
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

function completeLocalStep(job) {
  const detail = state.detail && state.detail.project?.id === job.project_id ? state.detail : null;
  const project = detail?.project || state.projects.find((item) => item.id === job.project_id) || {};
  writeStepArtifact(job.project_id, job.type, buildStepArtifact(job.type, project, detail));
  if (detail) applyArtifactToDetail(job.type, detail);
  state.activeStepDetail = { projectId: job.project_id, type: job.type, view: "result" };
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
    const [usageData, projectData, trashData, userData, settingsData] = await Promise.all([
      Api.resourceUsage(),
      Api.projects(),
      Api.projects(true),
      Api.users().catch(() => ({ users: [] })),
      Api.settings().catch(() => ({ settings: null }))
    ]);
    state.usage = usageData;
    state.projects = projectData.projects || [];
    state.trash = trashData.projects || [];
    state.users = userData.users || [];
    state.settings = settingsData.settings || null;
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

async function runAction(label, action, key = label, options = {}) {
  state.busy[key] = label;
  const minimumVisible = new Promise((resolve) => setTimeout(resolve, 700));
  state.message = options.progressMessage || `${label}...`;
  render();
  try {
    const result = await action();
    if (result?.job && state.detail?.project?.id === (result.job.projectId || result.job.project_id)) {
      state.detail.jobs = [normalizeJob(result.job), ...(state.detail.jobs || []).filter((job) => job.id !== result.job.id)];
      render();
    }
    const released = result?.releasedBytes ? `\uff0c\u91ca\u653e ${formatBytes(result.releasedBytes)}` : "";
    const stillRunning = result?.job && ["queued", "running", "paused_quota"].includes(result.job.status);
    state.message = stillRunning
      ? `${label}\u5df2\u5f00\u59cb\uff0c\u5b8c\u6210\u540e\u4f1a\u751f\u6210\u6b65\u9aa4\u7ed3\u679c`
      : (options.successMessage || `${label}\u5b8c\u6210${released}`);
    await refresh(state.selectedId);
    if (options.openStepResult && result?.job && result.job.status !== "running") {
      const resultType = options.type || result.job.type;
      if (isMobileViewport()) openStepDetail(options.projectId || result.job.project_id || result.job.projectId, resultType, "result");
      else setWorkspaceStep(resultType);
    }
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
  const layoutClasses = [
    state.desktopPanels.resource ? "resource-collapsed" : "",
    state.desktopPanels.projects ? "projects-collapsed" : ""
  ].filter(Boolean).join(" ");
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
      ${runtimeStatus(activeCount)}
      <main class="layout ${layoutClasses}">
        <section class="resource-panel collapsible-panel mobile-tab-panel ${state.desktopPanels.resource ? "is-collapsed" : ""} ${state.mobileTab === "resources" ? "is-active" : ""}">
          ${sectionTitle("gauge", "资源中心", `<div class="panel-actions"><button class="secondary icon-only desktop-collapse-button" title="${state.desktopPanels.resource ? "展开资源中心" : "收起资源中心"}" data-desktop-panel="resource">${icon(state.desktopPanels.resource ? "plus" : "back")}</button><button data-action="cleanup" ${busyAttr("cleanup")}>${busyIcon("recycle", "cleanup")} ${isBusy("cleanup") ? "\u6e05\u7406\u4e2d" : "\u6e05\u7406\u4e34\u65f6\u6587\u4ef6"}</button></div>`)}
          <div class="panel-collapsible-body">
          <div class="metric-grid">
            ${metric("R2 对象", usage ? usage.r2.totalObjects : "-", usage ? formatBytes(usage.r2.totalBytes) : "读取中")}
            ${metric("D1 题录", usage ? usage.d1.literature || 0 : "-", `${usage?.d1.projects || 0} 个项目`)}
            ${metric("今日任务", usage ? `${usage.today.usedUnits}/${usage.today.dailyLimit}` : "-", `剩余 ${usage?.today.remainingUnits ?? "-"} units`)}
          </div>
          <div class="quota-line"><span style="width:${quotaPercent}%"></span></div>
          ${purposeBars(usage)}
          ${executionPanel()}
          </div>
        </section>

        <section class="project-panel collapsible-panel mobile-tab-panel ${state.desktopPanels.projects ? "is-collapsed" : ""} ${state.mobileTab === "projects" ? "is-active" : ""}">
          ${sectionTitle("database", "项目", `<div class="panel-actions"><button class="secondary icon-only desktop-collapse-button" title="${state.desktopPanels.projects ? "展开项目" : "收起项目"}" data-desktop-panel="projects">${icon(state.desktopPanels.projects ? "plus" : "back")}</button></div>`)}
          <div class="panel-collapsible-body">
          ${createProjectMarkup()}
          ${state.detail ? selectedProjectMarkup(state.detail.project) : ""}
          <div class="project-list">
            ${state.projects.length ? state.projects.map(projectRow).join("") : empty("还没有项目，先创建一个研究问题。")}
          </div>
          </div>
        </section>

        <section class="detail-panel desktop-panel">
          ${state.detail ? desktopWorkbench(state.detail, selectedProject) : empty("选择项目后查看题录、任务和证据提取状态。")}
        </section>

        <section class="workflow-panel mobile-tab-panel ${state.mobileTab === "workflow" ? "is-active" : ""}">
          ${sectionTitle("play", "执行流程", selectedProject ? `<span class="mobile-project-name">${escapeHtml(selectedProject.title)}</span>` : "")}
          ${state.detail ? workflowCards(state.detail) : empty("请先在项目页选择一个项目。")}
        </section>

        <section class="task-status-panel mobile-tab-panel ${state.mobileTab === "tasks" ? "is-active" : ""}">
          ${sectionTitle("drive", "任务状态", selectedProject ? projectActions(selectedProject) : "")}
          ${state.detail ? `${jobsMarkup(state.detail.jobs || [])}${documentsMarkup(state.detail.documents || [])}${literatureTable(state.detail.literature || [])}` : empty("请先在项目页选择一个项目。")}
        </section>
        <section class="trash-panel mobile-tab-panel ${state.mobileTab === "manage" ? "is-active" : ""}">
          ${sectionTitle("trash", "回收站", "")}
          <div class="trash-list">
            ${state.trash.length ? state.trash.map(trashRow).join("") : empty("没有待释放项目。")}
          </div>
        </section>

        <section class="users-panel mobile-tab-panel ${state.mobileTab === "manage" ? "is-active" : ""}">
          ${sectionTitle("users", "授权用户", userFormMarkup())}
          ${settingsMarkup()}
          <div class="user-list">
            ${state.users.length ? state.users.map(userRow).join("") : empty("管理员登录后可管理授权用户。")}
          </div>
        </section>
      </main>
      ${mobileTabbar()}
      ${state.activeStepDetail ? stepDetailPage() : ""}
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
  document.querySelectorAll("[data-step-open]").forEach((button) => button.addEventListener("click", () => openStepDetail(button.dataset.projectId, button.dataset.stepType, button.dataset.stepOpen)));
  document.querySelector("[data-step-close]")?.addEventListener("click", closeStepDetail);
  document.querySelectorAll("[data-report-action]").forEach((button) => button.addEventListener("click", () => handleReportAction(button.dataset.reportAction)));
  document.querySelectorAll("[data-desktop-panel]").forEach((button) => button.addEventListener("click", () => toggleDesktopPanel(button.dataset.desktopPanel)));
  document.querySelectorAll("[data-workspace-step]").forEach((button) => button.addEventListener("click", () => setWorkspaceStep(button.dataset.workspaceStep)));
  document.querySelectorAll("[data-copy-text]").forEach((button) => button.addEventListener("click", () => copyText(button.dataset.copyText)));
  document.querySelectorAll("[data-open-url]").forEach((button) => button.addEventListener("click", () => window.open(button.dataset.openUrl, "_blank", "noopener")));
  document.querySelectorAll("[data-cnki-import]").forEach((input) => input.addEventListener("change", () => importCnkiFile(input)));
  document.querySelectorAll("[data-select-project]").forEach((button) => button.addEventListener("click", () => refresh(button.dataset.selectProject)));
  document.querySelectorAll("[data-edit-project]").forEach((button) => button.addEventListener("click", () => {
    state.editingProjectId = button.dataset.editProject;
    render();
  }));
  document.querySelectorAll("[data-cancel-edit-project]").forEach((button) => button.addEventListener("click", () => {
    state.editingProjectId = "";
    render();
  }));
  document.querySelector("[data-create-project]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await Api.createProject(form.get("title") || "\u65b0\u8bc1\u636e\u9879\u76ee", form.get("question") || "");
    await refresh(result.project.id);
  });
  document.querySelector("[data-project-edit-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = form.get("id");
    await runAction("保存项目", () => Api.updateProject(id, { title: form.get("title"), question: form.get("question") }), `project:edit:${id}`);
    state.editingProjectId = "";
    await refresh(id);
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
    const isFullText = button.dataset.jobType === "download_pdfs";
    runAction(`\u542f\u52a8${jobLabels[button.dataset.jobType]}`, () => createPipelineJob(button.dataset.projectId, button.dataset.jobType), key, {
      openStepResult: true,
      projectId: button.dataset.projectId,
      type: button.dataset.jobType,
      progressMessage: isFullText ? "服务器正在获取开放全文，可切换到其他页面；完成后会在结果页和文件列表中显示。" : "",
      successMessage: isFullText ? "服务器全文获取完成；已保存文件会出现在项目文件列表，可随时打开参考。" : ""
    });
  }));
  document.querySelectorAll("[data-screening-lit]").forEach((button) => button.addEventListener("click", () => {
    const litId = button.dataset.screeningLit;
    const status = button.dataset.screeningStatus;
    runAction("更新初筛判断", async () => {
      const result = await Api.updateScreening(litId, status);
      if (state.detail?.literature) {
        const item = state.detail.literature.find((row) => row.id === litId);
        if (item) item.screening_status = status;
      }
      return result;
    }, `screening:${litId}:${status}`);
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
  document.querySelector("[data-settings-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction("保存 DeepSeek API Key", () => Api.saveSettings({ deepseekApiKey: form.get("deepseekApiKey") }), "settings:deepseek");
  });
  document.querySelector("[data-clear-deepseek]")?.addEventListener("click", () => {
    runAction("清除 DeepSeek API Key", () => Api.saveSettings({ clearDeepseek: true }), "settings:deepseek:clear");
  });
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
  return '<div class="update-banner"><div><strong>已更新到 v' + APP_VERSION + '</strong><span>电脑端改为商品化工作台布局：项目和资源中心可收起，7 步流程固定在顶部，结果集中显示在主工作区。</span></div><button data-action="dismiss-update">知道了</button></div>';
}

function runtimeStatus(activeCount) {
  if (!state.message && !state.loading && !activeCount) return "";
  const message = state.message ? `<div class="toast">${escapeHtml(state.message)}</div>` : "";
  const activity = state.loading || activeCount
    ? `<div class="activity-bar"><span></span><strong>${state.loading ? "正在刷新数据" : `正在执行 ${activeCount} 个操作`}</strong></div>`
    : "";
  return `<div class="runtime-status" role="status" aria-live="polite">${message}${activity}</div>`;
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

function toggleDesktopPanel(panel) {
  state.desktopPanels[panel] = !state.desktopPanels[panel];
  saveDesktopPanels();
  render();
}

function setWorkspaceStep(type) {
  state.workspaceStep = type;
  localStorage.setItem("lit_workspace_step", type);
  render();
}

function isMobileViewport() {
  return window.matchMedia?.("(max-width: 760px)")?.matches || false;
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
  const active = project.id === state.selectedId;
  return `<div class="project-row ${active ? "active" : ""}">
    <button class="project-main" data-select-project="${escapeAttr(project.id)}">
      <span><strong>${escapeHtml(project.title)}</strong><small>${active ? "当前项目 · " : ""}${project.status} · ${project.literature_count || 0} 条题录 · ${formatBytes(project.bytes || 0)}</small></span>
    </button>
    <div class="row-actions">
      <button class="secondary" data-select-project="${escapeAttr(project.id)}">${active ? "查看" : "设为当前"}</button>
      <button class="secondary" data-edit-project="${escapeAttr(project.id)}">${icon("file")} 编辑</button>
    </div>
  </div>`;
}

function selectedProjectMarkup(project) {
  const editing = state.editingProjectId === project.id;
  if (editing) {
    return `<form class="project-editor" data-project-edit-form>
      <input type="hidden" name="id" value="${escapeAttr(project.id)}">
      <label>项目名称<input name="title" value="${escapeAttr(project.title)}" required></label>
      <label>研究问题 / PICO<textarea name="question">${escapeHtml(project.question || "")}</textarea></label>
      <div class="row-actions">
        <button type="submit" ${busyAttr(`project:edit:${project.id}`)}>${busyIcon("file", `project:edit:${project.id}`)} 保存</button>
        <button class="secondary" type="button" data-cancel-edit-project>取消</button>
      </div>
    </form>`;
  }
  return `<div class="project-summary">
    <div><strong>${escapeHtml(project.title)}</strong><small>当前项目 · ${escapeHtml(project.status || "active")}</small></div>
    <p>${escapeHtml(project.question || "尚未填写研究问题。")}</p>
    <div class="row-actions">
      <button class="secondary" data-edit-project="${escapeAttr(project.id)}">${icon("file")} 编辑项目</button>
      <button class="secondary" data-mobile-tab="workflow">${icon("play")} 执行流程</button>
    </div>
  </div>`;
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

function settingsMarkup() {
  const deepseek = state.settings?.deepseek || {};
  const status = deepseek.configured ? `已配置 · 末尾 ${deepseek.last4 || "****"}` : "未配置";
  const updated = deepseek.updatedAt ? ` · ${formatDateTime(deepseek.updatedAt)}` : "";
  return `<form class="settings-form" data-settings-form>
    <div>
      <strong>AI 服务配置</strong>
      <small>DeepSeek API Key 保存在服务器 D1，不会回填到浏览器。</small>
    </div>
    <label>DeepSeek API Key
      <input name="deepseekApiKey" type="password" autocomplete="off" placeholder="sk-..." required>
    </label>
    <div class="settings-status">${escapeHtml(status + updated)}</div>
    <div class="row-actions">
      <button type="submit" ${busyAttr("settings:deepseek")}>${busyIcon("file", "settings:deepseek")} 保存 Key</button>
      <button class="secondary" type="button" data-clear-deepseek ${busyAttr("settings:deepseek:clear")}>${busyIcon("trash", "settings:deepseek:clear")} 清除</button>
    </div>
  </form>`;
}

function desktopWorkbench(detail, selectedProject) {
  const activeType = workspaceStep(detail);
  const artifacts = projectArtifacts(detail.project.id);
  const artifact = artifacts[activeType];
  return `<div class="desktop-workbench">
    <header class="workbench-header">
      <div>
        <strong>${escapeHtml(selectedProject?.title || "项目详情")}</strong>
        <small>${escapeHtml(detail.project.question || "尚未填写研究问题。")}</small>
      </div>
      ${projectActions(selectedProject)}
    </header>
    ${desktopWorkflowRail(detail, activeType)}
    <section class="workspace-surface">
      <div class="workspace-result">
        <div class="result-heading">
          <strong>${escapeHtml(jobLabels[activeType] || "流程结果")}</strong>
          <span>${artifact?.updatedAt ? formatDateTime(artifact.updatedAt) : "选择流程步骤查看结果"}</span>
          ${artifact?.status === "completed" ? reportActions() : ""}
        </div>
        ${artifact ? renderArtifactBody(activeType, artifact) : empty("本步骤还没有执行结果。点击上方流程条中的“执行”生成结果。")}
      </div>
      <aside class="workspace-aside">
        ${jobsMarkup(detail.jobs || [])}
        ${documentsMarkup(detail.documents || [])}
      </aside>
    </section>
    <section class="workspace-literature">
      ${literatureTable(detail.literature || [])}
    </section>
  </div>`;
}

function workspaceStep(detail) {
  const types = Object.keys(jobLabels);
  const artifacts = projectArtifacts(detail.project.id);
  if (state.workspaceStep && types.includes(state.workspaceStep)) return state.workspaceStep;
  const latest = [...types].reverse().find((type) => artifacts[type]?.status === "completed");
  return latest || types[0];
}

function desktopWorkflowRail(detail, activeType) {
  const artifacts = projectArtifacts(detail.project.id);
  return `<nav class="workflow-rail" aria-label="研究流程">
    ${Object.keys(jobLabels).map((type, index) => desktopWorkflowStep(detail, type, index + 1, artifacts[type], activeType)).join("")}
  </nav>`;
}

function desktopWorkflowStep(detail, type, number, artifact, activeType) {
  const projectId = detail.project.id;
  const status = artifact?.status || "empty";
  const key = `job:${projectId}:${type}`;
  const busy = isBusy(key);
  const statusText = busy ? "执行中" : status === "completed" ? "已完成" : status === "running" ? "生成中" : "待执行";
  return `<article class="workflow-rail-step ${type === activeType ? "active" : ""} status-${escapeAttr(status)}">
    <button class="rail-select" data-workspace-step="${escapeAttr(type)}" data-project-id="${escapeAttr(projectId)}">
      <span class="step-number">${number}</span>
      <span><strong>${escapeHtml(jobLabels[type])}</strong><small>${escapeHtml(statusText)}</small></span>
    </button>
    <button class="rail-run" title="执行本步骤" data-job-type="${escapeAttr(type)}" data-project-id="${escapeAttr(projectId)}" ${busyAttr(key)}>${busyIcon("play", key)}</button>
  </article>`;
}

function workflowCards(detail) {
  const artifacts = projectArtifacts(detail.project.id);
  return `<div class="workflow-cards">
    ${Object.keys(jobLabels).map((type, index) => workflowCard(detail, type, index + 1, artifacts[type])).join("")}
  </div>`;
}

function workflowCard(detail, type, number, artifact) {
  const projectId = detail.project.id;
  const status = artifact?.status || "empty";
  const statusText = status === "completed" ? "已生成" : status === "running" ? "生成中" : "尚未生成";
  const key = `job:${projectId}:${type}`;
  const busy = isBusy(key);
  return `<article class="workflow-card status-${escapeAttr(status)}">
    <header>
      <span class="step-number">${number}</span>
      <div class="workflow-card-title">
        <strong>${escapeHtml(jobLabels[type])}</strong>
        <small>${escapeHtml(statusText)}${artifact?.updatedAt ? ` · ${formatDateTime(artifact.updatedAt)}` : ""}</small>
      </div>
      <button class="run-step-button" title="执行本步骤" data-job-type="${escapeAttr(type)}" data-project-id="${escapeAttr(projectId)}" ${busyAttr(key)}>${busyIcon("play", key)} ${busy ? "执行中" : "执行"}</button>
    </header>
    <div class="workflow-process">
      <span class="process-dot ${status === "completed" ? "done" : status === "running" || busy ? "running" : ""}"></span>
      <span>${escapeHtml(stepProcessText(type, status, busy))}</span>
    </div>
    <div class="step-switch">
      <button class="secondary" data-step-open="input" data-step-type="${escapeAttr(type)}" data-project-id="${escapeAttr(projectId)}">${icon("file")} 查看输入</button>
      <button class="secondary" data-step-open="result" data-step-type="${escapeAttr(type)}" data-project-id="${escapeAttr(projectId)}">${icon("drive")} 查看结果</button>
    </div>
  </article>`;
}

function stepDetailPage() {
  const active = state.activeStepDetail;
  const detail = state.detail?.project?.id === active.projectId ? state.detail : null;
  if (!detail) return "";
  const artifact = projectArtifacts(active.projectId)[active.type];
  const number = Object.keys(jobLabels).indexOf(active.type) + 1;
  const isResult = active.view === "result";
  const title = isResult ? "执行结果" : "输入信息";
  const body = isResult ? renderStepOutput(active.type, number, artifact) : renderStepInput(active.type, detail);
  const status = artifact?.status || "empty";
  const statusText = status === "completed" ? "已生成" : status === "running" ? "生成中" : "尚未生成";
  return `<div class="step-detail-page">
    <header class="step-detail-topbar">
      <button class="secondary" data-step-close>${icon("back")} 关闭</button>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>第 ${number} 步 · ${escapeHtml(jobLabels[active.type])} · ${escapeHtml(statusText)}</span>
      </div>
      ${isResult && artifact?.status === "completed" ? reportActions() : ""}
    </header>
    <main class="step-detail-content">${body}</main>
  </div>`;
}

function reportActions() {
  return `<div class="report-actions">
    <button class="secondary" data-report-action="pdf">${icon("file")} 分享PDF</button>
    <button class="secondary" data-report-action="word">${icon("file")} Word</button>
    <button data-report-action="share">${icon("drive")} 分享</button>
  </div>`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text || "");
    state.message = "已复制知网高级检索词。";
  } catch {
    state.message = "复制失败，请长按检索式手动复制。";
  }
  render();
}

async function importCnkiFile(input) {
  const file = input.files?.[0];
  input.value = "";
  if (!file || !state.selectedId) return;
  await runAction("导入知网摘要", async () => {
    const text = await file.text();
    const records = parseCnkiRecords(text, file.name);
    if (!records.length) throw new Error("未识别到题录。请从知网导出 RIS/EndNote/TXT/CSV 格式，且包含题名和摘要。");
    const result = await Api.importLiterature(state.selectedId, { source: "CNKI/知网", records });
    state.message = `知网摘要导入完成：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`;
    await refresh(state.selectedId);
    return result;
  }, `cnki-import:${state.selectedId}`);
}

function parseCnkiRecords(text, filename = "") {
  const clean = String(text || "").replace(/^\ufeff/, "").trim();
  if (!clean) return [];
  if (/%0 |^TY  -|^T1  -|^TI  -/m.test(clean)) return parseRisRecords(clean);
  if (/\t/.test(clean.split(/\r?\n/)[0] || "") || /\.csv$/i.test(filename)) return parseDelimitedRecords(clean);
  return parseLabeledTextRecords(clean);
}

function parseRisRecords(text) {
  const chunks = text.split(/\nER\s*-\s*/i).map((item) => item.trim()).filter(Boolean);
  return chunks.map((chunk) => {
    const record = {};
    for (const line of chunk.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9]{2})\s+-\s*(.*)$/);
      if (!match) continue;
      const [, tag, value] = match;
      if (["TI", "T1", "CT"].includes(tag)) record.title = appendField(record.title, value);
      if (tag === "AB" || tag === "N2") record.abstract = appendField(record.abstract, value);
      if (tag === "JO" || tag === "JF" || tag === "T2") record.journal = appendField(record.journal, value);
      if (tag === "PY" || tag === "Y1") record.year = value;
      if (tag === "DO") record.doi = value;
    }
    record.source = "CNKI/知网";
    return record;
  }).filter((item) => item.title);
}

function parseDelimitedRecords(text) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows = text.split(/\r?\n/).filter((line) => line.trim()).map((line) => splitDelimitedLine(line, delimiter));
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((cells) => {
    const item = {};
    headers.forEach((header, index) => {
      const value = cells[index] || "";
      if (["title", "题名", "篇名", "标题"].includes(header)) item.title = value;
      else if (["abstract", "摘要"].includes(header)) item.abstract = value;
      else if (["journal", "来源", "刊名", "期刊"].includes(header)) item.journal = value;
      else if (["year", "年份", "年"].includes(header)) item.year = value;
      else if (header === "doi") item.doi = value;
    });
    item.source = "CNKI/知网";
    return item;
  }).filter((item) => item.title);
}

function parseLabeledTextRecords(text) {
  const chunks = text.split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean);
  return chunks.map((chunk) => {
    const item = { source: "CNKI/知网" };
    for (const line of chunk.split(/\r?\n/)) {
      const match = line.match(/^([^:：]{1,12})[:：]\s*(.*)$/);
      if (!match) continue;
      const key = normalizeHeader(match[1]);
      const value = match[2].trim();
      if (["title", "题名", "篇名", "标题"].includes(key)) item.title = appendField(item.title, value);
      else if (["abstract", "摘要"].includes(key)) item.abstract = appendField(item.abstract, value);
      else if (["journal", "来源", "刊名", "期刊"].includes(key)) item.journal = appendField(item.journal, value);
      else if (["year", "年份", "年"].includes(key)) item.year = value;
      else if (key === "doi") item.doi = value;
    }
    if (!item.title) {
      const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      item.title = lines[0] || "";
      item.abstract = item.abstract || lines.slice(1).join(" ").slice(0, 4000);
    }
    return item;
  }).filter((item) => item.title);
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function normalizeHeader(value) {
  return String(value || "").replace(/^\ufeff/, "").trim().toLowerCase();
}

function appendField(current, value) {
  const clean = String(value || "").trim();
  return current ? `${current} ${clean}` : clean;
}

async function handleReportAction(action) {
  const report = currentStepReport();
  if (!report) {
    state.message = "当前步骤还没有可导出的报告。";
    render();
    return;
  }
  if (action === "pdf") {
    await sharePdfReport(report);
    return;
  }
  const blob = reportBlob(report);
  if (action === "word") {
    downloadBlob(blob, `${report.fileName}.doc`);
    state.message = "Word 报告已生成。";
    render();
    return;
  }
  await sharePdfReport(report);
}

function currentStepReport() {
  const active = state.activeStepDetail;
  const detail = state.detail;
  if (!detail) return null;
  const type = active?.view === "result" ? active.type : workspaceStep(detail);
  if (!type) return null;
  const artifact = projectArtifacts(detail.project.id)[type];
  if (!detail || !artifact || artifact.status !== "completed") return null;
  const number = Object.keys(jobLabels).indexOf(type) + 1;
  const project = detail.project || {};
  const title = `${project.title || "文献证据项目"} - 第 ${number} 步 ${jobLabels[type]}`;
  const generatedAt = new Date().toLocaleString();
  const fileName = cleanReportFileName(`${project.title || "文献证据"}-第${number}步-${jobLabels[type]}`);
  return {
    title,
    fileName,
    generatedAt,
    project,
    artifact,
    stepNumber: number,
    stepName: jobLabels[type],
    html: buildReportHtml({ title, generatedAt, project, artifact, stepNumber: number, stepName: jobLabels[type] }),
    text: buildReportText({ title, generatedAt, project, artifact, stepNumber: number, stepName: jobLabels[type] })
  };
}

function buildReportHtml({ title, generatedAt, project, artifact, stepNumber, stepName }) {
  const sections = (artifact.sections || []).map(reportSectionHtml).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${reportStyle()}</head><body>
    <main class="report">
      <header>
        <h1>${escapeHtml(title)}</h1>
        <p>项目：${escapeHtml(project.title || "-")}</p>
        <p>研究问题：${escapeHtml(project.question || "-")}</p>
        <p>步骤：第 ${stepNumber} 步 · ${escapeHtml(stepName)} · 生成时间：${escapeHtml(generatedAt)}</p>
      </header>
      ${artifact.summary ? `<section><h2>摘要</h2><p>${escapeHtml(artifact.summary)}</p></section>` : ""}
      ${sections || "<section><h2>结果</h2><p>本步骤暂无结构化输出。</p></section>"}
    </main>
  </body></html>`;
}

function reportSectionHtml(section) {
  const body = [
    section.body ? `<p>${escapeHtml(section.body)}</p>` : "",
    section.items?.length ? `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "",
    section.rows?.length ? reportTableHtml(section.rows, section.title) : "",
    section.code ? `<pre>${escapeHtml(section.code)}</pre>` : ""
  ].join("");
  return `<section><h2>${escapeHtml(section.title || "结果")}</h2>${body}</section>`;
}

function reportTableHtml(rows, title = "") {
  const keys = Object.keys(rows[0] || {});
  if (!keys.length) return "";
  if (isAbstractReportRows(rows, title)) return reportAbstractTableHtml(rows);
  return `<table><thead><tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) =>
    `<tr>${keys.map((key) => `<td>${escapeHtml(row[key] || "-")}</td>`).join("")}</tr>`
  ).join("")}</tbody></table>`;
}

function isAbstractReportRows(rows, title = "") {
  const keys = Object.keys(rows[0] || {});
  return /摘要结果|题录摘要|摘要|初筛/.test(title) && keys.includes("题名") && (keys.includes("摘要") || keys.includes("英文摘要") || keys.includes("中文摘要"));
}

function reportAbstractTableHtml(rows) {
  return `<table class="abstract-report-table"><colgroup><col class="meta-col"><col class="english-col"><col class="chinese-col"></colgroup><thead><tr><th>题名 / 来源 / 年份</th><th>英文摘要</th><th>中文摘要</th></tr></thead><tbody>${rows.map((row) => `
    <tr>
      <td class="meta-cell"><strong>${escapeHtml(row["题名"] || "-")}</strong><small>${escapeHtml(row["来源"] || "-")} · ${escapeHtml(row["年份"] || "-")}</small></td>
      <td class="abstract-cell">${escapeHtml(compactReportText(row["英文摘要"] || row["摘要"] || "-", 700))}</td>
      <td class="abstract-cell">${escapeHtml(compactReportText(row["中文摘要"] || "执行“AI 分析摘要”后生成中文摘要。", 520))}</td>
    </tr>`).join("")}</tbody></table>`;
}

function buildReportText({ title, generatedAt, project, artifact, stepNumber, stepName }) {
  const lines = [
    title,
    `项目：${project.title || "-"}`,
    `研究问题：${project.question || "-"}`,
    `步骤：第 ${stepNumber} 步 · ${stepName}`,
    `生成时间：${generatedAt}`,
    "",
    artifact.summary || ""
  ];
  for (const section of artifact.sections || []) {
    lines.push("", `【${section.title || "结果"}】`);
    if (section.body) lines.push(section.body);
    if (section.items?.length) lines.push(...section.items.map((item) => `- ${item}`));
    if (section.code) lines.push(section.code);
    for (const row of section.rows || []) {
      lines.push(Object.entries(row).map(([key, value]) => `${key}: ${value || "-"}`).join("；"));
    }
  }
  return lines.filter((line, index) => line || lines[index - 1]).join("\n");
}

function reportBlob(report) {
  return new Blob(["\ufeff", report.html], { type: "application/msword;charset=utf-8" });
}

async function sharePdfReport(report) {
  state.message = "正在生成 PDF 报告...";
  render();
  try {
    const blob = await createPdfReportBlob(report);
    const file = new File([blob], `${report.fileName}.pdf`, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: report.title, text: report.text.slice(0, 500), files: [file] });
      state.message = "PDF 报告已打开分享面板。";
      render();
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: report.title, text: report.text.slice(0, 1500) });
      downloadBlob(blob, `${report.fileName}.pdf`);
      state.message = "当前浏览器只支持分享文字，PDF 已同时下载。";
      render();
      return;
    }
    downloadBlob(blob, `${report.fileName}.pdf`);
    state.message = "当前浏览器不支持直接分享文件，PDF 报告已下载。";
    render();
  } catch (error) {
    state.message = `PDF 生成失败：${error.message || error}`;
    render();
  }
}

async function shareReport(report, blob) {
  const file = new File([blob], `${report.fileName}.doc`, { type: "application/msword" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: report.title, text: report.text.slice(0, 500), files: [file] });
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: report.title, text: report.text.slice(0, 1500) });
      return;
    }
  } catch (error) {
    if (error.name === "AbortError") return;
  }
  downloadBlob(blob, `${report.fileName}.doc`);
  state.message = "当前浏览器不支持直接分享文件，已改为下载 Word 报告。";
  render();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createPdfReportBlob(report) {
  const pages = renderReportToJpegs(report);
  return new Blob([buildPdfFromJpegs(pages)], { type: "application/pdf" });
}

function renderReportToJpegs(report) {
  const pageWidth = 595;
  const pageHeight = 842;
  const scale = 2;
  const width = pageWidth * scale;
  const height = pageHeight * scale;
  const margin = 42 * scale;
  const bottom = height - margin;
  const lineHeight = 17 * scale;
  const pages = [];
  let canvas;
  let ctx;
  let y;

  const newPage = () => {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#17201d";
    y = margin;
  };
  const finishPage = () => {
    if (canvas) pages.push({ data: dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.88)), width, height });
  };
  const ensure = (needed) => {
    if (y + needed <= bottom) return;
    finishPage();
    newPage();
  };
  const drawText = (text, x, maxWidth, options = {}) => {
    const fontSize = (options.size || 11) * scale;
    const lh = (options.lineHeight || options.size * 1.45 || 16) * scale;
    ctx.font = `${options.bold ? "700 " : ""}${fontSize}px "Microsoft YaHei", Arial, sans-serif`;
    ctx.fillStyle = options.color || "#17201d";
    const lines = wrapCanvasText(ctx, String(text || "-"), maxWidth, options.maxLines || 0);
    ensure(lines.length * lh + 4 * scale);
    for (const line of lines) {
      ctx.fillText(line, x, y);
      y += lh;
    }
    return lines.length;
  };
  const rule = () => {
    ensure(10 * scale);
    ctx.strokeStyle = "#d9e1dc";
    ctx.lineWidth = scale;
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(width - margin, y);
    ctx.stroke();
    y += 10 * scale;
  };

  newPage();
  drawText(report.title, margin, width - margin * 2, { size: 18, bold: true, color: "#0f766e", lineHeight: 24 });
  drawText(`项目：${report.project?.title || "-"}`, margin, width - margin * 2, { size: 10, lineHeight: 14 });
  drawText(`研究问题：${report.project?.question || "-"}`, margin, width - margin * 2, { size: 10, lineHeight: 14, maxLines: 3 });
  drawText(`步骤：第 ${report.stepNumber} 步 · ${report.stepName} · 生成时间：${report.generatedAt}`, margin, width - margin * 2, { size: 10, lineHeight: 14 });
  rule();
  if (report.artifact?.summary) {
    drawText("摘要", margin, width - margin * 2, { size: 13, bold: true, lineHeight: 18 });
    drawText(report.artifact.summary, margin, width - margin * 2, { size: 10, lineHeight: 15, maxLines: 8 });
    y += 8 * scale;
  }

  for (const section of report.artifact?.sections || []) {
    ensure(44 * scale);
    drawText(section.title || "结果", margin, width - margin * 2, { size: 13, bold: true, lineHeight: 18 });
    if (section.body) drawText(section.body, margin, width - margin * 2, { size: 10, lineHeight: 15, maxLines: 12 });
    if (section.items?.length) {
      for (const item of section.items) drawText(`• ${item}`, margin + 10 * scale, width - margin * 2 - 10 * scale, { size: 10, lineHeight: 15, maxLines: 3 });
    }
    if (section.code) drawText(section.code, margin, width - margin * 2, { size: 9, lineHeight: 13, maxLines: 16, color: "#31403b" });
    if (section.rows?.length) {
      if (isAbstractReportRows(section.rows, section.title)) drawPdfAbstractRows(section.rows, { ctx, scale, margin, width, bottom, ensure, drawText, rule, get y() { return y; }, set y(value) { y = value; } });
      else drawPdfKeyValueRows(section.rows, { scale, margin, width, drawText, get y() { return y; }, set y(value) { y = value; } });
    }
    y += 8 * scale;
  }
  finishPage();
  return pages;
}

function drawPdfAbstractRows(rows, tools) {
  const { scale, margin, width, drawText, rule } = tools;
  for (const row of rows) {
    tools.y += 2 * scale;
    drawText(row["题名"] || "-", margin, width - margin * 2, { size: 10, bold: true, lineHeight: 14, maxLines: 2 });
    drawText(`${row["来源"] || "-"} · ${row["年份"] || "-"}`, margin, width - margin * 2, { size: 8.5, lineHeight: 12, color: "#66736d", maxLines: 1 });
    drawText(`英文摘要：${compactReportText(row["英文摘要"] || row["摘要"] || "-", 420)}`, margin, width - margin * 2, { size: 8.5, lineHeight: 12.5, maxLines: 5 });
    drawText(`中文摘要：${compactReportText(row["中文摘要"] || "执行“AI 分析摘要”后生成中文摘要。", 300)}`, margin, width - margin * 2, { size: 8.5, lineHeight: 12.5, maxLines: 4 });
    rule();
  }
}

function drawPdfKeyValueRows(rows, tools) {
  const { scale, margin, width, drawText } = tools;
  for (const row of rows) {
    drawText(Object.entries(row).map(([key, value]) => `${key}: ${compactReportText(value || "-", 180)}`).join("；"), margin, width - margin * 2, { size: 9, lineHeight: 13, maxLines: 6 });
    tools.y += 3 * scale;
  }
}

function compactReportText(value, maxLength = 700) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function wrapCanvasText(ctx, text, maxWidth, maxLines = 0) {
  const normalized = String(text || "").replace(/\r/g, "").split("\n");
  const lines = [];
  for (const part of normalized) {
    let line = "";
    for (const token of canvasTokens(part)) {
      const next = line ? `${line}${token}` : token.trimStart();
      if (ctx.measureText(next).width <= maxWidth || !line) {
        line = next;
      } else {
        lines.push(line.trimEnd());
        line = token.trimStart();
        if (maxLines && lines.length >= maxLines) return ellipsizeLastLine(lines);
      }
    }
    if (line) lines.push(line.trimEnd());
    if (maxLines && lines.length >= maxLines) return ellipsizeLastLine(lines);
  }
  return lines.length ? lines : ["-"];
}

function canvasTokens(text) {
  const tokens = [];
  for (const word of String(text).split(/(\s+)/)) {
    if (!word) continue;
    if (word.length > 24 || /[\u4e00-\u9fff]/.test(word)) tokens.push(...word.split(""));
    else tokens.push(word);
  }
  return tokens;
}

function ellipsizeLastLine(lines) {
  if (!lines.length) return lines;
  lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\.{3,}$/g, "")}...`;
  return lines;
}

function buildPdfFromJpegs(pages) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const add = (chunk) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    chunks.push(bytes);
    length += bytes.length;
  };
  const objectCount = 2 + pages.length * 3;
  add("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const obj = (id, body) => {
    offsets[id] = length;
    add(`${id} 0 obj\n${body}\nendobj\n`);
  };
  const streamObj = (id, dict, data) => {
    offsets[id] = length;
    add(`${id} 0 obj\n${dict} /Length ${data.length} >>\nstream\n`);
    add(data);
    add("\nendstream\nendobj\n");
  };
  const pageIds = pages.map((_, index) => 3 + index * 3);
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const imageName = `Im${index + 1}`;
    const content = encoder.encode(`q\n595 0 0 842 0 0 cm\n/${imageName} Do\nQ`);
    obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    streamObj(contentId, "<<", content);
    streamObj(imageId, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, page.data);
  });
  const xref = length;
  add(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= objectCount; id += 1) add(`${String(offsets[id] || 0).padStart(10, "0")} 00000 n \n`);
  add(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const output = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
}

function dataUrlToBytes(url) {
  const binary = atob(url.split(",")[1] || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function cleanReportFileName(value) {
  return String(value || "步骤报告").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
}

function reportStyle() {
  return `<style>
    body{margin:0;background:#fff;color:#17201d;font-family:"Microsoft YaHei",Arial,sans-serif;line-height:1.6}
    .report{max-width:980px;margin:0 auto;padding:28px}
    header{border-bottom:2px solid #0f766e;margin-bottom:20px;padding-bottom:12px}
    h1{font-size:24px;margin:0 0 12px;color:#0f766e}
    h2{font-size:17px;margin:24px 0 8px;color:#17201d}
    p{margin:6px 0;white-space:pre-wrap}
    table{width:100%;border-collapse:collapse;margin-top:8px;table-layout:fixed}
    .abstract-report-table .meta-col{width:24%}
    .abstract-report-table .english-col{width:40%}
    .abstract-report-table .chinese-col{width:36%}
    .abstract-report-table .meta-cell strong{display:block;font-size:12px;line-height:1.35}
    .abstract-report-table .meta-cell small{display:block;margin-top:4px;color:#66736d}
    .abstract-report-table .abstract-cell{font-size:12px;line-height:1.45}
    th,td{border:1px solid #d9e1dc;padding:8px;vertical-align:top;font-size:12px;word-break:break-word}
    th{background:#eef6f2;text-align:left}
    pre{white-space:pre-wrap;word-break:break-word;border:1px solid #d9e1dc;background:#f7faf8;padding:10px}
    @media print{.report{padding:0} h2{break-after:avoid} table{break-inside:auto} tr{break-inside:avoid}}
  </style>`;
}

function renderStepOutput(type, number, artifact) {
  if (!artifact) return `<p class="muted">第 ${number} 步还没有输出。点击本卡右上角执行按钮后，结果会显示在这里。</p>`;
  return renderArtifactBody(type, artifact);
}

function renderStepInput(type, detail) {
  return renderArtifactLike(buildStepInput(type, detail));
}

function renderArtifactBody(type, artifact) {
  if (artifact.status === "running") return `<p class="muted">${escapeHtml(artifact.summary || "正在生成结果。")}</p>`;
  return renderArtifactLike(artifact);
}

function renderArtifactLike(artifact) {
  const sections = (artifact.sections || []).map((section) => {
    const code = section.code ? `<pre>${escapeHtml(section.code)}</pre>` : "";
    const items = section.items?.length ? `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
    const rows = section.rows?.length ? miniTable(section.rows, Boolean(section.compact)) : "";
    const body = `${section.body ? `<p>${escapeHtml(section.body)}</p>` : ""}${cnkiActions(section)}${items}${rows}${code}`;
    const rowCount = section.rows?.length || 0;
    const shouldCollapse = rowCount > 8 || /摘要|题录|清单|队列|候选|素材/.test(section.title || "");
    if (shouldCollapse) {
      return `<details class="artifact-section artifact-section-collapsible"><summary><span>${escapeHtml(section.title)}</span><small>${rowCount ? `${rowCount} 条，点击展开` : "点击展开"}</small></summary>${body}</details>`;
    }
    return `<section class="artifact-section"><h3>${escapeHtml(section.title)}</h3>${body}</section>`;
  }).join("");
  return `${artifact.summary ? `<p>${escapeHtml(artifact.summary)}</p>` : ""}${sections}`;
}

function cnkiActions(section) {
  if (!/CNKI|知网/.test(section.title || "")) return "";
  const row = section.rows?.[0] || {};
  const query = row["中文检索式"] || row["检索式"] || "";
  const url = row["入口"] || "https://kns.cnki.net/kns8/AdvSearch?dbprefix=SCDB";
  return `<div class="cnki-tools">
    <button data-open-url="${escapeAttr(url)}">${icon("drive")} 打开知网</button>
    <button class="secondary" data-copy-text="${escapeAttr(query)}">${icon("file")} 复制高级检索词</button>
    <label class="button-like">${icon("plus")} 导入知网摘要文件<input type="file" data-cnki-import accept=".txt,.ris,.csv,.tsv,.xls,.html,.htm"></label>
  </div>`;
}

function stepProcessText(type, status, busy) {
  if (busy || status === "running") return "正在本机处理：读取输入、生成结构化输出。";
  if (status === "completed") return "处理完成：可点“输入”复核来源，也可点“结果”查看输出。";
  return `待处理：${jobNotes[type]}`;
}

function miniTable(rows, compact = false) {
  if (compact) return compactFileList(rows);
  const keys = Object.keys(rows[0] || {});
  if (!keys.length) return "";
  return `<div class="mini-table"><table><thead><tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) =>
    `<tr>${keys.map((key) => miniTableCell(row, key)).join("")}</tr>`
  ).join("")}</tbody></table><div class="mini-card-list">${rows.map((row) => miniCard(row, keys)).join("")}</div></div>`;
}

function compactFileList(rows) {
  return `<div class="compact-file-list">${rows.map((row) => {
    const name = row["文件名"] || row["题名"] || row["英文题名"] || row["PMCID"] || "全文文件";
    const status = row["状态"] || "-";
    const kind = row["大小/格式"] || "";
    const detailFields = ["英文题名", "PMCID", "来源URL", "正文预览", "说明"]
      .filter((key) => row[key])
      .map((key) => ({ key, value: row[key] }));
    const fileHref = row["全文文件"] || "";
    return `<article class="compact-file-row">
      <div class="compact-file-main">
        <strong>${escapeHtml(name)}</strong>
        <small>${escapeHtml(status)}${kind ? ` · ${escapeHtml(kind)}` : ""}</small>
      </div>
      <details class="mini-card-detail compact-file-detail">
        <summary>查看详情</summary>
        ${detailFields.map((field) => `<div class="detail-field"><span>${escapeHtml(field.key)}</span><p>${escapeHtml(field.value || "-")}</p></div>`).join("")}
        ${fileHref ? `<div class="detail-field"><span>全文文件</span><p><a href="${escapeAttr(fileHref)}" target="_blank" rel="noopener">打开已保存 XML/PDF</a></p></div>` : ""}
      </details>
    </article>`;
  }).join("")}</div>`;
}

function miniTableCell(row, key) {
  if (isDetailField(key, row[key])) {
    return `<td>${detailBlock("查看详情", [{ key, value: row[key] }], "table-detail")}</td>`;
  }
  return `<td>${formatLinkedText(row[key])}</td>`;
}

function miniCard(row, keys) {
  const title = row["题名"] || row["文献"] || row["题录ID"] || row["PMCID"] || keys.map((key) => row[key]).find(Boolean) || "记录";
  const detailFields = keys
    .filter((key) => isDetailField(key, row[key]))
    .map((key) => ({ key, value: row[key] }));
  const body = keys
    .filter((key) => row[key] !== title && !isDetailField(key, row[key]))
    .map((key) => `<div class="mini-card-field"><span>${escapeHtml(key)}</span><p>${formatLinkedText(row[key] || "-")}</p></div>`)
    .join("");
  const detail = detailFields.length ? detailBlock("查看中文详情", detailFields, "mini-card-detail") : "";
  return `<article class="mini-card-row"><header><strong>${escapeHtml(title)}</strong></header>${body}${detail}${screeningControls(row)}</article>`;
}

function isDetailField(key, value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return /中文摘要|摘要|理由|关键结果|证据限制|说明|依据|fullTextBasis/i.test(key) || text.length > 120;
}

function detailBlock(label, fields, className) {
  return `<details class="${className}"><summary>${escapeHtml(label)}</summary>${fields.map((field) =>
    `<div class="detail-field"><span>${escapeHtml(field.key)}</span><p>${formatLinkedText(field.value || "-")}</p></div>`
  ).join("")}</details>`;
}

function formatLinkedText(value) {
  const text = String(value ?? "");
  if (/^https?:\/\/[^\s]+$/i.test(text.trim())) {
    const href = text.trim();
    return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener">${escapeHtml(href)}</a>`;
  }
  return escapeHtml(text);
}

function screeningControls(row) {
  const litId = row["题录ID"] || row.id || "";
  if (!litId) return "";
  const current = state.detail?.literature?.find((item) => item.id === litId)?.screening_status || "";
  return `<div class="screening-current">当前人工状态：${escapeHtml(current ? screeningLabel(current) : "未设置")}</div><div class="screening-actions">
    <button data-screening-lit="${escapeAttr(litId)}" data-screening-status="include">纳入</button>
    <button class="secondary" data-screening-lit="${escapeAttr(litId)}" data-screening-status="maybe">待定</button>
    <button class="secondary" data-screening-lit="${escapeAttr(litId)}" data-screening-status="exclude">排除</button>
  </div>`;
}

function buildStepInput(type, detail) {
  const project = detail.project || {};
  const artifacts = projectArtifacts(project.id);
  const literature = detail.literature?.length ? detail.literature : demoLiterature();
  const included = literature.filter((item) => ["include", "maybe"].includes(item.screening_status));
  const inputs = {
    expand_query: () => ({
      summary: "本步骤输入是你创建项目时填写的研究问题。AI 会拆解 PICO，并扩展同义词、缩写、旧称、设备名、技术变体和主题词；不是简单翻译。",
      sections: [
        { title: "项目", body: project.title || "未命名项目" },
        { title: "研究问题 / PICO", body: project.question || "尚未填写研究问题。建议先在项目中写清人群、干预、对照和结局。" },
        { title: "处理要求", items: ["为每个核心概念扩展同义词、缩写、全称、旧称、商品名/设备名和技术变体", "生成 PubMed / Europe PMC / 中文数据库检索式", "兼顾查全率和查准率，减少漏检和无关文献"] }
      ]
    }),
    search_abstracts: () => ({
      summary: "本步骤输入是第 1 步生成的检索策略；系统据此抓取题录和摘要。",
      sections: [
        { title: "检索策略来源", body: artifacts.expand_query?.status === "completed" ? "已使用第 1 步生成的检索式。" : "第 1 步尚未生成，当前使用项目研究问题和默认关键词作为输入。" },
        { title: "待检数据库", items: ["PubMed / Europe PMC", "CNKI/知网中文摘要检索入口", "中文数据库导入清单", "开放获取全文入口"] },
        { title: "知网说明", body: "知网通常需要机构/IP/VPN/账号登录。系统会生成中文摘要检索式和入口；登录后复制检索式，在主题、篇名、关键词或摘要字段检索，并导出中文题录。" },
        { title: "批量限制", body: "免费额度模式默认小批量分页检索，避免一次写入过多 D1 行。" }
      ]
    }),
    analyze_abstracts: () => ({
      summary: "本步骤输入是检索到的题录和摘要，AI 根据纳入/排除标准进行初筛。",
      sections: [
        { title: "待筛摘要", rows: literature.map((item) => ({ "题名": item.title, "来源": item.source || "-", "摘要": item.abstract || "等待摘要抓取" })) },
        { title: "筛选依据", items: ["是否符合 PICO", "是否为可用研究设计", "是否报告目标结局", "是否需要全文进一步判断"] }
      ]
    }),
    generate_download_list: () => ({
      summary: "本步骤输入是 AI 初筛后的纳入/待定文献。",
      sections: [
        { title: "候选全文", rows: included.map((item) => ({ "题名": item.title, "判断": screeningLabel(item.screening_status), "DOI或PMID": item.doi || item.pmid || "-" })) },
        { title: "下载规则", items: ["优先开放获取 PDF", "无法自动获取的只进入下载清单", "失败项不反复重试，节省免费额度"] }
      ]
    }),
    download_pdfs: () => ({
      summary: "本步骤输入是下载清单，系统会按清单尝试获取开放全文。",
      sections: [
        { title: "获取队列", rows: included.map((item) => ({ "题名": item.title, "当前全文状态": statusLabel(item.pdf_status || "not_requested"), "来源": item.source || "-" })) },
        { title: "资源保护", body: "默认只保存开放全文 XML；已成功或失败的题录会跳过。PDF 附件抓取需单独启用，避免验证码、超时和重复请求消耗免费额度。" }
      ]
    }),
    parse_and_analyze_pdfs: () => ({
      summary: "本步骤输入是纳入/待定文献的开放全文或已下载 PDF；优先抽取可复制文字，不做原排版翻译，不默认调用 LlamaParse。",
      sections: [
        { title: "待解析全文", rows: included.map((item) => ({ "题名": item.title, "PMCID": item.pmcid || "-", "PDF状态": item.pdf_status || "not_requested", "解析状态": item.parse_status || "not_requested" })) },
        { title: "提取字段", items: ["研究目的", "研究设计", "干预方式", "对照方式", "结局指标", "关键结果", "证据限制"] }
      ]
    }),
    generate_analysis_results: () => ({
      summary: "本步骤输入是全文解析和 AI 提取后的结构化字段。",
      sections: [
        { title: "证据素材", rows: included.map((item) => ({ "文献": item.title, "解析": item.parse_status || "not_requested", "提取": item.extraction_status || "not_requested" })) },
        { title: "输出要求", items: ["生成证据链草稿", "列出证据限制", "保留可追溯字段", "避免脱离文献的主观总结"] }
      ]
    })
  };
  return (inputs[type] || inputs.expand_query)();
}

function buildStepArtifact(type, project, detail) {
  const question = project.question || "PICO/研究问题尚未填写，请在项目中补充后重新运行本步骤。";
  const literature = detail?.literature?.length ? detail.literature : demoLiterature();
  const included = literature.filter((item) => ["include", "maybe"].includes(item.screening_status));
  const artifactMap = {
    expand_query: () => ({
      status: "completed",
      summary: "已基于研究问题生成可直接复制到数据库的检索策略草稿。",
      sections: [
        { title: "原始研究问题", body: question },
        { title: "PICO 拆解", rows: [
          { "维度": "P 人群", "内容": "目标疾病/目标人群；建议补充年龄、场景、诊断标准" },
          { "维度": "I 干预", "内容": "AI/数字化/远程/管理类干预及其同义词" },
          { "维度": "C 对照", "内容": "常规护理、标准治疗、安慰剂或无干预" },
          { "维度": "O 结局", "内容": "主要结局、次要结局、安全性、依从性、成本" }
        ] },
        { title: "按概念扩展的检索词", rows: [
          { "概念": "不可逆电穿孔", "角色": "I", "英文扩展": "irreversible electroporation; IRE; pulsed electric field; PEF; electric field ablation; electrical field ablation; NanoKnife; steep pulse", "中文扩展": "不可逆电穿孔；陡脉冲；脉冲电场；电场消融；脉冲电场消融；纳米刀", "MeSH/主题词": "Electroporation; Ablation Techniques" },
          { "概念": "胰腺癌", "角色": "P", "英文扩展": "pancreatic cancer; pancreatic neoplasm; pancreatic carcinoma; pancreas cancer; pancreatic ductal adenocarcinoma; PDAC", "中文扩展": "胰腺癌；胰腺肿瘤；胰腺恶性肿瘤；胰腺导管腺癌", "MeSH/主题词": "Pancreatic Neoplasms" }
        ] },
        { title: "扩展关键词", items: ["irreversible electroporation / IRE / pulsed electric field / PEF / electric field ablation / NanoKnife", "不可逆电穿孔 / 陡脉冲 / 脉冲电场 / 电场消融 / 脉冲电场消融 / 纳米刀", "pancreatic neoplasms / pancreatic cancer / pancreatic carcinoma / PDAC", "胰腺癌 / 胰腺肿瘤 / 胰腺恶性肿瘤 / 胰腺导管腺癌"] },
        { title: "PubMed 检索式", code: '(("irreversible electroporation"[Title/Abstract] OR IRE[Title/Abstract] OR "pulsed electric field"[Title/Abstract] OR PEF[Title/Abstract] OR "electric field ablation"[Title/Abstract] OR "NanoKnife"[Title/Abstract] OR "Electroporation"[MeSH Terms]) AND ("Pancreatic Neoplasms"[MeSH Terms] OR "pancreatic cancer"[Title/Abstract] OR "pancreatic neoplasm*"[Title/Abstract] OR "pancreatic carcinoma"[Title/Abstract] OR PDAC[Title/Abstract]))' },
        { title: "中文数据库检索式", code: "(不可逆电穿孔 OR IRE OR 陡脉冲 OR 脉冲电场 OR 电场消融 OR 脉冲电场消融 OR 纳米刀) AND (胰腺癌 OR 胰腺肿瘤 OR 胰腺恶性肿瘤 OR 胰腺导管腺癌)" }
      ]
    }),
    search_abstracts: () => ({
      status: "completed",
      summary: `已形成摘要检索样例，共 ${literature.length} 条题录；真实接入数据库后这里显示分页检索结果。`,
      sections: [
        { title: "题录摘要", rows: literature.map((item) => ({ "题名": item.title, "来源": item.source || "-", "年份": item.year || "-", "摘要要点": item.abstract || "等待摘要抓取" })) }
      ]
    }),
    analyze_abstracts: () => ({
      status: "completed",
      summary: `AI 初筛完成：纳入/待定 ${included.length} 条，排除 ${Math.max(0, literature.length - included.length)} 条。`,
      sections: [
        { title: "初筛判断", rows: literature.map((item) => ({ "题名": item.title, "判断": screeningLabel(item.screening_status), "理由": item.screening_status === "exclude" ? "主题或研究设计不匹配" : "与研究问题相关，建议进入全文阶段" })) }
      ]
    }),
    generate_download_list: () => ({
      status: "completed",
      summary: `已生成全文下载清单：优先开放获取 PDF，无法自动下载的进入人工清单。`,
      sections: [
        { title: "全文清单", rows: included.map((item) => ({ "题名": item.title, "DOI或PMID": item.doi || item.pmid || "-", "全文状态": statusLabel(item.pdf_status || "not_requested"), "来源": item.source || "-" })) }
      ]
    }),
    download_pdfs: () => ({
      status: "completed",
      summary: "本机模式已完成全文获取状态整理；正式接入后优先保存开放全文 XML，PDF 作为可选附件。",
      sections: [
        { title: "全文状态", rows: included.map((item) => ({ "题名": item.title, "全文": ["downloaded", "fulltext_ready"].includes(item.pdf_status) ? "已保存" : "未取得/需人工", "说明": ["downloaded", "fulltext_ready"].includes(item.pdf_status) ? "可进入全文解析" : "进入人工清单" })) }
      ]
    }),
    parse_and_analyze_pdfs: () => ({
      status: "completed",
      summary: "已完成文本型全文抽取和结构化提取样例；这里不做原排版翻译，只保留可审查字段。",
      sections: [
        { title: "文本抽取来源", rows: included.map((item) => ({ "题录ID": item.id, "题名": item.title, "来源": item.pmcid ? "Europe PMC 全文 XML" : "摘要兜底", "抽取字符数": item.pmcid ? "12000+" : String((item.abstract || "").length), "说明": item.pmcid ? "已从开放全文 XML 抽取可复制正文文本" : "没有开放全文，使用摘要兜底" })) },
        { title: "结构化提取", rows: included.map((item) => ({ "文献": item.title, "研究目的": "评估干预对目标结局的影响", "研究设计": "按全文方法学字段提取", "干预方式": "从全文 Intervention/Methods 抽取", "结局指标": "有效性、安全性、并发症或生存结局", "证据限制": "样本量、偏倚风险、随访时间需复核" })) }
      ]
    }),
    generate_analysis_results: () => ({
      status: "completed",
      summary: "已基于结构化字段生成证据链草稿，可继续人工校正。",
      sections: [
        { title: "证据链", items: ["研究问题已拆解为 PICO 并扩展检索词。", `摘要初筛后保留 ${included.length} 条候选全文。`, "全文解析只提取研究目的、干预方式、结局指标和限制，不保存大段全文。", "结论必须回链到具体文献和提取字段，避免凭空总结。"] },
        { title: "初步结论", body: "当前证据提示相关干预可能改善目标结局，但结论强度取决于研究设计、样本量、随访时间和偏倚风险；建议在全文精读后给出 GRADE 或类似证据等级。" }
      ]
    })
  };
  return (artifactMap[type] || artifactMap.expand_query)();
}

function applyArtifactToDetail(type, detail) {
  if (!detail.literature?.length && ["search_abstracts", "analyze_abstracts"].includes(type)) {
    detail.literature = demoLiterature();
  }
  if (type === "analyze_abstracts") {
    detail.literature = (detail.literature || demoLiterature()).map((item, index) => ({
      ...item,
      screening_status: index % 4 === 3 ? "exclude" : index % 2 === 0 ? "include" : "maybe"
    }));
  }
  if (type === "generate_download_list") {
    detail.literature = (detail.literature || demoLiterature()).map((item) => ({
      ...item,
      pdf_status: ["include", "maybe"].includes(item.screening_status) ? "listed" : item.pdf_status
    }));
  }
  if (type === "download_pdfs") {
    detail.literature = (detail.literature || demoLiterature()).map((item, index) => ({
      ...item,
      pdf_status: ["include", "maybe"].includes(item.screening_status) && index % 3 !== 1 ? "fulltext_ready" : item.pdf_status,
      parse_status: ["include", "maybe"].includes(item.screening_status) && index % 3 !== 1 ? "text_ready" : item.parse_status
    }));
  }
  if (type === "parse_and_analyze_pdfs") {
    detail.literature = (detail.literature || demoLiterature()).map((item) => ({
      ...item,
      parse_status: item.pdf_status === "downloaded" ? "parsed" : item.parse_status,
      extraction_status: item.pdf_status === "downloaded" ? "done" : item.extraction_status
    }));
  }
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

function documentsMarkup(documents) {
  const activeDocs = (documents || []).filter((item) => item.status !== "released");
  if (!activeDocs.length) return `<section class="document-panel">${sectionTitle("file", "已保存文件", "")}${empty("还没有保存的 PDF/XML 文件。执行“获取全文”后会显示在这里。")}</section>`;
  return `<section class="document-panel">
    ${sectionTitle("file", "已保存文件", `<span class="doc-count">${activeDocs.length} 个文件</span>`)}
    <div class="document-list">
      ${activeDocs.map((doc) => {
        const href = `/api/documents/${encodeURIComponent(doc.id)}`;
        return `<article class="document-row">
          <div>
            <strong>${escapeHtml(documentKindLabel(doc.kind, doc.purpose))}</strong>
            <small>${escapeHtml(doc.r2_key || doc.id)} · ${formatBytes(doc.size_bytes || 0)} · ${formatDateTime(doc.created_at)}</small>
          </div>
          <div class="row-actions">
            <a class="button-link" href="${href}" target="_blank" rel="noopener">打开</a>
            <a class="button-link secondary-link" href="${href}" download>下载</a>
          </div>
        </article>`;
      }).join("")}
    </div>
  </section>`;
}

function documentKindLabel(kind = "", purpose = "") {
  if (kind === "fulltext_xml") return "开放全文 XML";
  if (kind === "pdf") return "PDF 原文";
  if (purpose === "parse") return "解析文件";
  if (purpose === "export") return "导出文件";
  return kind || purpose || "文件";
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
  return `<span class="badge ${escapeAttr(value)}">${escapeHtml(statusLabel(value))}</span>`;
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
    back: "M19 12H5M12 19l-7-7 7-7",
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

function screeningLabel(status) {
  const labels = {
    include: "纳入",
    maybe: "待定",
    exclude: "排除",
    pending: "未筛选"
  };
  return labels[status] || status || "未筛选";
}

function statusLabel(status = "") {
  const labels = {
    pending: "待筛",
    include: "纳入",
    maybe: "待定",
    exclude: "排除",
    not_requested: "未请求",
    listed: "已列入",
    manual_required: "需人工",
    failed: "失败",
    downloaded: "PDF 已保存",
    fulltext_ready: "全文已保存",
    text_ready: "文本就绪",
    fulltext_text: "全文文本",
    abstract_only: "仅摘要",
    parsed: "已解析",
    done: "完成"
  };
  return labels[status] || String(status || "-").replace(/_/g, " ");
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

function formatDateTime(value) {
  try {
    return new Date(value).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function demoLiterature() {
  return [
    { id: "lit1", title: "Telemedicine intervention for glycemic control", doi: "10.0000/demo1", source: "PubMed", year: 2024, abstract: "A randomized study evaluating remote monitoring and coaching on clinical outcomes.", screening_status: "include", pdf_status: "downloaded", parse_status: "parsed", extraction_status: "done" },
    { id: "lit2", title: "Mobile health coaching in type 2 diabetes", doi: "10.0000/demo2", source: "Europe PMC", year: 2023, abstract: "Mobile app coaching was compared with usual care for adherence and patient reported outcomes.", screening_status: "maybe", pdf_status: "listed", parse_status: "not_requested", extraction_status: "not_requested" },
    { id: "lit3", title: "Decision support for chronic disease follow-up", doi: "10.0000/demo3", source: "Crossref", year: 2022, abstract: "Clinical decision support and follow-up reminders were assessed in outpatient management.", screening_status: "include", pdf_status: "not_requested", parse_status: "not_requested", extraction_status: "not_requested" },
    { id: "lit4", title: "Hospital billing system implementation report", doi: "10.0000/demo4", source: "Crossref", year: 2021, abstract: "A technical implementation report without eligible intervention outcomes.", screening_status: "exclude", pdf_status: "not_requested", parse_status: "not_requested", extraction_status: "not_requested" }
  ];
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
      literature: demoLiterature(),
      documents: [
        { id: "doc_demo_xml", r2_key: "parse/prj_demo/lit1.fulltext.xml", kind: "fulltext_xml", purpose: "parse", size_bytes: 196406, content_type: "application/xml", status: "active", created_at: new Date().toISOString() },
        { id: "doc_demo_pdf", r2_key: "pdf/prj_demo/lit1.pdf", kind: "pdf", purpose: "pdf", size_bytes: 1239040, content_type: "application/pdf", status: "active", created_at: new Date().toISOString() }
      ],
      jobs: [{ id: "job_demo", project_id: "prj_demo", type: "parse_and_analyze_pdfs", status: "paused_quota", batch_limit: 15, processed_count: 30, total_count: 120, updated_at: new Date().toISOString() }]
    };
  }
  if (path.startsWith("/api/projects")) return { projects: [{ id: "prj_demo", title: "糖尿病远程干预证据综述", status: "active", literature_count: 286, bytes: 17825792 }] };
  if (path.startsWith("/api/admin/settings")) {
    if (options.method === "POST") {
      const body = options.body ? JSON.parse(options.body) : {};
      if (body.clearDeepseek) {
        localStorage.removeItem("lit_demo_deepseek_last4");
        localStorage.removeItem("lit_demo_deepseek_updated");
      } else {
        const key = String(body.deepseekApiKey || "");
        localStorage.setItem("lit_demo_deepseek_last4", key.slice(-4));
        localStorage.setItem("lit_demo_deepseek_updated", new Date().toISOString());
      }
    }
    const last4 = localStorage.getItem("lit_demo_deepseek_last4") || "";
    return { ok: true, settings: { deepseek: { configured: Boolean(last4), last4, updatedAt: localStorage.getItem("lit_demo_deepseek_updated") || "" } } };
  }
  if (path.startsWith("/api/admin/users")) return { users: [{ id: "usr_demo", phone: "admin", name: "超级管理员", role: "super_admin", enabled: 1 }] };
  if (path.startsWith("/api/literature/")) {
    const status = options.body ? JSON.parse(options.body).status : "maybe";
    return { ok: true, id: path.split("/")[3], projectId: "prj_demo", status, updatedAt: new Date().toISOString() };
  }
  return { ok: true, project: { id: "prj_demo", title: "新证据项目", status: "active" }, job: { id: `job_${Date.now()}`, type: "expand_query", status: "queued" }, releasedBytes: 1048576, deletedCount: 1 };
}

Api.session().catch(() => {
  state.loginOpen = true;
}).finally(() => refresh());

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
}
