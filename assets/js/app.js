/* ============================================
   ChronoPass — App Logic
   LINE LIFF Login + Supabase & Local Guest Mode
   ============================================ */

// ---- Config ----
const CFG = window.APP_CONFIG || {};
const LIFF_ID = (CFG.LIFF_ID || "").trim();
const SUPABASE_URL = (CFG.SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "").trim();
const SUPABASE_ANON_KEY = (CFG.SUPABASE_ANON_KEY || "").trim();
const KEY = "chronopass-accounts-v1";

// ---- Supabase client ----
const sb = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// ---- State ----
let accounts = [];
let currentUser = null;
let liffReady = false;
let currentServiceFilter = "all";

// ============================================
// Helpers
// ============================================

function getLocal() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; }
  catch { return []; }
}

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// Email matching is case-insensitive, consistent with the database constraint.
function getAccountName(account) {
  // `email` is retained as a fallback for data saved before account names were introduced.
  return String(account?.accountName || account?.email || "").trim();
}

function accountKey(accountName, service) {
  return `${String(accountName || "").trim().toLowerCase()}::${String(service || "").trim().toLowerCase()}`;
}

function hasDuplicateAccount(accountName, service, excludedId = null) {
  const key = accountKey(accountName, service);
  return accounts.some((account) => account.id !== excludedId && accountKey(getAccountName(account), account.service) === key);
}

// ============================================
// Auth UI
// ============================================

