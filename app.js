/**
 * app.js — Church Attendance PWA
 * Complete application logic: routing, offline queue, sync engine,
 * analytics chart, admin panel, notifications.
 */

"use strict";

/* =====================================================
   UTILITY HELPERS
===================================================== */

/**
 * Format a Date object as Arabic locale string.
 * @param {Date} date
 * @returns {string}
 */
function formatArabicDate(date) {
  const days = CONFIG.ARABIC_DAYS;
  const months = CONFIG.ARABIC_MONTHS;
  const day = days[date.getDay()];
  const month = months[date.getMonth()];
  const arabicNumerals = (n) =>
    n.toString().replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  return `${day}، ${arabicNumerals(date.getDate())} ${month} ${arabicNumerals(date.getFullYear())}`;
}

/**
 * Format a date as YYYY-MM-DD string (ISO local date).
 * @param {Date} date
 * @returns {string}
 */
function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Calculate age in years from a YYYY-MM-DD date-of-birth string.
 * @param {string} dob
 * @returns {number}
 */
function calculateAge(dob) {
  if (!dob) return 0;
  const today = new Date();
  const birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return Math.max(0, age);
}

/**
 * Convert Western numerals to Arabic-Indic numerals.
 * @param {number|string} n
 * @returns {string}
 */
function toArabicNumerals(n) {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
}

/**
 * Calculate days remaining until the next birthday (0-7).
 * Mirrors the exact day-diff logic from Notifications.checkUpcomingBirthdays().
 * Returns null if DOB is invalid/missing or if the birthday is >7 days away.
 * @param {string} dob YYYY-MM-DD
 * @returns {number|null}
 */
function getDaysUntilBirthday(dob) {
  if (!dob || typeof dob !== "string" || !dob.trim()) return null;
  const parts = dob.trim().split("-");
  if (parts.length < 3) return null;
  const bMonth = parseInt(parts[1], 10);
  const bDay   = parseInt(parts[2], 10);
  if (!bMonth || !bDay || isNaN(bMonth) || isNaN(bDay)) return null;

  const today = new Date();
  const todayYear = today.getFullYear();

  // Handle Feb 29 in non-leap years: treat as Feb 28
  let effectiveDay = bDay;
  if (bMonth === 2 && bDay === 29) {
    const isLeap = (todayYear % 4 === 0 && (todayYear % 100 !== 0 || todayYear % 400 === 0));
    if (!isLeap) effectiveDay = 28;
  }

  // Build this year's birthday date (time-zeroed)
  let birthday = new Date(todayYear, bMonth - 1, effectiveDay, 0, 0, 0, 0);

  // If the birthday has already passed this calendar year, look to next year
  const todayMidnight = new Date(todayYear, today.getMonth(), today.getDate(), 0, 0, 0, 0);
  if (birthday < todayMidnight) {
    birthday = new Date(todayYear + 1, bMonth - 1, effectiveDay, 0, 0, 0, 0);
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.round((birthday - todayMidnight) / msPerDay);

  if (daysRemaining < 0 || daysRemaining > 7) return null;
  return daysRemaining;
}

/**
 * Format a number of days as an Arabic day word (singular/dual/plural).
 * Mirrors the exact convention from Notifications.checkUpcomingBirthdays().
 * Uses Arabic-Indic numerals for the card display.
 * @param {number} days
 * @returns {string}
 */
function formatDaysWord(days) {
  const n = toArabicNumerals(days);
  if (days === 1) return "يوم";
  if (days === 2) return "يومين";
  if (days <= 10) return `${n} أيام`;
  return `${n} يوم`;
}

/**
 * Generate a UUID v4.
 * @returns {string}
 */
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get all dates of a specific weekday in a given month.
 * @param {number} dayIndex 0=Sun..6=Sat
 * @param {number} year
 * @param {number} month 0-indexed
 * @returns {Date[]}
 */
function getDatesOfWeekdayInMonth(dayIndex, year, month) {
  const dates = [];
  const d = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  while (d <= last) {
    if (d.getDay() === dayIndex) {
      dates.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/**
 * Get the most recent past date from an array (or today if today matches).
 * Falls back to the first date if none are in the past.
 * @param {Date[]} dates
 * @returns {Date|null}
 */
function getMostRecentPastDate(dates) {
  if (!dates.length) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const past = dates.filter(d => d <= today);
  return past.length > 0 ? past[past.length - 1] : dates[0];
}

/**
 * Show a toast message.
 * @param {string} message
 * @param {"success"|"error"|""} type
 * @param {number} duration
 */
function showToast(message, type = "", duration = 3000) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "visible" + (type ? ` ${type}` : "");
  clearTimeout(App._toastTimer);
  App._toastTimer = setTimeout(() => {
    toast.className = "";
  }, duration);
}

/**
 * Show or hide the global loading overlay.
 * @param {boolean} visible
 * @param {string} text
 */
function setLoading(visible, text = "جارٍ التحميل...") {
  const overlay = document.getElementById("loading-overlay");
  const loadingText = document.getElementById("loading-text");
  loadingText.textContent = text;
  if (visible) {
    overlay.classList.add("visible");
  } else {
    overlay.classList.remove("visible");
  }
}

/**
 * Open a modal overlay.
 * @param {string} id
 */
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }
}

/**
 * Close a modal overlay.
 * @param {string} id
 */
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove("open");
    document.body.style.overflow = "";
  }
}

/**
 * Navigate to a named screen.
 * @param {string} screenId  e.g. "welcome", "families", "attendance", "admin"
 */
function navigateTo(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const target = document.getElementById(`screen-${screenId}`);
  if (target) {
    target.classList.add("active");
  }
  App.currentScreen = screenId;
}

/* =====================================================
   LOCAL STORAGE HELPERS
===================================================== */

const Storage = {
  get(key) {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error("Storage write error:", e);
    }
  },
  remove(key) {
    localStorage.removeItem(key);
  },
  getCachedFamilies() {
    return Storage.get("sundayApp_cachedFamilies") || [];
  },
  setCachedFamilies(families) {
    Storage.set("sundayApp_cachedFamilies", families);
  },
  getFamily() {
    return Storage.get(CONFIG.STORAGE_KEYS.FAMILY);
  },
  setFamily(name) {
    Storage.set(CONFIG.STORAGE_KEYS.FAMILY, name);
  },
  getMembers() {
    return Storage.get(CONFIG.STORAGE_KEYS.MEMBERS) || [];
  },
  setMembers(members) {
    Storage.set(CONFIG.STORAGE_KEYS.MEMBERS, members);
  },
  getOfflineQueue() {
    return Storage.get(CONFIG.STORAGE_KEYS.OFFLINE_QUEUE) || [];
  },
  setOfflineQueue(queue) {
    Storage.set(CONFIG.STORAGE_KEYS.OFFLINE_QUEUE, queue);
  },
  addToOfflineQueue(item) {
    const queue = Storage.getOfflineQueue();
    queue.push(item);
    Storage.setOfflineQueue(queue);
  },
  updateMember(memberId, updates) {
    var members = Storage.getMembers();
    var idx = members.findIndex(function(m) { return m.id === memberId; });
    if (idx === -1) return;
    Object.assign(members[idx], updates);
    Storage.setMembers(members);
  },
  clearOfflineQueue() {
    Storage.setOfflineQueue([]);
  },
  getAttendanceToday() {
    return Storage.get(CONFIG.STORAGE_KEYS.ATTENDANCE_TODAY) || {};
  },
  setAttendanceToday(record) {
    Storage.set(CONFIG.STORAGE_KEYS.ATTENDANCE_TODAY, record);
  },
  markAttendanceLocally(memberId, status, date) {
    const record = Storage.getAttendanceToday();
    if (!record[date]) {
      record[date] = {};
    }
    record[date][memberId] = status;
    Storage.setAttendanceToday(record);
  },
  getAttendanceForDate(date) {
    const record = Storage.getAttendanceToday();
    return record[date] || {};
  },
  getServants(family) {
  const allServants = Storage.get("sundayApp_servants") || {};
  return allServants[family] || [];
},

setServants(family, servants) {
  const allServants = Storage.get("sundayApp_servants") || {};
  allServants[family] = servants;
  Storage.set("sundayApp_servants", allServants);
},

getServantColors(family) {
  const all = Storage.get("sundayApp_servantColors") || {};
  const colors = Object.assign({}, all[family] || {});
  // Merge servant colors from member objects in Storage
  const members = Storage.getMembers();
  members.forEach(function(m) {
    if (m.servantName && m.servantColor) {
      colors[m.servantName] = m.servantColor;
    }
  });
  return colors;
},

setServantColors(family, colors) {
  const all = Storage.get("sundayApp_servantColors") || {};
  all[family] = colors;
  Storage.set("sundayApp_servantColors", all);
},

getMemberAssignments(family) {
  const all = Storage.get("sundayApp_memberAssignments") || {};
  const ass = Object.assign({}, all[family] || {});
  // Merge assignments from member objects in Storage
  const members = Storage.getMembers();
  members.forEach(function(m) {
    if (m.servantName && !ass[m.id]) {
      ass[m.id] = m.servantName;
    }
  });
  return ass;
},

setMemberAssignments(family, assignments) {
  const all = Storage.get("sundayApp_memberAssignments") || {};
  all[family] = assignments;
  Storage.set("sundayApp_memberAssignments", all);
},

getDailyNote(memberId, date) {
    const allNotes = Storage.get("sundayApp_dailyNotes") || {};
    return (allNotes[date] && allNotes[date][memberId]) ? allNotes[date][memberId] : "";
  },
  setDailyNote(memberId, date, note) {
    const allNotes = Storage.get("sundayApp_dailyNotes") || {};
    if (!allNotes[date]) allNotes[date] = {};
    allNotes[date][memberId] = note;
    Storage.set("sundayApp_dailyNotes", allNotes);
  },
  setLastSync(ts) {
    Storage.set(CONFIG.STORAGE_KEYS.LAST_SYNC, ts);
  },
  getLastSync() {
    return Storage.get(CONFIG.STORAGE_KEYS.LAST_SYNC);
  }
};

/* =====================================================
   API LAYER — Google Apps Script Communication
 ===================================================== */

const API = {
  /**
   * Send a POST request to the Google Apps Script backend.
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async post(payload) {
    if (!CONFIG.GOOGLE_SCRIPT_URL || CONFIG.GOOGLE_SCRIPT_URL === "YOUR_DEPLOYED_APPS_SCRIPT_URL_HERE") {
      // Demo mode — return mock data
      return API.mockResponse(payload);
    }

    const response = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  },

  /**
   * Mock responses for demo mode (when GOOGLE_SCRIPT_URL not configured).
   * @param {object} payload
   * @returns {object}
   */
  mockResponse(payload) {
    const { action } = payload;

    if (action === "saveDailyNote") {
      return { success: true };
    }

    if (action === "verifyAdmin") {
      return { success: payload.code === "1234" };
    }

    if (action === "verifyFamily") {
      const mockPasswords = {
        "عيلة مارى": "1111",
        "عيلة كيرو": "2222",
        "عيلة بطرس": "3333"
      };
      const isValid = mockPasswords[payload.family] === payload.password;
      const mockMembers = isValid
        ? [
          { id: "m1", name: "مريم أنطون", family: payload.family, phone: "01001234567", parentPhone: "01001234568", dob: "2013-05-15", notes: "", registeredAt: new Date().toISOString() },
          { id: "m2", name: "بطرس كيرلس", family: payload.family, phone: "01101234567", parentPhone: "01101234568", dob: "2015-08-22", notes: "يحتاج متابعة", registeredAt: new Date().toISOString() },
          { id: "m3", name: "سارة ميخائيل", family: payload.family, phone: "01201234567", parentPhone: "01201234568", dob: "2011-12-03", notes: "", registeredAt: new Date().toISOString() },
          { id: "m4", name: "جورج فارس", family: payload.family, phone: "01501234567", parentPhone: "01501234568", dob: "2014-03-18", notes: "", registeredAt: new Date().toISOString() }
        ]
        : [];
      return { success: isValid, members: mockMembers };
    }

    if (action === "addMember") {
      return { success: true, id: generateUUID() };
    }

    if (action === "markAttendance") {
      return { success: true };
    }

    if (action === "updateMember") {
      return { success: true };
    }

    if (action === "getAttendanceStats") {
      const months = CONFIG.ARABIC_MONTHS;
      const now = new Date();
      const year = payload.year || now.getFullYear();
      const month = payload.month || (now.getMonth() + 1);
      const serviceDay = payload.serviceDay;
      const dates = [];
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, month - 1, d);
        if (serviceDay === undefined || serviceDay === null || dt.getDay() === serviceDay) {
          dates.push(d);
        }
      }
      const stats = dates.map((d) => ({
        week: `${toArabicNumerals(d)} ${months[month - 1]}`,
        present: Math.floor(Math.random() * 8) + 2,
        absent: Math.floor(Math.random() * 4),
        total: 10,
        percentage: Math.floor(Math.random() * 40) + 60
      }));
      return { weeks: stats.map((s) => s.week), stats };
    }

    if (action === "getAbsentees") {
      return {
        members: [
          { id: "m2", name: "بطرس كيرلس", family: "عيلة مارى", consecutiveAbsences: 4 }
        ]
      };
    }

    if (action === "syncOfflineQueue") {
      return {
        results: (payload.queue || []).map((item) => ({ id: item.memberId || generateUUID(), success: true }))
      };
    }

    if (action === "refreshMembers") {
      return { success: true, members: Storage.getMembers() };
    }

    if (action === "updateFamilyConfig") {
      return { success: true };
    }

    if (action === "getFamilies") {
      return { success: true, families: CONFIG.FAMILIES.map(f => ({ name: f, stage: "" })) };
    }

    if (action === "saveServants") {
      return { success: true };
    }

    if (action === "saveServantAssignments") {
      return { success: true };
    }

    if (action === "updateMemberServant") {
      return { success: true };
    }

    if (action === "getAttendanceForDate") {
      return {};
    }

    if (action === "getAttendanceDetails") {
      const mockNames = [
        { name: "مريم أنطون" },
        { name: "بطرس كيرلس" },
        { name: "سارة ميخائيل" }
      ];
      return { success: true, members: mockNames };
    }

    if (action === "getAttendanceForExport") {
      return {
        success: true,
        date: payload.date,
        headers: ["الاسم", "الأسرة", "السن", "الحالة", "التاريخ", "وقت التسجيل"],
        rows: [
          ["مريم أنطون", "عيلة مارى", "13", "حاضر", payload.date, "10:00 ص"],
          ["بطرس كيرلس", "عيلة مارى", "11", "غائب", payload.date, "10:01 ص"]
        ]
      };
    }

    if (action === "getServants") {
      return {
        success: true,
        servants: [
          { id: "s1", name: "خادم 1", color: "#FFB3B3", members: [{ id: "m1", name: "مريم أنطون" }, { id: "m4", name: "جورج فارس" }] },
          { id: "s2", name: "خادم 2", color: "#A0D4FF", members: [{ id: "m2", name: "بطرس كيرلس" }, { id: "m3", name: "سارة ميخائيل" }] }
        ]
      };
    }

    if (action === "saveVisitation") {
      return { success: true, id: generateUUID() };
    }

    if (action === "getVisitations") {
      return { success: true, visitations: [] };
    }

    if (action === "updateVisitation") {
      return { success: true };
    }

    if (action === "updateFamilyStage") {
      return { success: true };
    }

    if (action === "getFamilyStages") {
      return { success: true, stages: {} };
    }

    return { success: false, error: "Unknown action" };
  },

  async verifyAdmin(code) {
    return API.post({ action: "verifyAdmin", code });
  },

  async verifyFamily(family, password) {
    return API.post({ action: "verifyFamily", family, password });
  },

  async addMember(data) {
    return API.post({ action: "addMember", ...data });
  },

  async updateMember(data) {
    return API.post({ action: "updateMember", ...data });
  },

  async saveDailyNote(memberId, memberName, family, date, note) {
    return API.post({
      action: "saveDailyNote",
      memberId,
      memberName,
      family,
      date,
      note
    });
  },

  async markAttendance(memberId, family, date, status) {
    return API.post({ action: "markAttendance", memberId, family, date, status });
  },

  async getAttendanceStats(family, year, month, serviceDay) {
    return API.post({ action: "getAttendanceStats", family, year, month, serviceDay });
  },

  async getAttendanceForDate(family, date) {
    return API.post({ action: "getAttendanceForDate", family, date });
  },

  async getAttendanceDetails(family, date, status) {
    return API.post({ action: "getAttendanceDetails", family, date, status });
  },

  async getAbsentees(threshold) {
    return API.post({ action: "getAbsentees", threshold });
  },

  async syncOfflineQueue(queue) {
    return API.post({ action: "syncOfflineQueue", queue });
  },

  async updateFamilyConfig(families, passwords) {
    return API.post({ action: "updateFamilyConfig", families, passwords });
  },

  async deleteFamilyData(family) {
    return API.post({ action: "deleteFamilyData", family });
  },

  async renameFamily(oldName, newName) {
    return API.post({ action: "renameFamily", oldName, newName });
  },

  async refreshMembers(family) {
    return API.post({ action: "refreshMembers", family });
  },

  async getFamilies() {
    return API.post({ action: "getFamilies" });
  },

  async saveServants(family, servants) {
    return API.post({ action: "saveServants", family, servants });
  },

  async saveServantAssignments(family, assignments, colors) {
    return API.post({ action: "saveServantAssignments", family, assignments, colors });
  },

  async updateMemberServant(memberId, family, servantName, servantColor) {
    return API.post({ action: "updateMemberServant", memberId, family, servantName, servantColor });
  },

  async getAttendanceForExport(date, family) {
    return API.post({ action: "getAttendanceForExport", date, family });
  },

  async getServants(family) {
    return API.post({ action: "getServants", family });
  },

  async saveVisitation(data) {
    return API.post({ action: "saveVisitation", ...data });
  },

  async getVisitations(family) {
    return API.post({ action: "getVisitations", family });
  },

  async updateVisitation(data) {
    return API.post({ action: "updateVisitation", ...data });
  },

  async updateFamilyStage(family, stage) {
    return API.post({ action: "updateFamilyStage", family, stage });
  },

  async getFamilyStages() {
    return API.post({ action: "getFamilyStages" });
  },
};

/* =====================================================
   FACE RECOGNITION API LAYER
 ===================================================== */

/* =====================================================
   FACE RECOGNITION API LAYER
 ===================================================== */

