const app = document.querySelector("#app");

const state = {
  demo: false,
  supabase: null,
  session: null,
  briefs: [],
  assets: {},
  fileBlobs: {},
  selectedId: null,
  categoryFilter: "全部",
  monthFilter: "全部",
  statusFilter: "全部",
  busy: false,
  notice: "",
  config: null,
  confirmMaterialsId: null,
  editingBriefId: null,
  assetDeleteMode: false,
  selectedAssetIds: new Set(),
};

const statusLabels = {
  briefing: "主题已创建",
  materials: "素材收集中",
  script: "脚本已完成",
  editing: "剪辑中",
  done: "成片已完成",
};

const categories = ["全部", "展会", "设备交付", "公司日常"];
const editors = ["蔡颖", "何冬琴", "朱玮佳", "杜妮 Jen"];

const stageSteps = [
  { key: "briefing", label: "创建主题", field: "briefing_at" },
  { key: "script", label: "完成脚本", field: "script_at" },
  { key: "materials", label: "素材确认", field: "materials_at" },
  { key: "editing", label: "剪辑阶段", field: "editing_at" },
  { key: "done", label: "成片完成", field: "done_at" },
];

const emptyDraft = {
  category: "展会",
  plan_month: getCurrentMonth(),
  title: "",
  purpose: "",
  publish_at: "",
  script_mode: "generate",
};

let draft = { ...emptyDraft };

init();

async function init() {
  renderShell("正在连接工作台...");
  if (isLocalPreview()) {
    startDemoMode();
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch("/api/config", { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    state.config = response.ok ? await response.json() : {};
  } catch (_error) {
    state.config = {};
  }

  if (!state.config?.supabaseUrl || !state.config?.supabaseKey) {
    startDemoMode();
    return;
  }

  await loadSupabaseClient();
  state.supabase = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const { data } = await state.supabase.auth.getSession();
  state.session = data.session;

  state.supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    if (session) await loadWorkspace();
    else {
      state.briefs = [];
      state.assets = {};
      state.selectedId = null;
      renderAuth();
    }
  });

  if (state.session) await loadWorkspace();
  else renderAuth();
}

