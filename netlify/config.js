/**
 * config.js — Client-side configuration only.
 * Sensitive data (passwords, admin code) MUST live in Google Apps Script properties ONLY.
 */
const CONFIG = {
  APP_VERSION: "1.1.0",
  FACE_API_URL: "https://kerogergs-church-attendance-api.hf.space",
  FACE_RECOGNITION_THRESHOLD: 0.70,
  GOOGLE_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbx3lSw601L6F1kWa4E1x7AqVvzk86T_fXFe9hnASj3mYgi0OjZTrSCWUEKFxDOjDXKGjQ/exec",
  APP_NAME: "إدارة حضور خدمة الأحد",
  FAMILIES: [],
  FAMILY_STAGES: ["ابتدائي", "إعدادي", "ثانوي", "شباب"],
  SHEET_URL: "https://docs.google.com/spreadsheets/d/1oblew9d_wFKAimqcgYqbTnHBQpM3RUi9dwEF6KbGju4/edit?gid=0#gid=0",
  ABSENCE_THRESHOLD: 3,
  PASTEL_COLORS: ["#D4F5A2", "#FFD6E0", "#C8E6FF", "#E8D5FF"],
  SERVANT_COLOR_PALETTE: ["#FFB3B3", "#FFD9A0", "#FFFAAA", "#B3F0B3", "#A0D4FF", "#D4B3FF", "#FFB3E6", "#B3FFF0"],
  ARABIC_MONTHS: [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
  ],
  ARABIC_DAYS: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  STORAGE_KEYS: {
    FAMILY: "sundayApp_family",
    MEMBERS: "sundayApp_members",
    OFFLINE_QUEUE: "sundayApp_offlineQueue",
    LAST_SYNC: "sundayApp_lastSync",
    NOTIFICATION_PERM: "sundayApp_notifPerm",
    ATTENDANCE_TODAY: "sundayApp_attendanceToday"
  }
};