function populateFacePersonSelect() {
  const select = document.getElementById("face-person-name");
  if (!select) return;
  const members = Storage.getMembers();
  select.innerHTML = '<option value="">— اختر المخدوم —</option>';
  members.forEach(function(m) {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = m.name;
    select.appendChild(opt);
  });
}

const FaceAPI = {
  /**
   * Add a new person with photos to the Face Recognition service.
   * @param {string} name
   * @param {FileList|File[]} photos
   * @returns {Promise<object>}
   */
  async addPerson(name, photos) {
    try {
      const formData = new FormData();
      formData.append("family", Storage.get(CONFIG.STORAGE_KEYS.FAMILY));
      formData.append("name", name);
      for (let i = 0; i < photos.length; i++) {
        formData.append("photos", photos[i]);
      }

      const response = await fetch(CONFIG.FACE_API_URL + "/add-person", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      showToast(`✅ تم إضافة المخدوم "${name}" بنجاح`, "success");
      return data;
    } catch (error) {
      console.error("FaceAPI.addPerson error:", error);
      showToast("❌ حدث خطأ أثناء إضافة المخدوم", "error");
      throw error;
    }
  },

  /**
   * Recognize members present in the group photo.
   * @param {File} photo
   * @returns {Promise<object>}
   */
  async recognize(photo) {
    const selectedDate = App.selectedDate;
    const resultArea = document.getElementById("face-recognize-result");
    
    if (!selectedDate) {
      console.warn("[Face Recognition] Aborted: No attendance date selected.");
      showToast("⚠️ يرجى تحديد تاريخ الحضور أولاً", "error");
      if (resultArea) {
        resultArea.innerHTML = `<div class="face-result-empty" style="color: var(--danger);">⚠️ يرجى تحديد تاريخ الحضور أولاً من الشريط العلوي</div>`;
      }
      return;
    }

    console.log(`[Face Recognition] Starting recognition for date: ${selectedDate}`);
    try {
      const formData = new FormData();
      formData.append("family", Storage.get(CONFIG.STORAGE_KEYS.FAMILY));
      formData.append("photo", photo);

      const response = await fetch(CONFIG.FACE_API_URL + "/recognize", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log("[Face Recognition] API response received:", data);

      const presentList = data.present || [];
      const unknownList = data.unknown || [];
      const threshold = CONFIG.FACE_RECOGNITION_THRESHOLD || 0.70;

      // Group into workflow categories
      const state = {
        recorded: [],
        already: [],
        review: [],
        unknown: []
      };

      const members = Storage.getMembers();
      const todayAttendance = Storage.getAttendanceForDate(selectedDate);

      // Process matched list
      for (const item of presentList) {
        const confidence = typeof item.confidence === "number" ? item.confidence : 1.0;
        const name = item.name || "";
        const image = item.face_image || null;

        // Try to match with existing members
        const matchedMember = members.find(m => m.name.trim().toLowerCase() === name.trim().toLowerCase());

        if (!matchedMember) {
          console.warn(`[Face Recognition] Match not found in current family: Name=${name}`);
          state.unknown.push({
            name: name,
            confidence: confidence,
            face_image: image
          });
          continue;
        }

        if (confidence < threshold) {
          console.log(`[Face Recognition] Low confidence match: Name=${name}, Conf=${confidence}. Sent to Needs Review.`);
          state.review.push({
            name: name,
            confidence: confidence,
            face_image: image,
            memberId: matchedMember.id,
            matchedMember: matchedMember
          });
        } else {
          // Check duplicates on selected date ONLY
          const isAlreadyPresent = todayAttendance[matchedMember.id] === "present";
          if (isAlreadyPresent) {
            console.log(`[Face Recognition] Duplicate prevented: Member ${name} is already present on date ${selectedDate}`);
            state.already.push({
              name: name,
              confidence: confidence,
              face_image: image,
              matchedMember: matchedMember
            });
          } else {
            console.log(`[Face Recognition] Auto-recording attendance: Member ${name} present on date ${selectedDate}`);
            await App.recordAttendance(matchedMember.id, "present", selectedDate, null);
            state.recorded.push({
              name: name,
              confidence: confidence,
              face_image: image,
              matchedMember: matchedMember
            });
          }
        }
      }

      // Process unknown list
      unknownList.forEach((item, index) => {
        state.unknown.push({
          name: "غير معروف",
          confidence: typeof item.confidence === "number" ? item.confidence : 0.0,
          face_image: item.face_image || null,
          index: index
        });
      });

      console.log("[Face Recognition] Processing completed. State count: recorded =", state.recorded.length, "already =", state.already.length, "review =", state.review.length, "unknown =", state.unknown.length);
      FaceAPI.renderWorkflow(state, selectedDate);
      return data;
    } catch (error) {
      console.error("[Face Recognition] Recognition error:", error);
      showToast("❌ حدث خطأ أثناء التعرف على المخدومين", "error");
      if (resultArea) {
        resultArea.innerHTML = `<div class="face-result-empty" style="color: var(--danger);">فشل الاتصال بخادم التعرف</div>`;
      }
      throw error;
    }
  },

  /**
   * Render the Face Recognition workflow UI results.
   * @param {object} state
   * @param {string} selectedDate
   */
  renderWorkflow(state, selectedDate) {
    const resultArea = document.getElementById("face-recognize-result");
    if (!resultArea) return;

    const members = Storage.getMembers();
    const todayAttendance = Storage.getAttendanceForDate(selectedDate);
    const getLinkableMembersOptions = () => {
      return members
        .map(m => {
          const isPresent = todayAttendance[m.id] === "present";
          const label = isPresent ? `${m.name} (مسجل حضور بالفعل)` : m.name;
          return `<option value="${m.id}">${label}</option>`;
        })
        .join("");
    };

    const updateView = () => {
      resultArea.innerHTML = "";

      // 1. Selected date notification banner
      const header = document.createElement("div");
      header.className = "face-workflow-header";
      header.innerHTML = `
        <div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:12px;background:var(--surface);padding:10px 14px;border-radius:var(--radius-sm);border-right:4px solid var(--primary);direction:rtl;">
          📅 تاريخ الحضور المحدد: <strong>${selectedDate}</strong> (تم تسجيل الحضور تلقائياً لذوي نسبة التطابق العالية)
        </div>
      `;
      resultArea.appendChild(header);

      // 2. Summary grid
      const summaryGrid = document.createElement("div");
      summaryGrid.className = "face-summary-grid";
      
      const totalCount = state.recorded.length + state.already.length + state.review.length + state.unknown.length;
      
      summaryGrid.innerHTML = `
        <div class="face-summary-card">
          <div class="face-summary-num">${toArabicNumerals(totalCount)}</div>
          <div class="face-summary-label">إجمالي الوجوه</div>
        </div>
        <div class="face-summary-card success-card">
          <div class="face-summary-num">${toArabicNumerals(state.recorded.length)}</div>
          <div class="face-summary-label">تم تسجيلهم</div>
        </div>
        <div class="face-summary-card success-card" style="background:#e3f2fd; color:#1976d2; border-color:rgba(25,118,210,0.2);">
          <div class="face-summary-num">${toArabicNumerals(state.already.length)}</div>
          <div class="face-summary-label font-bold">حاضرون بالفعل</div>
        </div>
        <div class="face-summary-card warning-card">
          <div class="face-summary-num">${toArabicNumerals(state.review.length)}</div>
          <div class="face-summary-label">بحاجة لمراجعة</div>
        </div>
        <div class="face-summary-card danger-card">
          <div class="face-summary-num">${toArabicNumerals(state.unknown.length)}</div>
          <div class="face-summary-label">وجوه غير معروفة</div>
        </div>
      `;
      resultArea.appendChild(summaryGrid);

      // 3. Recorded / Already present list
      const recordedList = [...state.recorded, ...state.already];
      if (recordedList.length > 0) {
        const sec = document.createElement("div");
        sec.className = "face-list-section";
        sec.innerHTML = `
          <div class="face-list-section-title"><span>✅</span> تم تأكيد حضورهم تلقائياً</div>
          <div class="face-workflow-list"></div>
        `;
        const listContainer = sec.querySelector(".face-workflow-list");
        recordedList.forEach(item => {
          const isAlready = state.already.includes(item);
          const badgeClass = isAlready ? "already" : "present";
          const badgeText = isAlready ? "حاضر بالفعل" : "تم الحضور تلقائياً";
          const confText = item.confidence ? ` (تطابق ${Math.round(item.confidence * 100)}%)` : "";

          const row = document.createElement("div");
          row.className = "face-workflow-item";
          row.innerHTML = `
            <div class="face-workflow-left">
              <div class="face-crop-container">
                ${item.face_image ? `<img src="${item.face_image}" class="face-crop-img" alt="Face"/>` : `<span class="face-crop-fallback">👤</span>`}
              </div>
              <div class="face-workflow-info">
                <span class="face-workflow-name">${item.name}</span>
                <span class="face-workflow-meta">${confText}</span>
              </div>
            </div>
            <div class="face-workflow-right">
              <span class="face-workflow-badge ${badgeClass}">${badgeText}</span>
            </div>
          `;
          listContainer.appendChild(row);
        });
        resultArea.appendChild(sec);
      }

      // 4. Needs Review list
      if (state.review.length > 0) {
        const sec = document.createElement("div");
        sec.className = "face-list-section";
        sec.innerHTML = `
          <div class="face-list-section-title"><span>⚠️</span> بحاجة إلى مراجعة (نسبة تطابق منخفضة)</div>
          <div class="face-workflow-list"></div>
        `;
        const listContainer = sec.querySelector(".face-workflow-list");
        state.review.forEach((item, reviewIdx) => {
          const confText = ` (تطابق ${Math.round(item.confidence * 100)}%)`;
          const row = document.createElement("div");
          row.className = "face-workflow-item";
          row.innerHTML = `
            <div class="face-workflow-left">
              <div class="face-crop-container">
                ${item.face_image ? `<img src="${item.face_image}" class="face-crop-img" alt="Face"/>` : `<span class="face-crop-fallback">👤</span>`}
              </div>
              <div class="face-workflow-info">
                <span class="face-workflow-name">${item.name}؟</span>
                <span class="face-workflow-meta">${confText}</span>
              </div>
            </div>
            <div class="face-workflow-right">
              <button class="face-workflow-btn btn-confirm" data-idx="${reviewIdx}">👍 تأكيد</button>
              <select class="face-workflow-select" id="review-select-${reviewIdx}">
                <option value="">— ربط بآخر —</option>
                ${getLinkableMembersOptions()}
              </select>
              <button class="face-workflow-btn btn-link" data-idx="${reviewIdx}">ربط</button>
            </div>
          `;

          row.querySelector(".btn-confirm").addEventListener("click", async () => {
            console.log(`[Face Review Confirmed] User confirmed: Name=${item.name}, MemberId=${item.memberId}, Date=${selectedDate}`);
            const isAlreadyPresent = Storage.getAttendanceForDate(selectedDate)[item.memberId] === "present";
            if (!isAlreadyPresent) {
              await App.recordAttendance(item.memberId, "present", selectedDate, null);
              state.recorded.push(item);
            } else {
              state.already.push(item);
            }
            state.review.splice(reviewIdx, 1);
            updateView();
          });

          row.querySelector(".btn-link").addEventListener("click", async () => {
            const select = row.querySelector(`#review-select-${reviewIdx}`);
            const targetId = select.value;
            if (!targetId) {
              showToast("يرجى اختيار مخدوم أولاً", "error");
              return;
            }
            const chosenMember = members.find(m => m.id === targetId);
            console.log(`[Face Review Linked] User linked: Name=${chosenMember.name}, MemberId=${targetId}, Date=${selectedDate}`);
            const isAlreadyPresent = Storage.getAttendanceForDate(selectedDate)[targetId] === "present";
            if (!isAlreadyPresent) {
              await App.recordAttendance(targetId, "present", selectedDate, null);
              state.recorded.push({
                name: chosenMember.name,
                confidence: item.confidence,
                face_image: item.face_image
              });
            } else {
              state.already.push({
                name: chosenMember.name,
                confidence: item.confidence,
                face_image: item.face_image
              });
            }
            state.review.splice(reviewIdx, 1);
            updateView();
          });

          listContainer.appendChild(row);
        });
        resultArea.appendChild(sec);
      }

      // 5. Unknown Faces list
      if (state.unknown.length > 0) {
        const sec = document.createElement("div");
        sec.className = "face-list-section";
        sec.innerHTML = `
          <div class="face-list-section-title"><span>👤</span> وجوه غير معروفة</div>
          <div class="face-workflow-list"></div>
        `;
        const listContainer = sec.querySelector(".face-workflow-list");
        state.unknown.forEach((item, unknownIdx) => {
          const row = document.createElement("div");
          row.className = "face-workflow-item";
          row.innerHTML = `
            <div class="face-workflow-left">
              <div class="face-crop-container">
                ${item.face_image ? `<img src="${item.face_image}" class="face-crop-img" alt="Face"/>` : `<span class="face-crop-fallback">❓</span>`}
              </div>
              <div class="face-workflow-info">
                <span class="face-workflow-name">وجه غير معروف #${unknownIdx + 1}</span>
                <span class="face-workflow-meta">غير محدد الهوية</span>
              </div>
            </div>
            <div class="face-workflow-right">
              <select class="face-workflow-select" id="unknown-select-${unknownIdx}">
                <option value="">— اختر مخدوم لتسجيل الحضور —</option>
                ${getLinkableMembersOptions()}
              </select>
              <button class="face-workflow-btn btn-link">🔗 ربط</button>
            </div>
          `;

          row.querySelector(".btn-link").addEventListener("click", async () => {
            const select = row.querySelector(`#unknown-select-${unknownIdx}`);
            const targetId = select.value;
            if (!targetId) {
              showToast("يرجى اختيار مخدوم أولاً", "error");
              return;
            }
            const chosenMember = members.find(m => m.id === targetId);
            console.log(`[Face Unknown Linked] User linked: Name=${chosenMember.name}, MemberId=${targetId}, Date=${selectedDate}`);
            const isAlreadyPresent = Storage.getAttendanceForDate(selectedDate)[targetId] === "present";
            if (!isAlreadyPresent) {
              await App.recordAttendance(targetId, "present", selectedDate, null);
              state.recorded.push({
                name: chosenMember.name,
                confidence: item.confidence,
                face_image: item.face_image
              });
            } else {
              state.already.push({
                name: chosenMember.name,
                confidence: item.confidence,
                face_image: item.face_image
              });
            }
            state.unknown.splice(unknownIdx, 1);
            updateView();
          });

          listContainer.appendChild(row);
        });
        resultArea.appendChild(sec);
      }
    };

    updateView();
  }
};

/* =====================================================
   OFFLINE SYNC ENGINE
===================================================== */

const SyncEngine = {
  /**
   * Flush the offline queue to the server.
   * @returns {Promise<{succeeded: number, failed: number}>}
   */
  async flush() {
    const queue = Storage.getOfflineQueue();
    if (!queue.length) {
      return { succeeded: 0, failed: 0 };
    }

    try {
      const result = await API.syncOfflineQueue(queue);
      const results = result.results || [];
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      if (failed === 0) {
        Storage.clearOfflineQueue();
      } else {
        // Keep failed items in queue
        const failedIds = new Set(
          results.filter((r) => !r.success).map((r) => r.id)
        );
        const remaining = queue.filter((item) =>
          failedIds.has(item.memberId)
        );
        Storage.setOfflineQueue(remaining);
      }

      Storage.setLastSync(new Date().toISOString());
      UI.updateQueueCountBadges();
      return { succeeded, failed, results };
    } catch (err) {
      console.error("Sync failed:", err);
      return { succeeded: 0, failed: queue.length, results: [] };
    }
  }
};

/* =====================================================
   NOTIFICATIONS
===================================================== */

const Notifications = {
  permission: "default",

  init() {
    if (!("Notification" in window)) {
      Notifications.permission = "denied";
      return;
    }
    Notifications.permission = Notification.permission;
    const stored = Storage.get(CONFIG.STORAGE_KEYS.NOTIFICATION_PERM);

    if (Notification.permission === "granted") {
      Notifications.permission = "granted";
      Notifications.checkAbsentees();
      Notifications.checkUpcomingBirthdays();
    } else if (Notification.permission === "default" && stored !== "dismissed") {
      // Show polite in-app banner
      const banner = document.getElementById("notif-banner");
      if (banner) banner.classList.add("visible");
    }
  },

  async requestPermission() {
    try {
      const result = await Notification.requestPermission();
      Notifications.permission = result;
      const banner = document.getElementById("notif-banner");
      if (banner) banner.classList.remove("visible");

      if (result === "granted") {
        Notifications.checkAbsentees();
        Notifications.checkUpcomingBirthdays();
      }
    } catch (e) {
      console.warn("Notification permission error:", e);
    }
  },

  dismiss() {
    Storage.set(CONFIG.STORAGE_KEYS.NOTIFICATION_PERM, "dismissed");
    const banner = document.getElementById("notif-banner");
    if (banner) banner.classList.remove("visible");
  },

  async checkAbsentees() {
    if (Notifications.permission !== "granted") return;
    if (!navigator.onLine) return;
    try {
      const result = await API.getAbsentees(CONFIG.ABSENCE_THRESHOLD);
      const members = result.members || [];
      members.forEach((member) => {
        new Notification("⚠️ تنبيه غياب", {
          body: `${member.name} غائب منذ ${member.consecutiveAbsences} أسابيع متتالية`,
          icon: "icon-192.png",
          tag: `absent-${member.id}`,
          dir: "rtl",
          lang: "ar"
        });
      });
    } catch (e) {
      console.warn("Absentees check failed:", e);
    }
  },

  fireNotification(title, body, tag) {
    if (Notifications.permission !== "granted") return;
    new Notification(title, {
      body,
      icon: "icon-192.png",
      tag: tag || "sunday-app",
      dir: "rtl",
      lang: "ar"
    });
  },

  /**
   * Birthday countdown notifications (local/client-triggered only).
   *
   * Shows a daily notification for any member whose birthday falls within the
   * next 7 days (0 = today, 7 = one week away).  Fires one notification per
   * matching member so servants can act on each name individually.  Visible to
   * whichever servant has this family's members loaded in the current session;
   * no server-side push is involved — the app must be opened for this to run.
   */
  checkUpcomingBirthdays() {
    if (Notifications.permission !== "granted") return;

    const members = Storage.getMembers();
    const today = new Date();
    const todayMonth = today.getMonth() + 1; // 1-indexed
    const todayDay   = today.getDate();
    const todayYear  = today.getFullYear();

    members.forEach((member) => {
      try {
        const dob = member.dob;
        if (!dob || typeof dob !== "string" || !dob.trim()) return;

        // Parse YYYY-MM-DD (same convention as calculateAge)
        const parts = dob.trim().split("-");
        if (parts.length < 3) return;
        const bMonth = parseInt(parts[1], 10);
        const bDay   = parseInt(parts[2], 10);
        if (!bMonth || !bDay || isNaN(bMonth) || isNaN(bDay)) return;

        // Handle Feb 29 in non-leap years: treat as Feb 28
        let effectiveDay = bDay;
        if (bMonth === 2 && bDay === 29) {
          const isLeap = (todayYear % 4 === 0 && (todayYear % 100 !== 0 || todayYear % 400 === 0));
          if (!isLeap) effectiveDay = 28;
        }

        // Build this year's birthday date (time-zeroed)
        let birthday = new Date(todayYear, bMonth - 1, effectiveDay, 0, 0, 0, 0);

        // If the birthday has already passed this calendar year, look to next year
        const todayMidnight = new Date(todayYear, today.getMonth(), todayDay, 0, 0, 0, 0);
        if (birthday < todayMidnight) {
          birthday = new Date(todayYear + 1, bMonth - 1, effectiveDay, 0, 0, 0, 0);
        }

        const msPerDay = 24 * 60 * 60 * 1000;
        const daysRemaining = Math.round((birthday - todayMidnight) / msPerDay);

        if (daysRemaining < 0 || daysRemaining > 7) return;

        const name = member.name || "أحد المخدومين";
        let title, body;

        if (daysRemaining === 0) {
          title = "عيد ميلاد سعيد 🎉";
          body  = `النهاردة عيد ميلاد ${name}`;
        } else {
          title = "تذكير بعيد ميلاد 🎂";
          // Arabic singular / dual / plural for "day/days"
          let daysWord;
          if (daysRemaining === 1) {
            daysWord = "يوم";
          } else if (daysRemaining === 2) {
            daysWord = "يومين";
          } else if (daysRemaining <= 10) {
            daysWord = `${daysRemaining} أيام`;
          } else {
            daysWord = `${daysRemaining} يوم`;
          }
          body = `${name} — باقي ${daysWord} على عيد ميلاده`;
        }

        // Unique tag per member+day prevents duplicate suppression across members
        const tag = `birthday-${member.id}-${daysRemaining}`;
        Notifications.fireNotification(title, body, tag);

      } catch (e) {
        // Silently skip members with invalid dob data
        console.warn("Birthday check skipped for member:", member.id, e);
      }
    });
  }
};

/* =====================================================
   CHART ENGINE — Pure Canvas API
===================================================== */

const Chart = {
  _hitAreas: [],

  /**
   * Draw a grouped bar chart with trend line on the attendance-chart canvas.
   * @param {string[]} labels
   * @param {number[]} presentData
   * @param {number[]} absentData
   * @param {string[]} [dates]  YYYY-MM-DD date strings for each bar
   */
  draw(labels, presentData, absentData, dates) {
    const canvas = document.getElementById("attendance-chart");
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const containerWidth = canvas.parentElement.clientWidth - 40;
    canvas.width = containerWidth * dpr;
    canvas.height = 220 * dpr;
    canvas.style.width = containerWidth + "px";
    canvas.style.height = "220px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const width = containerWidth;
    const height = 220;
    const paddingLeft = 40;
    const paddingRight = 16;
    const paddingTop = 20;
    const paddingBottom = 50;
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    ctx.clearRect(0, 0, width, height);

    const maxVal = Math.max(...presentData, ...absentData, 1);
    const numBars = labels.length;
    const groupWidth = chartWidth / numBars;
    const barWidth = Math.min(groupWidth * 0.35, 30);
    const barGap = 4;

    // Draw Y-axis grid lines and labels
    const ySteps = 5;
    ctx.strokeStyle = "#e0e2ef";
    ctx.lineWidth = 1;
    ctx.font = `${11 * dpr / dpr}px Cairo, sans-serif`;
    ctx.fillStyle = "#9090a8";
    ctx.textAlign = "right";
    ctx.direction = "rtl";

    for (let i = 0; i <= ySteps; i++) {
      const val = Math.round((maxVal / ySteps) * i);
      const y = paddingTop + chartHeight - (chartHeight * i) / ySteps;

      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(paddingLeft + chartWidth, y);
      ctx.stroke();

      ctx.fillText(toArabicNumerals(val), paddingLeft - 6, y + 4);
    }

    // Draw bars and trend points
    const trendPoints = [];
    Chart._hitAreas = [];

    for (let i = 0; i < numBars; i++) {
      const groupX = paddingLeft + i * groupWidth + groupWidth / 2;

      // Present bar (right of center in RTL context)
      const presentH = (presentData[i] / maxVal) * chartHeight;
      const presentX = groupX - barWidth - barGap / 2;
      const presentY = paddingTop + chartHeight - presentH;

      const presentGrad = ctx.createLinearGradient(presentX, presentY, presentX, paddingTop + chartHeight);
      presentGrad.addColorStop(0, "#4CAF50");
      presentGrad.addColorStop(1, "#81C784");
      ctx.fillStyle = presentGrad;

      ctx.beginPath();
      const pRadius = Math.min(6, barWidth / 2);
      ctx.moveTo(presentX + pRadius, presentY);
      ctx.lineTo(presentX + barWidth - pRadius, presentY);
      ctx.quadraticCurveTo(presentX + barWidth, presentY, presentX + barWidth, presentY + pRadius);
      ctx.lineTo(presentX + barWidth, paddingTop + chartHeight);
      ctx.lineTo(presentX, paddingTop + chartHeight);
      ctx.lineTo(presentX, presentY + pRadius);
      ctx.quadraticCurveTo(presentX, presentY, presentX + pRadius, presentY);
      ctx.closePath();
      ctx.fill();

      // Absent bar
      const absentH = (absentData[i] / maxVal) * chartHeight;
      const absentX = groupX + barGap / 2;
      const absentY = paddingTop + chartHeight - absentH;

      const absentGrad = ctx.createLinearGradient(absentX, absentY, absentX, paddingTop + chartHeight);
      absentGrad.addColorStop(0, "#FF5252");
      absentGrad.addColorStop(1, "#FF8A80");
      ctx.fillStyle = absentGrad;

      ctx.beginPath();
      const aRadius = Math.min(6, barWidth / 2);
      ctx.moveTo(absentX + aRadius, absentY);
      ctx.lineTo(absentX + barWidth - aRadius, absentY);
      ctx.quadraticCurveTo(absentX + barWidth, absentY, absentX + barWidth, absentY + aRadius);
      ctx.lineTo(absentX + barWidth, paddingTop + chartHeight);
      ctx.lineTo(absentX, paddingTop + chartHeight);
      ctx.lineTo(absentX, absentY + aRadius);
      ctx.quadraticCurveTo(absentX, absentY, absentX + aRadius, absentY);
      ctx.closePath();
      ctx.fill();

      // Value labels on bars
      ctx.fillStyle = "#1a1a2e";
      ctx.font = `bold 11px Cairo, sans-serif`;
      ctx.textAlign = "center";
      if (presentData[i] > 0) {
        ctx.fillText(toArabicNumerals(presentData[i]), presentX + barWidth / 2, presentY - 4);
      }
      if (absentData[i] > 0) {
        ctx.fillText(toArabicNumerals(absentData[i]), absentX + barWidth / 2, absentY - 4);
      }

      // Track trend line points (center top of present bar)
      trendPoints.push({ x: groupX, y: presentY });

      // X-axis label
      ctx.fillStyle = "#5a5a7a";
      ctx.font = `500 11px Cairo, sans-serif`;
      ctx.textAlign = "center";
      const shortLabel = labels[i].replace("الأسبوع ", "أسبوع ");
      ctx.fillText(shortLabel, groupX, paddingTop + chartHeight + 20);

      // Store hit area for click interaction
      Chart._hitAreas.push({
        date: dates ? dates[i] : "",
        presentX,
        presentW: barWidth,
        absentX,
        absentW: barWidth,
        label: labels[i]
      });
    }

    // Draw trend line
    if (trendPoints.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = "#193BB0";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([5, 4]);

      ctx.moveTo(trendPoints[0].x, trendPoints[0].y);
      for (let i = 1; i < trendPoints.length; i++) {
        const cp1x = (trendPoints[i - 1].x + trendPoints[i].x) / 2;
        const cp1y = trendPoints[i - 1].y;
        const cp2x = cp1x;
        const cp2y = trendPoints[i].y;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, trendPoints[i].x, trendPoints[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Dots on trend line
      trendPoints.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#193BB0";
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    // Draw axes
    ctx.strokeStyle = "#e0e2ef";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, paddingTop);
    ctx.lineTo(paddingLeft, paddingTop + chartHeight);
    ctx.lineTo(paddingLeft + chartWidth, paddingTop + chartHeight);
    ctx.stroke();

    // Attach click listener once
    if (!canvas._chartClick) {
      canvas._chartClick = true;
      canvas.addEventListener("click", async (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        for (const area of Chart._hitAreas) {
          const clickedPresent = x >= area.presentX && x <= area.presentX + area.presentW;
          const clickedAbsent  = x >= area.absentX  && x <= area.absentX  + area.absentW;

          if (clickedPresent || clickedAbsent) {
            const status = clickedPresent ? "present" : "absent";
            const family = Storage.getFamily();
            if (!area.date) return;
            showAttendanceDetailsModal(null, status, area.label);
            const result = await API.getAttendanceDetails(family, area.date, status);
            showAttendanceDetailsModal(result.members || [], status, area.label);
            break;
          }
        }
      });
    }
  },

  drawEmpty() {
    const canvas = document.getElementById("attendance-chart");
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const containerWidth = (canvas.parentElement.clientWidth - 40) || 300;
    canvas.width = containerWidth * dpr;
    canvas.height = 220 * dpr;
    canvas.style.width = containerWidth + "px";
    canvas.style.height = "220px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, containerWidth, 220);
    ctx.fillStyle = "#9090a8";
    ctx.font = "16px Cairo, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("لا توجد بيانات لعرضها", containerWidth / 2, 110);
  }
};

/* =====================================================
   UI RENDERING
===================================================== */

const UI = {
  /**
   * Render the families grid on Screen 1.
   * Shows stage cards first; clicking a stage shows that stage's families.
   */
  renderFamiliesGrid() {
    const grid = document.getElementById("families-grid");
    if (!grid) return;
    grid.innerHTML = "";

    if (App._stageView) {
      // ── Stage view: show filtered family cards + back button ──
      const backRow = document.createElement("div");
      backRow.className = "stage-back-row";
      backRow.innerHTML = `<button id="btn-stage-back" class="stage-back-btn">→ رجوع للمراحل</button>`;
      backRow.querySelector("#btn-stage-back").addEventListener("click", () => {
        App._stageView = false;
        UI.renderFamiliesGrid();
      });
      grid.parentElement.insertBefore(backRow, grid);

      const familyIcons = ["⛪", "❤️", "🕊️", "✝️", "✨", "🎄"];
      const colors = CONFIG.PASTEL_COLORS;
      const stageFamilies = CONFIG.FAMILIES.filter(name => App.familyStages[name] === App._selectedStage);

      if (stageFamilies.length === 0) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🏠</div><h3>لا توجد أسر في هذه المرحلة</h3></div>`;
        return;
      }

      stageFamilies.forEach((familyName, idx) => {
        const card = document.createElement("div");
        card.className = "family-card";
        card.style.background = colors[idx % colors.length];
        card.dataset.family = familyName;
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        card.setAttribute("aria-label", `اختيار ${familyName}`);
        card.innerHTML = `
          <div class="family-card-icon">${familyIcons[idx % familyIcons.length]}</div>
          <div class="family-card-name">${familyName}</div>
          <div class="family-card-sub">اضغط للدخول</div>
        `;
        card.addEventListener("click", () => App.onFamilyCardClick(familyName));
        card.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") App.onFamilyCardClick(familyName);
        });
        grid.appendChild(card);
      });
      return;
    }

    // ── Stage selection view ──
    // Remove any existing back row
    const existingBack = grid.parentElement.querySelector(".stage-back-row");
    if (existingBack) existingBack.remove();

    const stageIcons = { "ابتدائي": "🌱", "إعدادي": "📚", "ثانوي": "🎓", "شباب": "✨" };
    const stageColors = ["#D4F5A2", "#C8E6FF", "#FFD6E0", "#E8D5FF"];

    CONFIG.FAMILY_STAGES.forEach((stage, idx) => {
      const count = CONFIG.FAMILIES.filter(name => App.familyStages[name] === stage).length;
      const card = document.createElement("div");
      card.className = "stage-card";
      card.style.background = stageColors[idx % stageColors.length];
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", `مرحلة ${stage}`);
      card.innerHTML = `
        <div class="stage-card-icon">${stageIcons[stage] || "📋"}</div>
        <div class="stage-card-name">${stage}</div>
        <div class="stage-card-count">${toArabicNumerals(count)} أسرة</div>
      `;
      card.addEventListener("click", () => {
        App._stageView = true;
        App._selectedStage = stage;
        UI.renderFamiliesGrid();
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          App._stageView = true;
          App._selectedStage = stage;
          UI.renderFamiliesGrid();
        }
      });
      grid.appendChild(card);
    });
  },

  /**
   * Render the 7-day date strip for the current week.
   */
  renderDateStrip() {
    const strip = document.getElementById("date-strip");
    if (!strip) return;
    strip.innerHTML = "";
    const today = new Date();
    const dayOfWeek = today.getDay();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - dayOfWeek);

    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);

      const pill = document.createElement("div");
      pill.className = "date-pill" + (i === dayOfWeek ? " active" : "");
      pill.dataset.date = toDateString(d);

      const dayName = CONFIG.ARABIC_DAYS[d.getDay()];
      const dayNum = toArabicNumerals(d.getDate());

      pill.innerHTML = `
        <span class="date-pill-day">${dayName}</span>
        <span class="date-pill-num">${dayNum}</span>
      `;

      pill.addEventListener("click", () => {
        document.querySelectorAll(".date-pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        App.selectedDate = pill.dataset.date;
        UI.renderMembersList();
      });

      strip.appendChild(pill);
    }
  },

  /**
   * Render the service day date strip showing all occurrences of the chosen
   * weekday in the current month.
   * @param {number} dayIndex 0=Sun..6=Sat
   */
  renderServiceDayStrip(dayIndex) {
    const strip = document.getElementById("date-strip");
    if (!strip) return;
    strip.innerHTML = "";
    const now = new Date();
    const dates = getDatesOfWeekdayInMonth(dayIndex, now.getFullYear(), now.getMonth());
    const defaultDate = getMostRecentPastDate(dates);
    if (!defaultDate) {
      strip.innerHTML = `<div class="date-pill" style="color:white;padding:10px 14px;">لا توجد تواريخ هذا الشهر</div>`;
      return;
    }
    const defaultDs = toDateString(defaultDate);
    App.selectedDate = defaultDs;
    dates.forEach((d) => {
      const pill = document.createElement("div");
      pill.className = "date-pill";
      const ds = toDateString(d);
      pill.dataset.date = ds;
      if (ds === defaultDs) {
        pill.classList.add("active");
      }
      const dayName = CONFIG.ARABIC_DAYS[d.getDay()];
      const dayNum = toArabicNumerals(d.getDate());
      pill.innerHTML = `
        <span class="date-pill-day">${dayName}</span>
        <span class="date-pill-num">${dayNum}</span>
      `;
      pill.addEventListener("click", () => {
        document.querySelectorAll(".date-pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        App.selectedDate = ds;
        App.refreshAttendance();
      });
      strip.appendChild(pill);
    });
    UI.renderMembersList();
  },

  /**
   * Render all member cards.
   */
  renderMembersList() {
    const list = document.getElementById("members-list");
    if (!list) return;
    list.innerHTML = "";

    const members = Storage.getMembers();
    const selectedDate = App.selectedDate || toDateString(new Date());
    const todayAttendance = Storage.getAttendanceForDate(selectedDate);

    if (!members.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👶</div>
          <h3>لا يوجد مخدومون بعد</h3>
          <p>اضغط على زر + لإضافة أول مخدوم في عيلتك</p>
        </div>
      `;
      return;
    }

    members.forEach((member, idx) => {
      const card = document.createElement("div");
      card.className = "member-card";
      card.id = `member-card-${member.id}`;
      const family = Storage.getFamily();
      const assignments = Storage.getMemberAssignments(family);
      const servantColors = Storage.getServantColors(family);
      const assignedServant = assignments[member.id];
      const servantColor = assignedServant && servantColors[assignedServant] ? servantColors[assignedServant] : null;
      card.style.background = servantColor || CONFIG.PASTEL_COLORS[idx % CONFIG.PASTEL_COLORS.length];

      const age = calculateAge(member.dob);
      const ageText = age > 0 ? `${toArabicNumerals(age)} سنة` : "—";
      const daysUntilBirthday = getDaysUntilBirthday(member.dob);
      let birthdayCountdownText = "";
      if (daysUntilBirthday !== null) {
        if (daysUntilBirthday === 0) {
          birthdayCountdownText = " - عيد ميلاده النهاردة 🎉";
        } else {
          birthdayCountdownText = ` - باقي ${formatDaysWord(daysUntilBirthday)}`;
        }
      }
      const attendanceStatus = todayAttendance[member.id] || null;

      const presentSelected = attendanceStatus === "present" ? "selected" : "";
      const absentSelected = attendanceStatus === "absent" ? "selected" : "";

      let statusBadgeHtml = "";
      if (attendanceStatus === "present") {
        statusBadgeHtml = `<span class="member-status-badge present">✅ حاضر</span>`;
      } else if (attendanceStatus === "absent") {
        statusBadgeHtml = `<span class="member-status-badge absent">❌ غائب</span>`;
      }

      card.innerHTML = `
        <div class="member-card-header">
          <div>
            <div class="member-name">${member.name}</div>
            <div class="member-age">🎂 ${ageText}${birthdayCountdownText}</div>
          </div>
          ${statusBadgeHtml}
        </div>
        <div class="member-actions">
          <button class="action-btn present-btn ${presentSelected}"
                  data-member-id="${member.id}"
                  data-status="present">
            ✅ حاضر
          </button>
          <button class="action-btn absent-btn ${absentSelected}"
                  data-member-id="${member.id}"
                  data-status="absent">
            ❌ غائب
          </button>
        </div>
      `;

      // Card click → member details modal
      card.addEventListener("click", (e) => {
        if (e.target.closest(".action-btn")) return;
        showMemberDetailsModal(member, selectedDate);
      });

      // Attendance button listeners
      const presentBtn = card.querySelector(".present-btn");
      const absentBtn = card.querySelector(".absent-btn");

      presentBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (attendanceStatus === "present") return;
        if (attendanceStatus && attendanceStatus !== "present") {
          if (!confirm("هل تريد تغيير الحالة إلى حاضر؟")) return;
        }
        App.recordAttendance(member.id, "present", selectedDate, card);
      });
      absentBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (attendanceStatus === "absent") return;
        if (attendanceStatus && attendanceStatus !== "absent") {
          if (!confirm("هل تريد تغيير الحالة إلى غائب؟")) return;
        }
        App.recordAttendance(member.id, "absent", selectedDate, card);
      });

      list.appendChild(card);
    });
  },

  /**
   * Update the top bar with family name and current date.
   */
  updateTopBar() {
    const familyEl = document.getElementById("topbar-family-name");
    const dateEl = document.getElementById("topbar-date");
    if (familyEl) familyEl.textContent = Storage.getFamily() || "خدمتك";
    if (dateEl) dateEl.textContent = formatArabicDate(new Date());
  },

  /**
   * Populate the month selector filter.
   */
  populateMonthFilter() {
    const sel = document.getElementById("filter-month");
    if (!sel) return;
    sel.innerHTML = "";
    const now = new Date();
    // Show last 6 months
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const option = document.createElement("option");
      option.value = `${d.getFullYear()}-${d.getMonth() + 1}`;
      option.textContent = `${CONFIG.ARABIC_MONTHS[d.getMonth()]} ${toArabicNumerals(d.getFullYear())}`;
      if (i === 0) option.selected = true;
      sel.appendChild(option);
    }
  },

  /**
   * Render the analytics panel with chart and summary cards.
   * @param {object} statsData
   */
  renderAnalytics(statsData) {
    const { stats } = statsData;
    if (!stats || !stats.length) {
      Chart.drawEmpty();
      document.getElementById("stat-best-week").textContent = "—";
      document.getElementById("stat-most-absent").textContent = "—";
      document.getElementById("stat-monthly-rate").textContent = "—";
      return;
    }

    const labels = stats.map((s) => s.week);
    const presentData = stats.map((s) => s.present);
    const absentData = stats.map((s) => s.absent);
    const dates = stats.map((s) => s.date);

    Chart.draw(labels, presentData, absentData, dates);

    // Best week
    const bestIdx = presentData.indexOf(Math.max(...presentData));
    const bestWeek = stats[bestIdx];
    document.getElementById("stat-best-week").textContent =
      bestWeek ? `${bestWeek.week} (${toArabicNumerals(bestWeek.present)} حضور)` : "—";

    // Most absent member (from stats if available, else show week with most absent)
    const worstIdx = absentData.indexOf(Math.max(...absentData));
    const worstWeek = stats[worstIdx];
    document.getElementById("stat-most-absent").textContent =
      worstWeek ? `${worstWeek.week} (${toArabicNumerals(worstWeek.absent)} غياب)` : "—";

    // Monthly rate
    const totalPresent = presentData.reduce((a, b) => a + b, 0);
    const totalAll = stats.reduce((a, s) => a + s.total, 0);
    const rate = totalAll > 0 ? Math.round((totalPresent / totalAll) * 100) : 0;
    document.getElementById("stat-monthly-rate").textContent = `${toArabicNumerals(rate)}٪`;
  },

  /**
   * Update the queue count display in multiple places.
   */
  updateQueueCountBadges() {
    const count = Storage.getOfflineQueue().length;
    const el1 = document.getElementById("settings-queue-count");
    const el2 = document.getElementById("admin-queue-count");

    if (el1) {
      el1.textContent = count > 0 ? `${toArabicNumerals(count)} عناصر معلقة للمزامنة` : "لا توجد عناصر معلقة";
    }
    if (el2) el2.textContent = toArabicNumerals(count);

    // Update last sync display
    const lastSync = Storage.getLastSync();
    const el3 = document.getElementById("settings-last-sync-time");
    if (el3) {
      el3.textContent = lastSync ? new Date(lastSync).toLocaleString("ar-EG") : "لم تتم المزامنة بعد";
    }
  },

  /**
   * Render the admin family management list.
   * @param {string[]} families
   */
  renderAdminFamilyList(families) {
    const container = document.getElementById("admin-family-list");
    if (!container) return;
    container.innerHTML = "";

    families.forEach((family) => {
      const item = document.createElement("div");
      item.className = "family-manage-item";

      const currentStage = App.familyStages[family] || "";
      const stageOptions = CONFIG.FAMILY_STAGES.map(s =>
        `<option value="${s}" ${currentStage === s ? "selected" : ""}>${s}</option>`
      ).join("");

      item.innerHTML = `
        <span class="family-manage-name">👨‍👩‍👧 ${family}</span>
        <div class="family-manage-actions">
          <select class="family-stage-select" data-family="${family}" title="مرحلة الأسرة">
            <option value="">— اختر المرحلة —</option>
            ${stageOptions}
          </select>
          <button class="btn-icon edit" title="تعديل" data-family="${family}">✏️</button>
          <button class="btn-icon delete" title="حذف" data-family="${family}">🗑️</button>
        </div>
      `;

      item.querySelector(".family-stage-select").addEventListener("change", async (e) => {
        const selectedStage = e.target.value;
        App.familyStages[family] = selectedStage;
        try {
          await API.updateFamilyStage(family, selectedStage);
          showToast(`✅ تم حفظ مرحلة ${family}`, "success", 2000);
        } catch (_) {
          showToast("خطأ في حفظ المرحلة", "error");
        }
      });

      item.querySelector(".btn-icon.edit").addEventListener("click", () => {
        App.admin.editFamily(family);
      });
      item.querySelector(".btn-icon.delete").addEventListener("click", () => {
        App.admin.deleteFamily(family);
      });

      container.appendChild(item);
    });
  },

  /**
   * Render the absentees list in admin panel.
   * @param {object[]} members
   */
  renderAbsenteesList(members) {
    const container = document.getElementById("admin-absentees-list");
    if (!container) return;
    container.innerHTML = "";

    if (!members.length) {
      container.innerHTML = `
        <p style="font-size:14px;color:var(--success);text-align:center;padding:16px 0;font-weight:600;">
          🎉 لا يوجد مخدومون غائبون تجاوزوا الحد المحدد
        </p>
      `;
      return;
    }

    const canNotify = Notifications.permission === "granted";

    members.forEach((member) => {
      if (!canNotify) {
        // Inline warning card
        const warn = document.createElement("div");
        warn.className = "inline-warning";
        warn.innerHTML = `
          <span class="inline-warning-icon">⚠️</span>
          <div class="inline-warning-text">
            <strong>${member.name}</strong> — ${member.family}<br/>
            غائب منذ ${toArabicNumerals(member.consecutiveAbsences)} أسابيع متتالية
          </div>
        `;
        container.appendChild(warn);
      } else {
        const item = document.createElement("div");
        item.className = "absentee-item";
        item.innerHTML = `
          <div class="absentee-info">
            <div class="absentee-name">${member.name}</div>
            <div class="absentee-detail">${member.family}</div>
          </div>
          <span class="absentee-count">${toArabicNumerals(member.consecutiveAbsences)} أسابيع</span>
          <button class="btn-icon edit notify-btn" title="إرسال إشعار" data-member-id="${member.id}" data-member-name="${member.name}" data-absences="${member.consecutiveAbsences}">🔔</button>
        `;

        item.querySelector(".notify-btn").addEventListener("click", (e) => {
          const btn = e.currentTarget;
          Notifications.fireNotification(
            "⚠️ تنبيه غياب",
            `${btn.dataset.memberName} غائب منذ ${btn.dataset.absences} أسابيع متتالية`,
            `absent-${btn.dataset.memberId}`
          );
          showToast("تم إرسال الإشعار", "success");
        });

        container.appendChild(item);
      }
    });
  }
};

