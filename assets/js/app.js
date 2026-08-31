/* ============================================
   ChronoPass — App Logic
   LINE LIFF Login + Supabase & Local Guest Mode
   ============================================ */

// ---- Config ----
const CFG = window.APP_CONFIG || {};
const LIFF_ID = (CFG.LIFF_ID || "").trim();
const SUPABASE_URL = (CFG.SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "").trim();
const SUPABASE_ANON_KEY = (CFG.SUPABASE_ANON_KEY || "").trim();
const GUEST_KEY = "chronopass-guest-accounts-v1";
const ACCOUNT_CACHE_TTL_MS = 10 * 60 * 1000;

// ---- Supabase client ----
const sb = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// ---- State ----
let accounts = [];
let currentUser = null;
let liffReady = false;
let currentServiceFilter = "all";
let lastSyncedAt = null;
let syncInProgress = false;

// ============================================
// Helpers
// ============================================

function getLocal() {
  try { return JSON.parse(localStorage.getItem(GUEST_KEY)) || []; }
  catch { return []; }
}

function accountCacheKey() {
  return currentUser?.line_user_id ? `chronopass-accounts-v1:${currentUser.line_user_id}` : null;
}

function getAccountCache() {
  if (typeof hasFunctionalConsent === 'function' && !hasFunctionalConsent()) return null;
  const key = accountCacheKey();
  if (!key) return null;
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    return cached?.expiresAt > Date.now() && Array.isArray(cached.accounts) ? cached.accounts : null;
  } catch { return null; }
}

function setAccountCache(value = accounts) {
  if (typeof hasFunctionalConsent === 'function' && !hasFunctionalConsent()) return;
  const key = accountCacheKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS, accounts: value }));
}

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function updateSyncStatus(message = "") {
  const el = document.getElementById("syncStatus");
  const button = document.getElementById("syncBtn");
  if (!el || !button) return;
  button.disabled = syncInProgress;
  button.textContent = syncInProgress ? "กำลังซิงค์..." : "ซิงค์ข้อมูล";
  if (!currentUser) { el.style.display = "none"; return; }
  el.style.display = "inline";
  el.textContent = message || (lastSyncedAt ? `ซิงค์ล่าสุด ${new Date(lastSyncedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}` : "ยังไม่เคยซิงค์");
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

function hasPaidNotificationAccess(user = currentUser) {
  if (!user || user.is_guest) return false;
  if (!['active', 'trialing'].includes(user.subscription_status)) return false;
  return !user.subscription_current_period_end
    || new Date(user.subscription_current_period_end).getTime() > Date.now();
}

async function callAppData(action, payload = {}) {
  const idToken = window.liff?.getIDToken?.();
  if (!idToken || !SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('กรุณาเข้าสู่ระบบด้วย LINE ใหม่');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/app-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ action, idToken, ...payload }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'ไม่สามารถเชื่อมต่อข้อมูลได้');
  return body;
}

async function startStripeCheckout() {
  if (!currentUser || currentUser.is_guest) {
    signInWithLine();
    return;
  }
  if (!sb || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    toast('ยังไม่ได้ตั้งค่า Supabase สำหรับการชำระเงิน');
    return;
  }
  const idToken = window.liff?.getIDToken?.();
  if (!idToken) {
    toast('กรุณาเข้าสู่ระบบด้วย LINE ใหม่ก่อนชำระเงิน');
    return;
  }
  const button = document.getElementById('upgradeBtn');
  if (button) { button.disabled = true; button.textContent = 'กำลังเปิดหน้าชำระเงิน...'; }
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/create-stripe-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ idToken }),
    });
    const body = await response.json();
    if (!response.ok || !body.url) throw new Error(body.error || 'เปิดหน้าชำระเงินไม่สำเร็จ');
    window.location.assign(body.url);
  } catch (err) {
    console.error('Stripe checkout error:', err);
    toast(err.message || 'เปิดหน้าชำระเงินไม่สำเร็จ');
    if (button) { button.disabled = false; button.textContent = 'แจ้งเตือน LINE ฿49/เดือน'; }
  }
}