function isLocalPreview() {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.") || host.startsWith("10.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function startDemoMode() {
  state.demo = true;
  state.session = { user: { id: "local-demo", email: "demo@zhufeng.local" } };
  loadDemoWorkspace();
  renderApp();
}

function loadSupabaseClient() {
  if (window.supabase?.createClient) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.84.0/dist/umd/supabase.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function renderShell(message) {
  app.innerHTML = `<section class="auth-screen"><div class="auth-panel"><div class="brand-mark">▣<span>筑峰短视频宣传工作台</span></div><p class="notice">${escapeHtml(message)}</p></div></section>`;
}

function renderAuth() {
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-panel">
        <div class="brand-mark">▣<span>筑峰短视频宣传工作台</span></div>
        <h1>按月规划宣传主题，沉淀素材、脚本和成片。</h1>
        <form class="auth-form" id="loginForm">
          <label>工作邮箱<input id="email" type="email" placeholder="name@company.com" required /></label>
          <button type="submit" ${state.busy ? "disabled" : ""}>发送登录链接</button>
        </form>
        ${state.notice ? `<p class="notice">${escapeHtml(state.notice)}</p>` : ""}
      </div>
    </section>`;
  document.querySelector("#loginForm").addEventListener("submit", signIn);
}

async function signIn(event) {
  event.preventDefault();
  const email = document.querySelector("#email").value.trim();
  if (!email) return;
  state.busy = true;
  renderAuth();
  const { error } = await state.supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  state.busy = false;
  state.notice = error ? error.message : "登录链接已发送，请查看邮箱。";
  renderAuth();
}

async function signOut() {
  if (state.demo) {
    state.notice = "当前为本地演示模式，部署并配置 Supabase 后可使用真实登录。";
    renderApp();
    return;
  }
  await state.supabase.auth.signOut();
}

async function loadWorkspace() {
  if (state.demo) {
    loadDemoWorkspace();
    renderApp();
    return;
  }

  state.busy = true;
  renderApp();
  const [briefResult, assetResult] = await Promise.all([
    state.supabase.from("video_briefs").select("*").order("plan_month", { ascending: false }).order("created_at", { ascending: false }),
    state.supabase.from("media_assets").select("*").order("created_at", { ascending: false }),
  ]);
  state.busy = false;

  if (briefResult.error || assetResult.error) {
    state.notice = briefResult.error?.message || assetResult.error?.message || "加载失败";
    renderApp();
    return;
  }

  state.briefs = normalizeBriefs(briefResult.data || []);
  state.assets = (assetResult.data || []).reduce((grouped, asset) => {
    grouped[asset.brief_id] ||= [];
    grouped[asset.brief_id].push(asset);
    return grouped;
  }, {});
  if (!state.selectedId && state.briefs[0]) state.selectedId = state.briefs[0].id;
  renderApp();
}

function renderApp() {
  if (!state.session) return renderAuth();

  const visibleBriefs = getVisibleBriefs();
  const selected = getSelectedBrief();
  const currentMonthBriefs = state.briefs.filter((brief) => String(brief.plan_month || "").slice(0, 7) === getCurrentMonth());
  const totalAssets = currentMonthBriefs.reduce((sum, brief) => sum + (state.assets[brief.id] || []).length, 0);
  const done = currentMonthBriefs.filter((brief) => brief.status === "done").length;
  const editing = currentMonthBriefs.filter((brief) => brief.status === "editing").length;

  app.innerHTML = `
    <section class="app-shell">
      <aside class="sidebar">
        <div class="brand-mark">▣<span>筑峰视频</span></div>
        <button class="ghost-button" data-action="refresh">刷新</button>
        <nav class="brief-list">${renderMonthNav()}</nav>
        <button class="logout" data-action="logout">退出</button>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div>
            <p>月度视频宣传规划${state.demo ? " · 本地演示模式" : ""}</p>
            <h1>按月份和分类汇总主题进度</h1>
          </div>
          <div class="stats">
            ${stat("当前月份", currentMonthLabel())}
            ${stat("本月主题数", currentMonthBriefs.length)}
            ${stat("本月脚本完成", currentMonthBriefs.filter((brief) => stageDone(brief, "script")).length)}
            ${stat("本月素材数", totalAssets)}
            ${stat("本月剪辑中", editing)}
            ${stat("本月成片", done)}
          </div>
        </header>

        ${state.notice ? `<p class="notice inline">${escapeHtml(state.notice)}</p>` : ""}
        ${renderSummaryFilters()}

        <div class="planner-layout">
          <section class="left-stack">
            ${renderCreatePanel()}
            ${renderMonthBoard()}
          </section>
          ${selected ? renderDetailPanel(selected) : renderEmptyState()}
        </div>
        ${renderConfirmModal()}
      </section>
    </section>`;

  bindEvents();
}

function renderSummaryFilters() {
  const months = ["全部", ...Object.keys(groupBriefsByMonth(state.briefs))];
  return `<div class="summary-filters select-filters">
    <label>月份<select id="monthFilter">${months.map((month) => `<option value="${month}" ${state.monthFilter === month ? "selected" : ""}>${month === "全部" ? "全部月份" : formatMonth(month)}</option>`).join("")}</select></label>
    <label>主题分类<select id="categoryFilter">${categories.map((category) => `<option value="${category}" ${state.categoryFilter === category ? "selected" : ""}>${category}</option>`).join("")}</select></label>
    <label>进度阶段<select id="statusFilter"><option value="全部" ${state.statusFilter === "全部" ? "selected" : ""}>全部阶段</option>${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${state.statusFilter === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
  </div>`;
}
function renderMonthNav() {
  const grouped = groupBriefsByMonth(getVisibleBriefs());
  return Object.entries(grouped)
    .map(([month, briefs]) => `
      <div class="month-group">
        <strong>${formatMonth(month)}</strong>
        ${briefs.map((brief) => `
          <button class="${brief.id === getSelectedBrief()?.id ? "active" : ""}" data-select="${brief.id}">
            <span>${escapeHtml(brief.title)}</span>
            <small>${escapeHtml(brief.category)} · ${statusLabels[brief.status]} · ${progressPercent(brief)}%</small>
          </button>`).join("")}
      </div>`)
    .join("") || `<p class="empty">暂无规划</p>`;
}

function renderCreatePanel() {
  return `
    <section class="panel create-panel">
      <div class="panel-title"><span>＋</span><h2>添加月度主题</h2></div>
      <form id="briefForm" class="brief-form">
        <label>主题分类<select name="category">${categories.filter((category) => category !== "全部").map((category) => `<option value="${category}" ${draft.category === category ? "selected" : ""}>${category}</option>`).join("")}</select></label>
        <label>所属月份<input name="plan_month" type="month" value="${escapeAttr(draft.plan_month)}" required /></label>
        <label>视频主题<input name="title" value="${escapeAttr(draft.title)}" placeholder="例如：8月工地案例宣传 / 项目交付现场展示" required /></label>
        <label>主题主旨<textarea name="purpose" placeholder="这条视频要表达什么核心信息" required>${escapeHtml(draft.purpose)}</textarea></label>
        <label>预计发布时间<input name="publish_at" type="datetime-local" value="${escapeAttr(draft.publish_at)}" /></label>
        <div class="segmented">
          <button type="button" class="${draft.script_mode === "generate" ? "selected" : ""}" data-script-mode="generate">自动生成脚本</button>
          <button type="button" class="${draft.script_mode === "upload" ? "selected" : ""}" data-script-mode="upload">上传脚本</button>
        </div>
        <button type="submit" ${state.busy ? "disabled" : ""}>添加主题</button>
      </form>
    </section>`;
}

function renderMonthBoard() {
  const grouped = groupBriefsByMonth(getVisibleBriefs());
  return `
    <section class="panel month-board">
      <div class="panel-title"><span>▦</span><h2>月度主题总览</h2></div>
      <div class="month-grid">
        ${Object.entries(grouped).map(([month, briefs]) => `
          <div class="month-card">
            <div class="month-card-head"><strong>${formatMonth(month)}</strong><span>${briefs.length} 个主题</span></div>
            ${briefs.map((brief) => `
              <button data-select="${brief.id}" class="board-item ${brief.id === getSelectedBrief()?.id ? "active" : ""}">
                <span>${escapeHtml(brief.title)}</span>
                <small>${escapeHtml(brief.category)} · ${statusLabels[brief.status]} · ${progressPercent(brief)}%</small>
              </button>`).join("")}
          </div>`).join("") || `<p class="empty">先添加一个月度主题。</p>`}
      </div>
    </section>`;
}

function renderDetailPanel(brief) {
  const assets = state.assets[brief.id] || [];
  const finalVideoName = brief.final_video_name || fileNameFromPath(brief.final_video_path);
  const currentScript = brief.generated_script || "";

  return `
    <section class="detail-panel form-view">
      <section class="panel form-section">
        <div class="form-section-head">
          <div><span class="status-pill">${escapeHtml(brief.category)}</span><h2>主题信息表</h2></div>
          <div class="form-head-actions">
            <button class="ghost-button" data-action="edit-brief">${state.editingBriefId === brief.id ? "取消编辑" : "编辑"}</button>
            ${state.editingBriefId === brief.id ? `<button class="action-button" data-action="save-brief-edit">保存</button>` : ""}
          </div>
        </div>
        ${state.editingBriefId === brief.id ? renderBriefEditForm(brief) : renderBriefReadonlyForm(brief)}
      </section>

      <section class="panel form-section">
        <div class="form-section-head"><h2>阶段进度表</h2><strong>${progressPercent(brief)}%</strong></div>
        <div class="progress-track"><i style="width:${progressPercent(brief)}%"></i></div>
        <div class="stage-form-list">${stageSteps.map((step) => stageRow(step, brief)).join("")}</div>
      </section>

      <section class="panel form-section script-form-section">
        <div class="form-section-head"><h2>脚本表</h2><span class="mini-pill">先完成脚本，再上传素材</span></div>
        <div class="form-actions three-actions">
          <button class="action-button" data-action="open-chatgpt">跳转 ChatGPT 生成</button>
          <button class="ghost-button" data-action="open-codex">打开 Codex 继续优化</button>
          ${uploadBox("上传脚本", ".txt,.md,.doc,.docx,.pdf", "script", false)}
        </div>
        <p class="help-text">点击 ChatGPT 会自动带入视频主题和主题主旨。你可以在 ChatGPT 中多轮优化，确定后复制最终脚本，粘贴到下方并保存。</p>
        <label class="editable-area">已确定脚本<textarea id="confirmedScript" placeholder="把 ChatGPT/Codex 最终确认的脚本粘贴到这里">${escapeHtml(currentScript)}</textarea></label>
        ${currentScript ? renderScriptTable(currentScript) : ""}
        <div class="script-save-row"><button class="ghost-button" data-action="paste-confirmed-script">从剪贴板粘贴脚本</button><button class="action-button save-script-button" data-action="save-confirmed-script">保存确定脚本</button></div>
        ${brief.uploaded_script_path ? `<div class="table-row"><span>脚本文件</span><strong>${escapeHtml(fileNameFromPath(brief.uploaded_script_path))}</strong><small>${formatDateTime(brief.script_uploaded_at)}</small></div>` : ""}
      </section>

      <section class="panel form-section">
        <div class="form-section-head"><h2>主题素材表</h2>${uploadBox("上传素材", "image/*,video/*", "asset", true)}</div>
        ${assets.length ? `<div class="table-list">${assets.map(assetRow).join("")}</div>` : `<p class="empty">脚本确定后，再上传对应主题的视频或照片素材。</p>`}
        <div class="material-actions"><button class="action-button" data-action="confirm-materials">确认素材上传完毕</button><button class="ghost-button" data-action="download-materials">剪辑人员下载素材包</button><button class="danger-button" data-action="toggle-asset-delete">${state.assetDeleteMode ? "取消删除" : "删除素材"}</button>${state.assetDeleteMode ? `<button class="danger-button strong" data-action="delete-selected-assets">删除所选素材</button>` : ""}</div>
        <p class="help-text">点击确认后会弹出确认页面；选择“是”后记录时间，并通过企业微信发送网页链接和手机链接给剪辑人员。</p>
      </section>

      <section class="panel form-section">
        <div class="form-section-head"><h2>剪辑短视频表</h2>${uploadBox("上传成片", "video/*", "final", false)}</div>
        ${brief.final_video_path ? `<div class="table-row"><span>成片文件</span><strong>${escapeHtml(finalVideoName || "已上传成片")}</strong><small>${formatDateTime(brief.final_video_uploaded_at || brief.done_at)}</small></div>` : `<p class="empty">剪辑完成后，把对应主题的短视频上传到这里。</p>`}
      </section>
    </section>`;
}
function renderEmptyState() {
  return `<section class="panel empty-state"><h2>先添加一个月度视频主题</h2><p>一个月份可以添加多个主题，创建后即可管理素材、脚本和剪辑视频。</p></section>`;
}

function renderScriptTable(script) {
  const rows = parseScriptRows(script);
  if (!rows.length) return "";
  return `
    <div class="script-table-wrap">
      <table class="script-table">
        <thead><tr><th>序号</th><th>时长/阶段</th><th>画面/镜头</th><th>旁白/字幕</th><th>素材建议</th></tr></thead>
        <tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.time)}</td><td>${escapeHtml(row.scene)}</td><td>${escapeHtml(row.voice)}</td><td>${escapeHtml(row.material)}</td></tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function parseScriptRows(script) {
  const lines = String(script || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^《.*》/.test(line) && !/^(分类|月份|主题|主旨|预计发布时间)[:：]/.test(line));

  const rows = [];
  for (const line of lines) {
    const timeMatch = line.match(/^([^：:]{0,18}?(?:\d+\s*[-~至]\s*\d+\s*秒|开场|承接|展开|证明|收束|结尾)[^：:]*)[：:](.*)$/);
    const time = timeMatch ? timeMatch[1].trim() : `段落 ${rows.length + 1}`;
    const content = (timeMatch ? timeMatch[2] : line).trim();
    const parts = content.split(/[；;。]/).map((part) => part.trim()).filter(Boolean);
    rows.push({
      time,
      scene: parts.find((part) => /画面|镜头|现场|素材|展示|切入|全景|细节/.test(part)) || parts[0] || content,
      voice: parts.find((part) => /旁白|字幕|说明|点出|回到|引导|表达/.test(part)) || parts[1] || content,
      material: parts.find((part) => /素材|建议|现场|全景|细节|人员|成果|客户/.test(part)) || parts[2] || "按该段内容匹配素材",
    });
  }
  return rows.slice(0, 20);
}
function renderBriefReadonlyForm(brief) {
  return `<div class="readonly-grid">
    ${readonlyField("所属月份", formatMonth(brief.plan_month))}
    ${readonlyField("当前阶段", statusLabels[brief.status])}
    ${readonlyField("剪辑人员", brief.editor_name || "未指定")}
    ${readonlyField("视频主题", getBriefTheme(brief))}
    ${readonlyField("创建时间", formatDateTime(brief.created_at))}
    ${readonlyField("预计发布时间", brief.publish_at ? formatDateTime(brief.publish_at) : "未设置")}
    ${readonlyField("最近更新", formatDateTime(brief.updated_at))}
    ${readonlyField("完成进度", `${progressPercent(brief)}%`)}
  </div>
  <label class="readonly-area">主题主旨<textarea readonly>${escapeHtml(brief.purpose)}</textarea></label>`;
}

function renderBriefEditForm(brief) {
  return `<div class="edit-grid">
    <label>主题分类<select id="editCategory">${categories.filter((category) => category !== "全部").map((category) => `<option value="${category}" ${brief.category === category ? "selected" : ""}>${category}</option>`).join("")}</select></label>
    <label>所属月份<input id="editMonth" type="month" value="${escapeAttr(String(brief.plan_month || "").slice(0, 7) || getCurrentMonth())}" /></label>
    <label>进度阶段<select id="editStatus">${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${brief.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <label>预计发布时间<input id="editPublishAt" type="datetime-local" value="${toDateTimeLocal(brief.publish_at)}" /></label>
    <label>企业微信通讯录筛选<input id="wecomSearch" placeholder="输入姓名筛选，如 蔡颖" /></label>
    <label>剪辑人员<select id="editorSelect"><option value="">请选择剪辑人员</option>${editors.map((name) => `<option value="${name}" ${brief.editor_name === name ? "selected" : ""}>${name}</option>`).join("")}</select></label>
  </div>
  <label class="editable-area">视频主题<input id="editTitle" value="${escapeAttr(getBriefTheme(brief))}" /></label>
  <label class="editable-area">主题主旨<textarea id="editPurpose">${escapeHtml(brief.purpose)}</textarea></label>`;
}
function readonlyField(label, value) {
  return `<label class="readonly-field"><span>${label}</span><input readonly value="${escapeAttr(value || "")} "/></label>`;
}

function stageRow(step, brief) {
  const done = stageDone(brief, step.key);
  return `<div class="stage-row ${done ? "done" : ""}"><span>${done ? "✓" : "○"}</span><strong>${step.label}</strong><input readonly value="${stageTime(brief, step.key) ? formatDateTime(stageTime(brief, step.key)) : "待完成"}" /></div>`;
}

function assetRow(asset) {
  const kind = asset.file_type?.startsWith("video/") ? "视频" : "照片";
  const checked = state.selectedAssetIds.has(asset.id) ? "checked" : "";
  const checkbox = state.assetDeleteMode ? `<input type="checkbox" data-asset-check="${asset.id}" ${checked} />` : "";
  return `<div class="table-row asset-row">${checkbox}<span>${kind}</span><strong>${escapeHtml(asset.file_name)}</strong><small>${formatDateTime(asset.created_at)}</small></div>`;
}
function assetCard(asset) {
  const kind = asset.file_type?.startsWith("video/") ? "视频" : "照片";
  return `<div class="asset-item"><span>${kind}</span><b>${escapeHtml(asset.file_name)}</b><small>${formatDateTime(asset.created_at)}</small></div>`;
}

function timelineItem(label, time, done) {
  return `<div class="timeline-item ${done ? "done" : ""}"><b>${done ? "✓" : "○"}</b><span>${label}</span><small>${time ? formatDateTime(time) : "待完成"}</small></div>`;
}

function stat(label, value) {
  return `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`;
}

function uploadBox(title, accept, kind, multiple) {
  return `<label class="upload-box"><span>⬆</span><span>${title}</span><input type="file" accept="${accept}" data-upload="${kind}" ${multiple ? "multiple" : ""} /></label>`;
}

function bindEvents() {
  document.querySelector('[data-action="refresh"]')?.addEventListener("click", loadWorkspace);
  document.querySelector('[data-action="logout"]')?.addEventListener("click", signOut);
  document.querySelector('[data-action="generate-script"]')?.addEventListener("click", generateScript);
  document.querySelector('[data-action="open-chatgpt"]')?.addEventListener("click", openChatGPTScriptLink);
  document.querySelector('[data-action="open-codex"]')?.addEventListener("click", openCodexScriptLink);
  document.querySelector('[data-action="save-confirmed-script"]')?.addEventListener("click", saveConfirmedScript);
  document.querySelector('[data-action="paste-confirmed-script"]')?.addEventListener("click", pasteConfirmedScript);
  document.querySelector('[data-action="edit-brief"]')?.addEventListener("click", toggleBriefEdit);
  document.querySelector('[data-action="save-brief-edit"]')?.addEventListener("click", saveBriefEdit);
  document.querySelector('[data-action="confirm-materials"]')?.addEventListener("click", openConfirmMaterialsModal);
  document.querySelector('[data-action="confirm-materials-yes"]')?.addEventListener("click", confirmMaterialsAndSend);
  document.querySelector('[data-action="confirm-materials-no"]')?.addEventListener("click", closeConfirmMaterialsModal);
  document.querySelector('[data-action="download-materials"]')?.addEventListener("click", downloadMaterialsPackage);
  document.querySelector("#editorSelect")?.addEventListener("change", assignEditor);
  document.querySelector("#wecomSearch")?.addEventListener("input", filterEditorSelect);
  document.querySelector("#briefForm")?.addEventListener("submit", createBrief);
  document.querySelector("#statusSelect")?.addEventListener("change", (event) => {
    const selected = getSelectedBrief();
    if (selected) updateBrief(selected.id, stagePatch(event.target.value));
  });
  document.querySelector("#monthFilterSelect")?.addEventListener("change", (event) => {
    state.monthFilter = event.target.value;
    state.selectedId = getVisibleBriefs()[0]?.id || null;
    renderApp();
  });
  document.querySelector("#categoryFilterSelect")?.addEventListener("change", (event) => {
    state.categoryFilter = event.target.value;
    state.selectedId = getVisibleBriefs()[0]?.id || null;
    renderApp();
  });
  document.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.select;
      state.notice = "";
      renderApp();
    });
  });
  document.querySelectorAll("[data-script-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      captureDraft();
      draft.script_mode = button.dataset.scriptMode;
      renderApp();
    });
  });
  document.querySelectorAll("[data-upload]").forEach((input) => {
    input.addEventListener("change", (event) => uploadFiles(event.target.files, input.dataset.upload));
  });
  document.querySelector('[data-action="toggle-asset-delete"]')?.addEventListener("click", toggleAssetDeleteMode);
  document.querySelector('[data-action="delete-selected-assets"]')?.addEventListener("click", deleteSelectedAssets);
  document.querySelectorAll("[data-asset-check]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => toggleAssetSelection(checkbox.dataset.assetCheck, checkbox.checked));
  });
  app.onclick = (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "confirm-materials-yes") confirmMaterialsAndSend();
    if (action === "confirm-materials-no") closeConfirmMaterialsModal();
  };
}