/* =====================================================
   MEMBER DETAILS MODAL
===================================================== */

/**
 * Show a modal with member details for the selected date.
 * @param {object} member
 * @param {string} selectedDate
 */
async function renderServantsList(family) {
  const list = document.getElementById("servants-list");
  if (!list) return;

  list.innerHTML = `<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:16px 0;">جاري التحميل...</p>`;

  try {
    const result = await API.getServants(family);
    if (result && result.success && Array.isArray(result.servants)) {
      const names = result.servants.map(function(s) { return s.name; });
      Storage.setServants(family, names);

      const colors = {};
      const assignments = {};
      result.servants.forEach(function(s) {
        if (s.color) colors[s.name] = s.color;
        (s.members || []).forEach(function(m) {
          if (m.id) assignments[m.id] = s.name;
        });
      });
      Storage.setServantColors(family, colors);
      Storage.setMemberAssignments(family, assignments);
    }
  } catch (e) {
    // Fall back to localStorage
  }

  const servants = Storage.getServants(family);
  const colors = Storage.getServantColors(family);

  if (!servants.length) {
    list.innerHTML = `<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:16px 0;">لا يوجد خدام مسجلون بعد — أضف أول خادم أدناه</p>`;
    return;
  }

  list.innerHTML = "";
  servants.forEach(function(name, idx) {
    const item = document.createElement("div");
    item.className = "servant-item";

    const servantColor = colors[name] || "";
    const colorIndicator = servantColor
      ? `<span class="servant-color-dot" style="background:${servantColor};display:inline-block;width:14px;height:14px;border-radius:50%;margin-left:8px;border:2px solid rgba(0,0,0,0.1);vertical-align:middle;"></span>`
      : "";

    item.innerHTML = `
      <div class="servant-item-main">
        <div class="servant-item-header">
          <span class="servant-name">${colorIndicator} ${name}</span>
          <button class="servant-delete-btn" data-idx="${idx}" title="حذف">🗑️</button>
        </div>
        <div class="servant-color-picker" data-servant="${name}">
          ${CONFIG.SERVANT_COLOR_PALETTE.map(function(c) {
            const selected = colors[name] === c ? "selected" : "";
            return `<span class="color-circle ${selected}" data-color="${c}" style="background:${c};"></span>`;
          }).join("")}
        </div>
        <div class="servant-actions">
          <button class="servant-assign-btn" data-servant="${name}">تعيين المخدومين</button>
          <button class="servant-swap-btn" data-servant="${name}">تبديل المخدومين</button>
        </div>
      </div>
    `;

    item.querySelector(".servant-delete-btn").addEventListener("click", async function() {
      if (!confirm(`هل تريد حذف "${name}" من قائمة الخدام؟`)) return;
      const updated = Storage.getServants(family).filter(function(_, i) { return i !== idx; });
      Storage.setServants(family, updated);
      const ass = Storage.getMemberAssignments(family);
      const changed = {};
      Object.keys(ass).forEach(function(mId) {
        if (ass[mId] === name) {
          changed[mId] = "";
        }
      });
      Object.assign(ass, changed);
      Storage.setMemberAssignments(family, ass);
      Object.keys(changed).forEach(function(mId) {
        Storage.updateMember(mId, { servantName: "", servantColor: "" });
        API.updateMemberServant(mId, family, "", "").catch(function() {});
      });
      const cols = Storage.getServantColors(family);
      delete cols[name];
      Storage.setServantColors(family, cols);
      await API.saveServantAssignments(family, ass, cols).catch(function() {});
      renderServantsList(family);
      showToast("تم حذف الخادم", "success");
    });

    item.querySelectorAll(".color-circle").forEach(function(circle) {
      circle.addEventListener("click", function() {
        const color = circle.dataset.color;
        const cols = Storage.getServantColors(family);
        const otherServants = servants.filter(function(s) { return s !== name; });
        const taken = otherServants.map(function(s) { return cols[s]; }).filter(Boolean);
        if (taken.includes(color)) {
          showToast("هذا اللون مستخدم بالفعل من قبل خادم آخر", "error");
          return;
        }
        cols[name] = color;
        Storage.setServantColors(family, cols);
        const ass = Storage.getMemberAssignments(family);
        API.saveServantAssignments(family, ass, cols).catch(function() {});
        Object.keys(ass).forEach(function(mId) {
          if (ass[mId] === name) {
            Storage.updateMember(mId, { servantColor: color });
            API.updateMemberServant(mId, family, name, color).catch(function() {});
          }
        });
        renderServantsList(family);
      });
    });

    item.querySelector(".servant-assign-btn").addEventListener("click", function() {
      openMemberAssignmentModal(family, name);
    });

    item.querySelector(".servant-swap-btn").addEventListener("click", function() {
      openSwapServantsModal(family, name);
    });

    list.appendChild(item);
  });
}