async function cancelStripeSubscription() {
  if (!currentUser || currentUser.is_guest || currentUser.subscription_cancel_at_period_end) return;
  if (!window.confirm('ยืนยันการยกเลิกสมาชิก? คุณยังใช้งานแจ้งเตือน LINE ได้จนจบรอบบิลปัจจุบัน')) return;
  const idToken = window.liff?.getIDToken?.();
  if (!idToken || !sb) {
    toast('กรุณาเข้าสู่ระบบด้วย LINE ใหม่ก่อนยกเลิกสมาชิก');
    return;
  }
  const button = document.getElementById('cancelSubscriptionBtn');
  if (button) { button.disabled = true; button.textContent = 'กำลังยกเลิก...'; }
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/cancel-stripe-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ idToken }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'ยกเลิกสมาชิกไม่สำเร็จ');
    currentUser.subscription_cancel_at_period_end = true;
    if (body.currentPeriodEnd) currentUser.subscription_current_period_end = new Date(body.currentPeriodEnd * 1000).toISOString();
    updateAuthUI();
    toast('ยกเลิกการต่ออายุแล้ว คุณยังใช้ได้จนจบรอบบิล');
  } catch (err) {
    console.error('Stripe cancellation error:', err);
    toast(err.message || 'ยกเลิกสมาชิกไม่สำเร็จ');
    if (button) { button.disabled = false; button.textContent = 'ยกเลิกสมาชิก'; }
  }
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
  const syncBtn = document.getElementById("syncBtn");
  const upgradeBtn = document.getElementById("upgradeBtn");
  const membershipLabel = document.getElementById("membershipLabel");
  const cancelSubscriptionBtn = document.getElementById("cancelSubscriptionBtn");

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
    if (syncBtn) syncBtn.style.display = "inline-flex";
    updateSyncStatus();
    if (upgradeBtn) {
      upgradeBtn.style.display = hasPaidNotificationAccess() ? "none" : "inline-flex";
      upgradeBtn.textContent = currentUser.is_guest ? "เชื่อมต่อ LINE" : "แจ้งเตือน LINE ฿49/เดือน";
    }
    if (cancelSubscriptionBtn) {
      const canCancel = hasPaidNotificationAccess() && currentUser.stripe_subscription_id && !currentUser.subscription_cancel_at_period_end;
      cancelSubscriptionBtn.style.display = canCancel ? "inline-flex" : "none";
    }
    if (membershipLabel) {
      membershipLabel.style.display = hasPaidNotificationAccess() ? "inline" : "none";
      const endDate = currentUser.subscription_current_period_end
        ? new Date(currentUser.subscription_current_period_end).toLocaleDateString('th-TH')
        : '';
      membershipLabel.textContent = hasPaidNotificationAccess()
        ? (currentUser.subscription_cancel_at_period_end ? `LINE แจ้งเตือน: ใช้ได้ถึง ${endDate}` : "LINE แจ้งเตือน: เปิดใช้แล้ว")
        : "";
    }
  } else {
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "none";
    if (userLabel) {
      userLabel.style.display = "none";
      userLabel.textContent = "";
    }
    if (addBtn) addBtn.style.display = "none";
    if (deleteBtn) deleteBtn.style.display = "none";
    if (syncBtn) syncBtn.style.display = "none";
    if (upgradeBtn) upgradeBtn.style.display = "none";
    if (cancelSubscriptionBtn) cancelSubscriptionBtn.style.display = "none";
    if (membershipLabel) membershipLabel.style.display = "none";
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

async function ensureDbUser() {
  if (!currentUser || currentUser.is_guest) return null;
  if (currentUser.id && Number.isSafeInteger(Number(currentUser.id)) && Number(currentUser.id) > 0) {
    return currentUser;
  }
  const lineId = currentUser.line_user_id;
  if (!lineId) return null;

  if (sb) {
    try {
      const { data } = await sb
        .from("users")
        .select("*")
        .eq("line_user_id", lineId)
        .maybeSingle();

      if (data && data.id) {
        currentUser = { ...currentUser, ...data, id: Number(data.id) };
        sessionStorage.setItem("line_db_id", String(data.id));
        sessionStorage.setItem("line_user_obj", JSON.stringify(currentUser));
        return currentUser;
      }
    } catch (err) {
      console.warn("ensureDbUser query failed:", err);
    }
  }
  return currentUser;
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

  try {
    const result = await callAppData('bootstrap', { profile });
    if (result?.user) return result.user;
  } catch (err) {
    console.warn("Profile bootstrap via Edge Function failed, trying direct Supabase:", err);
  }

  if (sb) {
    try {
      const { data: existing } = await sb
        .from('users')
        .select('*')
        .eq('line_user_id', String(profile.userId))
        .maybeSingle();
      if (existing) return existing;

      const { data: created, error: insErr } = await sb
        .from('users')
        .insert(payload)
        .select()
        .single();
      if (!insErr && created) return created;
    } catch (e) {
      console.warn("Direct Supabase user bootstrap error:", e);
    }
  }

  return null;
}

// Standalone / PWA detection (especially for iOS Web App added to Home Screen)
function isStandaloneMode() {
  try {
    return Boolean(
      window.navigator.standalone ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
    );
  } catch (_) {
    return false;
  }
}

// Generate direct LINE OAuth 2.1 authorization URL
function getLineOAuthUrl() {
  const channelId = LIFF_ID ? LIFF_ID.split("-")[0] : "2011183218";
  const redirectUri = window.location.origin + window.location.pathname;
  const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const nonce = Math.random().toString(36).substring(2, 15);
  try {
    sessionStorage.setItem("line_oauth_state", state);
  } catch (_) {}

  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: redirectUri,
    state: state,
    scope: "profile openid email",
    nonce: nonce,
    disable_auto_login: "true",
  });

  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

