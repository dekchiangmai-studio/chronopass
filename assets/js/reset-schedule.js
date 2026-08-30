/* Shared reset-schedule calculations. Calendar schedules use Asia/Bangkok. */
(function (root) {
  const BANGKOK_OFFSET = "+07:00";

  function bangkokParts(value) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(value));
    return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function bangkokDate(year, month, day, time) {
    const [hour = 0, minute = 0] = String(time || "00:00").split(":").map(Number);
    return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${BANGKOK_OFFSET}`);
  }

  function addBangkokMonths(value, months, time) {
    const p = bangkokParts(value);
    const index = (p.month - 1) + months;
    const year = p.year + Math.floor(index / 12);
    const month = ((index % 12) + 12) % 12 + 1;
    return bangkokDate(year, month, Math.min(p.day, daysInMonth(year, month)), time || `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`);
  }

  function nextReset(schedule, lastUsed, now = Date.now()) {
    const ref = new Date(lastUsed);
    const mode = schedule?.resetMode || "hours";
    if (mode === "hours" || mode === "days") {
      const interval = Math.max(0.001, Number(schedule?.resetHours) || 1) * 60 * 60 * 1000;
      return new Date(ref.getTime() + interval);
    }
    if (mode === "monthlyFromUse") return addBangkokMonths(ref, 1, schedule?.resetTime);
    if (mode === "monthly") {
      const current = bangkokParts(now);
      const day = Math.min(31, Math.max(1, Number(schedule?.resetDay) || 1));
      let candidate = bangkokDate(current.year, current.month, Math.min(day, daysInMonth(current.year, current.month)), schedule?.resetTime);
      if (candidate.getTime() <= now) candidate = addBangkokMonths(candidate, 1, schedule?.resetTime);
      return candidate;
    }
    return new Date(ref.getTime() + 60 * 60 * 1000);
  }

  const api = { nextReset, daysInMonth, bangkokParts };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ChronoPassReset = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