function updateAuthUI() {
  const loginBtn = document.getElementById("lineLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userLabel = document.getElementById("userLabel");
  const addBtn = document.getElementById("addBtn");
  const deleteBtn = document.getElementById("deleteBtn");

  if (currentUser) {
    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "inline-flex";
    if (userLabel) userLabel.style.display = "inline";

    if (userLabel && currentUser.is_guest) {
      userLabel.textContent = currentUser.display_name;
    } else if (userLabel) {
      userLabel.textContent = currentUser.display_name || currentUser.email || "LINE User";
    }

    if (addBtn) addBtn.style.display = "inline-flex";
    if (deleteBtn) deleteBtn.style.display = "inline-flex";
  } else {
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "none";
    if (userLabel) {
      userLabel.style.display = "none";
      userLabel.textContent = "";
    }
    if (addBtn) addBtn.style.display = "none";
    if (deleteBtn) deleteBtn.style.display = "none";
  }
}

// ============================================
// LINE LIFF
// ============================================

async function initLiff() {
  if (!window.liff || !LIFF_ID) {
    console.warn("LIFF SDK or LIFF_ID not available");
    return false;
  }

  try {
    await window.liff.init({ liffId: LIFF_ID });
    liffReady = true;
    console.log("LIFF ready — isInClient:", window.liff.isInClient(), "isLoggedIn:", window.liff.isLoggedIn());
    return true;
  } catch (err) {
    console.error("LIFF init error:", err);
    liffReady = false;
    return false;
  }
}

async function getLiffProfile() {
  if (!window.liff || !liffReady || !window.liff.isLoggedIn()) return null;

  try {
    const profile = await window.liff.getProfile();
    let email = null;
    try {
      const decoded = window.liff.getDecodedIDToken();
      email = decoded?.email || null;
    } catch (_) {}

    return {
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl || null,
      email,
    };
  } catch (err) {
    console.error("getProfile failed:", err);
    return null;
  }
}

async function ensureUserInDB(profile) {
  if (!profile?.userId) return null;

  const payload = {
    line_user_id: String(profile.userId),
    display_name: profile.displayName || "LINE User",
    picture_url: profile.pictureUrl || null,
    email: profile.email || null,
    status: "active",
  };

  if (!sb) {
    return { id: profile.userId, ...payload };
  }

  try {
    const { data, error } = await sb
      .from("users")
      .upsert(payload, { onConflict: "line_user_id" })
      .select();

    if (error) {
      console.warn("Supabase user upsert notice (fallback to local user):", error);
      return { id: profile.userId, ...payload };
    }

    return data?.[0] || { id: profile.userId, ...payload };
  } catch (err) {
    console.warn("Supabase request error:", err);
    return { id: profile.userId, ...payload };
  }
}

// Sign in with LINE (LIFF)
function signInWithLine() {
  if (!window.liff) {
    toast("ไม่พบ LINE SDK — กรุณารีเฟรชหน้า");
    return;
  }

  // Clear guest mode if switching to LINE login
  localStorage.removeItem("guest_mode");

  // LIFF is ready
  if (liffReady) {
    if (window.liff.isLoggedIn()) {
      handleLiffLogin();
    } else {
      window.liff.login({ redirectUri: window.location.origin + window.location.pathname });
    }
    return;
  }

  // LIFF not initialized yet — try now
  toast("กำลังเชื่อมต่อ LINE...");
  initLiff().then((ok) => {
    if (ok) {
      signInWithLine();
    } else {
      toast("ไม่สามารถเชื่อมต่อ LINE LIFF ได้");
    }
  });
}

async function handleLiffLogin() {
  try {
    const profile = await getLiffProfile();
    if (!profile) throw new Error("ดึงข้อมูล LINE ไม่ได้");

    const user = await ensureUserInDB(profile);
    if (!user) throw new Error("ไม่สามารถบันทึกผู้ใช้ได้");

    currentUser = user;
    sessionStorage.setItem("line_user_id", user.line_user_id);
    sessionStorage.setItem("line_display_name", user.display_name || "");
    localStorage.removeItem("guest_mode");

    // Clear URL query parameters from LINE redirect
    if (window.location.search) {
      window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
    }

    await hydrateAccounts();
    render();
    toast("เข้าสู่ระบบสำเร็จ — " + (user.display_name || "LINE User"));
  } catch (err) {
    console.error("handleLiffLogin error:", err);
    toast(err.message || "เข้าสู่ระบบไม่สำเร็จ");
  }
}

// ============================================
// Guest Mode (Purely Local / Offline)
// ============================================

function loginAsGuest() {
  currentUser = {
    id: "guest",
    line_user_id: "guest_local",
    display_name: "Guest (ในเครื่อง)",
    is_guest: true,
  };

  localStorage.setItem("guest_mode", "true");
  sessionStorage.removeItem("line_user_id");
  sessionStorage.removeItem("line_display_name");

  hydrateAccounts();
  render();
  toast("เข้าสู่ระบบแบบ Guest (บันทึกเฉพาะในเครื่องนี้)");
}

// Sign out
async function signOut() {
  currentUser = null;
  accounts = [];
  sessionStorage.removeItem("line_user_id");
  sessionStorage.removeItem("line_display_name");
  localStorage.removeItem("guest_mode");

  if (window.liff && liffReady) {
    try {
      if (window.liff.isLoggedIn()) window.liff.logout();
    } catch (_) {}
  }

  updateAuthUI();
  render();
  toast("ออกจากระบบแล้ว");
}

// ============================================
// Accounts — CRUD
// ============================================

async function hydrateAccounts() {
  accounts = getLocal();

  // If Guest mode or no Supabase, only use localStorage
  if (!sb || !currentUser || currentUser.is_guest) return;

  try {
    const { data, error } = await sb
      .from("accounts")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (!error && Array.isArray(data) && data.length) {
      accounts = data.map((r) => ({
        id: Number(r.id),
        service: r.service,
        label: r.label || r.account_name || r.email,
        accountName: r.account_name || r.email,
        resetMode: r.reset_mode || "hours",
        resetHours: Number(r.reset_hours || 6),
        resetTime: r.reset_time || "06:00",
        lastUsed: r.last_used ? Number(r.last_used) : null,
        user_id: r.user_id,
      }));
    } else {
      accounts = getLocal().filter((a) => a.user_id === currentUser.id || !a.user_id);
    }
  } catch (err) {
    console.warn("Hydrate accounts error:", err);
  }

  localStorage.setItem(KEY, JSON.stringify(accounts));
}

async function saveAccounts() {
  localStorage.setItem(KEY, JSON.stringify(accounts));

  // If Guest mode or no Supabase, never write to Supabase
  if (!sb || !currentUser || currentUser.is_guest) return;

  try {
    const rows = accounts.map((a) => ({
      id: Number(a.id),
      user_id: currentUser.id,
      account_name: getAccountName(a),
      label: String(a.label || getAccountName(a)).trim(),
      service: String(a.service || "Copilot"),
      reset_mode: String(a.resetMode || "hours"),
      reset_hours: Number(a.resetHours || 6),
      reset_time: String(a.resetTime || "06:00"),
      last_used: a.lastUsed ? Number(a.lastUsed) : null,
    }));

    const { error } = await sb.from("accounts").upsert(rows, { onConflict: "id" });
    if (error) console.warn("Save accounts DB notice:", error);
  } catch (err) {
    console.warn("Save accounts DB error:", err);
  }
}

// ---- Presets ----
const PRESETS = {
  copilot:      { name: "Copilot",             resetMode: "monthly", resetHours: 720,  resetTime: "00:00", resetDay: 1, label: "Copilot · รายเดือน" },
  codex:        { name: "Codex",               resetMode: "monthlyFromUse", resetHours: 720, resetTime: "00:00", label: "Codex · ทุกเดือนตามวันหมด" },
  antigravity:  { name: "Google Antigravity",   resetMode: "days",    resetHours: 168,  resetTime: "08:00", label: "Google Antigravity · 7 วัน" },
  gemini:       { name: "Gemini",               resetMode: "hours",   resetHours: 24,   resetTime: "00:00", label: "Gemini · 24 ชม." },
  claude:       { name: "Claude",               resetMode: "hours",   resetHours: 24,   resetTime: "00:00", label: "Claude · 24 ชม." },
  chatgpt:      { name: "ChatGPT",              resetMode: "hours",   resetHours: 24,   resetTime: "00:00", label: "ChatGPT · 24 ชม." },
  perplexity:   { name: "Perplexity",           resetMode: "hours",   resetHours: 12,   resetTime: "00:00", label: "Perplexity · 12 ชม." },
};

function getPreset(serviceName) {
  const s = String(serviceName || "").toLowerCase();
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (s.includes(key)) return preset;
  }
  return { resetMode: "hours", resetHours: 6, resetTime: "06:00" };
}