// Sign in with LINE (LIFF / OAuth Fallback for iOS Standalone)
function signInWithLine() {
  // Clear guest mode and logout flag if switching to LINE login
  localStorage.removeItem("guest_mode");
  sessionStorage.removeItem("logged_out");

  // If already logged in via LIFF
  if (liffReady && window.liff && window.liff.isLoggedIn()) {
    handleLiffLogin();
    return;
  }

  // 1) Standalone Mode (iOS Web App / PWA added to Home Screen):
  // Avoid liff.login() app-switching to prevent freezing/session loss in standalone container
  if (isStandaloneMode()) {
    window.location.href = getLineOAuthUrl();
    return;
  }

  // 2) Normal browser with LIFF ready
  if (liffReady && window.liff) {
    window.liff.login({ redirectUri: window.location.origin + window.location.pathname });
    return;
  }

  // 3) LIFF SDK missing
  if (!window.liff) {
    window.location.href = getLineOAuthUrl();
    return;
  }

  // 4) LIFF not initialized yet — try initializing first
  toast("กำลังเชื่อมต่อ LINE...");
  initLiff().then((ok) => {
    if (ok) {
      if (window.liff.isLoggedIn()) {
        handleLiffLogin();
      } else if (isStandaloneMode()) {
        window.location.href = getLineOAuthUrl();
      } else {
        window.liff.login({ redirectUri: window.location.origin + window.location.pathname });
      }
    } else {
      // Fallback directly to OAuth URL if LIFF init fails
      window.location.href = getLineOAuthUrl();
    }
  });
}