function getAvailableRandomColor(family, excludeServant) {
  const servants = Storage.getServants(family);
  const colors = Storage.getServantColors(family);
  const taken = servants.filter(function(s) { return s !== excludeServant; }).map(function(s) { return colors[s]; }).filter(Boolean);
  const available = CONFIG.SERVANT_COLOR_PALETTE.filter(function(c) { return !taken.includes(c); });
  if (available.length === 0) return CONFIG.SERVANT_COLOR_PALETTE[0];
  return available[Math.floor(Math.random() * available.length)];
}

function openMemberAssignmentModal(family, servantName) {
  let overlay = document.getElementById("modal-member-assignment");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "modal-member-assignment";
    document.body.appendChild(overlay);
  }

  const members = Storage.getMembers();
  const assignments = Storage.getMemberAssignments(family);
  const servants = Storage.getServants(family);
  const colors = Storage.getServantColors(family);

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-handle"></div>
      <button class="modal-close" id="btn-close-member-assignment" aria-label="إغلاق">✕</button>
      <h2 class="modal-title">مخدومو ${servantName}</h2>
      <p class="modal-subtitle">اختر المخدومين المسندين إلى ${servantName}</p>
      <div class="member-assignment-list" id="member-assignment-list">
        ${members.map(function(m) {
          const assignedTo = assignments[m.id];
          let statusHtml = "";
          if (assignedTo === servantName) {
            statusHtml = `<span class="assignment-check">✅</span>`;
          } else if (assignedTo && servants.includes(assignedTo)) {
            const sColor = colors[assignedTo] || "";
            statusHtml = `<span class="assignment-other" style="${sColor ? 'border-right:4px solid ' + sColor + ';' : ''}">${assignedTo}</span>`;
          } else {
            statusHtml = `<span class="assignment-empty">○</span>`;
          }
          return `<div class="member-assignment-row" data-member-id="${m.id}">
            <span class="assignment-name">${m.name}</span>
            ${statusHtml}
          </div>`;
        }).join("")}
      </div>
    </div>
  `;

  overlay.querySelector("#btn-close-member-assignment").addEventListener("click", function() {
    overlay.classList.remove("open");
  });
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) overlay.classList.remove("open");
  });

  overlay.querySelector("#member-assignment-list").addEventListener("click", function(e) {
    const row = e.target.closest(".member-assignment-row");
    if (!row) return;
    const memberId = row.dataset.memberId;
    const ass = Storage.getMemberAssignments(family);
    ass[memberId] = servantName;
    Storage.setMemberAssignments(family, ass);
    API.saveServantAssignments(family, ass, Storage.getServantColors(family)).catch(function() {});
    Storage.updateMember(memberId, { servantName: servantName, servantColor: Storage.getServantColors(family)[servantName] || "" });
    API.updateMemberServant(memberId, family, servantName, Storage.getServantColors(family)[servantName] || "").catch(function() {});
    openMemberAssignmentModal(family, servantName);
    UI.renderMembersList();
    showToast(`تم تعيين المخدوم`, "success", 1500);
  });

  requestAnimationFrame(function() {
    overlay.classList.add("open");
  });
}

function openSwapServantsModal(family, servantName) {
  const servants = Storage.getServants(family);
  const others = servants.filter(function(s) { return s !== servantName; });

  if (others.length === 0) {
    showToast("لا يوجد خدام آخرون للتبديل معهم", "error");
    return;
  }

  let overlay = document.getElementById("modal-swap-servants");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "modal-swap-servants";
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="modal modal-center">
      <button class="modal-close" id="btn-close-swap-servants" aria-label="إغلاق">✕</button>
      <h2 class="modal-title">تبديل المخدومين</h2>
      <p class="modal-subtitle">اختر الخادم لتبديل المخدومين مع ${servantName}</p>
      <div class="swap-servants-list">
        ${others.map(function(s) {
          return `<button class="swap-servant-btn" data-other="${s}">↔ ${s}</button>`;
        }).join("")}
      </div>
      <button class="btn btn-ghost mt-8" id="btn-cancel-swap">إلغاء</button>
    </div>
  `;

  overlay.querySelector("#btn-close-swap-servants").addEventListener("click", function() {
    overlay.classList.remove("open");
  });
  overlay.querySelector("#btn-cancel-swap").addEventListener("click", function() {
    overlay.classList.remove("open");
  });
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) overlay.classList.remove("open");
  });

  overlay.querySelectorAll(".swap-servant-btn").forEach(function(btn) {
    btn.addEventListener("click", async function() {
      const other = btn.dataset.other;
      if (!confirm(`هل تريد تبديل جميع المخدومين بين "${servantName}" و"${other}"؟`)) return;
      const ass = Storage.getMemberAssignments(family);
      const cols = Storage.getServantColors(family);
      const servantAMembers = [];
      const servantBMembers = [];
      Object.keys(ass).forEach(function(mId) {
        if (ass[mId] === servantName) servantAMembers.push(mId);
        if (ass[mId] === other) servantBMembers.push(mId);
      });
      servantAMembers.forEach(function(mId) { ass[mId] = other; });
      servantBMembers.forEach(function(mId) { ass[mId] = servantName; });
      Storage.setMemberAssignments(family, ass);
      // Update each affected member on the server
      servantAMembers.forEach(function(mId) {
        Storage.updateMember(mId, { servantName: other, servantColor: cols[other] || "" });
        API.updateMemberServant(mId, family, other, cols[other] || "").catch(function() {});
      });
      servantBMembers.forEach(function(mId) {
        Storage.updateMember(mId, { servantName: servantName, servantColor: cols[servantName] || "" });
        API.updateMemberServant(mId, family, servantName, cols[servantName] || "").catch(function() {});
      });
      await API.saveServantAssignments(family, ass, cols).catch(function() {});
      overlay.classList.remove("open");
      UI.renderMembersList();
      showToast("تم التبديل بنجاح", "success");
    });
  });

  requestAnimationFrame(function() {
    overlay.classList.add("open");
  });
}

