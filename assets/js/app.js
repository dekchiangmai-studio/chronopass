const KEY = "ai-account-tracker-v1";
const SUPABASE_URL = (window.SUPABASE_URL || "").trim();
const SUPABASE_ANON_KEY = (window.SUPABASE_ANON_KEY || "").trim();
const LIFF_ID = (window.LIFF_ID || "").trim();
const LINE_CLIENT_ID = (window.LINE_CLIENT_ID || "").trim();
const LINE_REDIRECT_URI = (window.LINE_REDIRECT_URI || "").trim();
const NORMALIZED_SUPABASE_URL = SUPABASE_URL.replace(/\/rest\/v1\/?$/, "");
const supabase = NORMALIZED_SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase
  ? window.supabase.createClient(NORMALIZED_SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let accounts = [];
let currentUser = null;
let liffReady = false;

function getLocalAccounts() {
  return JSON.parse(localStorage.getItem(KEY) || "null") || [];
}

function updateAuthUI() {
  const loginBtn = document.getElementById("lineLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userLabel = document.getElementById("userLabel");

  if (!loginBtn || !logoutBtn || !userLabel) return;

  if (currentUser) {
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-flex";
    userLabel.style.display = "inline";
    userLabel.textContent = currentUser.display_name || currentUser.email || "LINE User";
  } else {
    loginBtn.style.display = "none";
    logoutBtn.style.display = "none";
    userLabel.style.display = "none";
    userLabel.textContent = "";
  }
}

function getLiffDecodedToken() {
  if (!window.liff || typeof window.liff.getDecodedIDToken !== "function") {
    return null;
  }

  try {
    return window.liff.getDecodedIDToken();
  } catch (error) {
    console.warn("Unable to decode LIFF ID token:", error);
    return null;
  }
}

async function ensureUserExistsFromLine(profile) {
  if (!supabase) return null;

  const decodedToken = getLiffDecodedToken();
  const payload = {
    line_user_id: String(profile.userId || profile.id || profile.sub || ""),
    display_name: profile.displayName || "LINE User",
    picture_url: profile.pictureUrl || null,
    email: decodedToken?.email || profile.email || null,
    status: "active",
  };

  if (!payload.line_user_id) {
    throw new Error("LINE user id ไม่ถูกต้อง");
  }

  const { data, error } = await supabase
    .from("users")
    .upsert(payload, { onConflict: "line_user_id" })
    .select();

  if (error) {
    console.error("Supabase user upsert failed:", error);
    throw error;
  }

  return data?.[0] || null;
}

async function handleLiffProfile(profile) {
  try {
    const user = await ensureUserExistsFromLine(profile);
    if (!user) {
      throw new Error("ไม่มีข้อมูลผู้ใช้ในตาราง users");
    }

    currentUser = user;
    sessionStorage.setItem("line_user_id", user.line_user_id);
    await hydrateAccounts();
    render();
    return true;
  } catch (error) {
    console.error(error);
    toast(error.message || "เข้าสู่ระบบด้วย LIFF ไม่สำเร็จ");
    return false;
  }
}

function signInWithLine() {
  if (!window.liff || !LIFF_ID) {
    toast("เปิดจาก LINE LIFF เท่านั้น: ต้องเปิดใน LINE app หรือ URL ที่รองรับ LIFF");
    return;
  }

  if (!liffReady) {
    toast("กำลังเริ่มต้น LINE LIFF กรุณารอสักครู่");
    return;
  }

  if (!window.liff.isLoggedIn()) {
    window.liff.login({
      redirectUri: window.location.href,
      scope: "profile openid email",
    });
    return;
  }

  window.liff.getProfile().then(handleLiffProfile).catch((error) => {
    console.error(error);
    toast("ดึงข้อมูล LINE profile ไม่สำเร็จ");
  });
}

async function signOut() {
  currentUser = null;
  accounts = [];
  sessionStorage.removeItem("line_user_id");
  updateAuthUI();
  render();
  toast("ออกจากระบบแล้ว");
}

async function hydrateAccounts() {
  accounts = getLocalAccounts();

  if (!supabase || !currentUser) {
    return;
  }

  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Supabase load failed:", error);
    return;
  }

  if (Array.isArray(data) && data.length) {
    accounts = data.map((row) => ({
      id: Number(row.id),
      service: row.service,
      label: row.label || row.email,
      email: row.email,
      resetMode: row.reset_mode || "hours",
      resetHours: Number(row.reset_hours || 6),
      resetTime: row.reset_time || "06:00",
      lastUsed: row.last_used ? Number(row.last_used) : null,
      user_id: row.user_id,
    }));
    localStorage.setItem(KEY, JSON.stringify(accounts));
  } else {
    accounts = getLocalAccounts().filter((account) => account.user_id === currentUser.id || !account.user_id);
    localStorage.setItem(KEY, JSON.stringify(accounts));
  }
}

async function save() {
  localStorage.setItem(KEY, JSON.stringify(accounts));

  if (!supabase || !currentUser) return;

  const rows = accounts.map((account) => ({
    id: Number(account.id),
    user_id: currentUser.id,
    email: String(account.email || "").trim(),
    label: String(account.label || account.email || "").trim(),
    service: String(account.service || "Copilot"),
    reset_mode: String(account.resetMode || "hours"),
    reset_hours: Number(account.resetHours || 6),
    reset_time: String(account.resetTime || "06:00"),
    last_used: account.lastUsed ? Number(account.lastUsed) : null,
  }));

  const { error } = await supabase.from("accounts").upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("Supabase save failed:", error);
  }
}