async function handleLiffLogin() {
  try {
    const profile = await getLiffProfile();
    if (!profile) throw new Error("ดึงข้อมูล LINE ไม่ได้");

    const user = await ensureUserInDB(profile);
    if (!user) throw new Error("ยังไม่สามารถบันทึกผู้ใช้ได้ กรุณาลองใหม่อีกครั้ง");

    currentUser = user;
    sessionStorage.setItem("line_user_id", user.line_user_id);
    sessionStorage.setItem("line_display_name", user.display_name || "");
    sessionStorage.setItem("line_db_id", String(user.id));
    sessionStorage.setItem("line_user_obj", JSON.stringify(user));
    sessionStorage.removeItem("logged_out");
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
  sessionStorage.removeItem("logged_out");
  sessionStorage.removeItem("line_user_id");
  sessionStorage.removeItem("line_display_name");
  sessionStorage.removeItem("line_db_id");
  sessionStorage.removeItem("line_user_obj");

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
  sessionStorage.removeItem("line_db_id");
  sessionStorage.removeItem("line_user_obj");
  localStorage.removeItem("guest_mode");
  sessionStorage.setItem("logged_out", "true");

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
  // Guest data is intentionally local only.
  if (!currentUser) {
    accounts = [];
    return;
  }
  if (currentUser.is_guest) {
    accounts = getLocal();
    lastSyncedAt = Date.now();
    return true;
  }

  await ensureDbUser();
  const userId = Number(currentUser.id);

  // 1) Direct Supabase query (works across PC & mobile)
  if (sb && Number.isSafeInteger(userId) && userId > 0) {
    try {
      const { data, error } = await sb
        .from('accounts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        accounts = data.map((r) => ({
          id: Number(r.id),
          service: r.service,
          label: r.label || r.account_name || r.email,
          accountName: r.account_name || r.email,
          resetMode: r.reset_mode || "hours",
          resetHours: Number(r.reset_hours || 6),
          resetTime: r.reset_time || "06:00",
          resetDay: Number(r.reset_day || 1),
          resetTimezone: r.reset_timezone || "Asia/Bangkok",
          isCustomSchedule: Boolean(r.reset_is_custom),
          lastUsed: r.last_used ? Number(r.last_used) : null,
          user_id: r.user_id,
        }));
        setAccountCache();
        lastSyncedAt = Date.now();
        return true;
      }
    } catch (err) {
      console.warn("Hydrate accounts direct Supabase error:", err);
    }
  }

  // 2) Edge Function listAccounts
  try {
    const { accounts: data } = await callAppData('listAccounts');
    if (Array.isArray(data)) {
      accounts = data.map((r) => ({
        id: Number(r.id),
        service: r.service,
        label: r.label || r.account_name || r.email,
        accountName: r.account_name || r.email,
        resetMode: r.reset_mode || "hours",
        resetHours: Number(r.reset_hours || 6),
        resetTime: r.reset_time || "06:00",
        resetDay: Number(r.reset_day || 1),
        resetTimezone: r.reset_timezone || "Asia/Bangkok",
        isCustomSchedule: Boolean(r.reset_is_custom),
        lastUsed: r.last_used ? Number(r.last_used) : null,
        user_id: r.user_id,
      }));
      setAccountCache();
      lastSyncedAt = Date.now();
      return true;
    }
  } catch (err) {
    console.warn("Hydrate accounts Edge function error:", err);
  }

  // 3) Fallback to local cache
  const cached = getAccountCache();
  if (cached) {
    accounts = cached;
  }
  return false;
}