async function exportAttendanceToExcel(date, family) {
  if (!date) {
    showToast("لم يتم تحديد تاريخ", "error");
    return;
  }

  const btn = document.getElementById("btn-export-excel");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳";
  }

  try {
    const result = await API.getAttendanceForExport(date, family);

    if (!result.success) {
      showToast("فشل في جلب البيانات", "error");
      return;
    }

    if (!result.rows || result.rows.length === 0) {
      showToast("لا يوجد حضور مسجل لهذا اليوم", "");
      return;
    }

    // Build CSV content with BOM for Arabic support in Excel
    const BOM = "\uFEFF";
    const headers = result.headers.join(",");
    const rowLines = result.rows.map(function(row) {
      return row.map(function(cell) {
        var val = String(cell).replace(/"/g, '""');
        return '"' + val + '"';
      }).join(",");
    });

    const csvContent = BOM + headers + "\n" + rowLines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    // Format date for filename: DD-MM-YYYY
    var parts = date.split("-");
    var fileDate = parts[2] + "-" + parts[1] + "-" + parts[0];
    var fileName = "حضور_" + fileDate + ".csv";

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast("✅ تم تحميل ملف الحضور", "success");

  } catch (e) {
    showToast("خطأ في التصدير", "error");
    console.error("Export error:", e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "📥";
    }
  }
}

/**
 * Shared helper: fetch GPS location for a member, reverse-geocode,
 * save to Storage & backend, then call onUpdate(coords, displayName).
 * @param {string} memberId
 * @param {function} onUpdate  callback(coords, displayName)
 */
function handleGetLocationForMember(memberId, onUpdate) {
  if (!navigator.geolocation) {
    showToast("خدمة تحديد الموقع غير متوفرة", "error");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      var lat = pos.coords.latitude;
      var lng = pos.coords.longitude;
      var coords = lat + "," + lng;
      var members = Storage.getMembers();
      var idx = members.findIndex(function(m) { return m.id === memberId; });
      if (idx === -1) return;
      members[idx].homeLocation = coords;
      members[idx].homeLocationName = coords;
      Storage.setMembers(members);
      if (onUpdate) onUpdate(coords, coords);
      showToast("جارٍ الحصول على العنوان...", "", 2000);
      fetch("https://nominatim.openstreetmap.org/reverse?format=json&lat=" + lat + "&lon=" + lng + "&accept-language=ar", {
        headers: { "User-Agent": "SundayApp/1.0" }
      }).then(function(r) { return r.json(); }).then(function(data) {
        var addr = data && data.display_name ? data.display_name : coords;
        members = Storage.getMembers();
        idx = members.findIndex(function(m) { return m.id === memberId; });
        if (idx === -1) return;
        members[idx].homeLocationName = addr;
        Storage.setMembers(members);
        if (onUpdate) onUpdate(coords, addr);
        showToast("تم حفظ الموقع ✅", "success");
      }).catch(function() {
        if (onUpdate) onUpdate(coords, coords);
        showToast("تم حفظ الموقع ✅", "success");
      });
      API.updateMember({
        memberId: memberId,
        name: members[idx].name,
        phone: members[idx].phone,
        parentPhone: members[idx].parentPhone,
        notes: members[idx].notes,
        homeLocation: coords,
        homeLocationName: members[idx].homeLocationName
      }).catch(function() {});
    },
    function() {
      showToast("فشل في الحصول على الموقع", "error");
    }
  );
}