function toggleBriefEdit() {
  const selected = getSelectedBrief();
  if (!selected) return;
  state.editingBriefId = state.editingBriefId === selected.id ? null : selected.id;
  renderApp();
}

async function saveBriefEdit() {
  const selected = getSelectedBrief();
  if (!selected) return;
  const editorName = document.querySelector("#editorSelect")?.value || null;
  const status = document.querySelector("#editStatus")?.value || selected.status;
  const patch = {
    category: document.querySelector("#editCategory")?.value || selected.category,
    plan_month: `${document.querySelector("#editMonth")?.value || getCurrentMonth()}-01`,
    title: document.querySelector("#editTitle")?.value?.trim() || getBriefTheme(selected),
    theme: document.querySelector("#editTitle")?.value?.trim() || getBriefTheme(selected),
    purpose: document.querySelector("#editPurpose")?.value?.trim() || selected.purpose,
    publish_at: document.querySelector("#editPublishAt")?.value || null,
    status,
    editor_name: editorName,
    ...(editorName && editorName !== selected.editor_name ? { editor_assigned_at: new Date().toISOString() } : {}),
    ...stagePatch(status),
  };
  state.editingBriefId = null;
  await updateBrief(selected.id, patch);
  state.notice = "主题信息已保存。";
  renderApp();
}
function renderConfirmModal() {
  const brief = state.briefs.find((item) => item.id === state.confirmMaterialsId);
  if (!brief) return "";
  const assets = state.assets[brief.id] || [];
  return `<div class="modal-backdrop">
    <section class="confirm-modal">
      <h2>确认素材上传完毕？</h2>
      <p>主题：${escapeHtml(getBriefTheme(brief))}</p>
      <p>剪辑人员：${escapeHtml(brief.editor_name || "未指定")}</p>
      <p>已上传素材：${assets.length} 个</p>
      <div class="modal-actions">
        <button class="action-button" data-action="confirm-materials-yes">是，确认并发送企业微信</button>
        <button class="ghost-button" data-action="confirm-materials-no">否，继续上传素材</button>
      </div>
    </section>
  </div>`;
}

