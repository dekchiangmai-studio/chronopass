/* ============================================
   ChronoPass — Cookie Consent Logic
   PDPA Compliance
   ============================================ */

(function () {
  "use strict";

  const CONSENT_KEY = "chronopass-cookie-consent";
  const CONSENT_VERSION = 1;

  // ---- Public API ----

  /**
   * Returns the stored consent object, or null if not yet consented.
   * Shape: { necessary: true, functional: boolean, consentedAt: number, version: number }
   */
  window.getCookieConsent = function () {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.version === CONSENT_VERSION) return data;
      // Version mismatch — treat as no consent (policy changed)
      return null;
    } catch {
      return null;
    }
  };

  /**
   * Returns true if the user has consented to functional cookies.
   * Other scripts can call this before writing to localStorage caches.
   */
  window.hasFunctionalConsent = function () {
    const consent = window.getCookieConsent();
    return consent ? consent.functional === true : false;
  };

  // ---- Internal helpers ----

  function saveConsent(functional) {
    const data = {
      necessary: true,
      functional: !!functional,
      consentedAt: Date.now(),
      version: CONSENT_VERSION,
    };
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Cannot save cookie consent:", e);
    }
  }

  function hideBanner() {
    const banner = document.getElementById("cookieConsentBanner");
    if (banner) {
      banner.classList.remove("visible");
      // Remove from DOM after animation
      setTimeout(() => {
        banner.remove();
      }, 500);
    }
  }

  function hideSettingsModal() {
    const overlay = document.getElementById("cookieSettingsModal");
    if (overlay) {
      overlay.classList.remove("visible");
    }
  }

  // ---- Accept all ----

  window.acceptAllCookies = function () {
    saveConsent(true);
    hideBanner();
    hideSettingsModal();
  };

  // ---- Open settings modal ----

  window.openCookieSettings = function () {
    let overlay = document.getElementById("cookieSettingsModal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "cookieSettingsModal";
      overlay.className = "cookie-modal-overlay";
      overlay.innerHTML = buildSettingsHTML();
      document.body.appendChild(overlay);
    }

    // Restore current preference into toggle
    const consent = window.getCookieConsent();
    const toggle = overlay.querySelector("#cookieFunctionalToggle");
    if (toggle) {
      toggle.checked = consent ? consent.functional : true;
    }

    // Show
    requestAnimationFrame(() => {
      overlay.classList.add("visible");
    });
  };

  // ---- Save preferences from modal ----

  window.saveCookiePreferences = function () {
    const toggle = document.getElementById("cookieFunctionalToggle");
    const functional = toggle ? toggle.checked : false;
    saveConsent(functional);
    hideBanner();
    hideSettingsModal();
  };

  // ---- Build banner HTML ----

  function buildBannerHTML() {
    return `
      <div class="cookie-banner-inner">
        <div class="cookie-banner-icon">🍪</div>
        <div class="cookie-banner-text">
          <h3>เว็บไซต์นี้ใช้คุกกี้</h3>
          <p>
            ChronoPass ใช้คุกกี้และการจัดเก็บข้อมูลในเครื่องเพื่อให้บริการทำงานได้อย่างถูกต้อง
            รวมถึงจดจำสถานะการเข้าสู่ระบบและข้อมูลบัญชีของคุณ
            เราไม่ใช้คุกกี้เพื่อติดตามพฤติกรรมหรือการโฆษณา
          </p>
        </div>
        <div class="cookie-banner-actions">
          <button class="cookie-btn cookie-btn-accept" type="button" onclick="acceptAllCookies()">ยอมรับทั้งหมด</button>
          <button class="cookie-btn" type="button" onclick="openCookieSettings()">ตั้งค่าคุกกี้</button>
        </div>
      </div>
    `;
  }

  // ---- Build settings modal HTML ----

  function buildSettingsHTML() {
    return `
      <div class="cookie-modal-backdrop" onclick="hideSettingsModalFromBackdrop()"></div>
      <div class="cookie-modal">
        <div class="cookie-modal-header">
          <h2>ตั้งค่าคุกกี้</h2>
          <button class="cookie-modal-close" type="button" onclick="closeCookieSettingsModal()">×</button>
        </div>
        <p class="cookie-modal-intro">
          เราใช้คุกกี้และ Local Storage เพื่อให้เว็บไซต์ทำงานได้อย่างถูกต้องและปรับปรุงประสบการณ์การใช้งานของคุณ
          คุณสามารถเลือกเปิดหรือปิดคุกกี้บางประเภทได้ตามต้องการ
          โดยการปิดคุกกี้บางประเภทอาจส่งผลต่อประสบการณ์การใช้งาน
        </p>

        <!-- Necessary -->
        <div class="cookie-category">
          <div class="cookie-category-header">
            <div class="cookie-category-info">
              <h4>คุกกี้ที่จำเป็น</h4>
              <p>จำเป็นสำหรับการทำงานพื้นฐานของเว็บไซต์ เช่น การเข้าสู่ระบบ และการบันทึกสถานะ session ไม่สามารถปิดได้</p>
            </div>
            <span class="cookie-category-badge">เปิดเสมอ</span>
          </div>
          <ul class="cookie-data-list">
            <li>
              <span class="cookie-data-key">sessionStorage</span>
              <span>ข้อมูล session เช่น LINE user ID, ชื่อแสดง</span>
            </li>
            <li>
              <span class="cookie-data-key">guest_mode</span>
              <span>สถานะการเข้าใช้แบบ Guest</span>
            </li>
            <li>
              <span class="cookie-data-key">cookie-consent</span>
              <span>จดจำการตั้งค่าคุกกี้ของคุณ</span>
            </li>
          </ul>
        </div>

        <!-- Functional -->
        <div class="cookie-category">
          <div class="cookie-category-header">
            <div class="cookie-category-info">
              <h4>คุกกี้เพื่อการทำงาน</h4>
              <p>ใช้สำหรับจดจำข้อมูลบัญชี AI แคชข้อมูลข้ามเซสชัน และเชื่อมต่อกับบริการภายนอก (LINE LIFF, Supabase) เพื่อให้ใช้งานได้สะดวกยิ่งขึ้น</p>
            </div>
            <label class="cookie-toggle">
              <input type="checkbox" id="cookieFunctionalToggle" checked>
              <span class="cookie-toggle-track"></span>
            </label>
          </div>
          <ul class="cookie-data-list">
            <li>
              <span class="cookie-data-key">accounts cache</span>
              <span>แคชข้อมูลบัญชี AI เพื่อโหลดเร็วขึ้น</span>
            </li>
            <li>
              <span class="cookie-data-key">LINE LIFF SDK</span>
              <span>เชื่อมต่อการเข้าสู่ระบบผ่าน LINE</span>
            </li>
            <li>
              <span class="cookie-data-key">Supabase</span>
              <span>จัดเก็บข้อมูลบัญชีผู้ใช้บนคลาวด์</span>
            </li>
          </ul>
        </div>

        <div class="cookie-modal-actions">
          <button class="cookie-btn" type="button" onclick="closeCookieSettingsModal()">ยกเลิก</button>
          <button class="cookie-btn cookie-btn-accept" type="button" onclick="saveCookiePreferences()">บันทึกการตั้งค่า</button>
        </div>
      </div>
    `;
  }

  // ---- Modal close helpers ----

  window.closeCookieSettingsModal = function () {
    hideSettingsModal();
  };

  window.hideSettingsModalFromBackdrop = function () {
    // Clicking backdrop closes modal but NOT the banner
    hideSettingsModal();
  };

  // ---- Init ----

  function initCookieConsent() {
    const consent = window.getCookieConsent();

    // If already consented (and version matches), don't show banner
    if (consent) return;

    // Create and inject banner
    const banner = document.createElement("div");
    banner.id = "cookieConsentBanner";
    banner.className = "cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "การแจ้งเตือนคุกกี้");
    banner.innerHTML = buildBannerHTML();
    document.body.appendChild(banner);

    // Trigger slide-up animation after a short delay
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        banner.classList.add("visible");
      });
    });
  }

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCookieConsent);
  } else {
    initCookieConsent();
  }
})();