function showMemberDetailsModal(member, selectedDate) {
  const existing = document.getElementById("modal-member-details");
  if (existing) existing.remove();

  const memberId = member.id;
  const age = calculateAge(member.dob);
  const ageText = age > 0 ? `${toArabicNumerals(age)} سنة` : "—";
  const attendance = Storage.getAttendanceForDate(selectedDate);
  const status = attendance[memberId];
  const statusText = status === "present" ? "✅ حاضر" : status === "absent" ? "❌ غائب" : "—";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay modal-member-details";
  overlay.id = "modal-member-details";

  const modal = document.createElement("div");
  modal.className = "modal modal-center";

  const fmtPhone = (p) => "https://wa.me/20" + String(p);
  const homeLoc = member.homeLocation || "";
  const hasHomeLoc = !!homeLoc;

  function buildDailyNoteHtml(value) {
    var display = value || "—";
    return '<span class="member-detail-value">' + display + '</span>' +
           '<button class="detail-edit-btn" data-field="dailyNote">✏️</button>';
  }

  function displayValueHtml(field, value) {
    const display = value || "—";
    const isHome = field === "homeLocation";
    let extra = "";
    if (isHome) {
      var cur = getCurrentMember();
      var coords = cur && cur.homeLocation ? cur.homeLocation : value;
      if (coords) {
        var displayName = (cur && cur.homeLocationName) ? cur.homeLocationName : coords;
        extra = '<a href="https://www.google.com/maps?q=' + coords + '" target="_blank" class="detail-map-btn">🗺️</a>';
        return '<span class="member-detail-value">' + displayName + '</span>' +
               '<button class="detail-edit-btn" data-field="' + field + '">✏️</button>' + extra;
      } else {
        extra = '<button class="detail-loc-btn">📍</button>';
      }
    }
    return '<span class="member-detail-value">' + display + '</span>' +
           '<button class="detail-edit-btn" data-field="' + field + '">✏️</button>' + extra;
  }

  function getCurrentMember() {
    const members = Storage.getMembers();
    return members.find(function(m) { return m.id === memberId; });
  }

  modal.innerHTML = `
    <button class="modal-close" id="btn-close-member-details">✕</button>
    <div class="modal-title" style="text-align:center;">${member.name}</div>
    <div class="modal-subtitle" style="text-align:center;">تفاصيل المخدوم</div>
    <div class="member-details-content">
      <div class="member-detail-row" data-field="name">
        <span class="member-detail-label">الاسم</span>
        <span class="member-detail-value-wrap">${displayValueHtml("name", member.name)}</span>
      </div>
      <div class="member-detail-row" data-field="phone">
        <span class="member-detail-label">التليفون</span>
        <span class="member-detail-value-wrap">${displayValueHtml("phone", member.phone)}</span>
      </div>
      ${member.phone ? `
      <div class="member-detail-actions">
        <a href="tel:${member.phone}" class="member-action-btn call-btn">📞 اتصال</a>
        <a href="${fmtPhone(member.phone)}" target="_blank" class="member-action-btn whatsapp-btn">💬 واتساب</a>
      </div>` : ""}
      <div class="member-detail-row" data-field="parentPhone">
        <span class="member-detail-label">تليفون ولي الأمر</span>
        <span class="member-detail-value-wrap">${displayValueHtml("parentPhone", member.parentPhone)}</span>
      </div>
      ${member.parentPhone ? `
      <div class="member-detail-actions">
        <a href="tel:${member.parentPhone}" class="member-action-btn call-btn">📞 اتصال بولي الأمر</a>
        <a href="${fmtPhone(member.parentPhone)}" target="_blank" class="member-action-btn whatsapp-btn">💬 واتساب ولي الأمر</a>
      </div>` : ""}
      <div class="member-detail-row" data-field="homeLocation">
        <span class="member-detail-label">مكان المنزل</span>
        <span class="member-detail-value-wrap">${displayValueHtml("homeLocation", homeLoc)}</span>
      </div>
      <div class="member-detail-row" data-field="dailyNote">
        <span class="member-detail-label">ملاحظة اليوم</span>
        <span class="member-detail-value-wrap">${buildDailyNoteHtml(Storage.getDailyNote(memberId, selectedDate))}</span>
      </div>
      <div class="member-detail-row" data-field="notes">
        <span class="member-detail-label">ملاحظات عامة</span>
        <span class="member-detail-value-wrap">${displayValueHtml("notes", member.notes)}</span>
      </div>
      <div class="member-detail-row">
        <span class="member-detail-label">حالة الحضور</span>
        <span class="member-detail-value">${statusText}</span>
      </div>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.querySelector("#btn-close-member-details").addEventListener("click", closeModal);
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) closeModal();
  });

  function closeModal() {
    overlay.classList.remove("open");
    setTimeout(function() { overlay.remove(); }, 350);
  }

  // Event delegation on content area
  var content = modal.querySelector(".member-details-content");

  content.addEventListener("click", function(e) {
    var editBtn = e.target.closest(".detail-edit-btn");
    if (editBtn) {
      e.preventDefault();
      var field = editBtn.dataset.field;
      var row = editBtn.closest(".member-detail-row");
      var valueEl = row.querySelector(".member-detail-value");
      var currentValue = valueEl.textContent === "—" ? "" : valueEl.textContent;
      var wrap = row.querySelector(".member-detail-value-wrap");
      wrap.innerHTML =
        '<div class="detail-edit-inline">' +
          '<input class="detail-edit-input" type="text" value="' + currentValue.replace(/"/g, "&quot;") + '" />' +
          '<button class="detail-save-btn">✅</button>' +
          '<button class="detail-cancel-btn">❌</button>' +
          '</div>';
      wrap.querySelector(".detail-edit-input").focus();
      return;
    }

    var locBtn = e.target.closest(".detail-loc-btn");
    if (locBtn) {
      var row = locBtn.closest(".member-detail-row");
      var wrap = row.querySelector(".member-detail-value-wrap");
      handleGetLocationForMember(memberId, function(coords, displayName) {
        wrap.innerHTML = displayValueHtml("homeLocation", coords);
      });
      return;
    }

    var saveBtn = e.target.closest(".detail-save-btn");
    if (saveBtn) {
      var row = saveBtn.closest(".member-detail-row");
      var field = row.dataset.field;
      var input = row.querySelector(".detail-edit-input");
      var newValue = input ? input.value.trim() : "";

      if (field === "dailyNote") {
        // 1. Save locally
        Storage.setDailyNote(memberId, selectedDate, newValue);

        // 2. Update UI
        var wrap = row.querySelector(".member-detail-value-wrap");
        wrap.innerHTML = buildDailyNoteHtml(newValue);

        // 3. Send to Google Sheets via API
        var currentMember = getCurrentMember();
        var memberNameForApi = currentMember ? currentMember.name : "";
        var familyForApi = Storage.getFamily();

        if (navigator.onLine) {
          API.saveDailyNote(memberId, memberNameForApi, familyForApi, selectedDate, newValue)
            .then(function(result) {
              if (result.success) {
                showToast("✅ تم حفظ ملاحظة اليوم", "success", 2000);
              } else {
                showToast("⚠️ تم الحفظ محلياً فقط", "", 2500);
              }
            })
            .catch(function() {
              showToast("⚠️ تم الحفظ محلياً فقط", "", 2500);
            });
        } else {
          showToast("📴 تم الحفظ محلياً — سيُرسل عند اتصال الإنترنت", "", 2500);
        }

        return;
      }

      var members = Storage.getMembers();
      var idx = members.findIndex(function(m) { return m.id === memberId; });
      if (idx === -1) return;
      members[idx][field] = newValue;
      Storage.setMembers(members);
      var wrap = row.querySelector(".member-detail-value-wrap");
      wrap.innerHTML = displayValueHtml(field, newValue);
      if (field === "name") {
        modal.querySelector(".modal-title").textContent = newValue || member.name;
      }
      API.updateMember({
        memberId: memberId,
        name: members[idx].name,
        phone: members[idx].phone,
        parentPhone: members[idx].parentPhone,
        notes: members[idx].notes,
        homeLocation: members[idx].homeLocation,
        homeLocationName: members[idx].homeLocationName
      }).catch(function() {});
      return;
    }

    var cancelBtn = e.target.closest(".detail-cancel-btn");
    if (cancelBtn) {
      var row = cancelBtn.closest(".member-detail-row");
      var field = row.dataset.field;
      var wrap = row.querySelector(".member-detail-value-wrap");

      if (field === "dailyNote") {
        var val = Storage.getDailyNote(memberId, selectedDate);
        wrap.innerHTML = buildDailyNoteHtml(val);
        return;
      }

      var cur = getCurrentMember();
      var val = cur ? cur[field] : "";
      wrap.innerHTML = displayValueHtml(field, val);
      return;
    }
  });

  requestAnimationFrame(function() { overlay.classList.add("open"); });
}

/* =====================================================
   MAIN APP OBJECT
===================================================== */

const App = {
  currentScreen: "welcome",
  selectedDate: toDateString(new Date()),
  selectedFamily: null,
  adminFamilies: [...CONFIG.FAMILIES],
  adminPasswords: {},
  familyStages: {},
  _stageView: false,
  _toastTimer: null,
  _refreshInterval: null,

  /**
   * Initialize the application.
   */
  init() {
    // Register service worker
    App.registerServiceWorker();

    // Set up online/offline detection
    App.setupNetworkDetection();

    // Set up event listeners
    App.setupEventListeners();

    // Render families grid
    UI.renderFamiliesGrid();

    // Load cached families immediately for instant display
    var cached = Storage.getCachedFamilies();
    if (cached.length > 0) {
      CONFIG.FAMILIES = cached;
      UI.renderFamiliesGrid();
    }

    // Load families dynamically from Google if configured
    if (CONFIG.GOOGLE_SCRIPT_URL && CONFIG.GOOGLE_SCRIPT_URL !== "YOUR_DEPLOYED_APPS_SCRIPT_URL_HERE") {
      API.getFamilies().then(result => {
        if (result.success && result.families && result.families.length > 0) {
          // Support both old string[] and new {name,stage}[] formats
          const familyNames = result.families.map(f => typeof f === "object" ? f.name : f);
          CONFIG.FAMILIES = familyNames;
          App.adminFamilies = [...familyNames];
          Storage.setCachedFamilies(familyNames);
          // Also load stages from getFamilyStages
          result.families.forEach(f => {
            if (typeof f === "object" && f.name) {
              App.familyStages[f.name] = f.stage || "";
            }
          });
          UI.renderFamiliesGrid();
        }
      }).catch(() => {
        // Cached families already loaded above; nothing more to do
      });
    }

    // Populate month filter
    UI.populateMonthFilter();

    // Update date strip
    UI.renderDateStrip();

    // Check if already authenticated
    const savedFamily = Storage.getFamily();
    if (savedFamily) {
      App.enterAttendanceDashboard(savedFamily);
    } else {
      navigateTo("welcome");
    }

    // Init notifications
    Notifications.init();

    // Update queue badges
    UI.updateQueueCountBadges();

    // Update last sync display
    const lastSync = Storage.getLastSync();
    const el = document.getElementById("settings-last-sync-time");
    if (el) {
      el.textContent = lastSync ? new Date(lastSync).toLocaleString("ar-EG") : "لم تتم المزامنة بعد";
    }

    // Update notification status display
    const notifStatus = document.getElementById("settings-notif-status");
    if (notifStatus) {
      const perm = Notification.permission;
      notifStatus.textContent = perm === "granted" ? "مفعّل ✅" : perm === "denied" ? "ممنوع ❌" : "غير محدد";
    }

    // Dynamic version text rendering
    const versionTextEl = document.getElementById("app-version-text");
    if (versionTextEl) {
      versionTextEl.textContent = `${CONFIG.APP_VERSION} — خدمة الأحد`;
    }

    // Check for version updates
    App.checkForUpdates();
  },

  /**
   * Register the PWA service worker.
   */
  registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js").then((reg) => {
        console.log("Service Worker registered:", reg.scope);

        // Check for updates periodically (every 1 hour)
        setInterval(() => {
          if (navigator.onLine) {
            reg.update().catch(() => {});
          }
        }, 60 * 60 * 1000);

        // Check if there is an update waiting already on load
        if (reg.waiting) {
          App.showUpdatePrompt();
        }

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                App.showUpdatePrompt();
              }
            });
          }
        });
      }).catch((err) => {
        console.warn("Service Worker registration failed:", err);
      });

      // Reload page when the new Service Worker takes over
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    }
  },

  /**
   * Check if a newer version is deployed on the server.
   */
  checkForUpdates() {
    if (!navigator.onLine) return;
    fetch(`/version.json?t=${Date.now()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Network response error");
        return res.json();
      })
      .then((data) => {
        if (data && data.version && data.version !== CONFIG.APP_VERSION) {
          console.log(`[PWA Update] New version detected: ${data.version} (Current: ${CONFIG.APP_VERSION})`);
          App.showUpdatePrompt(data.version);
        }
      })
      .catch((err) => {
        console.warn("[PWA Update] Failed to check for version updates:", err);
      });
  },

  /**
   * Show a non-obtrusive, styled bottom prompt for updating the application.
   */
  showUpdatePrompt(newVersion = "") {
    if (document.getElementById("update-prompt-banner")) return;

    const banner = document.createElement("div");
    banner.id = "update-prompt-banner";
    banner.style.position = "fixed";
    banner.style.bottom = "80px";
    banner.style.left = "16px";
    banner.style.right = "16px";
    banner.style.background = "var(--primary)";
    banner.style.color = "white";
    banner.style.padding = "14px 18px";
    banner.style.borderRadius = "var(--radius-md)";
    banner.style.boxShadow = "var(--shadow-lg)";
    banner.style.display = "flex";
    banner.style.justifyContent = "space-between";
    banner.style.alignItems = "center";
    banner.style.zIndex = "1000";
    banner.style.direction = "rtl";

    const verStr = newVersion ? ` (${newVersion})` : "";
    banner.innerHTML = `
      <div style="font-family: var(--font); font-size: 13px; font-weight: 600;">
        📢 تحديث جديد متاح للتطبيق${verStr}! اضغط للتحديث الآن.
      </div>
      <button id="btn-update-app" class="btn btn-sm" style="background: white; color: var(--primary); font-weight: 800; border: none; padding: 6px 14px; border-radius: var(--radius-sm); cursor: pointer; font-family: var(--font); flex-shrink: 0; margin-right: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">تحديث</button>
    `;

    document.body.appendChild(banner);

    document.getElementById("btn-update-app").addEventListener("click", () => {
      const btn = document.getElementById("btn-update-app");
      btn.disabled = true;
      btn.textContent = "جاري...";
      
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistration().then((reg) => {
          if (reg && reg.waiting) {
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
          } else if (reg) {
            reg.update().then(() => {
              if (reg.waiting) {
                reg.waiting.postMessage({ type: "SKIP_WAITING" });
              } else {
                window.location.reload(true);
              }
            }).catch(() => {
              window.location.reload(true);
            });
          } else {
            window.location.reload(true);
          }
        }).catch(() => {
          window.location.reload(true);
        });
      } else {
        window.location.reload(true);
      }
    });
  },

  /**
   * Set up network status detection and auto-sync.
   */
  setupNetworkDetection() {
    const banner = document.getElementById("offline-banner");

    const updateOnlineStatus = () => {
      if (!navigator.onLine) {
        banner.classList.add("visible");
        document.body.style.paddingTop = "42px";
      } else {
        banner.classList.remove("visible");
        document.body.style.paddingTop = "";
        // Auto-sync when back online
        const queue = Storage.getOfflineQueue();
        if (queue.length > 0) {
          setTimeout(() => {
            SyncEngine.flush().then(({ succeeded, failed }) => {
              if (succeeded > 0) {
                showToast(`✅ تمت مزامنة ${toArabicNumerals(succeeded)} عنصر بنجاح`, "success");
                UI.updateQueueCountBadges();
              }
              if (failed > 0) {
                showToast(`⚠️ فشل في مزامنة ${toArabicNumerals(failed)} عنصر`, "error");
              }
            });
          }, 1500);
        }
      }
    };

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    updateOnlineStatus();
  },

  /**
   * Attach all DOM event listeners.
   */
  setupEventListeners() {
    // Welcome screen
    document.getElementById("btn-start").addEventListener("click", () => {
      navigateTo("families");
    });

    document.getElementById("btn-families-back").addEventListener("click", () => {
      navigateTo("welcome");
    });

    document.getElementById("btn-admin-link").addEventListener("click", () => {
      App.openAdminCodeModal();
    });

    // Notification banner
    document.getElementById("btn-allow-notif").addEventListener("click", () => {
      Notifications.requestPermission();
    });

    document.getElementById("btn-deny-notif").addEventListener("click", () => {
      Notifications.dismiss();
    });

    // Family password modal
    document.getElementById("btn-verify-family").addEventListener("click", () => {
      App.submitFamilyPassword();
    });

    document.getElementById("input-family-password").addEventListener("keydown", (e) => {
      if (e.key === "Enter") App.submitFamilyPassword();
    });

    document.getElementById("btn-cancel-family").addEventListener("click", () => {
      closeModal("modal-family-password");
      App.selectedFamily = null;
    });

    // Admin code modal
    document.getElementById("btn-verify-admin").addEventListener("click", () => {
      App.submitAdminCode();
    });

    document.getElementById("input-admin-code").addEventListener("keydown", (e) => {
      if (e.key === "Enter") App.submitAdminCode();
    });

    document.getElementById("btn-cancel-admin").addEventListener("click", () => {
      closeModal("modal-admin-code");
    });

    // Logout buttons
    document.getElementById("btn-logout").addEventListener("click", () => {
      App.logout();
    });

    document.getElementById("settings-logout").addEventListener("click", () => {
      App.logout();
    });

    // Registration form
    document.getElementById("btn-add-member").addEventListener("click", () => {
      openModal("modal-registration");
    });

    document.getElementById("btn-close-registration").addEventListener("click", () => {
      closeModal("modal-registration");
    });

    document.getElementById("registration-form").addEventListener("submit", (e) => {
      e.preventDefault();
      App.submitRegistration();
    });

    // Bottom navigation tabs
    document.querySelectorAll(".nav-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const panel = tab.dataset.panel;
        App.switchTab(panel);

        if (panel === "analytics") {
          App.loadAnalytics();
        }
        if (panel === "settings") {
          UI.updateQueueCountBadges();
        }
        if (panel === "visitation") {
          renderVisitationPanel(Storage.getFamily());
        }
      });
    });

    // Settings sync
    document.getElementById("settings-sync").addEventListener("click", async () => {
      const queue = Storage.getOfflineQueue();
      if (!queue.length) {
        showToast("لا توجد عناصر في قائمة الانتظار");
        return;
      }
      if (!navigator.onLine) {
        showToast("أنت غير متصل بالإنترنت", "error");
        return;
      }
      setLoading(true, "جارٍ المزامنة...");
      const result = await SyncEngine.flush();
      setLoading(false);
      if (result.succeeded > 0) {
        showToast(`✅ تمت مزامنة ${toArabicNumerals(result.succeeded)} عنصر`, "success");
      } else {
        showToast("لم تتم المزامنة", "error");
      }
      UI.updateQueueCountBadges();
    });

    // Settings: refresh members from server
    document.getElementById("settings-refresh-members").addEventListener("click", async () => {
      if (!navigator.onLine) {
        showToast("أنت غير متصل بالإنترنت", "error");
        return;
      }
      const family = Storage.getFamily();
      if (!family) {
        showToast("لم يتم تحديد الأسرة", "error");
        return;
      }
      setLoading(true, "جاري تحديث بيانات المخدومين...");
      try {
        const result = await API.refreshMembers(family);
        if (result && result.success && result.members) {
          Storage.setMembers(result.members);
          UI.renderMembersList();
          showToast("✅ تم تحديث بيانات المخدومين", "success");
        } else {
          showToast("فشل تحديث البيانات، حاول مرة أخرى", "error");
        }
      } catch (e) {
        showToast("فشل تحديث البيانات، حاول مرة أخرى", "error");
      } finally {
        setLoading(false);
      }
    });

    // Settings notification
    document.getElementById("settings-notif").addEventListener("click", () => {
      if (Notification.permission === "default") {
        Notifications.requestPermission();
      } else {
        showToast(Notification.permission === "granted" ? "الإشعارات مفعّلة بالفعل ✅" : "الإشعارات ممنوعة في إعدادات المتصفح");
      }
    });

    // Servants modal
    document.getElementById("settings-servants").addEventListener("click", () => {
      const family = Storage.getFamily();
      const subtitle = document.getElementById("servants-modal-subtitle");
      if (subtitle) subtitle.textContent = `الخدام المسجلون في ${family}`;
      renderServantsList(family);
      const input = document.getElementById("servant-name-input");
      const error = document.getElementById("servant-name-error");
      if (input) input.value = "";
      if (error) error.classList.remove("visible");
      openModal("modal-servants");
    });

    document.getElementById("btn-close-servants").addEventListener("click", () => {
      closeModal("modal-servants");
    });

    document.getElementById("btn-save-servant").addEventListener("click", async () => {
      const input = document.getElementById("servant-name-input");
      const error = document.getElementById("servant-name-error");
      const name = input.value.trim();

      if (!name) {
        input.classList.add("error");
        error.classList.add("visible");
        return;
      }

      input.classList.remove("error");
      error.classList.remove("visible");

      const family = Storage.getFamily();
      const servants = Storage.getServants(family);

      if (servants.includes(name)) {
        showToast("هذا الخادم مسجل بالفعل", "error");
        return;
      }

      const btn = document.getElementById("btn-save-servant");
      btn.disabled = true;
      btn.classList.add("btn-loading");

      servants.push(name);
      Storage.setServants(family, servants);

      const servantColors = Storage.getServantColors(family);
      if (!servantColors[name]) {
        servantColors[name] = getAvailableRandomColor(family, name);
        Storage.setServantColors(family, servantColors);
      }

      try {
        const ass = Storage.getMemberAssignments(family);
        await API.saveServantAssignments(family, ass, servantColors).catch(function() {});
        showToast(`✅ تم إضافة ${name}`, "success");
      } catch (e) {
        showToast("تم الحفظ محلياً", "");
      } finally {
        btn.disabled = false;
        btn.classList.remove("btn-loading");
      }

      input.value = "";
      renderServantsList(family);
    });

    // Close servants modal on overlay click
    document.getElementById("modal-servants").addEventListener("click", (e) => {
      if (e.target === document.getElementById("modal-servants")) {
        closeModal("modal-servants");
      }
    });

    // Export attendance to Excel
    document.getElementById("btn-export-excel").addEventListener("click", () => {
      const date = App.selectedDate || toDateString(new Date());
      const family = Storage.getFamily();
      exportAttendanceToExcel(date, family);
    });

    // Month filter for analytics
    document.getElementById("filter-month").addEventListener("change", () => {
      App.loadAnalytics();
    });

    // Admin panel back button
    document.getElementById("btn-admin-back").addEventListener("click", () => {
      navigateTo("welcome");
    });

    // Admin: absentees check
    document.getElementById("btn-check-absentees").addEventListener("click", async () => {
      const threshold = parseInt(document.getElementById("absence-threshold").value) || CONFIG.ABSENCE_THRESHOLD;
      setLoading(true, "جارٍ تحميل قائمة الغائبين...");
      try {
        const result = await API.getAbsentees(threshold);
        UI.renderAbsenteesList(result.members || []);
      } catch (e) {
        showToast("فشل في تحميل القائمة", "error");
      } finally {
        setLoading(false);
      }
    });

    // Admin: manual sync
    document.getElementById("btn-manual-sync").addEventListener("click", async () => {
      const queue = Storage.getOfflineQueue();
      const syncResults = document.getElementById("sync-results");
      if (!queue.length) {
        syncResults.innerHTML = `<p style="font-size:13px;color:var(--success);font-weight:600;padding:8px 0;">✅ لا توجد عناصر معلقة</p>`;
        return;
      }
      if (!navigator.onLine) {
        showToast("أنت غير متصل بالإنترنت", "error");
        return;
      }
      setLoading(true, "جارٍ المزامنة...");
      const result = await SyncEngine.flush();
      setLoading(false);

      syncResults.innerHTML = "";
      if (result.results && result.results.length) {
        result.results.forEach((r) => {
          const el = document.createElement("div");
          el.className = `sync-result-item ${r.success ? "ok" : "fail"}`;
          el.textContent = r.success ? `✅ تمت مزامنة العنصر بنجاح` : `❌ فشل في مزامنة العنصر`;
          syncResults.appendChild(el);
        });
      } else {
        syncResults.innerHTML = `<p style="font-size:13px;color:var(--danger);font-weight:600;">فشلت المزامنة — يرجى المحاولة مرة أخرى</p>`;
      }

      UI.updateQueueCountBadges();
    });

    // Admin: open sheet
    document.getElementById("btn-open-sheet").addEventListener("click", () => {
      window.open(CONFIG.SHEET_URL, "_blank");
    });

    // Admin: show add family form
    document.getElementById("btn-show-add-family").addEventListener("click", () => {
      const form = document.getElementById("add-family-form");
      form.classList.toggle("visible");
    });

    // Admin: save new family
    document.getElementById("btn-save-new-family").addEventListener("click", async () => {
      App.admin.saveNewFamily();
    });

    // Admin: edit family modal
    document.getElementById("btn-save-edit-family").addEventListener("click", async () => {
      App.admin.saveEditFamily();
    });

    document.getElementById("btn-cancel-edit-family").addEventListener("click", () => {
      closeModal("modal-edit-family");
    });

    // Close modals on overlay click
    ["modal-family-password", "modal-admin-code", "modal-registration", "modal-edit-family"].forEach((id) => {
      const overlay = document.getElementById(id);
      if (overlay) {
        overlay.addEventListener("click", (e) => {
          if (e.target === overlay) {
            closeModal(id);
          }
        });
      }
    });

    // Face Recognition inputs file change feedback
    const addPhotosInput = document.getElementById("face-person-photos");
    if (addPhotosInput) {
      addPhotosInput.addEventListener("change", () => {
        const feedback = document.getElementById("face-person-photos-feedback");
        if (feedback) {
          const count = addPhotosInput.files.length;
          feedback.textContent = count > 0 ? `تم اختيار عدد ${toArabicNumerals(count)} صور` : "لم يتم اختيار أي صور";
        }
      });
    }

    const groupPhotoInput = document.getElementById("face-group-photo");
    if (groupPhotoInput) {
      groupPhotoInput.addEventListener("change", () => {
        const feedback = document.getElementById("face-group-photo-feedback");
        if (feedback) {
          const count = groupPhotoInput.files.length;
          feedback.textContent = count > 0 ? "تم اختيار الصورة بنجاح" : "لم يتم اختيار أي صورة";
        }
      });
    }

    // btn-add-face-person click
    const btnAddFacePerson = document.getElementById("btn-add-face-person");
    if (btnAddFacePerson) {
      btnAddFacePerson.addEventListener("click", async () => {
        const nameInput = document.getElementById("face-person-name");
        const name = nameInput.value.trim();
        const photos = addPhotosInput ? addPhotosInput.files : [];

        if (!name) {
          showToast("يرجى إدخال اسم المخدوم", "error");
          nameInput.focus();
          return;
        }

        if (photos.length === 0) {
          showToast("يرجى اختيار صورة واحدة على الأقل", "error");
          return;
        }

        btnAddFacePerson.disabled = true;
        btnAddFacePerson.classList.add("btn-loading");

        try {
          const resultArea = document.getElementById("face-add-result");
          if (resultArea) resultArea.innerHTML = "";

          await FaceAPI.addPerson(name, photos);
          
          // Clear inputs on success
          nameInput.value = "";
          if (addPhotosInput) addPhotosInput.value = "";
          const feedback = document.getElementById("face-person-photos-feedback");
          if (feedback) feedback.textContent = "لم يتم اختيار أي صور";
          
          if (resultArea) {
            resultArea.innerHTML = `<div class="face-result-item" style="background: var(--success-light); border-color: rgba(76,175,80,0.2); color: #2e7d32;">
              <span>تم تسجيل "${name}" بنجاح للتعرف بالوجه!</span>
              <span class="icon">✅</span>
            </div>`;
          }
        } catch (err) {
          const resultArea = document.getElementById("face-add-result");
          if (resultArea) {
            resultArea.innerHTML = `<div class="face-result-item" style="background: var(--danger-light); border-color: rgba(255,82,82,0.2); color: #c62828;">
              <span>فشل تسجيل المخدوم في النظام.</span>
              <span class="icon">❌</span>
            </div>`;
          }
        } finally {
          btnAddFacePerson.disabled = false;
          btnAddFacePerson.classList.remove("btn-loading");
        }
      });
    }

    // btn-recognize-faces click
    const btnRecognizeFaces = document.getElementById("btn-recognize-faces");
    if (btnRecognizeFaces) {
      btnRecognizeFaces.addEventListener("click", async () => {
        const photo = groupPhotoInput && groupPhotoInput.files.length > 0 ? groupPhotoInput.files[0] : null;

        if (!photo) {
          showToast("يرجى اختيار الصورة الجماعية أولاً", "error");
          return;
        }

        btnRecognizeFaces.disabled = true;
        btnRecognizeFaces.classList.add("btn-loading");

        try {
          await FaceAPI.recognize(photo);
        } catch (err) {
          // Error is handled in API
        } finally {
          btnRecognizeFaces.disabled = false;
          btnRecognizeFaces.classList.remove("btn-loading");
        }
      });
    }
  },

  /**
   * Switch bottom-nav tab.
   * @param {string} panelName
   */
  switchTab(panelName) {
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));

    const panel = document.getElementById(`panel-${panelName}`);
    const tab = document.getElementById(`nav-${panelName}`);
    if (panel) panel.classList.add("active");
    if (tab) tab.classList.add("active");

    // Show/hide FAB
    const fab = document.getElementById("btn-add-member");
    if (fab) fab.style.display = panelName === "attendance" ? "flex" : "none";

    // Populate face recognition person select
    if (panelName === "recognition") {
      populateFacePersonSelect();
    }
  },

  /**
   * Handle family card tap.
   * @param {string} familyName
   */
  onFamilyCardClick(familyName) {
    App.selectedFamily = familyName;
    const icon = document.getElementById("modal-family-icon");
    const title = document.getElementById("modal-family-title");
    const subtitle = document.getElementById("modal-family-subtitle");
    const input = document.getElementById("input-family-password");
    const error = document.getElementById("family-password-error");

    if (icon) icon.textContent = ["⛪", "❤️", "🕊️", "✝️", "✨", "🎄"][CONFIG.FAMILIES.indexOf(familyName) % 6];
    if (title) title.textContent = familyName;
    if (subtitle) subtitle.textContent = "أدخل كلمة المرور للدخول";
    if (input) input.value = "";
    if (error) error.classList.remove("visible");

    openModal("modal-family-password");
    setTimeout(() => {
      if (input) input.focus();
    }, 400);
  },

  /**
   * Submit family password for verification.
   */
  async submitFamilyPassword() {
    const input = document.getElementById("input-family-password");
    const error = document.getElementById("family-password-error");
    const btn = document.getElementById("btn-verify-family");
    const password = input.value.trim();

    if (!password) {
      input.classList.add("error");
      error.textContent = "يرجى إدخال كلمة المرور";
      error.classList.add("visible");
      return;
    }

    btn.disabled = true;
    btn.classList.add("btn-loading");
    input.classList.remove("error");
    error.classList.remove("visible");

    try {
      const result = await API.verifyFamily(App.selectedFamily, password);

      if (result.success) {
        Storage.setFamily(App.selectedFamily);
        Storage.setMembers(result.members || []);
        // Merge servant data from server into localStorage
        var members = Storage.getMembers();
        var ass = Storage.getMemberAssignments(App.selectedFamily);
        var cols = Storage.getServantColors(App.selectedFamily);
        var changed = false;
        members.forEach(function(m) {
          if (m.servantName && !ass[m.id]) {
            ass[m.id] = m.servantName;
            changed = true;
          }
          if (m.servantColor && m.servantName && (!cols[m.servantName] || cols[m.servantName] !== m.servantColor)) {
            cols[m.servantName] = m.servantColor;
            changed = true;
          }
        });
        if (changed) {
          Storage.setMemberAssignments(App.selectedFamily, ass);
          Storage.setServantColors(App.selectedFamily, cols);
        }
        closeModal("modal-family-password");
        App.enterAttendanceDashboard(App.selectedFamily);
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        try {
          const attResult = await API.getAttendanceForDate(App.selectedFamily, todayStr);
          if (attResult && attResult.attendance) {
            Object.entries(attResult.attendance).forEach(([memberId, entry]) => {
              const status = entry.status;
              if (status) {
                Storage.markAttendanceLocally(memberId, status, todayStr);
              }
              if (entry.dailyNote) {
                Storage.setDailyNote(memberId, todayStr, entry.dailyNote);
              }
            });
          }
        } catch (_) {
          // Silently ignore — local attendance will be empty
        }
        UI.renderMembersList();
        populateFacePersonSelect();
      } else {
        input.classList.add("error");
        error.textContent = "كلمة المرور غير صحيحة، يرجى المحاولة مرة أخرى";
        error.classList.add("visible");
        input.value = "";
        input.focus();
      }
    } catch (e) {
      error.textContent = "خطأ في الاتصال. يرجى المحاولة مرة أخرى.";
      error.classList.add("visible");
      console.error("Family verify error:", e);
    } finally {
      btn.disabled = false;
      btn.classList.remove("btn-loading");
    }
  },

  /**
   * Enter the attendance dashboard for a given family.
   * @param {string} familyName
   */
  enterAttendanceDashboard(familyName) {
    Storage.setFamily(familyName);
    UI.updateTopBar();
    UI.renderServiceDayStrip(5);
    UI.renderMembersList();
    navigateTo("attendance");
    App.switchTab("attendance");
    UI.updateQueueCountBadges();
  },

  showMembersLoading() {
    let overlay = document.getElementById("members-loading-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "members-loading-overlay";
      overlay.style.opacity = "0";
      overlay.innerHTML = '<div class="spinner"></div><span>جارٍ تحميل البيانات...</span>';
      const panel = document.getElementById("panel-attendance");
      if (panel) panel.appendChild(overlay);
      requestAnimationFrame(() => { overlay.style.opacity = "1"; });
    } else {
      overlay.style.display = "flex";
      requestAnimationFrame(() => { overlay.style.opacity = "1"; });
    }
  },

  hideMembersLoading() {
    const overlay = document.getElementById("members-loading-overlay");
    if (overlay) {
      overlay.style.opacity = "0";
      setTimeout(() => { overlay.style.display = "none"; }, 250);
    }
  },

  async refreshAttendance() {
    if (!navigator.onLine) return;
    const family = Storage.getFamily();
    if (!family || !App.selectedDate) return;
    App.showMembersLoading();
    try {
      const result = await API.getAttendanceForDate(family, App.selectedDate);
      if (result && result.attendance) {
        Object.entries(result.attendance).forEach(([memberId, entry]) => {
          const status = entry.status;
          if (status) {
            Storage.markAttendanceLocally(memberId, status, App.selectedDate);
          }
          if (entry.dailyNote) {
            Storage.setDailyNote(memberId, App.selectedDate, entry.dailyNote);
          }
        });
        UI.renderMembersList();
      }
    } catch (_) {
      // Silently ignore
    } finally {
      App.hideMembersLoading();
    }
  },



  /**
   * Open admin code verification modal.
   */
  openAdminCodeModal() {
    const input = document.getElementById("input-admin-code");
    const error = document.getElementById("admin-code-error");
    if (input) input.value = "";
    if (error) error.classList.remove("visible");
    openModal("modal-admin-code");
    setTimeout(() => {
      if (input) input.focus();
    }, 400);
  },

  /**
   * Submit admin secret code for verification.
   */
  async submitAdminCode() {
    const input = document.getElementById("input-admin-code");
    const error = document.getElementById("admin-code-error");
    const btn = document.getElementById("btn-verify-admin");
    const code = input.value.trim();

    if (!code) {
      error.textContent = "يرجى إدخال الكود السري";
      error.classList.add("visible");
      return;
    }

    btn.disabled = true;
    btn.classList.add("btn-loading");
    error.classList.remove("visible");

    try {
      const result = await API.verifyAdmin(code);
      if (result.success) {
        closeModal("modal-admin-code");
        App.enterAdminPanel();
      } else {
        error.textContent = "الكود السري غير صحيح";
        error.classList.add("visible");
        input.value = "";
        input.focus();
      }
    } catch (e) {
      error.textContent = "خطأ في الاتصال. يرجى المحاولة مرة أخرى.";
      error.classList.add("visible");
      console.error("Admin verify error:", e);
    } finally {
      btn.disabled = false;
      btn.classList.remove("btn-loading");
    }
  },

  /**
   * Enter admin panel screen.
   */
  enterAdminPanel() {
    navigateTo("admin");
    UI.renderAdminFamilyList(App.adminFamilies);
    UI.updateQueueCountBadges();
    // Load stages then re-render family list
    API.getFamilyStages().then(result => {
      if (result && result.stages) {
        App.familyStages = result.stages;
        UI.renderAdminFamilyList(App.adminFamilies);
      }
    }).catch(() => {});
    // Load absentees by default for notification check
    if (Notifications.permission !== "granted") {
      API.getAbsentees(CONFIG.ABSENCE_THRESHOLD).then((result) => {
        if (result.members && result.members.length > 0) {
          const container = document.getElementById("admin-absentees-list");
          if (container) {
            container.innerHTML = "";
            UI.renderAbsenteesList(result.members);
          }
        }
      }).catch(() => { });
    }
  },

  /**
   * Record attendance for a member.
   * @param {string} memberId
   * @param {"present"|"absent"} status
   * @param {string} date
   * @param {HTMLElement} card
   */
  async recordAttendance(memberId, status, date, card = null) {
    const family = Storage.getFamily();

    // Visual feedback immediately
    if (card) {
      const presentBtn = card.querySelector(".present-btn");
      const absentBtn = card.querySelector(".absent-btn");

      presentBtn.classList.remove("selected");
      absentBtn.classList.remove("selected");

      if (status === "present") {
        presentBtn.classList.add("selected");
      } else {
        absentBtn.classList.add("selected");
      }
    }

    // Save locally
    Storage.markAttendanceLocally(memberId, status, date);
    console.log(`[Attendance Log] Local mark: MemberId=${memberId}, Status=${status}, Date=${date}, Family=${family}`);

    // Update badge on card
    if (card) {
      const oldBadge = card.querySelector(".member-status-badge");
      if (oldBadge) oldBadge.remove();
      const badge = document.createElement("span");
      badge.className = `member-status-badge ${status}`;
      badge.textContent = status === "present" ? "✅ حاضر" : "❌ غائب";
      card.querySelector(".member-card-header").appendChild(badge);
    }

    // Auto-open details modal if absent (after card animation settles)
    if (status === "absent" && card) {
      var members = Storage.getMembers();
      var member = members.find(function(m) { return m.id === memberId; });
      if (member) {
        setTimeout(function() {
          showMemberDetailsModal(member, date);
        }, 400);
      }
    }

    const queueItem = {
      action: "markAttendance",
      memberId,
      family,
      date,
      status,
      queuedAt: new Date().toISOString()
    };

    if (!navigator.onLine) {
      Storage.addToOfflineQueue(queueItem);
      console.log(`[Attendance Log] Offline queue add: MemberId=${memberId}, Status=${status}, Date=${date}`);
      showToast("📴 تم الحفظ محلياً — سيُرسل عند اتصال الإنترنت");
      UI.updateQueueCountBadges();
      UI.renderMembersList();
      return;
    }

    // Try to send directly
    try {
      const result = await API.markAttendance(memberId, family, date, status);
      if (result.success) {
        console.log(`[Attendance Log] Sync success: MemberId=${memberId}, Status=${status}, Date=${date}`);
        showToast(status === "present" ? "✅ تم تسجيل الحضور" : "❌ تم تسجيل الغياب", "success", 2000);
        Storage.setLastSync(new Date().toISOString());
        UI.updateQueueCountBadges();
      } else {
        throw new Error("Server returned failure");
      }
    } catch (e) {
      // Fall back to offline queue
      Storage.addToOfflineQueue(queueItem);
      console.error(`[Attendance Log] Sync error (fell back to queue):`, e);
      showToast("📴 تم الحفظ محلياً — سيُرسل لاحقاً", "", 2500);
      UI.updateQueueCountBadges();
    }
    UI.renderMembersList();
  },

  /**
   * Submit the registration form.
   */
  async submitRegistration() {
    const name = document.getElementById("reg-name").value.trim();
    const phone = document.getElementById("reg-phone").value.trim();
    const parentPhone = document.getElementById("reg-parent-phone").value.trim();
    const dob = document.getElementById("reg-dob").value;
    const notes = document.getElementById("reg-notes").value.trim();

    // Validate
    let valid = true;

    const showFieldError = (fieldId, errorId, message) => {
      const field = document.getElementById(fieldId);
      const error = document.getElementById(errorId);
      if (!document.getElementById(fieldId).value.trim()) {
        field.classList.add("error");
        error.textContent = message;
        error.classList.add("visible");
        valid = false;
      } else {
        field.classList.remove("error");
        error.classList.remove("visible");
      }
    };

    showFieldError("reg-name", "reg-name-error", "الاسم الكامل مطلوب");
    showFieldError("reg-phone", "reg-phone-error", "رقم التليفون مطلوب");
    showFieldError("reg-parent-phone", "reg-parent-phone-error", "تليفون ولي الأمر مطلوب");

    const dobField = document.getElementById("reg-dob");
    const dobError = document.getElementById("reg-dob-error");
    if (!dob) {
      dobField.classList.add("error");
      dobError.classList.add("visible");
      valid = false;
    } else {
      dobField.classList.remove("error");
      dobError.classList.remove("visible");
    }

    if (!valid) return;

    const btn = document.getElementById("btn-submit-registration");
    btn.disabled = true;
    btn.classList.add("btn-loading");

    const family = Storage.getFamily();
    const memberData = { family, name, phone, parentPhone, dob, notes };

    try {
      const result = await API.addMember(memberData);

      if (result.success) {
        const newMember = {
          id: result.id || generateUUID(),
          name,
          family,
          phone,
          parentPhone,
          dob,
          notes,
          registeredAt: new Date().toISOString()
        };

        // Add to local cache
        const members = Storage.getMembers();
        members.push(newMember);
        Storage.setMembers(members);

        // Refresh dashboard
        UI.renderMembersList();

        // Close modal and reset form
        closeModal("modal-registration");
        document.getElementById("registration-form").reset();

        showToast(`✅ تم إضافة ${name} بنجاح`, "success");
      } else {
        showToast("فشل في إضافة المخدوم. يرجى المحاولة مرة أخرى.", "error");
      }
    } catch (e) {
      showToast("خطأ في الاتصال. يرجى المحاولة مرة أخرى.", "error");
      console.error("Add member error:", e);
    } finally {
      btn.disabled = false;
      btn.classList.remove("btn-loading");
    }
  },

  /**
   * Load analytics data and render chart.
   */
  async loadAnalytics() {
    const filterEl = document.getElementById("filter-month");
    const [year, month] = (filterEl.value || `${new Date().getFullYear()}-${new Date().getMonth() + 1}`).split("-").map(Number);
    const family = Storage.getFamily();

    setLoading(true, "جارٍ تحميل الإحصائيات...");
    try {
      const result = await API.getAttendanceStats(family, year, month, 5);
      UI.renderAnalytics(result);
    } catch (e) {
      Chart.drawEmpty();
      showToast("فشل في تحميل الإحصائيات", "error");
    } finally {
      setLoading(false);
    }
  },

  /**
   * Log out the current family user.
   */
  logout() {
    Storage.remove(CONFIG.STORAGE_KEYS.FAMILY);
    Storage.remove(CONFIG.STORAGE_KEYS.MEMBERS);
    Storage.remove(CONFIG.STORAGE_KEYS.ATTENDANCE_TODAY);
    App.selectedFamily = null;
    navigateTo("families");
    showToast("تم تسجيل الخروج بنجاح");
  },

  /**
   * Admin-specific operations.
   */
  admin: {
    editFamily(familyName) {
      document.getElementById("edit-family-name").value = familyName;
      document.getElementById("edit-family-password").value = "";
      document.getElementById("edit-family-original-name").value = familyName;
      document.getElementById("edit-family-subtitle").textContent = `تعديل بيانات: ${familyName}`;
      openModal("modal-edit-family");
    },

    async saveEditFamily() {
      const originalName = document.getElementById("edit-family-original-name").value;
      const newName = document.getElementById("edit-family-name").value.trim();
      const newPassword = document.getElementById("edit-family-password").value.trim();

      if (!newName) {
        showToast("اسم الأسرة مطلوب", "error");
        return;
      }

      const btn = document.getElementById("btn-save-edit-family");
      btn.disabled = true;
      btn.classList.add("btn-loading");

      try {
        // If the name changed, rename all associated sheet tabs first
        if (originalName !== newName) {
          const renameResult = await API.renameFamily(originalName, newName);
          if (!renameResult || !renameResult.success) {
            showToast(renameResult && renameResult.error ? renameResult.error : "فشل في إعادة تسمية الجداول", "error");
            return;
          }
        }

        // Update local families list
        const idx = App.adminFamilies.indexOf(originalName);
        if (idx !== -1) App.adminFamilies[idx] = newName;

        if (newPassword) {
          App.adminPasswords[newName] = newPassword;
          delete App.adminPasswords[originalName];
        } else {
          // Preserve old password mapping under new name
          if (App.adminPasswords[originalName]) {
            App.adminPasswords[newName] = App.adminPasswords[originalName];
            delete App.adminPasswords[originalName];
          }
        }

        const result = await API.updateFamilyConfig(App.adminFamilies, App.adminPasswords);
        if (result.success) {
          CONFIG.FAMILIES = [...App.adminFamilies];
          UI.renderFamiliesGrid();
          closeModal("modal-edit-family");
          UI.renderAdminFamilyList(App.adminFamilies);
          showToast("✅ تم حفظ التعديلات", "success");
        } else {
          showToast("فشل في الحفظ", "error");
        }
      } catch (e) {
        showToast("خطأ في الاتصال", "error");
      } finally {
        btn.disabled = false;
        btn.classList.remove("btn-loading");
      }
    },

    async deleteFamily(familyName) {
      // — Typed-confirmation modal —
      const confirmed = await new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.innerHTML = `
          <div class="modal modal-center">
            <div class="modal-title" style="color:var(--danger);">⚠️ حذف دائم لجميع البيانات</div>
            <div class="modal-subtitle">
              هذا الإجراء لا يمكن التراجع عنه. سيتم حذف جميع جداول<br>
              <strong>«${familyName}»</strong> نهائياً: قائمة المخدومين، سجلات الحضور،
              الخدام، والافتقاد.
            </div>
            <div style="margin-bottom:16px;font-size:15px;font-weight:700;color:var(--text-primary);">
              اكتب اسم الأسرة (<span style="unicode-bidi:plain;font-family:monospace;">${familyName}</span>) للتأكيد
            </div>
            <input type="text" id="confirm-delete-input"
                   placeholder="اكتب اسم الأسرة هنا..."
                   style="width:100%;padding:14px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:18px;margin-bottom:20px;box-sizing:border-box;text-align:center;font-weight:600;">
            <div style="display:flex;gap:12px;">
              <button class="btn btn-ghost" id="confirm-delete-cancel" style="flex:1;">إلغاء</button>
              <button class="btn btn-danger" id="confirm-delete-confirm" style="flex:1;">تأكيد الحذف</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add("open"));
        document.body.style.overflow = "hidden";

        const input = overlay.querySelector("#confirm-delete-input");
        const confirmBtn = overlay.querySelector("#confirm-delete-confirm");
        const cancelBtn = overlay.querySelector("#confirm-delete-cancel");

        function close() {
          overlay.classList.remove("open");
          document.body.style.overflow = "";
          setTimeout(() => overlay.remove(), 300);
        }

        const reject = () => { resolve(false); close(); };
        cancelBtn.onclick = reject;
        overlay.onclick = (e) => { if (e.target === overlay) reject(); };
        input.onkeydown = (e) => { if (e.key === "Enter") confirmBtn.click(); };
        setTimeout(() => input.focus(), 100);

        confirmBtn.onclick = () => {
          if (input.value.trim() === familyName) {
            resolve(true);
            close();
          } else {
            showToast("الاسم غير مطابق، لم يتم الحذف", "error");
            input.value = "";
            input.focus();
          }
        };
      });

      if (!confirmed) return;

      // — Proceed with deletion —
      App.adminFamilies = App.adminFamilies.filter((f) => f !== familyName);
      delete App.adminPasswords[familyName];

      try {
        const configResult = await API.updateFamilyConfig(App.adminFamilies, App.adminPasswords);
        if (!configResult.success) {
          showToast("فشل في الحذف", "error");
          return;
        }

        const deleteResult = await API.deleteFamilyData({ family: familyName });

        CONFIG.FAMILIES = [...App.adminFamilies];
        UI.renderFamiliesGrid();
        UI.renderAdminFamilyList(App.adminFamilies);

        if (deleteResult && deleteResult.success) {
          const failed = deleteResult.failedSheets;
          if (failed && failed.length > 0) {
            showToast(`⚠️ تم حذف كل البيانات بنجاح ما عدا: ${failed.join("، ")} - يرجى حذفها يدويًا من الشيت`, "error", 8000);
          } else {
            const count = (deleteResult.deletedSheets && deleteResult.deletedSheets.length) || 0;
            showToast(`✅ تم حذف الأسرة وجميع بياناتها (${count} جدول)`, "success");
          }
        } else {
          showToast("⚠️ تم إزالة كلمة المرور لكن لم تُحذف جميع الجداول. حاول مرة أخرى أو راجع البيانات يدويًا.", "error");
        }
      } catch (e) {
        showToast("خطأ في الاتصال", "error");
      }
    },

    async saveNewFamily() {
      const nameInput = document.getElementById("new-family-name");
      const passInput = document.getElementById("new-family-password");
      const stageSelect = document.getElementById("new-family-stage");
      const name = nameInput.value.trim();
      const password = passInput.value.trim();
      const stage = stageSelect ? stageSelect.value : "";

      if (!name || !password) {
        showToast("اسم الأسرة وكلمة المرور مطلوبان", "error");
        return;
      }

      if (App.adminFamilies.includes(name)) {
        showToast("هذه الأسرة موجودة بالفعل", "error");
        return;
      }

      const btn = document.getElementById("btn-save-new-family");
      btn.disabled = true;
      btn.classList.add("btn-loading");

      App.adminFamilies.push(name);
      App.adminPasswords[name] = password;

      try {
        const result = await API.updateFamilyConfig(App.adminFamilies, App.adminPasswords);
        if (result.success) {
          CONFIG.FAMILIES = [...App.adminFamilies];
          // Save stage if selected
          if (stage) {
            App.familyStages[name] = stage;
            await API.updateFamilyStage(name, stage).catch(() => {});
          }
          UI.renderFamiliesGrid();
          UI.renderAdminFamilyList(App.adminFamilies);
          nameInput.value = "";
          passInput.value = "";
          if (stageSelect) stageSelect.value = "";
          document.getElementById("add-family-form").classList.remove("visible");
          showToast(`✅ تمت إضافة ${name}`, "success");
        } else {
          App.adminFamilies.pop();
          delete App.adminPasswords[name];
          showToast("فشل في الحفظ", "error");
        }
      } catch (e) {
        App.adminFamilies.pop();
        delete App.adminPasswords[name];
        showToast("خطأ في الاتصال", "error");
      } finally {
        btn.disabled = false;
        btn.classList.remove("btn-loading");
      }
    }
  }
};

/* =====================================================
   ATTENDANCE DETAILS MODAL
===================================================== */

function showAttendanceDetailsModal(members, status, dateLabel) {
  const existingOverlay = document.getElementById("modal-attendance-details");
  const isLoading = members === null;

  const titleText = status === "present" ? "الحاضرون" : "الغائبون";
  const emoji = status === "present" ? "🙋🏻‍♂️" : "🙅🏻‍♂️";
  const bgColor = status === "present" ? "#e8f5e9" : "#ffebee";

  if (existingOverlay && !isLoading) {
    // Update existing modal body with actual data
    let rowsHtml = "";
    if (!members.length) {
      rowsHtml = `<p style="text-align:center;padding:24px 0;color:var(--text-muted);font-size:15px;">لا توجد بيانات</p>`;
    } else {
      members.forEach((m) => {
        rowsHtml += `
          <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
            <div style="width:52px;height:52px;border-radius:12px;background:${bgColor};display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">
              ${emoji}
            </div>
            <div>
              <span style="font-size:16px;font-weight:700;color:var(--text);">${m.name}</span>
              ${m.dailyNote ? `<div style="font-size:13px;color:${status === "present" ? "#2e7d32" : "#c62828"};margin-top:4px;font-weight:500;">📝 ${m.dailyNote}</div>` : ""}
            </div>
          </div>
        `;
      });
    }
    const body = existingOverlay.querySelector(".attendance-details-body");
    if (body) body.innerHTML = rowsHtml;
    return;
  }

  if (existingOverlay) existingOverlay.remove();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "modal-attendance-details";

  let bodyHtml;
  if (isLoading) {
    bodyHtml = `
      <div class="modal-loading-body">
        <div class="spinner"></div>
        <span>جارٍ تحميل البيانات...</span>
      </div>
    `;
  } else if (!members.length) {
    bodyHtml = `<p style="text-align:center;padding:24px 0;color:var(--text-muted);font-size:15px;">لا توجد بيانات</p>`;
  } else {
    bodyHtml = members.map((m) => `
      <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
        <div style="width:52px;height:52px;border-radius:12px;background:${bgColor};display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">
          ${emoji}
        </div>
        <div>
          <span style="font-size:16px;font-weight:700;color:var(--text);">${m.name}</span>
          ${m.dailyNote ? `<div style="font-size:13px;color:${status === "present" ? "#2e7d32" : "#c62828"};margin-top:4px;font-weight:500;">📝 ${m.dailyNote}</div>` : ""}
        </div>
      </div>
    `).join("");
  }

  const modal = document.createElement("div");
  modal.className = "modal modal-center";
  modal.innerHTML = `
    <div class="modal-handle"></div>
    <button class="modal-close" id="btn-close-attendance-details" aria-label="إغلاق">✕</button>
    <h2 class="modal-title">${titleText}</h2>
    <p class="modal-subtitle">${dateLabel}</p>
    <div class="attendance-details-body" style="padding:4px 0;">
      ${bodyHtml}
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.querySelector("#btn-close-attendance-details").addEventListener("click", () => {
    overlay.classList.remove("open");
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 350);
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.classList.remove("open");
      setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 350);
    }
  });

  requestAnimationFrame(() => {
    overlay.classList.add("open");
  });
}