function getPresetConfig(serviceName) {
  const lower = String(serviceName || "").toLowerCase();

  if (lower.includes("copilot")) {
    return { resetMode: "monthly", resetHours: 24 * 30, resetTime: "00:00", resetDay: 1 };
  }

  if (lower.includes("antigravity") || lower.includes("google ant")) {
    return { resetMode: "days", resetHours: 7 * 24, resetTime: "08:00" };
  }

  if (lower.includes("gemini")) {
    return { resetMode: "hours", resetHours: 24, resetTime: "00:00" };
  }

  if (lower.includes("claude")) {
    return { resetMode: "hours", resetHours: 24, resetTime: "00:00" };
  }

  if (lower.includes("chatgpt")) {
    return { resetMode: "hours", resetHours: 24, resetTime: "00:00" };
  }

  if (lower.includes("perplexity")) {
    return { resetMode: "hours", resetHours: 12, resetTime: "00:00" };
  }

  return { resetMode: "hours", resetHours: 6, resetTime: "06:00" };
}

function getNextResetTime(account, referenceTime) {
  const ref = new Date(referenceTime);
  const preset = getPresetConfig(account.service);
  const { resetMode, resetHours } = preset;

  if (resetMode === "hours") {
    const interval = (Number(resetHours) || 1) * 3600000;
    const cycles = Math.floor((Date.now() - ref.getTime()) / interval) + 1;
    return new Date(ref.getTime() + cycles * interval);
  }

  if (resetMode === "days") {
    const interval = (Number(resetHours) || 1) * 3600000;
    const cycles = Math.floor((Date.now() - ref.getTime()) / interval) + 1;
    return new Date(ref.getTime() + cycles * interval);
  }

  if (resetMode === "monthly") {
    const day = Math.min(31, Math.max(1, Number(preset.resetDay) || 1));
    let candidate = new Date(ref.getFullYear(), ref.getMonth(), day, 0, 0, 0, 0);

    while (candidate.getTime() <= ref.getTime()) {
      candidate = new Date(candidate.getFullYear(), candidate.getMonth() + 1, day, 0, 0, 0, 0);
    }

    return candidate;
  }

  return new Date(ref.getTime() + 3600000);
}

function scheduleText(account) {
  const preset = getPresetConfig(account.service);

  if (preset.resetMode === "hours") {
    return `${preset.resetHours || 1} ชม.`;
  }

  if (preset.resetMode === "days") {
    return `${Math.round((preset.resetHours || 24) / 24)} วัน`;
  }

  if (preset.resetMode === "monthly") {
    return "ทุกวันที่ 1 ของเดือน";
  }

  return "ตามกำหนดเวลา";
}