async function downloadMaterialsPackage() {
  const selected = getSelectedBrief();
  if (!selected) return;
  const assets = state.assets[selected.id] || [];
  if (!assets.length) {
    state.notice = "当前主题还没有可下载的素材。";
    renderApp();
    return;
  }

  const files = assets
    .map((asset) => ({ asset, file: state.fileBlobs[asset.blob_id] }))
    .filter((item) => item.file);

  if (!files.length) {
    state.notice = "这些素材是旧记录，浏览器里没有原始视频/照片文件。请重新上传素材后再打包下载。";
    renderApp();
    return;
  }

  const zipBlob = await createZipBlob(files.map(({ asset, file }, index) => ({
    name: `${String(index + 1).padStart(2, "0")}-${sanitizeZipName(asset.file_name)}`,
    file,
  })));
  const url = URL.createObjectURL(zipBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeZipName(getBriefTheme(selected))}-素材包.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  state.notice = "已打包下载本次上传的视频/照片素材。";
  renderApp();
}

async function createZipBlob(entries) {
  const fileRecords = [];
  const centralRecords = [];
  let offset = 0;
  for (const entry of entries) {
    const bytes = new Uint8Array(await entry.file.arrayBuffer());
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    fileRecords.push(local, bytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const cview = new DataView(central.buffer);
    cview.setUint32(0, 0x02014b50, true);
    cview.setUint16(4, 20, true);
    cview.setUint16(6, 20, true);
    cview.setUint16(8, 0x0800, true);
    cview.setUint16(10, 0, true);
    cview.setUint16(12, 0, true);
    cview.setUint16(14, 0, true);
    cview.setUint32(16, crc, true);
    cview.setUint32(20, bytes.length, true);
    cview.setUint32(24, bytes.length, true);
    cview.setUint16(28, nameBytes.length, true);
    cview.setUint16(30, 0, true);
    cview.setUint16(32, 0, true);
    cview.setUint16(34, 0, true);
    cview.setUint16(36, 0, true);
    cview.setUint32(38, 0, true);
    cview.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralRecords.push(central);
    offset += local.length + bytes.length;
  }

  const centralSize = centralRecords.reduce((sum, record) => sum + record.length, 0);
  const end = new Uint8Array(22);
  const eview = new DataView(end.buffer);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(8, entries.length, true);
  eview.setUint16(10, entries.length, true);
  eview.setUint32(12, centralSize, true);
  eview.setUint32(16, offset, true);
  return new Blob([...fileRecords, ...centralRecords, end], { type: "application/zip" });
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function sanitizeZipName(name) {
  return String(name || "素材").replace(/[\\/:*?"<>|]/g, "_");
}
function filterEditorSelect(event) {
  const keyword = event.target.value.trim().toLowerCase();
  const select = document.querySelector("#editorSelect");
  if (!select) return;
  const selected = getSelectedBrief();
  const names = editors.filter((name) => !keyword || name.toLowerCase().includes(keyword));
  select.innerHTML = `<option value="">请选择剪辑人员</option>${names.map((name) => `<option value="${name}" ${selected?.editor_name === name ? "selected" : ""}>${name}</option>`).join("")}`;
}

async function assignEditor(event) {
  const selected = getSelectedBrief();
  const editorName = event.target.value;
  if (!selected || !editorName) return;
  await updateBrief(selected.id, {
    editor_name: editorName,
    editor_assigned_at: new Date().toISOString(),
    ...stagePatch("editing", { editing_at: new Date().toISOString() }),
  });
  state.notice = `已指定剪辑人员：${editorName}。`;
  renderApp();
}

function openConfirmMaterialsModal() {
  const selected = getSelectedBrief();
  if (!selected) return;
  const assets = state.assets[selected.id] || [];
  if (!assets.length) {
    state.notice = "请先上传对应主题素材，再确认素材上传完毕。";
    renderApp();
    return;
  }
  if (!selected.editor_name) {
    state.notice = "请先选择剪辑人员，再确认素材上传完毕。";
    renderApp();
    return;
  }
  state.confirmMaterialsId = selected.id;
  renderApp();
}

function closeConfirmMaterialsModal() {
  state.confirmMaterialsId = null;
  state.notice = "已取消确认，可继续上传素材。";
  renderApp();
}

async function confirmMaterialsAndSend() {
  const selected = state.briefs.find((brief) => brief.id === state.confirmMaterialsId) || getSelectedBrief();
  if (!selected) return;
  const now = new Date().toISOString();
  state.confirmMaterialsId = null;

  const patch = {
    materials_confirmed_at: now,
    ...stagePatch("materials", { materials_at: now }),
  };

  if (state.demo) {
    state.briefs = state.briefs.map((brief) => brief.id === selected.id ? normalizeBrief({ ...brief, ...patch, updated_at: now }) : brief);
    saveDemoWorkspace();
  } else {
    const { data, error } = await state.supabase.from("video_briefs").update(patch).eq("id", selected.id).select().single();
    if (error) {
      state.notice = error.message;
      renderApp();
      return;
    }
    state.briefs = state.briefs.map((brief) => brief.id === selected.id ? normalizeBrief(data) : brief);
  }

  const updated = state.briefs.find((brief) => brief.id === selected.id) || normalizeBrief({ ...selected, ...patch });
  await sendWecomToEditor(updated, { skipValidation: true, suppressRender: true });
  renderApp();
}
function buildShareLinks() {
  const url = new URL(window.location.href);
  url.searchParams.set("v", "20260716k");
  const webLink = url.toString();
  let mobileLink = webLink;
  if (["127.0.0.1", "localhost"].includes(url.hostname)) {
    url.hostname = "192.168.1.176";
    mobileLink = url.toString();
  }
  return { webLink, mobileLink };
}

function buildWecomMessage(brief) {
  const { webLink, mobileLink } = buildShareLinks();
  return `【筑峰短视频剪辑任务】\n剪辑人员：${brief.editor_name || "未指定"}\n分类：${brief.category}\n月份：${formatMonth(brief.plan_month)}\n视频主题：${getBriefTheme(brief)}\n当前阶段：${statusLabels[brief.status]}\n素材确认时间：${brief.materials_confirmed_at ? formatDateTime(brief.materials_confirmed_at) : "未确认"}\n\n网页链接：${webLink}\n手机链接：${mobileLink}`;
}

async function sendWecomToEditor(targetBrief, options = {}) {
  const selected = targetBrief || getSelectedBrief();
  if (!selected) return;
  if (!selected.editor_name) {
    state.notice = "请先选择剪辑人员。";
    renderApp();
    return;
  }
  if (!options.skipValidation && !selected.materials_confirmed_at) {
    state.notice = "请先点击“确认素材上传完毕”。";
    renderApp();
    return;
  }
  const message = buildWecomMessage(selected);
  let sent = false;
  try {
    const response = await fetch("/api/send-wecom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editorName: selected.editor_name, message, ...buildShareLinks() }),
    });
    sent = response.ok && (await response.json()).ok;
  } catch (_error) {
    sent = false;
  }
  await copyPromptToClipboard(message);
  const sentAt = new Date().toISOString();
  if (state.demo) {
    state.briefs = state.briefs.map((brief) => brief.id === selected.id ? normalizeBrief({ ...brief, sent_to_editor_at: sentAt, updated_at: sentAt }) : brief);
    saveDemoWorkspace();
  } else {
    await state.supabase.from("video_briefs").update({ sent_to_editor_at: sentAt }).eq("id", selected.id);
  }
  state.notice = sent ? "已通过企业微信发送给剪辑人员。" : "企业微信接口未配置，已把发送内容复制到剪贴板，可手动发送给剪辑人员。";
  if (!options.suppressRender) renderApp();
}
function captureDraft() {
  const form = document.querySelector("#briefForm");
  if (!form) return;
  const data = new FormData(form);
  draft = {
    ...draft,
    category: String(data.get("category") || "展会"),
    plan_month: String(data.get("plan_month") || getCurrentMonth()),
    title: String(data.get("title") || ""),
    purpose: String(data.get("purpose") || ""),
    publish_at: String(data.get("publish_at") || ""),
  };
}

async function createBrief(event) {
  event.preventDefault();
  captureDraft();
  if (!draft.plan_month || !draft.title || !draft.purpose) return;

  const now = new Date().toISOString();
  const payload = {
    user_id: state.session.user.id,
    category: draft.category,
    plan_month: `${draft.plan_month}-01`,
    title: draft.title,
    theme: draft.title,
    purpose: draft.purpose,
    publish_at: draft.publish_at || null,
    script_mode: draft.script_mode,
    status: "briefing",
    briefing_at: now,
  };

  if (state.demo) {
    const data = normalizeBrief({ ...payload, id: makeId(), created_at: now, updated_at: now });
    state.briefs = [data, ...state.briefs];
    state.selectedId = data.id;
    draft = { ...emptyDraft, plan_month: draft.plan_month };
    state.notice = "主题已添加，创建时间已自动记录。";
    saveDemoWorkspace();
    renderApp();
    return;
  }

  state.busy = true;
  renderApp();
  const { data, error } = await state.supabase.from("video_briefs").insert(payload).select().single();
  state.busy = false;
  if (error) {
    state.notice = error.message;
    renderApp();
    return;
  }
  state.briefs = [normalizeBrief(data), ...state.briefs];
  state.selectedId = data.id;
  draft = { ...emptyDraft, plan_month: draft.plan_month };
  state.notice = "主题已添加，创建时间已自动记录。";
  renderApp();
}

async function updateBrief(id, patch) {
  if (state.demo) {
    state.briefs = state.briefs.map((brief) => brief.id === id ? normalizeBrief({ ...brief, ...patch, updated_at: new Date().toISOString() }) : brief);
    saveDemoWorkspace();
    renderApp();
    return;
  }

  const { data, error } = await state.supabase.from("video_briefs").update(patch).eq("id", id).select().single();
  if (error) {
    state.notice = error.message;
    renderApp();
    return;
  }
  state.briefs = state.briefs.map((brief) => (brief.id === id ? normalizeBrief(data) : brief));
  renderApp();
}

function buildScriptPrompt(brief) {
  return `请根据以下信息，为筑峰短视频宣传工作台生成一份可拍摄、可剪辑的短视频脚本，并支持我后续继续优化。\n\n分类：${brief.category}\n所属月份：${formatMonth(brief.plan_month)}\n主题名称：${brief.title}\n视频主题：${getBriefTheme(brief)}\n主题主旨：${brief.purpose}\n预计发布时间：${brief.publish_at ? formatDateTime(brief.publish_at) : "未设置"}\n\n输出要求：\n1. 时长45-60秒；\n2. 按镜头时间段输出；\n3. 每段包含画面建议、旁白/字幕、素材需求；\n4. 商务风，简洁专业；\n5. 结尾包含筑峰品牌露出和行动引导；\n6. 先给一版完整脚本，然后问我是否要调整风格、时长或重点。`;
}

async function copyPromptToClipboard(prompt) {
  try {
    await navigator.clipboard.writeText(prompt);
    return true;
  } catch (_error) {
    return false;
  }
}

async function openChatGPTScriptLink() {
  const selected = getSelectedBrief();
  if (!selected) return;
  const prompt = buildScriptPrompt(selected);
  await copyPromptToClipboard(prompt);
  const url = `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  state.notice = "已打开 ChatGPT，并尝试复制脚本提示词。确认脚本后，请粘贴到“已确定脚本”并保存。";
  renderApp();
}

async function openCodexScriptLink() {
  const selected = getSelectedBrief();
  if (!selected) return;
  const prompt = buildScriptPrompt(selected);
  await copyPromptToClipboard(prompt);
  window.open("https://chatgpt.com/codex", "_blank", "noopener,noreferrer");
  state.notice = "已打开 Codex 页面，并尝试复制脚本提示词。若页面不可用，可直接粘贴提示词到当前 Codex 会话继续优化。";
  renderApp();
}

async function pasteConfirmedScript() {
  const textarea = document.querySelector("#confirmedScript");
  if (!textarea) return;
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      state.notice = "剪贴板里没有可粘贴的脚本内容。";
      renderApp();
      return;
    }
    textarea.value = text.trim();
    state.notice = "已从剪贴板粘贴脚本，确认无误后点击保存。";
  } catch (_error) {
    state.notice = "浏览器未允许读取剪贴板，请手动粘贴，或在弹窗中允许剪贴板权限。";
    renderApp();
  }
}
async function saveConfirmedScript() {
  const selected = getSelectedBrief();
  const textarea = document.querySelector("#confirmedScript");
  const script = textarea?.value?.trim();
  if (!selected || !script) {
    state.notice = "请先填写已确定脚本。";
    renderApp();
    return;
  }
  await updateBrief(selected.id, {
    generated_script: script,
    script_mode: "generate",
    ...stagePatch("script", { script_generated_at: new Date().toISOString(), script_at: new Date().toISOString() }),
  });
  state.notice = "已保存确定脚本，脚本阶段时间已自动记录。";
  renderApp();
}
async function generateScript() {
  const selected = getSelectedBrief();
  if (!selected) return;
  state.busy = true;
  state.notice = "正在生成脚本...";
  renderApp();

  let script = "";
  try {
    const response = await fetch("/api/generate-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: selected.category, title: getBriefTheme(selected), month: formatMonth(selected.plan_month), theme: getBriefTheme(selected), purpose: selected.purpose, publishAt: selected.publish_at }),
    });
    if (response.ok) {
      const data = await response.json();
      script = data.script || "";
    }
  } catch (_error) {
    script = "";
  }

  if (!script) script = buildLocalScript(selected);

  state.busy = false;
  await updateBrief(selected.id, {
    generated_script: script,
    script_mode: "generate",
    ...stagePatch("script", { script_generated_at: new Date().toISOString() }),
  });
  state.notice = state.demo ? "已生成本地脚本。配置 OPENAI_API_KEY 后可连接 ChatGPT 生成。" : "脚本已生成。";
  renderApp();
}

function buildLocalScript(brief) {
  return `《${brief.title}》短视频脚本\n\n分类：${brief.category}\n月份：${formatMonth(brief.plan_month)}\n主题：${getBriefTheme(brief)}\n主旨：${brief.purpose}\n预计发布时间：${brief.publish_at ? formatDateTime(brief.publish_at) : "待定"}\n\n开场 0-3 秒：用最有现场感的镜头切入，直接点出本期主题。\n承接 3-10 秒：用一句话说明客户关心的问题或项目亮点。\n展开 10-30 秒：选择 3 组素材展示筑峰的执行过程、细节标准和交付成果。\n证明 30-45 秒：加入现场对比、团队协作或客户反馈，强化可信度。\n收束 45-60 秒：回到主旨“${brief.purpose}”，露出品牌和咨询引导。\n\n画面建议：现场全景、关键细节、人员协作、完工成果交替出现。\n字幕语气：简洁、专业、有行动感。`;
}

async function uploadFiles(files, kind) {
  const selected = getSelectedBrief();
  if (!selected || !files?.length) return;
  const now = new Date().toISOString();

  if (state.demo) {
    for (const file of Array.from(files)) {
      const mockPath = `${state.session.user.id}/${selected.id}/${Date.now()}-${file.name}`;
      if (kind === "asset") addLocalAsset(selected.id, file, mockPath, now);
      if (kind === "script") Object.assign(selected, { uploaded_script_path: mockPath, script_mode: "upload", script_uploaded_at: now });
      if (kind === "final") Object.assign(selected, { final_video_path: mockPath, final_video_name: file.name, final_video_uploaded_at: now });
    }
    const patch = kind === "asset" ? { updated_at: now } : kind === "script" ? stagePatch("script", { script_uploaded_at: now, script_mode: "upload" }) : stagePatch("done", { final_video_uploaded_at: now });
    state.briefs = state.briefs.map((brief) => brief.id === selected.id ? normalizeBrief({ ...brief, ...selected, ...patch, updated_at: now }) : brief);
    state.notice = "已记录上传信息和阶段时间。正式部署后文件会上传到 Supabase Storage。";
    saveDemoWorkspace();
    renderApp();
    return;
  }

  state.busy = true;
  renderApp();
  for (const file of Array.from(files)) {
    const bucket = kind === "final" ? "final-videos" : "video-materials";
    const safeName = file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
    const path = `${state.session.user.id}/${selected.id}/${Date.now()}-${safeName}`;
    const uploadResult = await state.supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type });
    if (uploadResult.error) {
      state.busy = false;
      state.notice = uploadResult.error.message;
      renderApp();
      return;
    }

    if (kind === "asset") {
      const { data, error } = await state.supabase.from("media_assets").insert({
        brief_id: selected.id,
        uploaded_by: state.session.user.id,
        file_name: file.name,
        file_path: path,
        mime_type: file.type || "application/octet-stream",
        file_size: file.size,
      }).select().single();
      if (error) {
        state.busy = false;
        state.notice = error.message;
        renderApp();
        return;
      }
      state.assets[selected.id] ||= [];
      state.assets[selected.id].unshift(data);
    }

    if (kind === "script") await updateBrief(selected.id, { uploaded_script_path: path, script_mode: "upload", ...stagePatch("script", { script_uploaded_at: now }) });
    if (kind === "final") await updateBrief(selected.id, { final_video_path: path, final_video_name: file.name, ...stagePatch("done", { final_video_uploaded_at: now }) });
  }

  if (kind === "asset") await updateBrief(selected.id, { updated_at: now });
  state.busy = false;
  state.notice = kind === "asset" ? "素材已上传。点击确认素材上传完毕后进入素材确认阶段。" : "上传完成，已记录阶段时间。";
  renderApp();
}

function toggleAssetDeleteMode() {
  state.assetDeleteMode = !state.assetDeleteMode;
  state.selectedAssetIds = new Set();
  renderApp();
}

function toggleAssetSelection(assetId, checked) {
  if (!assetId) return;
  if (checked) state.selectedAssetIds.add(assetId);
  else state.selectedAssetIds.delete(assetId);
}

async function deleteSelectedAssets() {
  const ids = Array.from(state.selectedAssetIds);
  if (!ids.length) {
    state.notice = "请先勾选要删除的素材。";
    renderApp();
    return;
  }
  if (!window.confirm(`确定删除已勾选的 ${ids.length} 个素材？`)) return;
  await deleteAssets(ids);
}

async function deleteAssets(assetIds) {
  const selected = getSelectedBrief();
  if (!selected || !assetIds.length) return;
  const assets = state.assets[selected.id] || [];
  const deleting = assets.filter((asset) => assetIds.includes(asset.id));
  if (!deleting.length) return;

  if (state.demo) {
    for (const asset of deleting) if (asset.blob_id) delete state.fileBlobs[asset.blob_id];
    state.assets[selected.id] = assets.filter((asset) => !assetIds.includes(asset.id));
    if (!state.assets[selected.id].length) {
      state.briefs = state.briefs.map((brief) => brief.id === selected.id ? normalizeBrief({ ...brief, materials_confirmed_at: null, materials_at: null, status: brief.status === "materials" ? "script" : brief.status, updated_at: new Date().toISOString() }) : brief);
    }
    state.assetDeleteMode = false;
    state.selectedAssetIds = new Set();
    state.notice = "已删除所选素材。";
    saveDemoWorkspace();
    renderApp();
    return;
  }

  const paths = deleting.map((asset) => asset.file_path).filter(Boolean);
  if (paths.length) {
    const storageResult = await state.supabase.storage.from("video-materials").remove(paths);
    if (storageResult.error) {
      state.notice = storageResult.error.message;
      renderApp();
      return;
    }
  }
  const dbResult = await state.supabase.from("media_assets").delete().in("id", assetIds);
  if (dbResult.error) {
    state.notice = dbResult.error.message;
    renderApp();
    return;
  }
  state.assets[selected.id] = assets.filter((asset) => !assetIds.includes(asset.id));
  if (!state.assets[selected.id].length) await updateBrief(selected.id, { materials_confirmed_at: null, materials_at: null });
  state.assetDeleteMode = false;
  state.selectedAssetIds = new Set();
  state.notice = "已删除所选素材，并同步数据库。";
  renderApp();
}
async function deleteAsset(assetId) {
  const selected = getSelectedBrief();
  if (!selected || !assetId) return;
  const asset = (state.assets[selected.id] || []).find((item) => item.id === assetId);
  if (!asset) return;

  if (!window.confirm(`确定删除素材“${asset.file_name}”？`)) return;

  if (state.demo) {
    state.assets[selected.id] = (state.assets[selected.id] || []).filter((item) => item.id !== assetId);
    if (asset.blob_id) delete state.fileBlobs[asset.blob_id];
    if (!state.assets[selected.id].length) {
      state.briefs = state.briefs.map((brief) => brief.id === selected.id ? normalizeBrief({ ...brief, materials_confirmed_at: null, materials_at: null, status: brief.status === "materials" ? "script" : brief.status, updated_at: new Date().toISOString() }) : brief);
    }
    state.notice = "素材已删除。";
    saveDemoWorkspace();
    renderApp();
    return;
  }

  const bucket = asset.file_type?.startsWith("video/") || asset.file_type?.startsWith("image/") ? "video-materials" : "video-materials";
  const storageResult = await state.supabase.storage.from(bucket).remove([asset.file_path]);
  if (storageResult.error) {
    state.notice = storageResult.error.message;
    renderApp();
    return;
  }
  const dbResult = await state.supabase.from("media_assets").delete().eq("id", assetId);
  if (dbResult.error) {
    state.notice = dbResult.error.message;
    renderApp();
    return;
  }
  state.assets[selected.id] = (state.assets[selected.id] || []).filter((item) => item.id !== assetId);
  if (!state.assets[selected.id].length) await updateBrief(selected.id, { materials_confirmed_at: null, materials_at: null });
  state.notice = "素材已删除。";
  renderApp();
}
function addLocalAsset(briefId, file, filePath, createdAt) {
  state.assets[briefId] ||= [];
  const blobId = makeId();
  state.fileBlobs[blobId] = file;
  state.assets[briefId].unshift({
    id: makeId(),
    blob_id: blobId,
    brief_id: briefId,
    user_id: state.session.user.id,
    file_name: file.name,
    file_path: filePath,
    file_type: file.type || "application/octet-stream",
    file_size: file.size,
    created_at: createdAt,
  });
}

function stagePatch(status, extra = {}) {
  const now = new Date().toISOString();
  const patch = { status, ...extra };
  const field = stageSteps.find((step) => step.key === status)?.field;
  if (field && !patch[field]) patch[field] = now;
  if (status === "editing" && !patch.editing_at) patch.editing_at = now;
  if (status === "done" && !patch.done_at) patch.done_at = now;
  return patch;
}

function stageDone(brief, key) {
  if (key === "briefing") return true;
  if (key === "materials") return Boolean(brief.materials_confirmed_at);
  if (key === "script") return Boolean(brief.generated_script || brief.uploaded_script_path || brief.script_at);
  if (key === "editing") return ["editing", "done"].includes(brief.status) || Boolean(brief.editing_at || brief.final_video_path);
  if (key === "done") return brief.status === "done" || Boolean(brief.final_video_path || brief.done_at);
  return false;
}

function stageTime(brief, key) {
  if (key === "briefing") return brief.briefing_at || brief.created_at;
  if (key === "materials") return brief.materials_confirmed_at;
  if (key === "script") return brief.script_at || brief.script_generated_at || brief.script_uploaded_at;
  if (key === "editing") return brief.editing_at;
  if (key === "done") return brief.done_at || brief.final_video_uploaded_at;
  return null;
}

function progressPercent(brief) {
  const complete = stageSteps.filter((step) => stageDone(brief, step.key)).length;
  return Math.round((complete / stageSteps.length) * 100);
}

function getVisibleBriefs() {
  return state.briefs.filter((brief) => {
    const categoryOk = state.categoryFilter === "全部" || brief.category === state.categoryFilter;
    const monthOk = state.monthFilter === "全部" || String(brief.plan_month || "").slice(0, 7) === state.monthFilter;
    const statusOk = state.statusFilter === "全部" || brief.status === state.statusFilter;
    return categoryOk && monthOk && statusOk;
  });
}

function getSelectedBrief() {
  const visible = getVisibleBriefs();
  return visible.find((brief) => brief.id === state.selectedId) || visible[0] || null;
}

function currentMonthLabel() {
  if (state.monthFilter !== "全部") return formatMonth(state.monthFilter);
  return formatMonth(getCurrentMonth());
}

function getBriefTheme(brief) {
  return brief.title || brief.theme || "未命名主题";
}

function groupBriefsByMonth(briefs) {
  return briefs.reduce((grouped, brief) => {
    const key = String(brief.plan_month || brief.created_at || "").slice(0, 7) || "未设置月份";
    grouped[key] ||= [];
    grouped[key].push(brief);
    return grouped;
  }, {});
}

function loadDemoWorkspace() {
  const saved = readDemoStorage();
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.briefs = normalizeBriefs(parsed.briefs || []);
      state.assets = parsed.assets || {};
      state.selectedId = parsed.selectedId || state.briefs[0]?.id || null;
      return;
    } catch (_error) {
      try { localStorage.removeItem("zhufeng-demo-workspace"); } catch (_err) {}
    }
  }

  const now = new Date().toISOString();
  const sampleId = makeId();
  state.briefs = [normalizeBrief({
    id: sampleId,
    user_id: state.session.user.id,
    category: "公司日常",
    title: "本月筑峰品牌宣传规划",
    plan_month: `${getCurrentMonth()}-01`,
    theme: "本月筑峰品牌宣传规划",
    purpose: "用真实现场素材呈现筑峰的专业能力、响应速度和交付质量。",
    publish_at: null,
    script_mode: "generate",
    status: "briefing",
    briefing_at: now,
    created_at: now,
    updated_at: now,
  })];
  state.assets = {};
  state.selectedId = sampleId;
  state.notice = "当前为本地演示模式：可先查看和操作页面，部署到 Vercel 并配置 Supabase 后启用真实登录与上传。";
  saveDemoWorkspace();
}

function saveDemoWorkspace() {
  if (!state.demo) return;
  writeDemoStorage(JSON.stringify({ briefs: state.briefs, assets: state.assets, selectedId: state.selectedId }));
}

function normalizeBriefs(briefs) {
  return briefs.map(normalizeBrief);
}

function normalizeBrief(brief) {
  return {
    category: "展会",
    generated_script: null,
    script_generated_at: null,
    uploaded_script_path: null,
    script_uploaded_at: null,
    final_video_path: null,
    final_video_name: null,
    final_video_uploaded_at: null,
    editor_name: null,
    editor_assigned_at: null,
    materials_confirmed_at: null,
    sent_to_editor_at: null,
    briefing_at: brief.created_at || new Date().toISOString(),
    materials_at: null,
    script_at: null,
    editing_at: null,
    done_at: null,
    ...brief,
  };
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readDemoStorage() {
  try { return localStorage.getItem("zhufeng-demo-workspace"); } catch (_error) { return null; }
}

function writeDemoStorage(value) {
  try { localStorage.setItem("zhufeng-demo-workspace", value); } catch (_error) {}
}

function getCurrentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(value) {
  if (!value) return "未设置月份";
  const [year, month] = String(value).slice(0, 7).split("-");
  return `${year}年${Number(month)}月`;
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function fileNameFromPath(value) {
  if (!value) return "";
  return String(value).split("/").pop()?.replace(/^\d+-/, "") || value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

