// ---- Reset time calculations ----
function addCalendarMonths(date, months) {
  // setMonth() can skip a month (e.g. Jan 31 + 1 month). Clamp the day first
  // so Codex follows the same billing day whenever that day exists.
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

function getNextReset(account, refTime) {
  const ref = new Date(refTime);
  const preset = getPreset(account.service);
  const mode = preset.resetMode;

  if (mode === "hours" || mode === "days") {
    const interval = (Number(preset.resetHours) || 1) * 3600000;
    const cycles = Math.floor((Date.now() - ref.getTime()) / interval) + 1;
    return new Date(ref.getTime() + cycles * interval);
  }

  if (mode === "monthlyFromUse") {
    return addCalendarMonths(ref, 1);
  }

  if (mode === "monthly") {
    const day = Math.min(31, Math.max(1, Number(preset.resetDay) || 1));
    let c = new Date(ref.getFullYear(), ref.getMonth(), day);
    while (c.getTime() <= ref.getTime()) {
      c = new Date(c.getFullYear(), c.getMonth() + 1, day);
    }
    return c;
  }

  return new Date(ref.getTime() + 3600000);
}

function accountState(a) {
  if (!a.lastUsed) return "ready";
  return Date.now() >= getNextReset(a, a.lastUsed).getTime() ? "ready" : "waiting";
}

function fmtDuration(ms) {
  if (ms <= 0) return "พร้อมใช้";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}วัน ${h}ชม.`;
  if (h > 0) return `${h}ชม. ${m}น.`;
  return `${m}น. ${sec}วิ`;
}

function scheduleLabel(a) {
  const p = getPreset(a.service);
  if (p.resetMode === "hours") return `${p.resetHours} ชม.`;
  if (p.resetMode === "days") return `${Math.round(p.resetHours / 24)} วัน`;
  if (p.resetMode === "monthlyFromUse") return "ทุกเดือนตามวันหมด";
  if (p.resetMode === "monthly") return "ทุกวันที่ 1";
  return "ตามกำหนด";
}

function lastUsedText(a) {
  return a.lastUsed ? new Date(a.lastUsed).toLocaleString("th-TH") : "ยังไม่เคยใช้";
}

// ---- Actions ----
function useAccount(id) {
  if (!currentUser) { toast("กรุณาเข้าสู่ระบบก่อน"); return; }
  const a = accounts.find((x) => x.id === id);
  if (!a) return;
  if (accountState(a) !== "ready") { toast("บัญชีนี้ยังไม่รีเซ็ต"); return; }
  a.lastUsed = Date.now();
  saveAccounts();
  render();
  toast(`${a.service} — ${getAccountName(a)} บันทึกแล้ว`);
}

function deleteAccount(id) {
  const t = accounts.find((x) => x.id === id);
  if (!t) return;
  accounts = accounts.filter((x) => x.id !== id);

  if (sb && currentUser && !currentUser.is_guest) {
    sb.from("accounts").delete().eq("id", id).then(({ error }) => {
      if (error) console.error("Delete from DB:", error);
    });
  }

  saveAccounts();
  render();
  closeModal();
  toast(`ลบ ${t.label} แล้ว`);
}

// ============================================
// Modals
// ============================================

function closeModal() {
  const m = document.getElementById("actionModal");
  m.classList.add("hidden");
  m.setAttribute("aria-hidden", "true");
}

function openAddModal() {
  if (!currentUser) { toast("กรุณาเข้าสู่ระบบก่อน"); return; }

  const m = document.getElementById("actionModal");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  title.textContent = "เพิ่มบัญชีใหม่";

  body.innerHTML = `
    <div class="form-grid">
      <div class="form-row">
        <label for="newAccountName">ชื่อบัญชี / อีเมล</label>
        <input id="newAccountName" placeholder="เช่น work-account หรือ example@email.com">
      </div>
      <div class="form-row">
        <label>เลือกบริการ AI</label>
        <div class="preset-list">
          ${Object.entries(PRESETS).map(([k, v]) =>
            `<label class="preset-item"><input type="checkbox" value="${k}" ${k === "copilot" ? "checked" : ""}> ${v.label}</label>`
          ).join("")}
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="ghost" onclick="closeModal()">ยกเลิก</button>
      <button type="button" class="primary" onclick="addAccount()">เพิ่มบัญชี</button>
    </div>
  `;

  m.classList.remove("hidden");
  m.setAttribute("aria-hidden", "false");
  setTimeout(() => document.getElementById("newAccountName")?.focus(), 50);
}

function addAccount() {
  if (!currentUser) { toast("กรุณาเข้าสู่ระบบก่อน"); return; }

  const accountName = document.getElementById("newAccountName").value.trim();
  const selected = Array.from(document.querySelectorAll(".preset-item input:checked")).map((c) => c.value);

  if (!accountName) { toast("กรุณากรอกชื่อบัญชีหรืออีเมล"); return; }
  if (!selected.length) { toast("กรุณาเลือกบริการอย่างน้อย 1 ตัว"); return; }

  const duplicate = selected
    .map((key) => (PRESETS[key] || PRESETS.copilot).name)
    .find((service) => hasDuplicateAccount(accountName, service));
  if (duplicate) {
    toast(`มีบัญชี ${duplicate} สำหรับชื่อนี้อยู่แล้ว`);
    return;
  }

  const newList = selected.map((key) => {
    const p = PRESETS[key] || PRESETS.copilot;
    return {
      id: Date.now() + Math.floor(Math.random() * 10000),
      service: p.name,
      label: accountName,
      accountName,
      resetMode: p.resetMode,
      resetHours: p.resetHours,
      resetTime: p.resetTime,
      lastUsed: null,
      user_id: currentUser.id,
    };
  });

  accounts = [...newList, ...accounts];
  saveAccounts();
  render();
  closeModal();
  toast(`เพิ่ม ${newList.length} บัญชีสำหรับ ${accountName}`);
}

function openEditModal(id) {
  const a = accounts.find((x) => x.id === id);
  if (!a) return;

  const m = document.getElementById("actionModal");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  title.textContent = "แก้ไขบัญชี";

  body.innerHTML = `
    <div class="form-grid">
      <div class="form-row">
        <label for="editAccountName">ชื่อบัญชี / อีเมล</label>
        <input id="editAccountName" value="${getAccountName(a)}">
      </div>
      <div class="form-row">
        <label for="editPreset">บริการ AI</label>
        <select id="editPreset">
          ${Object.entries(PRESETS).map(([k, v]) =>
            `<option value="${k}" ${a.service === v.name ? "selected" : ""}>${v.label}</option>`
          ).join("")}
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="ghost" onclick="closeModal()">ยกเลิก</button>
      <button type="button" class="primary" onclick="saveEdit(${id})">บันทึก</button>
    </div>
  `;

  m.classList.remove("hidden");
  m.setAttribute("aria-hidden", "false");
  setTimeout(() => document.getElementById("editAccountName")?.focus(), 50);
}

function saveEdit(id) {
  const a = accounts.find((x) => x.id === id);
  if (!a) return;

  const accountName = document.getElementById("editAccountName").value.trim();
  const key = document.getElementById("editPreset").value;
  if (!accountName) { toast("กรุณากรอกชื่อบัญชีหรืออีเมล"); return; }

  const p = PRESETS[key] || PRESETS.copilot;
  if (hasDuplicateAccount(accountName, p.name, id)) {
    toast(`มีบัญชี ${p.name} สำหรับชื่อนี้อยู่แล้ว`);
    return;
  }

  a.accountName = accountName;
  a.label = accountName;
  a.service = p.name;
  a.resetMode = p.resetMode;
  a.resetHours = p.resetHours;
  a.resetTime = p.resetTime;

  saveAccounts();
  render();
  closeModal();
  toast(`อัปเดต ${p.name} แล้ว`);
}

function openDeleteModal() {
  if (!currentUser) { toast("กรุณาเข้าสู่ระบบก่อน"); return; }

  const m = document.getElementById("actionModal");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  title.textContent = "ลบบัญชี";

  if (!accounts.length) {
    body.innerHTML = '<div class="empty">ยังไม่มีบัญชีให้ลบ</div>';
    m.classList.remove("hidden");
    m.setAttribute("aria-hidden", "false");
    return;
  }

  body.innerHTML = `
    <div class="delete-list">
      ${accounts.map((a) => `
        <div class="delete-item">
          <div>
            <div class="email">${getAccountName(a)}</div>
            <div class="service">${a.service}</div>
          </div>
          <button class="danger" type="button" onclick="deleteAccount(${a.id})">ลบ</button>
        </div>
      `).join("")}
    </div>
    <div class="modal-actions">
      <button type="button" class="primary" onclick="closeModal()">ปิด</button>
    </div>
  `;

  m.classList.remove("hidden");
  m.setAttribute("aria-hidden", "false");
}

// ============================================
// Render & Realtime Timers
// ============================================

function renderLoginScreen() {
  const root = document.getElementById("sections");
  if (!root) return;

  // If already rendered, do nothing (prevents blinking)
  if (root.querySelector(".auth-screen")) return;

  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-badge">LINE LOGIN</div>
        <h2>เข้าสู่ระบบเพื่อใช้งาน</h2>
        <p>เข้าสู่ระบบผ่าน LINE เพื่อซิงค์ข้อมูลข้ามอุปกรณ์<br>หรือเข้าใช้งานแบบ Guest เพื่อบันทึกเฉพาะในเครื่องนี้</p>
        <div class="auth-actions">
          <button class="line-login-btn" type="button" onclick="signInWithLine()">เข้าสู่ระบบด้วย LINE</button>
          <div class="auth-divider">— หรือ —</div>
          <button class="auth-guest-btn" type="button" onclick="loginAsGuest()">ใช้งานแบบ Guest (บันทึกเฉพาะในเครื่องนี้)</button>
        </div>
      </div>
    </div>
  `;

  // Hide dashboard sections
  const ids = ["statsRow", "serviceOverview", "toolbarRow", "aiFilters"];
  ids.forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
}