async function syncAccounts() {
  if (!currentUser || syncInProgress) return;
  syncInProgress = true;
  let statusMessage = "";
  updateSyncStatus();
  try {
    const synced = await hydrateAccounts();
    render();
    statusMessage = synced ? "" : "ซิงค์ไม่สำเร็จ — ลองใหม่อีกครั้ง";
    updateSyncStatus(statusMessage);
    toast(synced ? "ซิงค์ข้อมูลล่าสุดแล้ว" : "ซิงค์ไม่สำเร็จ กำลังแสดงข้อมูลที่บันทึกไว้");
  } catch (error) {
    console.warn("Manual sync error:", error);
    statusMessage = "ซิงค์ไม่สำเร็จ — ลองใหม่อีกครั้ง";
    updateSyncStatus(statusMessage);
    toast("ซิงค์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
  } finally {
    syncInProgress = false;
    updateSyncStatus(statusMessage);
  }
}

async function saveAccounts() {
  if (!currentUser) return false;
  if (currentUser.is_guest) {
    localStorage.setItem(GUEST_KEY, JSON.stringify(accounts));
    return true;
  }

  await ensureDbUser();
  const userId = Number(currentUser.id);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    console.warn("Cannot save accounts: Invalid user ID", currentUser);
    toast("⚠️ ไม่พบข้อมูลผู้ใช้ใน Supabase กรุณาออกจากระบบแล้วเข้าใหม่");
    return false;
  }

  const rows = accounts.map((a) => ({
    id: Number(a.id),
    user_id: userId,
    account_name: getAccountName(a),
    label: String(a.label || getAccountName(a)).trim(),
    service: String(a.service || "Copilot"),
    reset_mode: String(a.resetMode || "hours"),
    reset_hours: Math.max(1, Math.round(Number(a.resetHours || 6))),
    reset_time: String(a.resetTime || "06:00"),
    reset_day: Number(a.resetDay || 1),
    reset_timezone: String(a.resetTimezone || "Asia/Bangkok"),
    reset_is_custom: Boolean(a.isCustomSchedule),
    last_used: a.lastUsed ? Number(a.lastUsed) : null,
  }));

  let saved = false;
  let lastError = null;

  // 1) Direct Supabase client upsert (Fast and directly connects from PC)
  if (sb) {
    try {
      const { error } = await sb.from('accounts').upsert(rows, { onConflict: 'id' });
      if (!error) {
        saved = true;
      } else {
        lastError = error;
        console.warn("Supabase direct upsert error:", error);
      }
    } catch (e) {
      lastError = e;
      console.warn("Supabase direct client error:", e);
    }
  }

  // 2) Fallback to Edge function callAppData
  if (!saved) {
    try {
      await callAppData('upsertAccounts', { accounts: rows.map((row) => ({
        id: row.id, accountName: row.account_name, label: row.label, service: row.service,
        resetMode: row.reset_mode, resetHours: row.reset_hours, resetTime: row.reset_time, resetDay: row.reset_day,
        resetTimezone: row.reset_timezone, isCustomSchedule: row.reset_is_custom, lastUsed: row.last_used,
      })) });
      saved = true;
    } catch (err) {
      if (!lastError) lastError = err;
      console.warn("Save accounts DB error:", err);
    }
  }

  if (saved) {
    setAccountCache();
    return true;
  } else {
    toast("⚠️ บันทึกลง Supabase ไม่สำเร็จ: " + (lastError?.message || "กรุณาเข้าสู่ระบบใหม่"));
    return false;
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
  test:         { name: "ทดสอบระบบ",            resetMode: "seconds", resetHours: 1, resetSeconds: 5, resetTime: "00:00", label: "ทดสอบระบบ · 5 วินาที" },
};

function getPreset(serviceName) {
  const s = String(serviceName || "").toLowerCase();
  if (s.includes("ทดสอบ") || s.includes("test")) return PRESETS.test;
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
  const preset = getPreset(account.service);
  const schedule = account.isCustomSchedule
    ? account
    : { ...preset, resetDay: preset.resetDay || 1, resetTimezone: "Asia/Bangkok" };
  return window.ChronoPassReset.nextReset(schedule, refTime, Date.now());
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
  const p = a.isCustomSchedule ? a : getPreset(a.service);
  if (p.name === "ทดสอบระบบ" || p.resetMode === "seconds" || (p.resetHours && p.resetHours < 1)) return "5 วินาที";
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
async function useAccount(id) {
  if (!currentUser) { toast("กรุณาเข้าสู่ระบบก่อน"); return; }
  const a = accounts.find((x) => x.id === id);
  if (!a) return;
  if (accountState(a) !== "ready") { toast("บัญชีนี้ยังไม่รีเซ็ต"); return; }
  const previousLastUsed = a.lastUsed;
  a.lastUsed = Date.now();
  render();
  toast("กำลังบันทึกสถานะบัญชี...");
  if (await saveAccounts()) {
    toast(`${a.service} — ${getAccountName(a)} บันทึกแล้ว`);
  } else {
    a.lastUsed = previousLastUsed;
    render();
    toast("บันทึกสถานะไม่สำเร็จ ข้อมูลเดิมถูกคืนกลับแล้ว");
  }
}

async function deleteAccount(id) {
  const t = accounts.find((x) => x.id === id);
  if (!t) return;
  if (!window.confirm(`ยืนยันการลบบัญชี ${getAccountName(t)} (${t.service})? การกระทำนี้ย้อนกลับไม่ได้`)) return;

  let deleted = false;

  if (currentUser && !currentUser.is_guest) {
    await ensureDbUser();
    const userId = Number(currentUser.id);

    if (sb && Number.isSafeInteger(userId) && userId > 0) {
      try {
        const { error } = await sb.from('accounts').delete().eq('id', id).eq('user_id', userId);
        deleted = !error;
        if (error) console.warn("Direct Supabase delete error:", error);
      } catch (err) {
        console.warn("Direct Supabase delete error:", err);
      }
    }

    if (!deleted) {
      try {
        await callAppData('deleteAccount', { accountId: id });
        deleted = true;
      } catch (error) {
        console.warn("Edge function delete error:", error);
      }
    }
  } else {
    try {
      const next = accounts.filter((x) => x.id !== id);
      localStorage.setItem(GUEST_KEY, JSON.stringify(next));
      deleted = true;
    } catch (error) {
      console.warn("Guest account delete error:", error);
    }
  }

  if (!deleted) { toast("ลบบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"); return; }
  accounts = accounts.filter((x) => x.id !== id);
  setAccountCache();
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

function setModalSaving(saving) {
  document.querySelectorAll("#actionModal .primary").forEach((button) => {
    button.disabled = saving;
    if (saving) button.dataset.label = button.textContent;
    button.textContent = saving ? "กำลังบันทึก..." : (button.dataset.label || button.textContent);
  });
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

async function addAccount() {
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

  if (!currentUser.is_guest) {
    await ensureDbUser();
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

  const previousAccounts = accounts;
  accounts = [...newList, ...accounts];
  closeModal();
  render();

  toast("กำลังบันทึกบัญชี...");
  const success = await saveAccounts();
  if (success) {
    toast(`เพิ่ม ${newList.length} บัญชีและบันทึกลง Supabase สำเร็จ`);
  } else {
    accounts = previousAccounts;
    toast("เพิ่มบัญชีไม่สำเร็จ ข้อมูลถูกคืนกลับแล้ว กรุณาลองใหม่อีกครั้ง");
  }
  render();
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
        <input id="editAccountName" value="${escapeHtml(getAccountName(a))}">
      </div>
      <div class="form-row">
        <label for="editPreset">บริการ AI</label>
        <select id="editPreset">
          ${Object.entries(PRESETS).map(([k, v]) =>
            `<option value="${k}" ${a.service === v.name ? "selected" : ""}>${escapeHtml(v.label)}</option>`
          ).join("")}
        </select>
      </div>
      <div class="form-row">
        <label class="checkbox-label"><input id="customSchedule" type="checkbox" ${a.isCustomSchedule ? "checked" : ""} onchange="toggleCustomScheduleFields()"> กำหนดรอบรีเซ็ตเอง</label>
      </div>
      <div id="customScheduleFields" class="form-grid custom-schedule-fields">
        <div class="form-row">
          <label for="editResetMode">รูปแบบรอบรีเซ็ต</label>
          <select id="editResetMode" onchange="toggleCustomScheduleFields()">
            <option value="hours" ${(a.resetMode || "") === "hours" ? "selected" : ""}>ทุกจำนวนชั่วโมง</option>
            <option value="days" ${(a.resetMode || "") === "days" ? "selected" : ""}>ทุกจำนวนวัน</option>
            <option value="monthly" ${(a.resetMode || "") === "monthly" ? "selected" : ""}>ทุกเดือนตามวันที่</option>
          </select>
        </div>
        <div class="form-row">
          <label for="editResetInterval">จำนวนชั่วโมง / วัน</label>
          <input id="editResetInterval" type="number" min="1" max="8760" value="${Number(a.resetMode === "days" ? Number(a.resetHours || 24) / 24 : a.resetHours || 24)}">
        </div>
        <div class="form-row" id="customResetDayRow">
          <label for="editResetDay">วันที่ของเดือน</label>
          <input id="editResetDay" type="number" min="1" max="31" value="${Number(a.resetDay || 1)}">
        </div>
        <div class="form-row">
          <label for="editResetTime">เวลารีเซ็ต (เวลาไทย)</label>
          <input id="editResetTime" type="time" value="${escapeHtml(a.resetTime || "00:00")}">
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="ghost" onclick="closeModal()">ยกเลิก</button>
      <button type="button" class="primary" onclick="saveEdit(${id})">บันทึก</button>
    </div>
  `;

  m.classList.remove("hidden");
  m.setAttribute("aria-hidden", "false");
  toggleCustomScheduleFields();
  setTimeout(() => document.getElementById("editAccountName")?.focus(), 50);
}

function toggleCustomScheduleFields() {
  const enabled = document.getElementById("customSchedule")?.checked;
  const fields = document.getElementById("customScheduleFields");
  const dayRow = document.getElementById("customResetDayRow");
  const mode = document.getElementById("editResetMode")?.value;
  if (fields) fields.style.display = enabled ? "grid" : "none";
  if (dayRow) dayRow.style.display = enabled && mode === "monthly" ? "block" : "none";
}

async function saveEdit(id) {
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

  const previous = { ...a };
  a.accountName = accountName;
  a.label = accountName;
  a.service = p.name;
  a.resetMode = p.resetMode;
  a.resetHours = p.resetHours;
  a.resetTime = p.resetTime;
  a.resetDay = p.resetDay || 1;
  a.resetTimezone = "Asia/Bangkok";
  a.isCustomSchedule = Boolean(document.getElementById("customSchedule")?.checked);
  if (a.isCustomSchedule) {
    const resetMode = document.getElementById("editResetMode").value;
    const resetHours = Number(document.getElementById("editResetInterval").value);
    const resetDay = Number(document.getElementById("editResetDay").value);
    const resetTime = document.getElementById("editResetTime").value;
    if (!Number.isInteger(resetHours) || resetHours < 1 || resetHours > 8760) { Object.assign(a, previous); toast("กรุณาระบุจำนวนชั่วโมงหรือวันให้ถูกต้อง"); return; }
    if (resetMode === "monthly" && (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31)) { Object.assign(a, previous); toast("กรุณาระบุวันที่ของเดือน 1–31"); return; }
    if (!/^\d{2}:\d{2}$/.test(resetTime)) { Object.assign(a, previous); toast("กรุณาระบุเวลารีเซ็ต"); return; }
    a.resetMode = resetMode;
    a.resetHours = resetMode === "days" ? resetHours * 24 : resetHours;
    a.resetDay = resetDay;
    a.resetTime = resetTime;
  }

  setModalSaving(true);
  const saved = await saveAccounts();
  setModalSaving(false);
  if (!saved) {
    Object.assign(a, previous);
    render();
    toast("บันทึกการแก้ไขไม่สำเร็จ ข้อมูลเดิมถูกคืนกลับแล้ว");
    return;
  }
  closeModal();
  render();
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
            <div class="email">${escapeHtml(getAccountName(a))}</div>
            <div class="service">${escapeHtml(a.service)}</div>
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
  const ids = ["statsRow", "serviceOverview", "releaseNotes", "toolbarRow", "aiFilters"];
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
    document.getElementById("waiting").textContent = "0";
    return;
  }

  // Show dashboard sections
  const show = { statsRow: "grid", serviceOverview: "grid", releaseNotes: "block", toolbarRow: "flex", aiFilters: "flex" };
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
    return hit && (currentServiceFilter === "all" || a.service === currentServiceFilter) && (stf === "all" || st === stf);
  });

  // Service chips
  const services = [...new Set(accounts.map((a) => a.service))]
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  const filterRow = document.getElementById("aiFilters");
  if (filterRow) {
    filterRow.innerHTML = [
      `<button class="filter-chip ${currentServiceFilter === "all" ? "active" : ""}" type="button" data-svc="all">ทั้งหมด</button>`,
      ...services.map((s) =>
        `<button class="filter-chip ${currentServiceFilter === s ? "active" : ""}" type="button" data-svc="${escapeHtml(s)}">${escapeHtml(s)}</button>`
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
  document.getElementById("waiting").textContent = waitCount;

  // Service overview
  const overview = document.getElementById("serviceOverview");
  if (overview) {
    overview.innerHTML = services.map((svc) => {
      const arr = accounts.filter((a) => a.service === svc);
      const r = arr.filter((a) => accountState(a) === "ready").length;
      return `<div class="stat service-stat"><div class="n">${r} / ${arr.length}</div><div class="l">${escapeHtml(svc)} พร้อมใช้งาน</div></div>`;
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
    list.sort((a, b) => {
      const statusOrder = Number(accountState(a) === 'waiting') - Number(accountState(b) === 'waiting');
      return statusOrder || getAccountName(a).localeCompare(getAccountName(b), 'th', { sensitivity: 'base' });
    });
    const all = accounts.filter((a) => a.service === service);
    const rdy = all.filter((a) => accountState(a) === "ready").length;
    const wt = all.length - rdy;

    const sec = document.createElement("div");
    sec.className = "section";
    sec.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <h2>${escapeHtml(service)}</h2>
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
            <div style="flex:1;min-width:0"><div class="name">${escapeHtml(getAccountName(a))}</div></div>
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
  document.getElementById("syncBtn")?.addEventListener("click", syncAccounts);
  document.getElementById("upgradeBtn")?.addEventListener("click", startStripeCheckout);
  document.getElementById("cancelSubscriptionBtn")?.addEventListener("click", cancelStripeSubscription);

  // 1) Check logout state and Guest mode
  const isLoggedOut = sessionStorage.getItem("logged_out") === "true";
  const isGuest = !isLoggedOut && localStorage.getItem("guest_mode") === "true";
  if (isGuest) {
    currentUser = {
      id: "guest",
      line_user_id: "guest_local",
      display_name: "Guest (ในเครื่อง)",
      is_guest: true,
    };
  } else if (!isLoggedOut) {
    // 2) Restore LINE session from sessionStorage
    const storedUserJson = sessionStorage.getItem("line_user_obj");
    const storedDbId = sessionStorage.getItem("line_db_id");
    const storedId = sessionStorage.getItem("line_user_id");
    if (storedUserJson) {
      try {
        currentUser = JSON.parse(storedUserJson);
      } catch (_) {
        currentUser = null;
      }
    }
    if (!currentUser && storedId) {
      const cachedName = sessionStorage.getItem("line_display_name") || "LINE User";
      currentUser = {
        id: storedDbId ? Number(storedDbId) : storedId,
        line_user_id: storedId,
        display_name: cachedName,
      };
    }
  }

  // 3) Init LIFF — MUST happen before any liff.isLoggedIn() / liff.isInClient()
  await initLiff();

  let loggedInViaLiff = false;
  // 4) Auto-login from LIFF if not logged out, not in guest mode, and not already restored
  if (!isLoggedOut && !isGuest && !currentUser && liffReady && window.liff.isLoggedIn()) {
    await handleLiffLogin();
    loggedInViaLiff = true;
  }

  // 5) Clean URL params if returning from LINE Login (e.g. ?code=...&state=...)
  if (window.location.search && (window.location.search.includes("code=") || window.location.search.includes("state=") || window.location.search.includes("liffClientId="))) {
    window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
  }

  if (new URLSearchParams(window.location.search).get("checkout") === "success") {
    toast("ชำระเงินสำเร็จ กำลังเปิดสิทธิ์แจ้งเตือน LINE");
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (new URLSearchParams(window.location.search).get("checkout") === "cancelled") {
    toast("ยกเลิกการชำระเงินแล้ว");
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // 6) Render UI and sync DB
  if (!loggedInViaLiff) {
    if (currentUser && !currentUser.is_guest) {
      await ensureDbUser();
    }
    updateAuthUI();
    await hydrateAccounts();
    render();
  }

  // 7) Timer only updates countdown text (no DOM re-render = no blinking)
  setInterval(updateCountdowns, 1000);
}

// Boot
initApp();