/* =====================================================
   VISITATION PANEL
===================================================== */

const _visitationState = {
  family: null,
  year: null,
  month: null,
  visitations: []
};

async function renderVisitationPanel(family) {
  const yearFilter = document.getElementById("visitation-year-filter");
  const monthsGrid = document.getElementById("visitation-months-grid");
  if (!yearFilter || !monthsGrid) return;

  // Clear any dynamically created FABs
  document.querySelectorAll(".visitation-fab").forEach(function(el) { el.remove(); });

  _visitationState.family = family;
  _visitationState.visitations = [];
  _visitationState.month = null;

  try {
    const result = await API.getVisitations(family);
    console.log("[INVESTIGATE] renderVisitationPanel — raw API result:", JSON.stringify(result));
    if (result.success) {
      _visitationState.visitations = result.visitations || [];
    }
  } catch (e) {
    // Silently ignore
  }

  const currentYear = new Date().getFullYear();
  _visitationState.year = currentYear;

  yearFilter.innerHTML = "";
  for (let y = currentYear; y >= currentYear - 3; y--) {
    const btn = document.createElement("button");
    btn.className = "visitation-year-btn" + (y === currentYear ? " active" : "");
    btn.textContent = y;
    btn.addEventListener("click", function() {
      yearFilter.querySelectorAll(".visitation-year-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      _visitationState.year = y;
      _visitationState.month = null;
      renderVisitationView();
    });
    yearFilter.appendChild(btn);
  }

  renderVisitationView();
}

function renderVisitationView() {
  console.log("[INVESTIGATE] renderVisitationView — visitations:", JSON.stringify(_visitationState.visitations), "year:", _visitationState.year, "month:", _visitationState.month);
  const monthsGrid = document.getElementById("visitation-months-grid");
  if (!monthsGrid) return;

  document.querySelectorAll(".visitation-fab").forEach(function(el) { el.remove(); });

  const { year, month, visitations } = _visitationState;

  if (month === null) {
    monthsGrid.innerHTML = "";
    const arabicMonths = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

    for (let m = 0; m < 12; m++) {
      const count = visitations.filter(function(v) {
        var parts = (v.date || "").split("-");
        if (parts.length !== 3) return false;
        return parseInt(parts[0], 10) === year && (parseInt(parts[1], 10) - 1) === m;
      }).length;

      const card = document.createElement("div");
      card.className = "month-card";
      card.style.background = CONFIG.PASTEL_COLORS[m % CONFIG.PASTEL_COLORS.length];
      card.innerHTML =
        '<div class="month-card-name">' + arabicMonths[m] + '</div>' +
        '<div class="month-card-count">' + (count > 0 ? toArabicNumerals(count) + ' افتقادات' : 'لا يوجد افتقادات') + '</div>';
      card.addEventListener("click", function() {
        _visitationState.month = m;
        renderVisitationView();
      });
      monthsGrid.appendChild(card);
    }
  } else {
    const filtered = visitations.filter(function(v) {
      var parts = (v.date || "").split("-");
      if (parts.length !== 3) return false;
      return parseInt(parts[0], 10) === year && (parseInt(parts[1], 10) - 1) === month;
    });

    monthsGrid.innerHTML = "";

    const backBtn = document.createElement("button");
    backBtn.className = "visitation-back-btn";
    backBtn.textContent = "→ رجوع";
    backBtn.addEventListener("click", function() {
      _visitationState.month = null;
      renderVisitationView();
    });
    monthsGrid.appendChild(backBtn);

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "visitation-empty";
      empty.innerHTML = "🤷‍♂️<br><span>لا يوجد افتقادات</span>";
      monthsGrid.appendChild(empty);
    } else {
      filtered.forEach(function(v) {
        const card = document.createElement("div");
        card.className = "visitation-card";
        card.innerHTML =
          '<div class="visitation-card-name">' + v.memberName + "</div>" +
          '<div class="visitation-card-meta">' +
            '<span class="visitation-card-servant">👤 ' + v.servantName + "</span>" +
            '<span class="visitation-card-date">📅 ' + v.date + "</span>" +
            '<span class="visitation-card-time">⏰ ' + v.time + "</span>" +
          "</div>" +
          (v.note ? '<div class="visitation-card-note">📝 ' + v.note + "</div>" : "");
        card.addEventListener("click", function() {
          showVisitationDetailsModal(v);
        });
        monthsGrid.appendChild(card);
      });
    }

    const fab = document.createElement("button");
    fab.className = "fab visitation-fab";
    fab.textContent = "＋";
    fab.addEventListener("click", function() {
      openVisitationModal();
    });
    monthsGrid.appendChild(fab);
  }
}