function updateCountdowns() {
  if (!currentUser) return;

  let stateChanged = false;
  document.querySelectorAll("[data-reset-time]").forEach((el) => {
    const resetTime = Number(el.dataset.resetTime);
    if (!resetTime) return;

    const diff = resetTime - Date.now();
    let targetText = "";
    if (diff <= 0) {
      targetText = "พร้อมใช้ทันที";
      if (el.dataset.wasWaiting === "true") {
        el.dataset.wasWaiting = "false";
        stateChanged = true;
      }
    } else {
      targetText = `รีเซ็ตใน ${fmtDuration(diff)}`;
    }

    if (el.textContent !== targetText) {
      el.textContent = targetText;
    }
  });

  if (stateChanged) {
    render();
  }
}

function render() {
  updateAuthUI();

  if (!currentUser) {
    renderLoginScreen();
    document.getElementById("total").textContent = "0";
    document.getElementById("ready").textContent = "0";
    document.getElementById("used").textContent = "0";
    document.getElementById("waiting").textContent = "0";
    return;
  }

  // Show dashboard sections
  const show = { statsRow: "grid", serviceOverview: "grid", toolbarRow: "flex", aiFilters: "flex" };
  Object.entries(show).forEach(([id, display]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
  });

  // Filter
  const q = (document.getElementById("search")?.value || "").toLowerCase().trim();
  const stf = document.getElementById("status")?.value || "all";

  const filtered = accounts.filter((a) => {
    const hit = !q || `${getAccountName(a)} ${a.label} ${a.service}`.toLowerCase().includes(q);
    const st = accountState(a);
    const statusCat = !a.lastUsed ? "ready" : st === "ready" ? "used" : "waiting";
    return hit && (currentServiceFilter === "all" || a.service === currentServiceFilter) && (stf === "all" || statusCat === stf);
  });

  // Service chips
  const services = [...new Set(accounts.map((a) => a.service))];
  const filterRow = document.getElementById("aiFilters");
  if (filterRow) {
    filterRow.innerHTML = [
      `<button class="filter-chip ${currentServiceFilter === "all" ? "active" : ""}" type="button" data-svc="all">ทั้งหมด</button>`,
      ...services.map((s) =>
        `<button class="filter-chip ${currentServiceFilter === s ? "active" : ""}" type="button" data-svc="${s}">${s}</button>`
      ),
    ].join("");

    filterRow.querySelectorAll(".filter-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentServiceFilter = btn.dataset.svc || "all";
        render();
      });
    });
  }

  // Stats
  const readyCount = accounts.filter((a) => accountState(a) === "ready").length;
  const waitCount = accounts.length - readyCount;

  document.getElementById("total").textContent = accounts.length;
  document.getElementById("ready").textContent = readyCount;
  document.getElementById("used").textContent = accounts.filter((a) => a.lastUsed && accountState(a) === "waiting").length;
  document.getElementById("waiting").textContent = waitCount;

  // Service overview
  const overview = document.getElementById("serviceOverview");
  if (overview) {
    overview.innerHTML = services.map((svc) => {
      const arr = accounts.filter((a) => a.service === svc);
      const r = arr.filter((a) => accountState(a) === "ready").length;
      return `<div class="stat"><div class="n">${arr.length}</div><div class="l">${svc} · พร้อมใช้ ${r}</div></div>`;
    }).join("");
  }

  // Group by service
  const groups = {};
  filtered.forEach((a) => { (groups[a.service] ??= []).push(a); });

  const root = document.getElementById("sections");
  root.innerHTML = "";

  if (!filtered.length) {
    root.innerHTML = '<div class="empty">ไม่พบบัญชีที่ค้นหา</div>';
    return;
  }

  for (const [service, list] of Object.entries(groups)) {
    const all = accounts.filter((a) => a.service === service);
    const rdy = all.filter((a) => accountState(a) === "ready").length;
    const wt = all.length - rdy;

    const sec = document.createElement("div");
    sec.className = "section";
    sec.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <h2>${service}</h2>
        <div style="color:var(--muted);font-size:13px">${all.length} บัญชี · พร้อม ${rdy} · รอ ${wt}</div>
      </div>
      <div class="grid">${list.map((a) => {
        const st = accountState(a);
        const cls = st === "ready" ? "ready" : "waiting";
        const resetAt = a.lastUsed ? getNextReset(a, a.lastUsed) : null;
        const resetTimeMs = resetAt ? resetAt.getTime() : 0;
        const countText = resetAt ? `รีเซ็ตใน ${fmtDuration(resetTimeMs - Date.now())}` : "พร้อมใช้ทันที";

        return `<div class="card">
          <div class="top">
            <div style="flex:1;min-width:0"><div class="name">${getAccountName(a)}</div></div>
            <div class="pill ${cls}">${st === "ready" ? "พร้อมใช้" : "รอรีเซ็ต"}</div>
          </div>
          <div class="meta">
            ใช้ล่าสุด: ${lastUsedText(a)}<br>
            รอบรีเซ็ต: ${scheduleLabel(a)}<br>
            <span class="count" data-reset-time="${resetTimeMs}" data-was-waiting="${st === 'waiting'}">${countText}</span>
          </div>
          <div class="actions">
            <button class="ghost" onclick="openEditModal(${a.id})">แก้ไข</button>
            ${st === "ready"
              ? `<button class="primary" onclick="useAccount(${a.id})">หมดแล้ว</button>`
              : `<button onclick="toast('รีเซ็ต: '+new Date(${resetTimeMs}).toLocaleString('th-TH'))">ดูเวลารีเซ็ต</button>`
            }
          </div>
        </div>`;
      }).join("")}</div>
    `;
    root.appendChild(sec);
  }
}

// ============================================
// Init
// ============================================

async function initApp() {
  // Wire up header buttons
  document.getElementById("lineLoginBtn")?.addEventListener("click", signInWithLine);
  document.getElementById("logoutBtn")?.addEventListener("click", signOut);
  document.getElementById("addBtn")?.addEventListener("click", openAddModal);
  document.getElementById("deleteBtn")?.addEventListener("click", openDeleteModal);

  // 1) Check Guest mode first
  const isGuest = localStorage.getItem("guest_mode") === "true";
  if (isGuest) {
    currentUser = {
      id: "guest",
      line_user_id: "guest_local",
      display_name: "Guest (ในเครื่อง)",
      is_guest: true,
    };
  } else {
    // 2) Restore LINE session from sessionStorage
    const storedId = sessionStorage.getItem("line_user_id");
    if (storedId) {
      if (sb) {
        try {
          const { data, error } = await sb
            .from("users")
            .select("*")
            .eq("line_user_id", storedId)
            .single();
          if (!error && data) currentUser = data;
        } catch (_) {}
      }
      if (!currentUser) {
        const cachedName = sessionStorage.getItem("line_display_name") || "LINE User";
        currentUser = { id: storedId, line_user_id: storedId, display_name: cachedName };
      }
    }
  }

  // 3) Init LIFF — MUST happen before any liff.isLoggedIn() / liff.isInClient()
  await initLiff();

  let loggedInViaLiff = false;
  // 4) Auto-login from LIFF if not in guest mode and not restored from session
  if (!isGuest && liffReady && window.liff.isLoggedIn()) {
    if (!currentUser) {
      await handleLiffLogin();
      loggedInViaLiff = true;
    }
  }

  // 5) Clean URL params if returning from LINE Login (e.g. ?code=...&state=...)
  if (window.location.search && (window.location.search.includes("code=") || window.location.search.includes("liffClientId="))) {
    window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
  }

  // 6) Render UI (if not already rendered by handleLiffLogin)
  if (!loggedInViaLiff) {
    updateAuthUI();
    await hydrateAccounts();
    render();
  }

  // 7) Timer only updates countdown text (no DOM re-render = no blinking)
  setInterval(updateCountdowns, 1000);
}

// Boot
initApp();