function state(a) {
  if (!a.lastUsed) return "ready";
  const resetAt = getNextResetTime(a, a.lastUsed);
  const now = Date.now();
  return now >= resetAt.getTime() ? "ready" : "waiting";
}

function fmtTime(ms) {
  if (ms <= 0) return "พร้อมใช้";

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}วัน ${hours}ชม.`;
  }

  if (hours > 0) {
    return `${hours}ชม. ${minutes}น.`;
  }

  return `${minutes}น. ${seconds}วิ`;
}

function lastText(a) {
  return a.lastUsed ? new Date(a.lastUsed).toLocaleString("th-TH") : "ยังไม่เคยใช้";
}

function statusText(a) {
  const st = state(a);
  if (st === "ready") return "พร้อมใช้";
  if (st === "waiting") {
    const nextReset = getNextResetTime(a, a.lastUsed);
    return `รีเซ็ตใน ${fmtTime(nextReset.getTime() - Date.now())}`;
  }
  return "ใช้แล้ว";
}

function useAccount(id) {
  if (!currentUser) {
    toast("กรุณาเข้าสู่ระบบก่อนใช้งานบัญชี");
    return;
  }

  const a = accounts.find((x) => x.id === id);
  if (!a) return;

  if (state(a) !== "ready") {
    toast("บัญชีนี้ยังไม่รีเซ็ต");
    return;
  }

  a.lastUsed = Date.now();
  save();
  render();
  toast(`${a.service} ${a.email} บันทึกการใช้งานแล้ว`);
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window._t);
  window._t = setTimeout(() => t.classList.remove("show"), 1800);
}

function openAddModal() {
  if (!currentUser) {
    toast("กรุณาเข้าสู่ระบบก่อนเพิ่มบัญชี");
    return;
  }

  const modal = document.getElementById("actionModal");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  title.textContent = "เพิ่มบัญชีใหม่";
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-row">
        <label for="newEmail">อีเมลบัญชี</label>
        <input id="newEmail" placeholder="อีเมลบัญชี" style="width:100%;">
      </div>
      <div class="form-row">
        <label>Preset</label>
        <div class="preset-list">
          <label class="preset-item"><input type="checkbox" value="copilot" checked> Copilot · 6 ชม.</label>
          <label class="preset-item"><input type="checkbox" value="antigravity"> Google Antigravity · 7 วัน</label>
          <label class="preset-item"><input type="checkbox" value="gemini"> Gemini · 24 ชม.</label>
          <label class="preset-item"><input type="checkbox" value="claude"> Claude · 24 ชม.</label>
          <label class="preset-item"><input type="checkbox" value="chatgpt"> ChatGPT · 24 ชม.</label>
          <label class="preset-item"><input type="checkbox" value="perplexity"> Perplexity · 12 ชม.</label>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="ghost" onclick="closeModal()">ยกเลิก</button>
      <button type="button" class="primary" onclick="addAccount()">เพิ่มบัญชี</button>
    </div>
  `;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => document.getElementById("newEmail")?.focus(), 30);
}