function openVisitationModal() {
  const family = _visitationState.family;
  const members = Storage.getMembers();
  const servants = Storage.getServants(family);
  const now = new Date();
  const today = toDateString(now);
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const currentTime = hours + ":" + minutes;

  let overlay = document.getElementById("modal-visitation");
  if (overlay) overlay.remove();

  overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "modal-visitation";
  const servantColors = Storage.getServantColors(family);

  overlay.innerHTML =
    '<div class="modal modal-center">' +
      '<button class="modal-close" id="btn-close-visitation">✕</button>' +
      '<h2 class="modal-title">تسجيل افتقاد جديد</h2>' +
      '<div class="visitation-modal-form">' +
        '<div class="form-group">' +
          '<label class="form-label">المخدوم</label>' +
          '<select class="form-input" id="visitation-member-select">' +
            members.map(function(m) {
              return '<option value="' + m.id + '" data-name="' + m.name + '">' + m.name + "</option>";
            }).join("") +
          "</select>" +
        "</div>" +
        '<div class="visitation-location-block" id="visitation-location-block" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);margin-bottom:12px;">' +
          '<span class="member-detail-label" style="font-size:13px;font-weight:600;color:var(--text-secondary);">مكان المنزل</span>' +
          '<span class="member-detail-value-wrap" id="visitation-location-wrap"></span>' +
        "</div>" +
        '<div class="form-group">' +
          '<label class="form-label">التاريخ</label>' +
          '<input class="form-input" type="date" id="visitation-date" value="' + today + '" />' +
        "</div>" +
        '<div class="form-group">' +
          '<label class="form-label">الوقت</label>' +
          '<input class="form-input" type="time" id="visitation-time" value="' + currentTime + '" />' +
        "</div>" +
        '<div class="form-group">' +
          '<label class="form-label">الخادم</label>' +
          '<div class="visitation-servants-list" id="visitation-servants-list">' +
            servants.map(function(s) {
              var color = servantColors[s] || "";
              var colorIndicator = color
                ? '<span class="servant-color-dot" style="background:' + color + ';display:inline-block;width:14px;height:14px;border-radius:50%;margin-left:8px;border:2px solid rgba(0,0,0,0.1);vertical-align:middle;"></span>'
                : "";
              return '<button class="visitation-servant-btn" data-servant="' + s + '">' + colorIndicator + s + "</button>";
            }).join("") +
          "</div>" +
        "</div>" +
        '<div class="form-group">' +
          '<label class="form-label">ملاحظة <span>(اختياري)</span></label>' +
          '<textarea class="form-input" id="visitation-note" rows="3"></textarea>' +
        "</div>" +
        '<button class="btn btn-primary" id="btn-save-visitation">💾 حفظ</button>' +
      "</div>" +
    "</div>";

  document.body.appendChild(overlay);

  let selectedServants = [];
  overlay.querySelectorAll(".visitation-servant-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      btn.classList.toggle("selected");
      var name = btn.dataset.servant;
      var idx = selectedServants.indexOf(name);
      if (idx === -1) {
        selectedServants.push(name);
      } else {
        selectedServants.splice(idx, 1);
      }
    });
  });

  overlay.querySelector("#btn-close-visitation").addEventListener("click", function() {
    overlay.classList.remove("open");
    setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 350);
  });
  overlay.addEventListener("click", function(e) {
    var locBtn = e.target.closest(".detail-loc-btn");
    if (locBtn) {
      var select = document.getElementById("visitation-member-select");
      handleGetLocationForMember(select.value, function() {
        renderVisitationLocationBlock();
      });
      return;
    }
    if (e.target === overlay) {
      overlay.classList.remove("open");
      setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 350);
    }
  });

  function getVisitationMember(memberId) {
    return Storage.getMembers().find(function(m) { return m.id === memberId; });
  }

  function renderVisitationLocationBlock() {
    var select = document.getElementById("visitation-member-select");
    var wrap = document.getElementById("visitation-location-wrap");
    if (!select || !wrap) return;
    var member = getVisitationMember(select.value);
    if (member && member.homeLocation) {
      var displayName = member.homeLocationName || member.homeLocation;
      wrap.innerHTML = '<span class="member-detail-value" style="font-size:14px;font-weight:600;color:var(--text-primary);">' + displayName + '</span>' +
        '<a href="https://www.google.com/maps?q=' + member.homeLocation + '" target="_blank" class="detail-map-btn">🗺️</a>';
    } else {
      wrap.innerHTML = '<button class="detail-loc-btn">📍</button>';
    }
  }

  renderVisitationLocationBlock();
  document.getElementById("visitation-member-select").addEventListener("change", renderVisitationLocationBlock);

  overlay.querySelector("#btn-save-visitation").addEventListener("click", async function() {
    const select = document.getElementById("visitation-member-select");
    const selectedOption = select.options[select.selectedIndex];
    const memberId = select.value;
    const memberName = selectedOption ? selectedOption.dataset.name : "";
    const date = document.getElementById("visitation-date").value;
    const time = document.getElementById("visitation-time").value;
    const note = document.getElementById("visitation-note").value.trim();

    if (selectedServants.length === 0) {
      showToast("يرجى اختيار الخادم", "error");
      return;
    }

    const saveBtn = document.getElementById("btn-save-visitation");
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳";

    const payload = { memberId, memberName, family, servantName: selectedServants.join("، "), date, time, note };
    console.log("saveVisitation payload:", JSON.stringify(payload));

    try {
      const result = await API.saveVisitation(payload);
      console.log("saveVisitation result:", JSON.stringify(result));
      if (result.success) {
        showToast("✅ تم تسجيل الافتقاد", "success");
        overlay.classList.remove("open");
        setTimeout(function() {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          renderVisitationPanel(family);
        }, 350);
      } else {
        showToast("فشل في تسجيل الافتقاد", "error");
      }
    } catch (e) {
      console.error("saveVisitation error:", e);
      showToast("خطأ في الاتصال", "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 حفظ";
    }
  });

  requestAnimationFrame(function() { overlay.classList.add("open"); });
}

/* =====================================================
   VISITATION DETAILS MODAL
===================================================== */

function showVisitationDetailsModal(visitation) {
  const family = _visitationState.family;
  const members = Storage.getMembers();
  const member = members.find(function(m) { return m.name === visitation.memberName; });
  const memberId = member ? member.id : null;
  const servants = Storage.getServants(family);
  const servantColors = Storage.getServantColors(family);

  let overlay = document.getElementById("modal-visitation-details");
  if (overlay) overlay.remove();

  overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "modal-visitation-details";

  var servantOptionsHtml = servants.map(function(s) {
    var color = servantColors[s] || "";
    var selected = s === visitation.servantName ? "selected" : "";
    return '<option value="' + s.replace(/"/g, "&quot;") + '" ' + selected + ">" + s + "</option>";
  }).join("");
  if (!servants.includes(visitation.servantName)) {
    servantOptionsHtml += '<option value="' + visitation.servantName.replace(/"/g, "&quot;") + '" selected>' + visitation.servantName + "</option>";
  }

  overlay.innerHTML =
    '<div class="modal modal-center">' +
      '<button class="modal-close" id="btn-close-visitation-details">✕</button>' +
      '<h2 class="modal-title" style="text-align:center;">' + visitation.memberName + '</h2>' +
      '<p class="modal-subtitle" style="text-align:center;">تفاصيل الافتقاد</p>' +
      '<div class="visitation-modal-form">' +
        '<div class="visitation-location-block" id="details-location-block" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);margin-bottom:12px;">' +
          '<span class="member-detail-label" style="font-size:13px;font-weight:600;color:var(--text-secondary);">مكان المنزل</span>' +
          '<span class="member-detail-value-wrap" id="details-location-wrap"></span>' +
        "</div>" +
        '<div class="form-group">' +
          '<label class="form-label">التاريخ</label>' +
          '<input class="form-input" type="date" id="details-visitation-date" value="' + visitation.date + '" />' +
        "</div>" +
        '<div class="form-group">' +
          '<label class="form-label">الوقت</label>' +
          '<input class="form-input" type="time" id="details-visitation-time" value="' + visitation.time + '" />' +
        "</div>" +
        '<div class="form-group">' +
          '<label class="form-label">الخادم</label>' +
          '<select class="form-input" id="details-visitation-servant">' +
            servantOptionsHtml +
          "</select>" +
        "</div>" +
        '<div class="form-group">' +
          '<label class="form-label">ملاحظة</label>' +
          '<textarea class="form-input" id="details-visitation-note" rows="3">' + (visitation.note || "") + "</textarea>" +
        "</div>" +
        '<button class="btn btn-primary" id="btn-save-visitation-details">💾 حفظ</button>' +
      "</div>" +
    "</div>";

  document.body.appendChild(overlay);

  function renderDetailsLocationBlock() {
    var wrap = document.getElementById("details-location-wrap");
    if (!wrap) return;
    if (member && member.homeLocation) {
      var displayName = member.homeLocationName || member.homeLocation;
      wrap.innerHTML = '<span class="member-detail-value" style="font-size:14px;font-weight:600;color:var(--text-primary);">' + displayName + '</span>' +
        '<a href="https://www.google.com/maps?q=' + member.homeLocation + '" target="_blank" class="detail-map-btn">🗺️</a>';
    } else {
      wrap.innerHTML = '<button class="detail-loc-btn">📍</button>';
    }
  }

  renderDetailsLocationBlock();

  overlay.addEventListener("click", function(e) {
    var locBtn = e.target.closest(".detail-loc-btn");
    if (locBtn) {
      if (memberId) {
        handleGetLocationForMember(memberId, function() {
          renderDetailsLocationBlock();
        });
      } else {
        showToast("لا يمكن تحديد المخدوم", "error");
      }
      return;
    }
  });

  overlay.querySelector("#btn-close-visitation-details").addEventListener("click", function() {
    overlay.classList.remove("open");
    setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 350);
  });
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) {
      overlay.classList.remove("open");
      setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 350);
    }
  });

  overlay.querySelector("#btn-save-visitation-details").addEventListener("click", async function() {
    var date = document.getElementById("details-visitation-date").value;
    var time = document.getElementById("details-visitation-time").value;
    var servantSelect = document.getElementById("details-visitation-servant");
    var servantName = servantSelect ? servantSelect.value : visitation.servantName;
    var note = document.getElementById("details-visitation-note").value.trim();

    var saveBtn = document.getElementById("btn-save-visitation-details");
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳";

    try {
      var result = await API.updateVisitation({
        id: visitation.id,
        family: family,
        date: date,
        time: time,
        servantName: servantName,
        note: note
      });
      if (result.success) {
        var idx = _visitationState.visitations.findIndex(function(v) { return v.id === visitation.id; });
        if (idx !== -1) {
          _visitationState.visitations[idx].date = date;
          _visitationState.visitations[idx].time = time;
          _visitationState.visitations[idx].servantName = servantName;
          _visitationState.visitations[idx].note = note;
        }
        showToast("✅ تم تحديث الافتقاد", "success");
        overlay.classList.remove("open");
        setTimeout(function() {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          renderVisitationView();
        }, 350);
      } else {
        showToast(result.error || "فشل في تحديث الافتقاد", "error");
      }
    } catch (e) {
      console.error("updateVisitation error:", e);
      showToast("خطأ في الاتصال", "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 حفظ";
    }
  });

  requestAnimationFrame(function() { overlay.classList.add("open"); });
}

/* =====================================================
   BOOT
===================================================== */

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