function closeModal() {
  const modal = document.getElementById("actionModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function openEditModal(id) {
  const modal = document.getElementById("actionModal");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  const account = accounts.find((item) => item.id === id);

  if (!account) return;

  title.textContent = "แก้ไขบัญชี";
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-row">
        <label for="editEmail">อีเมลบัญชี</label>
        <input id="editEmail" placeholder="อีเมลบัญชี" value="${account.email}" style="width:100%;">
      </div>
      <div class="form-row">
        <label for="editPreset">Preset</label>
        <select id="editPreset" style="width:100%;">
          <option value="copilot" ${account.service === "Copilot" ? "selected" : ""}>Copilot · 6 ชม.</option>
          <option value="antigravity" ${account.service === "Google Antigravity" ? "selected" : ""}>Google Antigravity · 7 วัน</option>
          <option value="gemini" ${account.service === "Gemini" ? "selected" : ""}>Gemini · 24 ชม.</option>
          <option value="claude" ${account.service === "Claude" ? "selected" : ""}>Claude · 24 ชม.</option>
          <option value="chatgpt" ${account.service === "ChatGPT" ? "selected" : ""}>ChatGPT · 24 ชม.</option>
          <option value="perplexity" ${account.service === "Perplexity" ? "selected" : ""}>Perplexity · 12 ชม.</option>
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="ghost" onclick="closeModal()">ยกเลิก</button>
      <button type="button" class="primary" onclick="saveEditedAccount(${id})">บันทึก</button>
    </div>
  `;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => document.getElementById("editEmail")?.focus(), 30);
}

function saveEditedAccount(id) {
  const account = accounts.find((item) => item.id === id);
  if (!account) return;

  const email = document.getElementById("editEmail").value.trim();
  const preset = document.getElementById("editPreset").value;
  const serviceMap = { copilot: "Copilot", antigravity: "Google Antigravity", gemini: "Gemini", claude: "Claude", chatgpt: "ChatGPT", perplexity: "Perplexity" };

  if (!email) {
    toast("กรุณากรอกอีเมลบัญชี");
    return;
  }

  const nextService = serviceMap[preset] || "Copilot";
  const config = getPresetConfig(nextService);

  account.email = email;
  account.label = email;
  account.service = nextService;
  account.resetMode = config.resetMode;
  account.resetHours = config.resetHours;
  account.resetTime = config.resetTime;

  save();
  render();
  closeModal();
  toast(`อัปเดตบัญชี ${nextService} แล้ว`);
}

function addAccount() {
  if (!currentUser) {
    toast("กรุณาเข้าสู่ระบบด้วย LINE ก่อนเพิ่มบัญชี");
    return;
  }

  const email = document.getElementById("newEmail").value.trim();
  const selectedPresets = Array.from(document.querySelectorAll(".preset-item input:checked"))
    .map((checkbox) => checkbox.value);

  const serviceMap = {
    copilot: "Copilot",
    antigravity: "Google Antigravity",
    gemini: "Gemini",
    claude: "Claude",
    chatgpt: "ChatGPT",
    perplexity: "Perplexity",
  };

  if (!email) {
    toast("กรุณากรอกอีเมลบัญชี");
    return;
  }

  if (!selectedPresets.length) {
    toast("กรุณาเลือก Preset อย่างน้อย 1 ตัว");
    return;
  }

  const newAccounts = selectedPresets.map((preset) => {
    const service = serviceMap[preset] || "Copilot";
    const config = getPresetConfig(service);

    return {
      id: Date.now() + Math.floor(Math.random() * 1000),
      service,
      label: email,
      email,
      resetMode: config.resetMode,
      resetHours: config.resetHours,
      resetTime: config.resetTime,
      lastUsed: null,
      user_id: currentUser?.id || null,
    };
  });

  accounts = [...newAccounts, ...accounts];
  save();
  render();
  closeModal();
  toast(`เพิ่มบัญชี ${newAccounts.length} รายการให้ ${email} แล้ว`);
}

function openDeleteModal() {
  if (!currentUser) {
    toast("กรุณาเข้าสู่ระบบก่อนลบบัญชี");
    return;
  }

  const modal = document.getElementById("actionModal");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  title.textContent = "ลบบัญชี";

  if (!accounts.length) {
    body.innerHTML = '<div class="empty">ยังไม่มีบัญชีให้ลบ</div>';
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    return;
  }

  body.innerHTML = `
    <div class="delete-list">
      ${accounts.map((account) => `
        <div class="delete-item">
          <div class="info">
            <div class="email">${account.email}</div>
            <div class="service">${account.service}</div>
          </div>
          <button class="danger" type="button" onclick="deleteAccount(${account.id})">ลบ</button>
        </div>
      `).join("")}
    </div>
    <div class="modal-actions">
      <button type="button" class="primary" onclick="closeModal()">ปิด</button>
    </div>
  `;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function deleteAccount(id) {
  const target = accounts.find((item) => item.id === id);
  if (!target) return;

  accounts = accounts.filter((item) => item.id !== id);
  save();
  render();
  closeModal();
  toast(`ลบบัญชี ${target.label} แล้ว`);
}

function renderLoginScreen() {
  const root = document.getElementById("sections");
  if (!root) return;

  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-badge">LINE LOGIN</div>
        <h2>กำลังเข้าสู่ระบบ...</h2>
        <p>ระบบบังคับให้เข้าสู่ระบบผ่าน LINE ก่อนใช้งาน</p>
      </div>
    </div>
  `;

  const headerActions = document.querySelector(".header-actions");
  if (headerActions) headerActions.style.display = "none";

  const stats = document.querySelector(".stats");
  if (stats) stats.style.display = "none";

  const overview = document.getElementById("serviceOverview");
  if (overview) overview.style.display = "none";

  const toolbar = document.querySelector(".toolbar");
  if (toolbar) toolbar.style.display = "none";

  const filterRow = document.getElementById("aiFilters");
  if (filterRow) filterRow.style.display = "none";
}

function render() {
  updateAuthUI();

  const addBtn = document.querySelector('.header-actions .primary');
  const deleteBtn = document.querySelector('.header-actions .danger');

  if (addBtn) addBtn.style.display = currentUser ? "inline-block" : "none";
  if (deleteBtn) deleteBtn.style.display = currentUser ? "inline-block" : "none";

  if (!currentUser) {
    renderLoginScreen();
    const headerActions = document.querySelector(".header-actions");
    if (headerActions) headerActions.style.display = "none";
    document.getElementById("total").textContent = "0";
    document.getElementById("ready").textContent = "0";
    document.getElementById("used").textContent = "0";
    document.getElementById("waiting").textContent = "0";
    document.getElementById("serviceOverview").innerHTML = "";
    document.getElementById("aiFilters").innerHTML = '<button class="filter-chip active" type="button" data-service="all">ทั้งหมด</button>';
    return;
  }

  const headerActions = document.querySelector(".header-actions");
  if (headerActions) headerActions.style.display = "flex";

  const stats = document.querySelector(".stats");
  if (stats) stats.style.display = "grid";

  const overview = document.getElementById("serviceOverview");
  if (overview) overview.style.display = "grid";

  const toolbar = document.querySelector(".toolbar");
  if (toolbar) toolbar.style.display = "flex";

  const filterRow = document.getElementById("aiFilters");
  if (filterRow) filterRow.style.display = "flex";

  const q = document.getElementById("search").value.toLowerCase().trim();
  const stf = document.getElementById("status").value;
  const serviceFilter = window.currentServiceFilter || "all";

  const filtered = accounts.filter((a) => {
    const hit = !q || `${a.email} ${a.label} ${a.service}`.toLowerCase().includes(q);
    const s = state(a);
    const status = !a.lastUsed ? "ready" : s === "ready" ? "used" : "waiting";
    return hit && (serviceFilter === "all" || a.service === serviceFilter) && (stf === "all" || status === stf);
  });

  const services = [...new Set(accounts.map((a) => a.service))];
  if (filterRow) {
    filterRow.innerHTML = [
      '<button class="filter-chip active" type="button" data-service="all">ทั้งหมด</button>',
      ...services.map((service) => `
        <button class="filter-chip ${serviceFilter === service ? "active" : ""}" type="button" data-service="${service}">${service}</button>
      `),
    ].join("");

    filterRow.querySelectorAll(".filter-chip").forEach((button) => {
      button.addEventListener("click", () => {
        window.currentServiceFilter = button.dataset.service || "all";
        render();
      });
    });
  }

  const ready = accounts.filter((a) => state(a) === "ready").length;
  const waiting = accounts.length - ready;

  document.getElementById("total").textContent = accounts.length;
  document.getElementById("ready").textContent = ready;
  document.getElementById("used").textContent = accounts.filter((a) => a.lastUsed && state(a) === "waiting").length;
  document.getElementById("waiting").textContent = waiting;

  const serviceOverview = document.getElementById("serviceOverview");
  serviceOverview.innerHTML = [...new Set(accounts.map((a) => a.service))]
    .map((service) => {
      const arr = accounts.filter((a) => a.service === service);
      const r = arr.filter((a) => state(a) === "ready").length;
      return `<div class="stat"><div class="n">${arr.length}</div><div class="l">${service} · พร้อมใช้ ${r}</div></div>`;
    })
    .join("");

  if (!services.length && filterRow) {
    filterRow.innerHTML = '<button class="filter-chip active" type="button" data-service="all">ทั้งหมด</button>';
  }

  const groups = {};
  filtered.forEach((a) => {
    groups[a.service] ??= [];
    groups[a.service].push(a);
  });

  const root = document.getElementById("sections");
  root.innerHTML = "";

  if (!filtered.length) {
    root.innerHTML = '<div class="empty">ไม่พบบัญชีที่ค้นหา</div>';
    return;
  }

  for (const [service, list] of Object.entries(groups)) {
    const allForService = accounts.filter((a) => a.service === service);
    const readyForService = allForService.filter((a) => state(a) === "ready").length;
    const waitingForService = allForService.length - readyForService;

    const sec = document.createElement("div");
    sec.className = "section";
    sec.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">
      <h2 style="margin:0">${service}</h2>
      <div style="color:var(--muted);font-size:13px">${allForService.length} บัญชี · 🟢 ${readyForService} พร้อม · 🔴 ${waitingForService} รอ</div>
    </div>
    <div class="grid">${list
      .map((a) => {
        const st = state(a);
        const cls = st === "ready" ? "ready" : "waiting";
        const resetAt = a.lastUsed ? getNextResetTime(a, a.lastUsed) : null;

        return `<div class="card">
          <div class="top">
            <div style="flex:1; min-width:0;">
              <div class="name">${a.email}</div>
            </div>
            <div class="pill ${cls}">${st === "ready" ? "พร้อมใช้" : "รอรีเซ็ต"}</div>
          </div>
          <div class="meta">
            ใช้ล่าสุด: ${lastText(a)}<br>
            รอบรีเซ็ต: ${scheduleText(a)} · ${a.resetTime || "00:00"}<br>
            <span class="count">${resetAt ? statusText(a) : "พร้อมใช้ทันที"}</span>
          </div>
          <div class="actions">
            <button class="ghost" onclick="openEditModal(${a.id})">แก้ไข</button>
            ${
              st === "ready"
                ? `<button class="primary" onclick="useAccount(${a.id})">ใช้บัญชีนี้</button>`
                : `<button onclick="toast('รีเซ็ตเวลา '+new Date(${resetAt.getTime()}).toLocaleString('th-TH'))">ดูเวลารีเซ็ต</button>`
            }
          </div>
        </div>`;
      })
      .join("")}</div>`;

    root.appendChild(sec);
  }
}

async function initApp() {
  const uiLoginBtn = document.getElementById("lineLoginBtn");
  const uiLogoutBtn = document.getElementById("logoutBtn");

  if (uiLoginBtn) {
    uiLoginBtn.addEventListener("click", signInWithLine);
  }

  if (uiLogoutBtn) {
    uiLogoutBtn.addEventListener("click", signOut);
  }

  const storedLineUserId = sessionStorage.getItem("line_user_id");
  if (storedLineUserId && supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("line_user_id", storedLineUserId)
      .single();

    if (!error && data) {
      currentUser = data;
    }
  }

  if (!window.liff || !LIFF_ID) {
    renderLoginScreen();
    toast("ต้องเปิดจาก LINE LIFF เท่านั้น");
    return;
  }

  try {
    await window.liff.init({ liffId: LIFF_ID });
    liffReady = true;

    if (window.liff.isLoggedIn()) {
      const profile = await window.liff.getProfile();
      await handleLiffProfile(profile);
    } else {
      window.liff.login({
        redirectUri: window.location.href,
        scope: "profile openid email",
      });
    }
  } catch (error) {
    console.error("LIFF init failed:", error);
    renderLoginScreen();
    toast("ไม่สามารถเริ่ม LINE LIFF ได้ กรุณาเปิดจาก LINE app / LIFF URL");
    return;
  }

  await hydrateAccounts();
  render();
  setInterval(render, 1000);
}

initApp();
